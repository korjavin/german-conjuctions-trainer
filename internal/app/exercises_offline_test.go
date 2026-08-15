package app

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"german-conjunctions-trainer/pkg/llm"
	"german-conjunctions-trainer/pkg/storage"
)

// postExercises runs the batch endpoint as an authenticated user and returns
// the number of exercises in the response.
func postExercises(t *testing.T, app *App, req llm.GenerateRequest) (int, *httptest.ResponseRecorder) {
	t.Helper()
	body, _ := json.Marshal(req)
	r := httptest.NewRequest("POST", "/api/exercises", bytes.NewReader(body))
	r.Header.Set("Content-Type", "application/json")
	r = r.WithContext(context.WithValue(r.Context(), userContextKey, "user1"))

	rr := httptest.NewRecorder()
	app.handleExercises(rr, r)

	var resp map[string][]map[string]interface{}
	json.Unmarshal(rr.Body.Bytes(), &resp)
	return len(resp["exercises"]), rr
}

func TestExerciseBatchLimit(t *testing.T) {
	// Any LLM call would hit this dead address and fail the request, so a 200
	// also proves the cached path was enough.
	t.Setenv("OPENAI_API_KEY", "dummy-key-for-test")
	t.Setenv("OPENAI_URL", "http://127.0.0.1:0/invalid")

	app, mock := setupTestAppWithMock(t)
	topic := &storage.Topic{ID: "t1", Prompt: "my prompt"}
	mock.topics["t1"] = topic
	hash := storage.GetPromptHash(topic.Prompt)
	for i := 0; i < 60; i++ {
		mock.exercises = append(mock.exercises, &storage.Exercise{
			ID: fmt.Sprintf("ex%d", i), TopicID: "t1", PromptHash: hash, ExerciseJSON: `{"test":"test"}`,
		})
	}

	tests := []struct {
		name  string
		limit int
		want  int
	}{
		{"default is 10", 0, 10},
		{"explicit limit honoured", 25, 25},
		{"limit above cap clamps to 50", 100, 50},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got, rr := postExercises(t, app, llm.GenerateRequest{TopicID: "t1", Limit: tc.limit})
			if rr.Code != http.StatusOK {
				t.Fatalf("expected 200, got %d. body: %s", rr.Code, rr.Body.String())
			}
			if got != tc.want {
				t.Errorf("limit=%d: expected %d exercises, got %d", tc.limit, tc.want, got)
			}
		})
	}
}

func TestExerciseSkipGeneration(t *testing.T) {
	// Without skip_generation this fixture (3 < 10 eligible) would call the
	// LLM and fail with 502 (see TestExerciseSelection_AutoGenTriggered).
	t.Setenv("OPENAI_API_KEY", "dummy-key-for-test")
	t.Setenv("OPENAI_URL", "http://127.0.0.1:0/invalid")

	app, mock := setupTestAppWithMock(t)
	topic := &storage.Topic{ID: "t1", Prompt: "my prompt"}
	mock.topics["t1"] = topic
	hash := storage.GetPromptHash(topic.Prompt)
	for i := 0; i < 3; i++ {
		mock.exercises = append(mock.exercises, &storage.Exercise{
			ID: fmt.Sprintf("ex%d", i), TopicID: "t1", PromptHash: hash, ExerciseJSON: `{"test":"test"}`,
		})
	}

	got, rr := postExercises(t, app, llm.GenerateRequest{TopicID: "t1", Limit: 50, SkipGeneration: true})
	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200 (no LLM call), got %d. body: %s", rr.Code, rr.Body.String())
	}
	if got != 3 {
		t.Errorf("expected the 3 cached exercises, got %d", got)
	}
}

// postCompletion posts a single completion for the given user and batch ID.
func postCompletion(t *testing.T, app *App, userID, exerciseID, batchID string, mistakes int) *httptest.ResponseRecorder {
	t.Helper()
	body, _ := json.Marshal(map[string]interface{}{
		"client_batch_id": batchID,
		"completions": []map[string]interface{}{
			{"exercise_id": exerciseID, "hints_used": 0, "mistakes": mistakes},
		},
	})
	r := httptest.NewRequest("POST", "/api/exercises/complete", bytes.NewReader(body))
	r.Header.Set("Content-Type", "application/json")
	r = r.WithContext(context.WithValue(r.Context(), userContextKey, userID))

	rr := httptest.NewRecorder()
	app.handleExercisesComplete(rr, r)
	return rr
}

func TestCompletionIdempotency(t *testing.T) {
	app, cleanup := setupIntegrationApp(t)
	defer cleanup()

	user, err := app.DB.CreateUser("google-offline")
	if err != nil {
		t.Fatalf("failed to create user: %v", err)
	}
	topic, _ := app.DB.CreateTopic("Topic", "prompt", nil, 0)
	ex, err := app.DB.CreateExercise(topic.ID, storage.GetPromptHash(topic.Prompt), `{"text":"x"}`, "")
	if err != nil {
		t.Fatalf("failed to create exercise: %v", err)
	}

	// Perfect completion, replayed with the same batch ID.
	for i := 0; i < 2; i++ {
		if rr := postCompletion(t, app, user.ID, ex.ID, "batch-1", 0); rr.Code != http.StatusOK {
			t.Fatalf("attempt %d: expected 200, got %d: %s", i+1, rr.Code, rr.Body.String())
		}
	}

	views, err := app.DB.GetUserExerciseViews(user.ID)
	if err != nil {
		t.Fatalf("failed to get views: %v", err)
	}
	view := views[ex.ID]
	if view == nil {
		t.Fatalf("expected a view for exercise %s", ex.ID)
	}
	if view.TotalAttempts != 1 {
		t.Errorf("replayed batch double-counted attempts: got %d, want 1", view.TotalAttempts)
	}
	if view.RepetitionCounter != 1 {
		t.Errorf("replayed batch double-moved the SRS counter: got %d, want 1", view.RepetitionCounter)
	}

	// A different batch ID is a genuinely new submission and must apply.
	if rr := postCompletion(t, app, user.ID, ex.ID, "batch-2", 0); rr.Code != http.StatusOK {
		t.Fatalf("expected 200 for batch-2, got %d: %s", rr.Code, rr.Body.String())
	}
	views, _ = app.DB.GetUserExerciseViews(user.ID)
	if views[ex.ID].TotalAttempts != 2 {
		t.Errorf("new batch was not applied: TotalAttempts got %d, want 2", views[ex.ID].TotalAttempts)
	}

	// Without a batch ID behavior is unchanged: every call counts.
	if rr := postCompletion(t, app, user.ID, ex.ID, "", 0); rr.Code != http.StatusOK {
		t.Fatalf("expected 200 without batch id, got %d: %s", rr.Code, rr.Body.String())
	}
	views, _ = app.DB.GetUserExerciseViews(user.ID)
	if views[ex.ID].TotalAttempts != 3 {
		t.Errorf("unbatched completion was not applied: TotalAttempts got %d, want 3", views[ex.ID].TotalAttempts)
	}
}

func TestCompletionRejectsOversizedBatchID(t *testing.T) {
	app, cleanup := setupIntegrationApp(t)
	defer cleanup()

	long := make([]byte, maxClientBatchIDLen+1)
	for i := range long {
		long[i] = 'a'
	}
	if rr := postCompletion(t, app, "user1", "ex1", string(long), 0); rr.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for oversized client_batch_id, got %d", rr.Code)
	}
}
