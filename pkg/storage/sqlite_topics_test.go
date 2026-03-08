package storage

import (
	"path/filepath"
	"reflect"
	"sort"
	"strings"
	"testing"
)

func newTestSQLiteStorageForMove(t *testing.T) *SQLiteStorage {
	t.Helper()

	dbPath := filepath.Join(t.TempDir(), "test.db")
	store, err := NewSQLiteStorage(dbPath)
	if err != nil {
		t.Fatalf("failed to create test sqlite storage: %v", err)
	}

	if _, err := store.db.Exec("DELETE FROM topics"); err != nil {
		t.Fatalf("failed to clean topics: %v", err)
	}

	return store
}

func mustCreateRootTopic(t *testing.T, store *SQLiteStorage, name string) *Topic {
	t.Helper()

	topic, err := store.CreateTopic(name, "test prompt "+name, nil, 0)
	if err != nil {
		t.Fatalf("failed to create topic %q: %v", name, err)
	}
	return topic
}

func parentIDValue(parentID *string) string {
	if parentID == nil {
		return ""
	}
	return *parentID
}

func orderedTopicIDs(topics []*Topic, parentID string) []string {
	filtered := make([]*Topic, 0)
	for _, topic := range topics {
		if parentIDValue(topic.ParentID) == parentID {
			filtered = append(filtered, topic)
		}
	}

	sort.Slice(filtered, func(i, j int) bool {
		if filtered[i].SortOrder == filtered[j].SortOrder {
			return filtered[i].ID < filtered[j].ID
		}
		return filtered[i].SortOrder < filtered[j].SortOrder
	})

	ids := make([]string, 0, len(filtered))
	for _, topic := range filtered {
		ids = append(ids, topic.ID)
	}
	return ids
}

func TestMoveTopic_ReordersRootSiblingsByPosition(t *testing.T) {
	store := newTestSQLiteStorageForMove(t)

	a := mustCreateRootTopic(t, store, "A")
	b := mustCreateRootTopic(t, store, "B")
	c := mustCreateRootTopic(t, store, "C")

	targetPosition := 1
	if _, err := store.MoveTopic(c.ID, "", &targetPosition); err != nil {
		t.Fatalf("MoveTopic failed: %v", err)
	}

	topics, err := store.GetAllTopics()
	if err != nil {
		t.Fatalf("GetAllTopics failed: %v", err)
	}

	got := orderedTopicIDs(topics, "")
	want := []string{a.ID, c.ID, b.ID}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("unexpected root order, got %v, want %v", got, want)
	}
}

func TestMoveTopic_MakesChildAndAppendsAtEnd(t *testing.T) {
	store := newTestSQLiteStorageForMove(t)

	parent := mustCreateRootTopic(t, store, "Parent")
	childOne := mustCreateRootTopic(t, store, "ChildOne")
	childTwo := mustCreateRootTopic(t, store, "ChildTwo")

	if _, err := store.MoveTopic(childOne.ID, parent.ID, nil); err != nil {
		t.Fatalf("MoveTopic childOne failed: %v", err)
	}
	if _, err := store.MoveTopic(childTwo.ID, parent.ID, nil); err != nil {
		t.Fatalf("MoveTopic childTwo failed: %v", err)
	}

	topics, err := store.GetAllTopics()
	if err != nil {
		t.Fatalf("GetAllTopics failed: %v", err)
	}

	got := orderedTopicIDs(topics, parent.ID)
	want := []string{childOne.ID, childTwo.ID}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("unexpected child order, got %v, want %v", got, want)
	}
}

func TestMoveTopic_ReordersWithinSameParent(t *testing.T) {
	store := newTestSQLiteStorageForMove(t)

	parent := mustCreateRootTopic(t, store, "Parent")
	a := mustCreateRootTopic(t, store, "A")
	b := mustCreateRootTopic(t, store, "B")
	c := mustCreateRootTopic(t, store, "C")

	if _, err := store.MoveTopic(a.ID, parent.ID, nil); err != nil {
		t.Fatalf("MoveTopic A failed: %v", err)
	}
	if _, err := store.MoveTopic(b.ID, parent.ID, nil); err != nil {
		t.Fatalf("MoveTopic B failed: %v", err)
	}
	if _, err := store.MoveTopic(c.ID, parent.ID, nil); err != nil {
		t.Fatalf("MoveTopic C failed: %v", err)
	}

	targetPosition := 2
	if _, err := store.MoveTopic(a.ID, parent.ID, &targetPosition); err != nil {
		t.Fatalf("MoveTopic reorder failed: %v", err)
	}

	topics, err := store.GetAllTopics()
	if err != nil {
		t.Fatalf("GetAllTopics failed: %v", err)
	}

	got := orderedTopicIDs(topics, parent.ID)
	want := []string{b.ID, a.ID, c.ID}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("unexpected sibling order after reorder, got %v, want %v", got, want)
	}
}

func TestMoveTopic_PreventsHierarchyCycles(t *testing.T) {
	store := newTestSQLiteStorageForMove(t)

	a := mustCreateRootTopic(t, store, "A")
	b := mustCreateRootTopic(t, store, "B")
	c := mustCreateRootTopic(t, store, "C")

	if _, err := store.MoveTopic(b.ID, a.ID, nil); err != nil {
		t.Fatalf("MoveTopic B->A failed: %v", err)
	}
	if _, err := store.MoveTopic(c.ID, b.ID, nil); err != nil {
		t.Fatalf("MoveTopic C->B failed: %v", err)
	}

	_, err := store.MoveTopic(a.ID, c.ID, nil)
	if err == nil {
		t.Fatal("expected cycle validation error, got nil")
	}
	if !strings.Contains(err.Error(), "cycle") {
		t.Fatalf("expected cycle-related error, got: %v", err)
	}
}

func TestUpdateTopic_WithWhitespacePrompt(t *testing.T) {
	store := newTestSQLiteStorageForMove(t)

	// Create a topic with whitespace-only prompt (simulating legacy data)
	whitespacePrompt := "   " // 3 spaces
	_, err := store.db.Exec(`
		INSERT INTO topics(id, name, prompt, parent_id, sort_order, created_at, updated_at)
		VALUES('ws-topic-id', 'WhitespaceTopic', ?, NULL, 0, datetime('now'), datetime('now'))
	`, whitespacePrompt)
	if err != nil {
		t.Fatalf("Failed to insert topic with whitespace prompt: %v", err)
	}

	// Verify the prompt is whitespace-only
	var originalPrompt string
	err = store.db.QueryRow("SELECT prompt FROM topics WHERE id = 'ws-topic-id'").Scan(&originalPrompt)
	if err != nil {
		t.Fatalf("Failed to query topic: %v", err)
	}
	if originalPrompt != whitespacePrompt {
		t.Fatalf("Expected prompt '%s', got '%s'", whitespacePrompt, originalPrompt)
	}

	// Try to update just the name, preserving the whitespace-only prompt
	// This should work in the fixed code
	updatedTopic, err := store.UpdateTopic("ws-topic-id", "NewName", originalPrompt, nil, 0)
	if err != nil {
		t.Fatalf("UpdateTopic failed: %v - this indicates the bug where name-only updates are rejected when prompt is whitespace-only", err)
	}

	// Verify the name was updated
	if updatedTopic.Name != "NewName" {
		t.Errorf("Expected name 'NewName', got '%s'", updatedTopic.Name)
	}

	// Verify the prompt was preserved (including whitespace)
	if updatedTopic.Prompt != originalPrompt {
		t.Errorf("Prompt was modified: expected '%s', got '%s'", originalPrompt, updatedTopic.Prompt)
	}
}

func TestGetDescendantTopicIDs(t *testing.T) {
	store := newTestSQLiteStorageForMove(t)

	// Create tree:
	// A
	//  - B
	//    - D
	//    - E
	//  - C
	// F

	a := mustCreateRootTopic(t, store, "A")
	f := mustCreateRootTopic(t, store, "F")

	b, _ := store.CreateTopic("B", "prompt B", &a.ID, 0)
	c, _ := store.CreateTopic("C", "prompt C", &a.ID, 1)

	d, _ := store.CreateTopic("D", "prompt D", &b.ID, 0)
	e, _ := store.CreateTopic("E", "prompt E", &b.ID, 1)

	// Test a topic with no children
	fDescendants, err := store.GetDescendantTopicIDs(f.ID)
	if err != nil {
		t.Fatalf("GetDescendantTopicIDs for F failed: %v", err)
	}
	if len(fDescendants) != 0 {
		t.Fatalf("Expected 0 descendants for F, got %d", len(fDescendants))
	}

	// Test a topic with direct children
	bDescendants, err := store.GetDescendantTopicIDs(b.ID)
	if err != nil {
		t.Fatalf("GetDescendantTopicIDs for B failed: %v", err)
	}
	if len(bDescendants) != 2 {
		t.Fatalf("Expected 2 descendants for B, got %d", len(bDescendants))
	}

	// Create a map to check existence
	bMap := make(map[string]bool)
	for _, id := range bDescendants {
		bMap[id] = true
	}
	if !bMap[d.ID] || !bMap[e.ID] {
		t.Fatalf("Expected descendants D and E for B")
	}

	// Test a topic with nested children
	aDescendants, err := store.GetDescendantTopicIDs(a.ID)
	if err != nil {
		t.Fatalf("GetDescendantTopicIDs for A failed: %v", err)
	}
	if len(aDescendants) != 4 {
		t.Fatalf("Expected 4 descendants for A, got %d", len(aDescendants))
	}

	aMap := make(map[string]bool)
	for _, id := range aDescendants {
		aMap[id] = true
	}
	if !aMap[b.ID] || !aMap[c.ID] || !aMap[d.ID] || !aMap[e.ID] {
		t.Fatalf("Expected descendants B, C, D, E for A")
	}

	// Cycle detection is inherently handled by the tree structure enforcement in CreateTopic/MoveTopic,
	// but GetDescendantTopicIDs has built-in infinite loop prevention as well.
}

func TestGetExercisesForTopics(t *testing.T) {
	store := newTestSQLiteStorageForMove(t)

	// Create topics
	topic1 := mustCreateRootTopic(t, store, "Topic1")
	topic2 := mustCreateRootTopic(t, store, "Topic2")
	topic3 := mustCreateRootTopic(t, store, "Topic3")

	// Create exercises for them
	ex1_1, err := store.CreateExercise(topic1.ID, "hash1", "json1", "")
	if err != nil { t.Fatalf("failed to create exercise 1 for topic 1: %v", err) }

	ex1_2, err := store.CreateExercise(topic1.ID, "hash1", "json2", "")
	if err != nil { t.Fatalf("failed to create exercise 2 for topic 1: %v", err) }

	ex2_1, err := store.CreateExercise(topic2.ID, "hash2", "json3", "")
	if err != nil { t.Fatalf("failed to create exercise 1 for topic 2: %v", err) }

	// No exercises for topic3

	// Test single topic ID
	exercises, err := store.GetExercisesForTopics([]string{topic1.ID}, "")
	if err != nil {
		t.Fatalf("GetExercisesForTopics failed for single topic: %v", err)
	}
	if len(exercises) != 2 {
		t.Fatalf("Expected 2 exercises, got %d", len(exercises))
	}

	// Check promptHash filtering on single topic
	exercises, err = store.GetExercisesForTopics([]string{topic1.ID}, "hash1")
	if err != nil {
		t.Fatalf("GetExercisesForTopics failed with hash: %v", err)
	}
	if len(exercises) != 2 {
		t.Fatalf("Expected 2 exercises with matching hash, got %d", len(exercises))
	}

	// Filter out all with wrong hash
	exercises, err = store.GetExercisesForTopics([]string{topic1.ID}, "wrong_hash")
	if err != nil {
		t.Fatalf("GetExercisesForTopics failed with wrong hash: %v", err)
	}
	if len(exercises) != 0 {
		t.Fatalf("Expected 0 exercises with wrong hash, got %d", len(exercises))
	}

	// Test multiple topic IDs
	exercises, err = store.GetExercisesForTopics([]string{topic1.ID, topic2.ID}, "")
	if err != nil {
		t.Fatalf("GetExercisesForTopics failed for multiple topics: %v", err)
	}
	if len(exercises) != 3 {
		t.Fatalf("Expected 3 exercises for multiple topics, got %d", len(exercises))
	}

	// Create a map to verify exercises
	exMap := make(map[string]bool)
	for _, ex := range exercises {
		exMap[ex.ID] = true
	}
	if !exMap[ex1_1.ID] || !exMap[ex1_2.ID] || !exMap[ex2_1.ID] {
		t.Fatalf("Expected exercises ex1_1, ex1_2, ex2_1 not all found in result")
	}

	// Test with multiple topic IDs and empty list
	exercises, err = store.GetExercisesForTopics([]string{}, "")
	if err != nil {
		t.Fatalf("GetExercisesForTopics failed for empty slice: %v", err)
	}
	if len(exercises) != 0 {
		t.Fatalf("Expected 0 exercises for empty topic IDs slice, got %d", len(exercises))
	}

	// Include topic with no exercises
	exercises, err = store.GetExercisesForTopics([]string{topic1.ID, topic3.ID}, "")
	if err != nil {
		t.Fatalf("GetExercisesForTopics failed with empty topic: %v", err)
	}
	if len(exercises) != 2 {
		t.Fatalf("Expected 2 exercises from topic1, got %d", len(exercises))
	}
}
