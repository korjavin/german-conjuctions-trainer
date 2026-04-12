package main

import (
	"crypto/rand"
	"encoding/base64"
	"log"
	"net/http"
	"os"
	"strconv"

	"german-conjunctions-trainer/internal/app"
	"german-conjunctions-trainer/pkg/storage"

	"github.com/gorilla/securecookie"
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
	var oauthState string
	clientID := os.Getenv("GOOGLE_CLIENT_ID")
	clientSecret := os.Getenv("GOOGLE_CLIENT_SECRET")
	redirectURL := os.Getenv("GOOGLE_REDIRECT_URL")
	adminGoogleID := os.Getenv("GOOGLE_ADMIN_ID")
	if clientID == "" || clientSecret == "" || redirectURL == "" {
		log.Println("Warning: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, or GOOGLE_REDIRECT_URL not set. Google login will be disabled.")
	} else {
		b := make([]byte, 16)
		if _, err := rand.Read(b); err != nil {
			log.Fatalf("Failed to generate OAuth state: %v", err)
		}
		oauthState = base64.URLEncoding.EncodeToString(b)
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
	hashKey := os.Getenv("COOKIE_HASH_KEY")
	blockKey := os.Getenv("COOKIE_BLOCK_KEY")
	var sc *securecookie.SecureCookie
	if hashKey == "" || blockKey == "" {
		log.Println("Warning: COOKIE_HASH_KEY or COOKIE_BLOCK_KEY not set. Generating random keys for this session.")
		sc = securecookie.New(securecookie.GenerateRandomKey(64), securecookie.GenerateRandomKey(32))
	} else {
		if len(blockKey) != 32 {
			log.Fatalf("Error: COOKIE_BLOCK_KEY must be 32 bytes long for AES-256. Got %d bytes.", len(blockKey))
		}
		sc = securecookie.New([]byte(hashKey), []byte(blockKey))
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
		log.Printf("ElevenLabs integration enabled with voice: %s, model: %s, speed: %.1f", el.VoiceName, el.ModelID, el.Speed)
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

	a := app.New(db, sc, oauthConfig, oauthState, adminGoogleID, el, corsAllowedOrigins, dbPath, "./audio_cache")
	a.RegisterRoutes()

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}
	log.Printf("Server starting on port %s", port)
	log.Fatal(http.ListenAndServe(":"+port, nil))
}
