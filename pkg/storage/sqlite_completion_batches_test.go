package storage

import (
	"path/filepath"
	"testing"
	"time"
)

func TestApplyCompletionBatch(t *testing.T) {
	store, err := NewSQLiteStorage(filepath.Join(t.TempDir(), "batches.db"))
	if err != nil {
		t.Fatalf("failed to create sqlite storage: %v", err)
	}
	t.Cleanup(func() { store.Close() })

	user := mustCreateUser(t, store, "google-batch")
	other := mustCreateUser(t, store, "google-batch-2")

	view := func(userID string, attempts int) []*UserExerciseView {
		return []*UserExerciseView{{
			UserID:        userID,
			ExerciseID:    "ex1",
			LastViewed:    time.Now().UTC(),
			TotalAttempts: attempts,
		}}
	}

	applied, err := store.ApplyCompletionBatch(user.ID, "b1", view(user.ID, 1))
	if err != nil || !applied {
		t.Fatalf("first apply: applied=%v err=%v", applied, err)
	}

	// Replay: reports not applied and must not write.
	applied, err = store.ApplyCompletionBatch(user.ID, "b1", view(user.ID, 99))
	if err != nil {
		t.Fatalf("replay returned error: %v", err)
	}
	if applied {
		t.Error("replayed batch should report already-processed")
	}
	views, err := store.GetUserExerciseViews(user.ID)
	if err != nil {
		t.Fatalf("failed to read views: %v", err)
	}
	if views["ex1"].TotalAttempts != 1 {
		t.Errorf("replay overwrote stats: TotalAttempts got %d, want 1", views["ex1"].TotalAttempts)
	}

	// Batch IDs are scoped per user.
	if applied, err = store.ApplyCompletionBatch(other.ID, "b1", view(other.ID, 1)); err != nil || !applied {
		t.Errorf("same batch id for another user should apply: applied=%v err=%v", applied, err)
	}

	// No batch ID: always applies.
	if applied, err = store.ApplyCompletionBatch(user.ID, "", view(user.ID, 2)); err != nil || !applied {
		t.Errorf("empty batch id should always apply: applied=%v err=%v", applied, err)
	}
	views, _ = store.GetUserExerciseViews(user.ID)
	if views["ex1"].TotalAttempts != 2 {
		t.Errorf("unbatched apply did not write: TotalAttempts got %d, want 2", views["ex1"].TotalAttempts)
	}
}
