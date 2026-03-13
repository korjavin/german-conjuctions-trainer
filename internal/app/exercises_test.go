package app

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"german-conjunctions-trainer/pkg/storage"
)

func TestHandleExercises_ReturnsTopicID(t *testing.T) {
	app := setupTestApp(t)

	// Create root topic
	rootTopic, err := app.DB.CreateTopic("Root Topic", "Root Prompt", nil, 0)
	if err != nil {
		t.Fatalf("failed to create root topic: %v", err)
	}

	// Create child topic
	childTopic, err := app.DB.CreateTopic("Child Topic", "Child Prompt", &rootTopic.ID, 1)
	if err != nil {
		t.Fatalf("failed to create child topic: %v", err)
	}

	// Create exercise for child topic
	exerciseJSON := `{"correct_german_sentence": "Das ist ein Test.", "english_hint": "This is a test."}`
	_, err = app.DB.CreateExercise(childTopic.ID, storage.GetPromptHash("Child Prompt"), exerciseJSON, "/audio.mp3")
	if err != nil {
		t.Fatalf("failed to create exercise: %v", err)
	}

	// Make request
	reqBody := `{"topic_id": "` + rootTopic.ID + `", "topic": "Root Topic", "prompt": "Root Prompt"}`
	req := httptest.NewRequest(http.MethodPost, "/api/exercises", strings.NewReader(reqBody))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	// Handle request
	app.handleExercises(w, req)

	// Verify response
	if w.Code != http.StatusOK {
		t.Fatalf("expected status 200 OK, got %v: %v", w.Code, w.Body.String())
	}

	var response struct {
		Exercises []struct {
			ID           string          `json:"id"`
			TopicID      string          `json:"topic_id"`
			ExerciseJSON json.RawMessage `json:"exercise_json"`
		} `json:"exercises"`
	}

	if err := json.Unmarshal(w.Body.Bytes(), &response); err != nil {
		t.Fatalf("failed to parse response JSON: %v", err)
	}

	if len(response.Exercises) != 1 {
		t.Fatalf("expected 1 exercise, got %d", len(response.Exercises))
	}

	if response.Exercises[0].TopicID != childTopic.ID {
		t.Errorf("expected topic_id %s, got %s", childTopic.ID, response.Exercises[0].TopicID)
	}
}
