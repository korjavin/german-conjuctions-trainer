package storage

import (
	"encoding/json"
	"fmt"
	"log"
	"os"
	"sort"
	"strings"
	"time"

	"github.com/mehanizm/airtable"
)

// --- Airtable Storage Implementation ---

// AirtableStorage implements the Storage interface for Airtable.
type AirtableStorage struct {
	client *airtable.Client
	baseID string
}

// --- Legacy Global Variables (for backward compatibility) ---
var (
	Client         *airtable.Client
	BaseID         string

	TopicsTableName            = "Topics"
	VersionsTableName          = "PromptVersions"
	UsersTableName             = "Users"
	UserStatsTableName         = "UserStats"
	ExercisesTableName         = "Exercises"
	UserExerciseViewsTableName = "UserExerciseViews"
)

// NewAirtableStorage creates a new Airtable storage instance.
func NewAirtableStorage() (*AirtableStorage, error) {
	airtableToken := os.Getenv("AIRTABLE_TOKEN")
	baseID := os.Getenv("AIRTABLE_BASE_ID")

	if airtableToken == "" {
		return nil, fmt.Errorf("AIRTABLE_TOKEN environment variable is required")
	}
	if baseID == "" {
		return nil, fmt.Errorf("AIRTABLE_BASE_ID environment variable is required")
	}

	client := airtable.NewClient(airtableToken)
	storage := &AirtableStorage{
		client: client,
		baseID: baseID,
	}

	// Set global variables for backward compatibility
	Client = client
	BaseID = baseID

	log.Printf("Airtable integration initialized with base ID: %s", baseID)
	return storage, nil
}

// InitStorage initializes the Airtable client and checks table access.
func InitStorage() {
	airtableToken := os.Getenv("AIRTABLE_TOKEN")
	BaseID = os.Getenv("AIRTABLE_BASE_ID")

	if airtableToken == "" {
		log.Fatal("AIRTABLE_TOKEN environment variable is required")
	}
	if BaseID == "" {
		log.Fatal("AIRTABLE_BASE_ID environment variable is required")
	}

	Client = airtable.NewClient(airtableToken)
	log.Printf("Airtable integration initialized with base ID: %s", BaseID)

	// Check permissions
	CheckAirtablePermissions()
}

// CheckAirtablePermissions verifies access to all required tables.
func CheckAirtablePermissions() {
	log.Printf("Checking Airtable permissions...")

	tables := []struct {
		name        string
		required    bool
		description string
	}{
		{TopicsTableName, true, "Core functionality will be severely limited."},
		{VersionsTableName, false, "Version history will be disabled."},
		{UsersTableName, false, "User authentication will be disabled."},
		{UserStatsTableName, false, "User statistics will not be saved."},
		{ExercisesTableName, true, "Core functionality of serving exercises will be disabled."},
		{UserExerciseViewsTableName, false, "SRS functionality will be disabled for authenticated users."},
	}

	for _, table := range tables {
		checkTableAccess(table.name, table.required, table.description)
	}
}

func checkTableAccess(tableName string, required bool, consequence string) {
	table := Client.GetTable(BaseID, tableName)
	_, err := table.GetRecords().Do() // Check without max records for compatibility

	if err != nil {
		prefix := "⚠️"
		if required {
			prefix = "❌"
		}

		if strings.Contains(err.Error(), "status 403") || strings.Contains(err.Error(), "INVALID_PERMISSIONS") {
			log.Printf("%s No access to '%s' table. Check token permissions. %s", prefix, tableName, consequence)
		} else if strings.Contains(err.Error(), "status 404") {
			log.Printf("%s '%s' table not found. Please create it manually. %s", prefix, tableName, consequence)
		} else {
			log.Printf("⚠️  %s table access error: %v", tableName, err)
		}
	} else {
		log.Printf("✅ %s table access: OK", tableName)
	}
}

// InitializeDefaultTopics creates a set of default topics if none exist.
func InitializeDefaultTopics() {
	existingTopics, err := GetAllTopics()
	if err != nil {
		log.Printf("Warning: Could not check existing topics: %v", err)
		log.Printf("Attempting to create default topics anyway...")
	} else if len(existingTopics) > 0 {
		log.Printf("Found %d existing topics, skipping default topic initialization", len(existingTopics))
		return
	}

	defaultTopics := []struct {
		name   string
		prompt string
	}{
		{
			name: "Conjunctions",
			prompt: `You are an expert German language tutor creating B1-level grammar exercises. Your task is to generate a JSON object containing unique sentences focused on German conjunctions.

Please adhere to the following rules:
1. **Sentence Structure:** Each sentence must correctly use a German conjunction. Include a mix of coordinating and subordinating conjunctions from the provided list.
2. **Vocabulary:** Use common B1-level vocabulary.
3. **Clarity:** The English hint must be a natural and accurate translation of the German sentence.
Conjunction List: weil, obwohl, damit, wenn, dass, als, bevor, nachdem, ob, seit, und, oder, aber, denn, sondern.

Return ONLY the JSON object, with no other text or explanations.`,
		},
		{
			name: "Verb + Preposition",
			prompt: `You are an expert German language tutor creating B1-level exercises focused on German verbs with prepositions. Your task is to generate a JSON object containing unique sentences that practice verb-preposition combinations.

Please adhere to the following rules:
1. **Sentence Structure:** Each sentence must correctly use a German verb with its required preposition.
2. **Vocabulary:** Use common B1-level vocabulary.
3. **Clarity:** The English hint must be a natural and accurate translation of the German sentence.
Common verb-preposition combinations: denken an, warten auf, sich freuen über, sprechen über, bitten um, sich interessieren für, etc.

Return ONLY the JSON object, with no other text or explanations.`,
		},
	}

	log.Printf("Initializing %d default topics...", len(defaultTopics))
	for _, defaultTopic := range defaultTopics {
		topic, err := CreateTopic(defaultTopic.name, defaultTopic.prompt)
		if err != nil {
			log.Printf("Error creating default topic '%s': %v", defaultTopic.name, err)
		} else {
			log.Printf("Created default topic: %s (ID: %s)", topic.Name, topic.ID)
		}
	}
}

// --- CRUD Functions ---

func CreateTopic(name, prompt string) (*Topic, error) {
	table := Client.GetTable(BaseID, TopicsTableName)
	now := time.Now().Format(time.RFC3339)

	fields := map[string]any{
		"Name":   name,
		"Prompt": prompt,
	}

	records := &airtable.Records{
		Records: []*airtable.Record{
			{
				Fields: map[string]any{
					"Name":      name,
					"Prompt":    prompt,
					"CreatedAt": now,
					"UpdatedAt": now,
				},
			},
		},
	}

	result, err := table.AddRecords(records)
	if err != nil {
		if strings.Contains(err.Error(), "UNKNOWN_FIELD_NAME") {
			log.Printf("Timestamp fields not found, creating with minimal fields")
			records.Records[0].Fields = fields
			result, err = table.AddRecords(records)
		}

		if err != nil {
			return nil, fmt.Errorf("failed to create topic in Airtable: %v", err)
		}
	}

	if len(result.Records) == 0 {
		return nil, fmt.Errorf("no records returned from Airtable")
	}

	topic := &Topic{
		ID:        result.Records[0].ID,
		Name:      name,
		Prompt:    prompt,
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}

	err = AddPromptVersion(topic.ID, prompt)
	if err != nil {
		log.Printf("Warning: Failed to create initial version: %v", err)
	}

	return topic, nil
}

func GetAllTopics() ([]*Topic, error) {
	table := Client.GetTable(BaseID, TopicsTableName)

	records, err := table.GetRecords().Do()
	if err != nil {
		return nil, fmt.Errorf("failed to get topics from Airtable: %v", err)
	}

	var topics []*Topic
	for _, record := range records.Records {
		topic := &Topic{
			ID: record.ID,
		}

		if name, ok := record.Fields["Name"].(string); ok {
			topic.Name = name
		}
		if prompt, ok := record.Fields["Prompt"].(string); ok {
			topic.Prompt = prompt
		}
		if createdAt, ok := record.Fields["CreatedAt"].(string); ok {
			if t, err := time.Parse(time.RFC3339, createdAt); err == nil {
				topic.CreatedAt = t
			}
		}
		if updatedAt, ok := record.Fields["UpdatedAt"].(string); ok {
			if t, err := time.Parse(time.RFC3339, updatedAt); err == nil {
				topic.UpdatedAt = t
			}
		}

		topics = append(topics, topic)
	}

	sort.Slice(topics, func(i, j int) bool {
		return topics[i].CreatedAt.Before(topics[j].CreatedAt)
	})

	return topics, nil
}

func GetTopic(topicID string) (*Topic, error) {
	table := Client.GetTable(BaseID, TopicsTableName)

	record, err := table.GetRecord(topicID)
	if err != nil {
		return nil, fmt.Errorf("failed to get topic from Airtable: %v", err)
	}

	topic := &Topic{
		ID: record.ID,
	}

	if name, ok := record.Fields["Name"].(string); ok {
		topic.Name = name
	}
	if prompt, ok := record.Fields["Prompt"].(string); ok {
		topic.Prompt = prompt
	}
	if createdAt, ok := record.Fields["CreatedAt"].(string); ok {
		if t, err := time.Parse(time.RFC3339, createdAt); err == nil {
			topic.CreatedAt = t
		}
	}
	if updatedAt, ok := record.Fields["UpdatedAt"].(string); ok {
		if t, err := time.Parse(time.RFC3339, updatedAt); err == nil {
			topic.UpdatedAt = t
		}
	}

	return topic, nil
}

func UpdateTopic(topicID, name, prompt string) (*Topic, error) {
	table := Client.GetTable(BaseID, TopicsTableName)
	now := time.Now().Format(time.RFC3339)

	err := AddPromptVersion(topicID, prompt)
	if err != nil {
		log.Printf("Warning: Failed to create version: %v", err)
	}

	versions, err := GetVersions(topicID)
	if err == nil && len(versions) > 10 {
		versionsTable := Client.GetTable(BaseID, VersionsTableName)
		oldVersions := versions[:len(versions)-10]
		var oldVersionIDs []string
		for _, oldVersion := range oldVersions {
			oldVersionIDs = append(oldVersionIDs, oldVersion.ID)
		}
		versionsTable.DeleteRecords(oldVersionIDs)
	}

	fields := map[string]any{
		"Prompt":    prompt,
		"UpdatedAt": now,
	}
	if name != "" {
		fields["Name"] = name
	}

	records := &airtable.Records{
		Records: []*airtable.Record{
			{
				ID:     topicID,
				Fields: fields,
			},
		},
	}

	_, err = table.UpdateRecords(records)
	if err != nil {
		if strings.Contains(err.Error(), "UNKNOWN_FIELD_NAME") {
			log.Printf("UpdatedAt field not found, updating with minimal fields")
			delete(fields, "UpdatedAt")
			records.Records[0].Fields = fields
			_, err = table.UpdateRecords(records)
		}

		if err != nil {
			return nil, fmt.Errorf("failed to update topic in Airtable: %v", err)
		}
	}

	return GetTopic(topicID)
}

func DeleteTopic(topicID string) error {
	versions, err := GetVersions(topicID)
	if err == nil && len(versions) > 0 {
		versionsTable := Client.GetTable(BaseID, VersionsTableName)
		var versionIDs []string
		for _, version := range versions {
			versionIDs = append(versionIDs, version.ID)
		}
		versionsTable.DeleteRecords(versionIDs)
	}

	table := Client.GetTable(BaseID, TopicsTableName)
	_, err = table.DeleteRecords([]string{topicID})
	if err != nil {
		return fmt.Errorf("failed to delete topic from Airtable: %v", err)
	}

	return nil
}

func GetVersions(topicID string) ([]*PromptVersion, error) {
	table := Client.GetTable(BaseID, VersionsTableName)

	records, err := table.GetRecords().
		WithFilterFormula(fmt.Sprintf("{TopicID} = '%s'", topicID)).
		Do()

	if err != nil {
		if strings.Contains(err.Error(), "status 403") || strings.Contains(err.Error(), "INVALID_PERMISSIONS") {
			log.Printf("No read access to PromptVersions table. Version history unavailable.")
			return []*PromptVersion{}, nil
		}
		return nil, fmt.Errorf("failed to get versions from Airtable: %v", err)
	}

	var versions []*PromptVersion
	for _, record := range records.Records {
		version := &PromptVersion{
			ID: record.ID,
		}

		if topicIDField, ok := record.Fields["TopicID"].(string); ok {
			version.TopicID = topicIDField
		}
		if prompt, ok := record.Fields["Prompt"].(string); ok {
			version.Prompt = prompt
		}
		if versionNum, ok := record.Fields["Version"].(float64); ok {
			version.Version = int(versionNum)
		}
		if createdAt, ok := record.Fields["CreatedAt"].(string); ok {
			if t, err := time.Parse(time.RFC3339, createdAt); err == nil {
				version.CreatedAt = t
			}
		}

		versions = append(versions, version)
	}

	sort.Slice(versions, func(i, j int) bool {
		return versions[i].Version < versions[j].Version
	})

	return versions, nil
}

func GetVersion(versionID string) (*PromptVersion, error) {
	table := Client.GetTable(BaseID, VersionsTableName)

	record, err := table.GetRecord(versionID)
	if err != nil {
		return nil, fmt.Errorf("failed to get version from Airtable: %v", err)
	}

	version := &PromptVersion{
		ID: record.ID,
	}

	if topicID, ok := record.Fields["TopicID"].(string); ok {
		version.TopicID = topicID
	}
	if prompt, ok := record.Fields["Prompt"].(string); ok {
		version.Prompt = prompt
	}
	if versionNum, ok := record.Fields["Version"].(float64); ok {
		version.Version = int(versionNum)
	}
	if createdAt, ok := record.Fields["CreatedAt"].(string); ok {
		if t, err := time.Parse(time.RFC3339, createdAt); err == nil {
			version.CreatedAt = t
		}
	}

	return version, nil
}

func AddPromptVersion(topicID, prompt string) error {
	versions, err := GetVersions(topicID)
	if err != nil {
		if strings.Contains(err.Error(), "status 403") || strings.Contains(err.Error(), "INVALID_PERMISSIONS") {
			log.Printf("No access to PromptVersions table. Please check Airtable token permissions.")
			return nil
		}
		if !strings.Contains(err.Error(), "status 404") {
			return err
		}
	}

	nextVersion := 1
	if len(versions) > 0 {
		nextVersion = versions[len(versions)-1].Version + 1
	}

	table := Client.GetTable(BaseID, VersionsTableName)
	now := time.Now().Format(time.RFC3339)

	records := &airtable.Records{
		Records: []*airtable.Record{
			{
				Fields: map[string]any{
					"TopicID":   topicID,
					"Prompt":    prompt,
					"Version":   nextVersion,
					"CreatedAt": now,
				},
			},
		},
	}

	_, err = table.AddRecords(records)
	if err != nil {
		if strings.Contains(err.Error(), "status 403") || strings.Contains(err.Error(), "INVALID_PERMISSIONS") {
			log.Printf("No write access to PromptVersions table. Skipping version creation.")
			return nil
		}

		if strings.Contains(err.Error(), "UNKNOWN_FIELD_NAME") {
			log.Printf("CreatedAt field not found in PromptVersions, creating with minimal fields")
			records.Records[0].Fields = map[string]any{
				"TopicID": topicID,
				"Prompt":  prompt,
				"Version": nextVersion,
			}
			_, err = table.AddRecords(records)
		}

		if err != nil {
			if strings.Contains(err.Error(), "status 403") || strings.Contains(err.Error(), "INVALID__PERMISSIONS") {
				log.Printf("Cannot create version due to permissions. Continuing without version tracking.")
				return nil
			}
			return fmt.Errorf("failed to create version in Airtable: %v", err)
		}
	}

	return nil
}

func CreateExercise(topicID, promptHash, exerciseJSON, audioFilePath string) (*Exercise, error) {
	table := Client.GetTable(BaseID, ExercisesTableName)
	records := &airtable.Records{
		Records: []*airtable.Record{
			{
				Fields: map[string]any{
					"TopicID":       topicID,
					"PromptHash":    promptHash,
					"ExerciseJSON":  exerciseJSON,
					"AudioFilePath": audioFilePath,
				},
			},
		},
	}

	result, err := table.AddRecords(records)
	if err != nil {
		return nil, fmt.Errorf("failed to create exercise in Airtable: %v", err)
	}

	if len(result.Records) == 0 {
		return nil, fmt.Errorf("no records returned from Airtable")
	}

	rec := result.Records[0]
	exercise := &Exercise{
		AirtableID:    rec.ID,
		TopicID:       topicID,
		PromptHash:    promptHash,
		ExerciseJSON:  exerciseJSON,
		AudioFilePath: audioFilePath,
		CreatedAt:     time.Now(),
	}
	return exercise, nil
}

func GetExercisesForTopic(topicID, promptHash string) ([]*Exercise, error) {
	table := Client.GetTable(BaseID, ExercisesTableName)
    var formula string
    if promptHash != "" {
	    formula = fmt.Sprintf("AND({TopicID} = '%s', {PromptHash} = '%s')", topicID, promptHash)
    } else {
        formula = fmt.Sprintf("{TopicID} = '%s'", topicID)
    }


	records, err := table.GetRecords().WithFilterFormula(formula).Do()
	if err != nil {
		if strings.Contains(err.Error(), "NOT_FOUND") {
			return []*Exercise{}, nil
		}
		return nil, fmt.Errorf("failed to get exercises from Airtable: %v", err)
	}

	var exercises []*Exercise
	for _, record := range records.Records {
		exercise := &Exercise{
			AirtableID: record.ID,
		}
		if val, ok := record.Fields["TopicID"].(string); ok {
			exercise.TopicID = val
		}
		if val, ok := record.Fields["PromptHash"].(string); ok {
			exercise.PromptHash = val
		}
		if val, ok := record.Fields["ExerciseJSON"].(string); ok {
			exercise.ExerciseJSON = val
		}
		if val, ok := record.Fields["AudioFilePath"].(string); ok {
			exercise.AudioFilePath = val
		}
		if val, ok := record.Fields["CreatedAt"].(string); ok {
			if t, err := time.Parse(time.RFC3339, val); err == nil {
				exercise.CreatedAt = t
			}
		}
		exercises = append(exercises, exercise)
	}
	return exercises, nil
}

func GetUserExerciseViews(userID string) (map[string]*UserExerciseView, error) {
	table := Client.GetTable(BaseID, UserExerciseViewsTableName)
	formula := fmt.Sprintf("{UserID} = '%s'", userID)

	records, err := table.GetRecords().WithFilterFormula(formula).Do()
	if err != nil {
		if strings.Contains(err.Error(), "NOT_FOUND") {
			return make(map[string]*UserExerciseView), nil
		}
		return nil, fmt.Errorf("failed to get user exercise views from Airtable: %v", err)
	}

	views := make(map[string]*UserExerciseView)
	for _, record := range records.Records {
		view := &UserExerciseView{
			AirtableID: record.ID,
		}
		if val, ok := record.Fields["UserID"].(string); ok {
			view.UserID = val
		}
		if val, ok := record.Fields["ExerciseID"].(string); ok {
			view.ExerciseID = val
		}
		if val, ok := record.Fields["LastViewed"].(string); ok {
			if t, err := time.Parse(time.RFC3339, val); err == nil {
				view.LastViewed = t
			}
		}
		if val, ok := record.Fields["RepetitionCounter"].(float64); ok {
			view.RepetitionCounter = int(val)
		}
		views[view.ExerciseID] = view
	}
	return views, nil
}

func UpdateUserExerciseViews(viewsToUpdate []*UserExerciseView) error {
	table := Client.GetTable(BaseID, UserExerciseViewsTableName)
	var recordsToCreate []*airtable.Record
	var recordsToUpdate []*airtable.Record

	for _, view := range viewsToUpdate {
		fields := map[string]any{
			"UserID":            view.UserID,
			"ExerciseID":        view.ExerciseID,
			"LastViewed":        view.LastViewed.Format(time.RFC3339),
			"RepetitionCounter": view.RepetitionCounter,
		}
		if view.AirtableID == "" {
			recordsToCreate = append(recordsToCreate, &airtable.Record{Fields: fields})
		} else {
			recordsToUpdate = append(recordsToUpdate, &airtable.Record{ID: view.AirtableID, Fields: fields})
		}
	}

	if len(recordsToCreate) > 0 {
		if _, err := table.AddRecords(&airtable.Records{Records: recordsToCreate}); err != nil {
			return fmt.Errorf("failed to create user exercise views: %v", err)
		}
	}
	if len(recordsToUpdate) > 0 {
		if _, err := table.UpdateRecords(&airtable.Records{Records: recordsToUpdate}); err != nil {
			return fmt.Errorf("failed to update user exercise views: %v", err)
		}
	}
	return nil
}

func GetUserByGoogleID(googleID string) (*User, error) {
	table := Client.GetTable(BaseID, UsersTableName)
	records, err := table.GetRecords().WithFilterFormula(fmt.Sprintf("{GoogleID} = '%s'", googleID)).Do()
	if err != nil {
		return nil, err
	}

	if len(records.Records) == 0 {
		return nil, nil
	}

	record := records.Records[0]
	return &User{
		ID:         record.ID,
		GoogleID:   record.Fields["GoogleID"].(string),
		AirtableID: record.ID,
	}, nil
}

func CreateUser(googleID string) (*User, error) {
	table := Client.GetTable(BaseID, UsersTableName)
	records := &airtable.Records{
		Records: []*airtable.Record{
			{
				Fields: map[string]any{
					"GoogleID": googleID,
				},
			},
		},
	}
	result, err := table.AddRecords(records)
	if err != nil {
		return nil, err
	}

	record := result.Records[0]
	return &User{
		ID:         record.ID,
		GoogleID:   record.Fields["GoogleID"].(string),
		AirtableID: record.ID,
	}, nil
}

func GetUserStats(userID string) (*UserStats, error) {
	table := Client.GetTable(BaseID, UserStatsTableName)
	records, err := table.GetRecords().WithFilterFormula(fmt.Sprintf("{UserID} = '%s'", userID)).Do()
	if err != nil {
		return nil, err
	}

	if len(records.Records) == 0 {
		return &UserStats{UserID: userID}, nil
	}

	record := records.Records[0]
	stats := &UserStats{
		UserID:           userID,
		AirtableRecordID: record.ID,
	}

	if val, ok := record.Fields["TotalExercises"].(float64); ok {
		stats.TotalExercises = int(val)
	}
	if val, ok := record.Fields["TotalMistakes"].(float64); ok {
		stats.TotalMistakes = int(val)
	}
	if val, ok := record.Fields["TotalHints"].(float64); ok {
		stats.TotalHints = int(val)
	}
	if val, ok := record.Fields["TotalTime"].(float64); ok {
		stats.TotalTime = int(val)
	}
	if val, ok := record.Fields["LastTopicID"].(string); ok {
		stats.LastTopicID = val
	}

	return stats, nil
}

func UpdateUserStats(stats *UserStats) error {
	table := Client.GetTable(BaseID, UserStatsTableName)
	fields := map[string]any{
		"UserID":         stats.UserID,
		"TotalExercises": stats.TotalExercises,
		"TotalMistakes":  stats.TotalMistakes,
		"TotalHints":     stats.TotalHints,
		"TotalTime":      stats.TotalTime,
	}

	if stats.AirtableRecordID != "" {
		records := &airtable.Records{
			Records: []*airtable.Record{
				{
					ID:     stats.AirtableRecordID,
					Fields: fields,
				},
			},
		}
		_, err := table.UpdateRecords(records)
		return err
	}

	records := &airtable.Records{
		Records: []*airtable.Record{
			{
				Fields: fields,
			},
		},
	}
	_, err := table.AddRecords(records)
	return err
}

func UpdateUserSetting(userID, lastTopicID string) error {
	stats, err := GetUserStats(userID)
	if err != nil {
		return err
	}

	stats.LastTopicID = lastTopicID

	table := Client.GetTable(BaseID, UserStatsTableName)
	fields := map[string]any{
		"UserID":      userID,
		"LastTopicID": lastTopicID,
	}

	if stats.AirtableRecordID != "" {
		records := &airtable.Records{
			Records: []*airtable.Record{
				{
					ID:     stats.AirtableRecordID,
					Fields: fields,
				},
			},
		}
		_, err := table.UpdateRecords(records)
		return err
	}

	records := &airtable.Records{
		Records: []*airtable.Record{
			{
				Fields: fields,
			},
		},
	}
	_, err = table.AddRecords(records)
	return err
}

func GetUserByID(userID string) (*User, error) {
	table := Client.GetTable(BaseID, UsersTableName)
	record, err := table.GetRecord(userID)
	if err != nil {
		return nil, err
	}

	if record == nil {
		return nil, nil
	}

	return &User{
		ID:         record.ID,
		GoogleID:   record.Fields["GoogleID"].(string),
		AirtableID: record.ID,
	}, nil
}

func GetAllUsers() ([]*User, error) {
	table := Client.GetTable(BaseID, UsersTableName)
	records, err := table.GetRecords().Do()
	if err != nil {
		return nil, fmt.Errorf("failed to get all users: %w", err)
	}

	var users []*User
	for _, record := range records.Records {
		googleID, ok := record.Fields["GoogleID"].(string)
		if !ok {
			continue
		}
		users = append(users, &User{
			ID:         record.ID,
			GoogleID:   googleID,
			AirtableID: record.ID,
		})
	}
	return users, nil
}

func UpdateLegacyExercisesWithAudio(text, audioPath string) {
	table := Client.GetTable(BaseID, ExercisesTableName)

	records, err := table.GetRecords().Do()
	if err != nil {
		log.Printf("Warning: failed to get exercises for audio update: %v", err)
		return
	}

	var recordsToUpdate []*airtable.Record
	for _, record := range records.Records {
		if audioFilePath, ok := record.Fields["AudioFilePath"].(string); ok && audioFilePath != "" {
			continue
		}

		if exerciseJSON, ok := record.Fields["ExerciseJSON"].(string); ok && exerciseJSON != "" {
			var exercise struct {
				CorrectGermanSentence string `json:"correct_german_sentence"`
			}
			if err := json.Unmarshal([]byte(exerciseJSON), &exercise); err == nil {
				if exercise.CorrectGermanSentence == text {
					updateRecord := &airtable.Record{
						ID: record.ID,
						Fields: map[string]any{
							"AudioFilePath": audioPath,
						},
					}
					recordsToUpdate = append(recordsToUpdate, updateRecord)
					log.Printf("Found legacy exercise to update with audio: %s", text)
				}
			}
		}
	}

	if len(recordsToUpdate) > 0 {
		updateRecords := &airtable.Records{Records: recordsToUpdate}
		_, err := table.UpdateRecords(updateRecords)
		if err != nil {
			log.Printf("Warning: failed to update legacy exercises with audio: %v", err)
		} else {
			log.Printf("Successfully updated %d legacy exercises with audio path: %s", len(recordsToUpdate), audioPath)
		}
	}
}

// --- Storage Interface Implementation ---
// These methods allow AirtableStorage to implement the Storage interface
// by delegating to the existing global function implementations.

func (a *AirtableStorage) CreateTopic(name, prompt string) (*Topic, error) {
	return CreateTopic(name, prompt)
}

func (a *AirtableStorage) GetAllTopics() ([]*Topic, error) {
	return GetAllTopics()
}

func (a *AirtableStorage) GetTopic(topicID string) (*Topic, error) {
	return GetTopic(topicID)
}

func (a *AirtableStorage) UpdateTopic(topicID, name, prompt string) (*Topic, error) {
	return UpdateTopic(topicID, name, prompt)
}

func (a *AirtableStorage) DeleteTopic(topicID string) error {
	return DeleteTopic(topicID)
}

func (a *AirtableStorage) GetVersions(topicID string) ([]*PromptVersion, error) {
	return GetVersions(topicID)
}

func (a *AirtableStorage) GetVersion(versionID string) (*PromptVersion, error) {
	return GetVersion(versionID)
}

func (a *AirtableStorage) AddPromptVersion(topicID, prompt string) error {
	return AddPromptVersion(topicID, prompt)
}

func (a *AirtableStorage) CreateExercise(topicID, promptHash, exerciseJSON, audioFilePath string) (*Exercise, error) {
	return CreateExercise(topicID, promptHash, exerciseJSON, audioFilePath)
}

func (a *AirtableStorage) GetExercisesForTopic(topicID, promptHash string) ([]*Exercise, error) {
	return GetExercisesForTopic(topicID, promptHash)
}

func (a *AirtableStorage) UpdateLegacyExercisesWithAudio(text, audioPath string) {
	UpdateLegacyExercisesWithAudio(text, audioPath)
}

func (a *AirtableStorage) GetUserExerciseViews(userID string) (map[string]*UserExerciseView, error) {
	return GetUserExerciseViews(userID)
}

func (a *AirtableStorage) UpdateUserExerciseViews(viewsToUpdate []*UserExerciseView) error {
	return UpdateUserExerciseViews(viewsToUpdate)
}

func (a *AirtableStorage) GetUserByGoogleID(googleID string) (*User, error) {
	return GetUserByGoogleID(googleID)
}

func (a *AirtableStorage) CreateUser(googleID string) (*User, error) {
	return CreateUser(googleID)
}

func (a *AirtableStorage) GetUserByID(userID string) (*User, error) {
	return GetUserByID(userID)
}

func (a *AirtableStorage) GetAllUsers() ([]*User, error) {
	return GetAllUsers()
}

func (a *AirtableStorage) GetUserStats(userID string) (*UserStats, error) {
	return GetUserStats(userID)
}

func (a *AirtableStorage) UpdateUserStats(stats *UserStats) error {
	return UpdateUserStats(stats)
}

func (a *AirtableStorage) UpdateUserSetting(userID, lastTopicID string) error {
	return UpdateUserSetting(userID, lastTopicID)
}

func (a *AirtableStorage) InitializeDefaultTopics() {
	InitializeDefaultTopics()
}

func (a *AirtableStorage) GetUserExerciseStats(userID string) (*UserExerciseStats, error) {
	// Airtable doesn't support this feature - return empty stats
	return &UserExerciseStats{
		TrainedCount:       0,
		ReadyToRepeatCount: 0,
	}, nil
}

func (a *AirtableStorage) CompleteUserExercise(userID, exerciseID string) error {
	// Airtable doesn't support this feature - no-op
	return nil
}
