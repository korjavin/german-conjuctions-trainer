package storage

import (
	"crypto/sha256"
	"encoding/hex"
	"time"
)

// --- Data Structures ---

type Topic struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	Prompt    string    `json:"prompt"`
	ParentID  *string   `json:"parent_id,omitempty"`
	SortOrder int       `json:"sort_order"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

type PromptVersion struct {
	ID        string    `json:"id"`
	TopicID   string    `json:"topic_id"`
	Prompt    string    `json:"prompt"`
	Version   int       `json:"version"`
	CreatedAt time.Time `json:"created_at"`
}

type Exercise struct {
	ID            string    `json:"id"`
	TopicID       string    `json:"topic_id"`
	PromptHash    string    `json:"prompt_hash"`
	ExerciseJSON  string    `json:"exercise_json"`
	AudioFilePath string    `json:"audio_file_path"`
	CreatedAt     time.Time `json:"created_at"`
}

type UserExerciseView struct {
	ID                 string    `json:"id"`
	UserID             string    `json:"user_id"`
	ExerciseID         string    `json:"exercise_id"`
	LastViewed         time.Time `json:"last_viewed"`
	RepetitionCounter  int       `json:"repetition_counter"`
	TotalAttempts      int       `json:"total_attempts"`      // Total number of times attempted
	SuccessfulAttempts int       `json:"successful_attempts"` // Perfect attempts (no hints, no mistakes)
	FailedAttempts     int       `json:"failed_attempts"`     // Attempts with mistakes
	HintsUsed          int       `json:"hints_used"`          // Total hints used
	MistakesMade       int       `json:"mistakes_made"`       // Total mistakes made
	IsFavorite         bool      `json:"is_favorite"`         // User marked as favorite
	IsHidden           bool      `json:"is_hidden"`           // User hid this exercise (soft delete for this user)
}

type User struct {
	ID       string `json:"id"`
	GoogleID string `json:"google_id"`
}

type UserStats struct {
	UserID         string `json:"user_id"`
	TotalExercises int    `json:"total_exercises"`
	TotalMistakes  int    `json:"total_mistakes"`
	TotalHints     int    `json:"total_hints"`
	TotalTime      int    `json:"total_time"`
	LastTopicID    string `json:"last_topic_id"`
}

// UserExerciseStats holds the counts of exercises in different states for a user.
type UserExerciseStats struct {
	TrainedCount       int `json:"trained"`
	ReadyToRepeatCount int `json:"ready_to_repeat"`
}

// ExerciseHistoryItem represents an exercise with its practice history
type ExerciseHistoryItem struct {
	ExerciseID         string    `json:"exercise_id"`
	TopicName          string    `json:"topic_name"`
	GermanSentence     string    `json:"german_sentence"`
	EnglishHint        string    `json:"english_hint"`
	LastViewed         time.Time `json:"last_viewed"`
	RepetitionCounter  int       `json:"repetition_counter"`
	TotalAttempts      int       `json:"total_attempts"`
	SuccessfulAttempts int       `json:"successful_attempts"`
	FailedAttempts     int       `json:"failed_attempts"`
	HintsUsed          int       `json:"hints_used"`
	MistakesMade       int       `json:"mistakes_made"`
	NextReviewDays     float64   `json:"next_review_days"`
	ReadyToRepeat      bool      `json:"ready_to_repeat"`
	IsFavorite         bool      `json:"is_favorite"`
}

// Storage defines the interface for database operations.
type Storage interface {
	// Topics
	CreateTopic(name, prompt string, parentID *string, sortOrder int) (*Topic, error)
	GetAllTopics() ([]*Topic, error)
	GetTopic(topicID string) (*Topic, error)
	GetDescendantTopicIDs(topicID string) ([]string, error)
	UpdateTopic(topicID, name, prompt string, parentID *string, sortOrder int) (*Topic, error)
	MoveTopic(topicID, parentID string, position *int) (*Topic, error)
	DeleteTopic(topicID string) error

	// Versions
	GetVersions(topicID string) ([]*PromptVersion, error)
	GetVersion(versionID string) (*PromptVersion, error)
	AddPromptVersion(topicID, prompt string) error

	// Exercises
	CreateExercise(topicID, promptHash, exerciseJSON, audioFilePath string) (*Exercise, error)
	GetExercisesForTopic(topicID, promptHash string) ([]*Exercise, error)
	GetExercisesForTopics(topicIDs []string, promptHash string) ([]*Exercise, error)
	UpdateLegacyExercisesWithAudio(text, audioPath string)

	// User Data
	GetUserExerciseViews(userID string) (map[string]*UserExerciseView, error)
	UpdateUserExerciseViews(viewsToUpdate []*UserExerciseView) error
	GetUserByGoogleID(googleID string) (*User, error)
	CreateUser(googleID string) (*User, error)
	GetUserByID(userID string) (*User, error)
	GetUserStats(userID string) (*UserStats, error)
	UpdateUserStats(stats *UserStats) error
	UpdateUserSetting(userID, lastTopicID string) error
	GetUserExerciseStats(userID string) (*UserExerciseStats, error)
	GetUserExerciseHistory(userID, topicID string) ([]*ExerciseHistoryItem, error)
	ToggleFavorite(userID, exerciseID string) (bool, error)
	HideExercise(userID, exerciseID string) error

	// Initialization
	InitializeDefaultTopics()
}

// DB is the global database connection
var DB Storage

// GetPromptHash generates a SHA256 hash for a given prompt string.
func GetPromptHash(prompt string) string {
	hash := sha256.Sum256([]byte(prompt))
	return hex.EncodeToString(hash[:])
}
