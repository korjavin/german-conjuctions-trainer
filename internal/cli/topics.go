package cli

import (
	"errors"
	"net/http"
	"net/url"
	"time"
)

// Topic mirrors the JSON shape the server returns from /api/topics. We keep
// a CLI-local copy rather than importing pkg/storage so the CLI binary stays
// free of the SQLite/CGO dependency chain that pkg/storage drags in.
type Topic struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	Prompt    string    `json:"prompt"`
	ParentID  *string   `json:"parent_id,omitempty"`
	SortOrder int       `json:"sort_order"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// TopicUpdate is a sparse representation of fields the caller wants to change
// during a PUT /api/topics/{id}. nil fields are omitted from the request body
// so the server retains the current value (see handleTopicByID's
// presence-aware decoder). The parent has three states which can't be
// expressed with a single *string: leave unchanged, clear to root, or set to
// a specific topic — hence the separate ClearParent flag.
type TopicUpdate struct {
	Name        *string
	Prompt      *string
	SortOrder   *int
	Parent      *string
	ClearParent bool
}

// ListTopics returns every topic the server can see. The server returns them
// already sorted by parent_id, sort_order, then name.
func (c *Client) ListTopics() ([]*Topic, error) {
	var resp struct {
		Topics []*Topic `json:"topics"`
	}
	if err := c.Do(http.MethodGet, "/api/topics", nil, &resp); err != nil {
		return nil, err
	}
	return resp.Topics, nil
}

// GetTopic fetches a single topic by ID. A missing topic surfaces as
// errors.Is(err, ErrNotFound).
func (c *Client) GetTopic(id string) (*Topic, error) {
	if id == "" {
		return nil, errors.New("topic id is required")
	}
	var t Topic
	if err := c.Do(http.MethodGet, "/api/topics/"+url.PathEscape(id), nil, &t); err != nil {
		return nil, err
	}
	return &t, nil
}

// CreateTopic posts a new topic. parentID nil or empty creates the topic at
// the root level. The server enforces uniqueness within a parent and may
// return ErrForbidden if the caller isn't an admin.
func (c *Client) CreateTopic(name, prompt string, parentID *string, sortOrder int) (*Topic, error) {
	body := map[string]any{
		"name":       name,
		"prompt":     prompt,
		"sort_order": sortOrder,
	}
	if parentID != nil && *parentID != "" {
		body["parent_id"] = *parentID
	}
	var t Topic
	if err := c.Do(http.MethodPost, "/api/topics", body, &t); err != nil {
		return nil, err
	}
	return &t, nil
}

// UpdateTopic sends only the fields present in partial. The server's PUT
// handler reads the raw map and falls back to the existing topic for any
// key that isn't supplied.
func (c *Client) UpdateTopic(id string, partial TopicUpdate) (*Topic, error) {
	if id == "" {
		return nil, errors.New("topic id is required")
	}
	body := map[string]any{}
	if partial.Name != nil {
		body["name"] = *partial.Name
	}
	if partial.Prompt != nil {
		body["prompt"] = *partial.Prompt
	}
	if partial.SortOrder != nil {
		body["sort_order"] = *partial.SortOrder
	}
	if partial.ClearParent {
		body["parent_id"] = nil
	} else if partial.Parent != nil {
		body["parent_id"] = *partial.Parent
	}
	var t Topic
	if err := c.Do(http.MethodPut, "/api/topics/"+url.PathEscape(id), body, &t); err != nil {
		return nil, err
	}
	return &t, nil
}

// DeleteTopic removes a topic by ID. The server returns 409 if the topic has
// children — Do surfaces that as an *APIError with the message verbatim.
func (c *Client) DeleteTopic(id string) error {
	if id == "" {
		return errors.New("topic id is required")
	}
	return c.Do(http.MethodDelete, "/api/topics/"+url.PathEscape(id), nil, nil)
}

// MoveTopic reparents and optionally repositions a topic. parentID == ""
// moves the topic to the root level (matching the server's MoveTopic
// semantics). position == nil appends to the end of the destination parent.
func (c *Client) MoveTopic(id, parentID string, position *int) (*Topic, error) {
	if id == "" {
		return nil, errors.New("topic id is required")
	}
	body := map[string]any{
		"parent_id": parentID,
	}
	if position != nil {
		body["position"] = *position
	}
	var t Topic
	if err := c.Do(http.MethodPut, "/api/topics/"+url.PathEscape(id)+"/move", body, &t); err != nil {
		return nil, err
	}
	return &t, nil
}
