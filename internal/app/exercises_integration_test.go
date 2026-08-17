package app

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"

	"german-conjunctions-trainer/pkg/storage"
	"german-conjunctions-trainer/pkg/llm"
)

func setupIntegrationApp(t *testing.T) (*App, func()) {
	dbPath := filepath.Join(t.TempDir(), "test_integration.db")
	store, err := storage.NewSQLiteStorage(dbPath)
	if err != nil {
		t.Fatalf("Failed to create storage: %v", err)
	}
	app := &App{DB: store}

	cleanup := func() {
		store.Close()
	}
	return app, cleanup
}

func TestExerciseIntegration_ParentAndChildTopics(t *testing.T) {
	app, cleanup := setupIntegrationApp(t)
	defer cleanup()

	parent, _ := app.DB.CreateTopic("Parent", "parent prompt", nil, 0)
	child, _ := app.DB.CreateTopic("Child", "child prompt", &parent.ID, 0)

	parentHash := storage.GetPromptHash(parent.Prompt)
	childHash := storage.GetPromptHash(child.Prompt)

	// Seed exercises
	for i := 0; i < 3; i++ {
		app.DB.CreateExercise(parent.ID, parentHash, `{"text": "p"}`, "")
	}
	for i := 0; i < 3; i++ {
		app.DB.CreateExercise(child.ID, childHash, `{"text": "c"}`, "")
	}

	// Requesting exercises for parent should return exercises from both
	reqBody, _ := json.Marshal(llm.GenerateRequest{TopicID: parent.ID})
	req := httptest.NewRequest("POST", "/api/exercises", bytes.NewReader(reqBody))
	req.Header.Set("Content-Type", "application/json")

	rr := httptest.NewRecorder()
	app.handleExercises(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("Expected 200, got %d. Body: %s", rr.Code, rr.Body.String())
	}

	var resp map[string][]map[string]interface{}
	json.Unmarshal(rr.Body.Bytes(), &resp)
	if len(resp["exercises"]) != 6 {
		t.Errorf("Expected 6 exercises (3 parent + 3 child), got %d", len(resp["exercises"]))
	}

	// Requesting exercises for child should return only child's exercises
	reqBodyChild, _ := json.Marshal(llm.GenerateRequest{TopicID: child.ID})
	reqChild := httptest.NewRequest("POST", "/api/exercises", bytes.NewReader(reqBodyChild))
	reqChild.Header.Set("Content-Type", "application/json")

	rrChild := httptest.NewRecorder()
	app.handleExercises(rrChild, reqChild)

	var respChild map[string][]map[string]interface{}
	json.Unmarshal(rrChild.Body.Bytes(), &respChild)
	if len(respChild["exercises"]) != 3 {
		t.Errorf("Expected 3 exercises (child only), got %d", len(respChild["exercises"]))
	}
}

func TestExerciseIntegration_ChangingPromptFiltersOutOldExercises(t *testing.T) {
	app, cleanup := setupIntegrationApp(t)
	defer cleanup()

	topic, _ := app.DB.CreateTopic("Topic", "original prompt", nil, 0)
	originalHash := storage.GetPromptHash(topic.Prompt)

	// Seed 2 exercises with original hash
	app.DB.CreateExercise(topic.ID, originalHash, `{"text": "1"}`, "")
	app.DB.CreateExercise(topic.ID, originalHash, `{"text": "2"}`, "")

	// Update topic prompt
	updatedTopic, err := app.DB.UpdateTopic(topic.ID, "Topic", "new prompt", nil, 0)
	if err != nil {
		t.Fatalf("Failed to update topic: %v", err)
	}

	// New hash
	newHash := storage.GetPromptHash(updatedTopic.Prompt)
	if originalHash == newHash {
		t.Fatalf("Expected hashes to differ")
	}

	// Request exercises. Since none match newHash, it should trigger generation.
	// We'll use an unauthenticated user, wait, guest user gets randomly selected from the filtered list.
	// If the list is empty, guest user gets empty list? Let's check handleExercises logic:
	// "if userID == "" { ... finalExercises = getRandomExercises(allExercises, limit) }"
	// So for guest user, it will return 0 exercises.

	reqBody, _ := json.Marshal(llm.GenerateRequest{TopicID: topic.ID})
	req := httptest.NewRequest("POST", "/api/exercises", bytes.NewReader(reqBody))
	req.Header.Set("Content-Type", "application/json")

	rr := httptest.NewRecorder()
	app.handleExercises(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("Expected 200, got %d", rr.Code)
	}

	var resp map[string][]map[string]interface{}
	json.Unmarshal(rr.Body.Bytes(), &resp)

	if len(resp["exercises"]) != 0 {
		t.Errorf("Expected 0 exercises (filtered out by new prompt hash), got %d", len(resp["exercises"]))
	}
}

func TestExerciseIntegration_AuthenticatedUserSRS(t *testing.T) {
	app, cleanup := setupIntegrationApp(t)
	defer cleanup()

	// Admin user setup just for generating context
	user, _ := app.DB.CreateUser("user123")
	ctx := context.WithValue(context.Background(), userContextKey, user.ID)

	topic, _ := app.DB.CreateTopic("Topic", "prompt", nil, 0)
	hash := storage.GetPromptHash(topic.Prompt)

	// Seed 25 exercises
	var exIDs []string
	for i := 0; i < 25; i++ {
		ex, _ := app.DB.CreateExercise(topic.ID, hash, `{"text": "ex"}`, "")
		exIDs = append(exIDs, ex.ID)
	}

	// Add views for first 10, making them viewed recently (overdueAmount < 0)
	var views []*storage.UserExerciseView
	now := time.Now()
	for i := 0; i < 10; i++ {
		views = append(views, &storage.UserExerciseView{
			UserID:            user.ID,
			ExerciseID:        exIDs[i],
			LastViewed:        now,
			RepetitionCounter: 5,
		})
	}
	app.DB.UpdateUserExerciseViews(views)

	// The remaining 15 exercises are "never-seen" (highest priority)
	// Eligible will be 15, so auto-gen won't trigger.
	// Authenticated request
	reqBody, _ := json.Marshal(llm.GenerateRequest{TopicID: topic.ID})
	req := httptest.NewRequest("POST", "/api/exercises", bytes.NewReader(reqBody))
	req.Header.Set("Content-Type", "application/json")
	req = req.WithContext(ctx)

	rr := httptest.NewRecorder()
	app.handleExercises(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("Expected 200, got %d. Body: %s", rr.Code, rr.Body.String())
	}

	var resp map[string][]map[string]interface{}
	json.Unmarshal(rr.Body.Bytes(), &resp)

	returnedExercises := resp["exercises"]
	if len(returnedExercises) != 10 {
		t.Errorf("Expected 10 exercises returned (capped), got %d", len(returnedExercises))
	}

	// Ensure that the returned exercises do NOT include the recently viewed ones
	for _, rec := range returnedExercises {
		for i := 0; i < 10; i++ {
			if rec["id"] == exIDs[i] {
				t.Errorf("Returned exercise %v was recently viewed and shouldn't be included", rec["id"])
			}
		}
	}
}
