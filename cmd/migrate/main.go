package main

import (
	"encoding/json"
	"log"
	"os"
	"strings"
	"sync"

	"german-conjunctions-trainer/pkg/storage"
)

func main() {
	log.Println("Starting data migration from Airtable to SQLite...")

	// --- Initialize Airtable Storage ---
	// Temporarily set env vars if they are not present for the tool
	if os.Getenv("AIRTABLE_TOKEN") == "" || os.Getenv("AIRTABLE_BASE_ID") == "" {
		log.Println("AIRTABLE_TOKEN or AIRTABLE_BASE_ID not set. Please set them to run the migration.")
		return
	}
	airtableDB, err := storage.NewAirtableStorage()
	if err != nil {
		log.Fatalf("Failed to initialize Airtable storage: %v", err)
	}
	log.Println("Airtable storage initialized.")

	// --- Initialize SQLite Storage ---
	dbPath := os.Getenv("SQLITE_PATH")
	if dbPath == "" {
		dbPath = "german.db"
	}
	sqliteDB, err := storage.NewSQLiteStorage(dbPath)
	if err != nil {
		log.Fatalf("Failed to initialize SQLite storage: %v", err)
	}
	log.Println("SQLite storage initialized.")

	// --- Migration Logic ---
	migrateTopicsAndVersions(airtableDB, sqliteDB)
	migrateUsersAndStats(airtableDB, sqliteDB)
	migrateExercisesAndViews(airtableDB, sqliteDB)

	log.Println("Data migration completed successfully!")
}

// Maps Airtable IDs to new SQLite IDs
var userIDMap sync.Map
var exerciseIDMap sync.Map

// Maps Airtable topic IDs to new SQLite topic IDs
var topicIDMap sync.Map

func migrateTopicsAndVersions(airtableDB, sqliteDB storage.Storage) {
	log.Println("Migrating topics and prompt versions...")

	// 1. Get all topics from Airtable
	airtableTopics, err := airtableDB.GetAllTopics()
	if err != nil {
		log.Fatalf("Failed to get topics from Airtable: %v", err)
	}
	log.Printf("Found %d topics in Airtable.", len(airtableTopics))

	// 2. Build existing topics map for O(1) lookup
	existingTopics, _ := sqliteDB.GetAllTopics()
	existingTopicsMap := make(map[string]*storage.Topic)
	for _, et := range existingTopics {
		existingTopicsMap[et.Name] = et
	}

	// 3. Iterate and migrate each topic
	for _, topic := range airtableTopics {
		// Check if a topic with the same name already exists to prevent duplicates
		if existingTopic, exists := existingTopicsMap[topic.Name]; exists {
			log.Printf("Skipping duplicate topic: %s", topic.Name)
			topicIDMap.Store(topic.ID, existingTopic.ID) // Map old to existing new ID
			continue
		}

		// Create the topic in SQLite
		createdTopic, err := sqliteDB.CreateTopic(topic.Name, topic.Prompt)
		if err != nil {
			log.Printf("Failed to create topic '%s' in SQLite: %v", topic.Name, err)
			continue
		}
		log.Printf("Migrated topic: %s", createdTopic.Name)
		topicIDMap.Store(topic.ID, createdTopic.ID) // Map old ID to new ID

		// 3. Get all versions for the topic from Airtable
		airtableVersions, err := airtableDB.GetVersions(topic.ID)
		if err != nil {
			log.Printf("Failed to get versions for topic '%s': %v", topic.Name, err)
			continue
		}

		// 4. Migrate versions, skipping the first one as it's created with the topic
		for _, version := range airtableVersions[1:] {
			err := sqliteDB.AddPromptVersion(createdTopic.ID, version.Prompt)
			if err != nil {
				log.Printf("Failed to add version for topic '%s': %v", createdTopic.Name, err)
			}
		}
		log.Printf("Migrated %d versions for topic: %s", len(airtableVersions), createdTopic.Name)
	}
}

func migrateUsersAndStats(airtableDB, sqliteDB storage.Storage) {
	log.Println("Migrating users and user stats...")

	// 1. Get all users from Airtable
	airtableUsers, err := airtableDB.GetAllUsers()
	if err != nil {
		log.Fatalf("Failed to get all users from Airtable: %v", err)
	}
	log.Printf("Found %d users in Airtable.", len(airtableUsers))

	// 2. Iterate and migrate each user and their stats
	for _, user := range airtableUsers {
		if user.GoogleID == "" {
			log.Printf("Skipping user with empty GoogleID (Airtable ID: %s)", user.ID)
			continue
		}

		// Check if user already exists in SQLite
		existingUser, err := sqliteDB.GetUserByGoogleID(user.GoogleID)
		if err != nil {
			log.Printf("Failed to check for existing user '%s': %v", user.GoogleID, err)
			continue
		}
		if existingUser != nil {
			log.Printf("User with GoogleID %s already exists, skipping creation.", user.GoogleID)
			userIDMap.Store(user.ID, existingUser.ID) // Map old ID to existing new ID
		} else {
			// Create user in SQLite
			createdUser, err := sqliteDB.CreateUser(user.GoogleID)
			if err != nil {
				log.Printf("Failed to create user with GoogleID '%s' in SQLite: %v", user.GoogleID, err)
				continue
			}
			log.Printf("Migrated user with GoogleID: %s", createdUser.GoogleID)
			userIDMap.Store(user.ID, createdUser.ID) // Map old ID to new ID
		}

		// 3. Migrate user stats
		airtableStats, err := airtableDB.GetUserStats(user.ID)
		if err != nil {
			log.Printf("Could not get stats for user %s: %v", user.ID, err)
			continue
		}

		// Get the new SQLite user ID
		newUserID, ok := userIDMap.Load(user.ID)
		if !ok {
			log.Printf("Could not find new user ID for old ID %s", user.ID)
			continue
		}

		// Map LastTopicID from old to new if available
		lastTopicID := airtableStats.LastTopicID
		if lastTopicID != "" {
			if newTopicID, ok := topicIDMap.Load(lastTopicID); ok {
				lastTopicID = newTopicID.(string)
			} else {
				log.Printf("Warning: Could not map LastTopicID %s for user %s", lastTopicID, user.ID)
				lastTopicID = "" // Reset if mapping fails
			}
		}

		stats := &storage.UserStats{
			UserID:         newUserID.(string),
			TotalExercises: airtableStats.TotalExercises,
			TotalMistakes:  airtableStats.TotalMistakes,
			TotalHints:     airtableStats.TotalHints,
			TotalTime:      airtableStats.TotalTime,
			LastTopicID:    lastTopicID,
		}

		if err := sqliteDB.UpdateUserStats(stats); err != nil {
			log.Printf("Failed to update stats for user %s: %v", newUserID, err)
		}
		if stats.LastTopicID != "" {
			if err := sqliteDB.UpdateUserSetting(stats.UserID, stats.LastTopicID); err != nil {
				log.Printf("Failed to update last_topic_id for user %s: %v", newUserID, err)
			}
		}
		log.Printf("Migrated stats for user with GoogleID: %s", user.GoogleID)
	}
}

func migrateExercisesAndViews(airtableDB, sqliteDB storage.Storage) {
	log.Println("Migrating exercises...")

	// 1. Get all topics from SQLite to map by name
	sqliteTopics, err := sqliteDB.GetAllTopics()
	if err != nil {
		log.Fatalf("Failed to get topics from SQLite for mapping: %v", err)
	}
	topicMap := make(map[string]*storage.Topic)
	for _, t := range sqliteTopics {
		topicMap[t.Name] = t
	}

	// 2. Get all topics from Airtable to fetch exercises
	airtableTopics, err := airtableDB.GetAllTopics()
	if err != nil {
		log.Fatalf("Failed to get topics from Airtable for exercise migration: %v", err)
	}

	// 3. For each topic, get all exercises and migrate them
	var wg sync.WaitGroup

	for _, airtableTopic := range airtableTopics {
		sqliteTopic, ok := topicMap[airtableTopic.Name]
		if !ok {
			log.Printf("Skipping exercises for topic '%s' as it was not migrated.", airtableTopic.Name)
			continue
		}

		log.Printf("Fetching exercises for topic: %s", airtableTopic.Name)
		// Get all exercises regardless of prompt hash for a full migration
		airtableExercises, err := airtableDB.GetExercisesForTopic(airtableTopic.ID, "")
		if err != nil {
			log.Printf("Failed to get exercises for topic '%s' from Airtable: %v", airtableTopic.Name, err)
			continue
		}
		log.Printf("Found %d exercises for topic '%s'", len(airtableExercises), airtableTopic.Name)

		// Deduplicate exercises before inserting
		uniqueExercises := make(map[string]storage.Exercise)
		for _, ex := range airtableExercises {
			// Normalize JSON to prevent minor formatting differences from creating duplicates
			var exerciseData map[string]interface{}
			if err := json.Unmarshal([]byte(ex.ExerciseJSON), &exerciseData); err == nil {
				normalizedJSON, _ := json.Marshal(exerciseData)
				uniqueKey := string(normalizedJSON)
				if _, exists := uniqueExercises[uniqueKey]; !exists {
					uniqueExercises[uniqueKey] = *ex
				}
			}
		}
		log.Printf("Reduced %d exercises to %d unique exercises for topic '%s'", len(airtableExercises), len(uniqueExercises), airtableTopic.Name)

		for _, uniqueEx := range uniqueExercises {
			wg.Add(1)
			go func(ex storage.Exercise) {
				defer wg.Done()
				promptHash := storage.GetPromptHash(sqliteTopic.Prompt) // Use the SQLite topic's prompt
				createdEx, err := sqliteDB.CreateExercise(sqliteTopic.ID, promptHash, ex.ExerciseJSON, ex.AudioFilePath)
				if err != nil {
					// Handle potential race condition on duplicate exercise JSON if any
					if !strings.Contains(err.Error(), "UNIQUE constraint failed") {
						log.Printf("Failed to create exercise in SQLite: %v", err)
					}
					return
				}
				// Store mapping from old Airtable ID to new SQLite ID
				exerciseIDMap.Store(ex.AirtableID, createdEx.ID)
			}(uniqueEx)
		}
	}
	wg.Wait()
	log.Println("Finished migrating exercises.")

	// --- Migrate User Exercise Views ---
	log.Println("Migrating user exercise views...")
	airtableUsers, err := airtableDB.GetAllUsers()
	if err != nil {
		log.Fatalf("Failed to get users for exercise view migration: %v", err)
	}

	for _, user := range airtableUsers {
		newUserID, ok := userIDMap.Load(user.ID)
		if !ok {
			// This can happen if the user had no GoogleID and was skipped.
			continue
		}

		views, err := airtableDB.GetUserExerciseViews(user.ID)
		if err != nil {
			log.Printf("Failed to get exercise views for user %s from Airtable: %v", user.ID, err)
			continue
		}

		if len(views) == 0 {
			continue
		}

		var viewsToUpdate []*storage.UserExerciseView
		for airtableExerciseID, view := range views {
			newExerciseID, ok := exerciseIDMap.Load(airtableExerciseID)
			if !ok {
				// This can happen if the exercise was a duplicate and not migrated.
				continue
			}

			viewsToUpdate = append(viewsToUpdate, &storage.UserExerciseView{
				UserID:            newUserID.(string),
				ExerciseID:        newExerciseID.(string),
				LastViewed:        view.LastViewed,
				RepetitionCounter: view.RepetitionCounter,
			})
		}

		if len(viewsToUpdate) > 0 {
			if err := sqliteDB.UpdateUserExerciseViews(viewsToUpdate); err != nil {
				log.Printf("Failed to migrate %d exercise views for user %s: %v", len(viewsToUpdate), newUserID, err)
			} else {
				log.Printf("Successfully migrated %d exercise views for user with new ID %s", len(viewsToUpdate), newUserID)
			}
		}
	}
	log.Println("Finished migrating user exercise views.")
}