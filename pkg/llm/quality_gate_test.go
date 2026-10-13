package llm

import (
	"strings"
	"testing"
)

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

func TestValidateExerciseSetEnforcesHardWordLimit(t *testing.T) {
	profile := VariationProfile{TargetCount: 2}
	atLimit := "Ich gehe heute nach der Arbeit mit meinem Bruder und seiner netten Frau ins neue Kino."            // 16 words
	overLimit := "Ich gehe heute nach der Arbeit mit meinem Bruder und seiner netten Frau ins neue Kino am Markt." // 18 words

	ok := []GeneratedExercise{
		{EnglishHint: "Hint 1", CorrectGermanSentence: atLimit},
		{EnglishHint: "Hint 2", CorrectGermanSentence: "Wir sprechen morgen."},
	}
	if err := ValidateExerciseSet(ok, profile); err != nil {
		t.Fatalf("16-word sentence should pass, got: %v", err)
	}

	long := []GeneratedExercise{
		{EnglishHint: "Hint 1", CorrectGermanSentence: overLimit},
		{EnglishHint: "Hint 2", CorrectGermanSentence: "Wir sprechen morgen."},
	}
	err := ValidateExerciseSet(long, profile)
	if err == nil || !strings.Contains(err.Error(), "exercise 1 has 18 words") {
		t.Fatalf("expected word-limit failure for exercise 1, got: %v", err)
	}
}

func TestCountWords(t *testing.T) {
	cases := map[string]int{
		"Ich lerne heute Deutsch.":            4,
		"Sie schreibt eine E-Mail – sofort!":  5,
		"  Wir   kommen,  weil es regnet .  ": 5,
		"Um 8 Uhr beginnt der Kurs.":          6,
	}
	for sentence, want := range cases {
		if got := countWords(sentence); got != want {
			t.Errorf("countWords(%q) = %d, want %d", sentence, got, want)
		}
	}
}
