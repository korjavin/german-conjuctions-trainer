package app

import (
	"context"
	"encoding/json"
	"german-conjunctions-trainer/pkg/storage"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
)

func setupTestAppWithPaths(t *testing.T) (*App, string) {
	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, "test.db")
	audioCacheDir := filepath.Join(tmpDir, "audio_cache")
	store, err := storage.NewSQLiteStorage(dbPath)
	if err != nil {
		t.Fatalf("Failed to create storage: %v", err)
	}
	app := &App{
		DB:            store,
		DBPath:        dbPath,
		AudioCacheDir: audioCacheDir,
	}
	return app, tmpDir
}

func TestHandleDatabaseStats_AdminOnly(t *testing.T) {
	app, _ := setupTestAppWithPaths(t)
	app.AdminGoogleID = "admin-google-123"

	adminUser, _ := app.DB.CreateUser("admin-google-123")
	regularUser, _ := app.DB.CreateUser("regular-google-456")

	tests := []struct {
		name           string
		userID         string
		expectedStatus int
	}{
		{
			name:           "Admin user gets 200",
			userID:         adminUser.ID,
			expectedStatus: http.StatusOK,
		},
		{
			name:           "Non-admin user gets 403",
			userID:         regularUser.ID,
			expectedStatus: http.StatusForbidden,
		},
		{
			name:           "No user gets 401",
			userID:         "",
			expectedStatus: http.StatusUnauthorized,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req, _ := http.NewRequest("GET", "/api/db/stats", nil)
			if tt.userID != "" {
				req = req.WithContext(context.WithValue(req.Context(), userContextKey, tt.userID))
			}

			rr := httptest.NewRecorder()
			handler := app.adminOnly(app.handleDatabaseStats)
			handler.ServeHTTP(rr, req)

			if rr.Code != tt.expectedStatus {
				t.Errorf("Expected status %d, got %d. Body: %s", tt.expectedStatus, rr.Code, rr.Body.String())
			}
		})
	}
}

func TestHandleDatabaseStats_MethodNotAllowed(t *testing.T) {
	app, _ := setupTestAppWithPaths(t)

	for _, method := range []string{"POST", "PUT", "DELETE", "PATCH"} {
		t.Run(method, func(t *testing.T) {
			req, _ := http.NewRequest(method, "/api/db/stats", nil)
			rr := httptest.NewRecorder()
			app.handleDatabaseStats(rr, req)

			if rr.Code != http.StatusMethodNotAllowed {
				t.Errorf("Expected status %d for %s, got %d", http.StatusMethodNotAllowed, method, rr.Code)
			}
		})
	}
}

func TestHandleDatabaseStats_ResponseShape(t *testing.T) {
	app, _ := setupTestAppWithPaths(t)

	// Create some test data
	topic, _ := app.DB.CreateTopic("Test Topic", "prompt", nil, 0)
	app.DB.CreateExercise(topic.ID, "hash1", `{"sentence":"test"}`, "")

	req, _ := http.NewRequest("GET", "/api/db/stats", nil)
	rr := httptest.NewRecorder()
	app.handleDatabaseStats(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("Expected status 200, got %d. Body: %s", rr.Code, rr.Body.String())
	}

	if ct := rr.Header().Get("Content-Type"); ct != "application/json" {
		t.Errorf("Expected Content-Type application/json, got %s", ct)
	}

	var stats storage.DatabaseStats
	if err := json.NewDecoder(rr.Body).Decode(&stats); err != nil {
		t.Fatalf("Failed to decode response: %v", err)
	}

	if stats.TotalExercises != 1 {
		t.Errorf("Expected 1 exercise, got %d", stats.TotalExercises)
	}
	if stats.TotalTopics != 1 {
		t.Errorf("Expected 1 topic, got %d", stats.TotalTopics)
	}
	if len(stats.ExercisesPerTopic) != 1 {
		t.Errorf("Expected 1 topic in per-topic counts, got %d", len(stats.ExercisesPerTopic))
	} else {
		if stats.ExercisesPerTopic[0].Count != 1 {
			t.Errorf("Expected 1 exercise for topic, got %d", stats.ExercisesPerTopic[0].Count)
		}
		if stats.ExercisesPerTopic[0].TopicName != "Test Topic" {
			t.Errorf("Expected topic name 'Test Topic', got '%s'", stats.ExercisesPerTopic[0].TopicName)
		}
	}
	if stats.DatabaseSizeMB <= 0 {
		t.Errorf("Expected positive database size, got %f", stats.DatabaseSizeMB)
	}
}
