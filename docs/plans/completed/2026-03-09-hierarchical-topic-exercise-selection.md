---
# Hierarchical Topic Exercise Selection

## Overview
Implement hierarchical topic exercise selection so that when a user selects a topic that has children in the tree, exercises are fetched from all descendant topics in the sub-tree. If there aren't enough 'ready' exercises according to SRS logic, generate new exercises from random topics within the sub-tree (including the selected topic).

## Context
- Files involved:
  - `pkg/storage/storage.go` - Add interface method for getting descendant topic IDs
  - `pkg/storage/sqlite.go` - Implement descendant topic lookup
  - `internal/app/exercises.go` - Modify exercise fetching to support sub-tree selection
  - `js/topics.js` - Add UI indicator for parent topics showing child count
  - `js/state.js` - No changes needed (currentTopicId remains a single ID)
  - `internal/app/srs.go` - No changes needed (SRS logic works on any exercise set)

- Related patterns:
  - Topics use `parent_id` field for hierarchical structure
  - Exercises are fetched via `GetExercisesForTopic(topicID, promptHash)`
  - SRS eligibility is calculated per-exercise regardless of topic
  - Frontend sends single `topic_id` to `/api/exercises` endpoint

- Dependencies: None (uses existing storage and LLM generation)

## Development Approach
- **Testing approach**: Regular (code first, then tests)
- Complete each task fully before moving to the next
- **CRITICAL: every task MUST include new/updated tests**
- **CRITICAL: all tests must pass before starting next task**

## Implementation Steps

### Task 1: Add storage method to get descendant topic IDs

**Files:**
- Modify: `pkg/storage/storage.go`
- Modify: `pkg/storage/sqlite.go`
- Create: `pkg/storage/sqlite_topics_test.go` (extend existing)

- [ ] Add `GetDescendantTopicIDs(topicID string) ([]string, error)` method to Storage interface in storage.go
- [ ] Implement recursive descendant lookup in sqlite.go that:
  - Gets all topics with the given topicID as parent
  - Recursively gets children of each child topic
  - Returns all descendant topic IDs as a flat slice
- [ ] Add unit tests for GetDescendantTopicIDs covering:
  - Topic with no children returns empty slice
  - Topic with direct children returns those IDs
  - Topic with nested children returns all descendants
  - Cycle detection (though schema prevents this)
- [ ] Run `go test ./pkg/storage/...` - all tests must pass

### Task 2: Modify exercises endpoint to support sub-tree selection

**Files:**
- Modify: `internal/app/exercises.go`
- Modify: `pkg/storage/storage.go`
- Modify: `pkg/storage/sqlite.go`

- [ ] Add `GetExercisesForTopics(topicIDs []string, promptHash string) ([]*Exercise, error)` method to Storage interface
- [ ] Implement GetExercisesForTopics in sqlite.go using SQL IN clause
- [ ] Modify handleExercises in exercises.go to:
  - Check if selected topic has descendants using new storage method
  - If yes, collect all descendant topic IDs
  - Use GetExercisesForTopics instead of GetExercisesForTopic
  - Log which topics are included in the exercise pool
- [ ] Add unit tests for GetExercisesForTopics with:
  - Single topic ID (backward compatibility)
  - Multiple topic IDs
  - Empty topic IDs slice
- [ ] Run `go test ./pkg/storage/...` - all tests must pass

### Task 3: Modify exercise generation to use random sub-tree topics

**Files:**
- Modify: `internal/app/exercises.go`
- Modify: `pkg/llm/generate.go` (verify this exists first)

- [ ] Check existing LLM generation code in `pkg/llm/` directory
- [ ] When generating new exercises due to insufficient eligible exercises:
  - Use the sub-tree topic IDs collected in Task 2
  - Randomly select topics from the sub-tree (weighted by existing exercise count would be nice, but random is fine)
  - Generate exercises for selected topics using their prompts
  - Cache all generated exercises
- [ ] Ensure generated exercises use the correct prompt_hash for each topic
- [ ] Add logging to show which topics exercises were generated from
- [ ] Run `go test ./...` - all tests must pass

### Task 4: Add UI indicator for parent topics

**Files:**
- Modify: `js/topics.js`

- [ ] Add helper function `countDescendantTopics(topicId, allTopics)` that recursively counts children
- [ ] In topic dropdown item rendering (around line 1930 where `createDropdownItem` is called):
  - Check if topic has descendants
  - If yes, add a badge showing count like "(5 sub-topics)"
  - Apply appropriate styling (small text, gray color, right-aligned)
- [ ] In main topic selection UI (if different from dropdown), add similar indicator
- [ ] Manually test: Select a parent topic in UI and verify badge appears
- [ ] Verify badge updates when topics are added/removed

### Task 5: Verify acceptance criteria

- [ ] Manual test: Create a topic with 3 child topics
- [ ] Manual test: Select parent topic and verify exercises come from all 4 topics (parent + 3 children)
- [ ] Manual test: Check logs show "Fetching exercises from X topics: [topic IDs]"
- [ ] Manual test: Practice multiple sessions, verify SRS correctly prioritizes overdue exercises from across sub-tree
- [ ] Manual test: Exercise generation uses topics from sub-tree when needed
- [ ] Manual test: UI badge shows correct child count
- [ ] Run full test suite: `go test ./...` - all must pass
- [ ] Run linter: `gofmt -l .` and `go vet ./...` - no issues
- [ ] Verify test coverage: `go test -cover ./...` - aim for 80%+

### Task 6: Update documentation

- [ ] Update README.md if user-facing changes needed (document hierarchical selection behavior)
- [ ] Update CLAUDE.md if internal patterns changed
- [ ] Move this plan to `docs/plans/completed/`
