package storage

import (
	"os"
	"path/filepath"
	"testing"
)

func TestGetDatabaseStats(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "test_stats.sqlite")

	store, err := NewSQLiteStorage(dbPath)
	if err != nil {
		t.Fatalf("Failed to create storage: %v", err)
	}
	defer store.db.Close()

	// Clear default topics
	store.db.Exec("DELETE FROM exercises")
	store.db.Exec("DELETE FROM topics")

	// Create topics
	t1, _ := store.CreateTopic("Alpha", "prompt1", nil, 0)
	t2, _ := store.CreateTopic("Beta", "prompt2", nil, 1)
	t3, _ := store.CreateTopic("Gamma", "prompt3", nil, 2)

	// Create exercises: 2 for Alpha, 3 for Beta, 0 for Gamma
	store.CreateExercise(t1.ID, "h1", `{"q":"a1"}`, "")
	store.CreateExercise(t1.ID, "h1", `{"q":"a2"}`, "")
	store.CreateExercise(t2.ID, "h2", `{"q":"b1"}`, "")
	store.CreateExercise(t2.ID, "h2", `{"q":"b2"}`, "")
	store.CreateExercise(t2.ID, "h2", `{"q":"b3"}`, "")

	// Create a temporary audio cache directory with some files
	audioCacheDir := filepath.Join(t.TempDir(), "audio_cache")
	if err := os.MkdirAll(audioCacheDir, 0755); err != nil {
		t.Fatalf("Failed to create audio cache dir: %v", err)
	}
	// Create 3 files of known sizes
	for _, name := range []string{"file1.mp3", "file2.mp3", "file3.mp3"} {
		data := make([]byte, 1024) // 1 KB each
		if err := os.WriteFile(filepath.Join(audioCacheDir, name), data, 0644); err != nil {
			t.Fatalf("Failed to write test audio file: %v", err)
		}
	}

	stats, err := store.GetDatabaseStats(audioCacheDir, dbPath)
	if err != nil {
		t.Fatalf("GetDatabaseStats failed: %v", err)
	}

	// Verify totals
	if stats.TotalExercises != 5 {
		t.Errorf("Expected 5 total exercises, got %d", stats.TotalExercises)
	}
	if stats.TotalTopics != 3 {
		t.Errorf("Expected 3 total topics, got %d", stats.TotalTopics)
	}

	// Verify per-topic counts (ordered by name: Alpha, Beta, Gamma)
	if len(stats.ExercisesPerTopic) != 3 {
		t.Fatalf("Expected 3 per-topic entries, got %d", len(stats.ExercisesPerTopic))
	}

	expectedCounts := map[string]int{
		t1.ID: 2, // Alpha
		t2.ID: 3, // Beta
		t3.ID: 0, // Gamma
	}
	for _, tc := range stats.ExercisesPerTopic {
		expected, ok := expectedCounts[tc.TopicID]
		if !ok {
			t.Errorf("Unexpected topic ID in results: %s", tc.TopicID)
			continue
		}
		if tc.Count != expected {
			t.Errorf("Topic %s (%s): expected count %d, got %d", tc.TopicName, tc.TopicID, expected, tc.Count)
		}
	}

	// Verify ordering (by name)
	if stats.ExercisesPerTopic[0].TopicName != "Alpha" {
		t.Errorf("Expected first topic to be Alpha, got %s", stats.ExercisesPerTopic[0].TopicName)
	}
	if stats.ExercisesPerTopic[1].TopicName != "Beta" {
		t.Errorf("Expected second topic to be Beta, got %s", stats.ExercisesPerTopic[1].TopicName)
	}
	if stats.ExercisesPerTopic[2].TopicName != "Gamma" {
		t.Errorf("Expected third topic to be Gamma, got %s", stats.ExercisesPerTopic[2].TopicName)
	}

	// Verify audio cache stats
	if stats.AudioCacheFileCount != 3 {
		t.Errorf("Expected 3 audio cache files, got %d", stats.AudioCacheFileCount)
	}
	expectedSizeMB := float64(3*1024) / (1024 * 1024) // 3 KB in MB
	if stats.AudioCacheSizeMB < expectedSizeMB*0.99 || stats.AudioCacheSizeMB > expectedSizeMB*1.01 {
		t.Errorf("Expected audio cache size ~%f MB, got %f", expectedSizeMB, stats.AudioCacheSizeMB)
	}

	// Verify DB file size is non-zero
	if stats.DatabaseSizeMB <= 0 {
		t.Errorf("Expected positive database size, got %f", stats.DatabaseSizeMB)
	}
}

func TestGetDatabaseStats_EmptyDatabase(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "test_stats_empty.sqlite")

	store, err := NewSQLiteStorage(dbPath)
	if err != nil {
		t.Fatalf("Failed to create storage: %v", err)
	}
	defer store.db.Close()

	// Clear default topics
	store.db.Exec("DELETE FROM exercises")
	store.db.Exec("DELETE FROM topics")

	stats, err := store.GetDatabaseStats("", dbPath)
	if err != nil {
		t.Fatalf("GetDatabaseStats failed: %v", err)
	}

	if stats.TotalExercises != 0 {
		t.Errorf("Expected 0 exercises, got %d", stats.TotalExercises)
	}
	if stats.TotalTopics != 0 {
		t.Errorf("Expected 0 topics, got %d", stats.TotalTopics)
	}
	if len(stats.ExercisesPerTopic) != 0 {
		t.Errorf("Expected 0 per-topic entries, got %d", len(stats.ExercisesPerTopic))
	}
	if stats.AudioCacheSizeMB != 0 {
		t.Errorf("Expected 0 audio cache size, got %f", stats.AudioCacheSizeMB)
	}
	if stats.AudioCacheFileCount != 0 {
		t.Errorf("Expected 0 audio cache files, got %d", stats.AudioCacheFileCount)
	}
}

func TestGetDatabaseStats_NonexistentAudioDir(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "test_stats_noaudio.sqlite")

	store, err := NewSQLiteStorage(dbPath)
	if err != nil {
		t.Fatalf("Failed to create storage: %v", err)
	}
	defer store.db.Close()

	store.db.Exec("DELETE FROM topics")

	// Pass a non-existent audio cache dir - should not error
	stats, err := store.GetDatabaseStats("/nonexistent/audio_cache", dbPath)
	if err != nil {
		t.Fatalf("GetDatabaseStats should not fail with nonexistent audio dir: %v", err)
	}

	if stats.AudioCacheFileCount != 0 {
		t.Errorf("Expected 0 audio cache files for nonexistent dir, got %d", stats.AudioCacheFileCount)
	}
}
