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
		writeChatChoice(w, http.StatusOK, "Enhanced topic: B1 conjunctions in daily life and work contexts, varied vocabulary.")
	}))
	defer server.Close()

	refinedPrompt, err := RefinePrompt("Base prompt", "fake-api-key", server.URL, "test-model")
	if err != nil {
		t.Fatalf("Expected no error, but got: %v", err)
	}
	if strings.TrimSpace(refinedPrompt) == "" {
		t.Fatalf("Expected non-empty refined prompt, got empty string")
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
	exercises, err := GenerateExercises(topic, "fake-api-key", server.URL, "test-model", "")
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
	exercises, err := GenerateExercises(topic, "fake-api-key", server.URL, "test-model", "")
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
	exercises, err := GenerateExercises(topic, "fake-api-key", server.URL, "test-model", "")
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

func TestBuildGenerationPromptAddsPreambleForSimpleIntent(t *testing.T) {
	profile := VariationProfile{
		TargetCount:      10,
		DifficultyLevel:  "B1",
		MaxRepetitionPerTerm: 2,
	}

	simpleIntent := "B1 level, um..zu conjunctions"
	result := BuildGenerationPrompt(simpleIntent, profile)

	if !strings.HasPrefix(result, "You are an expert") {
		t.Fatalf("Expected result to start with 'You are an expert', got: %s", result)
	}
	if !strings.Contains(result, "Create German language exercises based on the following topic description:") {
		t.Fatalf("Expected topic description framing in result, got: %s", result)
	}
	if !strings.Contains(result, "B1 level, um..zu conjunctions") {
		t.Fatalf("Expected original intent to be preserved, got: %s", result)
	}
	if !strings.Contains(result, "System-generated variation profile") {
		t.Fatalf("Expected variation profile in result, got: %s", result)
	}
}

func TestBuildGenerationPromptNoPreambleForFullPrompt(t *testing.T) {
	profile := VariationProfile{
		TargetCount:      10,
		DifficultyLevel:  "B1",
		MaxRepetitionPerTerm: 2,
	}

	fullPrompt := "You are an expert German language tutor. Generate exercises."
	result := BuildGenerationPrompt(fullPrompt, profile)

	// Count how many times the preamble appears
	preamble := "You are an expert German language tutor. Create German language exercises based on the following topic description:"
	count := strings.Count(result, preamble)

	if count > 1 {
		t.Fatalf("Expected preamble to NOT be duplicated, found %d occurrences, got: %s", count, result)
	}
	// Should still contain the original "You are an expert German language tutor" but only once
	if strings.Count(result, "You are an expert German language tutor") != 1 {
		t.Fatalf("Expected original preamble to appear exactly once, got: %s", result)
	}
	if !strings.Contains(result, "System-generated variation profile") {
		t.Fatalf("Expected variation profile in result, got: %s", result)
	}
}

func TestBuildGenerationPromptNoPreambleForIntentStartingWithYouAre(t *testing.T) {
	// Test that a prompt starting with "You are" (even without expert role keywords)
	// does NOT get duplicate boilerplate. Any prompt starting with "you are" is
	// considered to have a preamble.
	profile := VariationProfile{
		TargetCount:      10,
		DifficultyLevel:  "B1",
		MaxRepetitionPerTerm: 2,
	}

	intentWithYouAre := "You are a traveler in Germany wanting to practice ordering food"
	result := BuildGenerationPrompt(intentWithYouAre, profile)

	// Should NOT have the expert tutor preamble (the prompt already starts with "you are")
	if strings.Contains(result, "You are an expert German language tutor") {
		t.Fatalf("Expected expert tutor preamble to NOT be added, got: %s", result)
	}
	// Should contain the original intent
	if !strings.Contains(result, "You are a traveler in Germany wanting to practice ordering food") {
		t.Fatalf("Expected original intent to be preserved, got: %s", result)
	}
	// Should NOT have the framing text
	if strings.Contains(result, "Create German language exercises based on the following topic description:") {
		t.Fatalf("Expected topic description framing to NOT be present, got: %s", result)
	}
}

func TestBuildGenerationPromptCaseInsensitivePreambleDetection(t *testing.T) {
	profile := VariationProfile{
		TargetCount:      10,
		DifficultyLevel:  "B1",
		MaxRepetitionPerTerm: 2,
	}

	// Test with lowercase preamble - should NOT add duplicate
	lowercasePreamble := "you are an expert German language tutor. Generate exercises."
	result := BuildGenerationPrompt(lowercasePreamble, profile)

	// Should still contain the preamble (preserving original case)
	if !strings.Contains(result, "you are an expert German language tutor") {
		t.Fatalf("Expected lowercase preamble to be preserved, got: %s", result)
	}
	// Count how many times the expert tutor phrase appears
	count := strings.Count(strings.ToLower(result), strings.ToLower("you are an expert German language tutor"))
	if count > 1 {
		t.Fatalf("Expected preamble to NOT be duplicated even with different case, found %d occurrences, got: %s", count, result)
	}
	// Should still contain the variation profile
	if !strings.Contains(result, "System-generated variation profile") {
		t.Fatalf("Expected variation profile in result, got: %s", result)
	}
}

func TestBuildGenerationPromptNoPreambleForExpertTeacher(t *testing.T) {
	// Test that a full prompt with "teacher" role does NOT get duplicate boilerplate
	profile := VariationProfile{
		TargetCount:      10,
		DifficultyLevel:  "B1",
		MaxRepetitionPerTerm: 2,
	}

	teacherPrompt := "You are a German language teacher. Generate exercises about conjunctions."
	result := BuildGenerationPrompt(teacherPrompt, profile)

	// Should contain original teacher preamble exactly once
	count := strings.Count(result, "You are a German language teacher")
	if count != 1 {
		t.Fatalf("Expected teacher preamble to appear exactly once, got: %d occurrences in:\n%s", count, result)
	}

	// Should NOT contain the expert tutor preamble
	if strings.Contains(result, "You are an expert German language tutor") {
		t.Fatalf("Expected expert tutor preamble to NOT be added, got:\n%s", result)
	}
}

func TestBuildGenerationPromptNoPreambleForExpertTutor(t *testing.T) {
	// Test that a full prompt with "tutor" role does NOT get duplicate boilerplate
	profile := VariationProfile{
		TargetCount:      10,
		DifficultyLevel:  "B1",
		MaxRepetitionPerTerm: 2,
	}

	tutorPrompt := "You are a German tutor specializing in conjunctions. Generate exercises."
	result := BuildGenerationPrompt(tutorPrompt, profile)

	// Should contain original tutor preamble exactly once
	count := strings.Count(result, "You are a German tutor")
	if count != 1 {
		t.Fatalf("Expected tutor preamble to appear exactly once, got: %d occurrences in:\n%s", count, result)
	}

	// Should NOT contain the expert tutor preamble
	if strings.Contains(result, "You are an expert German language tutor") {
		t.Fatalf("Expected expert tutor preamble to NOT be added, got:\n%s", result)
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

	basePrompt := "B1 conjunctions um..zu and damit in daily life situations."
	topic := &storage.Topic{ID: "topic-4", Prompt: basePrompt}
	exercises, err := GenerateExercises(topic, "fake-api-key", server.URL, "test-model", "")
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
