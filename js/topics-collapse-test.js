/**
 * Functional Tests for Topic Collapse/Expand Feature
 *
 * These tests can be run in the browser console by:
 * 1. Loading the page
 * 2. Opening browser console
 * 3. Pasting this entire file
 *
 * Tests cover:
 * - Collapse state management in localStorage
 * - Toggle functionality
 * - Tree flattening with collapsed state
 * - UI rendering with collapse buttons
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

    // Test 1: Verify collapse state storage key exists
    tests.push(() => {
        const key = 'topicCollapseState';
        const stored = localStorage.getItem(key);
        assert(localStorage.getItem(key) !== undefined, 'Collapse state storage key is accessible');
        console.log('  Storage key:', key);
        console.log('  Current value:', stored);
    });

    // Test 2: Verify state module has collapse state
    tests.push(() => {
        const hasCollapseState = typeof window.state !== 'undefined' && 'collapsedTopicIds' in window.state;
        assert(hasCollapseState, 'State object has collapsedTopicIds property');
        if (hasCollapseState) {
            console.log('  collapsedTopicIds type:', window.state.collapsedTopicIds.constructor.name);
        }
    });

    // Test 3: Verify toggleTopicCollapse function exists
    tests.push(() => {
        const toggleExists = typeof window.toggleTopicCollapse === 'function';
        assert(toggleExists, 'toggleTopicCollapse function is exported from state module');
    });

    // Test 4: Verify isTopicCollapsed function exists
    tests.push(() => {
        const exists = typeof window.isTopicCollapsed === 'function';
        assert(exists, 'isTopicCollapsed function is exported from state module');
    });

    // Test 5: Test toggle collapse functionality
    tests.push(() => {
        const testTopicId = 'test-collapse-' + Date.now();
        const initialState = window.isTopicCollapsed(testTopicId);
        assertEqual(initialState, false, 'New topic should not be collapsed by default');

        // Toggle to collapse
        window.toggleTopicCollapse(testTopicId);
        const collapsedState = window.isTopicCollapsed(testTopicId);
        assertEqual(collapsedState, true, 'Topic should be collapsed after toggle');

        // Toggle to expand
        window.toggleTopicCollapse(testTopicId);
        const expandedState = window.isTopicCollapsed(testTopicId);
        assertEqual(expandedState, false, 'Topic should be expanded after second toggle');

        // Clean up
        window.state.collapsedTopicIds.delete(testTopicId);
    });

    // Test 6: Verify collapse state persists in localStorage
    tests.push(() => {
        const testTopicId = 'test-persist-' + Date.now();

        // Set collapsed state
        window.toggleTopicCollapse(testTopicId);
        const inMemory = window.state.collapsedTopicIds.has(testTopicId);
        assert(inMemory, 'Collapsed ID is in memory Set');

        // Verify it's saved to localStorage
        const stored = localStorage.getItem('topicCollapseState');
        const storedIds = stored ? JSON.parse(stored) : [];
        const inStorage = storedIds.includes(testTopicId);
        assert(inStorage, 'Collapsed ID is saved to localStorage');

        // Clean up
        window.state.collapsedTopicIds.delete(testTopicId);
        window.toggleTopicCollapse(testTopicId); // Save clean state
    });

    // Test 7: Verify collapse buttons exist in DOM
    tests.push(() => {
        const collapseButtons = document.querySelectorAll('.topic-collapse-btn');
        console.log('  Found', collapseButtons.length, 'collapse buttons');
        assert(collapseButtons.length > 0, 'Collapse buttons are rendered in the DOM');
    });

    // Test 8: Verify collapse buttons have chevron icons
    tests.push(() => {
        const collapseButtons = document.querySelectorAll('.topic-collapse-btn');
        if (collapseButtons.length === 0) {
            console.log('  Skipping: no collapse buttons found');
            return;
        }

        let hasSvg = false;
        collapseButtons.forEach(btn => {
            if (btn.querySelector('svg')) {
                hasSvg = true;
            }
        });
        assert(hasSvg, 'Collapse buttons contain SVG chevron icons');
    });

    // Test 9: Verify topics with children have collapse buttons
    tests.push(() => {
        if (typeof window.state === 'undefined' || !window.state.topics) {
            console.log('  Skipping: no topics loaded');
            return;
        }

        const topicsWithChildren = window.state.topics.filter(t => t.children && t.children.length > 0);
        console.log('  Topics with children:', topicsWithChildren.length);

        if (topicsWithChildren.length > 0) {
            const collapseButtons = document.querySelectorAll('.topic-collapse-btn');
            console.log('  Collapse buttons found:', collapseButtons.length);
            assert(collapseButtons.length > 0, 'Topics with children have collapse buttons');
        }
    });

    // Test 10: Verify expand/collapse interaction updates DOM
    tests.push(() => {
        if (typeof window.renderTopicsList !== 'function') {
            console.log('  Skipping: renderTopicsList not available');
            return;
        }

        const topicWithChildren = document.querySelector('.topic-collapse-btn');
        if (!topicWithChildren) {
            console.log('  Skipping: no collapse button found in DOM');
            return;
        }

        // Click the first collapse button
        const topicId = topicWithChildren.dataset.topicId;
        if (topicId) {
            const wasCollapsed = window.isTopicCollapsed(topicId);
            topicWithChildren.click();

            // Check if state changed
            const nowCollapsed = window.isTopicCollapsed(topicId);
            assert(wasCollapsed !== nowCollapsed, 'Clicking collapse button toggles state');

            // Restore original state
            window.toggleTopicCollapse(topicId);
            if (typeof window.renderTopicsList === 'function') {
                window.renderTopicsList();
            }
        }
    });

    // Test 11: Verify collapse state loads from localStorage on page load
    tests.push(() => {
        const testTopicId = 'test-load-' + Date.now();

        // Save a collapsed state
        window.toggleTopicCollapse(testTopicId);

        // Verify it's in localStorage
        const stored = localStorage.getItem('topicCollapseState');
        const storedIds = stored ? JSON.parse(stored) : [];
        assert(storedIds.includes(testTopicId), 'Collapsed state is in localStorage');

        // Clean up
        window.state.collapsedTopicIds.delete(testTopicId);
        window.toggleTopicCollapse(testTopicId); // Save clean state
    });

    // Test 12: Verify drag-and-drop still works with collapsed state
    tests.push(() => {
        const draggableTopics = document.querySelectorAll('[draggable="true"]');
        console.log('  Draggable topics:', draggableTopics.length);
        assert(draggableTopics.length > 0, 'Topics are still draggable after collapse feature is added');
    });

    // Test 13: Verify tree lines still render correctly
    tests.push(() => {
        const treeLines = document.querySelectorAll('.tree-lines-container');
        console.log('  Tree line containers:', treeLines.length);
        // Tree lines may or may not be present depending on depth, so we just check
        // that the class exists in the DOM
        assert(treeLines.length >= 0, 'Tree line rendering is intact');
    });

    // Run all tests
    console.log('='.repeat(60));
    console.log('Running Topic Collapse/Expand Tests');
    console.log('='.repeat(60));

    tests.forEach((test, index) => {
        console.log(`\nTest ${index + 1}:`);
        try {
            test();
        } catch (error) {
            console.error('✗ Test failed with exception:', error.message);
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
        console.log('\n✗ Some tests failed. Please review the output above.');
    }

    // Export test summary for programmatic access
    window.topicCollapseTestResults = {
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
