package app

import (
	"bytes"
	"context"
	"german-conjunctions-trainer/pkg/storage"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
)

func setupTestApp(t *testing.T) *App {
	dbPath := filepath.Join(t.TempDir(), "test.db")
	store, err := storage.NewSQLiteStorage(dbPath)
	if err != nil {
		t.Fatalf("Failed to create storage: %v", err)
	}
	app := &App{DB: store}
	return app
}

func cleanupTestApp(app *App) {
	// t.TempDir() is cleaned up automatically
}

func TestValidateTopicTreeCycle(t *testing.T) {
	app := setupTestApp(t)
	defer cleanupTestApp(app)

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

func TestHandleTopicByID_PutValidation(t *testing.T) {
	app := setupTestApp(t)
	defer cleanupTestApp(app)

	// Mock admin setup
	app.AdminGoogleID = "admin123"
	adminUser, _ := app.DB.CreateUser("admin123")

	root, _ := app.DB.CreateTopic("Root", "prompt", nil, 5)

	tests := []struct {
		name           string
		payload        string
		expectedStatus int
	}{
		{
			name:           "Invalid parent_id type (number)",
			payload:        `{"name": "test", "prompt": "test", "parent_id": 123}`,
			expectedStatus: http.StatusBadRequest,
		},
		{
			name:           "Invalid sort_order type (string)",
			payload:        `{"name": "test", "prompt": "test", "sort_order": "first"}`,
			expectedStatus: http.StatusBadRequest,
		},
		{
			name:           "Invalid sort_order negative",
			payload:        `{"name": "test", "prompt": "test", "sort_order": -5}`,
			expectedStatus: http.StatusBadRequest,
		},
		{
			name:           "Invalid sort_order fractional",
			payload:        `{"name": "test", "prompt": "test", "sort_order": 1.5}`,
			expectedStatus: http.StatusBadRequest,
		},
		{
			name:           "Valid explicit null parent_id and zero sort",
			payload:        `{"name": "test", "prompt": "test", "parent_id": null, "sort_order": 0}`,
			expectedStatus: http.StatusOK,
		},
		{
			name:           "Omitted fields preserve existing",
			payload:        `{"name": "New Name"}`, // omitted prompt, parent, sort
			expectedStatus: http.StatusOK,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// To isolate state, we reset the topic before each test
			app.DB.UpdateTopic(root.ID, "Root", "prompt", nil, 5)

			req, _ := http.NewRequest("PUT", "/api/topics/"+root.ID, bytes.NewBufferString(tt.payload))
			req.Header.Set("Content-Type", "application/json")
			req = req.WithContext(context.WithValue(req.Context(), userContextKey, adminUser.ID))

			rr := httptest.NewRecorder()
			app.handleTopicByID(rr, req)

			if rr.Code != tt.expectedStatus {
				t.Errorf("Expected status %d, got %d. Body: %s", tt.expectedStatus, rr.Code, rr.Body.String())
			}

			// For the "Omitted fields preserve existing" test, let's verify storage
			if tt.name == "Omitted fields preserve existing" && rr.Code == http.StatusOK {
				updatedTopic, _ := app.DB.GetTopic(root.ID)
				if updatedTopic.Name != "New Name" {
					t.Errorf("Expected name 'New Name', got '%s'", updatedTopic.Name)
				}
				if updatedTopic.Prompt != "prompt" {
					t.Errorf("Expected prompt 'prompt', got '%s'", updatedTopic.Prompt)
				}
				if updatedTopic.ParentID != nil {
					t.Errorf("Expected ParentID to remain nil, got %v", updatedTopic.ParentID)
				}
				if updatedTopic.SortOrder != 5 {
					t.Errorf("Expected SortOrder to remain 5, got %d", updatedTopic.SortOrder)
				}
			}
		})
	}
}
