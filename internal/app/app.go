package app

import (
	"net/http"
	"sync"
	"time"

	"german-conjunctions-trainer/pkg/storage"

	"github.com/gorilla/securecookie"
	"golang.org/x/oauth2"
)

// App holds all application dependencies.
type App struct {
	DB            storage.Storage
	SC            *securecookie.SecureCookie
	OAuthConfig   *oauth2.Config
	OAuthState    string
	AdminGoogleID string
	ElevenLabs    ElevenLabsConfig
	clients       map[string]*rateclient
	mu            sync.Mutex
}

// ElevenLabsConfig holds ElevenLabs TTS configuration.
type ElevenLabsConfig struct {
	APIKey    string
	VoiceName string
	ModelID   string
	Speed     float64
}

// New creates a new App and starts background maintenance tasks.
func New(db storage.Storage, sc *securecookie.SecureCookie, oauthConfig *oauth2.Config, oauthState string, adminGoogleID string, el ElevenLabsConfig) *App {
	a := &App{
		DB:            db,
		SC:            sc,
		OAuthConfig:   oauthConfig,
		OAuthState:    oauthState,
		AdminGoogleID: adminGoogleID,
		ElevenLabs:    el,
		clients:       make(map[string]*rateclient),
	}

	// Cleanup stale rate-limit client entries every 10 minutes.
	go func() {
		for {
			time.Sleep(10 * time.Minute)
			a.mu.Lock()
			for ip, c := range a.clients {
				if time.Since(c.lastSeen) > 30*time.Minute {
					delete(a.clients, ip)
				}
			}
			a.mu.Unlock()
		}
	}()

	return a
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

	http.HandleFunc("/api/user/stats", a.withAuth(a.handleUserStats))
	http.HandleFunc("/api/user/settings", a.withAuth(a.handleUserSettings))
	http.HandleFunc("/api/user/exercisestats", a.withAuth(a.handleUserExerciseStats))

	http.HandleFunc("/api/tts", a.handleTTS)
	http.Handle("/audio_cache/", http.StripPrefix("/audio_cache/", http.FileServer(http.Dir("./audio_cache"))))

	http.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("OK"))
	})
}
