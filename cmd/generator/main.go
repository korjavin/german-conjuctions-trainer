package main

import (
	"encoding/json"
	"fmt"
	"log"
	"os"
	"strings"

	"german-conjunctions-trainer/pkg/llm"
	"german-conjunctions-trainer/pkg/storage"
)

func main() {
	// --- Initial Validation ---
	if len(os.Args) < 2 || strings.TrimSpace(os.Args[1]) == "" {
		fmt.Println("Usage: go run cmd/generator/main.go \"<topic_name>\"")
		fmt.Println("Error: Topic name is required and cannot be empty.")
		os.Exit(1)
	}
	topicName := os.Args[1]

	apiKey := os.Getenv("OPENAI_API_KEY")
	if apiKey == "" {
		log.Fatal("Error: OPENAI_API_KEY environment variable is required.")
	}

	openaiURL := os.Getenv("OPENAI_URL")
	if openaiURL == "" {
		openaiURL = "https://api.openai.com/v1"
	}
	modelName := os.Getenv("MODEL_NAME")
	if modelName == "" {
		modelName = "gpt-3.5-turbo-1106"
	}

	// 1. Initialize storage
	storage.InitStorage()

	// 2. Find topic by name
	log.Printf("Searching for topic: '%s'", topicName)
	allTopics, err := storage.GetAllTopics()
	if err != nil {
		log.Fatalf("Failed to get topics: %v", err)
	}

	var targetTopic *storage.Topic
	for _, topic := range allTopics {
		if strings.EqualFold(topic.Name, topicName) {
			targetTopic = topic
			break
		}
	}

	if targetTopic == nil {
		log.Fatalf("Topic '%s' not found.", topicName)
	}
	log.Printf("Found topic '%s' with ID: %s", targetTopic.Name, targetTopic.ID)

	// 3. Get existing exercises to filter duplicates
	log.Println("Fetching existing exercises for this topic...")
	existingExercises, err := storage.GetExercisesForTopic(targetTopic.ID, "") // Pass empty hash to get all
	if err != nil {
		log.Fatalf("Failed to get existing exercises: %v", err)
	}
	log.Printf("Found %d existing exercises.", len(existingExercises))

	existingSentences := make(map[string]bool)
	for _, ex := range existingExercises {
		var exerciseContent struct {
			CorrectGermanSentence string `json:"correct_german_sentence"`
		}
		if err := json.Unmarshal([]byte(ex.ExerciseJSON), &exerciseContent); err == nil {
			existingSentences[exerciseContent.CorrectGermanSentence] = true
		}
	}

	// 4. Generate new exercises
	log.Println("Generating new exercises... (this may take a moment)")
	newlyGenerated, err := llm.GenerateExercises(targetTopic, apiKey, openaiURL, modelName)
	if err != nil {
		log.Fatalf("Failed to generate new exercises: %v", err)
	}
	log.Printf("Generated %d new exercises from the LLM.", len(newlyGenerated))

	// 5. Filter duplicates and save unique exercises
	var uniqueExercisesSaved int
	var failures int
	promptHash := storage.GetPromptHash(targetTopic.Prompt)

	for _, newExData := range newlyGenerated {
		if !existingSentences[newExData.CorrectGermanSentence] {
			// This is a unique sentence, save it.
			exJSONBytes, err := json.Marshal(newExData)
			if err != nil {
				log.Printf("Error: failed to re-marshal exercise JSON: %v", err)
				failures++
				continue
			}

			_, err = storage.CreateExercise(targetTopic.ID, promptHash, string(exJSONBytes), "") // No audio path
			if err != nil {
				log.Printf("Error: failed to save exercise to Airtable: %v", err)
				failures++
				continue
			}
			uniqueExercisesSaved++
			// Add to the set to avoid duplicates within the same generated batch
			existingSentences[newExData.CorrectGermanSentence] = true
		}
	}

	log.Printf("Successfully saved %d new unique exercises for topic '%s'.", uniqueExercisesSaved, targetTopic.Name)

	if failures > 0 {
		log.Fatalf("Encountered %d failures during the process.", failures)
	}
}
