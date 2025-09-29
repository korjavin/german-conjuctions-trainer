package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	mrand "math/rand"
	"net"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"german-conjunctions-trainer/pkg/llm"
	"german-conjunctions-trainer/pkg/storage"

	"github.com/gorilla/securecookie"
	"golang.org/x/oauth2"
	"golang.org/x/oauth2/google"
	oauth2v2 "google.golang.org/api/oauth2/v2"
	"golang.org/x/time/rate"
)

// contextKey defines a type for context keys to avoid collisions.
type contextKey string

const userContextKey = contextKey("userID")
const cookieName = "user-session"

type TTSRequest struct {
	Text string `json:"text"`
}

type UpdateTopicRequest struct {
	Name   string `json:"name"`
	Prompt string `json:"prompt"`
}

type TopicRequest struct {
	Name   string `json:"name"`
	Prompt string `json:"prompt"`
}

// ElevenLabs configuration
var (
	elevenlabsAPIKey     string
	elevenlabsVoiceName  string
	elevenlabsModelID    string
	elevenlabsVoiceSpeed float64
)

// Google OAuth2 configuration
var (
	googleOauthConfig *oauth2.Config
	oauthStateString  string
	googleAdminID     string
	sc                *securecookie.SecureCookie
)

// Rate limiting
var (
	clients = make(map[string]*client)
	mu      sync.Mutex
)

type client struct {
	limiter  *rate.Limiter
	lastSeen time.Time
}

func getClientIP(r *http.Request) string {
	ip := r.Header.Get("X-Forwarded-For")
	if ip != "" {
		return ip
	}
	ip, _, _ = net.SplitHostPort(r.RemoteAddr)
	return ip
}

func initOAuth() {
	googleClientID := os.Getenv("GOOGLE_CLIENT_ID")
	googleClientSecret := os.Getenv("GOOGLE_CLIENT_SECRET")
	redirectURL := os.Getenv("GOOGLE_REDIRECT_URL")

	if googleClientID == "" || googleClientSecret == "" || redirectURL == "" {
		log.Println("Warning: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, or GOOGLE_REDIRECT_URL not set. Google login will be disabled.")
		googleOauthConfig = nil
		return
	}

	b := make([]byte, 16)
	rand.Read(b)
	oauthStateString = base64.URLEncoding.EncodeToString(b)

	googleOauthConfig = &oauth2.Config{
		RedirectURL:  redirectURL,
		ClientID:     googleClientID,
		ClientSecret: googleClientSecret,
		Scopes:       []string{"https://www.googleapis.com/auth/userinfo.email", "https://www.googleapis.com/auth/userinfo.profile"},
		Endpoint:     google.Endpoint,
	}
	log.Println("Google OAuth initialized.")

	googleAdminID = os.Getenv("GOOGLE_ADMIN_ID")
	if googleAdminID == "" {
		log.Println("Warning: GOOGLE_ADMIN_ID not set. Admin features will be disabled.")
	} else {
		log.Println("Google Admin ID configured.")
	}
}

func initSecureCookie() {
	hashKey := os.Getenv("COOKIE_HASH_KEY")
	blockKey := os.Getenv("COOKIE_BLOCK_KEY")

	if hashKey == "" || blockKey == "" {
		log.Println("Warning: COOKIE_HASH_KEY or COOKIE_BLOCK_KEY not set. Generating random keys for this session.")
		log.Println("For production, these should be set to persistent, randomly generated values.")
		sc = securecookie.New(securecookie.GenerateRandomKey(64), securecookie.GenerateRandomKey(32))
	} else {
		// Ensure keys are the correct length for AES-256
		if len(blockKey) != 32 {
			log.Fatalf("Error: COOKIE_BLOCK_KEY must be 32 bytes long for AES-256. Got %d bytes.", len(blockKey))
		}
		sc = securecookie.New([]byte(hashKey), []byte(blockKey))
	}
}

func init() {
	// Ensure the audio cache directory exists
	if err := os.MkdirAll("audio_cache", os.ModePerm); err != nil {
		log.Fatalf("Failed to create audio_cache directory: %v", err)
	}
}

func main() {
	// Initialize storage backend
	storageType := os.Getenv("STORAGE_TYPE")
	if storageType == "" {
		storageType = "sqlite" // Default to sqlite
	}

	// Initialize storage backend
	dbPath := os.Getenv("SQLITE_PATH")
	if dbPath == "" {
		dbPath = "german.db"
	}
	var err error
	storage.DB, err = storage.NewSQLiteStorage(dbPath)
	if err != nil {
		log.Fatalf("Failed to initialize SQLite storage: %v", err)
	}

	// Initialize Google OAuth
	initOAuth()

	// Initialize Secure Cookie
	initSecureCookie()

	// Initialize ElevenLabs
	elevenlabsAPIKey = os.Getenv("ELEVENLABS_API_KEY")
	elevenlabsVoiceName = os.Getenv("ELEVENLABS_VOICE_NAME")
	if elevenlabsAPIKey == "" {
		log.Println("Warning: ELEVENLABS_API_KEY not set. TTS functionality will be disabled.")
	} else {
		if elevenlabsVoiceName == "" {
			elevenlabsVoiceName = "Rachel" // Default voice name
			log.Println("ELEVENLABS_VOICE_NAME not set. Using default voice: Rachel")
		}
		elevenlabsModelID = os.Getenv("ELEVENLABS_MODEL_ID")
		if elevenlabsModelID == "" {
			elevenlabsModelID = "eleven_multilingual_v2"
			log.Println("ELEVENLABS_MODEL_ID not set. Using default model: eleven_multilingual_v2")
		}
		voiceSpeedStr := os.Getenv("ELEVENLABS_VOICE_SPEED")
		if voiceSpeedStr == "" {
			elevenlabsVoiceSpeed = 1.0
			log.Println("ELEVENLABS_VOICE_SPEED not set. Using default speed: 1.0")
		} else {
			speed, err := strconv.ParseFloat(voiceSpeedStr, 64)
			if err != nil {
				elevenlabsVoiceSpeed = 1.0
				log.Printf("Invalid ELEVENLABS_VOICE_SPEED value: '%s'. Using default speed: 1.0", voiceSpeedStr)
			} else {
				elevenlabsVoiceSpeed = speed
			}
		}
		log.Printf("ElevenLabs integration enabled with voice: %s, model: %s, speed: %.1f", elevenlabsVoiceName, elevenlabsModelID, elevenlabsVoiceSpeed)
	}

	// Initialize default topics
	storage.DB.InitializeDefaultTopics()

	// Cleanup old clients every 10 minutes
	go func() {
		for {
			time.Sleep(10 * time.Minute)
			mu.Lock()
			for ip, c := range clients {
				if time.Since(c.lastSeen) > 30*time.Minute {
					delete(clients, ip)
				}
			}
			mu.Unlock()
		}
	}()

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	// Custom handler for index.html with cache-busting
	http.HandleFunc("/", handleIndex)

	// Serve static files with cache headers
	http.HandleFunc("/app.js", handleJS)
	http.HandleFunc("/style.css", handleCSS)
	http.HandleFunc("/privacy.html", handlePrivacy)
	http.HandleFunc("/favicon.svg", handleFavicon)
	http.HandleFunc("/favicon-32x32.svg", handleFavicon32)
	http.HandleFunc("/favicon.ico", handleFaviconICO) // Fallback for older browsers

	// API endpoints
	http.HandleFunc("/api/exercises", handleExercises)
	http.HandleFunc("/api/topics", handleTopics)
	http.HandleFunc("/api/topics/", handleTopicByID)
	http.HandleFunc("/api/versions/", handleVersions)
	http.HandleFunc("/api/last-refined-prompt", handleGetLastRefinedPrompt)

	// Auth endpoints
	http.HandleFunc("/auth/google/login", handleGoogleLogin)
	http.HandleFunc("/auth/google/callback", handleGoogleCallback)
	http.HandleFunc("/api/auth/status", handleAuthStatus)
	http.HandleFunc("/auth/logout", handleLogout)
	http.HandleFunc("/api/auth/is_admin", handleIsAdmin)

	// User stats and settings endpoints (protected by withAuth middleware)
	http.HandleFunc("/api/user/stats", withAuth(handleUserStats))
	http.HandleFunc("/api/user/settings", withAuth(handleUserSettings))
	http.HandleFunc("/api/user/exercisestats", withAuth(handleUserExerciseStats))
	http.HandleFunc("/api/user/exercise/complete", withAuth(handleCompleteExercise))

	// TTS endpoint
	http.HandleFunc("/api/tts", handleTTS)

	// Audio file server
	http.Handle("/audio_cache/", http.StripPrefix("/audio_cache/", http.FileServer(http.Dir("./audio_cache"))))

	// Health check endpoint
	http.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("OK"))
	})

	log.Printf("Server starting on port %s", port)
	log.Fatal(http.ListenAndServe(":"+port, nil))
}

func getFilePath(filename string) string {
	// Check if running in Docker (files in static/ directory)
	if _, err := os.Stat("static/" + filename); err == nil {
		return "static/" + filename
	}
	// Otherwise use current directory
	return filename
}

func handleIndex(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/" {
		http.NotFound(w, r)
		return
	}

	// Read the HTML file
	filePath := getFilePath("index.html")
	content, err := os.ReadFile(filePath)
	if err != nil {
		http.Error(w, "File not found", http.StatusNotFound)
		return
	}

	// Replace the cache-busting parameter with current timestamp
	timestamp := strconv.FormatInt(time.Now().Unix(), 10)
	htmlContent := string(content)
	htmlContent = strings.ReplaceAll(htmlContent, "app.js?v=20250821001", fmt.Sprintf("app.js?v=%s", timestamp))

	// Set headers to prevent caching of the HTML file itself
	w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
	w.Header().Set("Pragma", "no-cache")
	w.Header().Set("Expires", "0")
	w.Header().Set("Content-Type", "text/html; charset=utf-8")

	w.Write([]byte(htmlContent))
}

func handleJS(w http.ResponseWriter, r *http.Request) {
	// Read the JS file
	filePath := getFilePath("app.js")
	content, err := os.ReadFile(filePath)
	if err != nil {
		http.Error(w, "File not found", http.StatusNotFound)
		return
	}

	// Set headers for JS file - allow caching but with versioning
	w.Header().Set("Content-Type", "application/javascript")
	w.Header().Set("Cache-Control", "public, max-age=31536000") // Cache for 1 year

	w.Write(content)
}

func handleCSS(w http.ResponseWriter, r *http.Request) {
	// Read the CSS file
	filePath := getFilePath("style.css")
	content, err := os.ReadFile(filePath)
	if err != nil {
		http.Error(w, "File not found", http.StatusNotFound)
		return
	}

	// Set headers for CSS file - allow caching but with versioning
	w.Header().Set("Content-Type", "text/css")
	w.Header().Set("Cache-Control", "public, max-age=31536000") // Cache for 1 year

	w.Write(content)
}

func handlePrivacy(w http.ResponseWriter, r *http.Request) {
	http.ServeFile(w, r, getFilePath("privacy.html"))
}

func handleFavicon(w http.ResponseWriter, r *http.Request) {
	// Read the SVG file
	filePath := getFilePath("favicon.svg")
	content, err := os.ReadFile(filePath)
	if err != nil {
		http.Error(w, "Favicon not found", http.StatusNotFound)
		return
	}

	// Set headers for SVG favicon - allow caching
	w.Header().Set("Content-Type", "image/svg+xml")
	w.Header().Set("Cache-Control", "public, max-age=31536000") // Cache for 1 year

	w.Write(content)
}

func handleFavicon32(w http.ResponseWriter, r *http.Request) {
	// Read the 32x32 SVG file
	filePath := getFilePath("favicon-32x32.svg")
	content, err := os.ReadFile(filePath)
	if err != nil {
		http.Error(w, "Favicon not found", http.StatusNotFound)
		return
	}

	// Set headers for SVG favicon - allow caching
	w.Header().Set("Content-Type", "image/svg+xml")
	w.Header().Set("Cache-Control", "public, max-age=31536000") // Cache for 1 year

	w.Write(content)
}

func handleFaviconICO(w http.ResponseWriter, r *http.Request) {
	// Redirect .ico requests to SVG favicon for better quality
	http.Redirect(w, r, "/favicon.svg", http.StatusMovedPermanently)
}

func generateAndSaveAudio(text string) (string, error) {
	if elevenlabsAPIKey == "" {
		return "", fmt.Errorf("TTS service is not configured")
	}

	// Generate a unique filename from the hash of the text
	hasher := sha256.New()
	hasher.Write([]byte(text))
	hash := hex.EncodeToString(hasher.Sum(nil))
	filename := fmt.Sprintf("audio_cache/%s.mp3", hash)

	// Check if the file already exists (caching)
	if _, err := os.Stat(filename); err == nil {
		log.Printf("Using cached audio file: %s", filename)
		return filename, nil
	}

	// If not cached, generate the audio
	log.Printf("Generating new audio file for text: %s", text)

	// Get voice ID by name
	voiceID, err := getVoiceIDByName(elevenlabsVoiceName)
	if err != nil {
		log.Printf("Failed to get voice ID for '%s': %v. Using default voice.", elevenlabsVoiceName, err)
		voiceID = "21m00Tcm4TlvDq8ikWAM" // Default voice ID for "Rachel"
	}

	// ElevenLabs API request
	apiURL := fmt.Sprintf("https://api.elevenlabs.io/v1/text-to-speech/%s", voiceID)

	requestBody, err := json.Marshal(map[string]interface{}{
		"text":     text,
		"model_id": elevenlabsModelID,
		"voice_settings": map[string]interface{}{
			"stability":        0.5,
			"similarity_boost": 0.75,
			"style":            0.0,
			"use_speaker_boost": true,
			"speed":            elevenlabsVoiceSpeed,
		},
	})
	if err != nil {
		return "", fmt.Errorf("failed to create request body for ElevenLabs: %w", err)
	}

	client := &http.Client{}
	apiReq, err := http.NewRequest("POST", apiURL, bytes.NewBuffer(requestBody))
	if err != nil {
		return "", fmt.Errorf("failed to create API request for ElevenLabs: %w", err)
	}

	apiReq.Header.Set("Content-Type", "application/json")
	apiReq.Header.Set("xi-api-key", elevenlabsAPIKey)
	apiReq.Header.Set("Accept", "audio/mpeg")

	resp, err := client.Do(apiReq)
	if err != nil {
		return "", fmt.Errorf("failed to call ElevenLabs API: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		bodyBytes, _ := io.ReadAll(resp.Body)
		log.Printf("ElevenLabs API Error: %s - %s", resp.Status, string(bodyBytes))
		return "", fmt.Errorf("ElevenLabs API error: %s", resp.Status)
	}

	// Save the audio file
	outFile, err := os.Create(filename)
	if err != nil {
		return "", fmt.Errorf("failed to create audio file: %w", err)
	}
	defer outFile.Close()

	_, err = io.Copy(outFile, resp.Body)
	if err != nil {
		return "", fmt.Errorf("failed to save audio file: %w", err)
	}

	log.Printf("Successfully created audio file: %s", filename)
	return filename, nil
}

func handleExercises(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusOK)
		return
	}

	var req llm.GenerateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	topic, err := storage.DB.GetTopic(req.TopicID)
	if err != nil {
		http.Error(w, fmt.Sprintf("Topic not found: %v", err), http.StatusNotFound)
		return
	}

	promptHash := storage.GetPromptHash(topic.Prompt)
	userID := getUserIDFromRequest(r)

	allExercises, err := storage.DB.GetExercisesForTopic(req.TopicID, promptHash)
	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to get exercises: %v", err), http.StatusInternalServerError)
		return
	}

	var finalExercises []*storage.Exercise
	if userID == "" {
		// Guest user logic - only serve from cache, never generate.
		finalExercises = getRandomExercises(allExercises, 10)
	} else {
		// Authenticated user SRS logic
		userViews, err := storage.DB.GetUserExerciseViews(userID)
		if err != nil {
			http.Error(w, fmt.Sprintf("Failed to get user views: %v", err), http.StatusInternalServerError)
			return
		}

		eligibleExercises := getEligibleExercisesForSRS(allExercises, userViews)
		if len(eligibleExercises) < 10 {
			newlyGenerated, err := llm.GenerateAndCacheExercises(topic, true)
			if err != nil {
				http.Error(w, fmt.Sprintf("Failed to generate exercises: %v", err), http.StatusInternalServerError)
				return
			}
			allExercises = append(allExercises, newlyGenerated...)
			eligibleExercises = getEligibleExercisesForSRS(allExercises, userViews)
		}

		finalExercises = getRandomExercises(eligibleExercises, 10)
	}

	// Prepare response
	type ExerciseResponse struct {
		ID            string          `json:"id"`
		ExerciseJSON  json.RawMessage `json:"exercise_json"`
		AudioFilePath string          `json:"audio_file_path"`
	}
	var responseExercises []ExerciseResponse
	for _, ex := range finalExercises {
		responseExercises = append(responseExercises, ExerciseResponse{
			ID:            ex.ID,
			ExerciseJSON:  []byte(ex.ExerciseJSON),
			AudioFilePath: ex.AudioFilePath,
		})
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string][]ExerciseResponse{"exercises": responseExercises})
}

func getEligibleExercisesForSRS(allExercises []*storage.Exercise, userViews map[string]*storage.UserExerciseView) []*storage.Exercise {
	var eligible []*storage.Exercise
	now := time.Now()
	for _, ex := range allExercises {
		view, seen := userViews[ex.AirtableID]
		if !seen {
			eligible = append(eligible, ex)
			continue
		}
		// SRS logic: next review date is (counter^2) days after last view
		daysSinceView := now.Sub(view.LastViewed).Hours() / 24
		nextReviewInDays := float64(view.RepetitionCounter * view.RepetitionCounter)
		if daysSinceView >= nextReviewInDays {
			eligible = append(eligible, ex)
		}
	}
	return eligible
}

func getRandomExercises(exercises []*storage.Exercise, count int) []*storage.Exercise {
	if len(exercises) <= count {
		return exercises
	}
	mrand.Shuffle(len(exercises), func(i, j int) {
		exercises[i], exercises[j] = exercises[j], exercises[i]
	})
	return exercises[:count]
}

func getUserIDFromRequest(r *http.Request) string {
	if userID, ok := r.Context().Value(userContextKey).(string); ok {
		return userID
	}
	return ""
}

// withAuth is a middleware that checks for a valid user session cookie.
func withAuth(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		cookie, err := r.Cookie(cookieName)
		if err != nil {
			http.Error(w, "Unauthorized: No session cookie provided.", http.StatusUnauthorized)
			return
		}

		var userID string
		if err = sc.Decode(cookieName, cookie.Value, &userID); err != nil {
			log.Printf("Invalid cookie received: %v", err)
			http.Error(w, "Unauthorized: Invalid session cookie.", http.StatusUnauthorized)
			return
		}

		// Add user ID to the request context
		ctx := context.WithValue(r.Context(), userContextKey, userID)
		next.ServeHTTP(w, r.WithContext(ctx))
	}
}

func getVoiceIDByName(voiceName string) (string, error) {
	client := &http.Client{}

	// Use /v1/voices endpoint to get all voices
	apiURL := "https://api.elevenlabs.io/v1/voices"

	req, err := http.NewRequest("GET", apiURL, nil)
	if err != nil {
		return "", fmt.Errorf("failed to create request: %v", err)
	}

	req.Header.Set("xi-api-key", elevenlabsAPIKey)
	req.Header.Set("Accept", "application/json")

	resp, err := client.Do(req)
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

	// Search for the voice by name (case-insensitive)
	for _, voice := range voicesResponse.Voices {
		if strings.EqualFold(voice.Name, voiceName) {
			return voice.VoiceID, nil
		}
	}

	return "", fmt.Errorf("voice '%s' not found", voiceName)
}

func handleTTS(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	if elevenlabsAPIKey == "" {
		http.Error(w, "TTS service is not configured", http.StatusInternalServerError)
		return
	}

	var req TTSRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if req.Text == "" {
		http.Error(w, "Text is required", http.StatusBadRequest)
		return
	}

	// Generate a unique filename from the hash of the text
	hasher := sha256.New()
	hasher.Write([]byte(req.Text))
	hash := hex.EncodeToString(hasher.Sum(nil))
	filename := fmt.Sprintf("audio_cache/%s.mp3", hash)

	// Check if the file already exists (caching)
	if _, err := os.Stat(filename); err == nil {
		log.Printf("Serving cached audio file: %s", filename)
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"filePath": filename})
		return
	}

	// If not cached, generate the audio
	log.Printf("Generating new audio file for text: %s", req.Text)

	// Get voice ID by name
	voiceID, err := getVoiceIDByName(elevenlabsVoiceName)
	if err != nil {
		log.Printf("Failed to get voice ID for '%s': %v. Using default voice.", elevenlabsVoiceName, err)
		voiceID = "21m00Tcm4TlvDq8ikWAM" // Default voice ID for "Rachel"
	}

	// ElevenLabs API request
	apiURL := fmt.Sprintf("https://api.elevenlabs.io/v1/text-to-speech/%s", voiceID)

	requestBody, err := json.Marshal(map[string]interface{}{
		"text":     req.Text,
		"model_id": elevenlabsModelID,
		"voice_settings": map[string]interface{}{
			"stability":        0.5,
			"similarity_boost": 0.75,
			"style":            0.0,
			"use_speaker_boost": true,
			"speed":            elevenlabsVoiceSpeed,
		},
	})
	if err != nil {
		http.Error(w, "Failed to create request body for ElevenLabs", http.StatusInternalServerError)
		return
	}

	client := &http.Client{}
	apiReq, err := http.NewRequest("POST", apiURL, bytes.NewBuffer(requestBody))
	if err != nil {
		http.Error(w, "Failed to create API request for ElevenLabs", http.StatusInternalServerError)
		return
	}

	apiReq.Header.Set("Content-Type", "application/json")
	apiReq.Header.Set("xi-api-key", elevenlabsAPIKey)
	apiReq.Header.Set("Accept", "audio/mpeg")

	resp, err := client.Do(apiReq)
	if err != nil {
		http.Error(w, "Failed to call ElevenLabs API", http.StatusInternalServerError)
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		bodyBytes, _ := io.ReadAll(resp.Body)
		log.Printf("ElevenLabs API Error: %s - %s", resp.Status, string(bodyBytes))
		http.Error(w, fmt.Sprintf("ElevenLabs API error: %s", resp.Status), resp.StatusCode)
		return
	}

	// Save the audio file
	outFile, err := os.Create(filename)
	if err != nil {
		http.Error(w, "Failed to create audio file", http.StatusInternalServerError)
		return
	}
	defer outFile.Close()

	_, err = io.Copy(outFile, resp.Body)
	if err != nil {
		http.Error(w, "Failed to save audio file", http.StatusInternalServerError)
		return
	}

	log.Printf("Successfully created audio file: %s", filename)

	// Try to update any legacy exercises that match this text
	go storage.DB.UpdateLegacyExercisesWithAudio(req.Text, filename)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"filePath": filename})
}

func handleGetLastRefinedPrompt(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Content-Type", "application/json")

	response := map[string]string{
		"last_refined_prompt": llm.GetLastRefinedPrompt(),
	}

	if err := json.NewEncoder(w).Encode(response); err != nil {
		http.Error(w, "Failed to encode response", http.StatusInternalServerError)
	}
}

// Handle topics CRUD operations
func handleTopics(w http.ResponseWriter, r *http.Request) {
	// Enable CORS
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type")

	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusOK)
		return
	}

	switch r.Method {
	case http.MethodGet:
		topicsList, err := storage.DB.GetAllTopics()
		if err != nil {
			http.Error(w, fmt.Sprintf("Failed to get topics: %v", err), http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string][]*storage.Topic{"topics": topicsList})

	case http.MethodPost:
		adminOnly(func(w http.ResponseWriter, r *http.Request) {
			var req TopicRequest
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				http.Error(w, "Invalid request body", http.StatusBadRequest)
				return
			}

			if req.Name == "" || req.Prompt == "" {
				http.Error(w, "Name and prompt are required", http.StatusBadRequest)
				return
			}

			topic, err := storage.DB.CreateTopic(req.Name, req.Prompt)
			if err != nil {
				http.Error(w, fmt.Sprintf("Failed to create topic: %v", err), http.StatusInternalServerError)
				return
			}

			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusCreated)
			json.NewEncoder(w).Encode(topic)
		}).ServeHTTP(w, r)

	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

func handleUserStats(w http.ResponseWriter, r *http.Request) {
	userID := getUserIDFromRequest(r)

	switch r.Method {
	case http.MethodGet:
		stats, err := storage.DB.GetUserStats(userID)
		if err != nil {
			http.Error(w, "Failed to get user stats", http.StatusInternalServerError)
			return
		}
		json.NewEncoder(w).Encode(stats)
	case http.MethodPost:
		var stats storage.UserStats
		if err := json.NewDecoder(r.Body).Decode(&stats); err != nil {
			http.Error(w, "Invalid request body", http.StatusBadRequest)
			return
		}
		stats.UserID = userID
		if err := storage.DB.UpdateUserStats(&stats); err != nil {
			http.Error(w, "Failed to update user stats", http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusOK)
	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

func handleUserSettings(w http.ResponseWriter, r *http.Request) {
	userID := getUserIDFromRequest(r)

	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var settings struct {
		LastTopicID string `json:"last_topic_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&settings); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if err := storage.DB.UpdateUserSetting(userID, settings.LastTopicID); err != nil {
		log.Printf("Error updating user settings for user %s: %v", userID, err)
		http.Error(w, "Failed to update user settings", http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusOK)
}

func handleGoogleLogin(w http.ResponseWriter, r *http.Request) {
	if googleOauthConfig == nil {
		http.Error(w, "Google login is not configured", http.StatusInternalServerError)
		return
	}
	url := googleOauthConfig.AuthCodeURL(oauthStateString)
	http.Redirect(w, r, url, http.StatusTemporaryRedirect)
}

func handleGoogleCallback(w http.ResponseWriter, r *http.Request) {
	if googleOauthConfig == nil {
		http.Error(w, "Google login is not configured", http.StatusInternalServerError)
		return
	}

	state := r.FormValue("state")
	if state != oauthStateString {
		log.Printf("Invalid oauth state, expected '%s', got '%s'\n", oauthStateString, state)
		http.Redirect(w, r, "/", http.StatusTemporaryRedirect)
		return
	}

	code := r.FormValue("code")
	token, err := googleOauthConfig.Exchange(context.Background(), code)
	if err != nil {
		log.Printf("oauthConf.Exchange() failed with '%s'\n", err)
		http.Redirect(w, r, "/", http.StatusTemporaryRedirect)
		return
	}

	oauth2Client := oauth2.NewClient(context.Background(), oauth2.StaticTokenSource(token))
	oauth2Service, err := oauth2v2.New(oauth2Client)
	if err != nil {
		log.Printf("Unable to create oauth2 service: %v", err)
		http.Redirect(w, r, "/", http.StatusTemporaryRedirect)
		return
	}

	userinfo, err := oauth2Service.Userinfo.Get().Do()
	if err != nil {
		log.Printf("Unable to get user info: %v", err)
		http.Redirect(w, r, "/", http.StatusTemporaryRedirect)
		return
	}

	// Get or create user in Airtable
	user, err := storage.DB.GetUserByGoogleID(userinfo.Id)
	if err != nil {
		log.Printf("Unable to get user by google ID: %v", err)
		http.Redirect(w, r, "/", http.StatusTemporaryRedirect)
		return
	}
	if user == nil {
		user, err = storage.DB.CreateUser(userinfo.Id)
		if err != nil {
			log.Printf("Unable to create user: %v", err)
			http.Redirect(w, r, "/", http.StatusTemporaryRedirect)
			return
		}
	}

	encoded, err := sc.Encode(cookieName, user.ID)
	if err != nil {
		log.Printf("Failed to encode cookie: %v", err)
		http.Error(w, "Failed to set session cookie", http.StatusInternalServerError)
		return
	}

	http.SetCookie(w, &http.Cookie{
		Name:     cookieName,
		Value:    encoded,
		HttpOnly: true,
		Secure:   r.URL.Scheme == "https", // Use secure cookies in production
		Path:     "/",
		Expires:  time.Now().Add(30 * 24 * time.Hour), // 30 days
	})

	http.Redirect(w, r, "/", http.StatusTemporaryRedirect)
}

func handleAuthStatus(w http.ResponseWriter, r *http.Request) {
	cookie, err := r.Cookie(cookieName)
	if err != nil {
		json.NewEncoder(w).Encode(map[string]any{"logged_in": false})
		return
	}

	var userID string
	if err = sc.Decode(cookieName, cookie.Value, &userID); err != nil {
		json.NewEncoder(w).Encode(map[string]any{"logged_in": false})
		return
	}

	json.NewEncoder(w).Encode(map[string]any{"logged_in": true, "user_id": userID})
}

func handleLogout(w http.ResponseWriter, r *http.Request) {
	http.SetCookie(w, &http.Cookie{
		Name:     cookieName,
		Value:    "",
		HttpOnly: true,
		Path:     "/",
		Expires:  time.Unix(0, 0), // Expire immediately
	})
	http.Redirect(w, r, "/", http.StatusTemporaryRedirect)
}

func handleIsAdmin(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	isAdmin := false
	if googleAdminID != "" {
		userID := getUserIDFromRequest(r)
		if userID != "" {
			user, err := storage.DB.GetUserByID(userID)
			if err == nil && user != nil && user.GoogleID == googleAdminID {
				isAdmin = true
			}
		}
	}

	json.NewEncoder(w).Encode(map[string]bool{"is_admin": isAdmin})
}

func adminOnly(h http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if googleAdminID == "" {
			http.Error(w, "Admin features are not configured", http.StatusForbidden)
			return
		}

		userID := getUserIDFromRequest(r)
		if userID == "" {
			http.Error(w, "You must be logged in to perform this action", http.StatusUnauthorized)
			return
		}

		user, err := storage.DB.GetUserByID(userID)
		if err != nil || user == nil {
			log.Printf("Error getting user for admin check (userID: %s): %v", userID, err)
			http.Error(w, "Could not verify user credentials", http.StatusInternalServerError)
			return
		}

		if user.GoogleID != googleAdminID {
			log.Printf("Admin access denied for user (googleID: %s)", user.GoogleID)
			http.Error(w, "You do not have permission to perform this action", http.StatusForbidden)
			return
		}

		h.ServeHTTP(w, r)
	}
}

// Handle individual topic operations
// handleUserExerciseStats handles requests for user's exercise statistics.
func handleUserExerciseStats(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	userID := getUserIDFromRequest(r)

	stats, err := storage.DB.GetUserExerciseStats(userID)
	if err != nil {
		log.Printf("Error getting user exercise stats for user %s: %v", userID, err)
		http.Error(w, "Failed to get user exercise stats", http.StatusInternalServerError)
		return
	}

	if err := json.NewEncoder(w).Encode(stats); err != nil {
		log.Printf("Error encoding user exercise stats for user %s: %v", userID, err)
		http.Error(w, "Failed to encode response", http.StatusInternalServerError)
	}
}

type CompleteExerciseRequest struct {
	ExerciseID string `json:"exercise_id"`
}

// handleCompleteExercise marks an exercise as completed for a user.
func handleCompleteExercise(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	userID := getUserIDFromRequest(r)
	if userID == "" {
		// This should technically be caught by withAuth, but as a safeguard:
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	var req CompleteExerciseRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}
	if req.ExerciseID == "" {
		http.Error(w, "Exercise ID is required", http.StatusBadRequest)
		return
	}

	err := storage.DB.CompleteUserExercise(userID, req.ExerciseID)
	if err != nil {
		log.Printf("Error completing exercise for user %s, exercise %s: %v", userID, req.ExerciseID, err)
		http.Error(w, "Failed to update exercise progress", http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{"status": "success"})
}

func handleTopicByID(w http.ResponseWriter, r *http.Request) {
	// Enable CORS
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "GET, PUT, DELETE, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type")

	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusOK)
		return
	}

	// Extract topic ID from path
	topicID := strings.TrimPrefix(r.URL.Path, "/api/topics/")
	if topicID == "" {
		http.Error(w, "Topic ID required", http.StatusBadRequest)
		return
	}

	switch r.Method {
	case http.MethodGet:
		topic, err := storage.DB.GetTopic(topicID)
		if err != nil {
			http.Error(w, "Topic not found", http.StatusNotFound)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(topic)

	case http.MethodPut:
		adminOnly(func(w http.ResponseWriter, r *http.Request) {
			var req UpdateTopicRequest
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				http.Error(w, "Invalid request body", http.StatusBadRequest)
				return
			}

			if req.Prompt == "" {
				http.Error(w, "Prompt is required", http.StatusBadRequest)
				return
			}

			topic, err := storage.DB.UpdateTopic(topicID, req.Name, req.Prompt)
			if err != nil {
				http.Error(w, fmt.Sprintf("Failed to update topic: %v", err), http.StatusInternalServerError)
				return
			}

			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(topic)
		}).ServeHTTP(w, r)

	case http.MethodDelete:
		adminOnly(func(w http.ResponseWriter, r *http.Request) {
			err := storage.DB.DeleteTopic(topicID)
			if err != nil {
				http.Error(w, fmt.Sprintf("Failed to delete topic: %v", err), http.StatusInternalServerError)
				return
			}

			w.WriteHeader(http.StatusNoContent)
		}).ServeHTTP(w, r)

	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

// Handle prompt versions
func handleVersions(w http.ResponseWriter, r *http.Request) {
	// Enable CORS
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type")

	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusOK)
		return
	}

	// Extract topic ID from path: /api/versions/{topicID} or /api/versions/{topicID}/restore/{versionID}
	pathParts := strings.Split(strings.TrimPrefix(r.URL.Path, "/api/versions/"), "/")
	if len(pathParts) < 1 || pathParts[0] == "" {
		http.Error(w, "Topic ID required", http.StatusBadRequest)
		return
	}

	topicID := pathParts[0]

	switch r.Method {
	case http.MethodGet:
		versions, err := storage.DB.GetVersions(topicID)
		if err != nil {
			http.Error(w, fmt.Sprintf("Failed to get versions: %v", err), http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string][]*storage.PromptVersion{"versions": versions})

	case http.MethodPost:
		adminOnly(func(w http.ResponseWriter, r *http.Request) {
			// Restore version: POST /api/versions/{topicID}/restore/{versionID}
			if len(pathParts) < 3 || pathParts[1] != "restore" {
				http.Error(w, "Invalid restore path", http.StatusBadRequest)
				return
			}

			versionID := pathParts[2]

			versionToRestore, err := storage.DB.GetVersion(versionID)
			if err != nil {
				http.Error(w, "Version not found", http.StatusNotFound)
				return
			}

			// Verify the version belongs to the requested topic
			if versionToRestore.TopicID != topicID {
				http.Error(w, "Version does not belong to this topic", http.StatusBadRequest)
				return
			}

			// Get the current topic name to preserve it
			currentTopic, err := storage.DB.GetTopic(topicID)
			if err != nil {
				http.Error(w, "Failed to get current topic", http.StatusNotFound)
				return
			}

			// Update topic with restored prompt (this will automatically create a new version)
			topic, err := storage.DB.UpdateTopic(topicID, currentTopic.Name, versionToRestore.Prompt)
			if err != nil {
				http.Error(w, fmt.Sprintf("Failed to restore version: %v", err), http.StatusInternalServerError)
				return
			}

			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(topic)
		}).ServeHTTP(w, r)

	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}