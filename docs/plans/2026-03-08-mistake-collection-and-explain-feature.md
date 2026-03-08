---
# Mistake Collection and Explain Feature

## Overview
Add ability to collect user mistakes during exercises and provide AI-powered explanations. When users complete an exercise with mistakes, an "Explain" button appears that calls the backend /api/explain endpoint. The explanation is displayed under the sentence block (not in a modal), providing feedback on the user's mistakes and relevant grammar rules.

## Context
- Files involved:
  - Frontend: `js/exercise.js`, `js/state.js`, `js/api.js`, `js/dom.js`, `index.html`
  - Backend: `internal/app/app.go`, `internal/app/exercises.go`
  - LLM: `pkg/llm/openai.go`, `pkg/llm/prompt_builder.go`
  - Tests: `js/exercise-test.js` (new)
  - Styles: `style.css`
- Related patterns: Existing LLM integration in `pkg/llm/openai.go`, exercise completion flow in `js/exercise.js`
- Dependencies: Uses existing OPENAI_API_KEY environment variable

## Development Approach
- **Testing approach**: Regular (code first, then tests)
- Complete each task fully before moving to the next
- **CRITICAL: every task MUST include new/updated tests**
- **CRITICAL: all tests must pass before starting next task**

## Implementation Steps

### Task 1: Extend state to track detailed mistakes

**Files:**
- Modify: `js/state.js`

- [ ] Add `exerciseMistakes` object to state - maps exercise index to Set of unique wrong words clicked
- [ ] Add `explanationText` string to state - stores current explanation from AI
- [ ] Add `isExplaining` boolean to state - tracks if explanation request is in progress
- [ ] Add `explainButtonShown` Set to state - tracks which exercises have explain button visible
- [ ] Write unit tests for new state properties in a new `js/state-test.js` file

### Task 2: Track mistakes during exercise completion

**Files:**
- Modify: `js/exercise.js`
- Modify: `js/state.js`

- [ ] In `handleWordClick()`, when incorrect word is clicked, add to `state.exerciseMistakes[state.currentExerciseIndex]` Set
- [ ] Ensure only unique words are tracked (deduplicated)
- [ ] Write unit tests in `js/exercise-test.js` to verify mistake tracking works correctly

### Task 3: Create Explain button API function

**Files:**
- Modify: `js/api.js`

- [ ] Add `fetchExplainAPI(exerciseId, correctSentence, mistakes, topic)` function
- [ ] Function should POST to `/api/explain` with topic, correct_sentence, and mistakes array
- [ ] Return the explanation text from the response
- [ ] Handle errors appropriately (retryable status codes, timeout, etc.)
- [ ] Write unit tests in `js/api-test.js` (new file) for the new API function

### Task 4: Build LLM explanation prompt and function

**Files:**
- Modify: `pkg/llm/prompt_builder.go`
- Modify: `pkg/llm/openai.go`

- [ ] Add `BuildExplanationPrompt(topic, correctSentence, mistakes []string)` function in prompt_builder.go
- [ ] Prompt should ask AI to explain grammar rules relevant to the mistakes
- [ ] Prompt should be concise and focused on learning
- [ ] Add `GenerateExplanation(apiKey, openaiURL, modelName, topic, correctSentence, mistakes)` function in openai.go
- [ ] Function should use existing `callChatCompletions` infrastructure
- [ ] Write Go unit tests for `BuildExplanationPrompt` in `pkg/llm/prompt_builder_test.go`

### Task 5: Create backend /api/explain endpoint

**Files:**
- Modify: `internal/app/exercises.go`
- Modify: `internal/app/app.go`

- [ ] Add `handleExplain(w http.ResponseWriter, r *http.Request)` handler in exercises.go
- [ ] Handler should accept POST with JSON body containing topic, correct_sentence, and mistakes
- [ ] Handler should call `GenerateExplanation` LLM function
- [ ] Return JSON response with explanation text
- [ ] Handle errors appropriately (timeout, API failures)
- [ ] Register `/api/explain` route in `app.go`
- [ ] Write Go integration tests for the endpoint in `internal/app/exercises_test.go`

### Task 6: Add Explain button and explanation display UI

**Files:**
- Modify: `index.html`
- Modify: `js/dom.js`
- Modify: `style.css`

- [ ] Add "Explain" button to exercise controls section in HTML (initially hidden)
- [ ] Add explanation container div under the exercise feedback area in HTML
- [ ] Add DOM references for explain button and explanation container in `js/dom.js`
- [ ] Add CSS styles for the explain button (distinct styling) and explanation container (visually distinct, not modal-like)
- [ ] Write CSS tests to verify styles are properly defined

### Task 7: Implement Explain button click handler

**Files:**
- Modify: `js/exercise.js`
- Modify: `js/api.js`

- [ ] Export `handleExplainClick()` function in exercise.js
- [ ] Function should get current exercise data (topic, correct sentence, mistakes)
- [ ] Call `fetchExplainAPI()` with the data
- [ ] Set loading state on button while waiting
- [ ] On success, display explanation in explanation container
- [ ] On error, show error message to user
- [ ] Only show Explain button if exercise has mistakes (wrong words tracked)
- [ ] Write unit tests in `js/exercise-test.js` for the explain click handler

### Task 8: Wire up Explain button in main.js

**Files:**
- Modify: `js/main.js`

- [ ] Add event listener for Explain button
- [ ] Call `handleExplainClick()` when clicked
- [ ] Ensure button is properly enabled/disabled based on explanation availability

### Task 9: Verify acceptance criteria

- [ ] manual test: Complete an exercise with mistakes, verify Explain button appears and works
- [ ] manual test: Complete an exercise without mistakes, verify Explain button does NOT appear
- [ ] manual test: Click Explain, verify explanation appears under sentence block (not modal)
- [ ] manual test: Verify explanation is relevant to mistakes made
- [ ] run frontend test suite (Jest or equivalent)
- [ ] run backend test suite (`go test ./...`)
- [ ] verify test coverage meets 80%+ (use `go test -cover` for Go)
- [ ] test multiple exercises in a session with different mistake patterns

### Task 10: Update documentation

- [ ] update README.md if user-facing changes
- [ ] update CLAUDE.md if internal patterns changed
- [ ] move this plan to `docs/plans/completed/`
