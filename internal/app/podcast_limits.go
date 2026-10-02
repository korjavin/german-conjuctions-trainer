package app

import (
	"math"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"sync"
	"time"

	"golang.org/x/time/rate"
)

// Podcast builds are the most expensive request the app serves: up to three
// LLM generation rounds plus ~50 paid TTS clips. They are bounded three ways:
//
//   - at most podcastMaxConcurrentBuilds run at once server-wide; extra
//     requests get 429 right away instead of queueing;
//   - each client has a token bucket (per user, or per IP for guests), and
//     all guests together share one more bucket, so rotating IPs does not
//     buy unlimited builds;
//   - a build has a deadline, and TTS calls honor it (and a client that
//     disconnects), so a stalled build gives its slot back.
//
// Episodes live in their own store, outside the TTS LRU cache: a link stays
// valid for podcastMaxAge, and when the store is full new builds are refused
// rather than evicting episodes whose links were already handed out.

const (
	podcastMaxConcurrentBuilds = 2
	podcastBuildTimeout        = 4 * time.Minute
	podcastTTSTimeout          = 45 * time.Second
	podcastStoreMaxBytes       = 1 << 30 // 1 GiB ≈ 100 episodes
	// podcastEstimatedBytes is a generous size of one episode, used to refuse
	// a build up front when the store cannot take it.
	podcastEstimatedBytes = 16 << 20
)

var (
	podcastUserRate       = rate.Every(6 * time.Minute) // 10 per hour
	podcastUserBurst      = 3
	podcastGuestRate      = rate.Every(15 * time.Minute) // 4 per hour per IP
	podcastGuestBurst     = 2
	podcastAllGuestsRate  = rate.Every(3 * time.Minute) // 20 per hour for all guests
	podcastAllGuestsBurst = 5
)

// podcastLimits holds the build guards. Zero-value overrides mean defaults;
// tests set them to exercise the limits quickly.
type podcastLimits struct {
	once      sync.Once
	slots     chan struct{}
	allGuests *rate.Limiter

	clients keyedLimiters

	maxConcurrent int
	buildTimeout  time.Duration
	storeMaxBytes int64
}

func (l *podcastLimits) init() {
	l.once.Do(func() {
		n := l.maxConcurrent
		if n <= 0 {
			n = podcastMaxConcurrentBuilds
		}
		l.slots = make(chan struct{}, n)
		l.allGuests = rate.NewLimiter(podcastAllGuestsRate, podcastAllGuestsBurst)
	})
}

// tryAcquireSlot takes a build slot without waiting.
func (l *podcastLimits) tryAcquireSlot() bool {
	l.init()
	select {
	case l.slots <- struct{}{}:
		return true
	default:
		return false
	}
}

func (l *podcastLimits) releaseSlot() { <-l.slots }

// inFlight reports how many builds hold a slot.
func (l *podcastLimits) inFlight() int {
	l.init()
	return len(l.slots)
}

func (l *podcastLimits) timeout() time.Duration {
	if l.buildTimeout > 0 {
		return l.buildTimeout
	}
	return podcastBuildTimeout
}

func (l *podcastLimits) maxStoreBytes() int64 {
	if l.storeMaxBytes > 0 {
		return l.storeMaxBytes
	}
	return podcastStoreMaxBytes
}

// allowBuild spends one build token for the client, or returns how long to
// wait. Tokens are only spent when every applicable bucket has one.
func (l *podcastLimits) allowBuild(userID string, r *http.Request) (bool, time.Duration) {
	l.init()
	var wait time.Duration
	if userID != "" {
		wait = reserveAll(l.clients.get("user:"+userID, podcastUserRate, podcastUserBurst))
	} else {
		wait = reserveAll(l.clients.get("ip:"+clientIP(r), podcastGuestRate, podcastGuestBurst), l.allGuests)
	}
	return wait == 0, wait
}

func writeRetryAfter(w http.ResponseWriter, wait time.Duration) {
	w.Header().Set("Retry-After", strconv.Itoa(int(math.Ceil(wait.Seconds()))))
}

// podcastStoreSize prunes expired episodes and returns the bytes still held.
func podcastStoreSize() int64 {
	entries, err := os.ReadDir(podcastDir)
	if err != nil {
		return 0
	}
	var total int64
	for _, e := range entries {
		info, err := e.Info()
		if err != nil || info.IsDir() {
			continue
		}
		if time.Since(info.ModTime()) > podcastMaxAge {
			os.Remove(filepath.Join(podcastDir, e.Name()))
			continue
		}
		total += info.Size()
	}
	return total
}

// podcastExpiry is when an episode's link stops working.
func podcastExpiry(created time.Time) time.Time {
	return created.Add(podcastMaxAge)
}
