package app

import (
	"net/http"
	"strings"
	"sync"
	"time"

	"german-conjunctions-trainer/pkg/storage"

	"github.com/gorilla/securecookie"
	"golang.org/x/oauth2"
)

// App holds all application dependencies.
type App struct {
	DB                 storage.Storage
	SC                 *securecookie.SecureCookie
	OAuthConfig        *oauth2.Config
	OAuthState         string
	AdminGoogleID      string
	ElevenLabs         ElevenLabsConfig
	CORSAllowedOrigins string
	DBPath             string
	AudioCacheDir      string
	// UserInfo is the Google userinfo fetcher used by the CLI exchange handler.
	// Defaulted to a real google.golang.org/api/oauth2/v2 client in New(); tests
	// inject a fake to avoid hitting Google. The userinfo URL is hardcoded
	// inside the oauth2v2 SDK, so this interface seam is the only practical way
	// to test the handler in isolation.
	UserInfo           UserInfoFetcher
	clients            map[string]*rateclient
	mu                 sync.Mutex
	shutdown           chan struct{} // Channel to signal goroutine shutdown
}

// ElevenLabsConfig holds ElevenLabs TTS configuration.
type ElevenLabsConfig struct {
	APIKey              string
	VoiceName           string
	ModelID             string
	Speed               float64
	AudioCacheMaxSizeMB int64
}

// getCORSOrigin returns the appropriate CORS origin for the request.
// If CORSAllowedOrigins is empty or "*", it returns "*" (allow all).
// Otherwise, it checks if the request's Origin is in the comma-separated list
// and returns that origin. If no match, it returns an empty string (no CORS).
func (a *App) getCORSOrigin(r *http.Request) string {
	if a.CORSAllowedOrigins == "" || a.CORSAllowedOrigins == "*" {
		return "*"
	}

	// Parse comma-separated origins and check if request Origin matches any
	origin := r.Header.Get("Origin")
	if origin == "" {
		return "*" // If no Origin header, allow all (same-site requests)
	}

	allowedOrigins := strings.Split(a.CORSAllowedOrigins, ",")
	for _, allowed := range allowedOrigins {
		if strings.TrimSpace(allowed) == origin {
			return origin
		}
	}

	// Origin not in allowlist - return empty string to deny
	return ""
}

// New creates a new App and starts background maintenance tasks.
func New(db storage.Storage, sc *securecookie.SecureCookie, oauthConfig *oauth2.Config, oauthState string, adminGoogleID string, el ElevenLabsConfig, corsAllowedOrigins string, dbPath string, audioCacheDir string) *App {
	a := &App{
		DB:                 db,
		SC:                 sc,
		OAuthConfig:        oauthConfig,
		OAuthState:         oauthState,
		AdminGoogleID:      adminGoogleID,
		ElevenLabs:         el,
		CORSAllowedOrigins: corsAllowedOrigins,
		DBPath:             dbPath,
		AudioCacheDir:      audioCacheDir,
		UserInfo:           googleUserInfoFetcher{},
		clients:            make(map[string]*rateclient),
		shutdown:           make(chan struct{}),
	}

	// Cleanup stale rate-limit client entries every 10 minutes.
	go func() {
		ticker := time.NewTicker(10 * time.Minute)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				a.mu.Lock()
				for ip, c := range a.clients {
					if time.Since(c.lastSeen) > 30*time.Minute {
						delete(a.clients, ip)
					}
				}
				a.mu.Unlock()
			case <-a.shutdown:
				return // Exit goroutine on shutdown signal
			}
		}
	}()

	// Backfill key terms for existing topics that don't have them yet
	go a.backfillKeyTerms()

	// Start background job to manage audio_cache size
	if a.ElevenLabs.AudioCacheMaxSizeMB > 0 {
		go func() {
			for {
				time.Sleep(10 * time.Minute)
				a.cleanupAudioCache()
			}
		}()
	}

	return a
}

// Shutdown gracefully stops background goroutines.
func (a *App) Shutdown() {
	close(a.shutdown)
}

// RegisterRoutes registers all HTTP routes on the default mux.
func (a *App) RegisterRoutes() {
	http.HandleFunc("/", a.handleIndex)
	http.HandleFunc("/app.js", a.handleJS)
	http.HandleFunc("/style.css", a.handleCSS)
	http.HandleFunc("/privacy.html", a.handlePrivacy)
	http.HandleFunc("/favicon.svg", a.handleFavicon)
	http.HandleFunc("/favicon-32x32.svg", a.handleFavicon32)
	http.HandleFunc("/favicon.ico", a.handleFaviconICO)

	http.HandleFunc("/api/exercises", a.withOptionalAuth(a.handleExercises))
	http.HandleFunc("/api/exercises/complete", a.withAuth(a.handleExercisesComplete))
	http.HandleFunc("/api/exercises/favorite", a.withAuth(a.handleExerciseFavorite))
	http.HandleFunc("/api/exercises/hide", a.withAuth(a.handleExerciseHide))
	http.HandleFunc("/api/exercises/history", a.withAuth(a.handleExerciseHistory))
	http.HandleFunc("/api/explain", a.withOptionalAuth(a.handleExplain))
	http.HandleFunc("/api/topics", a.withOptionalAuth(a.handleTopics))
	http.HandleFunc("/api/topics/", a.withOptionalAuth(a.handleTopicByID))
	http.HandleFunc("/api/versions/", a.withOptionalAuth(a.handleVersions))
	http.HandleFunc("/api/last-refined-prompt", a.handleGetLastRefinedPrompt)
	http.HandleFunc("/api/last-generation-debug", a.handleGetLastGenerationDebug)

	http.HandleFunc("/auth/google/login", a.handleGoogleLogin)
	http.HandleFunc("/auth/google/callback", a.handleGoogleCallback)
	http.HandleFunc("/api/auth/status", a.handleAuthStatus)
	http.HandleFunc("/auth/logout", a.handleLogout)
	http.HandleFunc("/api/auth/is_admin", a.withOptionalAuth(a.handleIsAdmin))
	http.HandleFunc("/api/auth/cli-exchange", a.handleCLIExchange)

	http.HandleFunc("/api/user/stats", a.withAuth(a.handleUserStats))
	http.HandleFunc("/api/user/settings", a.withAuth(a.handleUserSettings))
	http.HandleFunc("/api/user/exercisestats", a.withAuth(a.handleUserExerciseStats))

	http.HandleFunc("/api/db/stats", a.withAuth(a.adminOnly(a.handleDatabaseStats)))

	http.HandleFunc("/api/tts", a.handleTTS)
	http.Handle("/audio_cache/", http.StripPrefix("/audio_cache/", http.FileServer(http.Dir("./audio_cache"))))
	http.Handle("/js/", http.StripPrefix("/js/", http.FileServer(http.Dir(getJSDir()))))

	http.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("OK"))
	})
}
