package storage

import (
	"path/filepath"
	"testing"
	"time"
)

func TestGetTopicProgress(t *testing.T) {
	store, err := NewSQLiteStorage(filepath.Join(t.TempDir(), "progress.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()

	alice, _ := store.CreateUser("g-alice")
	bob, _ := store.CreateUser("g-bob")
	a, _ := store.CreateTopic("A", "pa", nil, 0)
	b, _ := store.CreateTopic("B", "pb", &a.ID, 0)

	var exA, exB []*Exercise
	for i := 0; i < 4; i++ {
		ex, _ := store.CreateExercise(a.ID, "h", `{}`, "")
		exA = append(exA, ex)
	}
	for i := 0; i < 2; i++ {
		ex, _ := store.CreateExercise(b.ID, "h", `{}`, "")
		exB = append(exB, ex)
	}

	now := time.Now().UTC()
	if err := store.UpdateUserExerciseViews([]*UserExerciseView{
		// due: counter 1 → 1h, seen 2h ago
		{UserID: alice.ID, ExerciseID: exA[0].ID, LastViewed: now.Add(-2 * time.Hour), RepetitionCounter: 1},
		// not due: counter 3 → 9h, seen 1h ago; mastered
		{UserID: alice.ID, ExerciseID: exA[1].ID, LastViewed: now.Add(-time.Hour), RepetitionCounter: 3},
		// would be due but hidden; mastered (counter 4 → 16h, seen 20h ago)
		{UserID: alice.ID, ExerciseID: exA[2].ID, LastViewed: now.Add(-20 * time.Hour), RepetitionCounter: 4},
		// due in child topic
		{UserID: alice.ID, ExerciseID: exB[0].ID, LastViewed: now.Add(-3 * time.Hour), RepetitionCounter: 0},
		// another user's view never counts for alice
		{UserID: bob.ID, ExerciseID: exA[3].ID, LastViewed: now.Add(-48 * time.Hour), RepetitionCounter: 1},
	}); err != nil {
		t.Fatal(err)
	}
	if hidden, err := store.ToggleHideExercise(alice.ID, exA[2].ID); err != nil || !hidden {
		t.Fatalf("hide: %v %v", hidden, err)
	}

	got, err := store.GetTopicProgress(alice.ID)
	if err != nil {
		t.Fatal(err)
	}
	want := map[string]TopicProgress{
		a.ID: {Exercises: 4, Seen: 3, Due: 1, Mastered: 2},
		b.ID: {Exercises: 2, Seen: 1, Due: 1, Mastered: 0},
	}
	for id, w := range want {
		if got[id] == nil || *got[id] != w {
			t.Errorf("topic %s progress = %+v, want %+v", id, got[id], w)
		}
	}

	got, _ = store.GetTopicProgress(bob.ID)
	if p := got[a.ID]; p == nil || *p != (TopicProgress{Exercises: 4, Seen: 1, Due: 1}) {
		t.Errorf("bob topic A progress = %+v", p)
	}
}
