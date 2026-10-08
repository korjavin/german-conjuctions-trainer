package storage

import (
	"path/filepath"
	"testing"
	"time"
)

func TestPracticeActivity(t *testing.T) {
	store, err := NewSQLiteStorage(filepath.Join(t.TempDir(), "practice.db"))
	if err != nil {
		t.Fatalf("failed to create sqlite storage: %v", err)
	}
	t.Cleanup(func() { store.Close() })

	user := mustCreateUser(t, store, "google-practice")
	t1, _ := store.CreateTopic("T1", "p1", nil, 0)
	t2, _ := store.CreateTopic("T2", "p2", nil, 0)
	ex1, _ := store.CreateExercise(t1.ID, "h", `{}`, "")
	ex2, _ := store.CreateExercise(t2.ID, "h", `{}`, "")

	done := []PracticeLogEntry{{ExerciseID: ex1.ID, Hints: 1}, {ExerciseID: ex2.ID, Mistakes: 2}, {ExerciseID: "missing"}}
	if applied, err := store.ApplyCompletionBatch(user.ID, "b1", nil, done); err != nil || !applied {
		t.Fatalf("apply: applied=%v err=%v", applied, err)
	}
	// Replay must not log again.
	if _, err := store.ApplyCompletionBatch(user.ID, "b1", nil, done); err != nil {
		t.Fatal(err)
	}
	// One row three days ago, one outside the 7-day window.
	now := time.Now()
	for _, ago := range []int{3, 8} {
		if _, err := store.db.Exec(`INSERT INTO practice_log(user_id, exercise_id, topic_id, completed_at) VALUES(?, ?, ?, ?)`,
			user.ID, ex1.ID, t1.ID, now.AddDate(0, 0, -ago).UTC()); err != nil {
			t.Fatal(err)
		}
	}

	counts := func(topicIDs []string) []int {
		t.Helper()
		days, err := store.GetPracticeActivity(user.ID, topicIDs, 7, now)
		if err != nil {
			t.Fatal(err)
		}
		if len(days) != 7 || days[6].Date != now.Format("2006-01-02") || days[0].Date != now.AddDate(0, 0, -6).Format("2006-01-02") {
			t.Fatalf("bad day range: %+v", days)
		}
		out := make([]int, len(days))
		for i, d := range days {
			out[i] = d.Count
		}
		return out
	}
	eq := func(got, want []int) bool {
		for i := range want {
			if got[i] != want[i] {
				return false
			}
		}
		return true
	}

	if got := counts(nil); !eq(got, []int{0, 0, 0, 1, 0, 0, 2}) {
		t.Errorf("all topics: got %v", got)
	}
	if got := counts([]string{t2.ID}); !eq(got, []int{0, 0, 0, 0, 0, 0, 1}) {
		t.Errorf("t2 only: got %v", got)
	}

	other := mustCreateUser(t, store, "google-practice-2")
	if days, _ := store.GetPracticeActivity(other.ID, nil, 7, now); !eq([]int{days[6].Count}, []int{0}) {
		t.Errorf("other user sees activity: %+v", days)
	}
}
