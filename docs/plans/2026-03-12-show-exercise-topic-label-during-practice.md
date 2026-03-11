---
# Show Exercise Topic Label During Practice

## Overview
When a user trains in a parent topic and the current exercise comes from a child topic, display the child topic's name in a small, compact label on the left side of the Skip/Hint buttons row, under the "Click the words below to form the sentence" prompt. Only show when the exercise topic differs from the selected training topic.

Note: Subtree exercise selection (fetching exercises from descendant topics) is already implemented in exercises.go.

## Context
- Files involved:
  - `internal/app/exercises.go` — exercise API handler, response struct
  - `js/session.js` — maps API response to state.exercises
  - `js/exercise.js` — renderExercise(), show/hide UI elements
  - `js/state.js` — state.currentTopicId, state.topics
  - `js/dom.js` — DOM element references
  - `index.html` — HTML structure for scrambled-words-header row
  - `static/style.css` or inline styles — CSS for label
- Related patterns: existing hidden/show pattern via classList.add('hidden'), state.topics lookup by ID
- Dependencies: none

## Development Approach
- **Testing approach**: Regular (code first, then tests)
- Complete each task fully before moving to the next
- **CRITICAL: every task MUST include new/updated tests**
- **CRITICAL: all tests must pass before starting next task**

## Implementation Steps

### Task 1: Add topic_id to exercise API response

**Files:**
- Modify: `internal/app/exercises.go`

- [ ] Find the exercise response struct (or inline response building) in handleExercises
- [ ] Add `TopicID string` field to the per-exercise response JSON (json:"topic_id")
- [ ] Populate it from exercise.TopicID when building each exercise entry
- [ ] Verify with curl/manual test that /api/exercises response includes topic_id per exercise
- [ ] Write or update backend test for exercise response to assert topic_id is present
- [ ] Run `go test ./...` — must pass before task 2

### Task 2: Frontend — map topic_id and display label

**Files:**
- Modify: `js/session.js`
- Modify: `js/exercise.js`
- Modify: `js/dom.js`
- Modify: `index.html`
- Modify: CSS file (or add style tag) for label styling

- [ ] In session.js, add `topic_id: ex.topic_id` when mapping state.exercises entries
- [ ] In index.html, add a span element inside `#scrambled-words-header` before the Skip button: `<span id="exercise-topic-label" class="exercise-topic-label hidden"></span>`
- [ ] In dom.js, add reference: `exerciseTopicLabel: document.getElementById('exercise-topic-label')`
- [ ] In exercise.js renderExercise(), after setting up the exercise:
  - Get the exercise's topic_id
  - If it differs from state.currentTopicId, find the topic name in state.topics by ID
  - Set dom.exerciseTopicLabel.textContent to the topic name
  - Remove 'hidden' class
  - Otherwise, add 'hidden' class
- [ ] Add CSS: `.exercise-topic-label { font-size: 0.7rem; color: #888; flex: 1; }` and ensure `#scrambled-words-header` uses `display: flex; align-items: center;` (adjust if already set)
- [ ] Write or update frontend JS tests to verify renderExercise shows/hides the label correctly
- [ ] Run frontend tests — must pass before task 3

### Task 3: Verify acceptance criteria

- [ ] Manual test: start training on a parent topic that has child topics, verify the child topic name appears in small text on the left of the Skip/Hint row when the exercise is from a child
- [ ] Manual test: when exercise is from the selected topic itself, verify no label is shown
- [ ] Manual test: label is visually compact and doesn't disrupt button layout
- [ ] Run full test suite: `go test ./...`
- [ ] Run frontend tests

### Task 4: Update documentation

- [ ] No README changes needed (internal UI improvement)
- [ ] Move this plan to `docs/plans/completed/`
