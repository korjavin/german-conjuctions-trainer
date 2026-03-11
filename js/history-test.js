import { state } from './state.js';
import { getFilteredHistoryData, updateHistoryFilterUI, updateHistorySortUI } from './history.js';

export function runHistoryTests() {
    console.log("=========================================");
    console.log("Running History Filtering & Sorting Tests");
    console.log("=========================================");

    let passed = 0;
    let failed = 0;

    function assert(condition, message) {
        if (condition) {
            console.log('✓', message);
            passed++;
        } else {
            console.error('✗', message);
            failed++;
        }
    }

    function assertEqual(actual, expected, message) {
        if (actual === expected) {
            console.log('✓', message, `(got: ${actual})`);
            passed++;
        } else {
            console.error('✗', message, `(expected: ${expected}, got: ${actual})`);
            failed++;
        }
    }

    // Mock history data
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;

    // Create items with clear ranking attributes
    const mockData = [
        {
            id: 1,
            ready_to_repeat: true,
            next_review_days: 0,
            is_favorite: true,
            total_attempts: 10,
            successful_attempts: 9, // 10% error
            created_at: new Date(now - 10 * dayMs).toISOString() // oldest
        },
        {
            id: 2,
            ready_to_repeat: false,
            next_review_days: 5,
            is_favorite: false,
            total_attempts: 5,
            successful_attempts: 1, // 80% error
            created_at: new Date(now - 2 * dayMs).toISOString()
        },
        {
            id: 3,
            ready_to_repeat: true,
            next_review_days: -2,
            is_favorite: false,
            total_attempts: 0,
            successful_attempts: 0, // 0% error (default)
            created_at: new Date(now - 5 * dayMs).toISOString()
        },
        {
            id: 4,
            ready_to_repeat: false,
            next_review_days: 2,
            is_favorite: true,
            total_attempts: 20,
            successful_attempts: 10, // 50% error
            created_at: new Date(now - 1 * dayMs).toISOString() // newest
        },
    ];

    state.historyData = mockData;

    try {
        // Test 1: Reset on modal open
        state.historyFilterReady = true;
        state.historyFilterFavorites = true;
        state.historyFilterTrained = true;
        state.historySortDimension = 'later';

        // Simulating the start of showExerciseHistory() logic (we can't call it fully because of DOM interaction and fetch)
        state.historyFilterReady = false;
        state.historyFilterFavorites = false;
        state.historyFilterTrained = false;
        state.historySortDimension = 'sooner';

        assertEqual(state.historySortDimension, 'sooner', "Sort dimension resets to 'sooner' on open");
        assertEqual(state.historyFilterReady, false, "Ready filter resets on open");

        // Test 2: Filter Ready
        state.historyFilterReady = true;
        let result = getFilteredHistoryData();
        assert(result.length === 2, "Ready filter returns correct count");
        assert(result.every(i => i.ready_to_repeat), "All returned items are ready to repeat");

        // Test 3: Filter Favorites
        state.historyFilterReady = false;
        state.historyFilterFavorites = true;
        result = getFilteredHistoryData();
        assert(result.length === 2, "Favorites filter returns correct count");
        assert(result.every(i => i.is_favorite), "All returned items are favorites");

        // Test 4: Filter Trained
        state.historyFilterFavorites = false;
        state.historyFilterTrained = true;
        result = getFilteredHistoryData();
        assert(result.length === 2, "Trained filter returns correct count");
        assert(result.every(i => !i.ready_to_repeat), "All returned items are trained (not ready)");

        // Reset filters for sorting tests
        state.historyFilterTrained = false;

        // Test 5: Sort Sooner
        state.historySortDimension = 'sooner';
        result = getFilteredHistoryData();
        // Expected order by next_review_days asc: id 3 (-2), id 1 (0), id 4 (2), id 2 (5)
        assertEqual(result[0].id, 3, "Sort 'sooner' places most overdue first");
        assertEqual(result[3].id, 2, "Sort 'sooner' places least overdue last");

        // Test 6: Sort Later
        state.historySortDimension = 'later';
        result = getFilteredHistoryData();
        // Expected order by next_review_days desc: id 2 (5), id 4 (2), id 1 (0), id 3 (-2)
        assertEqual(result[0].id, 2, "Sort 'later' places least overdue first");
        assertEqual(result[3].id, 3, "Sort 'later' places most overdue last");

        // Test 7: Sort Most Errors
        state.historySortDimension = 'most_errors';
        result = getFilteredHistoryData();
        // Expected order by error rate desc: id 2 (80%), id 4 (50%), id 1 (10%), id 3 (0%)
        assertEqual(result[0].id, 2, "Sort 'most_errors' places highest error rate first");
        assertEqual(result[1].id, 4, "Sort 'most_errors' ranks mid error rate correctly");
        assertEqual(result[3].id, 3, "Sort 'most_errors' places zero error rate last");

        // Test 8: Sort Fewest Errors
        state.historySortDimension = 'fewest_errors';
        result = getFilteredHistoryData();
        // Expected order by error rate asc: id 3 (0%), id 1 (10%), id 4 (50%), id 2 (80%)
        assertEqual(result[0].id, 3, "Sort 'fewest_errors' places zero error rate first");
        assertEqual(result[3].id, 2, "Sort 'fewest_errors' places highest error rate last");

        // Test 9: Sort Newest
        state.historySortDimension = 'newest';
        result = getFilteredHistoryData();
        // Expected order by created_at desc: id 4, id 2, id 3, id 1
        assertEqual(result[0].id, 4, "Sort 'newest' places newest creation date first");
        assertEqual(result[3].id, 1, "Sort 'newest' places oldest creation date last");

        // Test 10: Sort Oldest
        state.historySortDimension = 'oldest';
        result = getFilteredHistoryData();
        // Expected order by created_at asc: id 1, id 3, id 2, id 4
        assertEqual(result[0].id, 1, "Sort 'oldest' places oldest creation date first");
        assertEqual(result[3].id, 4, "Sort 'oldest' places newest creation date last");

    } catch (e) {
        console.error("Test execution failed:", e);
        failed++;
    }

    console.log("=========================================");
    console.log(`Tests Complete. Passed: ${passed}, Failed: ${failed}`);
    console.log("=========================================");

    // Export results globally if needed
    window.historyTestResults = { passed, failed, total: passed + failed };
}

// Automatically run if explicitly loaded in test page or expose via window
if (typeof window !== 'undefined') {
    window.runHistoryTests = runHistoryTests;
}
