package cli

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// fakeTopicsServer returns an httptest.Server that records every received
// request (method, path, decoded body) so each test asserts wire shape.
type recordedRequest struct {
	Method string
	Path   string
	Body   map[string]any
}

type fakeTopicsServer struct {
	*httptest.Server
	last       *recordedRequest
	statusCode int
	respBody   string
}

func newFakeTopicsServer(t *testing.T) *fakeTopicsServer {
	t.Helper()
	f := &fakeTopicsServer{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		rec := &recordedRequest{Method: r.Method, Path: r.URL.Path}
		raw, _ := io.ReadAll(r.Body)
		if len(raw) > 0 {
			rec.Body = map[string]any{}
			if err := json.Unmarshal(raw, &rec.Body); err != nil {
				t.Errorf("server got non-JSON body for %s %s: %v", r.Method, r.URL.Path, err)
			}
		}
		f.last = rec
		status := f.statusCode
		if status == 0 {
			if r.Method == http.MethodPost {
				status = http.StatusCreated
			} else if r.Method == http.MethodDelete {
				status = http.StatusNoContent
			} else {
				status = http.StatusOK
			}
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		if f.respBody != "" {
			_, _ = w.Write([]byte(f.respBody))
		}
	}))
	f.Server = srv
	t.Cleanup(srv.Close)
	return f
}

func TestListTopicsRoundTrip(t *testing.T) {
	srv := newFakeTopicsServer(t)
	srv.respBody = `{"topics":[{"id":"t1","name":"Greetings","prompt":"p","sort_order":0},{"id":"t2","name":"Numbers","prompt":"p2","sort_order":1}]}`

	c := NewClient(srv.URL, "tok")
	topics, err := c.ListTopics()
	if err != nil {
		t.Fatalf("ListTopics: %v", err)
	}
	if len(topics) != 2 || topics[0].ID != "t1" || topics[1].ID != "t2" {
		t.Fatalf("unexpected topics: %+v", topics)
	}
	if srv.last.Method != http.MethodGet || srv.last.Path != "/api/topics" {
		t.Errorf("request = %s %s, want GET /api/topics", srv.last.Method, srv.last.Path)
	}
}

func TestGetTopicRoundTrip(t *testing.T) {
	srv := newFakeTopicsServer(t)
	srv.respBody = `{"id":"t1","name":"Greetings","prompt":"hello","sort_order":3}`

	c := NewClient(srv.URL, "tok")
	got, err := c.GetTopic("t1")
	if err != nil {
		t.Fatalf("GetTopic: %v", err)
	}
	if got.ID != "t1" || got.Name != "Greetings" || got.SortOrder != 3 {
		t.Fatalf("unexpected topic: %+v", got)
	}
	if srv.last.Method != http.MethodGet || srv.last.Path != "/api/topics/t1" {
		t.Errorf("request = %s %s", srv.last.Method, srv.last.Path)
	}
}

func TestGetTopicEmptyIDErrors(t *testing.T) {
	c := NewClient("http://example", "tok")
	if _, err := c.GetTopic(""); err == nil {
		t.Fatal("expected error for empty id")
	}
}

func TestCreateTopicSendsBodyAndParsesResponse(t *testing.T) {
	srv := newFakeTopicsServer(t)
	srv.respBody = `{"id":"new","name":"NewOne","prompt":"hi","sort_order":2}`

	c := NewClient(srv.URL, "tok")
	parent := "parent-1"
	got, err := c.CreateTopic("NewOne", "hi there ten chars", &parent, 2)
	if err != nil {
		t.Fatalf("CreateTopic: %v", err)
	}
	if got.ID != "new" {
		t.Errorf("ID = %q, want new", got.ID)
	}
	if srv.last.Method != http.MethodPost || srv.last.Path != "/api/topics" {
		t.Errorf("request = %s %s", srv.last.Method, srv.last.Path)
	}
	if srv.last.Body["name"] != "NewOne" {
		t.Errorf("body.name = %v", srv.last.Body["name"])
	}
	if srv.last.Body["prompt"] != "hi there ten chars" {
		t.Errorf("body.prompt = %v", srv.last.Body["prompt"])
	}
	if srv.last.Body["parent_id"] != "parent-1" {
		t.Errorf("body.parent_id = %v", srv.last.Body["parent_id"])
	}
	if srv.last.Body["sort_order"] != float64(2) {
		t.Errorf("body.sort_order = %v", srv.last.Body["sort_order"])
	}
}

func TestCreateTopicOmitsParentWhenNil(t *testing.T) {
	srv := newFakeTopicsServer(t)
	srv.respBody = `{"id":"new"}`

	c := NewClient(srv.URL, "tok")
	if _, err := c.CreateTopic("Root", "prompt body here", nil, 0); err != nil {
		t.Fatalf("CreateTopic: %v", err)
	}
	if _, present := srv.last.Body["parent_id"]; present {
		t.Errorf("expected parent_id to be omitted, got %v", srv.last.Body["parent_id"])
	}
}

func TestUpdateTopicSendsOnlyProvidedFields(t *testing.T) {
	srv := newFakeTopicsServer(t)
	srv.respBody = `{"id":"t1","name":"Renamed"}`

	c := NewClient(srv.URL, "tok")
	name := "Renamed"
	got, err := c.UpdateTopic("t1", TopicUpdate{Name: &name})
	if err != nil {
		t.Fatalf("UpdateTopic: %v", err)
	}
	if got.Name != "Renamed" {
		t.Errorf("Name = %q, want Renamed", got.Name)
	}
	if srv.last.Method != http.MethodPut || srv.last.Path != "/api/topics/t1" {
		t.Errorf("request = %s %s", srv.last.Method, srv.last.Path)
	}
	if srv.last.Body["name"] != "Renamed" {
		t.Errorf("body.name = %v", srv.last.Body["name"])
	}
	if _, present := srv.last.Body["prompt"]; present {
		t.Errorf("prompt should be omitted when not in partial")
	}
	if _, present := srv.last.Body["parent_id"]; present {
		t.Errorf("parent_id should be omitted when neither Parent nor ClearParent set")
	}
}

func TestUpdateTopicClearParentSendsNull(t *testing.T) {
	srv := newFakeTopicsServer(t)
	srv.respBody = `{"id":"t1"}`

	c := NewClient(srv.URL, "tok")
	if _, err := c.UpdateTopic("t1", TopicUpdate{ClearParent: true}); err != nil {
		t.Fatalf("UpdateTopic: %v", err)
	}
	val, present := srv.last.Body["parent_id"]
	if !present {
		t.Fatalf("parent_id missing; ClearParent should serialize as explicit null")
	}
	if val != nil {
		t.Errorf("parent_id = %v, want JSON null", val)
	}
}

func TestUpdateTopicParentOverridesClear(t *testing.T) {
	// ClearParent wins when both are set — but we still want the documented
	// behaviour codified so future edits don't silently flip it.
	srv := newFakeTopicsServer(t)
	srv.respBody = `{"id":"t1"}`

	c := NewClient(srv.URL, "tok")
	parent := "p"
	if _, err := c.UpdateTopic("t1", TopicUpdate{Parent: &parent, ClearParent: true}); err != nil {
		t.Fatalf("UpdateTopic: %v", err)
	}
	val, _ := srv.last.Body["parent_id"]
	if val != nil {
		t.Errorf("ClearParent should win; parent_id = %v", val)
	}
}

func TestUpdateTopicSendsSortOrder(t *testing.T) {
	srv := newFakeTopicsServer(t)
	srv.respBody = `{"id":"t1"}`

	c := NewClient(srv.URL, "tok")
	sortOrder := 5
	if _, err := c.UpdateTopic("t1", TopicUpdate{SortOrder: &sortOrder}); err != nil {
		t.Fatalf("UpdateTopic: %v", err)
	}
	if srv.last.Body["sort_order"] != float64(5) {
		t.Errorf("body.sort_order = %v", srv.last.Body["sort_order"])
	}
}

func TestDeleteTopicSendsDelete(t *testing.T) {
	srv := newFakeTopicsServer(t)
	c := NewClient(srv.URL, "tok")
	if err := c.DeleteTopic("t1"); err != nil {
		t.Fatalf("DeleteTopic: %v", err)
	}
	if srv.last.Method != http.MethodDelete || srv.last.Path != "/api/topics/t1" {
		t.Errorf("request = %s %s", srv.last.Method, srv.last.Path)
	}
}

func TestMoveTopicRoundTrip(t *testing.T) {
	srv := newFakeTopicsServer(t)
	srv.respBody = `{"id":"t1","parent_id":"p1","sort_order":2}`

	c := NewClient(srv.URL, "tok")
	position := 2
	got, err := c.MoveTopic("t1", "p1", &position)
	if err != nil {
		t.Fatalf("MoveTopic: %v", err)
	}
	if got.ID != "t1" {
		t.Errorf("ID = %q, want t1", got.ID)
	}
	if srv.last.Method != http.MethodPut || srv.last.Path != "/api/topics/t1/move" {
		t.Errorf("request = %s %s", srv.last.Method, srv.last.Path)
	}
	if srv.last.Body["parent_id"] != "p1" {
		t.Errorf("body.parent_id = %v", srv.last.Body["parent_id"])
	}
	if srv.last.Body["position"] != float64(2) {
		t.Errorf("body.position = %v", srv.last.Body["position"])
	}
}

func TestMoveTopicOmitsPositionWhenNil(t *testing.T) {
	srv := newFakeTopicsServer(t)
	srv.respBody = `{"id":"t1"}`

	c := NewClient(srv.URL, "tok")
	if _, err := c.MoveTopic("t1", "", nil); err != nil {
		t.Fatalf("MoveTopic: %v", err)
	}
	if srv.last.Body["parent_id"] != "" {
		t.Errorf("body.parent_id = %v, want empty string for root", srv.last.Body["parent_id"])
	}
	if _, present := srv.last.Body["position"]; present {
		t.Errorf("position should be omitted when nil")
	}
}

func TestTopicMethodsSurface401(t *testing.T) {
	srv := newFakeTopicsServer(t)
	srv.statusCode = http.StatusUnauthorized
	srv.respBody = `{"error":"not logged in"}`

	c := NewClient(srv.URL, "tok")
	_, err := c.ListTopics()
	if !errors.Is(err, ErrUnauthorized) {
		t.Errorf("ListTopics: errors.Is(err, ErrUnauthorized) = false: %v", err)
	}

	_, err = c.CreateTopic("n", "prompt long enough", nil, 0)
	if !errors.Is(err, ErrUnauthorized) {
		t.Errorf("CreateTopic 401: %v", err)
	}
}

func TestTopicMethodsSurface403(t *testing.T) {
	srv := newFakeTopicsServer(t)
	srv.statusCode = http.StatusForbidden
	srv.respBody = `{"error":"admin only"}`

	c := NewClient(srv.URL, "tok")
	_, err := c.CreateTopic("n", "prompt long enough", nil, 0)
	if !errors.Is(err, ErrForbidden) {
		t.Errorf("CreateTopic 403: errors.Is(err, ErrForbidden) = false: %v", err)
	}
	var apiErr *APIError
	if !errors.As(err, &apiErr) {
		t.Fatalf("expected *APIError, got %T", err)
	}
	if !strings.Contains(apiErr.Body, "admin only") {
		t.Errorf("APIError body = %q, want to contain 'admin only'", apiErr.Body)
	}
}

func TestTopicMethodsSurface404(t *testing.T) {
	srv := newFakeTopicsServer(t)
	srv.statusCode = http.StatusNotFound
	srv.respBody = `not found`

	c := NewClient(srv.URL, "tok")
	_, err := c.GetTopic("missing")
	if !errors.Is(err, ErrNotFound) {
		t.Errorf("GetTopic 404: errors.Is(err, ErrNotFound) = false: %v", err)
	}
}
