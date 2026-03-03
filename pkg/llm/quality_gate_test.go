package llm

import "testing"

func TestValidateExerciseSetRejectsDuplicates(t *testing.T) {
	profile := VariationProfile{TargetCount: 2}
	exercises := []GeneratedExercise{
		{EnglishHint: "Hint 1", CorrectGermanSentence: "Ich lerne heute Deutsch."},
		{EnglishHint: "Hint 2", CorrectGermanSentence: "Ich lerne heute Deutsch."},
	}

	err := ValidateExerciseSet(exercises, profile)
	if err == nil {
		t.Fatalf("expected duplicate validation error, got nil")
	}
}

func TestValidateExerciseSetChecksConjunctionCoverage(t *testing.T) {
	profile := VariationProfile{
		TargetCount:    2,
		ConjunctionSet: []string{"weder ... noch"},
	}
	exercises := []GeneratedExercise{
		{EnglishHint: "Hint 1", CorrectGermanSentence: "Ich lerne heute Deutsch."},
		{EnglishHint: "Hint 2", CorrectGermanSentence: "Wir sprechen morgen."},
	}

	err := ValidateExerciseSet(exercises, profile)
	if err == nil {
		t.Fatalf("expected coverage validation error, got nil")
	}
}

func TestValidateExerciseSetAcceptsValidSet(t *testing.T) {
	profile := VariationProfile{
		TargetCount:    2,
		ConjunctionSet: []string{"entweder ... oder", "weder ... noch"},
	}
	exercises := []GeneratedExercise{
		{EnglishHint: "Either or hint", CorrectGermanSentence: "Entweder lerne ich heute oder ich lerne morgen."},
		{EnglishHint: "Neither nor hint", CorrectGermanSentence: "Ich habe weder Zeit noch Energie fuer einen langen Spaziergang."},
	}

	err := ValidateExerciseSet(exercises, profile)
	if err != nil {
		t.Fatalf("expected valid set, got error: %v", err)
	}
}
