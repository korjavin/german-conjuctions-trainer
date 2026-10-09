package app

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync"
	"testing"

	"german-conjunctions-trainer/pkg/llm"
	"german-conjunctions-trainer/pkg/storage"
)

// TestPregenBatchLifecycle drives the job against a fake Message Batches API:
// rejected submit (no credits), submit, restart while in flight, results.
func TestPregenBatchLifecycle(t *testing.T) {
	var mu sync.Mutex
	submits, creditsOut, status := 0, true, "in_progress"
	var customIDs []string
	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		defer mu.Unlock()
		if r.Header.Get("x-api-key") != "claude-key" || r.Header.Get("anthropic-version") == "" {
			t.Errorf("missing auth headers on %s", r.URL.Path)
		}
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/messages/batches":
			submits++
			if creditsOut {
				w.WriteHeader(http.StatusBadRequest)
				w.Write([]byte(`{"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low"}}`))
				return
			}
			var body struct {
				Requests []struct {
					CustomID string `json:"custom_id"`
					Params   struct {
						Model        string          `json:"model"`
						OutputConfig json.RawMessage `json:"output_config"`
					} `json:"params"`
				} `json:"requests"`
			}
			json.NewDecoder(r.Body).Decode(&body)
			customIDs = nil
			for _, req := range body.Requests {
				if req.Params.Model != "claude-test" || len(req.Params.OutputConfig) != 0 {
					t.Errorf("bad params: %+v", req.Params)
				}
				customIDs = append(customIDs, req.CustomID)
			}
			w.Write([]byte(`{"id":"msgbatch_1","type":"message_batch","processing_status":"in_progress","results_url":null}`))
		case r.Method == http.MethodGet && r.URL.Path == "/messages/batches/msgbatch_1":
			resultsURL := "null"
			if status == "ended" {
				resultsURL = `"` + server.URL + `/messages/batches/msgbatch_1/results"`
			}
			fmt.Fprintf(w, `{"id":"msgbatch_1","processing_status":%q,"results_url":%s}`, status, resultsURL)
		case r.Method == http.MethodGet && r.URL.Path == "/messages/batches/msgbatch_1/results":
			exercises := make([]map[string]string, 10)
			for i := range exercises {
				exercises[i] = map[string]string{
					"english_hint":            fmt.Sprintf("hint %d", i),
					"correct_german_sentence": fmt.Sprintf("Ich lerne heute Deutsch Nummer %d mit einem neuen Beispiel.", i),
				}
			}
			text, _ := json.Marshal(map[string]any{"exercises": exercises})
			for _, id := range customIDs {
				line, _ := json.Marshal(map[string]any{"custom_id": id, "result": map[string]any{"type": "succeeded", "message": map[string]any{
					"content": []map[string]string{{"type": "text", "text": "```json\n" + string(text) + "\n```"}}, "stop_reason": "end_turn",
				}}})
				w.Write(append(line, '\n'))
			}
			w.Write([]byte(`{"custom_id":"t99","result":{"type":"errored","error":{"type":"error"}}}` + "\n"))
		default:
			t.Errorf("unexpected %s %s", r.Method, r.URL.Path)
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer server.Close()

	t.Setenv("LLM_PROVIDER", "anthropic")
	t.Setenv("LLM_BATCH_MIN_POOL", "1")
	t.Setenv("OPENAI_URL", server.URL)
	t.Setenv("OPENAI_API_KEY", "claude-key")
	t.Setenv("MODEL_NAME", "claude-test")

	dbPath := filepath.Join(t.TempDir(), "pregen.db")
	store, err := storage.NewSQLiteStorage(dbPath)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	empty, _ := store.CreateTopic("Empty", "B1 Nebensätze mit weil.", nil, 0)
	full, _ := store.CreateTopic("Full", "B1 Nebensätze mit obwohl.", nil, 1)
	store.CreateExercise(full.ID, storage.GetPromptHash(full.Prompt), `{}`, "")

	threshold := pregenThreshold()
	if threshold != 1 {
		t.Fatalf("threshold = %d", threshold)
	}
	a := &App{DB: store, DBPath: dbPath}
	statePath := a.pregenStatePath()
	count := func() int {
		ex, _ := store.GetExercisesForTopic(empty.ID, storage.GetPromptHash(empty.Prompt))
		return len(ex)
	}
	submitted := func() int { mu.Lock(); defer mu.Unlock(); return submits }

	// No credits: the submit is rejected, the cycle is skipped, nothing persists.
	a.pregenCycle(threshold)
	if _, err := os.Stat(statePath); !os.IsNotExist(err) || submitted() != 1 {
		t.Fatalf("rejected batch left state (err=%v) or submits=%d", err, submitted())
	}

	mu.Lock()
	creditsOut = false
	mu.Unlock()
	a.pregenCycle(threshold)
	mu.Lock()
	requests := len(customIDs)
	mu.Unlock()
	if _, err := os.Stat(statePath); err != nil || submitted() != 2 || requests != 1 {
		t.Fatalf("submit: state err=%v submits=%d requests=%d (only the empty topic is below threshold)", err, submitted(), requests)
	}

	// Restart while in flight: a fresh App resumes polling, no resubmit.
	a = &App{DB: store, DBPath: dbPath}
	a.pregenCycle(threshold)
	if submitted() != 2 || count() != 0 {
		t.Fatalf("restart resubmitted (submits=%d) or stored early (%d)", submitted(), count())
	}

	mu.Lock()
	status = "ended"
	mu.Unlock()
	a.pregenCycle(threshold)
	if count() != 10 {
		t.Fatalf("stored %d exercises, want 10", count())
	}
	if _, err := os.Stat(statePath); !os.IsNotExist(err) {
		t.Fatalf("state not cleared: %v", err)
	}

	// Pool is topped up: the next cycle submits nothing.
	a.pregenCycle(threshold)
	if submitted() != 2 {
		t.Fatalf("topped-up pool resubmitted: submits=%d", submitted())
	}
}

// TestPregenBackoff: a topic whose batch item failed is not resubmitted on the
// next cycles, and a success clears it.
func TestPregenBackoff(t *testing.T) {
	t.Setenv("LLM_PROVIDER", "anthropic")
	dbPath := filepath.Join(t.TempDir(), "pregen.db")
	store, err := storage.NewSQLiteStorage(dbPath)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	topic, _ := store.CreateTopic("Bad", "B1 Nebensätze mit weil.", nil, 0)
	a := &App{DB: store, DBPath: dbPath}
	items, _ := a.pregenItems(1)
	if len(items) != 1 {
		t.Fatalf("want 1 item, got %d", len(items))
	}

	a.notePregenOutcomes(items, map[int][]llm.GeneratedExercise{})
	if got, _ := a.pregenItems(1); len(got) != 0 {
		t.Fatalf("failed topic resubmitted right away")
	}
	first := a.pregenBackoff[topic.ID].until
	a.notePregenOutcomes(items, map[int][]llm.GeneratedExercise{})
	if b := a.pregenBackoff[topic.ID]; b.fails != 2 || !b.until.After(first) {
		t.Fatalf("backoff did not grow: %+v (first until %s)", b, first)
	}

	a.notePregenOutcomes(items, map[int][]llm.GeneratedExercise{0: {{}}})
	if got, _ := a.pregenItems(1); len(got) != 1 {
		t.Fatalf("success did not clear the backoff")
	}
}
