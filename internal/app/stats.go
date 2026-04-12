package app

import (
	"encoding/json"
	"log"
	"net/http"
)

func (a *App) handleDatabaseStats(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	stats, err := a.DB.GetDatabaseStats(a.AudioCacheDir, a.DBPath)
	if err != nil {
		log.Printf("Error getting database stats: %v", err)
		http.Error(w, "Failed to get database stats", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(stats)
}
