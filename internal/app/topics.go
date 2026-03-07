package app

import (
	"encoding/json"
	"errors"
	"fmt"
	"math"
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

type MoveTopicRequest struct {
	ParentID string `json:"parent_id"`
	Position *int   `json:"position"`
}

func (a *App) handleTopics(w http.ResponseWriter, r *http.Request) {
	// Set CORS headers - use configured allowed origins, default to wildcard for development
	corsOrigin := a.CORSAllowedOrigins
	if corsOrigin == "" {
		corsOrigin = "*"
	}
	w.Header().Set("Access-Control-Allow-Origin", corsOrigin)
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

			if req.SortOrder < 0 {
				http.Error(w, "sort_order must be a non-negative integer", http.StatusBadRequest)
				return
			}
			if req.SortOrder > 999999 {
				http.Error(w, "sort_order must be less than 1000000", http.StatusBadRequest)
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
	// Set CORS headers - use configured allowed origins, default to wildcard for development
	corsOrigin := a.CORSAllowedOrigins
	if corsOrigin == "" {
		corsOrigin = "*"
	}
	w.Header().Set("Access-Control-Allow-Origin", corsOrigin)
	w.Header().Set("Access-Control-Allow-Methods", "GET, PUT, DELETE, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type")

	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusOK)
		return
	}

	path := strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/topics/"), "/")
	if path == "" {
		http.Error(w, "Topic ID required", http.StatusBadRequest)
		return
	}
	pathParts := strings.Split(path, "/")
	topicID := pathParts[0]
	subresource := ""
	if len(pathParts) > 1 {
		subresource = pathParts[1]
	}
	if len(pathParts) > 2 {
		http.Error(w, "Invalid topic path", http.StatusBadRequest)
		return
	}

	if subresource == "move" {
		if r.Method != http.MethodPut {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}

		a.adminOnly(func(w http.ResponseWriter, r *http.Request) {
			var req MoveTopicRequest
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				http.Error(w, "Invalid request body", http.StatusBadRequest)
				return
			}

			topic, err := a.DB.MoveTopic(topicID, req.ParentID, req.Position)
			if err != nil {
				errMsg := err.Error()
				switch {
				case strings.Contains(errMsg, "not found"):
					http.Error(w, errMsg, http.StatusNotFound)
				case strings.Contains(errMsg, "invalid"):
					http.Error(w, errMsg, http.StatusBadRequest)
				default:
					http.Error(w, fmt.Sprintf("Failed to move topic: %v", err), http.StatusInternalServerError)
				}
				return
			}

			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(topic)
		}).ServeHTTP(w, r)
		return
	}

	if subresource != "" {
		http.Error(w, "Invalid topic path", http.StatusBadRequest)
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
			if val, exists := rawReq["name"]; exists {
				if strVal, ok := val.(string); ok {
					name = strVal
				} else {
					http.Error(w, "name must be a string", http.StatusBadRequest)
					return
				}
			}

			prompt := existingTopic.Prompt
			if val, exists := rawReq["prompt"]; exists {
				if strVal, ok := val.(string); ok {
					prompt = strVal
				} else {
					http.Error(w, "prompt must be a string", http.StatusBadRequest)
					return
				}
			}

			parentID := existingTopic.ParentID
			if parentVal, exists := rawReq["parent_id"]; exists {
				if parentVal == nil {
					parentID = nil
				} else if strVal, ok := parentVal.(string); ok {
					if strVal == "" {
						parentID = nil
					} else {
						parentID = &strVal
					}
				} else {
					http.Error(w, "parent_id must be a string or null", http.StatusBadRequest)
					return
				}
			}

			sortOrder := existingTopic.SortOrder
			if sortVal, exists := rawReq["sort_order"]; exists {
				if floatVal, ok := sortVal.(float64); ok {
					if floatVal < 0 || floatVal != math.Trunc(floatVal) {
						http.Error(w, "sort_order must be a non-negative integer", http.StatusBadRequest)
						return
					}
					if floatVal > 999999 {
						http.Error(w, "sort_order must be less than 1000000", http.StatusBadRequest)
						return
					}
					sortOrder = int(floatVal)
				} else {
					http.Error(w, "sort_order must be a number", http.StatusBadRequest)
					return
				}
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
				if errors.Is(err, storage.ErrTopicHasChildren) {
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
