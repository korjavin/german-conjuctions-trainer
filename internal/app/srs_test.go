package app

import (
	"testing"
	"time"

	"german-conjunctions-trainer/pkg/storage"
)

func TestSRS_EmptyExerciseList(t *testing.T) {
	allExercises := []*storage.Exercise{}
	userViews := map[string]*storage.UserExerciseView{}

	eligible := getEligibleExercisesForSRS(allExercises, userViews)
	if len(eligible) != 0 {
		t.Errorf("expected 0 eligible exercises, got %d", len(eligible))
	}
}

func TestSRS_NeverSeenExercises(t *testing.T) {
	allExercises := []*storage.Exercise{
		{ID: "ex1"},
		{ID: "ex2"},
	}
	userViews := map[string]*storage.UserExerciseView{}

	eligible := getEligibleExercisesForSRS(allExercises, userViews)
	if len(eligible) != 2 {
		t.Errorf("expected 2 eligible exercises, got %d", len(eligible))
	}
}

func TestSRS_HiddenExercisesAreExcluded(t *testing.T) {
	allExercises := []*storage.Exercise{
		{ID: "ex1"},
		{ID: "ex2"},
	}
	userViews := map[string]*storage.UserExerciseView{
		"ex1": {
			ExerciseID: "ex1",
			IsHidden:   true,
		},
	}

	eligible := getEligibleExercisesForSRS(allExercises, userViews)
	if len(eligible) != 1 || eligible[0].ID != "ex2" {
		t.Errorf("expected only ex2 to be eligible, got %v", eligible)
	}
}

func TestSRS_OverdueCalculation(t *testing.T) {
	now := time.Now()
	allExercises := []*storage.Exercise{
		{ID: "due-yesterday"}, // counter=1 -> next review in 1 hour. view=2 hours ago -> overdue = 2 - 1 = +1
		{ID: "due-tomorrow"},  // counter=2 -> next review in 4 hours. view=3 hours ago -> overdue = 3 - 4 = -1
		{ID: "due-today"},     // counter=1 -> next review in 1 hour. view=1 hour ago -> overdue = 1 - 1 = 0
	}

	userViews := map[string]*storage.UserExerciseView{
		"due-yesterday": {
			ExerciseID:        "due-yesterday",
			LastViewed:        now.Add(-2 * time.Hour), // 2 hours ago
			RepetitionCounter: 1,                       // 1 hour wait
		},
		"due-tomorrow": {
			ExerciseID:        "due-tomorrow",
			LastViewed:        now.Add(-3 * time.Hour), // 3 hours ago
			RepetitionCounter: 2,                       // 4 hours wait
		},
		"due-today": {
			ExerciseID:        "due-today",
			LastViewed:        now.Add(-1 * time.Hour), // 1 hour ago
			RepetitionCounter: 1,                       // 1 hour wait
		},
	}

	eligible := getEligibleExercisesForSRS(allExercises, userViews)

	if len(eligible) != 2 {
		t.Errorf("expected 2 eligible exercises, got %d", len(eligible))
		return
	}

	if eligible[0].ID != "due-yesterday" {
		t.Errorf("expected due-yesterday to be first, got %s", eligible[0].ID)
	}
	if eligible[1].ID != "due-today" {
		t.Errorf("expected due-today to be second, got %s", eligible[1].ID)
	}
}

func TestSRS_FavoritesBreakTies(t *testing.T) {
	now := time.Now()
	allExercises := []*storage.Exercise{
		{ID: "ex1"}, // same overdue as ex2, but favorite
		{ID: "ex2"}, // same overdue as ex1, not favorite
	}

	userViews := map[string]*storage.UserExerciseView{
		"ex1": {
			ExerciseID:        "ex1",
			LastViewed:        now.Add(-1 * time.Hour),
			RepetitionCounter: 1,
			IsFavorite:        true,
		},
		"ex2": {
			ExerciseID:        "ex2",
			LastViewed:        now.Add(-1 * time.Hour),
			RepetitionCounter: 1,
			IsFavorite:        false,
		},
	}

	eligible := getEligibleExercisesForSRS(allExercises, userViews)

	if len(eligible) != 2 {
		t.Errorf("expected 2 eligible exercises, got %d", len(eligible))
		return
	}

	if eligible[0].ID != "ex1" {
		t.Errorf("expected ex1 to be first due to favorite, got %s", eligible[0].ID)
	}
	if eligible[1].ID != "ex2" {
		t.Errorf("expected ex2 to be second, got %s", eligible[1].ID)
	}
}

func TestSRS_GetRandomExercisesCapping(t *testing.T) {
	allExercises := make([]*storage.Exercise, 20)
	for i := 0; i < 20; i++ {
		allExercises[i] = &storage.Exercise{ID: string(rune(i))}
	}

	random := getRandomExercises(allExercises, 10)
	if len(random) != 10 {
		t.Errorf("expected 10 exercises, got %d", len(random))
	}
}

func TestSRS_GetRandomExercisesExact(t *testing.T) {
	allExercises := make([]*storage.Exercise, 5)
	for i := 0; i < 5; i++ {
		allExercises[i] = &storage.Exercise{ID: string(rune(i))}
	}

	random := getRandomExercises(allExercises, 10)
	if len(random) != 5 {
		t.Errorf("expected 5 exercises, got %d", len(random))
	}
}
