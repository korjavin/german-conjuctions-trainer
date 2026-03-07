package app

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"german-conjunctions-trainer/pkg/storage"
)

// setupComprehensiveTestApp creates a test app with a temporary database
func setupComprehensiveTestApp(t *testing.T) *App {
	dbPath := filepath.Join(t.TempDir(), "test.db")
	store, err := storage.NewSQLiteStorage(dbPath)
	if err != nil {
		t.Fatalf("Failed to create storage: %v", err)
	}
	app := &App{DB: store}
	return app
}


// Helper function to create an admin user context
func setupAdminContext(app *App, t *testing.T) context.Context {
	app.AdminGoogleID = "admin123"
	adminUser, err := app.DB.CreateUser("admin123")
	if err != nil {
		t.Fatalf("Failed to create admin user: %v", err)
	}
	return context.WithValue(context.Background(), userContextKey, adminUser.ID)
}

// ==========================================
// validateTopicTree Tests
// ==========================================

func TestValidateTopicTree_AllowsNullParent(t *testing.T) {
	app := setupComprehensiveTestApp(t)

	err := app.validateTopicTree(nil, nil)
	if err != nil {
		t.Errorf("Expected nil parent to be valid, got error: %v", err)
	}
}

func TestValidateTopicTree_RejectsSelfParenting(t *testing.T) {
	app := setupComprehensiveTestApp(t)

	topic, _ := app.DB.CreateTopic("A", "prompt", nil, 0)
	topicID := topic.ID

	err := app.validateTopicTree(&topicID, &topicID)
	if err == nil || err.Error() != "a topic cannot be its own parent" {
		t.Errorf("Expected self-parent error, got %v", err)
	}
}

func TestValidateTopicTree_RejectsNonExistentParent(t *testing.T) {
	app := setupComprehensiveTestApp(t)

	fakeParentID := "non-existent-id"
	err := app.validateTopicTree(nil, &fakeParentID)
	if err == nil || !strings.Contains(err.Error(), "not found") {
		t.Errorf("Expected parent not found error, got %v", err)
	}
}

func TestValidateTopicTree_DetectsTwoLevelCycle(t *testing.T) {
	app := setupComprehensiveTestApp(t)

	a, _ := app.DB.CreateTopic("A", "prompt", nil, 0)
	b, _ := app.DB.CreateTopic("B", "prompt", &a.ID, 0)

	// Try to make A's parent be B (creating cycle: A -> B -> A)
	err := app.validateTopicTree(&a.ID, &b.ID)
	if err == nil || err.Error() != "cannot create a cycle in the topic tree" {
		t.Errorf("Expected cycle error, got %v", err)
	}
}

func TestValidateTopicTree_DetectsThreeLevelCycle(t *testing.T) {
	app := setupComprehensiveTestApp(t)

	a, _ := app.DB.CreateTopic("A", "prompt", nil, 0)
	b, _ := app.DB.CreateTopic("B", "prompt", &a.ID, 0)
	c, _ := app.DB.CreateTopic("C", "prompt", &b.ID, 0)

	// Try to make A's parent be C (creating cycle: A -> C -> B -> A)
	err := app.validateTopicTree(&a.ID, &c.ID)
	if err == nil || err.Error() != "cannot create a cycle in the topic tree" {
		t.Errorf("Expected cycle error, got %v", err)
	}
}

func TestValidateTopicTree_AllowsValidParent(t *testing.T) {
	app := setupComprehensiveTestApp(t)

	parent, _ := app.DB.CreateTopic("Parent", "prompt", nil, 0)
	child, _ := app.DB.CreateTopic("Child", "prompt", nil, 0)

	err := app.validateTopicTree(&child.ID, &parent.ID)
	if err != nil {
		t.Errorf("Expected valid parent to be allowed, got error: %v", err)
	}
}

func TestValidateTopicTree_DetectsInvalidParentReference(t *testing.T) {
	app := setupComprehensiveTestApp(t)

	// Create a topic with a parent that doesn't exist (simulating bad data)
	a, _ := app.DB.CreateTopic("A", "prompt", nil, 0)
	badParentID := "fake-parent-id"

	err := app.validateTopicTree(&a.ID, &badParentID)
	if err == nil || !strings.Contains(err.Error(), "not found") {
		t.Errorf("Expected parent not found error, got %v", err)
	}
}

// ==========================================
// handleTopics GET Tests
// ==========================================

func TestHandleTopics_GetReturnsAllTopics(t *testing.T) {
	app := setupComprehensiveTestApp(t)

	_, _ = app.DB.CreateTopic("Topic1", "prompt1", nil, 0)
	_, _ = app.DB.CreateTopic("Topic2", "prompt2", nil, 1)

	req, _ := http.NewRequest("GET", "/api/topics", nil)
	rr := httptest.NewRecorder()

	app.handleTopics(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf("Expected status 200, got %d", rr.Code)
	}

	var response map[string][]*storage.Topic
	err := json.Unmarshal(rr.Body.Bytes(), &response)
	if err != nil {
		t.Fatalf("Failed to parse response: %v", err)
	}

	if len(response["topics"]) != 2 {
		t.Errorf("Expected 2 topics, got %d", len(response["topics"]))
	}
}

func TestHandleTopics_GetReturnsEmptyListWhenNoTopics(t *testing.T) {
	app := setupComprehensiveTestApp(t)

	req, _ := http.NewRequest("GET", "/api/topics", nil)
	rr := httptest.NewRecorder()

	app.handleTopics(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf("Expected status 200, got %d", rr.Code)
	}

	var response map[string][]*storage.Topic
	err := json.Unmarshal(rr.Body.Bytes(), &response)
	if err != nil {
		t.Fatalf("Failed to parse response: %v", err)
	}

	if len(response["topics"]) != 0 {
		t.Errorf("Expected 0 topics, got %d", len(response["topics"]))
	}
}

func TestHandleTopics_OptionsReturnsOK(t *testing.T) {
	app := setupComprehensiveTestApp(t)

	req, _ := http.NewRequest("OPTIONS", "/api/topics", nil)
	rr := httptest.NewRecorder()

	app.handleTopics(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf("Expected status 200 for OPTIONS, got %d", rr.Code)
	}
}

func TestHandleTopics_GetReturnsCorrectContentType(t *testing.T) {
	app := setupComprehensiveTestApp(t)

	req, _ := http.NewRequest("GET", "/api/topics", nil)
	rr := httptest.NewRecorder()

	app.handleTopics(rr, req)

	contentType := rr.Header().Get("Content-Type")
	if contentType != "application/json" {
		t.Errorf("Expected Content-Type application/json, got %s", contentType)
	}
}

// ==========================================
// handleTopics POST Tests
// ==========================================

func TestHandleTopics_PostCreatesTopicAsAdmin(t *testing.T) {
	app := setupComprehensiveTestApp(t)
	adminCtx := setupAdminContext(app, t)

	payload := `{"name": "New Topic", "prompt": "test prompt", "parent_id": null, "sort_order": 0}`
	req, _ := http.NewRequest("POST", "/api/topics", bytes.NewBufferString(payload))
	req.Header.Set("Content-Type", "application/json")
	req = req.WithContext(adminCtx)
	rr := httptest.NewRecorder()

	app.handleTopics(rr, req)

	if rr.Code != http.StatusCreated {
		t.Errorf("Expected status 201, got %d. Body: %s", rr.Code, rr.Body.String())
	}

	var topic storage.Topic
	err := json.Unmarshal(rr.Body.Bytes(), &topic)
	if err != nil {
		t.Fatalf("Failed to parse response: %v", err)
	}

	if topic.Name != "New Topic" {
		t.Errorf("Expected name 'New Topic', got '%s'", topic.Name)
	}
	if topic.Prompt != "test prompt" {
		t.Errorf("Expected prompt 'test prompt', got '%s'", topic.Prompt)
	}
}

func TestHandleTopics_PostValidatesRequiredFields(t *testing.T) {
	app := setupComprehensiveTestApp(t)
	adminCtx := setupAdminContext(app, t)

	tests := []struct {
		name     string
		payload  string
		expected int
	}{
		{"Missing name", `{"prompt": "test"}`, http.StatusBadRequest},
		{"Missing prompt", `{"name": "test"}`, http.StatusBadRequest},
		{"Empty name", `{"name": "", "prompt": "test"}`, http.StatusBadRequest},
		{"Empty prompt", `{"name": "test", "prompt": ""}`, http.StatusBadRequest},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req, _ := http.NewRequest("POST", "/api/topics", bytes.NewBufferString(tt.payload))
			req.Header.Set("Content-Type", "application/json")
			req = req.WithContext(adminCtx)
			rr := httptest.NewRecorder()

			app.handleTopics(rr, req)

			if rr.Code != tt.expected {
				t.Errorf("Expected status %d, got %d", tt.expected, rr.Code)
			}
		})
	}
}

func TestHandleTopics_PostValidatesParentID(t *testing.T) {
	app := setupComprehensiveTestApp(t)
	adminCtx := setupAdminContext(app, t)

	payload := `{"name": "New Topic", "prompt": "test prompt", "parent_id": "non-existent-id"}`
	req, _ := http.NewRequest("POST", "/api/topics", bytes.NewBufferString(payload))
	req.Header.Set("Content-Type", "application/json")
	req = req.WithContext(adminCtx)
	rr := httptest.NewRecorder()

	app.handleTopics(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Errorf("Expected status 400 for non-existent parent, got %d", rr.Code)
	}
}

func TestHandleTopics_PostRequiresAdmin(t *testing.T) {
	app := setupComprehensiveTestApp(t)

	payload := `{"name": "New Topic", "prompt": "test prompt"}`
	req, _ := http.NewRequest("POST", "/api/topics", bytes.NewBufferString(payload))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()

	app.handleTopics(rr, req)

	// Should return unauthorized or forbidden
	if rr.Code != http.StatusUnauthorized && rr.Code != http.StatusForbidden {
		t.Errorf("Expected 401 or 403 without admin, got %d", rr.Code)
	}
}

// ==========================================
// handleTopicByID GET Tests
// ==========================================

func TestHandleTopicByID_GetReturnsTopic(t *testing.T) {
	app := setupComprehensiveTestApp(t)

	topic, _ := app.DB.CreateTopic("TestTopic", "prompt", nil, 0)

	req, _ := http.NewRequest("GET", "/api/topics/"+topic.ID, nil)
	rr := httptest.NewRecorder()

	app.handleTopicByID(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf("Expected status 200, got %d", rr.Code)
	}

	var returnedTopic storage.Topic
	err := json.Unmarshal(rr.Body.Bytes(), &returnedTopic)
	if err != nil {
		t.Fatalf("Failed to parse response: %v", err)
	}

	if returnedTopic.ID != topic.ID {
		t.Errorf("Expected topic ID %s, got %s", topic.ID, returnedTopic.ID)
	}
}

func TestHandleTopicByID_GetReturnsNotFound(t *testing.T) {
	app := setupComprehensiveTestApp(t)

	req, _ := http.NewRequest("GET", "/api/topics/non-existent", nil)
	rr := httptest.NewRecorder()

	app.handleTopicByID(rr, req)

	if rr.Code != http.StatusNotFound {
		t.Errorf("Expected status 404, got %d", rr.Code)
	}
}

func TestHandleTopicByID_GetReturnsErrorForEmptyID(t *testing.T) {
	app := setupComprehensiveTestApp(t)

	req, _ := http.NewRequest("GET", "/api/topics/", nil)
	rr := httptest.NewRecorder()

	app.handleTopicByID(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Errorf("Expected status 400 for empty ID, got %d", rr.Code)
	}
}

// ==========================================
// handleTopicByID PUT Tests
// ==========================================

func TestHandleTopicByID_PutUpdatesTopic(t *testing.T) {
	app := setupComprehensiveTestApp(t)
	adminCtx := setupAdminContext(app, t)

	topic, _ := app.DB.CreateTopic("OldName", "old prompt", nil, 0)

	payload := `{"name": "NewName", "prompt": "new prompt"}`
	req, _ := http.NewRequest("PUT", "/api/topics/"+topic.ID, bytes.NewBufferString(payload))
	req.Header.Set("Content-Type", "application/json")
	req = req.WithContext(adminCtx)
	rr := httptest.NewRecorder()

	app.handleTopicByID(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf("Expected status 200, got %d. Body: %s", rr.Code, rr.Body.String())
	}

	var updatedTopic storage.Topic
	err := json.Unmarshal(rr.Body.Bytes(), &updatedTopic)
	if err != nil {
		t.Fatalf("Failed to parse response: %v", err)
	}

	if updatedTopic.Name != "NewName" {
		t.Errorf("Expected name 'NewName', got '%s'", updatedTopic.Name)
	}
	if updatedTopic.Prompt != "new prompt" {
		t.Errorf("Expected prompt 'new prompt', got '%s'", updatedTopic.Prompt)
	}
}

func TestHandleTopicByID_PutPreservesOmittedFields(t *testing.T) {
	app := setupComprehensiveTestApp(t)
	adminCtx := setupAdminContext(app, t)

	topic, _ := app.DB.CreateTopic("Topic", "prompt", nil, 5)

	// Only update name, preserve other fields
	payload := `{"name": "NewName"}`
	req, _ := http.NewRequest("PUT", "/api/topics/"+topic.ID, bytes.NewBufferString(payload))
	req.Header.Set("Content-Type", "application/json")
	req = req.WithContext(adminCtx)
	rr := httptest.NewRecorder()

	app.handleTopicByID(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf("Expected status 200, got %d", rr.Code)
	}

	// Fetch updated topic from DB to verify
	updatedTopic, _ := app.DB.GetTopic(topic.ID)
	if updatedTopic.Prompt != "prompt" {
		t.Errorf("Expected prompt to be preserved, got '%s'", updatedTopic.Prompt)
	}
	if updatedTopic.SortOrder != 5 {
		t.Errorf("Expected SortOrder to be preserved, got %d", updatedTopic.SortOrder)
	}
	if updatedTopic.ParentID != nil {
		t.Errorf("Expected ParentID to be preserved as nil, got %v", updatedTopic.ParentID)
	}
}

func TestHandleTopicByID_PutValidatesPromptRequired(t *testing.T) {
	app := setupComprehensiveTestApp(t)
	adminCtx := setupAdminContext(app, t)

	topic, _ := app.DB.CreateTopic("Topic", "prompt", nil, 0)

	payload := `{"prompt": ""}`
	req, _ := http.NewRequest("PUT", "/api/topics/"+topic.ID, bytes.NewBufferString(payload))
	req.Header.Set("Content-Type", "application/json")
	req = req.WithContext(adminCtx)
	rr := httptest.NewRecorder()

	app.handleTopicByID(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Errorf("Expected status 400 for empty prompt, got %d", rr.Code)
	}
}

func TestHandleTopicByID_PutValidatesParentIDType(t *testing.T) {
	app := setupComprehensiveTestApp(t)
	adminCtx := setupAdminContext(app, t)

	topic, _ := app.DB.CreateTopic("Topic", "prompt", nil, 0)

	payload := `{"parent_id": 123}`
	req, _ := http.NewRequest("PUT", "/api/topics/"+topic.ID, bytes.NewBufferString(payload))
	req.Header.Set("Content-Type", "application/json")
	req = req.WithContext(adminCtx)
	rr := httptest.NewRecorder()

	app.handleTopicByID(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Errorf("Expected status 400 for invalid parent_id type, got %d", rr.Code)
	}
}

func TestHandleTopicByID_PutValidatesSortOrder(t *testing.T) {
	app := setupComprehensiveTestApp(t)
	adminCtx := setupAdminContext(app, t)

	topic, _ := app.DB.CreateTopic("Topic", "prompt", nil, 0)

	tests := []struct {
		name     string
		payload  string
		expected int
	}{
		{"Negative sort_order", `{"sort_order": -1}`, http.StatusBadRequest},
		{"Fractional sort_order", `{"sort_order": 1.5}`, http.StatusBadRequest},
		{"Invalid sort_order type", `{"sort_order": "invalid"}`, http.StatusBadRequest},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req, _ := http.NewRequest("PUT", "/api/topics/"+topic.ID, bytes.NewBufferString(tt.payload))
			req.Header.Set("Content-Type", "application/json")
			req = req.WithContext(adminCtx)
			rr := httptest.NewRecorder()

			app.handleTopicByID(rr, req)

			if rr.Code != tt.expected {
				t.Errorf("Expected status %d, got %d", tt.expected, rr.Code)
			}
		})
	}
}

func TestHandleTopicByID_PutRejectsInvalidParentID(t *testing.T) {
	app := setupComprehensiveTestApp(t)
	adminCtx := setupAdminContext(app, t)

	topic, _ := app.DB.CreateTopic("Topic", "prompt", nil, 0)

	payload := `{"parent_id": "non-existent-id"}`
	req, _ := http.NewRequest("PUT", "/api/topics/"+topic.ID, bytes.NewBufferString(payload))
	req.Header.Set("Content-Type", "application/json")
	req = req.WithContext(adminCtx)
	rr := httptest.NewRecorder()

	app.handleTopicByID(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Errorf("Expected status 400 for invalid parent, got %d", rr.Code)
	}
}

// ==========================================
// handleTopicByID DELETE Tests
// ==========================================

func TestHandleTopicByID_DeleteRemovesTopic(t *testing.T) {
	app := setupComprehensiveTestApp(t)
	adminCtx := setupAdminContext(app, t)

	topic, _ := app.DB.CreateTopic("ToDelete", "prompt", nil, 0)

	req, _ := http.NewRequest("DELETE", "/api/topics/"+topic.ID, nil)
	req = req.WithContext(adminCtx)
	rr := httptest.NewRecorder()

	app.handleTopicByID(rr, req)

	if rr.Code != http.StatusNoContent {
		t.Errorf("Expected status 204, got %d", rr.Code)
	}

	// Verify topic is deleted
	_, err := app.DB.GetTopic(topic.ID)
	if err == nil {
		t.Error("Expected topic to be deleted")
	}
}

func TestHandleTopicByID_DeletePreventsTopicWithChildren(t *testing.T) {
	app := setupComprehensiveTestApp(t)
	adminCtx := setupAdminContext(app, t)

	parent, _ := app.DB.CreateTopic("Parent", "prompt", nil, 0)
	child, _ := app.DB.CreateTopic("Child", "prompt", &parent.ID, 0)

	req, _ := http.NewRequest("DELETE", "/api/topics/"+parent.ID, nil)
	req = req.WithContext(adminCtx)
	rr := httptest.NewRecorder()

	app.handleTopicByID(rr, req)

	if rr.Code != http.StatusConflict {
		t.Errorf("Expected status 409 for topic with children, got %d", rr.Code)
	}

	// Verify parent still exists
	_, err := app.DB.GetTopic(parent.ID)
	if err != nil {
		t.Error("Expected parent to still exist")
	}

	// Child should still exist
	_, err = app.DB.GetTopic(child.ID)
	if err != nil {
		t.Error("Expected child to still exist after blocked parent deletion")
	}
}

func TestHandleTopicByID_DeleteReturnsNotFound(t *testing.T) {
	app := setupComprehensiveTestApp(t)
	adminCtx := setupAdminContext(app, t)

	req, _ := http.NewRequest("DELETE", "/api/topics/non-existent", nil)
	req = req.WithContext(adminCtx)
	rr := httptest.NewRecorder()

	app.handleTopicByID(rr, req)

	// Delete is idempotent - returns 204 even if topic doesn't exist
	// This is intentional design choice
	if rr.Code != http.StatusNoContent {
		t.Errorf("Expected status 204 (idempotent delete), got %d", rr.Code)
	}
}

// ==========================================
// handleTopicByID MOVE Tests
// ==========================================

func TestHandleTopicByID_MoveTopicToRoot(t *testing.T) {
	app := setupComprehensiveTestApp(t)
	adminCtx := setupAdminContext(app, t)

	parent, _ := app.DB.CreateTopic("Parent", "prompt", nil, 0)
	child, _ := app.DB.CreateTopic("Child", "prompt", &parent.ID, 0)

	payload := `{"parent_id": ""}`
	req, _ := http.NewRequest("PUT", "/api/topics/"+child.ID+"/move", bytes.NewBufferString(payload))
	req.Header.Set("Content-Type", "application/json")
	req = req.WithContext(adminCtx)
	rr := httptest.NewRecorder()

	app.handleTopicByID(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf("Expected status 200, got %d", rr.Code)
	}

	// Verify child is now at root
	updatedChild, _ := app.DB.GetTopic(child.ID)
	if updatedChild.ParentID != nil {
		t.Errorf("Expected ParentID to be nil, got %v", updatedChild.ParentID)
	}
}

func TestHandleTopicByID_MoveTopicToPosition(t *testing.T) {
	app := setupComprehensiveTestApp(t)
	adminCtx := setupAdminContext(app, t)

	_, _ = app.DB.CreateTopic("A", "prompt", nil, 0)
	_, _ = app.DB.CreateTopic("B", "prompt", nil, 1)
	c, _ := app.DB.CreateTopic("C", "prompt", nil, 2)

	payload := `{"parent_id": "", "position": 1}`
	req, _ := http.NewRequest("PUT", "/api/topics/"+c.ID+"/move", bytes.NewBufferString(payload))
	req.Header.Set("Content-Type", "application/json")
	req = req.WithContext(adminCtx)
	rr := httptest.NewRecorder()

	app.handleTopicByID(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf("Expected status 200, got %d", rr.Code)
	}

	// Verify reordering by checking sort orders
	topics, _ := app.DB.GetAllTopics()
	var rootTopics []*storage.Topic
	for _, topic := range topics {
		if topic.ParentID == nil {
			rootTopics = append(rootTopics, topic)
		}
	}

	// Should now be 3 root topics
	if len(rootTopics) != 3 {
		t.Errorf("Expected 3 root topics, got %d", len(rootTopics))
	}
}

func TestHandleTopicByID_MoveTopicWithCycleDetection(t *testing.T) {
	app := setupComprehensiveTestApp(t)
	adminCtx := setupAdminContext(app, t)

	a, _ := app.DB.CreateTopic("A", "prompt", nil, 0)
	b, _ := app.DB.CreateTopic("B", "prompt", &a.ID, 0)
	c, _ := app.DB.CreateTopic("C", "prompt", &b.ID, 0)

	// Try to move A to be child of C (creates cycle)
	payload := `{"parent_id": "` + c.ID + `"}`
	req, _ := http.NewRequest("PUT", "/api/topics/"+a.ID+"/move", bytes.NewBufferString(payload))
	req.Header.Set("Content-Type", "application/json")
	req = req.WithContext(adminCtx)
	rr := httptest.NewRecorder()

	app.handleTopicByID(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Errorf("Expected status 400 for cycle, got %d", rr.Code)
	}

	if !strings.Contains(rr.Body.String(), "cycle") {
		t.Errorf("Expected cycle error message, got: %s", rr.Body.String())
	}
}

func TestHandleTopicByID_MoveTopicNotFound(t *testing.T) {
	app := setupComprehensiveTestApp(t)
	adminCtx := setupAdminContext(app, t)

	payload := `{"parent_id": ""}`
	req, _ := http.NewRequest("PUT", "/api/topics/non-existent/move", bytes.NewBufferString(payload))
	req.Header.Set("Content-Type", "application/json")
	req = req.WithContext(adminCtx)
	rr := httptest.NewRecorder()

	app.handleTopicByID(rr, req)

	if rr.Code != http.StatusNotFound {
		t.Errorf("Expected status 404, got %d", rr.Code)
	}
}

// ==========================================
// handleTopicByID Path Parsing Tests
// ==========================================

func TestHandleTopicByID_InvalidPath(t *testing.T) {
	app := setupComprehensiveTestApp(t)

	tests := []struct {
		path     string
		expected int
	}{
		{"/api/topics/", http.StatusBadRequest},
		{"/api/topics/a/b/c", http.StatusBadRequest},
		{"/api/topics/a/invalid", http.StatusBadRequest},
	}

	for _, tt := range tests {
		t.Run(tt.path, func(t *testing.T) {
			req, _ := http.NewRequest("GET", tt.path, nil)
			rr := httptest.NewRecorder()

			app.handleTopicByID(rr, req)

			if rr.Code != tt.expected {
				t.Errorf("Expected status %d, got %d", tt.expected, rr.Code)
			}
		})
	}
}

// ==========================================
// handleVersions Tests
// ==========================================

func TestHandleVersions_GetVersions(t *testing.T) {
	app := setupComprehensiveTestApp(t)

	topic, _ := app.DB.CreateTopic("Topic", "prompt", nil, 0)

	req, _ := http.NewRequest("GET", "/api/versions/"+topic.ID, nil)
	rr := httptest.NewRecorder()

	app.handleVersions(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf("Expected status 200, got %d", rr.Code)
	}

	var response map[string][]*storage.PromptVersion
	err := json.Unmarshal(rr.Body.Bytes(), &response)
	if err != nil {
		t.Fatalf("Failed to parse response: %v", err)
	}

	// Should have at least the initial version
	if len(response["versions"]) == 0 {
		t.Error("Expected at least one version")
	}
}

func TestHandleVersions_GetVersionsNotFound(t *testing.T) {
	app := setupComprehensiveTestApp(t)

	req, _ := http.NewRequest("GET", "/api/versions/non-existent", nil)
	rr := httptest.NewRecorder()

	app.handleVersions(rr, req)

	// GetVersions returns empty array for non-existent topics
	if rr.Code != http.StatusOK {
		t.Errorf("Expected status 200 for empty versions array, got %d", rr.Code)
	}

	var response map[string][]*storage.PromptVersion
	err := json.Unmarshal(rr.Body.Bytes(), &response)
	if err != nil {
		t.Fatalf("Failed to parse response: %v", err)
	}

	if len(response["versions"]) != 0 {
		t.Errorf("Expected empty versions array for non-existent topic, got %d", len(response["versions"]))
	}
}

func TestHandleVersions_RestoreVersion(t *testing.T) {
	app := setupComprehensiveTestApp(t)
	adminCtx := setupAdminContext(app, t)

	topic, _ := app.DB.CreateTopic("Topic", "original prompt", nil, 0)

	// Update topic to create a new version
	app.DB.UpdateTopic(topic.ID, "Topic", "updated prompt", nil, 0)

	// Get versions to find the original (versions are ordered by version ASC, so first is original)
	versions, _ := app.DB.GetVersions(topic.ID)
	if len(versions) < 2 {
		t.Fatal("Expected at least 2 versions")
	}
	originalVersion := versions[0] // First one is original (version 1)

	// Restore original version
	req, _ := http.NewRequest("POST", "/api/versions/"+topic.ID+"/restore/"+originalVersion.ID, nil)
	req = req.WithContext(adminCtx)
	rr := httptest.NewRecorder()

	app.handleVersions(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf("Expected status 200, got %d", rr.Code)
	}

	// Verify prompt was restored (Note: restore creates a NEW version, so we need to get the latest)
	restoredTopic, _ := app.DB.GetTopic(topic.ID)
	if restoredTopic.Prompt != "original prompt" {
		t.Errorf("Expected prompt 'original prompt', got '%s'", restoredTopic.Prompt)
	}
}

func TestHandleVersions_RestoreVersionNotFound(t *testing.T) {
	app := setupComprehensiveTestApp(t)
	adminCtx := setupAdminContext(app, t)

	topic, _ := app.DB.CreateTopic("Topic", "prompt", nil, 0)

	req, _ := http.NewRequest("POST", "/api/versions/"+topic.ID+"/restore/non-existent", nil)
	req = req.WithContext(adminCtx)
	rr := httptest.NewRecorder()

	app.handleVersions(rr, req)

	if rr.Code != http.StatusNotFound {
		t.Errorf("Expected status 404, got %d", rr.Code)
	}
}

func TestHandleVersions_InvalidRestorePath(t *testing.T) {
	app := setupComprehensiveTestApp(t)
	adminCtx := setupAdminContext(app, t)

	topic, _ := app.DB.CreateTopic("Topic", "prompt", nil, 0)

	req, _ := http.NewRequest("POST", "/api/versions/"+topic.ID+"/invalid/path", nil)
	req = req.WithContext(adminCtx)
	rr := httptest.NewRecorder()

	app.handleVersions(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Errorf("Expected status 400, got %d", rr.Code)
	}
}

func TestHandleVersions_RestoreVersionWrongTopic(t *testing.T) {
	app := setupComprehensiveTestApp(t)
	adminCtx := setupAdminContext(app, t)

	topic1, _ := app.DB.CreateTopic("Topic1", "prompt1", nil, 0)
	topic2, _ := app.DB.CreateTopic("Topic2", "prompt2", nil, 0)

	// Get a version from topic1
	versions1, _ := app.DB.GetVersions(topic1.ID)
	if len(versions1) == 0 {
		t.Fatal("Expected at least one version")
	}
	version1 := versions1[0]

	// Try to restore it to topic2
	req, _ := http.NewRequest("POST", "/api/versions/"+topic2.ID+"/restore/"+version1.ID, nil)
	req = req.WithContext(adminCtx)
	rr := httptest.NewRecorder()

	app.handleVersions(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Errorf("Expected status 400, got %d", rr.Code)
	}
}

// ==========================================
// CORS and Method Tests
// ==========================================

func TestCORSHeadersAreSet(t *testing.T) {
	app := setupComprehensiveTestApp(t)

	req, _ := http.NewRequest("OPTIONS", "/api/topics", nil)
	rr := httptest.NewRecorder()

	app.handleTopics(rr, req)

	origin := rr.Header().Get("Access-Control-Allow-Origin")
	if origin != "*" {
		t.Errorf("Expected Access-Control-Allow-Origin *, got %s", origin)
	}

	methods := rr.Header().Get("Access-Control-Allow-Methods")
	if !strings.Contains(methods, "GET") || !strings.Contains(methods, "POST") {
		t.Errorf("Expected GET and POST in methods, got %s", methods)
	}
}

func TestMethodNotAllowedReturns405(t *testing.T) {
	app := setupComprehensiveTestApp(t)

	tests := []struct {
		method string
		path   string
	}{
		{"PATCH", "/api/topics"},
		{"DELETE", "/api/topics"},
		{"HEAD", "/api/topics/123"},
		{"PATCH", "/api/topics/123"},
	}

	for _, tt := range tests {
		t.Run(tt.method+" "+tt.path, func(t *testing.T) {
			req, _ := http.NewRequest(tt.method, tt.path, nil)
			rr := httptest.NewRecorder()

			if strings.HasPrefix(tt.path, "/api/topics/") && !strings.Contains(tt.path, "/move") {
				app.handleTopicByID(rr, req)
			} else if strings.Contains(tt.path, "/move") {
				app.handleTopicByID(rr, req)
			} else {
				app.handleTopics(rr, req)
			}

			if rr.Code != http.StatusMethodNotAllowed {
				t.Errorf("Expected status 405, got %d", rr.Code)
			}
		})
	}
}

// ==========================================
// Integration Tests for Complete Workflows
// ==========================================

func TestIntegration_CreateUpdateDeleteTopic(t *testing.T) {
	app := setupComprehensiveTestApp(t)
	adminCtx := setupAdminContext(app, t)

	// Create topic
	createPayload := `{"name": "Integration Topic", "prompt": "test prompt", "parent_id": null, "sort_order": 0}`
	createReq, _ := http.NewRequest("POST", "/api/topics", bytes.NewBufferString(createPayload))
	createReq.Header.Set("Content-Type", "application/json")
	createReq = createReq.WithContext(adminCtx)
	createRR := httptest.NewRecorder()

	app.handleTopics(createRR, createReq)

	if createRR.Code != http.StatusCreated {
		t.Fatalf("Failed to create topic, got status %d", createRR.Code)
	}

	var createdTopic storage.Topic
	if err := json.Unmarshal(createRR.Body.Bytes(), &createdTopic); err != nil {
		t.Fatalf("Failed to parse create response: %v", err)
	}

	// Update topic
	updatePayload := `{"name": "Updated Topic", "prompt": "updated prompt"}`
	updateReq, _ := http.NewRequest("PUT", "/api/topics/"+createdTopic.ID, bytes.NewBufferString(updatePayload))
	updateReq.Header.Set("Content-Type", "application/json")
	updateReq = updateReq.WithContext(adminCtx)
	updateRR := httptest.NewRecorder()

	app.handleTopicByID(updateRR, updateReq)

	if updateRR.Code != http.StatusOK {
		t.Fatalf("Failed to update topic, got status %d", updateRR.Code)
	}

	// Verify update
	getReq, _ := http.NewRequest("GET", "/api/topics/"+createdTopic.ID, nil)
	getRR := httptest.NewRecorder()

	app.handleTopicByID(getRR, getReq)

	if getRR.Code != http.StatusOK {
		t.Fatalf("Failed to get topic, got status %d", getRR.Code)
	}

	var updatedTopic storage.Topic
	if err := json.Unmarshal(getRR.Body.Bytes(), &updatedTopic); err != nil {
		t.Fatalf("Failed to parse get response: %v", err)
	}

	if updatedTopic.Name != "Updated Topic" {
		t.Errorf("Expected name 'Updated Topic', got '%s'", updatedTopic.Name)
	}

	// Delete topic
	deleteReq, _ := http.NewRequest("DELETE", "/api/topics/"+createdTopic.ID, nil)
	deleteReq = deleteReq.WithContext(adminCtx)
	deleteRR := httptest.NewRecorder()

	app.handleTopicByID(deleteRR, deleteReq)

	if deleteRR.Code != http.StatusNoContent {
		t.Fatalf("Failed to delete topic, got status %d", deleteRR.Code)
	}

	// Verify deletion
	_, err := app.DB.GetTopic(createdTopic.ID)
	if err == nil {
		t.Error("Topic should have been deleted")
	}
}

func TestIntegration_CreateNestedTopicsAndMove(t *testing.T) {
	app := setupComprehensiveTestApp(t)
	adminCtx := setupAdminContext(app, t)

	// Create parent
	parentPayload := `{"name": "Parent", "prompt": "parent prompt"}`
	parentReq, _ := http.NewRequest("POST", "/api/topics", bytes.NewBufferString(parentPayload))
	parentReq.Header.Set("Content-Type", "application/json")
	parentReq = parentReq.WithContext(adminCtx)
	parentRR := httptest.NewRecorder()

	app.handleTopics(parentRR, parentReq)

	var parent storage.Topic
	if err := json.Unmarshal(parentRR.Body.Bytes(), &parent); err != nil {
		t.Fatalf("Failed to parse parent response: %v", err)
	}

	// Create child
	childPayload := `{"name": "Child", "prompt": "child prompt", "parent_id": "` + parent.ID + `"}`
	childReq, _ := http.NewRequest("POST", "/api/topics", bytes.NewBufferString(childPayload))
	childReq.Header.Set("Content-Type", "application/json")
	childReq = childReq.WithContext(adminCtx)
	childRR := httptest.NewRecorder()

	app.handleTopics(childRR, childReq)

	var child storage.Topic
	if err := json.Unmarshal(childRR.Body.Bytes(), &child); err != nil {
		t.Fatalf("Failed to parse child response: %v", err)
	}

	// Move child to root
	movePayload := `{"parent_id": ""}`
	moveReq, _ := http.NewRequest("PUT", "/api/topics/"+child.ID+"/move", bytes.NewBufferString(movePayload))
	moveReq.Header.Set("Content-Type", "application/json")
	moveReq = moveReq.WithContext(adminCtx)
	moveRR := httptest.NewRecorder()

	app.handleTopicByID(moveRR, moveReq)

	if moveRR.Code != http.StatusOK {
		t.Errorf("Failed to move topic, got status %d", moveRR.Code)
	}

	// Verify child is at root
	updatedChild, _ := app.DB.GetTopic(child.ID)
	if updatedChild.ParentID != nil {
		t.Error("Child should be at root level")
	}
}
