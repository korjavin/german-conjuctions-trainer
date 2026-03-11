---
# Improve Practice History Page UI

## Overview
Redesign the Practice History page to: (1) separate non-filter stats into a compact top-right block, (2) unify all filters into a consistent, smaller button bar with clear active states, (3) add sort options for "Ready in..." timing (sooner/later), error rate (most/least error-prone), and creation date (recently-created/oldest), and (4) place Favorites filter alongside other filters.

## Context
- Files involved:
  - `index.html` (lines 336-425) - history modal structure
  - `style.css` (lines 1009-1101, ~1711-1726) - summary box and filter styles
  - `js/history.js` - filter logic, rendering, stats calculation
  - `js/dom.js` (lines 92-110) - DOM references
  - `js/main.js` (lines 282-330) - event listeners
- Current state: 5 summary boxes in a grid (3 are clickable filters mixed with 2 pure stats), Favorites is a separate button below, no sort options
- Backend: no changes needed; `next_review_days`, `success_rate`/error data, and creation date already available

## Development Approach
- Frontend-only changes (HTML, CSS, JS)
- No test framework exists for the vanilla JS frontend, so no automated tests
- Complete each task fully before moving to the next

## Implementation Steps

### Task 1: Restructure HTML

**Files:**
- Modify: `index.html`

- [ ] Replace the 5-box summary grid with a compact stats block (top-right area of the modal header) showing: Total Practiced, Total Attempts, Success Rate — small text, not clickable
- [ ] Add a unified filter bar below the header with small toggle buttons: "Ready to Practice" | "Training" | "Favorites" — consistent pill/button style
- [ ] Add a sort control row with a labeled group of small toggle buttons for sort dimension and direction:
  - Dimension: "Sooner | Later" (by next_review_days), "Most errors | Fewest errors" (by error rate), "Newest | Oldest" (by creation date)
  - Design: one row of sort dimension buttons, each toggles its direction on repeated click (or a paired asc/desc button per dimension)
- [ ] Remove `filter-clickable` attribute/class from stats boxes; remove the standalone Favorites filter button from its current position
- [ ] Update element IDs/data attributes for new DOM structure

### Task 2: Update CSS

**Files:**
- Modify: `style.css`

- [ ] Add styles for compact stats block: small font, muted color, inline layout, visually distinct from filters (gray/info tone, no border, no hover effect)
- [ ] Add unified `.filter-btn` style: smaller pill buttons with consistent padding, font size ~0.8rem, border, cursor pointer
- [ ] Add `.filter-btn.active` state: filled background color matching filter type (green for ready, yellow for training, star-filled for favorites)
- [ ] Add sort control styles: small toggle buttons, visually subordinate to filters; active sort button has a clear highlight and direction indicator (arrow or label)
- [ ] Remove or repurpose old `.btn-filter`, `.filter-active-green`, `.filter-active-yellow` styles that no longer apply
- [ ] Ensure mobile responsiveness for the new layout

### Task 3: Update JS and DOM References

**Files:**
- Modify: `js/dom.js`
- Modify: `js/history.js`
- Modify: `js/main.js`

- [ ] In `dom.js`: add refs for new filter buttons and sort controls; update or remove refs for old summary box elements
- [ ] In `history.js`: update `updateHistoryFilterUI()` to toggle `.active` class on the new unified filter buttons
- [ ] In `history.js`: add `historySort` state variable with key values: `sooner`, `later`, `most_errors`, `fewest_errors`, `newest`, `oldest`, defaulting to `sooner`
- [ ] In `history.js`: update `getFilteredHistoryData()` to sort results by the selected sort key after filtering:
  - `sooner`/`later` → sort by `next_review_days` asc/desc
  - `most_errors`/`fewest_errors` → sort by error rate (1 - success_rate) desc/asc
  - `newest`/`oldest` → sort by creation date desc/asc
- [ ] In `history.js`: stats block (Total Practiced, Total Attempts, Success Rate) updated in `showExerciseHistory()` targeting new DOM elements
- [ ] In `main.js`: remove event listeners for old summary box clicks; add event listeners for new unified filter buttons and sort toggle buttons

### Task 4: Verify Acceptance Criteria

- [ ] Manual test: open Practice History, confirm stats block is small, non-clickable, visually distinct
- [ ] Manual test: confirm all three filter buttons (Ready, Training, Favorites) are in one bar, smaller, with clear active highlight
- [ ] Manual test: confirm filters work correctly and don't contradict each other visually
- [ ] Manual test: confirm sort by Sooner/Later reorders items by next_review_days
- [ ] Manual test: confirm sort by Most/Fewest errors reorders by error rate
- [ ] Manual test: confirm sort by Newest/Oldest reorders by creation date
- [ ] Manual test: verify mobile layout looks reasonable

### Task 5: Update Documentation

- [ ] Move this plan to `docs/plans/completed/`
