package app

import (
	"testing"
	"os"

	"german-conjunctions-trainer/pkg/storage"
)

func setupTestApp(t *testing.T) *App {
	dbPath := "test_app_db.sqlite"
	store, err := storage.NewSQLiteStorage(dbPath)
	if err != nil {
		t.Fatalf("Failed to create storage: %v", err)
	}
	app := &App{DB: store}
	return app
}

func cleanupTestApp(app *App) {
	os.Remove("test_app_db.sqlite")
}

func TestValidateTopicTreeCycle(t *testing.T) {
	app := setupTestApp(t)
	defer cleanupTestApp(app)

	// Clean DB
	app.DB.(*storage.SQLiteStorage).DeleteTopic("A") // Rough clean

	a, _ := app.DB.CreateTopic("A", "prompt", nil, 0)
	b, _ := app.DB.CreateTopic("B", "prompt", &a.ID, 0)
	c, _ := app.DB.CreateTopic("C", "prompt", &b.ID, 0)

	// Attempt self-parenting: A -> A
	err := app.validateTopicTree(&a.ID, &a.ID)
	if err == nil || err.Error() != "a topic cannot be its own parent" {
		t.Errorf("Expected self-parent error, got %v", err)
	}

	// Attempt deep cycle: A -> C (so A -> C -> B -> A)
	err = app.validateTopicTree(&a.ID, &c.ID)
	if err == nil || err.Error() != "cannot create a cycle in the topic tree" {
		t.Errorf("Expected cycle error, got %v", err)
	}
}
