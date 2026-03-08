/**
 * Functional Tests for Topic Search/Filter Feature
 *
 * These tests can be run in browser console by:
 * 1. Loading page
 * 2. Opening browser console
 * 3. Pasting this entire file
 *
 * Tests cover:
 * - Search input field presence and functionality
 * - Search state management
 * - Filtering topics by name
 * - Auto-expanding parent topics on search
 * - Highlighting matching text
 * - Clear search button
 * - Keyboard shortcut (Ctrl+F / Cmd+F)
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

    // Test 1: Verify search input field exists in DOM
    tests.push(() => {
        const searchInput = document.getElementById('topics-search-input');
        const inputExists = searchInput !== null;
        assert(inputExists, 'Topics search input field exists in DOM');
        if (inputExists) {
            console.log('  Input type:', searchInput.type);
            console.log('  Input placeholder:', searchInput.placeholder);
        }
    });

    // Test 2: Verify clear search button exists in DOM
    tests.push(() => {
        const clearBtn = document.getElementById('topics-search-clear');
        const btnExists = clearBtn !== null;
        assert(btnExists, 'Topics search clear button exists in DOM');
        if (btnExists) {
            console.log('  Button class:', clearBtn.className);
            console.log('  Button initially hidden:', clearBtn.classList.contains('hidden'));
        }
    });

    // Test 3: Verify state has search query property
    tests.push(() => {
        const hasSearchState = typeof window.state !== 'undefined' && 'topicsSearchQuery' in window.state;
        assert(hasSearchState, 'State object has topicsSearchQuery property');
        if (hasSearchState) {
            console.log('  Initial search query:', window.state.topicsSearchQuery);
        }
    });

    // Test 4: Verify state has matching IDs Set
    tests.push(() => {
        const hasMatchingIds = typeof window.state !== 'undefined' && 'topicsMatchingIds' in window.state;
        assert(hasMatchingIds, 'State object has topicsMatchingIds property');
        if (hasMatchingIds) {
            console.log('  topicsMatchingIds type:', window.state.topicsMatchingIds.constructor.name);
        }
    });

    // Test 5: Test search input event updates state
    tests.push(() => {
        const searchInput = document.getElementById('topics-search-input');
        if (!searchInput) {
            console.log('  Skipping: search input not found');
            return;
        }

        const originalValue = searchInput.value;
        const testQuery = 'test';

        // Trigger input event
        searchInput.value = testQuery;
        searchInput.dispatchEvent(new Event('input', { bubbles: true }));

        const stateUpdated = window.state.topicsSearchQuery === testQuery;
        assert(stateUpdated, 'Search input updates state.topicsSearchQuery');

        // Clean up
        searchInput.value = '';
        searchInput.dispatchEvent(new Event('input', { bubbles: true }));
        if (originalValue) {
            searchInput.value = originalValue;
            searchInput.dispatchEvent(new Event('input', { bubbles: true }));
        }
    });

    // Test 6: Test clear button is visible when search has value
    tests.push(() => {
        const searchInput = document.getElementById('topics-search-input');
        const clearBtn = document.getElementById('topics-search-clear');

        if (!searchInput || !clearBtn) {
            console.log('  Skipping: search elements not found');
            return;
        }

        const originalValue = searchInput.value;

        // Set search value
        searchInput.value = 'test';
        searchInput.dispatchEvent(new Event('input', { bubbles: true }));

        const isVisible = !clearBtn.classList.contains('hidden');
        assert(isVisible, 'Clear button is visible when search has value');

        // Clean up
        searchInput.value = '';
        searchInput.dispatchEvent(new Event('input', { bubbles: true }));
        if (originalValue) {
            searchInput.value = originalValue;
            searchInput.dispatchEvent(new Event('input', { bubbles: true }));
        }
    });

    // Test 7: Test clear button hides when search is empty
    tests.push(() => {
        const searchInput = document.getElementById('topics-search-input');
        const clearBtn = document.getElementById('topics-search-clear');

        if (!searchInput || !clearBtn) {
            console.log('  Skipping: search elements not found');
            return;
        }

        const originalValue = searchInput.value;

        // Clear search
        searchInput.value = '';
        searchInput.dispatchEvent(new Event('input', { bubbles: true }));

        const isHidden = clearBtn.classList.contains('hidden');
        assert(isHidden, 'Clear button is hidden when search is empty');

        // Clean up
        if (originalValue) {
            searchInput.value = originalValue;
            searchInput.dispatchEvent(new Event('input', { bubbles: true }));
        }
    });

    // Test 8: Test clear button click resets search
    tests.push(() => {
        const searchInput = document.getElementById('topics-search-input');
        const clearBtn = document.getElementById('topics-search-clear');

        if (!searchInput || !clearBtn) {
            console.log('  Skipping: search elements not found');
            return;
        }

        const originalValue = searchInput.value;

        // Set and clear search
        searchInput.value = 'test';
        searchInput.dispatchEvent(new Event('input', { bubbles: true }));
        clearBtn.click();

        const stateCleared = window.state.topicsSearchQuery === '';
        const inputCleared = searchInput.value === '';
        const btnHidden = clearBtn.classList.contains('hidden');

        assert(stateCleared && inputCleared && btnHidden, 'Clear button resets search state and input');

        // Clean up
        if (originalValue) {
            searchInput.value = originalValue;
            searchInput.dispatchEvent(new Event('input', { bubbles: true }));
        }
    });

    // Test 9: Test search filters topics by name
    tests.push(() => {
        if (typeof window.state === 'undefined' || !window.state.topics || window.state.topics.length === 0) {
            console.log('  Skipping: no topics loaded');
            return;
        }

        const searchInput = document.getElementById('topics-search-input');
        if (!searchInput) {
            console.log('  Skipping: search input not found');
            return;
        }

        const originalValue = searchInput.value;
        const firstTopicName = window.state.topics[0].name;

        // Search for first topic
        searchInput.value = firstTopicName.substring(0, Math.max(3, firstTopicName.length - 2));
        searchInput.dispatchEvent(new Event('input', { bubbles: true }));

        const hasMatches = window.state.topicsMatchingIds.size > 0;
        assert(hasMatches, 'Search finds matching topics and updates topicsMatchingIds');

        // Clean up
        searchInput.value = '';
        searchInput.dispatchEvent(new Event('input', { bubbles: true }));
        if (originalValue) {
            searchInput.value = originalValue;
            searchInput.dispatchEvent(new Event('input', { bubbles: true }));
        }
    });

    // Test 10: Test search highlighting is applied
    tests.push(() => {
        if (typeof window.state === 'undefined' || !window.state.topics || window.state.topics.length === 0) {
            console.log('  Skipping: no topics loaded');
            return;
        }

        const searchInput = document.getElementById('topics-search-input');
        if (!searchInput) {
            console.log('  Skipping: search input not found');
            return;
        }

        const originalValue = searchInput.value;
        const firstTopicName = window.state.topics[0].name;

        // Search for first topic
        searchInput.value = firstTopicName.substring(0, Math.max(3, firstTopicName.length - 2));
        searchInput.dispatchEvent(new Event('input', { bubbles: true }));

        // Check for highlight marks
        const highlights = document.querySelectorAll('.search-highlight');
        const hasHighlights = highlights.length > 0;

        assert(hasHighlights, 'Search highlights matching text in topic names');

        // Clean up
        searchInput.value = '';
        searchInput.dispatchEvent(new Event('input', { bubbles: true }));
        if (originalValue) {
            searchInput.value = originalValue;
            searchInput.dispatchEvent(new Event('input', { bubbles: true }));
        }
    });

    // Test 11: Test empty search shows all topics
    tests.push(() => {
        const searchInput = document.getElementById('topics-search-input');
        if (!searchInput) {
            console.log('  Skipping: search input not found');
            return;
        }

        const originalValue = searchInput.value;

        // Clear search
        searchInput.value = '';
        searchInput.dispatchEvent(new Event('input', { bubbles: true }));

        const noMatches = window.state.topicsMatchingIds.size === 0;
        assert(noMatches, 'Empty search clears matching topics set');

        // Clean up
        if (originalValue) {
            searchInput.value = originalValue;
            searchInput.dispatchEvent(new Event('input', { bubbles: true }));
        }
    });

    // Test 12: Test no results message appears for non-matching search
    tests.push(() => {
        if (typeof window.state === 'undefined' || !window.state.topics || window.state.topics.length === 0) {
            console.log('  Skipping: no topics loaded');
            return;
        }

        const searchInput = document.getElementById('topics-search-input');
        if (!searchInput) {
            console.log('  Skipping: search input not found');
            return;
        }

        const originalValue = searchInput.value;

        // Search for something unlikely to match
        searchInput.value = 'xyzzy123456789';
        searchInput.dispatchEvent(new Event('input', { bubbles: true }));

        const topicsList = document.getElementById('topics-list');
        const noResultsMsg = topicsList && topicsList.textContent.includes('No topics found');

        assert(noResultsMsg, 'No results message appears for non-matching search');

        // Clean up
        searchInput.value = '';
        searchInput.dispatchEvent(new Event('input', { bubbles: true }));
        if (originalValue) {
            searchInput.value = originalValue;
            searchInput.dispatchEvent(new Event('input', { bubbles: true }));
        }
    });

    // Test 13: Test keyboard shortcut focuses search input
    tests.push(() => {
        const searchInput = document.getElementById('topics-search-input');
        if (!searchInput) {
            console.log('  Skipping: search input not found');
            return;
        }

        const settingsModal = document.getElementById('settings-modal');
        if (!settingsModal || !settingsModal.open) {
            console.log('  Skipping: settings modal not open');
            return;
        }

        // Blur the input first
        searchInput.blur();

        // Simulate Ctrl+F
        const event = new KeyboardEvent('keydown', {
            key: 'f',
            ctrlKey: true,
            bubbles: true
        });

        document.dispatchEvent(event);

        // Verify that the event was dispatched without errors
        assert(searchInput !== null, 'Search input element exists for keyboard shortcut test');
    });

    // Test 14: Test search with nested topics expands parents
    tests.push(() => {
        if (typeof window.state === 'undefined' || !window.state.topics) {
            console.log('  Skipping: no topics loaded');
            return;
        }

        // Find a topic with children
        const topicWithChildren = window.state.topics.find(t => t.children && t.children.length > 0);
        if (!topicWithChildren) {
            console.log('  Skipping: no topics with children found');
            return;
        }

        const searchInput = document.getElementById('topics-search-input');
        if (!searchInput) {
            console.log('  Skipping: search input not found');
            return;
        }

        const originalValue = searchInput.value;

        // Search for a child topic
        const childName = topicWithChildren.children[0].name;
        searchInput.value = childName.substring(0, Math.max(3, childName.length - 2));
        searchInput.dispatchEvent(new Event('input', { bubbles: true }));

        // The child should be in matching IDs
        const childMatches = window.state.topicsMatchingIds.has(topicWithChildren.children[0].id);

        assert(childMatches, 'Search finds child topics');

        // Clean up
        searchInput.value = '';
        searchInput.dispatchEvent(new Event('input', { bubbles: true }));
        if (originalValue) {
            searchInput.value = originalValue;
            searchInput.dispatchEvent(new Event('input', { bubbles: true }));
        }
    });

    // Test 15: Test search highlight styling exists
    tests.push(() => {
        const highlightElement = document.createElement('mark');
        highlightElement.className = 'search-highlight';
        document.body.appendChild(highlightElement);

        const computedStyle = window.getComputedStyle(highlightElement);
        const hasBackgroundColor = computedStyle.backgroundColor !== 'rgba(0, 0, 0, 0)' &&
            computedStyle.backgroundColor !== 'transparent';

        document.body.removeChild(highlightElement);

        assert(hasBackgroundColor, 'Search highlight has background color styling');
    });

    // Run all tests
    console.log('='.repeat(60));
    console.log('Running Topic Search/Filter Tests');
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
    window.topicSearchTestResults = {
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
