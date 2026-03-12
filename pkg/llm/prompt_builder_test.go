package llm

import (
	"strings"
	"testing"
)

func TestBuildGenerationPrompt(t *testing.T) {
	topicPrompt := "Generate exercises about dative prepositions."
	profile := VariationProfile{
		TargetCount: 5,
	}

	result := BuildGenerationPrompt(topicPrompt, profile)

	// Includes full topic prompt text
	if !strings.Contains(result, topicPrompt) {
		t.Errorf("Expected result to contain topic prompt, got: %s", result)
	}

	// Empty variation profile doesn't crash
	emptyProfile := VariationProfile{}
	emptyResult := BuildGenerationPrompt(topicPrompt, emptyProfile)
	if !strings.Contains(emptyResult, topicPrompt) || !strings.Contains(emptyResult, "Create exactly 0 unique exercises") {
		t.Errorf("Empty variation profile did not generate correctly, got: %s", emptyResult)
	}
}

func TestBuildExplanationPrompt(t *testing.T) {
	topic := "Dative Prepositions"
	correctSentence := "Ich gehe mit dem Hund spazieren."
	mistakes := []string{"Used accusative instead of dative after 'mit'."}

	result := BuildExplanationPrompt(topic, correctSentence, mistakes)

	if !strings.Contains(result, topic) {
		t.Errorf("Expected explanation prompt to contain topic, got: %s", result)
	}
	if !strings.Contains(result, correctSentence) {
		t.Errorf("Expected explanation prompt to contain correct sentence, got: %s", result)
	}
	if !strings.Contains(result, mistakes[0]) {
		t.Errorf("Expected explanation prompt to contain mistake, got: %s", result)
	}
}

func TestBuildCorrectivePrompt(t *testing.T) {
	previousPrompt := "Previous topic prompt content"
	profile := VariationProfile{TargetCount: 5}
	qualityFailure := "Missing verbs"

	result := BuildCorrectivePrompt(previousPrompt, profile, qualityFailure)

	if !strings.Contains(result, previousPrompt) {
		t.Errorf("Expected corrective prompt to reference previous topic prompt content, got: %s", result)
	}
	if !strings.Contains(result, qualityFailure) {
		t.Errorf("Expected corrective prompt to include the quality failure, got: %s", result)
	}
}
