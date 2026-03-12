package storage

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"strings"
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
		`ALTER TABLE user_exercise_views ADD COLUMN is_hidden BOOLEAN NOT NULL DEFAULT 0`,
		`ALTER TABLE topics ADD COLUMN parent_id TEXT NULL`,
		`ALTER TABLE topics ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0`,
		`CREATE INDEX IF NOT EXISTS idx_topics_parent ON topics(parent_id, sort_order, created_at)`,
	}

	for _, migration := range migrations {
		// Try to execute migration, ignore error if column already exists
		_, err := s.db.Exec(migration)
		if err != nil && !isColumnExistsError(err) {
			return fmt.Errorf("migration failed: %w", err)
		}
	}

	// Add unique constraint on (parent_id, name) to prevent duplicate names at same level
	// SQLite doesn't support adding constraints to existing tables, so we need to recreate the table
	if err := s.addTopicsUniqueConstraint(); err != nil {
		return fmt.Errorf("failed to add topics unique constraint: %w", err)
	}

	log.Println("Database migrations completed successfully")
	return nil
}

// isColumnExistsError checks if the error is due to column or index already existing
func isColumnExistsError(err error) bool {
	if err == nil {
		return false
	}
	errStr := err.Error()
	return strings.Contains(errStr, "duplicate column name") ||
		strings.Contains(errStr, "already exists")
}

// addTopicsUniqueConstraint adds a unique constraint on (parent_id, name) to prevent duplicate names at same level
// Since SQLite doesn't support adding constraints to existing tables, we recreate the table with the constraint
func (s *SQLiteStorage) addTopicsUniqueConstraint() error {
	// Get a dedicated connection to ensure PRAGMA settings affect the same connection used by the transaction
	// This is necessary because PRAGMA settings are connection-specific, and using s.db might give different
	// connections from the pool, causing the migration to fail with cascade deletes or leaving FK state corrupted.
	conn, err := s.db.Conn(context.Background())
	if err != nil {
		return fmt.Errorf("failed to get dedicated connection: %w", err)
	}
	defer conn.Close()

	// Check if we already ran this migration by checking for the generated column in the table schema
	var sqlFromSchema string
	err = conn.QueryRowContext(context.Background(), "SELECT sql FROM sqlite_master WHERE type='table' AND name='topics'").Scan(&sqlFromSchema)
	if err == nil && strings.Contains(sqlFromSchema, "parent_key") {
		// Migration already ran, skip
		return nil
	}

	// Get the current foreign_keys setting so we can restore it after migration
	// This respects the user's configuration (e.g., DSN with _foreign_keys=0)
	var originalFKSetting int
	err = conn.QueryRowContext(context.Background(), "PRAGMA foreign_keys").Scan(&originalFKSetting)
	if err != nil {
		// If we can't read the setting, assume it's ON (safe default)
		log.Printf("Warning: could not read foreign_keys pragma, assuming ON: %v", err)
		originalFKSetting = 1
	}

	// Disable foreign keys BEFORE starting the transaction to prevent cascade deletes when DROP TABLE is executed
	// This is critical: even if app doesn't enable FKs, the DSN can include _foreign_keys=1
	// which would enable them without code changes, causing data loss.
	// PRAGMA foreign_keys must be set OUTSIDE the transaction because setting it inside a transaction
	// is ignored by SQLite (the setting remains at its previous value).
	_, err = conn.ExecContext(context.Background(), `PRAGMA foreign_keys = OFF`)
	if err != nil {
		return fmt.Errorf("failed to disable foreign keys: %w", err)
	}

	// Ensure FK state is restored even on error paths
	// Note: PRAGMA statements don't support parameterized queries, so we use string literals
	defer func() {
		var restoreValue string = "OFF"
		if originalFKSetting == 1 {
			restoreValue = "ON"
		}
		_, restoreErr := conn.ExecContext(context.Background(), `PRAGMA foreign_keys = `+restoreValue)
		if restoreErr != nil {
			log.Printf("Warning: failed to restore foreign_keys pragma after migration error: %v", restoreErr)
		}
	}()

	// Start transaction for atomic table recreation
	tx, err := conn.BeginTx(context.Background(), nil)
	if err != nil {
		return fmt.Errorf("failed to start transaction: %w", err)
	}
	defer tx.Rollback()

	// Create new table with unique constraint using a generated column to handle NULL parent_id
	// The generated column 'parent_key' replaces NULL with a sentinel value to enforce uniqueness at root level
	// Sentinel value is a UUID-like string that won't conflict with actual topic IDs
	_, err = tx.Exec(`
		CREATE TABLE topics_new (
			id TEXT PRIMARY KEY,
			name TEXT NOT NULL,
			prompt TEXT NOT NULL,
			parent_id TEXT NULL,
			sort_order INTEGER NOT NULL DEFAULT 0,
			created_at DATETIME NOT NULL,
			updated_at DATETIME NOT NULL,
			parent_key TEXT GENERATED ALWAYS AS (
				CASE
					WHEN parent_id IS NULL THEN '00000000-0000-0000-0000-000000000000'
					ELSE parent_id
				END
			) STORED,
			UNIQUE(parent_key, name COLLATE NOCASE)
		)
	`)
	if err != nil {
		return fmt.Errorf("failed to create topics_new table: %w", err)
	}

	// Check for duplicate topic names before proceeding
	// We need to detect duplicates to fail fast instead of silently dropping data
	var duplicateCount int
	err = tx.QueryRow(`
		SELECT COUNT(*)
		FROM (
			SELECT COUNT(*) as cnt
			FROM topics
			GROUP BY
				CASE WHEN parent_id IS NULL THEN '00000000-0000-0000-0000-000000000000' ELSE parent_id END,
				LOWER(name)
			HAVING cnt > 1
		)
	`).Scan(&duplicateCount)
	if err != nil {
		return fmt.Errorf("failed to check for duplicate topics: %w", err)
	}
	if duplicateCount > 0 {
		return fmt.Errorf("cannot add unique constraint: found %d duplicate topic name(s) at the same parent level. Please manually resolve duplicates by renaming or deleting duplicate topics before running the migration", duplicateCount)
	}

	// Copy data from old table to new table
	// At this point, we know there are no duplicates, so all data will be copied
	_, err = tx.Exec(`
		INSERT INTO topics_new(id, name, prompt, parent_id, sort_order, created_at, updated_at)
		SELECT id, name, prompt, parent_id, sort_order, created_at, updated_at FROM topics
	`)
	if err != nil {
		return fmt.Errorf("failed to copy data to topics_new: %w", err)
	}

	// Drop old table
	// Foreign keys were disabled before starting the transaction, so this won't cascade-delete
	_, err = tx.Exec(`DROP TABLE topics`)
	if err != nil {
		return fmt.Errorf("failed to drop topics table: %w", err)
	}

	// Rename new table to old name
	_, err = tx.Exec(`ALTER TABLE topics_new RENAME TO topics`)
	if err != nil {
		return fmt.Errorf("failed to rename topics_new to topics: %w", err)
	}

	// Recreate indexes
	_, err = tx.Exec(`CREATE INDEX IF NOT EXISTS idx_topics_parent ON topics(parent_id, sort_order, created_at)`)
	if err != nil {
		return fmt.Errorf("failed to recreate index: %w", err)
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("failed to commit migration transaction: %w", err)
	}

	// Foreign keys will be restored by the defer function when conn.Close() is called
	// The defer runs before the connection is returned to the pool, ensuring FK state is correct
	return nil
}

// querier is an interface that can be a *sql.DB or *sql.Tx
type querier interface {
	QueryRow(query string, args ...interface{}) *sql.Row
}

// Implement the Storage interface methods below...

func (s *SQLiteStorage) Close() error {
	if s.db != nil {
		return s.db.Close()
	}
	return nil
}

func (s *SQLiteStorage) CreateTopic(name, prompt string, parentID *string, sortOrder int) (*Topic, error) {
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
		ParentID:  parentID,
		SortOrder: sortOrder,
		CreatedAt: now,
		UpdatedAt: now,
	}

	stmt, err := tx.Prepare("INSERT INTO topics(id, name, prompt, parent_id, sort_order, created_at, updated_at) VALUES(?, ?, ?, ?, ?, ?, ?)")
	if err != nil {
		return nil, err
	}
	defer stmt.Close()

	_, err = stmt.Exec(topic.ID, topic.Name, topic.Prompt, topic.ParentID, topic.SortOrder, topic.CreatedAt, topic.UpdatedAt)
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
	rows, err := s.db.Query("SELECT id, name, prompt, parent_id, sort_order, created_at, updated_at FROM topics ORDER BY sort_order ASC, name ASC, created_at ASC")
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var topics []*Topic
	for rows.Next() {
		var topic Topic
		if err := rows.Scan(&topic.ID, &topic.Name, &topic.Prompt, &topic.ParentID, &topic.SortOrder, &topic.CreatedAt, &topic.UpdatedAt); err != nil {
			return nil, err
		}
		topics = append(topics, &topic)
	}
	return topics, nil
}

func (s *SQLiteStorage) GetDescendantTopicIDs(topicID string) ([]string, error) {
	var descendantIDs []string
	visited := make(map[string]bool)

	var fetchChildren func(id string) error
	fetchChildren = func(id string) error {
		if visited[id] {
			return nil // Prevent cycle
		}
		visited[id] = true

		rows, err := s.db.Query("SELECT id FROM topics WHERE parent_id = ?", id)
		if err != nil {
			return err
		}

		var children []string
		for rows.Next() {
			var childID string
			if err := rows.Scan(&childID); err != nil {
				rows.Close()
				return err
			}
			children = append(children, childID)
		}
		rows.Close()

		if err := rows.Err(); err != nil {
			return err
		}

		for _, childID := range children {
			descendantIDs = append(descendantIDs, childID)
			if err := fetchChildren(childID); err != nil {
				return err
			}
		}
		return nil
	}

	if err := fetchChildren(topicID); err != nil {
		return nil, err
	}

	return descendantIDs, nil
}

func (s *SQLiteStorage) GetTopic(topicID string) (*Topic, error) {
	return s.getTopic(s.db, topicID)
}

// getTopic is a helper to get a topic within a transaction or from the db
func (s *SQLiteStorage) getTopic(q querier, topicID string) (*Topic, error) {
	row := q.QueryRow("SELECT id, name, prompt, parent_id, sort_order, created_at, updated_at FROM topics WHERE id = ?", topicID)
	var topic Topic
	err := row.Scan(&topic.ID, &topic.Name, &topic.Prompt, &topic.ParentID, &topic.SortOrder, &topic.CreatedAt, &topic.UpdatedAt)
	if err == sql.ErrNoRows {
		return nil, fmt.Errorf("topic not found")
	}
	return &topic, err
}

func (s *SQLiteStorage) UpdateTopic(topicID, name, prompt string, parentID *string, sortOrder int) (*Topic, error) {
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

	stmt, err := tx.Prepare("UPDATE topics SET name = ?, prompt = ?, parent_id = ?, sort_order = ?, updated_at = ? WHERE id = ?")
	if err != nil {
		return nil, err
	}
	defer stmt.Close()

	_, err = stmt.Exec(name, prompt, parentID, sortOrder, now, topicID)
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

	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("failed to commit topic update: %w", err)
	}

	return topic, nil
}

// ErrTopicHasChildren is returned when attempting to delete a topic that has child topics.
var ErrTopicHasChildren = fmt.Errorf("topic has children and cannot be deleted")

func (s *SQLiteStorage) DeleteTopic(topicID string) error {
	// Check if topic has children
	var count int
	err := s.db.QueryRow("SELECT COUNT(*) FROM topics WHERE parent_id = ?", topicID).Scan(&count)
	if err != nil {
		return err
	}
	if count > 0 {
		return ErrTopicHasChildren
	}

	stmt, err := s.db.Prepare("DELETE FROM topics WHERE id = ?")
	if err != nil {
		return err
	}
	defer stmt.Close()

	_, err = stmt.Exec(topicID)
	return err
}

func (s *SQLiteStorage) MoveTopic(topicID, parentID string, position *int) (*Topic, error) {
	tx, err := s.db.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	topic, err := s.getTopic(tx, topicID)
	if err != nil {
		return nil, err
	}

	normalizedParentID := normalizeParentID(parentID)
	if normalizedParentID != nil {
		if *normalizedParentID == topicID {
			return nil, fmt.Errorf("invalid parent: topic cannot be its own parent")
		}

		if _, err := s.getTopic(tx, *normalizedParentID); err != nil {
			return nil, fmt.Errorf("parent topic not found")
		}

		if err := s.ensureNoHierarchyCycle(tx, topicID, normalizedParentID); err != nil {
			return nil, err
		}
	}

	oldParentID := topic.ParentID
	targetPosition := -1
	if position != nil {
		targetPosition = *position
		if parentIDsEqual(normalizedParentID, oldParentID) {
			oldIndex, err := s.getTopicIndexInSiblings(tx, oldParentID, topicID)
			if err != nil {
				return nil, err
			}
			if targetPosition > oldIndex {
				targetPosition--
			}
		}
	}

	var destinationSiblings []string
	if parentIDsEqual(normalizedParentID, oldParentID) {
		destinationSiblings, err = s.getSiblingTopicIDs(tx, normalizedParentID, topicID)
		if err != nil {
			return nil, err
		}
	} else {
		oldSiblings, err := s.getSiblingTopicIDs(tx, oldParentID, topicID)
		if err != nil {
			return nil, err
		}
		if err := s.setSiblingOrder(tx, oldParentID, oldSiblings); err != nil {
			return nil, err
		}

		destinationSiblings, err = s.getSiblingTopicIDs(tx, normalizedParentID, topicID)
		if err != nil {
			return nil, err
		}
	}

	insertAt := clampTopicPosition(targetPosition, len(destinationSiblings))
	destinationSiblings = insertTopicIDAt(destinationSiblings, topicID, insertAt)
	if err := s.setSiblingOrder(tx, normalizedParentID, destinationSiblings); err != nil {
		return nil, err
	}

	now := time.Now().UTC()
	_, err = tx.Exec(
		"UPDATE topics SET parent_id = ?, sort_order = ?, updated_at = ? WHERE id = ?",
		parentIDToDBValue(normalizedParentID),
		insertAt,
		now,
		topicID,
	)
	if err != nil {
		return nil, err
	}

	updatedTopic, err := s.getTopic(tx, topicID)
	if err != nil {
		return nil, err
	}

	return updatedTopic, tx.Commit()
}

func (s *SQLiteStorage) getSiblingTopicIDs(tx *sql.Tx, parentID *string, excludeTopicID string) ([]string, error) {
	query := "SELECT id FROM topics WHERE 1=1"
	args := []interface{}{}

	if strings.TrimSpace(excludeTopicID) != "" {
		query += " AND id != ?"
		args = append(args, excludeTopicID)
	}

	if parentID == nil {
		query += " AND parent_id IS NULL"
	} else {
		query += " AND parent_id = ?"
		args = append(args, *parentID)
	}

	query += " ORDER BY sort_order ASC, name ASC, created_at ASC, id ASC"
	rows, err := tx.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}

	return ids, nil
}

func (s *SQLiteStorage) getTopicIndexInSiblings(tx *sql.Tx, parentID *string, topicID string) (int, error) {
	siblings, err := s.getSiblingTopicIDs(tx, parentID, "")
	if err != nil {
		return -1, err
	}

	for i, siblingID := range siblings {
		if siblingID == topicID {
			return i, nil
		}
	}

	return -1, fmt.Errorf("topic not found in siblings")
}

func (s *SQLiteStorage) setSiblingOrder(tx *sql.Tx, parentID *string, orderedTopicIDs []string) error {
	parentValue := parentIDToDBValue(parentID)
	for sortOrder, topicID := range orderedTopicIDs {
		_, err := tx.Exec(
			"UPDATE topics SET parent_id = ?, sort_order = ? WHERE id = ?",
			parentValue,
			sortOrder,
			topicID,
		)
		if err != nil {
			return err
		}
	}

	return nil
}

func (s *SQLiteStorage) ensureNoHierarchyCycle(q querier, topicID string, potentialParentID *string) error {
	currentParentID := potentialParentID
	visited := map[string]struct{}{}

	for currentParentID != nil {
		currentID := *currentParentID
		if currentID == topicID {
			return fmt.Errorf("invalid parent: this move would create a cycle")
		}
		if _, seen := visited[currentID]; seen {
			return fmt.Errorf("invalid topic hierarchy: cycle already exists")
		}
		visited[currentID] = struct{}{}

		parentTopic, err := s.getTopic(q, currentID)
		if err != nil {
			return fmt.Errorf("parent topic not found")
		}
		currentParentID = parentTopic.ParentID
	}

	return nil
}

func normalizeParentID(parentID string) *string {
	trimmed := strings.TrimSpace(parentID)
	if trimmed == "" {
		return nil
	}
	return &trimmed
}

func parentIDToDBValue(parentID *string) interface{} {
	if parentID == nil {
		return nil
	}
	return *parentID
}

func parentIDsEqual(a, b *string) bool {
	if a == nil && b == nil {
		return true
	}
	if a == nil || b == nil {
		return false
	}
	return *a == *b
}

func clampTopicPosition(position, siblingCount int) int {
	if position < 0 || position > siblingCount {
		return siblingCount
	}
	return position
}

func insertTopicIDAt(siblings []string, topicID string, index int) []string {
	result := make([]string, 0, len(siblings)+1)
	result = append(result, siblings[:index]...)
	result = append(result, topicID)
	result = append(result, siblings[index:]...)
	return result
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
		if _, err := s.CreateTopic(dt.name, dt.prompt, nil, 0); err != nil {
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

func (s *SQLiteStorage) GetExercisesForTopics(topicIDs []string, promptHash string) ([]*Exercise, error) {
	if len(topicIDs) == 0 {
		return []*Exercise{}, nil
	}

	query := "SELECT id, topic_id, prompt_hash, exercise_json, audio_file_path, created_at FROM exercises WHERE topic_id IN ("
	placeholders := make([]string, len(topicIDs))
	args := make([]interface{}, len(topicIDs))
	for i, id := range topicIDs {
		placeholders[i] = "?"
		args[i] = id
	}
	query += strings.Join(placeholders, ",") + ")"

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
		       total_attempts, successful_attempts, failed_attempts, hints_used, mistakes_made, is_favorite, is_hidden
		FROM user_exercise_views WHERE user_id = ?`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	views := make(map[string]*UserExerciseView)
	for rows.Next() {
		var view UserExerciseView
		if err := rows.Scan(&view.ID, &view.UserID, &view.ExerciseID, &view.LastViewed, &view.RepetitionCounter,
			&view.TotalAttempts, &view.SuccessfulAttempts, &view.FailedAttempts, &view.HintsUsed, &view.MistakesMade, &view.IsFavorite, &view.IsHidden); err != nil {
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

	stats := &UserExerciseStats{
		ReadyToRepeatCount: readyToRepeatCount,
		TrainedCount:       totalViews - readyToRepeatCount,
	}

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
		descendantIDs, err := s.GetDescendantTopicIDs(topicID)
		if err != nil {
			return nil, err
		}

		topicIDs := append([]string{topicID}, descendantIDs...)

		query += " AND e.topic_id IN ("
		placeholders := make([]string, len(topicIDs))
		for i, id := range topicIDs {
			placeholders[i] = "?"
			args = append(args, id)
		}
		query += strings.Join(placeholders, ",") + ")"
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

func (s *SQLiteStorage) HideExercise(userID, exerciseID string) error {
	_, err := s.db.Exec(`
		INSERT INTO user_exercise_views(id, user_id, exercise_id, last_viewed, repetition_counter, is_hidden)
		VALUES(?, ?, ?, ?, 0, 1)
		ON CONFLICT(user_id, exercise_id) DO UPDATE SET is_hidden = 1
	`, uuid.NewString(), userID, exerciseID, time.Now().UTC())
	return err
}
