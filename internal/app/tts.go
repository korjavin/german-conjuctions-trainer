package app

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
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

	hasher := sha256.New()
	hasher.Write([]byte(req.Text))
	hash := hex.EncodeToString(hasher.Sum(nil))
	filename := fmt.Sprintf("audio_cache/%s.mp3", hash)

	// Check cache first, regardless of API key
	if _, err := os.Stat(filename); err == nil {
		log.Printf("Using cached audio file: %s", filename)
		// Update modification time for LRU eviction logic
		now := time.Now()
		if err := os.Chtimes(filename, now, now); err != nil {
			log.Printf("Warning: failed to update times for %s: %v", filename, err)
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"filePath": filename})
		return
	}

	if a.ElevenLabs.APIKey == "" {
		http.Error(w, "TTS service is not configured and audio is not cached", http.StatusServiceUnavailable)
		return
	}

	filename, err := a.generateAndSaveAudio(req.Text, filename)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	// Try to update any legacy exercises that match this text
	go a.DB.UpdateLegacyExercisesWithAudio(req.Text, filename)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"filePath": filename})
}

func (a *App) generateAndSaveAudio(text string, filename string) (string, error) {
	if a.ElevenLabs.APIKey == "" {
		return "", fmt.Errorf("TTS service is not configured")
	}

	log.Printf("Generating new audio file for text: %s", text)

	voiceID, err := a.getVoiceIDByName(a.ElevenLabs.VoiceName)
	if err != nil {
		log.Printf("Failed to get voice ID for '%s': %v. Using default voice.", a.ElevenLabs.VoiceName, err)
		voiceID = "21m00Tcm4TlvDq8ikWAM" // Default voice ID for "Rachel"
	}

	apiURL := fmt.Sprintf("https://api.elevenlabs.io/v1/text-to-speech/%s", voiceID)

	requestBody, err := json.Marshal(map[string]interface{}{
		"text":          text,
		"model_id":      a.ElevenLabs.ModelID,
		"language_code": "de",
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
