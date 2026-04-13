# Fix Upcoming Reviews histogram for hour-based SRS

## Overview

The Upcoming Reviews histogram on the history page uses day-based bucketing (Today, Mon, Tue, ..., Later) but SRS intervals are now in hours (1h, 4h, 9h, 16h, 25h, ...). This causes all near-term reviews to collapse into "Today" with no granularity. Fix the histogram to use hour-based buckets for the first ~48 hours and day-based buckets beyond that.

## Context

- Files involved: `js/history.js` (renderReviewChart function, lines 149-199)
- Related patterns: The histogram rendering uses simple bucket arrays with HTML bar generation
- Dependencies: None - purely frontend fix

## Development Approach

- **Testing approach**: Regular (code first, then tests)
- Complete each task fully before moving to the next
- **CRITICAL: every task MUST include new/updated tests**
- **CRITICAL: all tests must pass before starting next task**

## Implementation Steps

### Task 1: Refactor renderReviewChart to use hour-aware buckets

**Files:**
- Modify: `js/history.js`

The new bucketing scheme should use smart time-based buckets:
- "Now" (ready to repeat or due within 1 hour)
- "1-4h" (due in 1-4 hours)
- "4-12h" (due in 4-12 hours)
- "12-24h" (due in 12-24 hours)
- "1-2d" (due in 24-48 hours)
- "2-4d" (due in 2-4 days)
- "4-7d" (due in 4-7 days)
- "Later" (due beyond 7 days)

- [x] Replace DAYS_TO_SHOW / day-based bucketing logic with hour-aware bucket boundaries
- [x] Update label generation to use the new bucket labels instead of day names
- [x] Keep the first bucket styling (rc-bar-today class) for the "Now" bucket
- [x] Keep the last bucket styling (rc-bar-later class) for the "Later" bucket
- [x] Write tests for the new bucketing logic in `js/__tests__/history.test.js`
- [x] Run project test suite - must pass before task 2

### Task 2: Verify acceptance criteria

- [x] Run full test suite (`make test`)
- [x] Run linter (`make lint`)

### Task 3: Update documentation

- [x] Move this plan to `docs/plans/completed/`
