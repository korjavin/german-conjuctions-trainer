---
# Hierarchical Topic Exercise History

## Overview
Modify the Practice History modal to show exercises from all descendant topics when a parent topic is selected. Currently, selecting a parent topic only shows exercises directly under that topic, which is misleading when users have completed exercises in child topics.

## Context
- Files involved:
  - `pkg/storage/storage.go` - Add `GetDescendantTopicIDs` interface method
  - `pkg/storage/sqlite.go` - Implement descendant lookup and modify `GetUserExerciseHistory`
  - `pkg/storage/sqlite_test.go` - Add tests for descendant lookup
  - `internal/app/exercises.go` - No changes needed (handler already passes topicID to storage layer)
  - `js/history.js` - No changes needed (frontend already sends topicID parameter)

- Related patterns:
  - Topics use `parent_id` field for hierarchical structure
  - `GetUserExerciseHistory` currently filters by single `topic_id` with SQL WHERE clause
  - Testing pattern uses in-memory SQLite databases

- Dependencies: None (uses existing storage schema)

## Development Approach
- **Testing approach**: Regular (code first, then tests)
- Complete each task fully before moving to the next
- **CRITICAL: every task MUST include new/updated tests**
- **CRITICAL: all tests must pass before starting next task**

## Implementation Steps

### Task 1: Add GetDescendantTopicIDs to storage interface

**Files:**
- Modify: `pkg/storage/storage.go`

- [ ] Add `GetDescendantTopicIDs(topicID string) ([]string, error)` method to Storage interface after line 100
- [ ] Add inline documentation explaining the method returns all descendant topic IDs recursively
- [ ] Run `go build ./...` to verify interface compiles

### Task 2: Implement GetDescendantTopicIDs in SQLite storage

**Files:**
- Modify: `pkg/storage/sqlite.go`
- Modify: `pkg/storage/sqlite_test.go`

- [ ] Implement `GetDescendantTopicIDs` method that:
  - Queries all topics where `parent_id = ?` for the given topicID
  - Recursively collects descendant IDs
  - Returns a flat slice of all descendant topic IDs (not including the parent itself)
  - Returns empty slice if topic has no children
- [ ] Add unit tests in `sqlite_test.go`:
  - Topic with no children returns empty slice
  - Topic with direct children returns those IDs
  - Topic with nested children (grandchildren) returns all descendants
  - Test uses in-memory DB following existing test pattern
- [ ] Run `go test ./pkg/storage/...` - all tests must pass

### Task 3: Modify GetUserExerciseHistory to include descendant topics

**Files:**
- Modify: `pkg/storage/sqlite.go`
- Modify: `pkg/storage/sqlite_test.go`

- [ ] In `GetUserExerciseHistory`, modify the topic filter logic (around line 1068):
  - If `topicID != ""`, call `GetDescendantTopicIDs(topicID)` to get descendant IDs
  - Include the original `topicID` plus all descendant IDs in the filter
  - Update SQL to use `e.topic_id IN (...)` clause with multiple IDs
  - Handle case where `topicID` has no descendants (fall back to single ID)
- [ ] Add integration tests for `GetUserExerciseHistory`:
  - Test filtering by leaf topic returns only that topic's exercises
  - Test filtering by parent topic includes child topic exercises
  - Test filtering by parent topic includes nested child (grandchild) exercises
  - Test filtering by topic with no descendants works as before
  - Test exercises are properly sorted by last_viewed DESC across all topics
- [ ] Run `go test ./pkg/storage/...` - all tests must pass

### Task 4: Verify acceptance criteria

- [ ] manual test: Create topic hierarchy: Parent -> Child1, Child2 (with exercises in each)
- [ ] manual test: Complete exercises in Child1 and Child2
- [ ] manual test: Select Parent topic in main UI
- [ ] manual test: Click "view your progress" / open Practice History modal
- [ ] manual test: Verify history shows exercises from Parent, Child1, and Child2
- [ ] manual test: Verify total count reflects all exercises across hierarchy
- [ ] manual test: Select a leaf topic (Child1), verify only its exercises show
- [ ] manual test: Select "All Topics", verify exercises from all topics show
- [ ] run full test suite: `go test ./...` - all must pass
- [ ] run linter: `gofmt -l .` and `go vet ./...` - no issues
- [ ] verify test coverage: `go test -cover ./...` - aim for 80%+

### Task 5: Update documentation

- [ ] update README.md if user-facing changes needed (document hierarchical history behavior)
- [ ] update CLAUDE.md if internal patterns changed
- [ ] move this plan to `docs/plans/completed/`
