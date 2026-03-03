package llm

import (
	"testing"

	"german-conjunctions-trainer/pkg/storage"
)

func TestBuildVariationProfileBasics(t *testing.T) {
	topic := &storage.Topic{
		ID: "topic-a",
		Prompt: `Use these structures: nicht nur ..., sondern auch; sowohl ... als auch; \
		weder ... noch; entweder ... oder.`,
	}

	profile := BuildVariationProfile(topic)

	if profile.TargetCount != targetExerciseCount {
		t.Fatalf("expected target count %d, got %d", targetExerciseCount, profile.TargetCount)
	}
	if profile.Seed == 0 {
		t.Fatalf("expected non-zero seed")
	}
	if len(profile.ConjunctionSet) == 0 {
		t.Fatalf("expected at least one conjunction target")
	}
	if len(profile.SubjectMix) < 3 {
		t.Fatalf("expected at least 3 subject targets, got %d", len(profile.SubjectMix))
	}
	if profile.DifficultyLevel == "" {
		t.Fatalf("expected difficulty level to be set")
	}
}

func TestBuildVariationProfileWithoutConjunctionHints(t *testing.T) {
	topic := &storage.Topic{
		ID:     "topic-b",
		Prompt: "Generate B1 vocabulary practice without conjunction requirements.",
	}

	profile := BuildVariationProfile(topic)
	if len(profile.ConjunctionSet) != 0 {
		t.Fatalf("expected no conjunction targets, got %v", profile.ConjunctionSet)
	}
}
