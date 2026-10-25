package storage

import (
	"path/filepath"
	"testing"
	"time"
)

func TestNextReviewHours(t *testing.T) {
	for counter, want := range map[int]float64{0: MinReviewHours, 1: 1, 2: 4, 3: 9} {
		if got := NextReviewHours(counter); got != want {
			t.Errorf("NextReviewHours(%d) = %v, want %v", counter, got, want)
		}
	}
}

// A counter-0 exercise (just answered wrong) is due only after MinReviewHours,
// the same way in every place that counts due exercises.
func TestDueRule_MinimumWait(t *testing.T) {
	store, err := NewSQLiteStorage(filepath.Join(t.TempDir(), "srs.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()

	user, _ := store.CreateUser("g-srs")
	topic, _ := store.CreateTopic("SRS", "p", nil, 0)
	fresh, _ := store.CreateExercise(topic.ID, "h", `{}`, "")
	waited, _ := store.CreateExercise(topic.ID, "h", `{}`, "")

	now := time.Now().UTC()
	if err := store.UpdateUserExerciseViews([]*UserExerciseView{
		{UserID: user.ID, ExerciseID: fresh.ID, LastViewed: now.Add(-time.Minute)},
		{UserID: user.ID, ExerciseID: waited.ID, LastViewed: now.Add(-10 * time.Minute)},
	}); err != nil {
		t.Fatal(err)
	}

	progress, err := store.GetTopicProgress(user.ID)
	if err != nil {
		t.Fatal(err)
	}
	if p := progress[topic.ID]; p == nil || p.Seen != 2 || p.Due != 1 {
		t.Errorf("topic progress = %+v, want seen 2, due 1", p)
	}

	stats, err := store.GetUserExerciseStats(user.ID)
	if err != nil {
		t.Fatal(err)
	}
	if stats.ReadyToRepeatCount != 1 {
		t.Errorf("ready to repeat = %d, want 1", stats.ReadyToRepeatCount)
	}

	history, err := store.GetUserExerciseHistory(user.ID, "")
	if err != nil {
		t.Fatal(err)
	}
	ready := map[string]bool{}
	for _, h := range history {
		ready[h.ExerciseID] = h.ReadyToRepeat
		if h.NextReviewHours != MinReviewHours {
			t.Errorf("%s next review = %v h, want %v", h.ExerciseID, h.NextReviewHours, MinReviewHours)
		}
	}
	if len(ready) != 2 || ready[fresh.ID] || !ready[waited.ID] {
		t.Errorf("ready to repeat = %v, want only %s", ready, waited.ID)
	}
}
