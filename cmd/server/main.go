package main

import (
	"log"
	"net/http"
	"os"
	"strconv"

	"german-conjunctions-trainer/internal/app"
	"german-conjunctions-trainer/pkg/storage"

	"golang.org/x/oauth2"
	"golang.org/x/oauth2/google"
)

func init() {
	if err := os.MkdirAll("audio_cache", os.ModePerm); err != nil {
		log.Fatalf("Failed to create audio_cache directory: %v", err)
	}
}

func main() {
	dbPath := os.Getenv("SQLITE_PATH")
	if dbPath == "" {
		dbPath = "german.db"
	}
	db, err := storage.NewSQLiteStorage(dbPath)
	if err != nil {
		log.Fatalf("Failed to initialize SQLite storage: %v", err)
	}
	storage.DB = db

	// OAuth
	var oauthConfig *oauth2.Config
	clientID := os.Getenv("GOOGLE_CLIENT_ID")
	clientSecret := os.Getenv("GOOGLE_CLIENT_SECRET")
	redirectURL := os.Getenv("GOOGLE_REDIRECT_URL")
	adminGoogleID := os.Getenv("GOOGLE_ADMIN_ID")
	if clientID == "" || clientSecret == "" || redirectURL == "" {
		log.Println("Warning: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, or GOOGLE_REDIRECT_URL not set. Google login will be disabled.")
	} else {
		oauthConfig = &oauth2.Config{
			RedirectURL:  redirectURL,
			ClientID:     clientID,
			ClientSecret: clientSecret,
			Scopes:       []string{"https://www.googleapis.com/auth/userinfo.email", "https://www.googleapis.com/auth/userinfo.profile"},
			Endpoint:     google.Endpoint,
		}
		log.Println("Google OAuth initialized.")
		if adminGoogleID == "" {
			log.Println("Warning: GOOGLE_ADMIN_ID not set. Admin features will be disabled.")
		} else {
			log.Println("Google Admin ID configured.")
		}
	}

	// SecureCookie
	sc, err := app.NewSecureCookie(oauthConfig != nil, os.Getenv("COOKIE_HASH_KEY"), os.Getenv("COOKIE_BLOCK_KEY"))
	if err != nil {
		log.Fatalf("Error: %v", err)
	}

	// ElevenLabs
	var el app.ElevenLabsConfig
	el.APIKey = os.Getenv("ELEVENLABS_API_KEY")
	el.VoiceName = os.Getenv("ELEVENLABS_VOICE_NAME")
	if el.APIKey == "" {
		log.Println("Warning: ELEVENLABS_API_KEY not set. TTS functionality will be disabled.")
	} else {
		if el.VoiceName == "" {
			el.VoiceName = "Rachel"
			log.Println("ELEVENLABS_VOICE_NAME not set. Using default voice: Rachel")
		}
		el.ModelID = os.Getenv("ELEVENLABS_MODEL_ID")
		if el.ModelID == "" {
			el.ModelID = "eleven_multilingual_v2"
			log.Println("ELEVENLABS_MODEL_ID not set. Using default model: eleven_multilingual_v2")
		}
		voiceSpeedStr := os.Getenv("ELEVENLABS_VOICE_SPEED")
		if voiceSpeedStr == "" {
			el.Speed = 1.0
			log.Println("ELEVENLABS_VOICE_SPEED not set. Using default speed: 1.0")
		} else {
			speed, err := strconv.ParseFloat(voiceSpeedStr, 64)
			if err != nil {
				el.Speed = 1.0
				log.Printf("Invalid ELEVENLABS_VOICE_SPEED value: '%s'. Using default speed: 1.0", voiceSpeedStr)
			} else {
				el.Speed = speed
			}
		}
		if v := os.Getenv("PODCAST_DE_SPEED"); v != "" {
			speed, err := strconv.ParseFloat(v, 64)
			if err != nil {
				log.Printf("Invalid PODCAST_DE_SPEED value: '%s'. Using default.", v)
			}
			el.PodcastDESpeed = speed // 0 on error = default; clamped in app
		}
		el.OriginalLanguageVoiceID = os.Getenv("ELEVENLABS_ORIGINAL_LANGUAGE_VOICE_ID")
		log.Printf("ElevenLabs integration enabled with voice: %s, model: %s, speed: %.1f", el.VoiceName, el.ModelID, el.Speed)
		if el.OriginalLanguageVoiceID != "" {
			log.Printf("English (original language) clips use voice ID: %s", el.OriginalLanguageVoiceID)
		}
	}

	// CORS
	corsAllowedOrigins := os.Getenv("CORS_ALLOWED_ORIGINS")
	if corsAllowedOrigins == "" {
		log.Println("Warning: CORS_ALLOWED_ORIGINS not set. Using wildcard (*) for development. Set this environment variable in production.")
	} else {
		log.Printf("CORS allowed origins configured: %s", corsAllowedOrigins)
	}

	cacheSizeStr := os.Getenv("AUDIO_CACHE_MAX_SIZE_MB")
	if cacheSizeStr == "" {
		el.AudioCacheMaxSizeMB = 2048 // Default 2GB
	} else {
		size, err := strconv.ParseInt(cacheSizeStr, 10, 64)
		if err != nil || size <= 0 {
			el.AudioCacheMaxSizeMB = 2048
			log.Printf("Invalid AUDIO_CACHE_MAX_SIZE_MB value: '%s'. Using default: 2048 MB", cacheSizeStr)
		} else {
			el.AudioCacheMaxSizeMB = size
		}
	}
	log.Printf("Audio cache max size set to %d MB", el.AudioCacheMaxSizeMB)

	db.InitializeDefaultTopics()

	a := app.New(db, sc, oauthConfig, adminGoogleID, el, corsAllowedOrigins, dbPath, "./audio_cache")
	a.CLIGoogleClientID = os.Getenv("GCT_GOOGLE_CLIENT_ID")
	if a.CLIGoogleClientID == "" {
		log.Println("Warning: GCT_GOOGLE_CLIENT_ID not set. CLI login (POST /api/auth/cli-exchange) will be disabled.")
	}
	// Absolute URLs in the podcast RSS feed; never derived from the Host header.
	a.PublicBaseURL = app.PublicOrigin(os.Getenv("PUBLIC_BASE_URL"))
	if a.PublicBaseURL == "" {
		a.PublicBaseURL = app.PublicOrigin(redirectURL)
	}
	if a.PublicBaseURL == "" {
		log.Println("Warning: PUBLIC_BASE_URL not set and no GOOGLE_REDIRECT_URL to derive it from. Podcast RSS feed will be disabled.")
	} else {
		log.Printf("Public base URL: %s", a.PublicBaseURL)
	}
	a.RegisterRoutes()

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}
	log.Printf("Server starting on port %s", port)
	log.Fatal(http.ListenAndServe(":"+port, nil))
}
