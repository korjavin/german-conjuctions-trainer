---
# Improve Practice History Filter Visual Distinction and Add Counts

## Overview
Two improvements to the Practice History filters: (1) make active filter state visually distinct with stronger styling, (2) add a count to the Favorites filter button so users can see how many favorites they have.

## Context
- Files involved:
  - `js/history.js` - filter state logic, `updateHistoryFilterUI()`, `showExerciseHistory()`
  - `index.html` - Favorites button HTML (add count span)
  - `style.css` - `filter-active-green`, `filter-active-yellow`, `btn-filter` CSS
  - `js/__tests__/history.test.js` - existing tests to update
- Related patterns: summary boxes already show counts; filter-active classes already used
- Notes: Summary boxes (Ready, Trained) already show counts prominently as large numbers. Only the Favorites button is missing a count.

## Development Approach
- **Testing approach**: Regular (code first, then tests)
- Complete each task fully before moving to the next
- **CRITICAL: every task MUST include new/updated tests**
- **CRITICAL: all tests must pass before starting next task**

## Implementation Steps

### Task 1: Improve active filter visual distinction

**Files:**
- Modify: `style.css`
- Modify: `js/history.js` (updateHistoryFilterUI - may add/change classes)

- [ ] Strengthen `filter-active-green` CSS: add a solid colored top-border or left-border accent, stronger background tint, and a small checkmark indicator via `::after` pseudo-element
- [ ] Strengthen `filter-active-yellow` CSS: same treatment - solid border accent and stronger background
- [ ] Ensure the Favorites `btn-filter` active state also has a clear selected look (add a distinct `filter-active` class or update existing `filter-active-yellow` for buttons)
- [ ] Add a visual "selected" indicator (e.g. ✓ prepended to label or border-left accent) so unselected vs selected is immediately obvious
- [ ] Update tests in `js/__tests__/history.test.js` to verify new class names if any changed
- [ ] Run test suite: `pnpm test` - must pass before Task 2

### Task 2: Add favorites count to the Favorites filter button

**Files:**
- Modify: `index.html` - add a `<span id="history-filter-favorites-count">` inside the Favorites button
- Modify: `js/dom.js` - add `historyFilterFavoritesCount` DOM reference
- Modify: `js/history.js` - compute favorites count in `showExerciseHistory()` and set it; update `updateHistoryFilterUI()` if needed

- [ ] Add a count span inside the Favorites button in `index.html`, e.g. `<span id="history-filter-favorites-count" class="filter-count-badge"></span>`
- [ ] Add `.filter-count-badge` CSS styling in `style.css` (small rounded pill badge, styled to match the filter)
- [ ] Add `historyFilterFavoritesCount` to `dom.js`
- [ ] In `showExerciseHistory()` in `history.js`, calculate `favoritesCount` and set `dom.historyFilterFavoritesCount.textContent`
- [ ] Update tests: add test that verifies favorites count is displayed after data loads
- [ ] Run test suite: `pnpm test` - must pass before Task 3

### Task 3: Verify acceptance criteria

- [ ] Manual test: Open Practice History, verify Favorites button shows correct count (e.g. "Favorites (3)")
- [ ] Manual test: Click each filter (Ready to Practice, Trained, Favorites) and verify active state is clearly visually distinct from unselected
- [ ] Run full test suite: `pnpm test`
- [ ] Run linter if configured

### Task 4: Update documentation

- [ ] Update CLAUDE.md if internal patterns changed
- [ ] Move this plan to `docs/plans/completed/`
