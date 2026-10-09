package storage

import (
	"fmt"
	"path/filepath"
	"sync"
	"testing"
)

// Regression for gct-7un: overlapping writes on a file-backed DB must wait,
// not fail with "database is locked".
func TestConcurrentWritesDoNotLock(t *testing.T) {
	store, err := NewSQLiteStorage(filepath.Join(t.TempDir(), "concurrent.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { store.Close() })

	var mode string
	if err := store.db.QueryRow("PRAGMA journal_mode").Scan(&mode); err != nil || mode != "wal" {
		t.Fatalf("journal_mode = %q, err %v; want wal", mode, err)
	}

	user := mustCreateUser(t, store, "google-concurrent")
	topic, err := store.CreateTopic("T", "p", nil, 0)
	if err != nil {
		t.Fatal(err)
	}
	ex, err := store.CreateExercise(topic.ID, "h", `{}`, "")
	if err != nil {
		t.Fatal(err)
	}

	var wg sync.WaitGroup
	errs := make(chan error, 60)
	for i := 0; i < 20; i++ {
		wg.Add(3)
		go func() { defer wg.Done(); _, err := store.ToggleHideExercise(user.ID, ex.ID); errs <- err }()
		go func() { defer wg.Done(); _, err := store.ToggleFavorite(user.ID, ex.ID); errs <- err }()
		go func(i int) {
			defer wg.Done()
			_, err := store.CreateExercise(topic.ID, fmt.Sprintf("h%d", i), `{}`, "")
			errs <- err
		}(i)
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Error(err)
		}
	}
}
