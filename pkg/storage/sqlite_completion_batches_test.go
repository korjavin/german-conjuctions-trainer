package storage

import (
	"path/filepath"
	"testing"
)

func TestClaimCompletionBatch(t *testing.T) {
	store, err := NewSQLiteStorage(filepath.Join(t.TempDir(), "batches.db"))
	if err != nil {
		t.Fatalf("failed to create sqlite storage: %v", err)
	}
	t.Cleanup(func() { store.Close() })

	user := mustCreateUser(t, store, "google-batch")

	claimed, err := store.ClaimCompletionBatch(user.ID, "b1")
	if err != nil {
		t.Fatalf("first claim returned error: %v", err)
	}
	if !claimed {
		t.Fatal("first claim should succeed")
	}

	claimed, err = store.ClaimCompletionBatch(user.ID, "b1")
	if err != nil {
		t.Fatalf("replayed claim returned error: %v", err)
	}
	if claimed {
		t.Error("replayed claim should report already-processed")
	}

	// Batch IDs are scoped per user.
	other := mustCreateUser(t, store, "google-batch-2")
	if claimed, err = store.ClaimCompletionBatch(other.ID, "b1"); err != nil || !claimed {
		t.Errorf("same batch id for another user should claim: claimed=%v err=%v", claimed, err)
	}

	// Releasing lets a retry through again.
	if err := store.ReleaseCompletionBatch(user.ID, "b1"); err != nil {
		t.Fatalf("release returned error: %v", err)
	}
	if claimed, err = store.ClaimCompletionBatch(user.ID, "b1"); err != nil || !claimed {
		t.Errorf("claim after release should succeed: claimed=%v err=%v", claimed, err)
	}
}
