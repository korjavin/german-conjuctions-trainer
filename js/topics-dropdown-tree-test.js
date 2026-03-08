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

    // Test 1: Verify dropdown element exists in DOM
    tests.push(() => {
        const dropdown = document.getElementById('topic-dropdown');
        const dropdownExists = dropdown !== null;
        assert(dropdownExists, 'Topic dropdown element exists in DOM');
        if (dropdownExists) {
            console.log('  Dropdown class:', dropdown.className);
            console.log('  Dropdown initially hidden:', dropdown.classList.contains('hidden'));
        }
    });

    // Test 2: After focusing topic search, dropdown contains tree items (not old topic-item)
    tests.push(() => {
        const searchInput = document.getElementById('topic-search');
        const dropdown = document.getElementById('topic-dropdown');

        if (!searchInput || !dropdown) {
            console.log('  Skipping: dropdown elements not found');
            return;
        }

        const originalValue = searchInput.value;

        // Focus the search input to trigger dropdown render
        searchInput.focus();

        // Wait a bit for render to complete
        setTimeout(() => {
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
        }, 100);
    });

    // Test 3: Topics with children render a collapse button
    tests.push(() => {
        const searchInput = document.getElementById('topic-search');
        const dropdown = document.getElementById('topic-dropdown');

        if (!searchInput || !dropdown) {
            console.log('  Skipping: dropdown elements not found');
            return;
        }

        const originalValue = searchInput.value;

        // Focus to render dropdown
        searchInput.focus();

        setTimeout(() => {
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
        }, 100);
    });

    // Test 4: Clicking collapse button changes child count in rendered list
    tests.push(() => {
        const searchInput = document.getElementById('topic-search');
        const dropdown = document.getElementById('topic-dropdown');

        if (!searchInput || !dropdown) {
            console.log('  Skipping: dropdown elements not found');
            return;
        }

        const originalValue = searchInput.value;

        // Focus to render dropdown
        searchInput.focus();

        setTimeout(() => {
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

            setTimeout(() => {
                const afterCollapseItems = dropdown.querySelectorAll('.topic-dropdown-tree-item');
                const afterCollapseCount = afterCollapseItems.length;

                const countChanged = initialCount !== afterCollapseCount;
                assert(countChanged, 'Clicking collapse button changes rendered item count');

                if (countChanged) {
                    console.log('  Items before collapse:', initialCount);
                    console.log('  Items after collapse:', afterCollapseCount);
                }

                // Click again to expand
                collapseButtons[0].click();

                // Clean up
                searchInput.blur();
                if (originalValue) {
                    searchInput.value = originalValue;
                }
            }, 100);
        }, 100);
    });

    // Test 5: Typing in search filters items and renders highlights
    tests.push(() => {
        const searchInput = document.getElementById('topic-search');
        const dropdown = document.getElementById('topic-dropdown');

        if (!searchInput || !dropdown) {
            console.log('  Skipping: dropdown elements not found');
            return;
        }

        const originalValue = searchInput.value;

        // Focus to render dropdown
        searchInput.focus();

        setTimeout(() => {
            // Type a search query
            searchInput.value = 'test';
            searchInput.dispatchEvent(new Event('input', { bubbles: true }));

            setTimeout(() => {
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
            }, 100);
        }, 100);
    });

    // Test 6: Clearing search restores full tree
    tests.push(() => {
        const searchInput = document.getElementById('topic-search');
        const dropdown = document.getElementById('topic-dropdown');

        if (!searchInput || !dropdown) {
            console.log('  Skipping: dropdown elements not found');
            return;
        }

        const originalValue = searchInput.value;

        // Focus to render dropdown
        searchInput.focus();

        setTimeout(() => {
            // Get initial item count (no search)
            const initialItems = dropdown.querySelectorAll('.topic-dropdown-tree-item');
            const initialCount = initialItems.length;
            console.log('  Initial item count (no search):', initialCount);

            // Type a search query
            searchInput.value = 'xyzzy123456789'; // Unlikely to match anything
            searchInput.dispatchEvent(new Event('input', { bubbles: true }));

            setTimeout(() => {
                const duringSearchItems = dropdown.querySelectorAll('.topic-dropdown-tree-item');
                const duringSearchCount = duringSearchItems.length;
                console.log('  Item count during search:', duringSearchCount);

                // Clear search
                searchInput.value = '';
                searchInput.dispatchEvent(new Event('input', { bubbles: true }));

                setTimeout(() => {
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
                }, 100);
            }, 100);
        }, 100);
    });

    // Test 7: Tree items have proper indentation based on depth
    tests.push(() => {
        const searchInput = document.getElementById('topic-search');
        const dropdown = document.getElementById('topic-dropdown');

        if (!searchInput || !dropdown) {
            console.log('  Skipping: dropdown elements not found');
            return;
        }

        const originalValue = searchInput.value;

        // Focus to render dropdown
        searchInput.focus();

        setTimeout(() => {
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
        }, 100);
    });

    // Test 8: Collapse state persists within session
    tests.push(() => {
        const searchInput = document.getElementById('topic-search');
        const dropdown = document.getElementById('topic-dropdown');

        if (!searchInput || !dropdown) {
            console.log('  Skipping: dropdown elements not found');
            return;
        }

        const collapseButtons = dropdown.querySelectorAll('.topic-dropdown-collapse-btn');

        if (collapseButtons.length === 0) {
            console.log('  Skipping: no collapse buttons found (all leaf topics)');
            return;
        }

        const originalValue = searchInput.value;

        // Focus to render dropdown
        searchInput.focus();

        setTimeout(() => {
            const initialItems = dropdown.querySelectorAll('.topic-dropdown-tree-item');
            const initialCount = initialItems.length;

            // Collapse first parent
            collapseButtons[0].click();

            setTimeout(() => {
                const afterCollapseItems = dropdown.querySelectorAll('.topic-dropdown-tree-item');
                const afterCollapseCount = afterCollapseItems.length;

                // Blur and refocus to test persistence
                searchInput.blur();

                setTimeout(() => {
                    searchInput.focus();

                    setTimeout(() => {
                        const afterRefocusItems = dropdown.querySelectorAll('.topic-dropdown-tree-item');
                        const afterRefocusCount = afterRefocusItems.length;

                        const statePersisted = afterRefocusCount === afterCollapseCount;
                        assert(statePersisted, 'Collapse state persists when refocusing dropdown');

                        if (statePersisted) {
                            console.log('  Items after collapse:', afterCollapseCount);
                            console.log('  Items after refocus:', afterRefocusCount);
                        }

                        // Restore expanded state
                        collapseButtons[0].click();

                        // Clean up
                        searchInput.blur();
                        if (originalValue) {
                            searchInput.value = originalValue;
                        }
                    }, 100);
                }, 100);
            }, 100);
        }, 100);
    });

    // Run all tests
    console.log('='.repeat(60));
    console.log('Running Main Screen Dropdown Tree Tests');
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

    // Summary (displayed after all async tests complete)
    setTimeout(() => {
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
    }, 2000); // Wait for all async tests to complete
})();
