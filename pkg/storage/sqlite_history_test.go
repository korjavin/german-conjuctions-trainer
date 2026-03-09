package storage

import (
	"os"
	"testing"
	"time"
)

func TestGetUserExerciseHistory_Descendants(t *testing.T) {
	dbPath := "test_history_descendants_db.sqlite"
	defer os.Remove(dbPath)

	store, err := NewSQLiteStorage(dbPath)
	if err != nil {
		t.Fatalf("Failed to create storage: %v", err)
	}

	// Clean out default topics initialized by schema setup
	store.db.Exec("DELETE FROM topics")
	store.db.Exec("DELETE FROM exercises")
	store.db.Exec("DELETE FROM user_exercise_views")
	store.db.Exec("DELETE FROM users")

	// Create a user
	user, err := store.CreateUser("google-id-123")
	if err != nil {
		t.Fatalf("Failed to create user: %v", err)
	}

	// Create topic hierarchy
	// Parent
	//  |- Child1
	//  |   |- Grandchild1
	//  |- Child2
	// Independent
	parent, _ := store.CreateTopic("Parent", "prompt", nil, 0)
	child1, _ := store.CreateTopic("Child1", "prompt", &parent.ID, 0)
	grandchild1, _ := store.CreateTopic("Grandchild1", "prompt", &child1.ID, 0)
	child2, _ := store.CreateTopic("Child2", "prompt", &parent.ID, 1)
	independent, _ := store.CreateTopic("Independent", "prompt", nil, 1)

	// Create exercises for topics
	exParent, _ := store.CreateExercise(parent.ID, "hash", `{"correct_german_sentence": "Parent Ex", "english_hint": "Hint"}`, "")
	exChild1, _ := store.CreateExercise(child1.ID, "hash", `{"correct_german_sentence": "Child1 Ex", "english_hint": "Hint"}`, "")
	exGrandchild1, _ := store.CreateExercise(grandchild1.ID, "hash", `{"correct_german_sentence": "Grandchild1 Ex", "english_hint": "Hint"}`, "")
	exChild2, _ := store.CreateExercise(child2.ID, "hash", `{"correct_german_sentence": "Child2 Ex", "english_hint": "Hint"}`, "")
	exIndependent, _ := store.CreateExercise(independent.ID, "hash", `{"correct_german_sentence": "Independent Ex", "english_hint": "Hint"}`, "")

	now := time.Now().UTC()

	// Create user views for these exercises (simulating practice history)
	views := []*UserExerciseView{
		{UserID: user.ID, ExerciseID: exParent.ID, LastViewed: now.Add(-5 * time.Minute)},
		{UserID: user.ID, ExerciseID: exChild1.ID, LastViewed: now.Add(-4 * time.Minute)},
		{UserID: user.ID, ExerciseID: exGrandchild1.ID, LastViewed: now.Add(-3 * time.Minute)},
		{UserID: user.ID, ExerciseID: exChild2.ID, LastViewed: now.Add(-2 * time.Minute)},
		{UserID: user.ID, ExerciseID: exIndependent.ID, LastViewed: now.Add(-1 * time.Minute)},
	}

	err = store.UpdateUserExerciseViews(views)
	if err != nil {
		t.Fatalf("Failed to update views: %v", err)
	}

	// Test Case 1: Filter by leaf topic (Grandchild1)
	// Should only return exGrandchild1
	history, err := store.GetUserExerciseHistory(user.ID, grandchild1.ID)
	if err != nil {
		t.Fatalf("Error getting history for leaf topic: %v", err)
	}
	if len(history) != 1 || history[0].ExerciseID != exGrandchild1.ID {
		t.Errorf("Leaf topic filter failed. Expected 1 exercise (exGrandchild1), got %d", len(history))
	}

	// Test Case 2: Filter by parent topic with children (Child1)
	// Should return exChild1, exGrandchild1
	history, err = store.GetUserExerciseHistory(user.ID, child1.ID)
	if err != nil {
		t.Fatalf("Error getting history for intermediate parent topic: %v", err)
	}
	if len(history) != 2 {
		t.Errorf("Intermediate parent filter failed. Expected 2 exercises, got %d", len(history))
	} else {
		// Results should be ordered by last_viewed DESC
		// exGrandchild1 is more recent (-3m) than exChild1 (-4m)
		if history[0].ExerciseID != exGrandchild1.ID || history[1].ExerciseID != exChild1.ID {
			t.Errorf("Incorrect order or exercises for intermediate parent. Got %v", history)
		}
	}

	// Test Case 3: Filter by root parent topic
	// Should return exParent, exChild1, exGrandchild1, exChild2
	history, err = store.GetUserExerciseHistory(user.ID, parent.ID)
	if err != nil {
		t.Fatalf("Error getting history for root parent topic: %v", err)
	}
	if len(history) != 4 {
		t.Errorf("Root parent filter failed. Expected 4 exercises, got %d", len(history))
	}

	// Ensure independent is NOT in the results
	for _, item := range history {
		if item.ExerciseID == exIndependent.ID {
			t.Errorf("Root parent filter failed: independent exercise was included")
		}
	}

	// Test Case 4: Filter by independent topic with no descendants
	// Should only return exIndependent
	history, err = store.GetUserExerciseHistory(user.ID, independent.ID)
	if err != nil {
		t.Fatalf("Error getting history for independent topic: %v", err)
	}
	if len(history) != 1 || history[0].ExerciseID != exIndependent.ID {
		t.Errorf("Independent topic filter failed. Expected 1 exercise, got %d", len(history))
	}

	// Test Case 5: Get all history (no topic ID filter)
	// Should return all 5 exercises
	history, err = store.GetUserExerciseHistory(user.ID, "")
	if err != nil {
		t.Fatalf("Error getting full history: %v", err)
	}
	if len(history) != 5 {
		t.Errorf("All topics filter failed. Expected 5 exercises, got %d", len(history))
	}
}
