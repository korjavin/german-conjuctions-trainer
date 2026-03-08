/**
 * Functional Tests for Main Screen Dropdown Tree with Search
 *
 * These tests can be run in browser console by:
 * 1. Loading page
 * 2. Opening browser console
 * 3. Pasting this entire file
 *
 * Tests cover:
 * - Dropdown element exists
 * - Tree items render correctly with indentation
 * - Collapse buttons for parent topics
 * - Collapse/expand functionality
 * - Search filtering with text highlighting
 * - Clear search restores tree
 */

(function() {
    'use strict';

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

    function delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // Test 1: Verify dropdown element exists in DOM
    async function test1() {
        console.log('\nTest 1: Verify dropdown element exists in DOM');
        const dropdown = document.getElementById('topic-dropdown');
        const dropdownExists = dropdown !== null;
        assert(dropdownExists, 'Topic dropdown element exists in DOM');
        if (dropdownExists) {
            console.log('  Dropdown class:', dropdown.className);
            console.log('  Dropdown initially hidden:', dropdown.classList.contains('hidden'));
        }
    }

    // Test 2: After focusing topic search, dropdown contains tree items (not old topic-item)
    async function test2() {
        console.log('\nTest 2: Dropdown contains tree items after focus');
        const searchInput = document.getElementById('topic-search');
        const dropdown = document.getElementById('topic-dropdown');

        if (!searchInput || !dropdown) {
            console.log('  Skipping: dropdown elements not found');
            return;
        }

        const originalValue = searchInput.value;

        // Focus the search input to trigger dropdown render
        searchInput.focus();
        await delay(100);

        const treeItems = dropdown.querySelectorAll('.topic-dropdown-tree-item');
        const hasTreeItems = treeItems.length > 0;

        assert(hasTreeItems, 'Dropdown contains .topic-dropdown-tree-item elements after focus');
        if (hasTreeItems) {
            console.log('  Tree item count:', treeItems.length);
        }

        // Check that old topic-item elements are NOT present
        const oldItems = dropdown.querySelectorAll('.topic-item');
        const noOldItems = oldItems.length === 0;
        assert(noOldItems, 'Dropdown does NOT contain old .topic-item elements');
        if (!noOldItems) {
            console.log('  Warning: Found', oldItems.length, 'old .topic-item elements');
        }

        // Clean up
        searchInput.value = '';
        searchInput.blur();
        if (originalValue) {
            searchInput.value = originalValue;
        }
    }

    // Test 3: Topics with children render a collapse button
    async function test3() {
        console.log('\nTest 3: Topics with children render collapse button');
        const searchInput = document.getElementById('topic-search');
        const dropdown = document.getElementById('topic-dropdown');

        if (!searchInput || !dropdown) {
            console.log('  Skipping: dropdown elements not found');
            return;
        }

        const originalValue = searchInput.value;

        // Focus to render dropdown
        searchInput.focus();
        await delay(100);

        const collapseButtons = dropdown.querySelectorAll('.topic-dropdown-collapse-btn');
        const hasCollapseButtons = collapseButtons.length > 0;

        assert(hasCollapseButtons, 'Topics with children render collapse button');
        if (hasCollapseButtons) {
            console.log('  Collapse button count:', collapseButtons.length);
            console.log('  First button text:', collapseButtons[0].textContent);
        } else {
            console.log('  Info: No parent topics found in tree (all leaf topics)');
        }

        // Clean up
        searchInput.blur();
        if (originalValue) {
            searchInput.value = originalValue;
        }
    }

    // Test 4: Clicking collapse button changes child count in rendered list
    async function test4() {
        console.log('\nTest 4: Clicking collapse button changes rendered item count');
        const searchInput = document.getElementById('topic-search');
        const dropdown = document.getElementById('topic-dropdown');

        if (!searchInput || !dropdown) {
            console.log('  Skipping: dropdown elements not found');
            return;
        }

        const originalValue = searchInput.value;

        // Focus to render dropdown
        searchInput.focus();
        await delay(100);

        const collapseButtons = dropdown.querySelectorAll('.topic-dropdown-collapse-btn');

        if (collapseButtons.length === 0) {
            console.log('  Skipping: no collapse buttons found (all leaf topics)');
            searchInput.blur();
            if (originalValue) {
                searchInput.value = originalValue;
            }
            return;
        }

        // Get initial item count
        const initialItems = dropdown.querySelectorAll('.topic-dropdown-tree-item');
        const initialCount = initialItems.length;

        // Click first collapse button
        collapseButtons[0].click();
        await delay(100);

        const afterCollapseItems = dropdown.querySelectorAll('.topic-dropdown-tree-item');
        const afterCollapseCount = afterCollapseItems.length;

        // Verify dropdown remains open after collapse click
        const isDropdownVisible = !dropdown.classList.contains('hidden');
        assert(isDropdownVisible, 'Dropdown remains visible after collapse click');

        // Verify dropdown still contains items (didn't close unexpectedly)
        const hasItems = afterCollapseCount > 0;
        assert(hasItems, 'Dropdown contains items after collapse click');

        const countChanged = initialCount !== afterCollapseCount;
        assert(countChanged, 'Clicking collapse button changes rendered item count');

        if (countChanged && hasItems) {
            console.log('  Items before collapse:', initialCount);
            console.log('  Items after collapse:', afterCollapseCount);
        }

        // Get the collapse button again (DOM was re-rendered, old reference is stale)
        const newCollapseButtons = dropdown.querySelectorAll('.topic-dropdown-collapse-btn');
        if (newCollapseButtons.length > 0) {
            // Click again to expand
            newCollapseButtons[0].click();
        }

        // Clean up
        searchInput.blur();
        if (originalValue) {
            searchInput.value = originalValue;
        }
    }

    // Test 5: Typing in search filters items and renders highlights
    async function test5() {
        console.log('\nTest 5: Typing in search filters items and renders highlights');
        const searchInput = document.getElementById('topic-search');
        const dropdown = document.getElementById('topic-dropdown');

        if (!searchInput || !dropdown) {
            console.log('  Skipping: dropdown elements not found');
            return;
        }

        const originalValue = searchInput.value;

        // Focus to render dropdown
        searchInput.focus();
        await delay(100);

        // Type a search query
        searchInput.value = 'test';
        searchInput.dispatchEvent(new Event('input', { bubbles: true }));
        await delay(100);

        const treeItems = dropdown.querySelectorAll('.topic-dropdown-tree-item');
        const hasItems = treeItems.length > 0;

        if (!hasItems) {
            console.log('  Info: No topics match "test" search query');
        } else {
            console.log('  Tree item count after search:', treeItems.length);
        }

        // Check for search highlights
        const highlights = dropdown.querySelectorAll('.search-highlight');
        const hasHighlights = highlights.length > 0;

        if (hasItems) {
            assert(hasHighlights, 'Search results show highlighted text');
            if (hasHighlights) {
                console.log('  Highlight count:', highlights.length);
            }
        } else {
            console.log('  Skipping highlight check (no matching topics)');
        }

        // Clean up
        searchInput.value = '';
        searchInput.dispatchEvent(new Event('input', { bubbles: true }));
        searchInput.blur();
        if (originalValue) {
            searchInput.value = originalValue;
        }
    }

    // Test 6: Clearing search restores full tree
    async function test6() {
        console.log('\nTest 6: Clearing search restores full tree');
        const searchInput = document.getElementById('topic-search');
        const dropdown = document.getElementById('topic-dropdown');

        if (!searchInput || !dropdown) {
            console.log('  Skipping: dropdown elements not found');
            return;
        }

        const originalValue = searchInput.value;

        // Focus to render dropdown
        searchInput.focus();
        await delay(100);

        // Get initial item count (no search)
        const initialItems = dropdown.querySelectorAll('.topic-dropdown-tree-item');
        const initialCount = initialItems.length;
        console.log('  Initial item count (no search):', initialCount);

        // Type a search query
        searchInput.value = 'xyzzy123456789'; // Unlikely to match anything
        searchInput.dispatchEvent(new Event('input', { bubbles: true }));
        await delay(100);

        const duringSearchItems = dropdown.querySelectorAll('.topic-dropdown-tree-item');
        const duringSearchCount = duringSearchItems.length;
        console.log('  Item count during search:', duringSearchCount);

        // Clear search
        searchInput.value = '';
        searchInput.dispatchEvent(new Event('input', { bubbles: true }));
        await delay(100);

        const afterClearItems = dropdown.querySelectorAll('.topic-dropdown-tree-item');
        const afterClearCount = afterClearItems.length;
        console.log('  Item count after clearing search:', afterClearCount);

        const treeRestored = afterClearCount === initialCount;
        assert(treeRestored, 'Clearing search restores full tree with same item count');

        // Clean up
        searchInput.blur();
        if (originalValue) {
            searchInput.value = originalValue;
        }
    }

    // Test 7: Tree items have proper indentation based on depth
    async function test7() {
        console.log('\nTest 7: Tree items have proper indentation based on depth');
        const searchInput = document.getElementById('topic-search');
        const dropdown = document.getElementById('topic-dropdown');

        if (!searchInput || !dropdown) {
            console.log('  Skipping: dropdown elements not found');
            return;
        }

        const originalValue = searchInput.value;

        // Focus to render dropdown
        searchInput.focus();
        await delay(100);

        const treeItems = dropdown.querySelectorAll('.topic-dropdown-tree-item');

        if (treeItems.length === 0) {
            console.log('  Skipping: no tree items found');
            searchInput.blur();
            if (originalValue) {
                searchInput.value = originalValue;
            }
            return;
        }

        // Check that items have inline padding-left style
        const firstItemStyle = treeItems[0].style.paddingLeft;
        const hasInlinePadding = firstItemStyle !== '';

        assert(hasInlinePadding, 'Tree items have inline padding-left style for depth indentation');
        if (hasInlinePadding) {
            console.log('  First item padding-left:', firstItemStyle);
        }

        // Clean up
        searchInput.blur();
        if (originalValue) {
            searchInput.value = originalValue;
        }
    }

    // Test 8: Collapse state persists within session
    async function test8() {
        console.log('\nTest 8: Collapse state persists within session');
        const searchInput = document.getElementById('topic-search');
        const dropdown = document.getElementById('topic-dropdown');

        if (!searchInput || !dropdown) {
            console.log('  Skipping: dropdown elements not found');
            return;
        }

        const originalValue = searchInput.value;

        // Focus to render dropdown
        searchInput.focus();
        await delay(100);

        const collapseButtons = dropdown.querySelectorAll('.topic-dropdown-collapse-btn');

        if (collapseButtons.length === 0) {
            console.log('  Skipping: no collapse buttons found (all leaf topics)');
            return;
        }

        const initialItems = dropdown.querySelectorAll('.topic-dropdown-tree-item');
        const initialCount = initialItems.length;

        // Collapse first parent
        collapseButtons[0].click();
        await delay(100);

        const afterCollapseItems = dropdown.querySelectorAll('.topic-dropdown-tree-item');
        const afterCollapseCount = afterCollapseItems.length;

        // Blur and refocus to test persistence
        searchInput.blur();
        await delay(100);

        searchInput.focus();
        await delay(100);

        const afterRefocusItems = dropdown.querySelectorAll('.topic-dropdown-tree-item');
        const afterRefocusCount = afterRefocusItems.length;

        const statePersisted = afterRefocusCount === afterCollapseCount;
        assert(statePersisted, 'Collapse state persists when refocusing dropdown');

        if (statePersisted) {
            console.log('  Items after collapse:', afterCollapseCount);
            console.log('  Items after refocus:', afterRefocusCount);
        }

        // Restore expanded state
        const refocusedCollapseButtons = dropdown.querySelectorAll('.topic-dropdown-collapse-btn');
        if (refocusedCollapseButtons.length > 0) {
            refocusedCollapseButtons[0].click();
        }

        // Clean up
        searchInput.blur();
        if (originalValue) {
            searchInput.value = originalValue;
        }
    }

    // Run all tests sequentially
    (async function runTests() {
        console.log('='.repeat(60));
        console.log('Running Main Screen Dropdown Tree Tests');
        console.log('='.repeat(60));

        const tests = [test1, test2, test3, test4, test5, test6, test7, test8];

        for (let i = 0; i < tests.length; i++) {
            // Reset dropdown collapse state before each test
            if (window.resetDropdownCollapseState) {
                window.resetDropdownCollapseState();
            }
            try {
                await tests[i]();
            } catch (error) {
                console.error('✗ Test failed with exception:', error.message);
                console.error('  Stack:', error.stack);
                failed++;
            }
            await delay(300); // Wait for blur callbacks from previous test (200ms timeout)
        }

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
        window.topicDropdownTreeTestResults = {
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
})();
