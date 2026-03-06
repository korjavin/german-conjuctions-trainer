package storage

import (
	"os"
	"testing"
)

func TestTopicTreeConstraints(t *testing.T) {
	// Setup in-memory DB for tests
	dbPath := "test_db.sqlite"
	defer os.Remove(dbPath)

	store, err := NewSQLiteStorage(dbPath)
	if err != nil {
		t.Fatalf("Failed to create storage: %v", err)
	}

	// Clean out default topics initialized by schema setup to start fresh
	store.db.Exec("DELETE FROM topics")

	// 1. Create root topic
	root, err := store.CreateTopic("Root", "prompt", nil, 0)
	if err != nil {
		t.Fatalf("Failed to create root topic: %v", err)
	}

	// 2. Create child topic
	child, err := store.CreateTopic("Child", "prompt", &root.ID, 0)
	if err != nil {
		t.Fatalf("Failed to create child topic: %v", err)
	}

	// Verify parent was assigned
	if child.ParentID == nil || *child.ParentID != root.ID {
		t.Errorf("Expected child's ParentID to be %s, got %v", root.ID, child.ParentID)
	}

	// 3. Attempt to delete root topic with children (should fail)
	err = store.DeleteTopic(root.ID)
	if err == nil || err.Error() != ErrTopicHasChildren.Error() {
		t.Errorf("Expected ErrTopicHasChildren, got %v", err)
	}

	// 4. Delete child, then delete root (should succeed)
	err = store.DeleteTopic(child.ID)
	if err != nil {
		t.Errorf("Failed to delete child: %v", err)
	}

	err = store.DeleteTopic(root.ID)
	if err != nil {
		t.Errorf("Failed to delete root: %v", err)
	}
}

func TestMigrationIdempotency(t *testing.T) {
	dbPath := "test_migration_db.sqlite"
	defer os.Remove(dbPath)

	// First initialization (runs migrations)
	store, err := NewSQLiteStorage(dbPath)
	if err != nil {
		t.Fatalf("Failed to create storage: %v", err)
	}

	// Re-run migrations (should not fail)
	err = store.runMigrations()
	if err != nil {
		t.Errorf("Re-running migrations failed: %v", err)
	}
}
