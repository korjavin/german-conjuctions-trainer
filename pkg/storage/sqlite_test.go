package storage

import (
	"database/sql"
	"os"
	"strings"
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

	// Verify index was added
	var indexName string
	err = store.db.QueryRow("SELECT name FROM pragma_index_list('topics') WHERE name='idx_topics_parent'").Scan(&indexName)
	if err != nil || indexName != "idx_topics_parent" {
		t.Fatalf("Expected index 'idx_topics_parent' to be created. Err: %v", err)
	}

	// Re-run migrations (should not fail on already-migrated db)
	err = store.runMigrations()
	if err != nil {
		t.Errorf("Re-running migrations failed: %v", err)
	}
}

func TestMigrationFailsOnDuplicateTopicNames(t *testing.T) {
	dbPath := "test_migration_duplicate_db.sqlite"
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

	// Insert duplicate topic names at the same parent level (root level)
	duplicateTopics := []struct {
		id        string
		name      string
		prompt    string
		createdAt string
		updatedAt string
	}{
		{"id1", "Conjunctions", "prompt1", "2024-01-01 00:00:00", "2024-01-01 00:00:00"},
		{"id2", "Conjunctions", "prompt2", "2024-01-02 00:00:00", "2024-01-02 00:00:00"},
	}
	for _, topic := range duplicateTopics {
		_, err := db.Exec(
			"INSERT INTO topics(id, name, prompt, created_at, updated_at) VALUES(?, ?, ?, ?, ?)",
			topic.id, topic.name, topic.prompt, topic.createdAt, topic.updatedAt,
		)
		if err != nil {
			t.Fatalf("Failed to insert duplicate topic: %v", err)
		}
	}
	db.Close()

	// Attempt to initialize storage with duplicate topics - should fail
	_, err = NewSQLiteStorage(dbPath)
	if err == nil {
		t.Fatal("Expected migration to fail on duplicate topic names, but it succeeded")
	}

	// Verify error message mentions duplicates
	errMsg := err.Error()
	if !strings.Contains(errMsg, "duplicate") && !strings.Contains(errMsg, "unique") {
		t.Errorf("Expected error message to mention duplicates, got: %v", errMsg)
	}
}
