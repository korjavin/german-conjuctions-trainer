package app

import (
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"math"
	"net/http"
	"os"
	"strings"

	"german-conjunctions-trainer/pkg/llm"
	"german-conjunctions-trainer/pkg/storage"
)

func (a *App) backfillKeyTerms() {
	topics, err := a.DB.GetAllTopics()
	if err != nil {
		log.Printf("[KEY_TERMS] Backfill: failed to get topics: %v", err)
		return
	}
	for _, topic := range topics {
		promptHash := storage.GetPromptHash(topic.Prompt)
		existing, err := a.DB.GetTopicKeyTerms(topic.ID, promptHash)
		if err != nil {
			log.Printf("[KEY_TERMS] Backfill: failed to check terms for topic %s: %v", topic.ID, err)
			continue
		}
		if existing != nil {
			continue
		}
		log.Printf("[KEY_TERMS] Backfill: extracting terms for topic %s (%s)", topic.ID, topic.Name)
		a.extractAndSaveKeyTerms(topic.ID, topic.Prompt)
	}
	log.Printf("[KEY_TERMS] Backfill complete")
}

func (a *App) extractAndSaveKeyTerms(topicID, prompt string) {
	apiKey := os.Getenv("OPENAI_API_KEY")
	if apiKey == "" {
		return
	}
	openaiURL := os.Getenv("OPENAI_URL")
	if openaiURL == "" {
		openaiURL = "https://api.openai.com/v1"
	}
	modelName := os.Getenv("MODEL_NAME")
	if modelName == "" {
		modelName = "gpt-3.5-turbo-1106"
	}

	terms, err := llm.ExtractKeyTerms(prompt, apiKey, openaiURL, modelName)
	if err != nil {
		log.Printf("[KEY_TERMS] Failed to extract terms for topic %s: %v", topicID, err)
		return
	}
	promptHash := storage.GetPromptHash(prompt)
	if err := a.DB.SaveTopicKeyTerms(topicID, promptHash, terms); err != nil {
		log.Printf("[KEY_TERMS] Failed to save terms for topic %s: %v", topicID, err)
		return
	}
	log.Printf("[KEY_TERMS] Extracted %d terms for topic %s", len(terms), topicID)
}

type TopicRequest struct {
	Name      string  `json:"name"`
	Prompt    string  `json:"prompt"`
	ParentID  *string `json:"parent_id"`
	SortOrder int     `json:"sort_order"`
}

// ErrTopicNameAlreadyExists is returned when a topic name already exists at the same parent level
var ErrTopicNameAlreadyExists = fmt.Errorf("a topic with this name already exists at this level")

const (
	maxTreeDepth = 100    // Maximum allowed depth of topic tree hierarchy
	maxSortOrder = 999999 // Maximum allowed value for sort_order field
)

// validateTopicName checks for duplicate topic names at the same parent level
func (a *App) validateTopicName(name string, parentID *string, excludeTopicID *string) error {
	topics, err := a.DB.GetAllTopics()
	if err != nil {
		return err // Return the actual DB error so caller can distinguish from validation errors
	}

	normalizedParentID := normalizeStringPtr(parentID)
	normalizedName := strings.TrimSpace(strings.ToLower(name))

	for _, topic := range topics {
		// Skip the topic being edited (excludeTopicID)
		if excludeTopicID != nil && topic.ID == *excludeTopicID {
			continue
		}

		topicParentID := normalizeStringPtr(topic.ParentID)
		topicName := strings.TrimSpace(strings.ToLower(topic.Name))

		// Check if topic has same name at same parent level
		if topicName == normalizedName && topicParentID == normalizedParentID {
			return ErrTopicNameAlreadyExists
		}
	}

	return nil
}

// normalizeStringPtr converts *string to comparable value, treating empty string and nil as equivalent
func normalizeStringPtr(s *string) string {
	if s == nil || strings.TrimSpace(*s) == "" {
		return ""
	}
	return strings.TrimSpace(*s)
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

	// Check for cycles and maximum depth
	depth := 1 // Start at 1 for the parent itself
	currentParent := parent.ParentID
	for currentParent != nil {
		depth++
		if depth >= maxTreeDepth {
			return fmt.Errorf("topic tree depth exceeds maximum of %d levels", maxTreeDepth)
		}
		// Only check for cycles when topicID is not nil (new topics can't create cycles)
		if topicID != nil && *currentParent == *topicID {
			return fmt.Errorf("cannot create a cycle in the topic tree")
		}
		p, err := a.DB.GetTopic(*currentParent)
		if err != nil {
			return fmt.Errorf("invalid parent reference in tree")
		}
		currentParent = p.ParentID
	}

	return nil
}

type MoveTopicRequest struct {
	ParentID string `json:"parent_id"`
	Position *int   `json:"position"`
}

func (a *App) handleTopics(w http.ResponseWriter, r *http.Request) {
	// Set CORS headers - check if request origin is in allowed list
	corsOrigin := a.getCORSOrigin(r)
	if corsOrigin != "" {
		w.Header().Set("Access-Control-Allow-Origin", corsOrigin)
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		w.Header().Set("Vary", "Origin")
	} else if a.CORSAllowedOrigins != "" && a.CORSAllowedOrigins != "*" && r.Header.Get("Origin") != "" {
		// Set Vary: Origin when CORS behavior depends on Origin (allowlist mode with denied origin)
		// This prevents caches from serving the same response variant to different origins
		w.Header().Set("Vary", "Origin")
	}
	w.Header().Set("Content-Security-Policy", "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self';")

	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusOK)
		return
	}

	switch r.Method {
	case http.MethodGet:
		topicsList, err := a.DB.GetAllTopics()
		if err != nil {
			log.Printf("Failed to get topics: %v", err)
			http.Error(w, "Failed to retrieve topics. Please try again.", http.StatusInternalServerError)
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

			req.Name = strings.TrimSpace(req.Name)
			req.Prompt = strings.TrimSpace(req.Prompt)
			if req.Name == "" || req.Prompt == "" {
				http.Error(w, "Name and prompt are required", http.StatusBadRequest)
				return
			}

			// Validate name length (matches frontend MAX_TOPIC_NAME_LENGTH of 200)
			if len(req.Name) > 200 {
				http.Error(w, "Topic name must be less than 200 characters", http.StatusBadRequest)
				return
			}

			// Validate prompt length (matches frontend MIN_PROMPT_LENGTH of 10 and MAX_PROMPT_LENGTH of 10000)
			// Use TrimSpace to match frontend trim() behavior
			promptLength := len(strings.TrimSpace(req.Prompt))
			if promptLength < 10 {
				http.Error(w, fmt.Sprintf("Prompt must be at least 10 characters. Currently %d characters.", promptLength), http.StatusBadRequest)
				return
			}
			if len(req.Prompt) > 10000 {
				http.Error(w, fmt.Sprintf("Prompt must be less than 10000 characters. Currently %d characters.", len(req.Prompt)), http.StatusBadRequest)
				return
			}

			if req.SortOrder < 0 {
				http.Error(w, "sort_order must be a non-negative integer", http.StatusBadRequest)
				return
			}
			if req.SortOrder > maxSortOrder {
				http.Error(w, "sort_order must be less than 1000000", http.StatusBadRequest)
				return
			}

			if err := a.validateTopicTree(nil, req.ParentID); err != nil {
				http.Error(w, err.Error(), http.StatusBadRequest)
				return
			}

			// Validate no duplicate name at same parent level
			if err := a.validateTopicName(req.Name, req.ParentID, nil); err != nil {
				// Check if this is a validation error or a database error
				if errors.Is(err, ErrTopicNameAlreadyExists) {
					http.Error(w, err.Error(), http.StatusBadRequest)
				} else {
					// Database error - return 500
					log.Printf("Failed to validate topic name: %v", err)
					http.Error(w, "Failed to validate topic name. Please try again.", http.StatusInternalServerError)
				}
				return
			}

			topic, err := a.DB.CreateTopic(req.Name, req.Prompt, req.ParentID, req.SortOrder)
			if err != nil {
				// Check for unique constraint violation (race condition between validation and insert)
				if strings.Contains(err.Error(), "UNIQUE constraint failed") ||
					strings.Contains(err.Error(), "constraint violated") {
					log.Printf("Unique constraint violation while creating topic: %v", err)
					http.Error(w, "a topic with this name already exists at this level", http.StatusConflict)
					return
				}
				log.Printf("Failed to create topic: %v", err)
				http.Error(w, "Failed to create topic. Please try again.", http.StatusInternalServerError)
				return
			}

			go a.extractAndSaveKeyTerms(topic.ID, topic.Prompt)

			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusCreated)
			json.NewEncoder(w).Encode(topic)
		}).ServeHTTP(w, r)

	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

func (a *App) handleTopicByID(w http.ResponseWriter, r *http.Request) {
	// Set CORS headers - check if request origin is in allowed list
	corsOrigin := a.getCORSOrigin(r)
	if corsOrigin != "" {
		w.Header().Set("Access-Control-Allow-Origin", corsOrigin)
		w.Header().Set("Access-Control-Allow-Methods", "GET, PUT, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		w.Header().Set("Vary", "Origin")
	} else if a.CORSAllowedOrigins != "" && a.CORSAllowedOrigins != "*" && r.Header.Get("Origin") != "" {
		// Set Vary: Origin when CORS behavior depends on Origin (allowlist mode with denied origin)
		// This prevents caches from serving the same response variant to different origins
		w.Header().Set("Vary", "Origin")
	}
	w.Header().Set("Content-Security-Policy", "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self';")

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
				case strings.Contains(errMsg, "invalid parent") || strings.Contains(errMsg, "cycle"):
					http.Error(w, errMsg, http.StatusBadRequest)
				default:
					log.Printf("Failed to move topic: %v", err)
					http.Error(w, "Failed to move topic. Please try again.", http.StatusInternalServerError)
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
			promptProvided := false
			if val, exists := rawReq["prompt"]; exists {
				promptProvided = true
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

			name = strings.TrimSpace(name)
			// Only trim prompt when it's provided, not when using existing value
			// This preserves whitespace-only legacy prompts and allows name-only updates
			if promptProvided {
				prompt = strings.TrimSpace(prompt)
			}
			if name == "" {
				http.Error(w, "Name is required", http.StatusBadRequest)
				return
			}

			// Only validate prompt emptiness when a new value is being provided
			// This allows name-only updates to topics with legacy whitespace-only prompts
			if promptProvided && prompt == "" {
				http.Error(w, "Prompt is required", http.StatusBadRequest)
				return
			}

			// Validate name length (matches frontend MAX_TOPIC_NAME_LENGTH of 200)
			if len(name) > 200 {
				http.Error(w, "Topic name must be less than 200 characters", http.StatusBadRequest)
				return
			}

			// Validate prompt length (matches frontend MIN_PROMPT_LENGTH of 10 and MAX_PROMPT_LENGTH of 10000)
			// Use TrimSpace to match frontend trim() behavior
			// Only validate minimum length when a new value is being provided
			if promptProvided {
				promptLength := len(strings.TrimSpace(prompt))
				if promptLength < 10 {
					http.Error(w, fmt.Sprintf("Prompt must be at least 10 characters. Currently %d characters.", promptLength), http.StatusBadRequest)
					return
				}
			}
			if len(prompt) > 10000 {
				http.Error(w, "Prompt must be less than 10000 characters", http.StatusBadRequest)
				return
			}

			if err := a.validateTopicTree(&topicID, parentID); err != nil {
				http.Error(w, err.Error(), http.StatusBadRequest)
				return
			}

			// Validate no duplicate name at same parent level (exclude the current topic being edited)
			if err := a.validateTopicName(name, parentID, &topicID); err != nil {
				// Check if this is a validation error or a database error
				if errors.Is(err, ErrTopicNameAlreadyExists) {
					http.Error(w, err.Error(), http.StatusBadRequest)
				} else {
					// Database error - return 500
					log.Printf("Failed to validate topic name: %v", err)
					http.Error(w, "Failed to validate topic name. Please try again.", http.StatusInternalServerError)
				}
				return
			}

			topic, err := a.DB.UpdateTopic(topicID, name, prompt, parentID, sortOrder)
			if err != nil {
				// Check for unique constraint violation (race condition between validation and update)
				if strings.Contains(err.Error(), "UNIQUE constraint failed") ||
					strings.Contains(err.Error(), "constraint violated") {
					log.Printf("Unique constraint violation while updating topic: %v", err)
					http.Error(w, "a topic with this name already exists at this level", http.StatusConflict)
					return
				}
				log.Printf("Failed to update topic: %v", err)
				http.Error(w, "Failed to update topic. Please try again.", http.StatusInternalServerError)
				return
			}

			if promptProvided && prompt != existingTopic.Prompt {
				go a.extractAndSaveKeyTerms(topic.ID, topic.Prompt)
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
					log.Printf("Failed to delete topic: %v", err)
					http.Error(w, "Failed to delete topic. Please try again.", http.StatusInternalServerError)
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
	// Set CORS headers - check if request origin is in allowed list
	corsOrigin := a.getCORSOrigin(r)
	if corsOrigin != "" {
		w.Header().Set("Access-Control-Allow-Origin", corsOrigin)
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		w.Header().Set("Vary", "Origin")
	} else if a.CORSAllowedOrigins != "" && a.CORSAllowedOrigins != "*" && r.Header.Get("Origin") != "" {
		// Set Vary: Origin when CORS behavior depends on Origin (allowlist mode with denied origin)
		// This prevents caches from serving the same response variant to different origins
		w.Header().Set("Vary", "Origin")
	}
	w.Header().Set("Content-Security-Policy", "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self';")

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
			log.Printf("Failed to get versions: %v", err)
			http.Error(w, "Failed to retrieve versions. Please try again.", http.StatusInternalServerError)
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
				log.Printf("Failed to restore version: %v", err)
				http.Error(w, "Failed to restore version. Please try again.", http.StatusInternalServerError)
				return
			}

			if versionToRestore.Prompt != currentTopic.Prompt {
				go a.extractAndSaveKeyTerms(topic.ID, topic.Prompt)
			}

			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(topic)
		}).ServeHTTP(w, r)

	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}
