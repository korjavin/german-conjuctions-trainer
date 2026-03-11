---
# Comprehensive Unit Tests for Exercise Topic Selection & Generation

## Overview
Add comprehensive unit tests covering the full pipeline of exercise
selection for a topic: topic-to-exercise mapping (including
hierarchical topics), prompt hash filtering, SRS eligibility logic,
and prompt construction. The exploration revealed a likely bug:
`topicHashFilters` only stores the requested topic's hash, not
descendant topics' hashes — so descendant exercises get filtered out
entirely, triggering auto-generation with a wrong/parent prompt.

## Context
- Files involved:
  - `internal/app/srs.go` — SRS eligibility logic (no tests exist)
  - `internal/app/exercises.go` — Hash filtering, descendant selection, auto-generation (no tests exist)
  - `pkg/llm/prompt_builder.go` — Prompt construction (some tests in openai_test.go)
  - `pkg/llm/quality_gate.go` — Quality validation (3 tests in quality_gate_test.go)
  - `pkg/storage/sqlite.go` — GetExercisesForTopics, GetDescendantTopicIDs (sparse tests)
  - New test files to create in `internal/app/` and `pkg/storage/`
- Related patterns:
  - Existing tests use table-driven style with subtests
  - Storage tests in pkg/storage/ use in-memory SQLite
  - App handler tests use mock storage via interface
  - See `internal/app/topics_comprehensive_test.go` for mock pattern
- Dependencies: none new

## Development Approach
- **Testing approach**: TDD — write failing tests first that expose bugs, then fix the bugs as a side effect
- Complete each task fully before moving to the next
- **CRITICAL: every task MUST include new/updated tests**
- **CRITICAL: all tests must pass before starting next task**

## Implementation Steps

### Task 1: Unit tests for SRS eligibility logic

**Files:**
- Create: `internal/app/srs_test.go`

- [ ] Test that never-seen exercises get overdueAmount = 1000.0 (highest priority)
- [ ] Test overdue calculation: exercise due yesterday is eligible, due tomorrow is not
- [ ] Test that hidden exercises are excluded from results
- [ ] Test that favorites break ties among equally-overdue exercises
- [ ] Test that result is capped at 10 exercises
- [ ] Test with empty exercise list returns empty slice
- [ ] Test sorting: most overdue appears first in result
- [ ] run `go test ./internal/app/... -run TestSRS` — must pass

### Task 2: Unit tests for exercise hash filtering and topic descent

**Files:**
- Create: `internal/app/exercises_selection_test.go`

Focus on the in-memory filtering logic in `handleExercises`. Use a
mock storage implementation (define a minimal `mockStorage` struct
implementing `storage.Storage` interface). Tests should expose the
hash-filter bug for descendant topics.

- [ ] Test: single topic — exercises with matching prompt hash are included, stale ones excluded
- [ ] Test: descendant topics — exercises for each descendant use THAT descendant's prompt hash (not the parent's), expect exercises from descendant subtopics to be included correctly
- [ ] Test: exercises from unrelated topics not in the descendant tree are excluded
- [ ] Test: if no eligible exercises exist, auto-generation is triggered with the correct subtopic (not parent topic)
- [ ] Test: guest user path returns random exercises from the filtered set only
- [ ] Fix the hash-filter bug found: build `topicHashFilters` for all topics in `topicIDs`, not just `req.TopicID`
- [ ] run `go test ./internal/app/... -run TestExercise` — must pass

### Task 3: Storage-level tests for multi-topic query and descendant retrieval

**Files:**
- Modify: `pkg/storage/sqlite_test.go` or create `pkg/storage/sqlite_exercises_test.go`

Use in-memory SQLite (`:memory:`) matching the pattern in existing storage tests.

- [ ] Test GetExercisesForTopics: returns exercises for all requested topic IDs, no extras
- [ ] Test GetExercisesForTopics: empty topic list returns empty result
- [ ] Test GetExercisesForTopics: prompt_hash filter parameter narrows results correctly (if used)
- [ ] Test GetDescendantTopicIDs: flat list (no children) returns empty
- [ ] Test GetDescendantTopicIDs: single-level children returned correctly
- [ ] Test GetDescendantTopicIDs: multi-level (grandchildren) returned recursively
- [ ] Test GetDescendantTopicIDs: topic with no parent_id does not recurse infinitely
- [ ] run `go test ./pkg/storage/...` — must pass

### Task 4: Prompt builder tests — verify topic prompt appears in generation prompt

**Files:**
- Modify: `pkg/llm/prompt_builder_test.go` (if exists) or create it

- [ ] Test BuildGenerationPrompt includes the full topic prompt text verbatim
- [ ] Test BuildGenerationPrompt with empty variation profile does not crash
- [ ] Test that a subtopic's prompt (not parent prompt) is used when building prompt for a subtopic
- [ ] Test BuildCorrectivePrompt references the original topic prompt, not a generic fallback
- [ ] run `go test ./pkg/llm/... -run TestBuild` — must pass

### Task 5: End-to-end exercise selection integration test

**Files:**
- Create: `internal/app/exercises_integration_test.go`

Use in-memory SQLite storage (not a mock) to test the full path from
topic setup through selection without LLM calls.

- [ ] Seed: two topics (parent + child subtopic), each with distinct prompts and pre-seeded exercises matching current prompt hashes
- [ ] Test: requesting exercises for parent topic returns exercises from both parent and child subtopic
- [ ] Test: requesting exercises for child subtopic returns only child's exercises, not parent's
- [ ] Test: changing a topic's prompt (updating it) causes old exercises to be filtered out
- [ ] Test: authenticated user with no prior history gets exercises sorted by SRS (never-seen priority)
- [ ] run `go test ./internal/app/... -run TestExerciseIntegration` — must pass

### Task 6: Verify acceptance criteria

- [ ] run `go test ./...` — full test suite must pass
- [ ] run `go vet ./...` — no vet errors
- [ ] verify tests cover the hash-filtering and descendant-selection paths
- [ ] manual check: practice a topic with subtopics and confirm returned exercises are all relevant

### Task 7: Update documentation

- [ ] update CLAUDE.md if testing patterns for app handlers are new
- [ ] move this plan to `docs/plans/completed/`
