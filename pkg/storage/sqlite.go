package storage

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"time"

	"github.com/google/uuid"
	_ "github.com/mattn/go-sqlite3"
)

// SQLiteStorage implements the Storage interface for SQLite.
type SQLiteStorage struct {
	db *sql.DB
}

// NewSQLiteStorage initializes a new SQLite storage backend.
func NewSQLiteStorage(dataSourceName string) (*SQLiteStorage, error) {
	db, err := sql.Open("sqlite3", dataSourceName)
	if err != nil {
		return nil, fmt.Errorf("failed to open sqlite database: %w", err)
	}
	if err := db.Ping(); err != nil {
		return nil, fmt.Errorf("failed to connect to sqlite database: %w", err)
	}

	storage := &SQLiteStorage{db: db}
	if err := storage.initSchema(); err != nil {
		return nil, fmt.Errorf("failed to initialize schema: %w", err)
	}

	log.Println("SQLite storage initialized successfully.")
	return storage, nil
}

// initSchema creates the database tables if they don't exist.
func (s *SQLiteStorage) initSchema() error {
	schema := `
	CREATE TABLE IF NOT EXISTS topics (
		id TEXT PRIMARY KEY,
		name TEXT NOT NULL,
		prompt TEXT NOT NULL,
		created_at DATETIME NOT NULL,
		updated_at DATETIME NOT NULL
	);

	CREATE TABLE IF NOT EXISTS prompt_versions (
		id TEXT PRIMARY KEY,
		topic_id TEXT NOT NULL,
		prompt TEXT NOT NULL,
		version INTEGER NOT NULL,
		created_at DATETIME NOT NULL,
		FOREIGN KEY(topic_id) REFERENCES topics(id) ON DELETE CASCADE
	);

	CREATE TABLE IF NOT EXISTS exercises (
		id TEXT PRIMARY KEY,
		topic_id TEXT NOT NULL,
		prompt_hash TEXT NOT NULL,
		exercise_json TEXT NOT NULL,
		audio_file_path TEXT,
		created_at DATETIME NOT NULL,
		FOREIGN KEY(topic_id) REFERENCES topics(id) ON DELETE CASCADE
	);

	CREATE TABLE IF NOT EXISTS users (
		id TEXT PRIMARY KEY,
		google_id TEXT UNIQUE NOT NULL
	);

	CREATE TABLE IF NOT EXISTS user_exercise_views (
		id TEXT PRIMARY KEY,
		user_id TEXT NOT NULL,
		exercise_id TEXT NOT NULL,
		last_viewed DATETIME NOT NULL,
		repetition_counter INTEGER NOT NULL DEFAULT 0,
		total_attempts INTEGER NOT NULL DEFAULT 0,
		successful_attempts INTEGER NOT NULL DEFAULT 0,
		failed_attempts INTEGER NOT NULL DEFAULT 0,
		hints_used INTEGER NOT NULL DEFAULT 0,
		mistakes_made INTEGER NOT NULL DEFAULT 0,
		is_favorite BOOLEAN NOT NULL DEFAULT 0,
		FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
		FOREIGN KEY(exercise_id) REFERENCES exercises(id) ON DELETE CASCADE,
		UNIQUE(user_id, exercise_id)
	);

	CREATE TABLE IF NOT EXISTS user_stats (
		user_id TEXT PRIMARY KEY,
		total_exercises INTEGER DEFAULT 0,
		total_mistakes INTEGER DEFAULT 0,
		total_hints INTEGER DEFAULT 0,
		total_time INTEGER DEFAULT 0,
		last_topic_id TEXT,
		FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
	);

	CREATE INDEX IF NOT EXISTS idx_exercises_topic_hash ON exercises(topic_id, prompt_hash);
	CREATE INDEX IF NOT EXISTS idx_exercises_topic ON exercises(topic_id);
	CREATE INDEX IF NOT EXISTS idx_user_exercise_views_user ON user_exercise_views(user_id);
	CREATE INDEX IF NOT EXISTS idx_prompt_versions_topic ON prompt_versions(topic_id);
	`
	if _, err := s.db.Exec(schema); err != nil {
		return err
	}

	// Run migrations to add new columns to existing databases
	return s.runMigrations()
}

// runMigrations adds new columns to existing tables if they don't exist
func (s *SQLiteStorage) runMigrations() error {
	migrations := []string{
		`ALTER TABLE user_exercise_views ADD COLUMN total_attempts INTEGER NOT NULL DEFAULT 0`,
		`ALTER TABLE user_exercise_views ADD COLUMN successful_attempts INTEGER NOT NULL DEFAULT 0`,
		`ALTER TABLE user_exercise_views ADD COLUMN failed_attempts INTEGER NOT NULL DEFAULT 0`,
		`ALTER TABLE user_exercise_views ADD COLUMN hints_used INTEGER NOT NULL DEFAULT 0`,
		`ALTER TABLE user_exercise_views ADD COLUMN mistakes_made INTEGER NOT NULL DEFAULT 0`,
		`ALTER TABLE user_exercise_views ADD COLUMN is_favorite BOOLEAN NOT NULL DEFAULT 0`,
	}

	for _, migration := range migrations {
		// Try to execute migration, ignore error if column already exists
		_, err := s.db.Exec(migration)
		if err != nil && !isColumnExistsError(err) {
			return fmt.Errorf("migration failed: %w", err)
		}
	}

	log.Println("Database migrations completed successfully")
	return nil
}

// isColumnExistsError checks if the error is due to column already existing
func isColumnExistsError(err error) bool {
	return err != nil && (
		err.Error() == "duplicate column name: total_attempts" ||
		err.Error() == "duplicate column name: successful_attempts" ||
		err.Error() == "duplicate column name: failed_attempts" ||
		err.Error() == "duplicate column name: hints_used" ||
		err.Error() == "duplicate column name: mistakes_made" ||
		err.Error() == "duplicate column name: is_favorite")
}

// querier is an interface that can be a *sql.DB or *sql.Tx
type querier interface {
	QueryRow(query string, args ...interface{}) *sql.Row
}

// Implement the Storage interface methods below...

func (s *SQLiteStorage) CreateTopic(name, prompt string) (*Topic, error) {
	tx, err := s.db.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	now := time.Now().UTC()
	topic := &Topic{
		ID:        uuid.NewString(),
		Name:      name,
		Prompt:    prompt,
		CreatedAt: now,
		UpdatedAt: now,
	}

	stmt, err := tx.Prepare("INSERT INTO topics(id, name, prompt, created_at, updated_at) VALUES(?, ?, ?, ?, ?)")
	if err != nil {
		return nil, err
	}
	defer stmt.Close()

	_, err = stmt.Exec(topic.ID, topic.Name, topic.Prompt, topic.CreatedAt, topic.UpdatedAt)
	if err != nil {
		return nil, err
	}

	// Add initial prompt version
	err = s.addPromptVersion(tx, topic.ID, prompt, 1, now)
	if err != nil {
		return nil, err
	}

	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return topic, nil
}

func (s *SQLiteStorage) GetAllTopics() ([]*Topic, error) {
	rows, err := s.db.Query("SELECT id, name, prompt, created_at, updated_at FROM topics ORDER BY created_at ASC")
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var topics []*Topic
	for rows.Next() {
		var topic Topic
		if err := rows.Scan(&topic.ID, &topic.Name, &topic.Prompt, &topic.CreatedAt, &topic.UpdatedAt); err != nil {
			return nil, err
		}
		topics = append(topics, &topic)
	}
	return topics, nil
}

func (s *SQLiteStorage) GetTopic(topicID string) (*Topic, error) {
	return s.getTopic(s.db, topicID)
}

// getTopic is a helper to get a topic within a transaction or from the db
func (s *SQLiteStorage) getTopic(q querier, topicID string) (*Topic, error) {
	row := q.QueryRow("SELECT id, name, prompt, created_at, updated_at FROM topics WHERE id = ?", topicID)
	var topic Topic
	err := row.Scan(&topic.ID, &topic.Name, &topic.Prompt, &topic.CreatedAt, &topic.UpdatedAt)
	if err == sql.ErrNoRows {
		return nil, fmt.Errorf("topic not found")
	}
	return &topic, err
}

func (s *SQLiteStorage) UpdateTopic(topicID, name, prompt string) (*Topic, error) {
	tx, err := s.db.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	now := time.Now().UTC()

	currentTopic, err := s.getTopic(tx, topicID)
	if err != nil {
		return nil, err
	}

	if name == "" {
		name = currentTopic.Name
	}

	stmt, err := tx.Prepare("UPDATE topics SET name = ?, prompt = ?, updated_at = ? WHERE id = ?")
	if err != nil {
		return nil, err
	}
	defer stmt.Close()

	_, err = stmt.Exec(name, prompt, now, topicID)
	if err != nil {
		return nil, err
	}

	if prompt != currentTopic.Prompt {
		var lastVersion int
		row := tx.QueryRow("SELECT COALESCE(MAX(version), 0) FROM prompt_versions WHERE topic_id = ?", topicID)
		if err := row.Scan(&lastVersion); err != nil {
			return nil, err
		}

		err = s.addPromptVersion(tx, topicID, prompt, lastVersion+1, now)
		if err != nil {
			return nil, err
		}
	}

	topic, err := s.getTopic(tx, topicID)
	if err != nil {
		return nil, err
	}

	return topic, tx.Commit()
}

func (s *SQLiteStorage) DeleteTopic(topicID string) error {
	stmt, err := s.db.Prepare("DELETE FROM topics WHERE id = ?")
	if err != nil {
		return err
	}
	defer stmt.Close()

	_, err = stmt.Exec(topicID)
	return err
}

func (s *SQLiteStorage) GetVersions(topicID string) ([]*PromptVersion, error) {
	rows, err := s.db.Query("SELECT id, topic_id, prompt, version, created_at FROM prompt_versions WHERE topic_id = ? ORDER BY version ASC", topicID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var versions []*PromptVersion
	for rows.Next() {
		var v PromptVersion
		if err := rows.Scan(&v.ID, &v.TopicID, &v.Prompt, &v.Version, &v.CreatedAt); err != nil {
			return nil, err
		}
		versions = append(versions, &v)
	}
	return versions, nil
}

func (s *SQLiteStorage) GetVersion(versionID string) (*PromptVersion, error) {
	row := s.db.QueryRow("SELECT id, topic_id, prompt, version, created_at FROM prompt_versions WHERE id = ?", versionID)
	var v PromptVersion
	err := row.Scan(&v.ID, &v.TopicID, &v.Prompt, &v.Version, &v.CreatedAt)
	if err == sql.ErrNoRows {
		return nil, fmt.Errorf("version not found")
	}
	return &v, err
}

func (s *SQLiteStorage) AddPromptVersion(topicID, prompt string) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	var lastVersion int
	row := tx.QueryRow("SELECT COALESCE(MAX(version), 0) FROM prompt_versions WHERE topic_id = ?", topicID)
	if err := row.Scan(&lastVersion); err != nil {
		return err
	}

	err = s.addPromptVersion(tx, topicID, prompt, lastVersion+1, time.Now().UTC())
	if err != nil {
		return err
	}
	return tx.Commit()
}

// addPromptVersion is a helper to add a prompt version within a transaction.
func (s *SQLiteStorage) addPromptVersion(tx *sql.Tx, topicID, prompt string, version int, createdAt time.Time) error {
	stmt, err := tx.Prepare("INSERT INTO prompt_versions(id, topic_id, prompt, version, created_at) VALUES(?, ?, ?, ?, ?)")
	if err != nil {
		return err
	}
	defer stmt.Close()

	_, err = stmt.Exec(uuid.NewString(), topicID, prompt, version, createdAt)
	return err
}

func (s *SQLiteStorage) InitializeDefaultTopics() {
	topics, err := s.GetAllTopics()
	if err != nil {
		log.Printf("Could not check for existing topics in SQLite: %v", err)
		return
	}
	if len(topics) > 0 {
		return // Data already exists, do nothing.
	}

	log.Println("Initializing default topics for SQLite...")
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

	for _, dt := range defaultTopics {
		if _, err := s.CreateTopic(dt.name, dt.prompt); err != nil {
			log.Printf("Error creating default topic '%s' in SQLite: %v", dt.name, err)
		}
	}
}

func (s *SQLiteStorage) CreateExercise(topicID, promptHash, exerciseJSON, audioFilePath string) (*Exercise, error) {
	now := time.Now().UTC()
	exercise := &Exercise{
		ID:            uuid.NewString(),
		TopicID:       topicID,
		PromptHash:    promptHash,
		ExerciseJSON:  exerciseJSON,
		AudioFilePath: audioFilePath,
		CreatedAt:     now,
	}

	stmt, err := s.db.Prepare("INSERT INTO exercises(id, topic_id, prompt_hash, exercise_json, audio_file_path, created_at) VALUES(?, ?, ?, ?, ?, ?)")
	if err != nil {
		return nil, err
	}
	defer stmt.Close()

	_, err = stmt.Exec(exercise.ID, exercise.TopicID, exercise.PromptHash, exercise.ExerciseJSON, exercise.AudioFilePath, exercise.CreatedAt)
	if err != nil {
		return nil, err
	}
	// The created exercise struct no longer has an AirtableID, so we just return the base struct
	return exercise, nil
}

func (s *SQLiteStorage) GetExercisesForTopic(topicID, promptHash string) ([]*Exercise, error) {
	query := "SELECT id, topic_id, prompt_hash, exercise_json, audio_file_path, created_at FROM exercises WHERE topic_id = ?"
	args := []interface{}{topicID}

	if promptHash != "" {
		query += " AND prompt_hash = ?"
		args = append(args, promptHash)
	}

	rows, err := s.db.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var exercises []*Exercise
	for rows.Next() {
		var ex Exercise
		if err := rows.Scan(&ex.ID, &ex.TopicID, &ex.PromptHash, &ex.ExerciseJSON, &ex.AudioFilePath, &ex.CreatedAt); err != nil {
			return nil, err
		}
		exercises = append(exercises, &ex)
	}
	return exercises, nil
}

func (s *SQLiteStorage) UpdateLegacyExercisesWithAudio(text, audioPath string) {
	query := `
		UPDATE exercises
		SET audio_file_path = ?
		WHERE json_extract(exercise_json, '$.correct_german_sentence') = ?
		AND (audio_file_path IS NULL OR audio_file_path = '')
	`
	_, err := s.db.Exec(query, audioPath, text)
	if err != nil {
		log.Printf("Error updating legacy exercises with audio: %v", err)
	}
}

func (s *SQLiteStorage) GetUserExerciseViews(userID string) (map[string]*UserExerciseView, error) {
	rows, err := s.db.Query(`
		SELECT id, user_id, exercise_id, last_viewed, repetition_counter,
		       total_attempts, successful_attempts, failed_attempts, hints_used, mistakes_made, is_favorite
		FROM user_exercise_views WHERE user_id = ?`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	views := make(map[string]*UserExerciseView)
	for rows.Next() {
		var view UserExerciseView
		if err := rows.Scan(&view.ID, &view.UserID, &view.ExerciseID, &view.LastViewed, &view.RepetitionCounter,
			&view.TotalAttempts, &view.SuccessfulAttempts, &view.FailedAttempts, &view.HintsUsed, &view.MistakesMade, &view.IsFavorite); err != nil {
			return nil, err
		}
		views[view.ExerciseID] = &view
	}
	return views, nil
}

func (s *SQLiteStorage) UpdateUserExerciseViews(viewsToUpdate []*UserExerciseView) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	stmt, err := tx.Prepare(`
		INSERT INTO user_exercise_views(id, user_id, exercise_id, last_viewed, repetition_counter,
		                                 total_attempts, successful_attempts, failed_attempts, hints_used, mistakes_made, is_favorite)
		VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(user_id, exercise_id) DO UPDATE SET
		last_viewed = excluded.last_viewed,
		repetition_counter = excluded.repetition_counter,
		total_attempts = excluded.total_attempts,
		successful_attempts = excluded.successful_attempts,
		failed_attempts = excluded.failed_attempts,
		hints_used = excluded.hints_used,
		mistakes_made = excluded.mistakes_made
	`)
	if err != nil {
		return err
	}
	defer stmt.Close()

	for _, view := range viewsToUpdate {
		// Use existing ID if available, otherwise generate a new one.
		if view.ID == "" {
			view.ID = uuid.NewString()
		}
		_, err := stmt.Exec(view.ID, view.UserID, view.ExerciseID, view.LastViewed, view.RepetitionCounter,
			view.TotalAttempts, view.SuccessfulAttempts, view.FailedAttempts, view.HintsUsed, view.MistakesMade, view.IsFavorite)
		if err != nil {
			return err
		}
	}

	return tx.Commit()
}

func (s *SQLiteStorage) GetUserByGoogleID(googleID string) (*User, error) {
	row := s.db.QueryRow("SELECT id, google_id FROM users WHERE google_id = ?", googleID)
	var user User
	err := row.Scan(&user.ID, &user.GoogleID)
	if err == sql.ErrNoRows {
		return nil, nil // Not found is not an error
	}
	if err != nil {
		return nil, err
	}
	return &user, nil
}

func (s *SQLiteStorage) CreateUser(googleID string) (*User, error) {
	user := &User{
		ID:       uuid.NewString(),
		GoogleID: googleID,
	}
	stmt, err := s.db.Prepare("INSERT INTO users(id, google_id) VALUES(?, ?)")
	if err != nil {
		return nil, err
	}
	defer stmt.Close()

	_, err = stmt.Exec(user.ID, user.GoogleID)
	if err != nil {
		return nil, err
	}
	return user, nil
}

func (s *SQLiteStorage) GetUserByID(userID string) (*User, error) {
	row := s.db.QueryRow("SELECT id, google_id FROM users WHERE id = ?", userID)
	var user User
	err := row.Scan(&user.ID, &user.GoogleID)
	if err == sql.ErrNoRows {
		return nil, nil // Not found is not an error
	}
	if err != nil {
		return nil, err
	}
	return &user, nil
}

func (s *SQLiteStorage) GetAllUsers() ([]*User, error) {
	rows, err := s.db.Query("SELECT id, google_id FROM users")
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var users []*User
	for rows.Next() {
		var user User
		if err := rows.Scan(&user.ID, &user.GoogleID); err != nil {
			return nil, err
		}
		users = append(users, &user)
	}
	return users, nil
}

func (s *SQLiteStorage) GetUserStats(userID string) (*UserStats, error) {
	row := s.db.QueryRow("SELECT user_id, total_exercises, total_mistakes, total_hints, total_time, last_topic_id FROM user_stats WHERE user_id = ?", userID)
	var stats UserStats
	err := row.Scan(&stats.UserID, &stats.TotalExercises, &stats.TotalMistakes, &stats.TotalHints, &stats.TotalTime, &stats.LastTopicID)
	if err == sql.ErrNoRows {
		// Return a zero-value struct if no stats exist yet for the user
		return &UserStats{UserID: userID}, nil
	}
	if err != nil {
		return nil, err
	}
	return &stats, nil
}

func (s *SQLiteStorage) UpdateUserStats(stats *UserStats) error {
	query := `
		INSERT INTO user_stats(user_id, total_exercises, total_mistakes, total_hints, total_time)
		VALUES(?, ?, ?, ?, ?)
		ON CONFLICT(user_id) DO UPDATE SET
		total_exercises = excluded.total_exercises,
		total_mistakes = excluded.total_mistakes,
		total_hints = excluded.total_hints,
		total_time = excluded.total_time;
	`
	_, err := s.db.Exec(query, stats.UserID, stats.TotalExercises, stats.TotalMistakes, stats.TotalHints, stats.TotalTime)
	return err
}

func (s *SQLiteStorage) UpdateUserSetting(userID, lastTopicID string) error {
	query := `
		INSERT INTO user_stats(user_id, last_topic_id)
		VALUES(?, ?)
		ON CONFLICT(user_id) DO UPDATE SET
		last_topic_id = excluded.last_topic_id;
	`
	_, err := s.db.Exec(query, userID, lastTopicID)
	return err
}

// GetUserExerciseStats calculates and returns the exercise statistics for a user.
func (s *SQLiteStorage) GetUserExerciseStats(userID string) (*UserExerciseStats, error) {
	var totalViews int
	row := s.db.QueryRow("SELECT COUNT(*) FROM user_exercise_views WHERE user_id = ?", userID)
	if err := row.Scan(&totalViews); err != nil {
		return nil, err
	}
	log.Printf("[STATS_CALC] User %s has %d total exercise views", userID, totalViews)

	// This logic mirrors the SRS logic from the main handler.
	// It calculates the number of days since the last view and compares it to the repetition counter squared.
	query := `
		SELECT COUNT(*)
		FROM user_exercise_views
		WHERE user_id = ? AND (julianday('now') - julianday(last_viewed)) >= (repetition_counter * repetition_counter)
	`
	var readyToRepeatCount int
	row = s.db.QueryRow(query, userID)
	if err := row.Scan(&readyToRepeatCount); err != nil {
		return nil, err
	}
	log.Printf("[STATS_CALC] User %s has %d exercises ready to repeat (formula passed)", userID, readyToRepeatCount)

	stats := &UserExerciseStats{
		ReadyToRepeatCount: readyToRepeatCount,
		TrainedCount:       totalViews - readyToRepeatCount,
	}

	log.Printf("[STATS_CALC] Final stats for user %s: ready=%d, trained=%d", userID, stats.ReadyToRepeatCount, stats.TrainedCount)
	return stats, nil
}

// GetUserExerciseHistory returns the practice history for all exercises a user has attempted
func (s *SQLiteStorage) GetUserExerciseHistory(userID, topicID string) ([]*ExerciseHistoryItem, error) {
	query := `
		SELECT
			uev.exercise_id,
			t.name AS topic_name,
			e.exercise_json,
			uev.last_viewed,
			uev.repetition_counter,
			uev.total_attempts,
			uev.successful_attempts,
			uev.failed_attempts,
			uev.hints_used,
			uev.mistakes_made,
			uev.is_favorite
		FROM user_exercise_views uev
		JOIN exercises e ON uev.exercise_id = e.id
		JOIN topics t ON e.topic_id = t.id
		WHERE uev.user_id = ?
	`

	args := []interface{}{userID}

	// Add topic filter if specified
	if topicID != "" {
		query += " AND e.topic_id = ?"
		args = append(args, topicID)
	}

	query += " ORDER BY uev.last_viewed DESC"

	rows, err := s.db.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var history []*ExerciseHistoryItem
	now := time.Now()

	for rows.Next() {
		var item ExerciseHistoryItem
		var exerciseJSON string

		if err := rows.Scan(
			&item.ExerciseID,
			&item.TopicName,
			&exerciseJSON,
			&item.LastViewed,
			&item.RepetitionCounter,
			&item.TotalAttempts,
			&item.SuccessfulAttempts,
			&item.FailedAttempts,
			&item.HintsUsed,
			&item.MistakesMade,
			&item.IsFavorite,
		); err != nil {
			return nil, err
		}

		// Parse the exercise JSON to extract German sentence and English hint
		var exerciseData map[string]interface{}
		if err := json.Unmarshal([]byte(exerciseJSON), &exerciseData); err != nil {
			log.Printf("Error parsing exercise JSON for %s: %v", item.ExerciseID, err)
			continue
		}

		if sentence, ok := exerciseData["correct_german_sentence"].(string); ok {
			item.GermanSentence = sentence
		}
		if hint, ok := exerciseData["english_hint"].(string); ok {
			item.EnglishHint = hint
		}

		// Calculate next review time using SRS formula: (counter^2) days
		daysSinceView := now.Sub(item.LastViewed).Hours() / 24
		item.NextReviewDays = float64(item.RepetitionCounter * item.RepetitionCounter)
		item.ReadyToRepeat = daysSinceView >= item.NextReviewDays

		history = append(history, &item)
	}

	return history, nil
}

func (s *SQLiteStorage) ToggleFavorite(userID, exerciseID string) (bool, error) {
	tx, err := s.db.Begin()
	if err != nil {
		return false, err
	}
	defer tx.Rollback()

	// Check if view exists
	var isFavorite bool
	var exists bool
	row := tx.QueryRow("SELECT is_favorite FROM user_exercise_views WHERE user_id = ? AND exercise_id = ?", userID, exerciseID)
	err = row.Scan(&isFavorite)
	if err != nil {
		if err == sql.ErrNoRows {
			exists = false
		} else {
			return false, err
		}
	} else {
		exists = true
	}

	newStatus := !isFavorite

	if exists {
		_, err = tx.Exec("UPDATE user_exercise_views SET is_favorite = ? WHERE user_id = ? AND exercise_id = ?", newStatus, userID, exerciseID)
		if err != nil {
			return false, err
		}
	} else {
		// Create new view if it doesn't exist, initializing other fields to 0/now
		_, err = tx.Exec(`
			INSERT INTO user_exercise_views(id, user_id, exercise_id, last_viewed, repetition_counter, is_favorite, created_at)
			VALUES(?, ?, ?, ?, 0, ?, ?)
		`, uuid.NewString(), userID, exerciseID, time.Now().UTC(), newStatus, time.Now().UTC())
		// Note: created_at is not in the schema provided in initSchema, checking...
		// initSchema: last_viewed DATETIME NOT NULL.
		// So we insert last_viewed as now.
		// Wait, the INSERT above had created_at which is not in schema. Correcting query.

		_, err = tx.Exec(`
			INSERT INTO user_exercise_views(id, user_id, exercise_id, last_viewed, repetition_counter, is_favorite)
			VALUES(?, ?, ?, ?, 0, ?)
		`, uuid.NewString(), userID, exerciseID, time.Now().UTC(), newStatus)

		if err != nil {
			return false, err
		}
	}

	if err := tx.Commit(); err != nil {
		return false, err
	}

	return newStatus, nil
}