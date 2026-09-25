package app

import (
	"bytes"
	"fmt"
	"math"
	"time"
)

// Minimal MPEG Layer III frame handling for stitching podcast episodes.
//
// ElevenLabs returns plain CBR MP3 streams that all share one encoding
// (sample rate, bitrate, channel mode), so an episode can be assembled by
// concatenating audio frames byte for byte, with silence made of empty
// frames that copy the speech frames' header. This keeps the server free of
// ffmpeg. Tag and Xing/Info/VBRI metadata frames are dropped, otherwise the
// first clip's frame count would make players report (and stop at) that
// clip's length.

var mp3BitratesV1L3 = [16]int{0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0}
var mp3BitratesV2L3 = [16]int{0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0}

var mp3SampleRates = map[int][3]int{
	3: {44100, 48000, 32000}, // MPEG 1
	2: {22050, 24000, 16000}, // MPEG 2
	0: {11025, 12000, 8000},  // MPEG 2.5
}

type mp3FrameHeader struct {
	raw             [4]byte
	version         int // 3 = MPEG1, 2 = MPEG2, 0 = MPEG2.5
	hasCRC          bool
	sampleRate      int
	samplesPerFrame int
	mono            bool
	length          int
}

func parseMP3FrameHeader(b []byte) (mp3FrameHeader, bool) {
	var h mp3FrameHeader
	if len(b) < 4 || b[0] != 0xFF || b[1]&0xE0 != 0xE0 {
		return h, false
	}
	h.version = int(b[1]>>3) & 3
	layer := int(b[1]>>1) & 3
	if h.version == 1 || layer != 1 { // reserved version, or not Layer III
		return h, false
	}
	bitrateIdx := int(b[2] >> 4)
	srIdx := int(b[2]>>2) & 3
	if srIdx == 3 {
		return h, false
	}
	var bitrate int
	if h.version == 3 {
		bitrate = mp3BitratesV1L3[bitrateIdx]
	} else {
		bitrate = mp3BitratesV2L3[bitrateIdx]
	}
	if bitrate == 0 { // free-format or invalid
		return h, false
	}
	copy(h.raw[:], b[:4])
	h.hasCRC = b[1]&1 == 0
	h.sampleRate = mp3SampleRates[h.version][srIdx]
	h.mono = b[3]>>6 == 3
	padding := int(b[2]>>1) & 1
	if h.version == 3 {
		h.samplesPerFrame = 1152
		h.length = 144*bitrate*1000/h.sampleRate + padding
	} else {
		h.samplesPerFrame = 576
		h.length = 72*bitrate*1000/h.sampleRate + padding
	}
	return h, true
}

func (h mp3FrameHeader) sideInfoSize() int {
	switch {
	case h.version == 3 && h.mono:
		return 17
	case h.version == 3:
		return 32
	case h.mono:
		return 9
	default:
		return 17
	}
}

// isMetadataFrame reports whether a frame carries a Xing/Info or VBRI header
// instead of audio.
func (h mp3FrameHeader) isMetadataFrame(frame []byte) bool {
	off := 4 + h.sideInfoSize()
	if h.hasCRC {
		off += 2
	}
	if off+4 <= len(frame) {
		tag := string(frame[off : off+4])
		if tag == "Xing" || tag == "Info" {
			return true
		}
	}
	return len(frame) >= 40 && string(frame[36:40]) == "VBRI"
}

// mp3Clip is one decoded-free MP3 stream reduced to its audio frames.
type mp3Clip struct {
	frames     []byte
	frameCount int
	first      mp3FrameHeader
}

func (c *mp3Clip) duration() time.Duration {
	samples := c.frameCount * c.first.samplesPerFrame
	return time.Duration(float64(samples) / float64(c.first.sampleRate) * float64(time.Second))
}

func skipID3v2(data []byte) int {
	if len(data) < 10 || string(data[:3]) != "ID3" {
		return 0
	}
	size := int(data[6]&0x7F)<<21 | int(data[7]&0x7F)<<14 | int(data[8]&0x7F)<<7 | int(data[9]&0x7F)
	size += 10
	if data[5]&0x10 != 0 { // footer present
		size += 10
	}
	if size > len(data) {
		return len(data)
	}
	return size
}

// parseMP3 extracts the audio frames of an MP3 file, dropping ID3 tags,
// Xing/Info/VBRI frames and any junk between frames.
func parseMP3(data []byte) (*mp3Clip, error) {
	pos := skipID3v2(data)
	end := len(data)
	if end-pos >= 128 && string(data[end-128:end-125]) == "TAG" {
		end -= 128
	}

	clip := &mp3Clip{}
	var out bytes.Buffer
	for pos+4 <= end {
		h, ok := parseMP3FrameHeader(data[pos:end])
		// A lone sync word inside junk is common; only trust a header whose
		// frame ends exactly at EOF or is followed by another frame header.
		if ok && pos+h.length <= end {
			next := pos + h.length
			if next+4 <= end {
				if _, nextOK := parseMP3FrameHeader(data[next:end]); !nextOK && clip.frameCount == 0 {
					ok = false
				}
			}
		} else {
			ok = false
		}
		if !ok {
			pos++
			continue
		}
		frame := data[pos : pos+h.length]
		pos += h.length
		if h.isMetadataFrame(frame) {
			continue
		}
		if clip.frameCount == 0 {
			clip.first = h
		} else if h.sampleRate != clip.first.sampleRate || h.version != clip.first.version {
			return nil, fmt.Errorf("mp3: sample rate changes mid-stream (%d -> %d Hz)", clip.first.sampleRate, h.sampleRate)
		}
		out.Write(frame)
		clip.frameCount++
	}
	if clip.frameCount == 0 {
		return nil, fmt.Errorf("mp3: no audio frames found")
	}
	clip.frames = out.Bytes()
	return clip, nil
}

// mp3Builder concatenates clips and silence into one MP3 stream.
type mp3Builder struct {
	buf          bytes.Buffer
	format       mp3FrameHeader
	silentFrame  []byte
	totalSamples int
}

// newMP3Builder creates a builder whose output format (and silence) follows
// the given reference clip.
func newMP3Builder(reference *mp3Clip) *mp3Builder {
	h := reference.first
	// Silence: same header without CRC and padding, then all-zero side info
	// and main data. part2_3_length = 0 means no Huffman data, so every
	// spectral value decodes to zero.
	hdr := h.raw
	hdr[1] |= 0x01  // protection bit set: no CRC
	hdr[2] &^= 0x02 // no padding
	silent, _ := parseMP3FrameHeader(hdr[:])
	frame := make([]byte, silent.length)
	copy(frame, hdr[:])
	return &mp3Builder{format: h, silentFrame: frame}
}

func (b *mp3Builder) addClip(c *mp3Clip) error {
	if c.first.sampleRate != b.format.sampleRate || c.first.version != b.format.version {
		return fmt.Errorf("mp3: clip sample rate %d Hz does not match episode %d Hz", c.first.sampleRate, b.format.sampleRate)
	}
	b.buf.Write(c.frames)
	b.totalSamples += c.frameCount * c.first.samplesPerFrame
	return nil
}

func (b *mp3Builder) addSilence(d time.Duration) {
	if d <= 0 {
		return
	}
	frames := int(math.Round(d.Seconds() * float64(b.format.sampleRate) / float64(b.format.samplesPerFrame)))
	for i := 0; i < frames; i++ {
		b.buf.Write(b.silentFrame)
	}
	b.totalSamples += frames * b.format.samplesPerFrame
}

func (b *mp3Builder) duration() time.Duration {
	return time.Duration(float64(b.totalSamples) / float64(b.format.sampleRate) * float64(time.Second))
}

func (b *mp3Builder) bytes() []byte {
	return b.buf.Bytes()
}
