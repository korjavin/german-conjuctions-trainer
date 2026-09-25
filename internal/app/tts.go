package app

import (
	"bytes"
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
	"strings"
	"time"
)

type TTSRequest struct {
	Text string `json:"text"`
}

func (a *App) handleTTS(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
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

	_, statErr := os.Stat(ttsCachePath(req.Text, "de"))
	wasCached := statErr == nil

	filename, err := a.ensureTTSAudio(req.Text, "de")
	if err != nil {
		if errors.Is(err, errTTSNotConfigured) {
			http.Error(w, "TTS service is not configured and audio is not cached", http.StatusServiceUnavailable)
			return
		}
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	if !wasCached {
		// Try to update any legacy exercises that match this text
		go a.DB.UpdateLegacyExercisesWithAudio(req.Text, filename)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"filePath": filename})
}

var errTTSNotConfigured = errors.New("TTS service is not configured")

// ttsCachePath returns the audio cache file for text spoken in lang. German
// keeps the historical text-only key so already cached exercise audio stays
// valid; other languages are namespaced by their code.
func ttsCachePath(text, lang string) string {
	key := text
	if lang != "de" {
		key = lang + ":" + text
	}
	sum := sha256.Sum256([]byte(key))
	return fmt.Sprintf("audio_cache/%s.mp3", hex.EncodeToString(sum[:]))
}

// ensureTTSAudio returns the cached audio file for text in lang ("de" or
// "en"), generating it with ElevenLabs on a cache miss.
func (a *App) ensureTTSAudio(text, lang string) (string, error) {
	filename := ttsCachePath(text, lang)
	if _, err := os.Stat(filename); err == nil {
		log.Printf("Using cached audio file: %s", filename)
		// Update modification time for LRU eviction logic
		now := time.Now()
		if err := os.Chtimes(filename, now, now); err != nil {
			log.Printf("Warning: failed to update times for %s: %v", filename, err)
		}
		return filename, nil
	}
	return a.generateAndSaveAudio(text, lang, filename)
}

func (a *App) generateAndSaveAudio(text, lang, filename string) (string, error) {
	if a.ElevenLabs.APIKey == "" {
		return "", errTTSNotConfigured
	}

	log.Printf("Generating new %s audio file for text: %s", lang, text)

	voiceID := a.cachedVoiceID()

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
			"speed":             a.ElevenLabs.Speed,
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
	apiReq.Header.Set("xi-api-key", a.ElevenLabs.APIKey)
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
func (a *App) cachedVoiceID() string {
	a.voiceMu.Lock()
	defer a.voiceMu.Unlock()
	if a.voiceID != "" {
		return a.voiceID
	}
	voiceID, err := a.getVoiceIDByName(a.ElevenLabs.VoiceName)
	if err != nil {
		log.Printf("Failed to get voice ID for '%s': %v. Using default voice.", a.ElevenLabs.VoiceName, err)
		return "21m00Tcm4TlvDq8ikWAM" // Default voice ID for "Rachel"
	}
	a.voiceID = voiceID
	return voiceID
}

func (a *App) getVoiceIDByName(voiceName string) (string, error) {
	client := &http.Client{}

	apiURL := "https://api.elevenlabs.io/v1/voices"

	req, err := http.NewRequest("GET", apiURL, nil)
	if err != nil {
		return "", fmt.Errorf("failed to create request: %v", err)
	}

	req.Header.Set("xi-api-key", a.ElevenLabs.APIKey)
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

	for _, voice := range voicesResponse.Voices {
		if strings.EqualFold(voice.Name, voiceName) {
			return voice.VoiceID, nil
		}
	}

	return "", fmt.Errorf("voice '%s' not found", voiceName)
}
