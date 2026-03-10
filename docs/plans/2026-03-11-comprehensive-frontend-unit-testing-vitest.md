---
# Comprehensive Frontend Unit Testing Suite with Vitest

## Overview
Add automated unit tests for the vanilla JS frontend using vitest. The frontend uses ES modules with heavy DOM dependencies (dom.js calls getElementById at import time) and localStorage. Tests will use happy-dom environment with strategic mocking of dom.js and fetch/localStorage.

## Context
- Files involved: js/api.js, js/audio.js, js/state.js, js/exercise.js, js/session.js, js/history.js, js/topics.js
- Existing "tests" in js/ are manual browser-console scripts, not automated
- The main challenge: dom.js calls document.getElementById at module load, requiring DOM mocking strategy
- Package manager: pnpm

## Development Approach
- Regular (write tests, verify they pass)
- Each task adds tests for one module group
- All tests must pass before moving to next task
- **CRITICAL: every task MUST include new/updated tests**
- **CRITICAL: all tests must pass before starting next task**

## Implementation Steps

### Task 1: Install vitest and create config

**Files:**
- Create: `vitest.config.js`
- Create: `js/__tests__/setup.js`
- Modify: `package.json` (add scripts + devDependencies)

- [ ] Run `pnpm add -D vitest @vitest/coverage-v8 happy-dom` to install dependencies
- [ ] Create `vitest.config.js` with happy-dom environment, coverage config, and setup file path
- [ ] Create `js/__tests__/setup.js` that globally mocks `fetch`, `localStorage`, and provides a `vi.mock` factory for dom.js with jest-like mock element stubs
- [ ] Add `"test": "vitest"` and `"test:coverage": "vitest run --coverage"` to package.json scripts
- [ ] Run `pnpm test` - must pass (0 tests, no errors) before task 2

### Task 2: Tests for api.js

**Files:**
- Create: `js/__tests__/api.test.js`

- [ ] Mock global `fetch` using `vi.fn()` in beforeEach
- [ ] Test `apiFetch` error parsing: JSON error with message/code/retryable, plain text error, non-ok status
- [ ] Test `fetchTopicsAPI`: success returns json, non-ok throws with error text
- [ ] Test `fetchExercisesFromAPI`: success, error status propagation
- [ ] Test `moveTopicAPI`: negative position throws, valid payload sent correctly
- [ ] Test `fetchExplainAPI`: success, non-ok throws
- [ ] Test `loadExerciseHistoryAPI`: appends topic_id query param when provided
- [ ] Run `pnpm test` - all tests pass before task 3

### Task 3: Tests for audio.js and state.js

**Files:**
- Create: `js/__tests__/audio.test.js`
- Create: `js/__tests__/state.test.js`

- [ ] Mock `dom.js` via `vi.mock('../dom.js', ...)` returning plain objects
- [ ] Test `isPunctuation`: punctuation tokens, word tokens, edge cases (unicode letters, numbers)
- [ ] Test `normalizeWordForCache` behavior through cache functions
- [ ] Test word audio cache: set entry, get entry with timestamp update, eviction of oldest when over MAX_WORD_AUDIO_CACHE_ENTRIES
- [ ] For state.js: mock localStorage in beforeEach, test `_loadAudioEnabled` defaults, persistence
- [ ] Test `addRecentlyUsedTopic`: deduplication, ordering, 10-item limit
- [ ] Test `removeRecentlyUsedTopic`: removes correct item
- [ ] Test `toggleTopicCollapse`: adds/removes from collapsedTopicIds, updates manual tracking sets
- [ ] Test `isTopicCollapsed`: returns correct boolean
- [ ] Test `_loadTopicCollapseState`: sanitizes non-strings, handles malformed JSON
- [ ] Test `_loadRecentlyUsedTopics`: validates object shape, limits to 10
- [ ] Run `pnpm test` - all tests pass before task 4

### Task 4: Tests for exercise.js

**Files:**
- Create: `js/__tests__/exercise.test.js`

- [ ] Mock `dom.js`, `state.js`, `audio.js`, `api.js` modules
- [ ] Test `getHotkey`: indices 0-8 return '1'-'9', index 9 returns 'a', index 35 returns 'z'
- [ ] Test `addPunctuationIfNeeded`: auto-prepends leading punctuation from correct sentence, stops at first word
- [ ] Test `checkAnswer`: correct answer → locked state, no mistakes; wrong word click → mistake tracking, mistake set updated
- [ ] Test `handleHintRequest`: marks exercise in hintsUsed set, reveals first word
- [ ] Test `updateFavoriteButtonState`: sets correct text/class on dom mock
- [ ] Test word tokenization from correct_german_sentence (the regex tokenizer used in renderExercise)
- [ ] Run `pnpm test` - all tests pass before task 5

### Task 5: Tests for session.js and history.js

**Files:**
- Create: `js/__tests__/session.test.js`
- Create: `js/__tests__/history.test.js`

- [ ] Mock `api.js`, `dom.js`, `state.js` for session tests
- [ ] Test `fetchExercises`: maps API response to state.exercises correctly (id, audio_file_path, is_favorite)
- [ ] Test `fetchExercises`: handles empty exercises array (shows empty state)
- [ ] Test `fetchExercises`: error handling for 429, 504/UPSTREAM_TIMEOUT, generic errors
- [ ] Test session completion: `completeSession` saves performance data via API
- [ ] For history.js: mock `api.js`, `dom.js`, `state.js`
- [ ] Test `showExerciseHistory`: calls loadExerciseHistoryAPI with correct topicId
- [ ] Test history statistics calculation: readyCount, trainedCount, successRate math
- [ ] Test history filtering: filterReady, filterFavorites, filterTrained combinations
- [ ] Test pagination: prev/next page updates historyPage, renderHistoryPage called
- [ ] Run `pnpm test` - all tests pass before task 6

### Task 6: Verify acceptance criteria

- [ ] Run `pnpm test:coverage` and review coverage report
- [ ] Verify coverage for api.js, audio.js, state.js reaches 80%+
- [ ] Run `pnpm test` - all tests pass with no warnings
- [ ] Manually verify `pnpm test --watch` works for development workflow

### Task 7: Update documentation

- [ ] Update README.md with testing section (how to run tests, coverage)
- [ ] Move this plan to `docs/plans/completed/`
---
