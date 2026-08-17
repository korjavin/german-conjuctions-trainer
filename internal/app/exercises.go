package app

import (
	"encoding/json"
	"fmt"
	"log"
	mrand "math/rand"
	"net/http"
	"os"
	"time"

	"german-conjunctions-trainer/pkg/llm"
	"german-conjunctions-trainer/pkg/storage"
)

const (
	// maxExerciseBatchLimit is the hard cap on the "limit" field of
	// POST /api/exercises, so an offline prefetch cannot ask for the world.
	maxExerciseBatchLimit = 200
	// maxClientBatchIDLen bounds the client-supplied idempotency key.
	maxClientBatchIDLen = 64
)

func (a *App) handleExercises(w http.ResponseWriter, r *http.Request) {
	requestStartedAt := time.Now()
	if r.Method != http.MethodPost {
		writeJSONError(w, http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED", "Method not allowed", "", false)
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
		writeJSONError(w, http.StatusBadRequest, "INVALID_REQUEST_BODY", "Invalid request body", err.Error(), false)
		return
	}

	topic, err := a.DB.GetTopic(req.TopicID)
	if err != nil {
		writeJSONError(w, http.StatusNotFound, "TOPIC_NOT_FOUND", "Topic not found", err.Error(), false)
		return
	}

	userID := getUserIDFromRequest(r)

	// Batch size: default 10, hard cap maxExerciseBatchLimit (offline prefetch asks for more).
	limit := 10
	if req.Limit > 0 {
		limit = req.Limit
		if limit > maxExerciseBatchLimit {
			limit = maxExerciseBatchLimit
		}
	}

	// Collect all descendant topics
	descendants, err := a.DB.GetDescendantTopicIDs(req.TopicID)
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, "TOPIC_LOOKUP_FAILED", "Failed to get descendant topics", err.Error(), false)
		return
	}

	topicIDs := append([]string{req.TopicID}, descendants...)
	log.Printf("[EXERCISES] Fetching exercises from %d topics: %v, userID='%s'", len(topicIDs), topicIDs, userID)

	// Since we are fetching exercises across the subtree, we need to ensure each topic's exercises
	// correspond to that topic's *current* prompt. We map topic IDs to their current prompt hashes.
	// Since GetExercisesForTopics only accepts a single prompt hash filter, we will fetch all exercises
	// for the topics, and then manually filter out stale exercises based on each topic's current prompt hash.
	topicHashFilters := make(map[string]string)
	topicHashFilters[req.TopicID] = storage.GetPromptHash(topic.Prompt)

	for _, descID := range descendants {
		descTopic, err := a.DB.GetTopic(descID)
		if err == nil {
			topicHashFilters[descID] = storage.GetPromptHash(descTopic.Prompt)
		}
	}

	// Fetch all exercises for these topics without filtering by hash in SQL
	rawExercises, err := a.DB.GetExercisesForTopics(topicIDs, "")
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, "EXERCISE_LOOKUP_FAILED", "Failed to get exercises", err.Error(), false)
		return
	}

	// Apply hash filtering in memory to ensure we only use exercises matching current prompts
	var allExercises []*storage.Exercise
	for _, ex := range rawExercises {
		if expectedHash, ok := topicHashFilters[ex.TopicID]; ok && ex.PromptHash == expectedHash {
			allExercises = append(allExercises, ex)
		}
	}
	log.Printf("[EXERCISES] Found %d exercises in cache for topics %v", len(allExercises), topicIDs)

	var finalExercises []*storage.Exercise
	userViews := make(map[string]*storage.UserExerciseView)
	if userID == "" {
		log.Printf("[EXERCISES] Guest user mode - serving random exercises from cache")
		finalExercises = getRandomExercises(allExercises, limit)
	} else {
		log.Printf("[EXERCISES] Authenticated user %s - applying SRS logic", userID)
		var err error
		userViews, err = a.DB.GetUserExerciseViews(userID)
		if err != nil {
			writeJSONError(w, http.StatusInternalServerError, "USER_VIEWS_LOOKUP_FAILED", "Failed to get user exercise views", err.Error(), false)
			return
		}
		log.Printf("[EXERCISES] Found %d user exercise views for user %s", len(userViews), userID)

		eligibleExercises := getEligibleExercisesForSRS(allExercises, userViews)
		if len(eligibleExercises) < 10 && !req.SkipGeneration {
			// Randomly select a topic from the sub-tree
			randomTopicID := topicIDs[mrand.Intn(len(topicIDs))]
			selectedTopic, err := a.DB.GetTopic(randomTopicID)
			if err != nil {
				writeJSONError(w, http.StatusInternalServerError, "TOPIC_LOOKUP_FAILED", "Failed to get selected topic for generation", err.Error(), false)
				return
			}

			// Build coverage section if key terms exist for this topic
			coverageSection := ""
			promptHash := storage.GetPromptHash(selectedTopic.Prompt)
			keyTerms, ktErr := a.DB.GetTopicKeyTerms(selectedTopic.ID, promptHash)
			if ktErr == nil && keyTerms != nil && len(keyTerms.Terms) > 0 {
				// Filter exercises for this specific topic
				var topicExercises []*storage.Exercise
				for _, ex := range allExercises {
					if ex.TopicID == selectedTopic.ID && ex.PromptHash == promptHash {
						topicExercises = append(topicExercises, ex)
					}
				}
				termCounts := llm.ComputeTermCoverage(topicExercises, keyTerms.Terms)
				coverageSection = llm.BuildCoverageSection(keyTerms.Terms, termCounts)
				log.Printf("[EXERCISES] Coverage stats for topic %s: %d terms, %d existing exercises", selectedTopic.ID, len(keyTerms.Terms), len(topicExercises))
			}

			log.Printf("[EXERCISES] Generating new exercises for randomly selected sub-tree topic %s", randomTopicID)
			newlyGenerated, err := llm.GenerateAndCacheExercises(selectedTopic, true, coverageSection)
			if err != nil {
				status := http.StatusBadGateway
				code := "EXERCISE_GENERATION_FAILED"
				message := "Failed to generate new exercises from AI provider."
				if llm.IsTimeoutError(err) {
					status = http.StatusGatewayTimeout
					code = "UPSTREAM_TIMEOUT"
					message = "Exercise generation timed out while waiting for AI provider. Please try again."
				}
				log.Printf("[EXERCISES] ERROR generating exercises for topic %s user %s: %v", selectedTopic.ID, userID, err)
				writeJSONError(w, status, code, message, err.Error(), true)
				return
			}
			log.Printf("[EXERCISES] Generated and cached %d new exercises for topic %s", len(newlyGenerated), selectedTopic.ID)
			allExercises = append(allExercises, newlyGenerated...)
			eligibleExercises = getEligibleExercisesForSRS(allExercises, userViews)
		}

		if len(eligibleExercises) > limit {
			finalExercises = eligibleExercises[:limit]
		} else {
			finalExercises = eligibleExercises
		}

		log.Printf("[SRS] Selected %d exercises for user %s", len(finalExercises), userID)
	}

	type ExerciseResponse struct {
		ID                string          `json:"id"`
		TopicID           string          `json:"topic_id"`
		ExerciseJSON      json.RawMessage `json:"exercise_json"`
		AudioFilePath     string          `json:"audio_file_path"`
		IsFavorite        bool            `json:"is_favorite"`
		RepetitionCounter int             `json:"repetition_counter"`
	}
	var responseExercises []ExerciseResponse
	for _, ex := range finalExercises {
		isFavorite := false
		repetitionCounter := 0
		if view, exists := userViews[ex.ID]; exists {
			isFavorite = view.IsFavorite
			repetitionCounter = view.RepetitionCounter
		}
		responseExercises = append(responseExercises, ExerciseResponse{
			ID:                ex.ID,
			TopicID:           ex.TopicID,
			ExerciseJSON:      []byte(ex.ExerciseJSON),
			AudioFilePath:     ex.AudioFilePath,
			IsFavorite:        isFavorite,
			RepetitionCounter: repetitionCounter,
		})
	}

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(map[string][]ExerciseResponse{"exercises": responseExercises}); err != nil {
		log.Printf("[EXERCISES] ERROR encoding response for topic %s user %s: %v", req.TopicID, userID, err)
	}
	log.Printf("[EXERCISES] Completed request for topic %s userID='%s' with %d exercises in %s", req.TopicID, userID, len(responseExercises), time.Since(requestStartedAt).Round(time.Millisecond))
}

func (a *App) handleExercisesComplete(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	userID := getUserIDFromRequest(r)
	if userID == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	type ExerciseCompletion struct {
		ExerciseID string `json:"exercise_id"`
		HintsUsed  int    `json:"hints_used"`
		Mistakes   int    `json:"mistakes"`
	}

	type CompletionRequest struct {
		Completions []ExerciseCompletion `json:"completions"`
		// ClientBatchID is an optional idempotency key: the offline queue
		// retries batches, and a replay must not double-count attempts.
		ClientBatchID string `json:"client_batch_id"`
	}

	var req CompletionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if len(req.ClientBatchID) > maxClientBatchIDLen {
		http.Error(w, "client_batch_id too long", http.StatusBadRequest)
		return
	}

	log.Printf("[COMPLETION] User %s completing %d exercises (batch %q)", userID, len(req.Completions), req.ClientBatchID)

	userViews, err := a.DB.GetUserExerciseViews(userID)
	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to get user views: %v", err), http.StatusInternalServerError)
		return
	}

	now := time.Now()
	var viewsToUpdate []*storage.UserExerciseView

	for _, completion := range req.Completions {
		view, exists := userViews[completion.ExerciseID]
		if !exists {
			view = &storage.UserExerciseView{
				UserID:     userID,
				ExerciseID: completion.ExerciseID,
			}
		}

		view.LastViewed = now
		view.TotalAttempts++
		view.HintsUsed += completion.HintsUsed
		view.MistakesMade += completion.Mistakes

		isPerfect := completion.HintsUsed == 0 && completion.Mistakes == 0

		if isPerfect {
			view.RepetitionCounter++
			view.SuccessfulAttempts++
			log.Printf("[COMPLETION] Exercise %s: PERFECT - counter: %d -> %d",
				completion.ExerciseID, view.RepetitionCounter-1, view.RepetitionCounter)
		} else if completion.Mistakes > 0 {
			oldCounter := view.RepetitionCounter
			if view.RepetitionCounter > 0 {
				view.RepetitionCounter--
			}
			view.FailedAttempts++
			log.Printf("[COMPLETION] Exercise %s: FAILED (%d mistakes) - counter: %d -> %d",
				completion.ExerciseID, completion.Mistakes, oldCounter, view.RepetitionCounter)
		} else {
			log.Printf("[COMPLETION] Exercise %s: HINTS USED (%d) - counter stays at %d",
				completion.ExerciseID, completion.HintsUsed, view.RepetitionCounter)
		}

		viewsToUpdate = append(viewsToUpdate, view)
	}

	// The batch marker is written in the same transaction as the stats, so a
	// replayed batch (applied == false) leaves attempts and SRS counters alone.
	applied, err := a.DB.ApplyCompletionBatch(userID, req.ClientBatchID, viewsToUpdate)
	if err != nil {
		log.Printf("ERROR: failed to update user exercise views: %v", err)
		http.Error(w, fmt.Sprintf("Failed to update views: %v", err), http.StatusInternalServerError)
		return
	}
	if !applied {
		log.Printf("[COMPLETION] Replay of batch %s for user %s - ignored", req.ClientBatchID, userID)
	} else {
		log.Printf("[COMPLETION] Successfully updated %d exercise completions for user %s", len(viewsToUpdate), userID)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "success"})
}

func (a *App) handleExerciseFavorite(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	userID := getUserIDFromRequest(r)
	if userID == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	var req struct {
		ExerciseID string `json:"exercise_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if req.ExerciseID == "" {
		http.Error(w, "Exercise ID is required", http.StatusBadRequest)
		return
	}

	newStatus, err := a.DB.ToggleFavorite(userID, req.ExerciseID)
	if err != nil {
		log.Printf("ERROR: failed to toggle favorite for user %s exercise %s: %v", userID, req.ExerciseID, err)
		http.Error(w, fmt.Sprintf("Failed to toggle favorite: %v", err), http.StatusInternalServerError)
		return
	}

	log.Printf("[FAVORITE] User %s toggled favorite for exercise %s to %v", userID, req.ExerciseID, newStatus)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"is_favorite": newStatus,
	})
}

func (a *App) handleExerciseHide(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	userID := getUserIDFromRequest(r)
	if userID == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	var req struct {
		ExerciseID string `json:"exercise_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if req.ExerciseID == "" {
		http.Error(w, "Exercise ID is required", http.StatusBadRequest)
		return
	}

	newStatus, err := a.DB.ToggleHideExercise(userID, req.ExerciseID)
	if err != nil {
		log.Printf("ERROR: failed to toggle hide exercise for user %s exercise %s: %v", userID, req.ExerciseID, err)
		http.Error(w, fmt.Sprintf("Failed to toggle hide exercise: %v", err), http.StatusInternalServerError)
		return
	}

	log.Printf("[HIDE] User %s toggled hide for exercise %s to %v", userID, req.ExerciseID, newStatus)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"is_hidden": newStatus,
	})
}

func (a *App) handleExplain(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSONError(w, http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED", "Method not allowed", "", false)
		return
	}

	var req struct {
		Topic           string   `json:"topic"`
		CorrectSentence string   `json:"correct_sentence"`
		Mistakes        []string `json:"mistakes"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSONError(w, http.StatusBadRequest, "INVALID_REQUEST_BODY", "Invalid request body", err.Error(), false)
		return
	}

	apiKey := os.Getenv("OPENAI_API_KEY")
	if apiKey == "" {
		writeJSONError(w, http.StatusInternalServerError, "MISSING_CONFIG", "OPENAI_API_KEY is not configured", "", false)
		return
	}
	openaiURL := os.Getenv("OPENAI_URL")
	if openaiURL == "" {
		openaiURL = "https://api.openai.com/v1"
	}
	modelName := os.Getenv("MODEL_NAME")
	if modelName == "" {
		modelName = "gpt-3.5-turbo-1106"
	}

	explanation, err := llm.GenerateExplanation(apiKey, openaiURL, modelName, req.Topic, req.CorrectSentence, req.Mistakes)
	if err != nil {
		status := http.StatusBadGateway
		code := "EXPLANATION_GENERATION_FAILED"
		message := "Failed to generate explanation from AI provider."
		if llm.IsTimeoutError(err) {
			status = http.StatusGatewayTimeout
			code = "UPSTREAM_TIMEOUT"
			message = "Explanation generation timed out while waiting for AI provider. Please try again."
		}
		log.Printf("[EXPLAIN] ERROR generating explanation for topic %s: %v", req.Topic, err)
		writeJSONError(w, status, code, message, err.Error(), true)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"explanation": explanation})
}

func (a *App) handleExerciseHistory(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	userID := getUserIDFromRequest(r)
	if userID == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	topicID := r.URL.Query().Get("topic_id")

	history, err := a.DB.GetUserExerciseHistory(userID, topicID)
	if err != nil {
		log.Printf("ERROR: failed to get exercise history for user %s: %v", userID, err)
		http.Error(w, fmt.Sprintf("Failed to get exercise history: %v", err), http.StatusInternalServerError)
		return
	}

	log.Printf("[HISTORY] Retrieved %d exercise history items for user %s (topic: %s)", len(history), userID, topicID)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"history": history,
	})
}
