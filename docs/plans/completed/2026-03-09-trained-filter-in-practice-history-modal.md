---
# Add Trained (Strengthening) Filter to Practice History Modal

## Overview
Implement filter functionality for the "Trained (Strengthening)" summary box in the Practice History modal, making it behave identically to the existing "Ready to Practice" filter. This includes adding clickable behavior, filter state management, and visual active state styling.

## Context
- Files involved: `index.html`, `js/dom.js`, `js/state.js`, `js/history.js`, `js/main.js`, `style.css`
- Related patterns: Existing "Ready to Practice" filter implementation (green filter)
- Dependencies: None

## Development Approach
- **Testing approach**: Regular (code first, then tests)
- Complete each task fully before moving to the next
- Follow existing filter pattern (Ready to Practice and Favorites filters)
- **CRITICAL: every task MUST include new/updated tests**
- **CRITICAL: all tests must pass before starting next task**

## Implementation Steps

### Task 1: Add DOM element reference in js/dom.js

**Files:**
- Modify: `js/dom.js`

- [ ] Add `historyFilterTrained` element reference after line 104 (after `historyFilterFavorites`)
- [ ] Write unit tests for DOM element references in history module
- [ ] Run project test suite - must pass before task 2

### Task 2: Add filter state to js/state.js

**Files:**
- Modify: `js/state.js`

- [ ] Add `historyFilterTrained: false` property after line 189 (after `historyFilterFavorites`)
- [ ] Write tests to verify new filter state is initialized correctly
- [ ] Run project test suite - must pass before task 3

### Task 3: Update HTML to make Trained box clickable

**Files:**
- Modify: `index.html`

- [ ] Add `filter-clickable` class to the Trained summary box div (line 347)
- [ ] Add `id="history-filter-trained"` to the Trained summary box div (line 347)
- [ ] Write integration tests for history modal structure
- [ ] Run project test suite - must pass before task 4

### Task 4: Implement filter logic in js/history.js

**Files:**
- Modify: `js/history.js`

- [ ] Update `showExerciseHistory()` to reset `historyFilterTrained` when opening fresh history (around line 33)
- [ ] Update `getFilteredHistoryData()` to include trained filter logic (around line 74)
- [ ] Add condition: `if (state.historyFilterTrained) { matches = matches && !item.ready_to_repeat; }`
- [ ] Update `updateHistoryFilterUI()` to include trained filter active state styling (after line 209)
- [ ] Export `updateHistoryFilterUI` if not already exported
- [ ] Write unit tests for filter logic with trained exercises
- [ ] Run project test suite - must pass before task 5

### Task 5: Wire up click event in js/main.js

**Files:**
- Modify: `js/main.js`

- [ ] Add click event listener for `dom.historyFilterTrained` (around line 297, after favorites listener)
- [ ] Implement toggle logic: `state.historyFilterTrained = !state.historyFilterTrained`
- [ ] Reset page to 1 when toggling filter
- [ ] Call `updateHistoryFilterUI()` and `renderHistoryPage()`
- [ ] Update pagination logic for Next button to include trained filter (around line 309)
- [ ] Write integration tests for filter toggle behavior
- [ ] Run project test suite - must pass before task 6

### Task 6: Add CSS for trained filter active state

**Files:**
- Modify: `style.css`

- [ ] Add `.filter-active-yellow` CSS class after line 1710
- [ ] Background: light yellow gradient
- [ ] Border: yellow
- [ ] Text: dark yellow/amber
- [ ] Update `updateHistoryFilterUI()` to use this class when trained filter is active
- [ ] Write visual regression tests for filter states
- [ ] Run project test suite - must pass before task 7

### Task 7: Verify acceptance criteria

- [ ] manual test: Open Practice History modal, verify Trained box has pointer cursor on hover
- [ ] manual test: Click Trained box, verify active state styling appears
- [ ] manual test: Verify only trained (not ready to practice) exercises are shown when filter is active
- [ ] manual test: Toggle Trained filter off, verify all exercises are shown again
- [ ] manual test: Test combination of filters (Ready + Trained, Favorites + Trained)
- [ ] run full test suite (use project-specific command)
- [ ] run linter (use project-specific command)
- [ ] verify test coverage meets 80%+

### Task 8: Update documentation

- [ ] update README.md if user-facing changes
- [ ] update CLAUDE.md if internal patterns changed
- [ ] move this plan to `docs/plans/completed/`
