package app

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"golang.org/x/time/rate"
)

type TTSRequest struct {
	Text string `json:"text"`
}

// ttsMaxTextRunes caps text synthesized on a cache miss; legitimate payloads
// are single words or one exercise sentence.
// ponytail: the bead's default 300, not yet checked against the longest
// correct_german_sentence in the prod DB; raise it if prod has longer ones.
const ttsMaxTextRunes = 300

// TTS miss admission buckets: per client, all guests together, server-wide.
// ponytail: request count x rune cap, not character-weighted; no singleflight
// for identical concurrent misses. Tune from ElevenLabs usage logs.
var (
	ttsClientRate  = rate.Every(3 * time.Second)
	ttsClientBurst = 40
	ttsGuestsRate  = rate.Every(2 * time.Second)
	ttsGuestsBurst = 60
	ttsAllRate     = rate.Every(time.Second)
	ttsAllBurst    = 120
)

// allowTTSMiss spends one token from every bucket that applies to r, or none,
// and otherwise returns how long to wait.
func (a *App) allowTTSMiss(r *http.Request) (bool, time.Duration) {
	buckets := []*rate.Limiter{
		a.limits.get("tts:"+limitKey(r), ttsClientRate, ttsClientBurst),
		a.limits.get("tts:all", ttsAllRate, ttsAllBurst),
	}
	if getUserIDFromRequest(r) == "" {
		buckets = append(buckets, a.limits.get("tts:guests", ttsGuestsRate, ttsGuestsBurst))
	}
	now := time.Now()
	reservations := make([]*rate.Reservation, len(buckets))
	var wait time.Duration
	for i, b := range buckets {
		reservations[i] = b.ReserveN(now, 1)
		if d := reservations[i].DelayFrom(now); d > wait {
			wait = d
		}
	}
	if wait > 0 {
		for _, res := range reservations {
			res.CancelAt(now)
		}
		return false, wait
	}
	return true, 0
}

func (a *App) handleTTS(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, 4<<10)
	var req TTSRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			http.Error(w, "Request body too large", http.StatusRequestEntityTooLarge)
			return
		}
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if req.Text == "" {
		http.Error(w, "Text is required", http.StatusBadRequest)
		return
	}

	// A cache hit costs nothing: served with no length cap and no token, so
	// already-cached long audio keeps working.
	filename := a.ttsCachePath(req.Text, "de", a.ElevenLabs.Speed)
	if _, err := os.Stat(filename); err == nil {
		now := time.Now() // LRU eviction is by modification time
		if err := os.Chtimes(filename, now, now); err != nil {
			log.Printf("Warning: failed to update times for %s: %v", filename, err)
		}
		writeTTSFilePath(w, filename)
		return
	}

	if utf8.RuneCountInString(req.Text) > ttsMaxTextRunes {
		http.Error(w, "Text too long", http.StatusRequestEntityTooLarge)
		return
	}
	if a.ElevenLabs.APIKey == "" {
		http.Error(w, "TTS service is not configured and audio is not cached", http.StatusServiceUnavailable)
		return
	}
	if ok, wait := a.allowTTSMiss(r); !ok {
		log.Printf("[TTS] rate limited %s", limitKey(r))
		writeRetryAfter(w, wait)
		http.Error(w, "Too many requests", http.StatusTooManyRequests)
		return
	}

	// generateAndSaveAudio, not ensureTTSAudio: the token admitted above pays
	// for this call even if the LRU evicted the file since the stat.
	filename, err := a.generateAndSaveAudio(r.Context(), req.Text, "de", a.ElevenLabs.Speed, filename)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	// Try to update any legacy exercises that match this text
	a.bgWG.Add(1)
	go func() {
		defer a.bgWG.Done()
		a.DB.UpdateLegacyExercisesWithAudio(req.Text, filename)
	}()

	writeTTSFilePath(w, filename)
}

func writeTTSFilePath(w http.ResponseWriter, filename string) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"filePath": filename})
}

var errTTSNotConfigured = errors.New("TTS service is not configured")

// ttsHTTPClient bounds every ElevenLabs call even when the caller's context
// has no deadline.
var ttsHTTPClient = &http.Client{Timeout: 60 * time.Second}

// ttsCachePath returns the audio cache file for text spoken in lang at speed.
// German at the configured speed keeps the historical text-only key so already
// cached exercise audio stays valid; other languages are namespaced by their
// code, and any other speed (the slow podcast German) also by the speed.
func (a *App) ttsCachePath(text, lang string, speed float64) string {
	key := text
	switch {
	case speed != a.ElevenLabs.Speed:
		key = fmt.Sprintf("%s@%g:%s", lang, speed, text)
	case lang != "de":
		key = lang + ":" + text
	}
	sum := sha256.Sum256([]byte(key))
	return fmt.Sprintf("audio_cache/%s.mp3", hex.EncodeToString(sum[:]))
}

// ensureTTSAudio returns the cached audio file for text in lang ("de" or
// "en") spoken at speed, generating it with ElevenLabs on a cache miss.
func (a *App) ensureTTSAudio(ctx context.Context, text, lang string, speed float64) (string, error) {
	filename := a.ttsCachePath(text, lang, speed)
	if _, err := os.Stat(filename); err == nil {
		log.Printf("Using cached audio file: %s", filename)
		// Update modification time for LRU eviction logic
		now := time.Now()
		if err := os.Chtimes(filename, now, now); err != nil {
			log.Printf("Warning: failed to update times for %s: %v", filename, err)
		}
		return filename, nil
	}
	return a.generateAndSaveAudio(ctx, text, lang, speed, filename)
}

func (a *App) generateAndSaveAudio(ctx context.Context, text, lang string, speed float64, filename string) (string, error) {
	if a.ElevenLabs.APIKey == "" {
		return "", errTTSNotConfigured
	}

	log.Printf("Generating new %s audio file (speed %g) for text: %s", lang, speed, text)

	voiceID := a.cachedVoiceID(ctx)

	apiURL := fmt.Sprintf("https://api.elevenlabs.io/v1/text-to-speech/%s", voiceID)

	requestBody, err := json.Marshal(map[string]interface{}{
		"text":          text,
		"model_id":      a.ElevenLabs.ModelID,
		"language_code": lang,
		"voice_settings": map[string]interface{}{
			"stability":         0.5,
			"similarity_boost":  0.75,
			"style":             0.0,
			"use_speaker_boost": true,
			"speed":             speed,
		},
	})
	if err != nil {
		return "", fmt.Errorf("failed to create request body for ElevenLabs: %w", err)
	}

	apiReq, err := http.NewRequestWithContext(ctx, "POST", apiURL, bytes.NewBuffer(requestBody))
	if err != nil {
		return "", fmt.Errorf("failed to create API request for ElevenLabs: %w", err)
	}

	apiReq.Header.Set("Content-Type", "application/json")
	apiReq.Header.Set("xi-api-key", a.ElevenLabs.APIKey)
	apiReq.Header.Set("Accept", "audio/mpeg")

	resp, err := ttsHTTPClient.Do(apiReq)
	if err != nil {
		return "", fmt.Errorf("failed to call ElevenLabs API: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		bodyBytes, _ := io.ReadAll(resp.Body)
		log.Printf("ElevenLabs API Error: %s - %s", resp.Status, string(bodyBytes))
		return "", fmt.Errorf("ElevenLabs API error: %s", resp.Status)
	}

	// Write to a temp file and rename, so a concurrent reader (the podcast
	// builder fetches clips in parallel) never sees a half-written file.
	outFile, err := os.CreateTemp(filepath.Dir(filename), ".tts-*.tmp")
	if err != nil {
		return "", fmt.Errorf("failed to create audio file: %w", err)
	}
	tmpName := outFile.Name()
	_, err = io.Copy(outFile, resp.Body)
	if closeErr := outFile.Close(); err == nil {
		err = closeErr
	}
	if err != nil {
		os.Remove(tmpName)
		return "", fmt.Errorf("failed to save audio file: %w", err)
	}
	if err := os.Rename(tmpName, filename); err != nil {
		os.Remove(tmpName)
		return "", fmt.Errorf("failed to save audio file: %w", err)
	}

	log.Printf("Successfully created audio file: %s", filename)
	return filename, nil
}

// cachedVoiceID resolves the configured voice name once and reuses the ID, so
// a podcast with dozens of new clips does not list voices for each of them.
func (a *App) cachedVoiceID(ctx context.Context) string {
	a.voiceMu.Lock()
	defer a.voiceMu.Unlock()
	if a.voiceID != "" {
		return a.voiceID
	}
	voiceID, err := a.getVoiceIDByName(ctx, a.ElevenLabs.VoiceName)
	if err != nil {
		log.Printf("Failed to get voice ID for '%s': %v. Using default voice.", a.ElevenLabs.VoiceName, err)
		return "21m00Tcm4TlvDq8ikWAM" // Default voice ID for "Rachel"
	}
	a.voiceID = voiceID
	return voiceID
}

func (a *App) getVoiceIDByName(ctx context.Context, voiceName string) (string, error) {
	apiURL := "https://api.elevenlabs.io/v1/voices"

	req, err := http.NewRequestWithContext(ctx, "GET", apiURL, nil)
	if err != nil {
		return "", fmt.Errorf("failed to create request: %v", err)
	}

	req.Header.Set("xi-api-key", a.ElevenLabs.APIKey)
	req.Header.Set("Accept", "application/json")

	resp, err := ttsHTTPClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("failed to call ElevenLabs API: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		bodyBytes, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("ElevenLabs API error: %s - %s", resp.Status, string(bodyBytes))
	}

	var voicesResponse struct {
		Voices []struct {
			VoiceID string `json:"voice_id"`
			Name    string `json:"name"`
		} `json:"voices"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&voicesResponse); err != nil {
		return "", fmt.Errorf("failed to decode response: %v", err)
	}

	for _, voice := range voicesResponse.Voices {
		if strings.EqualFold(voice.Name, voiceName) {
			return voice.VoiceID, nil
		}
	}

	return "", fmt.Errorf("voice '%s' not found", voiceName)
}

// ttsClipName matches exactly the file names ttsCachePath produces.
var ttsClipName = regexp.MustCompile(`^[0-9a-f]{64}\.mp3$`)

// handleAudioCache serves cached TTS clips by name only. A plain FileServer
// would list the directory, including the podcasts/ subtree (whose episode
// ids are bearer secrets) and in-flight .tts-*.tmp files.
func (a *App) handleAudioCache(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	name := strings.TrimPrefix(r.URL.Path, "/audio_cache/")
	if !ttsClipName.MatchString(name) {
		http.NotFound(w, r)
		return
	}
	path := filepath.Join("audio_cache", name)
	if fi, err := os.Stat(path); err != nil || !fi.Mode().IsRegular() {
		http.NotFound(w, r)
		return
	}
	http.ServeFile(w, r, path)
}
