package app

import (
	"encoding/json"
	"net/http"

	"german-conjunctions-trainer/pkg/llm"
)

func (a *App) handleGetLastRefinedPrompt(w http.ResponseWriter, r *http.Request) {
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

func (a *App) handleGetLastGenerationDebug(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Content-Type", "application/json")

	if err := json.NewEncoder(w).Encode(llm.GetLastGenerationDebugInfo()); err != nil {
		http.Error(w, "Failed to encode response", http.StatusInternalServerError)
	}
}
