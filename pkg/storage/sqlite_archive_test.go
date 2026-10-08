package storage

import (
	"errors"
	"testing"
)

func TestArchiveTopic_MovesSubtreeAndRestoresToOrigin(t *testing.T) {
	store := newTestSQLiteStorageForMove(t)
	defer store.Close()

	root := mustCreateRootTopic(t, store, "Grammar")
	other := mustCreateRootTopic(t, store, "Vocabulary")
	branch, err := store.CreateTopic("Konjunktionen", "test prompt branch", &root.ID, 0)
	if err != nil {
		t.Fatal(err)
	}
	leaf, err := store.CreateTopic("weil", "test prompt leaf", &branch.ID, 0)
	if err != nil {
		t.Fatal(err)
	}
	ex, err := store.CreateExercise(leaf.ID, GetPromptHash(leaf.Prompt), `{"german":"x"}`, "audio.mp3")
	if err != nil {
		t.Fatal(err)
	}

	archived, err := store.ArchiveTopic(branch.ID)
	if err != nil {
		t.Fatalf("ArchiveTopic: %v", err)
	}
	if parentIDValue(archived.ParentID) != ArchiveTopicID {
		t.Fatalf("archived topic parent = %q, want %q", parentIDValue(archived.ParentID), ArchiveTopicID)
	}

	archive, err := store.GetTopic(ArchiveTopicID)
	if err != nil {
		t.Fatalf("archive root not created: %v", err)
	}
	if !archive.IsArchive || archive.ParentID != nil || archive.Name != "Archive" {
		t.Fatalf("unexpected archive root: %+v", archive)
	}

	// Subtree and exercises stay intact.
	gotLeaf, _ := store.GetTopic(leaf.ID)
	if parentIDValue(gotLeaf.ParentID) != branch.ID {
		t.Fatalf("leaf parent changed to %q", parentIDValue(gotLeaf.ParentID))
	}
	exercises, err := store.GetExercisesForTopic(leaf.ID, GetPromptHash(leaf.Prompt))
	if err != nil || len(exercises) != 1 || exercises[0].ID != ex.ID {
		t.Fatalf("exercises lost after archive: %v %v", exercises, err)
	}

	// The archive sorts last among root topics.
	all, _ := store.GetAllTopics()
	roots := orderedTopicIDs(all, "")
	if roots[len(roots)-1] != ArchiveTopicID {
		t.Fatalf("archive not last among roots: %v", roots)
	}
	if _, err := store.MoveTopic(other.ID, "", intPtr(len(roots))); err != nil {
		t.Fatal(err)
	}
	all, _ = store.GetAllTopics()
	roots = orderedTopicIDs(all, "")
	if roots[len(roots)-1] != ArchiveTopicID {
		t.Fatalf("archive not last after root reorder: %v", roots)
	}

	if _, err := store.ArchiveTopic(branch.ID); !errors.Is(err, ErrTopicArchiveState) {
		t.Fatalf("archiving twice: got %v, want ErrTopicArchiveState", err)
	}
	if _, err := store.ArchiveTopic(leaf.ID); !errors.Is(err, ErrTopicArchiveState) {
		t.Fatalf("archiving a descendant of an archived topic: got %v", err)
	}
	if _, err := store.ArchiveTopic(ArchiveTopicID); !errors.Is(err, ErrTopicArchiveState) {
		t.Fatalf("archiving the archive: got %v", err)
	}
	if _, err := store.MoveTopic(ArchiveTopicID, root.ID, nil); err == nil {
		t.Fatal("moving the archive under a topic should fail")
	}

	restored, err := store.UnarchiveTopic(branch.ID)
	if err != nil {
		t.Fatalf("UnarchiveTopic: %v", err)
	}
	if parentIDValue(restored.ParentID) != root.ID {
		t.Fatalf("restored parent = %q, want %q", parentIDValue(restored.ParentID), root.ID)
	}
	if _, err := store.UnarchiveTopic(branch.ID); !errors.Is(err, ErrTopicArchiveState) {
		t.Fatalf("unarchiving a live topic: got %v", err)
	}
}

func TestUnarchiveTopic_FallsBackToRoot(t *testing.T) {
	store := newTestSQLiteStorageForMove(t)
	defer store.Close()

	parent := mustCreateRootTopic(t, store, "Parent")
	child, _ := store.CreateTopic("Child", "test prompt child", &parent.ID, 0)

	if _, err := store.ArchiveTopic(child.ID); err != nil {
		t.Fatal(err)
	}
	// The original parent gets archived too: restoring the child must not
	// land it back inside the archive.
	if _, err := store.ArchiveTopic(parent.ID); err != nil {
		t.Fatal(err)
	}
	restored, err := store.UnarchiveTopic(child.ID)
	if err != nil {
		t.Fatal(err)
	}
	if restored.ParentID != nil {
		t.Fatalf("restored parent = %q, want root", parentIDValue(restored.ParentID))
	}
}

func TestArchiveTopic_NameConflicts(t *testing.T) {
	store := newTestSQLiteStorageForMove(t)
	defer store.Close()

	// A user topic already named "Archive" must not block the archive root.
	userArchive := mustCreateRootTopic(t, store, "Archive")
	a := mustCreateRootTopic(t, store, "A")
	b := mustCreateRootTopic(t, store, "B")
	a1, _ := store.CreateTopic("Same", "test prompt a1", &a.ID, 0)
	b1, _ := store.CreateTopic("Same", "test prompt b1", &b.ID, 0)

	if _, err := store.ArchiveTopic(a1.ID); err != nil {
		t.Fatal(err)
	}
	archive, _ := store.GetTopic(ArchiveTopicID)
	if archive.Name == userArchive.Name {
		t.Fatalf("archive root reused the user's topic name %q", archive.Name)
	}

	if _, err := store.ArchiveTopic(b1.ID); !errors.Is(err, ErrTopicNameConflict) {
		t.Fatalf("archiving a same-named sibling: got %v, want ErrTopicNameConflict", err)
	}
	got, _ := store.GetTopic(b1.ID)
	if parentIDValue(got.ParentID) != b.ID {
		t.Fatalf("failed archive must leave the topic in place, parent = %q", parentIDValue(got.ParentID))
	}
}

func intPtr(v int) *int { return &v }
