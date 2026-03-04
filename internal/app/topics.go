package app

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	"german-conjunctions-trainer/pkg/storage"
)

type TopicRequest struct {
	Name   string `json:"name"`
	Prompt string `json:"prompt"`
}

type UpdateTopicRequest struct {
	Name   string `json:"name"`
	Prompt string `json:"prompt"`
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

			topic, err := a.DB.CreateTopic(req.Name, req.Prompt)
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
			var req UpdateTopicRequest
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				http.Error(w, "Invalid request body", http.StatusBadRequest)
				return
			}

			if req.Prompt == "" {
				http.Error(w, "Prompt is required", http.StatusBadRequest)
				return
			}

			topic, err := a.DB.UpdateTopic(topicID, req.Name, req.Prompt)
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
				http.Error(w, fmt.Sprintf("Failed to delete topic: %v", err), http.StatusInternalServerError)
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

			topic, err := a.DB.UpdateTopic(topicID, currentTopic.Name, versionToRestore.Prompt)
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
