package storage

import (
	"os"
	"testing"
)

func TestExercises_GetExercisesForTopics(t *testing.T) {
	dbPath := t.TempDir() + "/test_exercises_topics_db.sqlite"
	defer os.Remove(dbPath)

	store, err := NewSQLiteStorage(dbPath)
	if err != nil {
		t.Fatalf("Failed to create storage: %v", err)
	}
	defer store.db.Close()
	store.db.Exec("DELETE FROM exercises")
	store.db.Exec("DELETE FROM topics")

	// Create topics
	t1, _ := store.CreateTopic("T1", "prompt1", nil, 0)
	t2, _ := store.CreateTopic("T2", "prompt2", nil, 0)
	t3, _ := store.CreateTopic("T3", "prompt3", nil, 0)

	// Create exercises
	ex1, _ := store.CreateExercise(t1.ID, "hash1", `{}`, "")
	ex2, _ := store.CreateExercise(t2.ID, "hash2", `{}`, "")
	ex3, _ := store.CreateExercise(t2.ID, "hash3", `{}`, "")
	ex4, _ := store.CreateExercise(t3.ID, "hash4", `{}`, "")

	// Test: Returns exercises for requested topics, no extras
	results, err := store.GetExercisesForTopics([]string{t1.ID, t2.ID}, "")
	if err != nil {
		t.Fatalf("Failed to get exercises: %v", err)
	}
	if len(results) != 3 {
		t.Errorf("Expected 3 exercises, got %d", len(results))
	}

	foundEx1, foundEx2, foundEx3, foundEx4 := false, false, false, false
	for _, res := range results {
		if res.ID == ex1.ID { foundEx1 = true }
		if res.ID == ex2.ID { foundEx2 = true }
		if res.ID == ex3.ID { foundEx3 = true }
		if res.ID == ex4.ID { foundEx4 = true }
	}

	if !foundEx1 || !foundEx2 || !foundEx3 {
		t.Errorf("Expected to find ex1, ex2, ex3. found: %v, %v, %v", foundEx1, foundEx2, foundEx3)
	}
	if foundEx4 {
		t.Errorf("Did not expect to find ex4")
	}

	// Test: Empty topic list returns empty
	emptyResults, err := store.GetExercisesForTopics([]string{}, "")
	if err != nil {
		t.Fatalf("Failed to get exercises: %v", err)
	}
	if len(emptyResults) != 0 {
		t.Errorf("Expected 0 exercises for empty topic list, got %d", len(emptyResults))
	}

	// Test: Prompt hash filter parameter narrows results
	hashResults, err := store.GetExercisesForTopics([]string{t2.ID}, "hash2")
	if err != nil {
		t.Fatalf("Failed to get exercises: %v", err)
	}
	if len(hashResults) != 1 || hashResults[0].ID != ex2.ID {
		t.Errorf("Expected exactly ex2 based on hash filter, got %d exercises", len(hashResults))
	}
}

func TestTopics_GetDescendantTopicIDs(t *testing.T) {
	dbPath := t.TempDir() + "/test_descendants_db.sqlite"
	defer os.Remove(dbPath)

	store, err := NewSQLiteStorage(dbPath)
	if err != nil {
		t.Fatalf("Failed to create storage: %v", err)
	}
	defer store.db.Close()
	store.db.Exec("DELETE FROM topics")

	// Create hierarchy:
	// A -> B -> D
	// A -> C
	// E (flat)

	a, _ := store.CreateTopic("A", "prompt", nil, 0)
	b, _ := store.CreateTopic("B", "prompt", &a.ID, 0)
	c, _ := store.CreateTopic("C", "prompt", &a.ID, 0)
	d, _ := store.CreateTopic("D", "prompt", &b.ID, 0)
	e, _ := store.CreateTopic("E", "prompt", nil, 0)

	// Test: Flat list (no children) returns empty
	eDesc, err := store.GetDescendantTopicIDs(e.ID)
	if err != nil {
		t.Fatalf("Failed to get descendants: %v", err)
	}
	if len(eDesc) != 0 {
		t.Errorf("Expected 0 descendants for E, got %d", len(eDesc))
	}

	// Test: Single-level children
	bDesc, err := store.GetDescendantTopicIDs(b.ID)
	if err != nil {
		t.Fatalf("Failed to get descendants: %v", err)
	}
	if len(bDesc) != 1 || bDesc[0] != d.ID {
		t.Errorf("Expected 1 descendant for B (D), got %v", bDesc)
	}

	// Test: Multi-level children
	aDesc, err := store.GetDescendantTopicIDs(a.ID)
	if err != nil {
		t.Fatalf("Failed to get descendants: %v", err)
	}
	// order is not strictly guaranteed because we query level by level
	if len(aDesc) != 3 {
		t.Errorf("Expected 3 descendants for A (B, C, D), got %d", len(aDesc))
	}
	foundB, foundC, foundD := false, false, false
	for _, id := range aDesc {
		if id == b.ID { foundB = true }
		if id == c.ID { foundC = true }
		if id == d.ID { foundD = true }
	}
	if !foundB || !foundC || !foundD {
		t.Errorf("Expected to find B, C, D in A's descendants. Got: %v", aDesc)
	}

	// Test: No parent_id does not recurse infinitely
	// handled implicitly since A and E have nil parent_id and tests completed.
}
