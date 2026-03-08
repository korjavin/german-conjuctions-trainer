/**
 * Functional Tests for Topic Icons Feature
 *
 * These tests can be run in browser console by:
 * 1. Loading the page
 * 2. Opening browser console
 * 3. Pasting this entire file
 *
 * Tests cover:
 * - Folder icon rendering for topics with children
 * - File icon rendering for leaf topics
 * - Icon updates when structure changes
 * - Icon SVG elements and styling
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

    // Test 1: Verify getFolderIcon function exists and returns SVG
    tests.push(() => {
        const getFolderIcon = typeof window.getFolderIcon === 'function' ? window.getFolderIcon : null;
        assert(getFolderIcon !== null, 'getFolderIcon function is available');

        if (getFolderIcon) {
            const icon = getFolderIcon();
            assert(typeof icon === 'string', 'getFolderIcon returns a string');
            assert(icon.includes('<svg'), 'getFolderIcon returns SVG markup');
            assert(icon.includes('topic-icon-folder'), 'getFolderIcon includes folder icon class');
            console.log('  Folder icon snippet:', icon.substring(0, 50) + '...');
        }
    });

    // Test 2: Verify getFileIcon function exists and returns SVG
    tests.push(() => {
        const getFileIcon = typeof window.getFileIcon === 'function' ? window.getFileIcon : null;
        assert(getFileIcon !== null, 'getFileIcon function is available');

        if (getFileIcon) {
            const icon = getFileIcon();
            assert(typeof icon === 'string', 'getFileIcon returns a string');
            assert(icon.includes('<svg'), 'getFileIcon returns SVG markup');
            assert(icon.includes('topic-icon-file'), 'getFileIcon includes file icon class');
            console.log('  File icon snippet:', icon.substring(0, 50) + '...');
        }
    });

    // Test 3: Verify topic icon containers exist in DOM
    tests.push(() => {
        const iconContainers = document.querySelectorAll('.topic-icon');
        console.log('  Found', iconContainers.length, 'topic icon containers');
        assert(iconContainers.length > 0, 'Topic icon containers are rendered in DOM');
    });

    // Test 4: Verify folder icons have correct SVG structure
    tests.push(() => {
        const folderIcons = document.querySelectorAll('.topic-icon-folder');
        console.log('  Found', folderIcons.length, 'folder icons');

        if (folderIcons.length > 0) {
            let hasSvg = false;
            folderIcons.forEach(icon => {
                if (icon.tagName === 'svg') {
                    hasSvg = true;
                } else if (icon.querySelector && icon.querySelector('svg')) {
                    hasSvg = true;
                }
            });
            assert(hasSvg, 'Folder icons contain SVG elements');
        } else {
            console.log('  Note: No folder icons found (may be expected if no topics with children)');
        }
    });

    // Test 5: Verify file icons have correct SVG structure
    tests.push(() => {
        const fileIcons = document.querySelectorAll('.topic-icon-file');
        console.log('  Found', fileIcons.length, 'file icons');

        if (fileIcons.length > 0) {
            let hasSvg = false;
            fileIcons.forEach(icon => {
                if (icon.tagName === 'svg') {
                    hasSvg = true;
                } else if (icon.querySelector && icon.querySelector('svg')) {
                    hasSvg = true;
                }
            });
            assert(hasSvg, 'File icons contain SVG elements');
        } else {
            console.log('  Note: No file icons found (may be expected if all topics have children)');
        }
    });

    // Test 6: Verify topics with children have folder icons
    tests.push(() => {
        if (typeof window.state === 'undefined' || !window.state.topics) {
            console.log('  Skipping: no topics loaded');
            return;
        }

        const topicsWithChildren = window.state.topics.filter(t => t.children && t.children.length > 0);
        console.log('  Topics with children:', topicsWithChildren.length);

        if (topicsWithChildren.length > 0) {
            const folderIcons = document.querySelectorAll('.topic-icon-folder');
            console.log('  Folder icons found:', folderIcons.length);
            assert(folderIcons.length > 0, 'Topics with children have folder icons');

            // Verify at least one folder icon corresponds to a topic with children
            let foundMatch = false;
            const iconContainers = document.querySelectorAll('.topic-icon');
            iconContainers.forEach(container => {
                const topicId = container.dataset.topicId;
                if (topicId) {
                    const topic = window.state.topics.find(t => t.id === topicId);
                    if (topic && topic.children && topic.children.length > 0) {
                        if (container.querySelector('.topic-icon-folder')) {
                            foundMatch = true;
                        }
                    }
                }
            });
            assert(foundMatch, 'Folder icons are associated with topics that have children');
        }
    });

    // Test 7: Verify leaf topics have file icons
    tests.push(() => {
        if (typeof window.state === 'undefined' || !window.state.topics) {
            console.log('  Skipping: no topics loaded');
            return;
        }

        const leafTopics = window.state.topics.filter(t => !t.children || t.children.length === 0);
        console.log('  Leaf topics:', leafTopics.length);

        if (leafTopics.length > 0) {
            const fileIcons = document.querySelectorAll('.topic-icon-file');
            console.log('  File icons found:', fileIcons.length);
            assert(fileIcons.length > 0, 'Leaf topics have file icons');

            // Verify at least one file icon corresponds to a leaf topic
            let foundMatch = false;
            const iconContainers = document.querySelectorAll('.topic-icon');
            iconContainers.forEach(container => {
                const topicId = container.dataset.topicId;
                if (topicId) {
                    const topic = window.state.topics.find(t => t.id === topicId);
                    if (topic && (!topic.children || topic.children.length === 0)) {
                        if (container.querySelector('.topic-icon-file')) {
                            foundMatch = true;
                        }
                    }
                }
            });
            assert(foundMatch, 'File icons are associated with leaf topics');
        }
    });

    // Test 8: Verify icon styles are defined in CSS
    tests.push(() => {
        const iconElements = document.querySelectorAll('.topic-icon');
        if (iconElements.length === 0) {
            console.log('  Skipping: no icon elements found');
            return;
        }

        // Check if the first icon element has computed styles
        const firstIcon = iconElements[0];
        const computedStyle = window.getComputedStyle(firstIcon);
        const hasDisplay = computedStyle.display;
        assert(hasDisplay, 'Topic icons have CSS styling applied');
        console.log('  Icon display:', hasDisplay);
    });

    // Test 9: Verify icon colors match expected values
    tests.push(() => {
        const folderIcons = document.querySelectorAll('.topic-icon-folder');
        if (folderIcons.length === 0) {
            console.log('  Skipping: no folder icons found');
            return;
        }

        // Check that folder icon has expected color (amber/orange)
        let hasExpectedColor = false;
        folderIcons.forEach(icon => {
            const svgPath = icon.querySelector('path');
            if (svgPath) {
                const stroke = svgPath.getAttribute('stroke');
                const fill = svgPath.getAttribute('fill');
                // Check for amber/orange colors
                if (stroke && stroke.includes('f59e0b') || fill && fill.includes('f59e0b')) {
                    hasExpectedColor = true;
                }
            }
        });
        assert(hasExpectedColor, 'Folder icons have expected amber/orange color');
    });

    // Test 10: Verify icons are positioned correctly in topic item
    tests.push(() => {
        const topicNames = document.querySelectorAll('.topic-item-name');
        if (topicNames.length === 0) {
            console.log('  Skipping: no topic names found');
            return;
        }

        let iconsInTopicName = false;
        topicNames.forEach(name => {
            const icon = name.querySelector('.topic-icon');
            if (icon) {
                iconsInTopicName = true;
            }
        });
        assert(iconsInTopicName, 'Icons are positioned within topic name container');
    });

    // Test 11: Verify icon update on structure change (if renderTopicsList available)
    tests.push(() => {
        if (typeof window.renderTopicsList !== 'function') {
            console.log('  Skipping: renderTopicsList not available');
            return;
        }

        const iconCountBefore = document.querySelectorAll('.topic-icon').length;
        console.log('  Icons before render:', iconCountBefore);

        // Re-render topics
        window.renderTopicsList();

        const iconCountAfter = document.querySelectorAll('.topic-icon').length;
        console.log('  Icons after render:', iconCountAfter);

        assert(iconCountBefore === iconCountAfter, 'Icon count remains consistent after re-render');
    });

    // Test 12: Verify icon doesn't interfere with collapse button
    tests.push(() => {
        const collapseButtons = document.querySelectorAll('.topic-collapse-btn');
        const icons = document.querySelectorAll('.topic-icon');

        if (collapseButtons.length === 0 || icons.length === 0) {
            console.log('  Skipping: not enough elements to test');
            return;
        }

        // Check that both elements can exist in the same topic item
        const topicItems = document.querySelectorAll('.topic-item-name');
        let hasBoth = false;
        topicItems.forEach(item => {
            const hasCollapse = item.querySelector('.topic-collapse-btn');
            const hasIcon = item.querySelector('.topic-icon');
            if (hasCollapse && hasIcon) {
                hasBoth = true;
            }
        });
        assert(hasBoth, 'Icons and collapse buttons can coexist in topic items');
    });

    // Test 13: Verify icon dimensions are consistent
    tests.push(() => {
        const icons = document.querySelectorAll('.topic-icon');
        if (icons.length === 0) {
            console.log('  Skipping: no icons found');
            return;
        }

        let consistentSize = true;
        const firstSize = null;
        icons.forEach(icon => {
            const computedStyle = window.getComputedStyle(icon);
            const width = computedStyle.width;
            const height = computedStyle.height;
            if (firstSize === null) {
                firstSize = { width, height };
            } else if (width !== firstSize.width || height !== firstSize.height) {
                consistentSize = false;
            }
        });
        assert(consistentSize, 'All topic icons have consistent dimensions');
        if (firstSize) {
            console.log('  Icon size:', firstSize.width, 'x', firstSize.height);
        }
    });

    // Run all tests
    console.log('='.repeat(60));
    console.log('Running Topic Icons Tests');
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
        console.log('\n✗ Some tests failed. Please review output above.');
    }

    // Export test summary for programmatic access
    window.topicIconTestResults = {
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
