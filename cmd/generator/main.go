package main

import (
	"encoding/json"
	"fmt"
	"log"
	"os"
	"strings"

	"german-trainer/pkg/llm"
	"german-trainer/pkg/storage"
)

func main() {
	if len(os.Args) < 2 {
		fmt.Println("Usage: go run cmd/generator/main.go \"<topic_name>\"")
		os.Exit(1)
	}
	topicName := os.Args[1]

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
	newlyGenerated, err := llm.GenerateExercises(targetTopic)
	if err != nil {
		log.Fatalf("Failed to generate new exercises: %v", err)
	}
	log.Printf("Generated %d new exercises from the LLM.", len(newlyGenerated))

	// 5. Filter duplicates and save unique exercises
	var uniqueExercisesSaved int
	promptHash := storage.GetPromptHash(targetTopic.Prompt)

	for _, newExData := range newlyGenerated {
		if !existingSentences[newExData.CorrectGermanSentence] {
			// This is a unique sentence, save it.
			exJSONBytes, err := json.Marshal(newExData)
			if err != nil {
				log.Printf("Warning: failed to re-marshal exercise JSON: %v", err)
				continue
			}

			_, err = storage.CreateExercise(targetTopic.ID, promptHash, string(exJSONBytes), "") // No audio path
			if err != nil {
				log.Printf("Warning: failed to cache exercise: %v", err)
				continue
			}
			uniqueExercisesSaved++
			// Add to the set to avoid duplicates within the same generated batch
			existingSentences[newExData.CorrectGermanSentence] = true
		}
	}

	log.Printf("Successfully saved %d new unique exercises for topic '%s'.", uniqueExercisesSaved, targetTopic.Name)
}
