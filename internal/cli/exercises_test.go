package cli

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestGenerateExercisesRoundTrip(t *testing.T) {
	var captured map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/api/exercises" {
			t.Errorf("got %s %s, want POST /api/exercises", r.Method, r.URL.Path)
		}
		if err := json.NewDecoder(r.Body).Decode(&captured); err != nil {
			t.Fatalf("decode body: %v", err)
		}
		_, _ = w.Write([]byte(`{"exercises":[
			{"id":"e1","topic_id":"t1","exercise_json":{"english_hint":"hi","correct_german_sentence":"Hallo"},"is_favorite":false,"repetition_counter":0},
			{"id":"e2","topic_id":"t1","exercise_json":{"english_hint":"bye","correct_german_sentence":"Tschüss"},"is_favorite":true,"repetition_counter":3}
		]}`))
	}))
	defer srv.Close()

	c := NewClient(srv.URL, "tok")
	got, err := c.GenerateExercises("t1")
	if err != nil {
		t.Fatalf("GenerateExercises: %v", err)
	}
	if len(got) != 2 {
		t.Fatalf("len = %d, want 2", len(got))
	}
	if got[0].ID != "e1" || got[1].ID != "e2" {
		t.Errorf("ids = %v", []string{got[0].ID, got[1].ID})
	}
	if got[1].IsFavorite != true || got[1].RepetitionCounter != 3 {
		t.Errorf("e2 favorite/counter = %v/%d", got[1].IsFavorite, got[1].RepetitionCounter)
	}
	// Verify exercise_json is round-tripped intact as a raw JSON blob.
	var inner struct {
		EnglishHint string `json:"english_hint"`
	}
	if err := json.Unmarshal(got[0].ExerciseJSON, &inner); err != nil {
		t.Fatalf("decode exercise_json: %v", err)
	}
	if inner.EnglishHint != "hi" {
		t.Errorf("english_hint = %q", inner.EnglishHint)
	}
	if captured["topic_id"] != "t1" {
		t.Errorf("body.topic_id = %v", captured["topic_id"])
	}
}

func TestGenerateExercisesEmptyTopicErrors(t *testing.T) {
	c := NewClient("http://example", "tok")
	if _, err := c.GenerateExercises(""); err == nil {
		t.Fatal("expected error for empty topic id")
	}
}

func TestGenerateExercisesSurface404(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, `{"error":"TOPIC_NOT_FOUND","message":"Topic not found"}`, http.StatusNotFound)
	}))
	defer srv.Close()

	c := NewClient(srv.URL, "tok")
	_, err := c.GenerateExercises("missing")
	if !errors.Is(err, ErrNotFound) {
		t.Errorf("errors.Is(err, ErrNotFound) = false: %v", err)
	}
	var apiErr *APIError
	if !errors.As(err, &apiErr) {
		t.Fatalf("expected *APIError, got %T", err)
	}
	if !strings.Contains(apiErr.Body, "TOPIC_NOT_FOUND") {
		t.Errorf("APIError body = %q, want 'TOPIC_NOT_FOUND'", apiErr.Body)
	}
}

func TestGenerateExercisesSurface500BodyText(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "LLM upstream exploded", http.StatusInternalServerError)
	}))
	defer srv.Close()

	c := NewClient(srv.URL, "tok")
	_, err := c.GenerateExercises("t1")
	if err == nil {
		t.Fatal("expected error")
	}
	var apiErr *APIError
	if !errors.As(err, &apiErr) {
		t.Fatalf("expected *APIError, got %T", err)
	}
	if apiErr.StatusCode != http.StatusInternalServerError {
		t.Errorf("StatusCode = %d, want 500", apiErr.StatusCode)
	}
	if !strings.Contains(apiErr.Body, "LLM upstream exploded") {
		t.Errorf("APIError body = %q, want server text", apiErr.Body)
	}
}

func TestGenerateExercisesNilExercises(t *testing.T) {
	// The server returns `"exercises": null` for guest callers with no cache.
	// Make sure the client surfaces that as a nil slice rather than erroring.
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"exercises": null}`))
	}))
	defer srv.Close()

	c := NewClient(srv.URL, "tok")
	got, err := c.GenerateExercises("t1")
	if err != nil {
		t.Fatalf("GenerateExercises: %v", err)
	}
	if len(got) != 0 {
		t.Errorf("len = %d, want 0", len(got))
	}
}
