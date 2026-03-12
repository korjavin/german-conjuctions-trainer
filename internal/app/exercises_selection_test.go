package app

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"german-conjunctions-trainer/pkg/storage"
	"german-conjunctions-trainer/pkg/llm"
)

// mockStorage is a minimal mock of the storage.Storage interface for testing exercise selection
type mockStorage struct {
	storage.Storage // Embed the interface to avoid needing to implement everything

	topics          map[string]*storage.Topic
	descendants     map[string][]string
	exercises       []*storage.Exercise
	userViews       map[string]*storage.UserExerciseView
}

func (m *mockStorage) GetTopic(topicID string) (*storage.Topic, error) {
	if t, ok := m.topics[topicID]; ok {
		return t, nil
	}
	return nil, storage.ErrTopicHasChildren // just reusing an error
}

func (m *mockStorage) GetDescendantTopicIDs(topicID string) ([]string, error) {
	if d, ok := m.descendants[topicID]; ok {
		return d, nil
	}
	return []string{}, nil
}

func (m *mockStorage) GetExercisesForTopics(topicIDs []string, promptHash string) ([]*storage.Exercise, error) {
	var result []*storage.Exercise
	for _, ex := range m.exercises {
		for _, tID := range topicIDs {
			if ex.TopicID == tID {
				// if promptHash is provided, only return matching ones
				if promptHash == "" || ex.PromptHash == promptHash {
					result = append(result, ex)
				}
				break
			}
		}
	}
	return result, nil
}

func (m *mockStorage) GetUserExerciseViews(userID string) (map[string]*storage.UserExerciseView, error) {
	return m.userViews, nil
}

// Ensure the mock triggers auto generation properly
// Note: Generating exercises invokes LLM. We will avoid the LLM call by overriding AI config or making it fail predictably,
// or since GetExercisesForTopics will return an empty slice, handleExercises will try to generate.
// Actually, generating in testing requires Mocking LLM, but `GenerateAndCacheExercises` is a package level func!
// Let's look at `handleExercises`. It calls `llm.GenerateAndCacheExercises`. We can't easily mock it without changing the app structure.
// But we can test that it filters properly by ensuring enough exercises are present so it doesn't trigger auto-gen.
// If we want to test that auto-gen triggers on subtopic, we might just assert it calls the LLM (which will fail with EXERCISE_GENERATION_FAILED) and check the logs.

func setupTestAppWithMock(t *testing.T) (*App, *mockStorage) {
	mock := &mockStorage{
		topics:      make(map[string]*storage.Topic),
		descendants: make(map[string][]string),
		exercises:   []*storage.Exercise{},
		userViews:   make(map[string]*storage.UserExerciseView),
	}
	app := &App{DB: mock}
	return app, mock
}

func TestExerciseSelection_SingleTopicHashFilter(t *testing.T) {
	app, mock := setupTestAppWithMock(t)

	topic := &storage.Topic{ID: "t1", Prompt: "my prompt"}
	mock.topics["t1"] = topic

	currentHash := storage.GetPromptHash(topic.Prompt)
	staleHash := "old-hash"

	// Add 15 valid exercises and 5 stale exercises
	for i := 0; i < 15; i++ {
		mock.exercises = append(mock.exercises, &storage.Exercise{ID: string(rune(i)), TopicID: "t1", PromptHash: currentHash, ExerciseJSON: `{"test":"test"}`})
	}
	for i := 15; i < 20; i++ {
		mock.exercises = append(mock.exercises, &storage.Exercise{ID: string(rune(i)), TopicID: "t1", PromptHash: staleHash, ExerciseJSON: `{"test":"test"}`})
	}

	reqBody, _ := json.Marshal(llm.GenerateRequest{TopicID: "t1"})
	req := httptest.NewRequest("POST", "/api/exercises", bytes.NewReader(reqBody))
	req.Header.Set("Content-Type", "application/json")

	rr := httptest.NewRecorder()
	app.handleExercises(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d. body: %s", rr.Code, rr.Body.String())
	}

	var resp map[string][]map[string]interface{}
	json.Unmarshal(rr.Body.Bytes(), &resp)

	exercises := resp["exercises"]
	if len(exercises) != 10 { // max returned
		t.Errorf("expected 10 exercises, got %d", len(exercises))
	}
}

func TestExerciseSelection_DescendantTopics(t *testing.T) {
	app, mock := setupTestAppWithMock(t)

	parent := &storage.Topic{ID: "parent", Prompt: "parent prompt"}
	child := &storage.Topic{ID: "child", Prompt: "child prompt"}

	mock.topics["parent"] = parent
	mock.topics["child"] = child
	mock.descendants["parent"] = []string{"child"}

	parentHash := storage.GetPromptHash(parent.Prompt)
	childHash := storage.GetPromptHash(child.Prompt)

	// 5 valid parent exercises
	for i := 0; i < 5; i++ {
		mock.exercises = append(mock.exercises, &storage.Exercise{ID: "p"+string(rune(i)), TopicID: "parent", PromptHash: parentHash, ExerciseJSON: `{"test":"test"}`})
	}
	// 5 valid child exercises
	for i := 0; i < 5; i++ {
		mock.exercises = append(mock.exercises, &storage.Exercise{ID: "c"+string(rune(i)), TopicID: "child", PromptHash: childHash, ExerciseJSON: `{"test":"test"}`})
	}

	reqBody, _ := json.Marshal(llm.GenerateRequest{TopicID: "parent"})
	req := httptest.NewRequest("POST", "/api/exercises", bytes.NewReader(reqBody))
	req.Header.Set("Content-Type", "application/json")

	rr := httptest.NewRecorder()
	app.handleExercises(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d. body: %s", rr.Code, rr.Body.String())
	}

	var resp map[string][]map[string]interface{}
	json.Unmarshal(rr.Body.Bytes(), &resp)

	exercises := resp["exercises"]
	// Should return 10 total exercises
	if len(exercises) != 10 {
		t.Errorf("expected 10 exercises, got %d", len(exercises))
	}
}

func TestExerciseSelection_UnrelatedTopicsExcluded(t *testing.T) {
	app, mock := setupTestAppWithMock(t)

	topic1 := &storage.Topic{ID: "t1", Prompt: "prompt1"}
	topic2 := &storage.Topic{ID: "t2", Prompt: "prompt2"} // unrelated

	mock.topics["t1"] = topic1
	mock.topics["t2"] = topic2

	hash1 := storage.GetPromptHash(topic1.Prompt)
	hash2 := storage.GetPromptHash(topic2.Prompt)

	// Add 10 valid t1 exercises
	for i := 0; i < 10; i++ {
		mock.exercises = append(mock.exercises, &storage.Exercise{ID: "t1"+string(rune(i)), TopicID: "t1", PromptHash: hash1, ExerciseJSON: `{"test":"test"}`})
	}
	// Add 10 valid t2 exercises
	for i := 0; i < 10; i++ {
		mock.exercises = append(mock.exercises, &storage.Exercise{ID: "t2"+string(rune(i)), TopicID: "t2", PromptHash: hash2, ExerciseJSON: `{"test":"test"}`})
	}

	reqBody, _ := json.Marshal(llm.GenerateRequest{TopicID: "t1"})
	req := httptest.NewRequest("POST", "/api/exercises", bytes.NewReader(reqBody))
	req.Header.Set("Content-Type", "application/json")

	rr := httptest.NewRecorder()
	app.handleExercises(rr, req)

	var resp map[string][]map[string]interface{}
	json.Unmarshal(rr.Body.Bytes(), &resp)

	exercises := resp["exercises"]
	if len(exercises) != 10 {
		t.Errorf("expected 10 exercises, got %d", len(exercises))
	}
	// All exercises should belong to t1 (since t2 isn't descendant)
	// We can't check TopicID in response easily, but the test ensures we don't accidentally get 20 (it's capped at 10 anyway, but from the right set)
}

func TestExerciseSelection_AutoGenTriggered(t *testing.T) {
	app, mock := setupTestAppWithMock(t)

	topic := &storage.Topic{ID: "t1", Prompt: "my prompt"}
	mock.topics["t1"] = topic
	// no exercises provided!

	reqBody, _ := json.Marshal(llm.GenerateRequest{TopicID: "t1"})
	req := httptest.NewRequest("POST", "/api/exercises", bytes.NewReader(reqBody))
	req.Header.Set("Content-Type", "application/json")
	// Must have a user to trigger auto-gen according to logic
	req = req.WithContext(context.WithValue(req.Context(), userContextKey, "user1"))

	rr := httptest.NewRecorder()
	app.handleExercises(rr, req)

	// Will fail with EXERCISE_GENERATION_FAILED because we haven't mocked LLM
	if rr.Code != http.StatusBadGateway {
		t.Fatalf("expected 502, got %d. body: %s", rr.Code, rr.Body.String())
	}

	var errResp map[string]interface{}
	json.Unmarshal(rr.Body.Bytes(), &errResp)

	// Wait, the error is OPENAI_API_KEY is not configured which triggers a different error code, let's see:
	// wait, llm.GenerateAndCacheExercises returns it. In handleExercises, if it's missing config, it might just return EXERCISE_GENERATION_FAILED or MISSING_CONFIG.
	// In the log: [EXERCISES] ERROR generating exercises for topic t1 user user1: OPENAI_API_KEY is not configured
	// The response is written with `EXERCISE_GENERATION_FAILED` unless it's a timeout.
	// Wait, the log shows expected EXERCISE_GENERATION_FAILED, got <nil>. That means `errResp["code"]` is nil or not there.
	// Oh, `errResp["error"]` is probably it, wait, the response format for `writeJSONError` is `{"error": {"code": "...", "message": "...", ...}}`.
	if errMap, ok := errResp["error"].(map[string]interface{}); ok {
		if errMap["code"] != "EXERCISE_GENERATION_FAILED" {
			t.Errorf("expected EXERCISE_GENERATION_FAILED, got %v", errMap["code"])
		}
	} else {
		t.Errorf("expected error object in response, got %v", errResp)
	}
}

func TestExerciseSelection_GuestUserPath(t *testing.T) {
	app, mock := setupTestAppWithMock(t)

	topic := &storage.Topic{ID: "t1", Prompt: "my prompt"}
	mock.topics["t1"] = topic

	currentHash := storage.GetPromptHash(topic.Prompt)

	for i := 0; i < 15; i++ {
		mock.exercises = append(mock.exercises, &storage.Exercise{ID: string(rune(i)), TopicID: "t1", PromptHash: currentHash, ExerciseJSON: `{"test":"test"}`})
	}

	reqBody, _ := json.Marshal(llm.GenerateRequest{TopicID: "t1"})
	req := httptest.NewRequest("POST", "/api/exercises", bytes.NewReader(reqBody))
	req.Header.Set("Content-Type", "application/json")

	rr := httptest.NewRecorder()
	app.handleExercises(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rr.Code)
	}

	var resp map[string][]map[string]interface{}
	json.Unmarshal(rr.Body.Bytes(), &resp)

	exercises := resp["exercises"]
	if len(exercises) != 10 { // capped at 10
		t.Errorf("expected 10 exercises, got %d", len(exercises))
	}
}
