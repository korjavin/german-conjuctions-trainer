# Fix histogram "Now" bucket to match "Ready to Practice" count

## Overview

The histogram "Now" bucket currently counts items due within 1 hour (including not-yet-ready items), while the "Ready to Practice" filter counts only items with `ready_to_repeat === true`. This makes the numbers inconsistent. Fix: restrict the "Now" bucket to only `ready_to_repeat` items and rename the next bucket from "1-4h" to "<4h" since it absorbs the displaced <1h items.

## Context

- Files involved: `js/history.js`, `js/__tests__/history.test.js`
- Root cause: In `bucketReviewItems()`, items with `ready_to_repeat === false` but `hoursFromNow < 1` fall into the "Now" bucket (index 0). The "Ready to Practice" count at line 61 filters strictly on `ready_to_repeat === true`.
- The backend (sqlite.go:1263-1266) correctly sets `ready_to_repeat` based on whether `hoursSinceView >= nextReviewHours`.

## Development Approach

- **Testing approach**: TDD - update tests first to reflect new expected behavior, then fix the code
- **CRITICAL: every task MUST include new/updated tests**
- **CRITICAL: all tests must pass before starting next task**

## Implementation Steps

### Task 1: Update bucketReviewItems to restrict "Now" bucket to ready_to_repeat items

**Files:**
- Modify: `js/history.js`
- Modify: `js/__tests__/history.test.js`

- [x] Update test "puts items due in <1h in Now bucket" - this should now expect the item in bucket 1 (renamed "<4h"), not bucket 0
- [x] Update test "distributes a mix of items across buckets correctly" - the <1h non-ready item should move from Now to <4h bucket, expected result changes from `[2, 1, ...]` to `[1, 2, ...]`
- [x] Update test "treats overdue items (negative hours from now) as Now" - overdue but non-ready items should go to "<4h" bucket (bucket 1), not "Now"
- [x] Add a new test: "non-ready items due in <1h go to <4h bucket, not Now"
- [x] In `bucketReviewItems()` (history.js:175), for items where `ready_to_repeat === false`, start the bucket loop from index 1 instead of 0 so they skip the "Now" bucket
- [x] Rename REVIEW_BUCKETS[1] label from "1-4h" to "<4h" (history.js:152) since it now includes <1h non-ready items
- [x] Run project test suite - must pass before next task

### Task 2: Verify acceptance criteria

- [ ] Run full test suite (`make test`)
- [ ] Run linter (`make lint`)
- [ ] Verify: histogram "Now" count logic matches "Ready to Practice" filter count logic (both use `ready_to_repeat === true` for non-hidden items)

### Task 3: Update documentation

- [ ] Move this plan to `docs/plans/completed/`
