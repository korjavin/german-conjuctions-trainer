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
