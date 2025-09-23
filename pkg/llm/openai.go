package llm

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"sync"
	"german-conjunctions-trainer/pkg/storage"
)

// --- Data Structures ---

type GenerateRequest struct {
	TopicID string `json:"topic_id"`
}

type ResponseFormat struct {
	Type string `json:"type"`
}

type OpenAIRequest struct {
	Model          string          `json:"model"`
	Messages       []Message       `json:"messages"`
	ResponseFormat *ResponseFormat `json:"response_format,omitempty"`
}

type Message struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type OpenAIResponse struct {
	Choices []struct {
		Message struct {
			Content string `json:"content"`
		} `json:"message"`
	} `json:"choices"`
	Error *struct {
		Message string `json:"message"`
		Type    string `json:"type"`
		Code    string `json:"code"`
	} `json:"error,omitempty"`
}

type GeneratedExercise struct {
	CorrectGermanSentence string `json:"correct_german_sentence"`
	ConjunctionTopic      string `json:"conjunction_topic"`
	EnglishHint           string `json:"english_hint"`
	ScrambledWords        []string `json:"scrambled_words"`
}


// --- Globals ---

var (
	lastRefinedPrompt      string
	lastRefinedPromptMutex sync.RWMutex
)

const metaPrompt = `You are a prompt engineering assistant. Your task is to refine the following user-provided prompt to improve the variety and creativity of the AI's output for generating language exercises.

**Refinement Rules:**
1.  **Do Not Change the JSON Schema:** The core instructions for the JSON output format and the schema definition must remain untouched. The refined prompt must still produce a valid JSON object.
2.  **Enhance Instructions:** Rephrase the instructions to encourage more diverse and less repetitive sentences. Add suggestions for using a wider range of vocabulary or sentence structures.
3.  **Add Examples:** Include one or two new, concrete examples of the desired output format within the prompt. This helps the model better understand the task.
4.  **Maintain Core Task:** The fundamental goal of the prompt (e.g., creating German conjunction exercises) must be preserved.
5.  **Output:** Your final output should be ONLY the refined prompt, with no extra text, explanations, or markdown formatting around it.

Here is the prompt to refine:
---
%s
---
`

// --- LLM Functions ---

func RefinePrompt(originalPrompt, apiKey, openaiURL, modelName string) (string, error) {
	log.Println("Refining prompt...")

	refineMessages := []Message{
		{
			Role:    "user",
			Content: fmt.Sprintf(metaPrompt, originalPrompt),
		},
	}

	refineReq := OpenAIRequest{
		Model:    modelName,
		Messages: refineMessages,
	}

	reqBody, err := json.Marshal(refineReq)
	if err != nil {
		return "", fmt.Errorf("failed to create refine request body: %w", err)
	}

	client := &http.Client{}
	apiReq, err := http.NewRequest("POST", openaiURL+"/chat/completions", bytes.NewBuffer(reqBody))
	if err != nil {
		return "", fmt.Errorf("failed to create API request for refining: %w", err)
	}
	apiReq.Header.Set("Content-Type", "application/json")
	apiReq.Header.Set("Authorization", "Bearer "+apiKey)

	resp, err := client.Do(apiReq)
	if err != nil {
		return "", fmt.Errorf("failed to call OpenAI API for refining: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("failed to read API response for refining: %w", err)
	}

	var openaiResp OpenAIResponse
	if err := json.Unmarshal(respBody, &openaiResp); err != nil {
		return "", fmt.Errorf("failed to parse API response for refining: %w", err)
	}

	if openaiResp.Error != nil {
		return "", fmt.Errorf("API error during refining: %s", openaiResp.Error.Message)
	}

	if len(openaiResp.Choices) == 0 || openaiResp.Choices[0].Message.Content == "" {
		return "", fmt.Errorf("received an empty response from the refining API")
	}

	refinedPrompt := openaiResp.Choices[0].Message.Content
	log.Println("Successfully refined prompt.")
	return refinedPrompt, nil
}

// GenerateExercises calls the LLM and returns the generated exercises without saving them.
func GenerateExercises(topic *storage.Topic, apiKey, openaiURL, modelName string) ([]GeneratedExercise, error) {
	finalPrompt, err := RefinePrompt(topic.Prompt, apiKey, openaiURL, modelName)
	if err != nil {
		log.Printf("Error refining prompt, falling back to original: %v", err)
		finalPrompt = topic.Prompt
	} else {
		lastRefinedPromptMutex.Lock()
		lastRefinedPrompt = finalPrompt
		lastRefinedPromptMutex.Unlock()
	}

	openaiReq := OpenAIRequest{
		Model:          modelName,
		Messages:       []Message{{Role: "user", Content: finalPrompt}},
		ResponseFormat: &ResponseFormat{Type: "json_object"},
	}

	reqBody, _ := json.Marshal(openaiReq)
	client := &http.Client{}
	apiReq, _ := http.NewRequest("POST", openaiURL+"/chat/completions", bytes.NewBuffer(reqBody))
	apiReq.Header.Set("Content-Type", "application/json")
	apiReq.Header.Set("Authorization", "Bearer "+apiKey)

	resp, err := client.Do(apiReq)
	if err != nil {
		return nil, fmt.Errorf("failed to call OpenAI API: %w", err)
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)
	var openaiResp OpenAIResponse
	json.Unmarshal(respBody, &openaiResp)

	if openaiResp.Error != nil {
		return nil, fmt.Errorf("API error: %s", openaiResp.Error.Message)
	}

	if len(openaiResp.Choices) == 0 || openaiResp.Choices[0].Message.Content == "" {
		return nil, fmt.Errorf("received an empty response from OpenAI")
	}

	var exerciseData struct {
		Exercises []GeneratedExercise `json:"exercises"`
	}
	if err := json.Unmarshal([]byte(openaiResp.Choices[0].Message.Content), &exerciseData); err != nil {
		return nil, fmt.Errorf("failed to parse exercises from OpenAI response: %w", err)
	}

	return exerciseData.Exercises, nil
}

// GenerateAndCacheExercises generates exercises and saves them to Airtable.
func GenerateAndCacheExercises(topic *storage.Topic, generateAudio bool) ([]*storage.Exercise, error) {
	apiKey := os.Getenv("OPENAI_API_KEY")
	openaiURL := os.Getenv("OPENAI_URL")
	if openaiURL == "" {
		openaiURL = "https://api.openai.com/v1"
	}
	modelName := os.Getenv("MODEL_NAME")
	if modelName == "" {
		modelName = "gpt-3.5-turbo-1106"
	}

	generatedExercises, err := GenerateExercises(topic, apiKey, openaiURL, modelName)
	if err != nil {
		return nil, err
	}

	promptHash := storage.GetPromptHash(topic.Prompt)
	var newlyCached []*storage.Exercise
	for _, exData := range generatedExercises {
		var audioPath string
		if generateAudio {
			// NOTE: Audio generation logic (generateAndSaveAudio) is not included in this package.
			log.Printf("Audio generation is requested but not implemented in this package.")
			audioPath = ""
		}

		exJSONBytes, err := json.Marshal(exData)
		if err != nil {
			log.Printf("Warning: failed to re-marshal exercise JSON: %v", err)
			continue
		}

		exercise, err := storage.CreateExercise(topic.ID, promptHash, string(exJSONBytes), audioPath)
		if err != nil {
			log.Printf("Warning: failed to cache exercise: %v", err)
			continue
		}
		newlyCached = append(newlyCached, exercise)
	}

	return newlyCached, nil
}


func GetLastRefinedPrompt() string {
	lastRefinedPromptMutex.RLock()
	defer lastRefinedPromptMutex.RUnlock()
	return lastRefinedPrompt
}
