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

// CLIToken represents a long-lived bearer token issued to a CLI / agent
// after a successful OAuth device-flow login. The plaintext token is never
// stored; only its SHA-256 hex digest lives in the database.
type CLIToken struct {
	ID         string     `json:"id"`
	UserID     string     `json:"user_id"`
	TokenHash  string     `json:"token_hash"`
	Label      string     `json:"label"`
	CreatedAt  time.Time  `json:"created_at"`
	LastUsedAt *time.Time `json:"last_used_at,omitempty"`
	RevokedAt  *time.Time `json:"revoked_at,omitempty"`
}

// PodcastEpisode is a built podcast episode owned by a logged-in user; the
// rows back the user's private RSS feed and the in-app episode list. The MP3
// itself lives on disk. PhrasesJSON is the transcript as the app serialized
// it; "" for rows recorded before transcripts were stored.
type PodcastEpisode struct {
	ID              string    `json:"id"`
	UserID          string    `json:"user_id"`
	TopicID         string    `json:"topic_id"`
	Title           string    `json:"title"`
	FavoritesOnly   bool      `json:"favorites_only"`
	DurationSeconds int       `json:"duration_seconds"`
	SizeBytes       int64     `json:"size_bytes"`
	PhraseCount     int       `json:"phrase_count"`
	RecallRepeats   int       `json:"recall_repeats"`
	PhrasesJSON     string    `json:"-"`
	CreatedAt       time.Time `json:"created_at"`
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
	NextReviewHours    float64   `json:"next_review_hours"`
	ReadyToRepeat      bool      `json:"ready_to_repeat"`
	IsFavorite         bool      `json:"is_favorite"`
	IsHidden           bool      `json:"is_hidden"`
}

// TopicKeyTerms holds automatically extracted key terms for a topic's prompt.
type TopicKeyTerms struct {
	TopicID    string   `json:"topic_id"`
	PromptHash string   `json:"prompt_hash"`
	Terms      []string `json:"terms"`
}

// DatabaseStats holds aggregate statistics about the database.
type DatabaseStats struct {
	TotalExercises      int                `json:"total_exercises"`
	TotalTopics         int                `json:"total_topics"`
	AudioCacheSizeMB    float64            `json:"audio_cache_size_mb"`
	AudioCacheFileCount int                `json:"audio_cache_file_count"`
	DatabaseSizeMB      float64            `json:"database_size_mb"`
	ExercisesPerTopic   []TopicExerciseCount `json:"exercises_per_topic"`
}

// TopicExerciseCount holds the exercise count for a single topic.
type TopicExerciseCount struct {
	TopicID   string `json:"topic_id"`
	TopicName string `json:"topic_name"`
	Count     int    `json:"count"`
}

// Storage defines the interface for database operations.
type Storage interface {
	// Topics
	CreateTopic(name, prompt string, parentID *string, sortOrder int) (*Topic, error)
	GetAllTopics() ([]*Topic, error)
	GetTopic(topicID string) (*Topic, error)
	// GetDescendantTopicIDs returns all descendant topic IDs recursively for a given topic ID.
	GetDescendantTopicIDs(topicID string) ([]string, error)
	UpdateTopic(topicID, name, prompt string, parentID *string, sortOrder int) (*Topic, error)
	MoveTopic(topicID, parentID string, position *int) (*Topic, error)
	DeleteTopic(topicID string) error

	// Key Terms
	SaveTopicKeyTerms(topicID, promptHash string, terms []string) error
	GetTopicKeyTerms(topicID, promptHash string) (*TopicKeyTerms, error)

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
	ToggleHideExercise(userID, exerciseID string) (bool, error)

	// ApplyCompletionBatch writes view updates and records the client-supplied
	// batchID atomically. It reports false (writing nothing) when the batch was
	// already recorded, i.e. the client replayed it. An empty batchID always
	// applies, matching the pre-idempotency behavior.
	ApplyCompletionBatch(userID, batchID string, viewsToUpdate []*UserExerciseView) (bool, error)

	// CLI Tokens
	CreateCLIToken(userID, tokenHash, label string) (*CLIToken, error)
	GetCLITokenByHash(tokenHash string) (*CLIToken, error)
	TouchCLIToken(id string) error
	RevokeCLIToken(id, userID string) error
	ListCLITokensForUser(userID string) ([]*CLIToken, error)

	// Podcast episodes and the per-user feed token
	CreatePodcastEpisode(ep *PodcastEpisode) error
	// ListPodcastEpisodes returns the user's episodes created after since, newest first.
	ListPodcastEpisodes(userID string, since time.Time) ([]*PodcastEpisode, error)
	DeletePodcastEpisodesBefore(before time.Time) error
	// EnsurePodcastFeedToken stores token for the user unless one exists and
	// returns the user's token.
	EnsurePodcastFeedToken(userID, token string) (string, error)
	// ReplacePodcastFeedToken sets the user's token; the old one stops working.
	ReplacePodcastFeedToken(userID, token string) error
	// GetUserIDByPodcastFeedToken returns "" for an unknown token.
	GetUserIDByPodcastFeedToken(token string) (string, error)

	// Statistics
	GetDatabaseStats(audioCacheDir, dbFilePath string) (*DatabaseStats, error)

	// Initialization
	InitializeDefaultTopics()

	// Close closes the database connection.
	Close() error
}

// DB is the global database connection
var DB Storage

// GetPromptHash generates a SHA256 hash for a given prompt string.
func GetPromptHash(prompt string) string {
	hash := sha256.Sum256([]byte(prompt))
	return hex.EncodeToString(hash[:])
}
