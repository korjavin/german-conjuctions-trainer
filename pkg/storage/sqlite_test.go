package storage

import (
	"database/sql"
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

	// Create legacy database manually without new columns
	db, err := sql.Open("sqlite3", dbPath)
	if err != nil {
		t.Fatalf("Failed to open legacy DB: %v", err)
	}

	legacySchema := `
	CREATE TABLE topics (
		id TEXT PRIMARY KEY,
		name TEXT NOT NULL,
		prompt TEXT NOT NULL,
		created_at DATETIME NOT NULL,
		updated_at DATETIME NOT NULL
	);
	`
	if _, err := db.Exec(legacySchema); err != nil {
		t.Fatalf("Failed to create legacy schema: %v", err)
	}
	db.Close()

	// First initialization (runs migrations on legacy DB)
	store, err := NewSQLiteStorage(dbPath)
	if err != nil {
		t.Fatalf("Failed to create storage and run migrations: %v", err)
	}

	// Verify columns were added
	var count int
	err = store.db.QueryRow("SELECT COUNT(*) FROM pragma_table_info('topics') WHERE name='parent_id' OR name='sort_order'").Scan(&count)
	if err != nil || count != 2 {
		t.Fatalf("Expected 2 columns to be added, got %d. Err: %v", count, err)
	}

	// Re-run migrations (should not fail on already-migrated db)
	err = store.runMigrations()
	if err != nil {
		t.Errorf("Re-running migrations failed: %v", err)
	}
}
