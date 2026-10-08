package app

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"german-conjunctions-trainer/pkg/storage"
)

func TestHandleTopicByID_ArchiveAndUnarchive(t *testing.T) {
	app := setupTestApp(t)
	app.AdminGoogleID = "admin123"
	adminUser, _ := app.DB.CreateUser("admin123")

	parent, _ := app.DB.CreateTopic("Parent", "valid prompt", nil, 0)
	child, _ := app.DB.CreateTopic("Child", "valid prompt", &parent.ID, 0)

	do := func(method, path string, admin bool) *httptest.ResponseRecorder {
		req, _ := http.NewRequest(method, path, nil)
		if admin {
			req = req.WithContext(context.WithValue(req.Context(), userContextKey, adminUser.ID))
		}
		rr := httptest.NewRecorder()
		app.handleTopicByID(rr, req)
		return rr
	}

	if rr := do("POST", "/api/topics/"+child.ID+"/archive", false); rr.Code != http.StatusForbidden && rr.Code != http.StatusUnauthorized {
		t.Fatalf("non-admin archive: status %d", rr.Code)
	}
	if rr := do("GET", "/api/topics/"+child.ID+"/archive", true); rr.Code != http.StatusMethodNotAllowed {
		t.Fatalf("GET archive: status %d", rr.Code)
	}

	rr := do("POST", "/api/topics/"+child.ID+"/archive", true)
	if rr.Code != http.StatusOK {
		t.Fatalf("archive: status %d body %s", rr.Code, rr.Body.String())
	}
	var moved storage.Topic
	json.Unmarshal(rr.Body.Bytes(), &moved)
	if moved.ParentID == nil || *moved.ParentID != storage.ArchiveTopicID {
		t.Fatalf("archived topic parent = %v", moved.ParentID)
	}

	if rr := do("POST", "/api/topics/"+child.ID+"/archive", true); rr.Code != http.StatusBadRequest {
		t.Fatalf("second archive: status %d", rr.Code)
	}
	if rr := do("POST", "/api/topics/missing/archive", true); rr.Code != http.StatusNotFound {
		t.Fatalf("missing topic: status %d", rr.Code)
	}

	// GET /api/topics flags the archive root.
	listRR := httptest.NewRecorder()
	app.handleTopics(listRR, httptest.NewRequest("GET", "/api/topics", nil))
	var list struct {
		Topics []map[string]interface{} `json:"topics"`
	}
	json.Unmarshal(listRR.Body.Bytes(), &list)
	found := false
	for _, tp := range list.Topics {
		if tp["id"] == storage.ArchiveTopicID {
			found = tp["is_archive"] == true
		}
	}
	if !found {
		t.Fatalf("archive root missing or not flagged in topic list: %s", listRR.Body.String())
	}

	rr = do("POST", "/api/topics/"+child.ID+"/unarchive", true)
	if rr.Code != http.StatusOK {
		t.Fatalf("unarchive: status %d body %s", rr.Code, rr.Body.String())
	}
	json.Unmarshal(rr.Body.Bytes(), &moved)
	if moved.ParentID == nil || *moved.ParentID != parent.ID {
		t.Fatalf("restored topic parent = %v, want %s", moved.ParentID, parent.ID)
	}
}
