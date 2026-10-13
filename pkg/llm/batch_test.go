package llm

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestPollExerciseBatchDropsOverlongSentences(t *testing.T) {
	longSentence := strings.Repeat("Wort ", 17) + "Ende."
	oneLong := buildExercises(10, "one")
	oneLong[2]["correct_german_sentence"] = longSentence
	allLong := buildExercises(10, "all")
	for i := range allLong {
		allLong[i]["correct_german_sentence"] = fmt.Sprintf("%d %s", i, longSentence)
	}

	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/messages/batches/msgbatch_1":
			fmt.Fprintf(w, `{"id":"msgbatch_1","processing_status":"ended","results_url":%q}`, server.URL+"/results")
		case "/results":
			for i, set := range [][]map[string]string{oneLong, allLong} {
				text, _ := json.Marshal(map[string]any{"exercises": set})
				line, _ := json.Marshal(map[string]any{"custom_id": batchCustomID(i), "result": map[string]any{
					"type":    "succeeded",
					"message": map[string]any{"content": []map[string]string{{"type": "text", "text": string(text)}}, "stop_reason": "end_turn"},
				}})
				w.Write(append(line, '\n'))
			}
		default:
			t.Errorf("unexpected %s %s", r.Method, r.URL.Path)
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer server.Close()

	t.Setenv("LLM_PROVIDER", "anthropic")
	t.Setenv("OPENAI_URL", server.URL)
	t.Setenv("OPENAI_API_KEY", "claude-key")
	t.Setenv("MODEL_NAME", "claude-test")

	items := []BatchItem{
		{TopicID: "one-long", Profile: VariationProfile{TargetCount: 10}},
		{TopicID: "all-long", Profile: VariationProfile{TargetCount: 10}},
	}
	ended, results, err := PollExerciseBatch("msgbatch_1", items)
	if err != nil || !ended {
		t.Fatalf("expected ended batch, got ended=%v err=%v", ended, err)
	}
	if got := len(results[0]); got != 9 {
		t.Errorf("expected 9 exercises kept for one-long, got %d", got)
	}
	if _, ok := results[1]; ok {
		t.Errorf("expected all-long to be dropped, got %d exercises", len(results[1]))
	}
}
