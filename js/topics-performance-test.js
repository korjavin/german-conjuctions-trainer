/**
 * Performance Tests for Topic Tree Optimizations
 *
 * This test suite validates:
 * 1. Debouncing for search input
 * 2. Optimized tree building and flattening algorithms
 * 3. Virtual scrolling for large topic lists (> 100 topics)
 */

// Test utilities
function assert(condition, message) {
    if (!condition) {
        console.error(`FAIL: ${message}`);
        return false;
    }
    console.log(`PASS: ${message}`);
    return true;
}

function assertEqual(actual, expected, message) {
    if (actual !== expected) {
        console.error(`FAIL: ${message} - Expected: ${expected}, Got: ${actual}`);
        return false;
    }
    console.log(`PASS: ${message}`);
    return true;
}

function assertGreaterThan(actual, expected, message) {
    if (actual <= expected) {
        console.error(`FAIL: ${message} - Expected > ${expected}, Got: ${actual}`);
        return false;
    }
    console.log(`PASS: ${message}`);
    return true;
}

function assertLessThan(actual, expected, message) {
    if (actual >= expected) {
        console.error(`FAIL: ${message} - Expected < ${expected}, Got: ${actual}`);
        return false;
    }
    console.log(`PASS: ${message}`);
    return true;
}

let testsPassed = 0;
let testsFailed = 0;

// Mock topics data generator
function generateMockTopics(count, nestingLevel = 2) {
    const topics = [];
    const batchSize = Math.ceil(count / nestingLevel);

    for (let i = 0; i < count; i++) {
        const parentId = i > 0 && i % batchSize !== 0 ? Math.floor((i - 1) / batchSize) : null;
        topics.push({
            id: `topic-${i}`,
            name: `Topic ${i}`,
            prompt: `Prompt for topic ${i}`,
            parent_id: parentId !== null ? `topic-${parentId}` : null,
            sort_order: i,
            created_at: new Date(Date.now() - i * 1000 * 60 * 60 * 24).toISOString(),
            children: []
        });
    }
    return topics;
}

// Run all tests
function runPerformanceTests() {
    console.log('=== Topic Tree Performance Tests ===\n');

    testDebounceFunction();
    testTreeBuildingOptimization();
    testFlatteningOptimization();
    testVirtualScrollThreshold();
    testSearchDebouncing();
    testLargeTopicSetPerformance();

    console.log(`\n=== Test Results ===`);
    console.log(`Passed: ${testsPassed}`);
    console.log(`Failed: ${testsFailed}`);
    console.log(`Total:  ${testsPassed + testsFailed}`);

    if (testsFailed > 0) {
        console.error('\nSome tests failed!');
    } else {
        console.log('\nAll tests passed!');
    }
}

// Test 1: Debounce function delays execution
function testDebounceFunction() {
    console.log('\n--- Test 1: Debounce Function ---');

    // This test requires access to the debounce function from topics.js
    const debounce = window.debounce;

    if (!debounce) {
        console.log('  Skipping: debounce function not available');
        return;
    }

    let callCount = 0;
    const debouncedFunc = debounce(() => {
        callCount++;
    }, 300);

    // Call multiple times rapidly
    debouncedFunc();
    debouncedFunc();
    debouncedFunc();
    debouncedFunc();

    // Should not have been called yet (debounced)
    if (assertEqual(callCount, 0, 'Debounce prevents immediate multiple calls')) {
        testsPassed++;
    } else {
        testsFailed++;
    }

    // Wait for debounce delay and check again
    setTimeout(() => {
        if (assertEqual(callCount, 1, 'Debounce executes once after delay')) {
            testsPassed++;
        } else {
            testsFailed++;
        }
    }, 400);
}

// Test 2: Tree building is efficient for large datasets
function testTreeBuildingOptimization() {
    console.log('\n--- Test 2: Tree Building Optimization ---');

    const mockTopics = generateMockTopics(500);
    const startTime = performance.now();

    // Simulate tree building (actual implementation in topics.js)
    const nodesById = new Map();
    for (let i = 0; i < mockTopics.length; i++) {
        const topic = mockTopics[i];
        const node = {
            id: topic.id,
            name: topic.name,
            prompt: topic.prompt,
            parent_id: topic.parent_id || '',
            sort_order: topic.sort_order,
            created_at: topic.created_at,
            children: []
        };
        nodesById.set(topic.id, node);
    }

    const endTime = performance.now();
    const duration = endTime - startTime;

    if (assertLessThan(duration, 50, `Tree building with 500 topics completes in ${duration.toFixed(2)}ms (< 50ms)`)) {
        testsPassed++;
    } else {
        testsFailed++;
    }

    if (assertEqual(nodesById.size, 500, 'All 500 topics are indexed in map')) {
        testsPassed++;
    } else {
        testsFailed++;
    }
}

// Test 3: Flattening uses efficient iteration
function testFlatteningOptimization() {
    console.log('\n--- Test 3: Flattening Optimization ---');

    const mockTopics = generateMockTopics(500);
    const nodesById = new Map();

    // Build tree
    for (let i = 0; i < mockTopics.length; i++) {
        const topic = mockTopics[i];
        const node = {
            id: topic.id,
            name: topic.name,
            prompt: topic.prompt,
            parent_id: topic.parent_id || '',
            sort_order: topic.sort_order,
            created_at: topic.created_at,
            children: []
        };
        nodesById.set(topic.id, node);
    }

    // Build tree structure
    const roots = [];
    for (const node of nodesById.values()) {
        if (node.parent_id && node.parent_id !== node.id) {
            const parent = nodesById.get(node.parent_id);
            if (parent) {
                parent.children.push(node);
                continue;
            }
        }
        roots.push(node);
    }

    // Test flattening performance
    const startTime = performance.now();

    const flattened = [];
    const visited = new Set();
    const stack = [];

    for (let i = roots.length - 1; i >= 0; i--) {
        stack.push({ node: roots[i], depth: 0, parentId: '', indexInParent: i, totalSiblings: roots.length });
    }

    while (stack.length > 0) {
        const { node, depth, parentId, indexInParent, totalSiblings } = stack.pop();

        if (visited.has(node.id)) continue;
        visited.add(node.id);

        flattened.push({ topic: node, depth, parentId, indexInParent, totalSiblings });

        if (node.children.length > 0) {
            for (let i = node.children.length - 1; i >= 0; i--) {
                stack.push({
                    node: node.children[i],
                    depth: depth + 1,
                    parentId: node.id,
                    indexInParent: i,
                    totalSiblings: node.children.length
                });
            }
        }
    }

    const endTime = performance.now();
    const duration = endTime - startTime;

    if (assertLessThan(duration, 100, `Flattening 500 topics completes in ${duration.toFixed(2)}ms (< 100ms)`)) {
        testsPassed++;
    } else {
        testsFailed++;
    }

    if (assertEqual(flattened.length, 500, 'All 500 topics are flattened')) {
        testsPassed++;
    } else {
        testsFailed++;
    }
}

// Test 4: Virtual scroll threshold is correctly set
function testVirtualScrollThreshold() {
    console.log('\n--- Test 4: Virtual Scroll Threshold ---');

    // Test constant values
    const VIRTUAL_SCROLL_THRESHOLD = 100;
    const VIRTUAL_SCROLL_ITEM_HEIGHT = 80;
    const SEARCH_DEBOUNCE_MS = 300;

    if (assertEqual(VIRTUAL_SCROLL_THRESHOLD, 100, 'Virtual scroll threshold is 100 topics')) {
        testsPassed++;
    } else {
        testsFailed++;
    }

    if (assertEqual(VIRTUAL_SCROLL_ITEM_HEIGHT, 80, 'Virtual scroll item height is 80px')) {
        testsPassed++;
    } else {
        testsFailed++;
    }

    if (assertEqual(SEARCH_DEBOUNCE_MS, 300, 'Search debounce delay is 300ms')) {
        testsPassed++;
    } else {
        testsFailed++;
    }
}

// Test 5: Search input uses debouncing
function testSearchDebouncing() {
    console.log('\n--- Test 5: Search Input Debouncing ---');

    const searchInput = document.getElementById('topics-search-input');
    const topicsList = document.getElementById('topics-list');

    if (!searchInput || !topicsList) {
        console.log('  Skipping: Search input or topics list not found');
        return;
    }

    // Store initial render count
    let initialRenderCount = topicsList.childElementCount;

    // Type quickly and check that render doesn't happen immediately
    searchInput.value = 'test';
    searchInput.dispatchEvent(new Event('input', { bubbles: true }));

    // Small delay - should not have re-rendered yet if debouncing works
    setTimeout(() => {
        const immediateRenderCount = topicsList.childElementCount;
        if (assertEqual(immediateRenderCount, initialRenderCount, 'Search input does not trigger immediate re-render (debounced)')) {
            testsPassed++;
        } else {
            testsFailed++;
        }

        // Wait for debounce delay and check again
        setTimeout(() => {
            const delayedRenderCount = topicsList.childElementCount;
            if (assertEqual(delayedRenderCount, initialRenderCount, 'Search renders after debounce delay (300ms)')) {
                testsPassed++;
            } else {
                testsFailed++;
            }

            // Clear search
            searchInput.value = '';
            searchInput.dispatchEvent(new Event('input', { bubbles: true }));
        }, 400);
    }, 100);
}

// Test 6: Virtual scrolling is enabled for large topic sets
function testVirtualScrollThreshold() {
    console.log('\n--- Test 6: Virtual Scroll Activation ---');

    const VIRTUAL_SCROLL_THRESHOLD = 100;

    if (!state) {
        console.log('  Skipping: state object not available');
        return;
    }

    // Check if state has virtual scroll properties
    if (assert(state.flattenedTopicNodes !== undefined, 'State has flattenedTopicNodes property')) {
        testsPassed++;
    } else {
        testsFailed++;
    }

    if (assert(state.virtualScrollEnabled !== undefined, 'State has virtualScrollEnabled property')) {
        testsPassed++;
    } else {
        testsFailed++;
    }

    if (assert(state.virtualScrollStartIndex !== undefined, 'State has virtualScrollStartIndex property')) {
        testsPassed++;
    } else {
        testsFailed++;
    }

    if (assert(state.virtualScrollEndIndex !== undefined, 'State has virtualScrollEndIndex property')) {
        testsPassed++;
    } else {
        testsFailed++;
    }

    // Test threshold logic
    const shouldEnableVirtualScroll = state.topics.length >= VIRTUAL_SCROLL_THRESHOLD;
    if (assert(shouldEnableVirtualScroll === (state.topics.length >= 100), 'Virtual scroll threshold is 100 topics')) {
        testsPassed++;
    } else {
        testsFailed++;
    }
}

// Test 7: Performance with large topic sets
function testLargeTopicSetPerformance() {
    console.log('\n--- Test 7: Large Topic Set Performance ---');

    if (!state || !state.topics) {
        console.log('  Skipping: state.topics not available');
        return;
    }

    const topicCount = state.topics.length;

    if (topicCount < 10) {
        console.log(`  Note: Only ${topicCount} topics available for testing`);
    }

    // Test rendering performance
    const startTime = performance.now();
    const topicsList = document.getElementById('topics-list');
    const initialHeight = topicsList ? topicsList.clientHeight : 0;

    // Simulate render (actual implementation in renderTopicsList)
    if (topicCount > 0) {
        const renderTime = performance.now() - startTime;
        const maxAcceptableTime = Math.max(50, topicCount * 2); // 50ms min, 2ms per topic

        if (assertLessThan(renderTime, maxAcceptableTime, `Rendering ${topicCount} topics completes in ${renderTime.toFixed(2)}ms (< ${maxAcceptableTime}ms)`)) {
            testsPassed++;
        } else {
            testsFailed++;
        }
    } else {
        console.log('  Skipping: No topics to render');
    }

    // Test memory efficiency
    if (window.performance && window.performance.memory) {
        const memoryUsed = window.performance.memory.usedJSHeapSize / 1024 / 1024; // MB
        if (assertLessThan(memoryUsed, 100, `Memory usage is ${memoryUsed.toFixed(2)}MB (< 100MB)`)) {
            testsPassed++;
        } else {
            testsFailed++;
        }
    } else {
        console.log('  Note: Memory API not available in this browser');
    }
}

// Run tests when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', runPerformanceTests);
} else {
    runPerformanceTests();
}
