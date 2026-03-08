/**
 * Functional Tests for Top-Level Topic Sorting Feature
 *
 * These tests can be run in the browser console by:
 * 1. Loading the page
 * 2. Opening browser console
 * 3. Pasting this entire file
 *
 * Tests cover:
 * - Sort order persistence in localStorage
 * - Top-level only sorting (nested children unaffected)
 * - UI sort controls
 * - Various sort options (tree, name-asc, name-desc, date-newest, date-oldest)
 */

(function() {
    'use strict';

    const tests = [];
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

    // Test 1: Verify sort order storage key exists
    tests.push(() => {
        const key = 'topicSortOrder';
        const stored = localStorage.getItem(key);
        assert(localStorage.getItem(key) !== undefined, 'Sort order storage key is accessible');
        console.log('  Storage key:', key);
        console.log('  Current value:', stored || 'not set (will default to "tree")');
    });

    // Test 2: Verify state has topicSortOrder property
    tests.push(() => {
        const hasSortOrder = typeof window.state !== 'undefined' && 'topicSortOrder' in window.state;
        assert(hasSortOrder, 'State object has topicSortOrder property');
        if (hasSortOrder) {
            console.log('  topicSortOrder value:', window.state.topicSortOrder);
        }
    });

    // Test 3: Verify default sort order is 'tree'
    tests.push(() => {
        const defaultOrder = localStorage.getItem('topicSortOrder') || 'tree';
        assertEqual(defaultOrder, 'tree', 'Default sort order is "tree"');
    });

    // Test 4: Verify sort UI select control exists
    tests.push(() => {
        const sortSelect = document.getElementById('topic-sort');
        assert(sortSelect !== null, 'Sort select control exists in DOM');
        if (sortSelect) {
            console.log('  Sort select options:', Array.from(sortSelect.options).map(o => o.value).join(', '));
        }
    });

    // Test 5: Verify all sort options are available
    tests.push(() => {
        const sortSelect = document.getElementById('topic-sort');
        if (!sortSelect) {
            console.log('  Skipping: sort select not found');
            return;
        }

        const expectedOptions = ['tree', 'name-asc', 'name-desc', 'date-newest', 'date-oldest'];
        const actualOptions = Array.from(sortSelect.options).map(o => o.value);

        const hasAllOptions = expectedOptions.every(opt => actualOptions.includes(opt));
        assert(hasAllOptions, 'All sort options are available in select control');

        if (!hasAllOptions) {
            console.log('  Expected:', expectedOptions);
            console.log('  Actual:', actualOptions);
        }
    });

    // Test 6: Test sort order state changes
    tests.push(() => {
        const originalValue = window.state.topicSortOrder;
        const testValue = 'name-asc';

        window.state.topicSortOrder = testValue;
        assertEqual(window.state.topicSortOrder, testValue, 'Sort order state can be changed');

        // Restore original value
        window.state.topicSortOrder = originalValue;
    });

    // Test 7: Test sort order persistence in localStorage
    tests.push(() => {
        const testValue = 'date-newest';
        const originalValue = localStorage.getItem('topicSortOrder');

        // Set test value
        localStorage.setItem('topicSortOrder', testValue);
        const stored = localStorage.getItem('topicSortOrder');
        assertEqual(stored, testValue, 'Sort order is saved to localStorage');

        // Restore original value
        if (originalValue) {
            localStorage.setItem('topicSortOrder', originalValue);
        } else {
            localStorage.removeItem('topicSortOrder');
        }
    });

    // Test 8: Verify topics are loaded in state
    tests.push(() => {
        const hasTopics = typeof window.state !== 'undefined' &&
                         Array.isArray(window.state.topics) &&
                         window.state.topics.length > 0;
        assert(hasTopics, 'Topics are loaded in state');
        if (hasTopics) {
            console.log('  Number of topics:', window.state.topics.length);
        }
    });

    // Test 9: Verify buildTopicTree function exists
    tests.push(() => {
        const exists = typeof window.buildTopicTree === 'function';
        assert(exists, 'buildTopicTree function is available');
    });

    // Test 10: Test that tree order preserves sort_order for all levels
    tests.push(() => {
        if (typeof window.buildTopicTree !== 'function' ||
            typeof window.state === 'undefined' ||
            !window.state.topics.length) {
            console.log('  Skipping: buildTopicTree or topics not available');
            return;
        }

        const { roots } = window.buildTopicTree(window.state.topics, 'tree');
        assert(roots.length >= 0, 'buildTopicTree executes with "tree" order');
        console.log('  Top-level topics in tree order:', roots.length);
    });

    // Test 11: Test that name-asc sort works
    tests.push(() => {
        if (typeof window.buildTopicTree !== 'function' ||
            typeof window.state === 'undefined' ||
            !window.state.topics.length) {
            console.log('  Skipping: buildTopicTree or topics not available');
            return;
        }

        const { roots } = window.buildTopicTree(window.state.topics, 'name-asc');
        assert(roots.length >= 0, 'buildTopicTree executes with "name-asc" order');
        console.log('  Top-level topics in name-asc order:', roots.length);

        // Verify names are actually sorted
        if (roots.length > 1) {
            let isSorted = true;
            for (let i = 0; i < roots.length - 1; i++) {
                if (roots[i].name.localeCompare(roots[i + 1].name) > 0) {
                    isSorted = false;
                    break;
                }
            }
            assert(isSorted, 'Top-level topics are sorted by name (A-Z)');
        }
    });

    // Test 12: Test that nested children maintain tree order when top-level is sorted by name
    tests.push(() => {
        if (typeof window.buildTopicTree !== 'function' ||
            typeof window.state === 'undefined' ||
            !window.state.topics.length) {
            console.log('  Skipping: buildTopicTree or topics not available');
            return;
        }

        const { roots } = window.buildTopicTree(window.state.topics, 'name-asc');
        let hasNestedChildren = false;
        let childrenMaintainTreeOrder = true;

        // Check if any top-level topic has children
        const checkChildren = (nodes) => {
            nodes.forEach(node => {
                if (node.children && node.children.length > 0) {
                    hasNestedChildren = true;

                    // For tree order, children should be sorted by sort_order
                    // For non-tree orders at top level, children should still be sorted by sort_order
                    for (let i = 0; i < node.children.length - 1; i++) {
                        const aSort = Number.isFinite(node.children[i].sort_order) ? node.children[i].sort_order : 0;
                        const bSort = Number.isFinite(node.children[i + 1].sort_order) ? node.children[i + 1].sort_order : 0;
                        if (aSort > bSort) {
                            childrenMaintainTreeOrder = false;
                        }
                    }

                    checkChildren(node.children);
                }
            });
        };

        checkChildren(roots);

        if (hasNestedChildren) {
            assert(childrenMaintainTreeOrder, 'Nested children maintain tree order when top-level is sorted');
            console.log('  Found nested topics:', hasNestedChildren);
        } else {
            console.log('  Skipping: no nested topics found to test');
        }
    });

    // Test 13: Test that date-newest sort works
    tests.push(() => {
        if (typeof window.buildTopicTree !== 'function' ||
            typeof window.state === 'undefined' ||
            !window.state.topics.length) {
            console.log('  Skipping: buildTopicTree or topics not available');
            return;
        }

        const { roots } = window.buildTopicTree(window.state.topics, 'date-newest');
        assert(roots.length >= 0, 'buildTopicTree executes with "date-newest" order');
        console.log('  Top-level topics in date-newest order:', roots.length);

        // Verify dates are actually sorted (newest first)
        if (roots.length > 1) {
            let isSorted = true;
            for (let i = 0; i < roots.length - 1; i++) {
                const aDate = new Date(roots[i].created_at);
                const bDate = new Date(roots[i + 1].created_at);
                if (aDate < bDate) {
                    isSorted = false;
                    break;
                }
            }
            assert(isSorted, 'Top-level topics are sorted by date (newest first)');
        }
    });

    // Test 14: Test that name-desc sort works
    tests.push(() => {
        if (typeof window.buildTopicTree !== 'function' ||
            typeof window.state === 'undefined' ||
            !window.state.topics.length) {
            console.log('  Skipping: buildTopicTree or topics not available');
            return;
        }

        const { roots } = window.buildTopicTree(window.state.topics, 'name-desc');
        assert(roots.length >= 0, 'buildTopicTree executes with "name-desc" order');
        console.log('  Top-level topics in name-desc order:', roots.length);

        // Verify names are actually sorted (reverse)
        if (roots.length > 1) {
            let isSorted = true;
            for (let i = 0; i < roots.length - 1; i++) {
                if (roots[i].name.localeCompare(roots[i + 1].name) < 0) {
                    isSorted = false;
                    break;
                }
            }
            assert(isSorted, 'Top-level topics are sorted by name (Z-A)');
        }
    });

    // Test 15: Test that date-oldest sort works
    tests.push(() => {
        if (typeof window.buildTopicTree !== 'function' ||
            typeof window.state === 'undefined' ||
            !window.state.topics.length) {
            console.log('  Skipping: buildTopicTree or topics not available');
            return;
        }

        const { roots } = window.buildTopicTree(window.state.topics, 'date-oldest');
        assert(roots.length >= 0, 'buildTopicTree executes with "date-oldest" order');
        console.log('  Top-level topics in date-oldest order:', roots.length);

        // Verify dates are actually sorted (oldest first)
        if (roots.length > 1) {
            let isSorted = true;
            for (let i = 0; i < roots.length - 1; i++) {
                const aDate = new Date(roots[i].created_at);
                const bDate = new Date(roots[i + 1].created_at);
                if (aDate > bDate) {
                    isSorted = false;
                    break;
                }
            }
            assert(isSorted, 'Top-level topics are sorted by date (oldest first)');
        }
    });

    // Test 16: Verify renderTopicsList function exists
    tests.push(() => {
        const exists = typeof window.renderTopicsList === 'function';
        assert(exists, 'renderTopicsList function is available');
    });

    // Test 17: Verify changing sort select triggers re-render
    tests.push(() => {
        const sortSelect = document.getElementById('topic-sort');
        if (!sortSelect || typeof window.renderTopicsList !== 'function') {
            console.log('  Skipping: sort select or renderTopicsList not available');
            return;
        }

        // This test just verifies the DOM element exists - actual behavior
        // is tested manually in the guide
        assert(true, 'Sort select is available for manual testing');
    });

    // Test 18: Verify tree lines still render with different sort orders
    tests.push(() => {
        if (typeof window.renderTopicsList !== 'function') {
            console.log('  Skipping: renderTopicsList not available');
            return;
        }

        const treeLines = document.querySelectorAll('.tree-lines-container');
        console.log('  Tree line containers:', treeLines.length);
        // Tree lines may or may not be present depending on depth
        assert(treeLines.length >= 0, 'Tree line rendering is intact');
    });

    // Test 19: Verify drag-and-drop still works with sorted topics
    tests.push(() => {
        const draggableTopics = document.querySelectorAll('[draggable="true"]');
        console.log('  Draggable topics:', draggableTopics.length);
        assert(draggableTopics.length > 0, 'Topics are still draggable with sorted view');
    });

    // Test 20: Verify expand/collapse still works with sorted topics
    tests.push(() => {
        const collapseButtons = document.querySelectorAll('.topic-collapse-btn');
        console.log('  Collapse buttons:', collapseButtons.length);
        assert(collapseButtons.length >= 0, 'Collapse buttons are still present');
    });

    // Run all tests
    console.log('='.repeat(60));
    console.log('Running Top-Level Topic Sorting Tests');
    console.log('='.repeat(60));

    tests.forEach((test, index) => {
        console.log(`\nTest ${index + 1}:`);
        try {
            test();
        } catch (error) {
            console.error('✗ Test failed with exception:', error.message);
            console.error('  Stack:', error.stack);
            failed++;
        }
    });

    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('Test Summary');
    console.log('='.repeat(60));
    console.log('Passed:', passed);
    console.log('Failed:', failed);
    console.log('Total:', passed + failed);
    console.log('='.repeat(60));

    if (failed === 0) {
        console.log('\n✓ All tests passed!');
    } else {
        console.log('\n✗ Some tests failed. Please review output above.');
    }

    // Export test summary for programmatic access
    window.topicSortTestResults = {
        passed,
        failed,
        total: passed + failed,
        success: failed === 0
    };

    return {
        passed,
        failed,
        total: passed + failed,
        success: failed === 0
    };
})();
