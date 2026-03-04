package app

import (
	"encoding/json"
	"log"
	"net/http"

	"german-conjunctions-trainer/pkg/storage"
)

func (a *App) handleUserStats(w http.ResponseWriter, r *http.Request) {
	userID := getUserIDFromRequest(r)

	switch r.Method {
	case http.MethodGet:
		stats, err := a.DB.GetUserStats(userID)
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
		if err := a.DB.UpdateUserStats(&stats); err != nil {
			http.Error(w, "Failed to update user stats", http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusOK)
	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

func (a *App) handleUserSettings(w http.ResponseWriter, r *http.Request) {
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

	if err := a.DB.UpdateUserSetting(userID, settings.LastTopicID); err != nil {
		log.Printf("Error updating user settings for user %s: %v", userID, err)
		http.Error(w, "Failed to update user settings", http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusOK)
}

func (a *App) handleUserExerciseStats(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	userID := getUserIDFromRequest(r)
	log.Printf("[STATS] Getting exercise stats for user %s", userID)

	stats, err := a.DB.GetUserExerciseStats(userID)
	if err != nil {
		log.Printf("ERROR: getting user exercise stats for user %s: %v", userID, err)
		http.Error(w, "Failed to get user exercise stats", http.StatusInternalServerError)
		return
	}

	log.Printf("[STATS] User %s stats: ready_to_repeat=%d, trained=%d", userID, stats.ReadyToRepeatCount, stats.TrainedCount)

	if err := json.NewEncoder(w).Encode(stats); err != nil {
		log.Printf("ERROR: encoding user exercise stats for user %s: %v", userID, err)
		http.Error(w, "Failed to encode response", http.StatusInternalServerError)
	}
}
