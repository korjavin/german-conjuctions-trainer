package app

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	"german-conjunctions-trainer/pkg/storage"
)

type TopicRequest struct {
	Name      string  `json:"name"`
	Prompt    string  `json:"prompt"`
	ParentID  *string `json:"parent_id"`
	SortOrder int     `json:"sort_order"`
}

type UpdateTopicRequest struct {
	Name      string  `json:"name"`
	Prompt    string  `json:"prompt"`
	ParentID  *string `json:"parent_id"`
	SortOrder int     `json:"sort_order"`
}

// validateTopicTree ensures we don't create cycles and the parent exists
func (a *App) validateTopicTree(topicID *string, parentID *string) error {
	if parentID == nil {
		return nil
	}

	if topicID != nil && *parentID == *topicID {
		return fmt.Errorf("a topic cannot be its own parent")
	}

	// Check if parent exists
	parent, err := a.DB.GetTopic(*parentID)
	if err != nil {
		return fmt.Errorf("parent topic not found")
	}

	// Check for cycles
	if topicID != nil {
		currentParent := parent.ParentID
		for currentParent != nil {
			if *currentParent == *topicID {
				return fmt.Errorf("cannot create a cycle in the topic tree")
			}
			p, err := a.DB.GetTopic(*currentParent)
			if err != nil {
				return fmt.Errorf("invalid parent reference in tree")
			}
			currentParent = p.ParentID
		}
	}

	return nil
}

func (a *App) handleTopics(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type")

	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusOK)
		return
	}

	switch r.Method {
	case http.MethodGet:
		topicsList, err := a.DB.GetAllTopics()
		if err != nil {
			http.Error(w, fmt.Sprintf("Failed to get topics: %v", err), http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string][]*storage.Topic{"topics": topicsList})

	case http.MethodPost:
		a.adminOnly(func(w http.ResponseWriter, r *http.Request) {
			var req TopicRequest
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				http.Error(w, "Invalid request body", http.StatusBadRequest)
				return
			}

			if req.Name == "" || req.Prompt == "" {
				http.Error(w, "Name and prompt are required", http.StatusBadRequest)
				return
			}

			if err := a.validateTopicTree(nil, req.ParentID); err != nil {
				http.Error(w, err.Error(), http.StatusBadRequest)
				return
			}

			topic, err := a.DB.CreateTopic(req.Name, req.Prompt, req.ParentID, req.SortOrder)
			if err != nil {
				http.Error(w, fmt.Sprintf("Failed to create topic: %v", err), http.StatusInternalServerError)
				return
			}

			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusCreated)
			json.NewEncoder(w).Encode(topic)
		}).ServeHTTP(w, r)

	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

func (a *App) handleTopicByID(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "GET, PUT, DELETE, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type")

	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusOK)
		return
	}

	topicID := strings.TrimPrefix(r.URL.Path, "/api/topics/")
	if topicID == "" {
		http.Error(w, "Topic ID required", http.StatusBadRequest)
		return
	}

	switch r.Method {
	case http.MethodGet:
		topic, err := a.DB.GetTopic(topicID)
		if err != nil {
			http.Error(w, "Topic not found", http.StatusNotFound)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(topic)

	case http.MethodPut:
		a.adminOnly(func(w http.ResponseWriter, r *http.Request) {
			// Fetch the existing topic to use as a fallback for missing/omitted fields
			existingTopic, err := a.DB.GetTopic(topicID)
			if err != nil {
				http.Error(w, "Topic not found", http.StatusNotFound)
				return
			}

			// By default, assume the user might not send parent_id or sort_order (e.g. older clients).
			// If not sent, we want to retain the existing values.
			// The json decoder will leave missing fields as zero values. For ParentID, which is a pointer, it stays nil.
			// But nil actually means "root", so we need to know if it was *omitted* or explicitly set to null.
			// It's safer to read the raw request map to check for presence.
			var rawReq map[string]interface{}

			// To be robust and simple, we decode twice. Or just decode into the struct and rely on frontend sending it.
			// Since the feedback asked to fallback: "fallback to current topic before calling storage".
			if err := json.NewDecoder(r.Body).Decode(&rawReq); err != nil {
				http.Error(w, "Invalid request body", http.StatusBadRequest)
				return
			}

			name := existingTopic.Name
			if val, ok := rawReq["name"].(string); ok {
				name = val
			}
			prompt := existingTopic.Prompt
			if val, ok := rawReq["prompt"].(string); ok {
				prompt = val
			}

			parentID := existingTopic.ParentID
			if _, exists := rawReq["parent_id"]; exists {
				if val, ok := rawReq["parent_id"].(string); ok && val != "" {
					parentID = &val
				} else {
					parentID = nil
				}
			}

			sortOrder := existingTopic.SortOrder
			if val, ok := rawReq["sort_order"].(float64); ok { // JSON numbers decode to float64
				sortOrder = int(val)
			}

			if prompt == "" {
				http.Error(w, "Prompt is required", http.StatusBadRequest)
				return
			}

			if err := a.validateTopicTree(&topicID, parentID); err != nil {
				http.Error(w, err.Error(), http.StatusBadRequest)
				return
			}

			topic, err := a.DB.UpdateTopic(topicID, name, prompt, parentID, sortOrder)
			if err != nil {
				http.Error(w, fmt.Sprintf("Failed to update topic: %v", err), http.StatusInternalServerError)
				return
			}

			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(topic)
		}).ServeHTTP(w, r)

	case http.MethodDelete:
		a.adminOnly(func(w http.ResponseWriter, r *http.Request) {
			err := a.DB.DeleteTopic(topicID)
			if err != nil {
				if err.Error() == storage.ErrTopicHasChildren.Error() {
					http.Error(w, err.Error(), http.StatusConflict) // 409 Conflict for business rule violation
				} else {
					http.Error(w, fmt.Sprintf("Failed to delete topic: %v", err), http.StatusInternalServerError)
				}
				return
			}

			w.WriteHeader(http.StatusNoContent)
		}).ServeHTTP(w, r)

	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

func (a *App) handleVersions(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type")

	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusOK)
		return
	}

	pathParts := strings.Split(strings.TrimPrefix(r.URL.Path, "/api/versions/"), "/")
	if len(pathParts) < 1 || pathParts[0] == "" {
		http.Error(w, "Topic ID required", http.StatusBadRequest)
		return
	}

	topicID := pathParts[0]

	switch r.Method {
	case http.MethodGet:
		versions, err := a.DB.GetVersions(topicID)
		if err != nil {
			http.Error(w, fmt.Sprintf("Failed to get versions: %v", err), http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string][]*storage.PromptVersion{"versions": versions})

	case http.MethodPost:
		a.adminOnly(func(w http.ResponseWriter, r *http.Request) {
			if len(pathParts) < 3 || pathParts[1] != "restore" {
				http.Error(w, "Invalid restore path", http.StatusBadRequest)
				return
			}

			versionID := pathParts[2]

			versionToRestore, err := a.DB.GetVersion(versionID)
			if err != nil {
				http.Error(w, "Version not found", http.StatusNotFound)
				return
			}

			if versionToRestore.TopicID != topicID {
				http.Error(w, "Version does not belong to this topic", http.StatusBadRequest)
				return
			}

			currentTopic, err := a.DB.GetTopic(topicID)
			if err != nil {
				http.Error(w, "Failed to get current topic", http.StatusNotFound)
				return
			}

			topic, err := a.DB.UpdateTopic(topicID, currentTopic.Name, versionToRestore.Prompt, currentTopic.ParentID, currentTopic.SortOrder)
			if err != nil {
				http.Error(w, fmt.Sprintf("Failed to restore version: %v", err), http.StatusInternalServerError)
				return
			}

			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(topic)
		}).ServeHTTP(w, r)

	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}
