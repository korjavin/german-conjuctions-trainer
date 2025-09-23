package llm

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	"german-conjunctions-trainer/pkg/storage"
)

func TestRefinePrompt(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		fmt.Fprintln(w, `{
			"choices": [
				{
					"message": {
						"content": "This is a refined prompt."
					}
				}
			]
		}`)
	}))
	defer server.Close()

	originalPrompt := "This is the original prompt."
	refinedPrompt, err := RefinePrompt(originalPrompt, "fake-api-key", server.URL, "test-model")

	if err != nil {
		t.Fatalf("Expected no error, but got: %v", err)
	}

	expectedRefinedPrompt := "This is a refined prompt."
	if refinedPrompt != expectedRefinedPrompt {
		t.Errorf("Expected refined prompt to be '%s', but got '%s'", expectedRefinedPrompt, refinedPrompt)
	}
}

func TestGenerateExercises(t *testing.T) {
	// Set a dummy API key for the test
	os.Setenv("OPENAI_API_KEY", "dummy-key")
	defer os.Unsetenv("OPENAI_API_KEY")

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var reqBody map[string]interface{}
		body, _ := io.ReadAll(r.Body)
		json.Unmarshal(body, &reqBody)

		// Differentiate between refine and generate calls
		if _, ok := reqBody["response_format"]; ok {
			// This is the exercise generation call
			w.WriteHeader(http.StatusOK)
			fmt.Fprintln(w, `{
				"choices": [
					{
						"message": {
							"content": "{\"exercises\":[{\"correct_german_sentence\":\"Das ist ein Test.\",\"english_hint\":\"This is a test.\"}]}"
						}
					}
				]
			}`)
		} else {
			// This is the refine prompt call
			w.WriteHeader(http.StatusOK)
			fmt.Fprintln(w, `{
				"choices": [
					{
						"message": {
							"content": "This is a refined prompt."
						}
					}
				]
			}`)
		}
	}))
	defer server.Close()

	topic := &storage.Topic{
		ID:     "test-topic-id",
		Name:   "Test Topic",
		Prompt: "Test prompt",
	}

	// We pass the mock server's URL to the function being tested.
	exercises, err := GenerateExercises(topic, "fake-api-key", server.URL, "test-model")
	if err != nil {
		t.Fatalf("Expected no error, but got: %v", err)
	}

	if len(exercises) != 1 {
		t.Fatalf("Expected 1 exercise, but got %d", len(exercises))
	}

	expectedSentence := "Das ist ein Test."
	if exercises[0].CorrectGermanSentence != expectedSentence {
		t.Errorf("Expected sentence to be '%s', but got '%s'", expectedSentence, exercises[0].CorrectGermanSentence)
	}
}
