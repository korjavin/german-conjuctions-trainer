package llm

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"german-conjunctions-trainer/pkg/storage"
)

func TestRefinePrompt(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		writeChatChoice(w, http.StatusOK, "This is a refined prompt that returns json output.")
	}))
	defer server.Close()

	refinedPrompt, err := RefinePrompt("Base prompt", "fake-api-key", server.URL, "test-model")
	if err != nil {
		t.Fatalf("Expected no error, but got: %v", err)
	}
	if !strings.Contains(refinedPrompt, "json") {
		t.Fatalf("Expected refined prompt to contain json, got: %s", refinedPrompt)
	}
}

func TestGenerateExercisesVariationProfileSuccess(t *testing.T) {
	t.Setenv("ENABLE_PROMPT_REFINEMENT", "false")

	var capturedPrompt string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var reqBody map[string]interface{}
		body, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(body, &reqBody)

		messages := reqBody["messages"].([]interface{})
		capturedPrompt = messages[0].(map[string]interface{})["content"].(string)
		exercises := buildExercises(10, "valid")
		writeChatChoice(w, http.StatusOK, mustJSONString(t, map[string]interface{}{"exercises": exercises}))
	}))
	defer server.Close()

	topic := &storage.Topic{ID: "topic-1", Prompt: "Generate B1 exercises."}
	exercises, err := GenerateExercises(topic, "fake-api-key", server.URL, "test-model")
	if err != nil {
		t.Fatalf("Expected no error, got: %v", err)
	}
	if len(exercises) != 10 {
		t.Fatalf("Expected 10 exercises, got %d", len(exercises))
	}
	if !strings.Contains(capturedPrompt, "System-generated variation profile") {
		t.Fatalf("Expected variation profile block in prompt, got: %s", capturedPrompt)
	}
	if !strings.Contains(capturedPrompt, "json") {
		t.Fatalf("Expected lowercase json in prompt, got: %s", capturedPrompt)
	}
}

func TestGenerateExercisesRetriesOnMissingJSONKeywordError(t *testing.T) {
	t.Setenv("ENABLE_PROMPT_REFINEMENT", "false")

	var generationCalls int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var reqBody map[string]interface{}
		body, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(body, &reqBody)

		if _, ok := reqBody["response_format"]; ok {
			call := atomic.AddInt32(&generationCalls, 1)
			if call == 1 {
				w.WriteHeader(http.StatusBadRequest)
				_ = json.NewEncoder(w).Encode(map[string]interface{}{
					"error": map[string]interface{}{
						"message": "Prompt must contain the word 'json' in some form to use 'response_format' of type 'json_object'.",
					},
				})
				return
			}
			exercises := buildExercises(10, "retry")
			writeChatChoice(w, http.StatusOK, mustJSONString(t, map[string]interface{}{"exercises": exercises}))
			return
		}

		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer server.Close()

	topic := &storage.Topic{ID: "topic-2", Prompt: "Generate B1 exercises."}
	exercises, err := GenerateExercises(topic, "fake-api-key", server.URL, "test-model")
	if err != nil {
		t.Fatalf("Expected no error after retry, got: %v", err)
	}
	if len(exercises) != 10 {
		t.Fatalf("Expected 10 exercises, got %d", len(exercises))
	}
	if atomic.LoadInt32(&generationCalls) != 2 {
		t.Fatalf("Expected 2 generation calls, got %d", generationCalls)
	}

	debug := GetLastGenerationDebugInfo()
	if debug.ProviderRetryCount < 1 {
		t.Fatalf("Expected provider retry count >= 1, got %d", debug.ProviderRetryCount)
	}
}

func TestGenerateExercisesQualityGateRetry(t *testing.T) {
	t.Setenv("ENABLE_PROMPT_REFINEMENT", "false")

	var generationCalls int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var reqBody map[string]interface{}
		body, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(body, &reqBody)

		if _, ok := reqBody["response_format"]; ok {
			call := atomic.AddInt32(&generationCalls, 1)
			if call == 1 {
				dup := buildDuplicateExercises(10)
				writeChatChoice(w, http.StatusOK, mustJSONString(t, map[string]interface{}{"exercises": dup}))
				return
			}
			exercises := buildExercises(10, "quality")
			writeChatChoice(w, http.StatusOK, mustJSONString(t, map[string]interface{}{"exercises": exercises}))
			return
		}

		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer server.Close()

	topic := &storage.Topic{ID: "topic-3", Prompt: "Generate B1 exercises."}
	exercises, err := GenerateExercises(topic, "fake-api-key", server.URL, "test-model")
	if err != nil {
		t.Fatalf("Expected successful corrective retry, got: %v", err)
	}
	if len(exercises) != 10 {
		t.Fatalf("Expected 10 exercises, got %d", len(exercises))
	}
	if atomic.LoadInt32(&generationCalls) != 2 {
		t.Fatalf("Expected 2 generation calls, got %d", generationCalls)
	}

	debug := GetLastGenerationDebugInfo()
	if debug.QualityGateRetryCount != 1 {
		t.Fatalf("Expected quality gate retry count 1, got %d", debug.QualityGateRetryCount)
	}
	if len(debug.QualityGateFailures) == 0 {
		t.Fatalf("Expected quality gate failures to be recorded")
	}
}

func TestGenerateExercisesRefinementFallbackWhenMalformed(t *testing.T) {
	t.Setenv("ENABLE_PROMPT_REFINEMENT", "true")

	var sawRefineCall bool
	var generationPrompt string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var reqBody map[string]interface{}
		body, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(body, &reqBody)

		if _, ok := reqBody["response_format"]; ok {
			messages := reqBody["messages"].([]interface{})
			generationPrompt = messages[0].(map[string]interface{})["content"].(string)
			exercises := buildExercises(10, "refine-fallback")
			writeChatChoice(w, http.StatusOK, mustJSONString(t, map[string]interface{}{"exercises": exercises}))
			return
		}

		sawRefineCall = true
		// Malformed for refinement (looks like exercises payload), should trigger fallback.
		writeChatChoice(w, http.StatusOK, `{"exercises":[{"english_hint":"x","correct_german_sentence":"y"}]}`)
	}))
	defer server.Close()

	basePrompt := "Generate grammar exercises and return json."
	topic := &storage.Topic{ID: "topic-4", Prompt: basePrompt}
	exercises, err := GenerateExercises(topic, "fake-api-key", server.URL, "test-model")
	if err != nil {
		t.Fatalf("Expected successful fallback generation, got: %v", err)
	}
	if len(exercises) != 10 {
		t.Fatalf("Expected 10 exercises, got %d", len(exercises))
	}
	if !sawRefineCall {
		t.Fatalf("Expected refinement call when feature flag is enabled")
	}
	if !strings.Contains(generationPrompt, "System-generated variation profile") {
		t.Fatalf("Expected generation prompt to include composed profile, got: %s", generationPrompt)
	}

	debug := GetLastGenerationDebugInfo()
	if !debug.RefinementEnabled {
		t.Fatalf("Expected refinement to be enabled in debug info")
	}
	if debug.RefinementUsed {
		t.Fatalf("Expected refinement_used=false due to malformed refinement output")
	}
	if debug.RefinementError == "" {
		t.Fatalf("Expected refinement_error to be populated")
	}
}

func buildExercises(count int, prefix string) []map[string]string {
	exercises := make([]map[string]string, 0, count)
	for i := 1; i <= count; i++ {
		exercises = append(exercises, map[string]string{
			"english_hint":            fmt.Sprintf("%s hint %d", prefix, i),
			"correct_german_sentence": fmt.Sprintf("Ich lerne heute Deutsch Nummer %d mit einem neuen Beispiel.", i),
		})
	}
	return exercises
}

func buildDuplicateExercises(count int) []map[string]string {
	exercises := make([]map[string]string, 0, count)
	for i := 1; i <= count; i++ {
		exercises = append(exercises, map[string]string{
			"english_hint":            fmt.Sprintf("duplicate hint %d", i),
			"correct_german_sentence": "Ich lerne heute Deutsch mit einem neuen Beispiel.",
		})
	}
	return exercises
}

func writeChatChoice(w http.ResponseWriter, status int, content string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"choices": []map[string]interface{}{
			{
				"message": map[string]interface{}{
					"content": content,
				},
			},
		},
	})
}

func mustJSONString(t *testing.T, payload interface{}) string {
	t.Helper()
	bytes, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("failed to marshal payload: %v", err)
	}
	return string(bytes)
}
