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

func TestDropOverlongExercises(t *testing.T) {
	atLimit := "Ich gehe heute nach der Arbeit mit meinem Bruder und seiner netten Frau ins neue Kino."            // 16 words
	overLimit := "Ich gehe heute nach der Arbeit mit meinem Bruder und seiner netten Frau ins neue Kino am Markt." // 18 words
	exercises := []GeneratedExercise{
		{EnglishHint: "Hint 1", CorrectGermanSentence: atLimit},
		{EnglishHint: "Hint 2", CorrectGermanSentence: overLimit},
		{EnglishHint: "Hint 3", CorrectGermanSentence: "Wir sprechen morgen."},
	}

	kept, dropped := DropOverlongExercises(exercises)
	if len(kept) != 2 || kept[0].CorrectGermanSentence != atLimit || kept[1].CorrectGermanSentence != "Wir sprechen morgen." {
		t.Errorf("expected the 16-word and short sentences to be kept, got %+v", kept)
	}
	if len(dropped) != 1 || dropped[0] != overLimit {
		t.Errorf("expected only the 18-word sentence to be dropped, got %q", dropped)
	}
}

func TestValidateExerciseSetIgnoresSentenceLength(t *testing.T) {
	profile := VariationProfile{TargetCount: 1}
	exercises := []GeneratedExercise{
		{EnglishHint: "Hint", CorrectGermanSentence: strings.Repeat("Wort ", 20) + "Ende."},
	}
	if err := ValidateExerciseSet(exercises, profile); err != nil {
		t.Fatalf("length is filtered, not a quality-gate failure; got: %v", err)
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
