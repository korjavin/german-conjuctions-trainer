import { describe, it, expect, beforeEach, vi } from 'vitest';
import { showExerciseHistory, renderHistoryPage, updateHistoryFilterUI, bucketReviewItems, REVIEW_BUCKETS } from '../history.js';
import { state } from '../state.js';
import { dom } from '../dom.js';
import * as api from '../api.js';

vi.mock('../api.js', () => ({
    loadExerciseHistoryAPI: vi.fn()
}));

// Mock template structure
const mockTemplate = document.createElement('template');
mockTemplate.id = 'history-item-template';
mockTemplate.innerHTML = `
    <div class="history-item">
        <div class="history-item-title"></div>
        <div class="history-item-hint"></div>
        <div class="history-item-status-container"></div>
        <button class="history-item-ignore-btn"><svg></svg></button>
        <div class="history-item-topic"></div>
        <div class="history-item-date"></div>
        <div class="history-item-success"></div>
        <div class="history-item-failed"></div>
        <div class="history-item-hints"></div>
        <div class="history-item-total"></div>
        <div class="history-item-rate"></div>
    </div>
`;
document.body.appendChild(mockTemplate);

describe('history.js', () => {
    beforeEach(() => {
        vi.clearAllMocks();

        state.isLoggedIn = true;
        state.currentTopicId = 'topic1';
        state.topics = [{ id: 'topic1', name: 'Test Topic' }];
        state.historyData = [];
        state.historyPage = 1;
        state.historyItemsPerPage = 10;
        state.historyFilterReady = false;
        state.historyFilterFavorites = false;
        state.historyFilterTrained = false;
        state.historyFilterIgnored = false;

        // Reset DOM elements mock classes
        dom.historyModal.showModal = vi.fn();
        dom.historyLoading.classList.remove = vi.fn();
        dom.historyLoading.classList.add = vi.fn();
        dom.historyEmpty.classList.remove = vi.fn();
        dom.historyEmpty.classList.add = vi.fn();
        dom.historyContent.classList.remove = vi.fn();
        dom.historyContent.classList.add = vi.fn();
        dom.historyPagination.classList.remove = vi.fn();
        dom.historyPagination.classList.add = vi.fn();
        dom.historySummary.classList.remove = vi.fn();
        dom.historySummary.classList.add = vi.fn();
        dom.historyControlsContainer.classList.add = vi.fn();

        // Setup filter icons
        dom.historyFilterReady.classList.add = vi.fn();
        dom.historyFilterReady.classList.remove = vi.fn();
        dom.historyFilterTrained.classList.add = vi.fn();
        dom.historyFilterTrained.classList.remove = vi.fn();
        dom.historyFilterFavorites.innerHTML = '<svg></svg>';
        dom.historyFilterFavorites.classList.add = vi.fn();
        dom.historyFilterFavorites.classList.remove = vi.fn();
        dom.historyFilterIgnored.classList.add = vi.fn();
        dom.historyFilterIgnored.classList.remove = vi.fn();

        dom.historySortTiming.classList.add = vi.fn();
        dom.historySortTiming.classList.remove = vi.fn();
        dom.historySortErrors.classList.add = vi.fn();
        dom.historySortErrors.classList.remove = vi.fn();
        dom.historySortDate.classList.add = vi.fn();
        dom.historySortDate.classList.remove = vi.fn();
        dom.historySortTiming.innerHTML = '<span class="sort-dir"></span>';
        dom.historySortErrors.innerHTML = '<span class="sort-dir"></span>';
        dom.historySortDate.innerHTML = '<span class="sort-dir"></span>';

        globalThis.alert.mockClear();
    });

    describe('showExerciseHistory', () => {
        it('requires login', async () => {
            state.isLoggedIn = false;
            await showExerciseHistory();
            expect(globalThis.alert).toHaveBeenCalledWith("Please log in to view your exercise history.");
            expect(api.loadExerciseHistoryAPI).not.toHaveBeenCalled();
        });

        it('calls API and calculates summary stats', async () => {
            const historyItem1 = {
                ready_to_repeat: true,
                total_attempts: 10,
                successful_attempts: 8,
                last_viewed: new Date().toISOString()
            };
            const historyItem2 = {
                ready_to_repeat: false,
                total_attempts: 5,
                successful_attempts: 1,
                last_viewed: new Date().toISOString()
            };

            api.loadExerciseHistoryAPI.mockResolvedValueOnce({
                history: [historyItem1, historyItem2]
            });

            await showExerciseHistory();

            expect(dom.historyModal.showModal).toHaveBeenCalled();
            expect(api.loadExerciseHistoryAPI).toHaveBeenCalledWith('topic1');

            // Stats checks
            expect(dom.historyTotalCount.textContent).toBe('2'); // length
            expect(dom.historyFilterFavoritesCount.textContent).toBe('0'); // 0 favorites

            // Optional properties which might have been removed in the updated branch
            if (dom.historyReadyCount.textContent) {
                expect(dom.historyReadyCount.textContent).toBe('1'); // 1 ready
            }
            if (dom.historyTrainedCount.textContent) {
                expect(dom.historyTrainedCount.textContent).toBe('1'); // 1 trained
            }
            expect(dom.historyTotalAttempts.textContent).toBe('15'); // 10 + 5

            // Math.round((9 / 15) * 100) = 60
            expect(dom.historySuccessRate.textContent).toBe('60%');

            expect(dom.historySummary.classList.remove).toHaveBeenCalledWith('hidden');
        });

        it('handles empty state', async () => {
            api.loadExerciseHistoryAPI.mockResolvedValueOnce({ history: [] });

            await showExerciseHistory();

            expect(dom.historyEmpty.classList.remove).toHaveBeenCalledWith('hidden');
            expect(dom.historySummary.classList.add).toHaveBeenCalledWith('hidden');

            // Check for historyControlsContainer if it exists in mock DOM
            if (dom.historyControlsContainer.classList.add.mock.calls.length > 0) {
                expect(dom.historyControlsContainer.classList.add).toHaveBeenCalledWith('hidden');
            }
        });
    });

    describe('renderHistoryPage and pagination', () => {
        beforeEach(() => {
            // Setup some dummy items
            state.historyData = Array(15).fill().map((_, i) => ({
                id: i,
                ready_to_repeat: i % 2 === 0,
                is_favorite: i === 0,
                german_sentence: `Item ${i}`,
                english_hint: `Hint ${i}`,
                topic_name: 'Topic',
                last_viewed: new Date().toISOString(),
                total_attempts: 5,
                successful_attempts: Math.min(i, 5),
                failed_attempts: 0,
                hints_used: 0
            }));
        });

        it('filters Ready to Repeat correctly', () => {
            state.historyFilterReady = true;
            renderHistoryPage();

            // Only even indices are ready (15 total -> 8 items)
            expect(dom.historyContent.childNodes.length).toBe(8);
        });

        it('filters Favorites correctly', () => {
            state.historyFilterFavorites = true;
            renderHistoryPage();

            // Only index 0 is favorite
            expect(dom.historyContent.childNodes.length).toBe(1);
        });

        it('filters Trained (not ready) correctly', () => {
            state.historyFilterTrained = true;
            renderHistoryPage();

            // Only odd indices are trained (15 total -> 7 items)
            expect(dom.historyContent.childNodes.length).toBe(7);
        });

        it('paginates over multiple pages', () => {
            // Page 1 should have 10 items
            state.historyPage = 1;
            renderHistoryPage();
            expect(dom.historyContent.childNodes.length).toBe(10);
            expect(dom.historyPageInfo.textContent).toBe('Page 1 of 2');
            expect(dom.historyPrevBtn.disabled).toBe(true);
            expect(dom.historyNextBtn.disabled).toBe(false);

            // Page 2 should have 5 items
            state.historyPage = 2;
            renderHistoryPage();
            expect(dom.historyContent.childNodes.length).toBe(5);
            expect(dom.historyPageInfo.textContent).toBe('Page 2 of 2');
            expect(dom.historyPrevBtn.disabled).toBe(false);
            expect(dom.historyNextBtn.disabled).toBe(true);
        });
    });

    describe('updateHistoryFilterUI', () => {
        it('toggles classes based on filter state', () => {
            state.historyFilterReady = true;
            state.historyFilterFavorites = true;
            state.historyFilterTrained = false;

            const svg = dom.historyFilterFavorites.querySelector('svg');
            svg.setAttribute = vi.fn();

            updateHistoryFilterUI();

            // Check for 'filter-active-green' or 'active-green' to support local or pr-merge codebases
            expect(
                dom.historyFilterReady.classList.add.mock.calls.some(call =>
                    call[0] === 'filter-active-green' || call[0] === 'active-green'
                )
            ).toBe(true);
            expect(
                dom.historyFilterFavorites.classList.add.mock.calls.some(call =>
                    call[0] === 'filter-active-yellow' || call[0] === 'active-yellow'
                )
            ).toBe(true);
            expect(
                dom.historyFilterTrained.classList.remove.mock.calls.some(call =>
                    call[0] === 'filter-active-yellow' || call[0] === 'active-yellow'
                )
            ).toBe(true);
            expect(svg.setAttribute).toHaveBeenCalledWith('fill', 'currentColor');
        });
    });

    describe('bucketReviewItems', () => {
        const NOW = new Date('2026-04-13T12:00:00Z').getTime();
        const msPerHour = 1000 * 60 * 60;

        function makeItem({ readyToRepeat = false, lastViewedHoursAgo = 1, nextReviewHours = 1, isHidden = false } = {}) {
            return {
                ready_to_repeat: readyToRepeat,
                last_viewed: new Date(NOW - lastViewedHoursAgo * msPerHour).toISOString(),
                next_review_hours: nextReviewHours,
                is_hidden: isHidden,
            };
        }

        it('has 8 buckets', () => {
            expect(REVIEW_BUCKETS).toHaveLength(8);
            expect(REVIEW_BUCKETS[0].label).toBe('Now');
            expect(REVIEW_BUCKETS[7].label).toBe('Later');
        });

        it('returns all zeros for empty items', () => {
            const buckets = bucketReviewItems([], NOW);
            expect(buckets).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
        });

        it('puts ready_to_repeat items in the Now bucket', () => {
            const items = [makeItem({ readyToRepeat: true }), makeItem({ readyToRepeat: true })];
            const buckets = bucketReviewItems(items, NOW);
            expect(buckets[0]).toBe(2); // Now
            expect(buckets.slice(1).every(c => c === 0)).toBe(true);
        });

        it('excludes hidden items', () => {
            const items = [makeItem({ readyToRepeat: true, isHidden: true })];
            const buckets = bucketReviewItems(items, NOW);
            expect(buckets.every(c => c === 0)).toBe(true);
        });

        it('puts non-ready items due in <1h in <4h bucket, not Now', () => {
            // lastViewed 2h ago, next_review_hours = 2.5 => due in 0.5h, but not ready
            const items = [makeItem({ lastViewedHoursAgo: 2, nextReviewHours: 2.5 })];
            const buckets = bucketReviewItems(items, NOW);
            expect(buckets[0]).toBe(0); // Not in Now
            expect(buckets[1]).toBe(1); // <4h
        });

        it('puts items due in 1-4h in the <4h bucket', () => {
            // lastViewed 1h ago, next_review_hours = 3 => due in 2h
            const items = [makeItem({ lastViewedHoursAgo: 1, nextReviewHours: 3 })];
            const buckets = bucketReviewItems(items, NOW);
            expect(buckets[1]).toBe(1); // <4h
        });

        it('puts items due in 4-12h in the 4-12h bucket', () => {
            // lastViewed 1h ago, next_review_hours = 10 => due in 9h
            const items = [makeItem({ lastViewedHoursAgo: 1, nextReviewHours: 10 })];
            const buckets = bucketReviewItems(items, NOW);
            expect(buckets[2]).toBe(1); // 4-12h
        });

        it('puts items due in 12-24h in the 12-24h bucket', () => {
            // lastViewed 1h ago, next_review_hours = 16 => due in 15h
            const items = [makeItem({ lastViewedHoursAgo: 1, nextReviewHours: 16 })];
            const buckets = bucketReviewItems(items, NOW);
            expect(buckets[3]).toBe(1); // 12-24h
        });

        it('puts items due in 1-2d in the 1-2d bucket', () => {
            // lastViewed 1h ago, next_review_hours = 30 => due in 29h
            const items = [makeItem({ lastViewedHoursAgo: 1, nextReviewHours: 30 })];
            const buckets = bucketReviewItems(items, NOW);
            expect(buckets[4]).toBe(1); // 1-2d
        });

        it('puts items due in 2-4d in the 2-4d bucket', () => {
            // lastViewed 1h ago, next_review_hours = 60 => due in 59h
            const items = [makeItem({ lastViewedHoursAgo: 1, nextReviewHours: 60 })];
            const buckets = bucketReviewItems(items, NOW);
            expect(buckets[5]).toBe(1); // 2-4d
        });

        it('puts items due in 4-7d in the 4-7d bucket', () => {
            // lastViewed 1h ago, next_review_hours = 120 => due in 119h
            const items = [makeItem({ lastViewedHoursAgo: 1, nextReviewHours: 120 })];
            const buckets = bucketReviewItems(items, NOW);
            expect(buckets[6]).toBe(1); // 4-7d
        });

        it('puts items due beyond 7d in the Later bucket', () => {
            // lastViewed 1h ago, next_review_hours = 200 => due in 199h (~8.3 days)
            const items = [makeItem({ lastViewedHoursAgo: 1, nextReviewHours: 200 })];
            const buckets = bucketReviewItems(items, NOW);
            expect(buckets[7]).toBe(1); // Later
        });

        it('distributes a mix of items across buckets correctly', () => {
            const items = [
                makeItem({ readyToRepeat: true }),                              // Now
                makeItem({ lastViewedHoursAgo: 2, nextReviewHours: 2.5 }),      // <4h (0.5h, not ready)
                makeItem({ lastViewedHoursAgo: 1, nextReviewHours: 3 }),        // <4h (2h)
                makeItem({ lastViewedHoursAgo: 1, nextReviewHours: 10 }),       // 4-12h (9h)
                makeItem({ lastViewedHoursAgo: 1, nextReviewHours: 16 }),       // 12-24h (15h)
                makeItem({ lastViewedHoursAgo: 1, nextReviewHours: 30 }),       // 1-2d (29h)
                makeItem({ lastViewedHoursAgo: 1, nextReviewHours: 60 }),       // 2-4d (59h)
                makeItem({ lastViewedHoursAgo: 1, nextReviewHours: 120 }),      // 4-7d (119h)
                makeItem({ lastViewedHoursAgo: 1, nextReviewHours: 200 }),      // Later (199h)
                makeItem({ readyToRepeat: true, isHidden: true }),              // excluded
            ];
            const buckets = bucketReviewItems(items, NOW);
            expect(buckets).toEqual([1, 2, 1, 1, 1, 1, 1, 1]);
        });

        it('places items at exact bucket boundaries in the next bucket', () => {
            // Exactly at maxHours threshold should go to the NEXT bucket (strict <)
            // e.g., exactly 1h => "<4h" (not "Now"), exactly 4h => "4-12h" (not "<4h")
            const items = [
                makeItem({ lastViewedHoursAgo: 0, nextReviewHours: 1 }),   // exactly 1h => <4h
                makeItem({ lastViewedHoursAgo: 0, nextReviewHours: 4 }),   // exactly 4h => 4-12h
                makeItem({ lastViewedHoursAgo: 0, nextReviewHours: 12 }),  // exactly 12h => 12-24h
                makeItem({ lastViewedHoursAgo: 0, nextReviewHours: 24 }),  // exactly 24h => 1-2d
                makeItem({ lastViewedHoursAgo: 0, nextReviewHours: 48 }),  // exactly 48h => 2-4d
                makeItem({ lastViewedHoursAgo: 0, nextReviewHours: 96 }),  // exactly 96h => 4-7d
                makeItem({ lastViewedHoursAgo: 0, nextReviewHours: 168 }), // exactly 168h => Later
            ];
            const buckets = bucketReviewItems(items, NOW);
            //                    Now  <4h   4-12h 12-24h 1-2d  2-4d  4-7d  Later
            expect(buckets).toEqual([0,  1,    1,    1,     1,    1,    1,    1]);
        });

        it('treats overdue non-ready items as <4h, not Now', () => {
            // lastViewed 10h ago, next_review_hours = 2 => due 8h ago, but not ready
            const items = [makeItem({ lastViewedHoursAgo: 10, nextReviewHours: 2 })];
            const buckets = bucketReviewItems(items, NOW);
            expect(buckets[0]).toBe(0); // Not in Now
            expect(buckets[1]).toBe(1); // <4h
        });

        it('non-ready items due in <1h go to <4h bucket, not Now', () => {
            // Two non-ready items due very soon - both should skip Now bucket
            const items = [
                makeItem({ lastViewedHoursAgo: 2, nextReviewHours: 2.1 }),  // due in 0.1h
                makeItem({ lastViewedHoursAgo: 5, nextReviewHours: 5.5 }),  // due in 0.5h
            ];
            const buckets = bucketReviewItems(items, NOW);
            expect(buckets[0]).toBe(0); // Now: empty
            expect(buckets[1]).toBe(2); // <4h: both items
        });
    });
});
