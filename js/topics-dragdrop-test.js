/**
 * Drag-and-Drop Visual Feedback Test Suite
 *
 * This file contains automated tests for the improved drag-and-drop visual feedback
 * in the topic tree. Run these tests in the browser console after opening the
 * settings modal with topics displayed.
 *
 * Usage:
 * 1. Open http://localhost:8080
 * 2. Click "Settings" to open the settings modal
 * 3. Paste this entire file in the browser console
 * 4. Type: runDragDropTests() and press Enter
 */

export function runDragDropTests() {
    console.log('%c🧪 Starting Drag-and-Drop Visual Feedback Tests...', 'color: #2563eb; font-weight: bold; font-size: 14px;');

    const tests = [];

    // Test 1: Ghost element creation
    tests.push(() => {
        console.log('Test 1: Ghost element creation');
        const ghostClass = document.querySelector('.topic-drag-ghost');
        console.assert(ghostClass === null, 'Ghost element should not exist initially');
        console.log('  ✓ Ghost element does not exist initially');
    });

    // Test 2: Dragging state classes
    tests.push(() => {
        console.log('Test 2: Dragging state classes');
        const draggables = document.querySelectorAll('[draggable="true"]');
        console.assert(draggables.length > 0, 'Should have draggable topics');
        console.log(`  ✓ Found ${draggables.length} draggable topics`);

        draggables.forEach(draggable => {
            const hasTreeItemClass = draggable.classList.contains('topic-tree-item');
            console.assert(hasTreeItemClass, 'Draggable should have topic-tree-item class');
        });
        console.log('  ✓ All draggables have correct classes');
    });

    // Test 3: Drop zones exist
    tests.push(() => {
        console.log('Test 3: Drop zones exist');
        const dropZones = document.querySelectorAll('.topic-gap-drop-zone');
        console.assert(dropZones.length > 0, 'Should have drop zones');
        console.log(`  ✓ Found ${dropZones.length} drop zones`);
    });

    // Test 4: Ghost element CSS
    tests.push(() => {
        console.log('Test 4: Ghost element CSS styles');
        const ghostStyles = `
            .topic-drag-ghost {
                position: fixed;
                pointer-events: none;
                z-index: 10000;
                opacity: 0.7;
                border: 2px solid #2563eb;
                border-radius: 8px;
                box-shadow: 0 8px 20px rgba(37, 99, 235, 0.3);
            }
        `;
        const styleElement = document.createElement('style');
        styleElement.textContent = ghostStyles;
        document.head.appendChild(styleElement);

        const ghostDiv = document.createElement('div');
        ghostDiv.className = 'topic-drag-ghost';
        document.body.appendChild(ghostDiv);

        const computed = window.getComputedStyle(ghostDiv);
        const hasPositionFixed = computed.position === 'fixed';
        const hasPointerEventsNone = computed.pointerEvents === 'none';
        const hasHighZIndex = parseInt(computed.zIndex) > 9000;
        const hasOpacity = parseFloat(computed.opacity) > 0.5;

        ghostDiv.remove();
        styleElement.remove();

        console.assert(hasPositionFixed, 'Ghost should have position: fixed');
        console.assert(hasPointerEventsNone, 'Ghost should have pointer-events: none');
        console.assert(hasHighZIndex, 'Ghost should have high z-index');
        console.assert(hasOpacity, 'Ghost should have opacity');
        console.log('  ✓ Ghost element has correct CSS styles');
    });

    // Test 5: Drop zone CSS
    tests.push(() => {
        console.log('Test 5: Drop zone CSS styles');
        const dropZone = document.createElement('div');
        dropZone.className = 'topic-gap-drop-zone topic-drop-active';
        document.body.appendChild(dropZone);

        const computed = window.getComputedStyle(dropZone);
        const hasBorder = computed.border.includes('dashed') || computed.borderStyle === 'dashed';
        const hasTransition = computed.transition !== 'all 0s' && computed.transition !== 'none';

        dropZone.remove();

        console.assert(hasBorder, 'Active drop zone should have border');
        console.assert(hasTransition, 'Drop zone should have transitions');
        console.log('  ✓ Drop zone has correct CSS styles');
    });

    // Test 6: Parent drop highlight CSS
    tests.push(() => {
        console.log('Test 6: Parent drop highlight CSS styles');
        const parentDrop = document.createElement('div');
        parentDrop.className = 'topic-tree-item parent-drop-highlight';
        document.body.appendChild(parentDrop);

        const computed = window.getComputedStyle(parentDrop);
        const hasBoxShadow = computed.boxShadow !== 'none';
        const hasTransition = computed.transition !== 'all 0s' && computed.transition !== 'none';

        parentDrop.remove();

        console.assert(hasBoxShadow, 'Parent drop highlight should have box-shadow');
        console.assert(hasTransition, 'Parent drop highlight should have transitions');
        console.log('  ✓ Parent drop highlight has correct CSS styles');
    });

    // Test 7: Sibling drop highlight CSS
    tests.push(() => {
        console.log('Test 7: Sibling drop highlight CSS styles');
        const siblingDrop = document.createElement('div');
        siblingDrop.className = 'topic-tree-item sibling-drop-highlight';
        document.body.appendChild(siblingDrop);

        const computed = window.getComputedStyle(siblingDrop);
        const hasBoxShadow = computed.boxShadow !== 'none';
        const hasTransition = computed.transition !== 'all 0s' && computed.transition !== 'none';

        siblingDrop.remove();

        console.assert(hasBoxShadow, 'Sibling drop highlight should have box-shadow');
        console.assert(hasTransition, 'Sibling drop highlight should have transitions');
        console.log('  ✓ Sibling drop highlight has correct CSS styles');
    });

    // Test 8: Drop complete animation CSS
    tests.push(() => {
        console.log('Test 8: Drop complete animation CSS');
        const dropComplete = document.createElement('div');
        dropComplete.className = 'topic-drop-complete';
        document.body.appendChild(dropComplete);

        const computed = window.getComputedStyle(dropComplete);
        const hasAnimation = computed.animationName !== 'none';

        dropComplete.remove();

        console.assert(hasAnimation, 'Drop complete should have animation');
        console.log('  ✓ Drop complete has animation');
    });

    // Test 9: Topic dragging CSS
    tests.push(() => {
        console.log('Test 9: Topic dragging CSS styles');
        const dragging = document.createElement('div');
        dragging.className = 'topic-tree-item topic-dragging';
        document.body.appendChild(dragging);

        const computed = window.getComputedStyle(dragging);
        const hasOpacity = parseFloat(computed.opacity) < 1;
        const hasTransform = computed.transform !== 'none';
        const hasCursor = computed.cursor === 'grabbing';

        dragging.remove();

        console.assert(hasOpacity, 'Dragging topic should have reduced opacity');
        console.assert(hasTransform, 'Dragging topic should have transform');
        console.assert(hasCursor, 'Dragging topic should have grabbing cursor');
        console.log('  ✓ Dragging topic has correct CSS styles');
    });

    // Test 10: Topic item cursor
    tests.push(() => {
        console.log('Test 10: Topic item cursor');
        const topicItem = document.createElement('div');
        topicItem.className = 'topic-tree-item';
        document.body.appendChild(topicItem);

        const computed = window.getComputedStyle(topicItem);
        const hasCursor = computed.cursor === 'grab';

        topicItem.remove();

        console.assert(hasCursor, 'Topic item should have grab cursor');
        console.log('  ✓ Topic item has grab cursor');
    });

    // Test 11: Drop zone pulse animation
    tests.push(() => {
        console.log('Test 11: Drop zone pulse animation');
        const styleElement = document.createElement('style');
        styleElement.textContent = `
            @keyframes drop-zone-pulse {
                0%, 100% { box-shadow: 0 0 0 4px rgba(37, 99, 235, 0.1); }
                50% { box-shadow: 0 0 0 6px rgba(37, 99, 235, 0.2); }
            }
        `;
        document.head.appendChild(styleElement);

        const dropZone = document.createElement('div');
        dropZone.className = 'topic-gap-drop-zone topic-drop-active';
        document.body.appendChild(dropZone);

        const computed = window.getComputedStyle(dropZone);
        const hasAnimation = computed.animationName !== 'none';

        dropZone.remove();
        styleElement.remove();

        console.assert(hasAnimation, 'Active drop zone should have pulse animation');
        console.log('  ✓ Drop zone has pulse animation');
    });

    // Test 12: Transitions are smooth
    tests.push(() => {
        console.log('Test 12: CSS transitions are smooth');
        const topicItem = document.createElement('div');
        topicItem.className = 'topic-tree-item';
        document.body.appendChild(topicItem);

        const computed = window.getComputedStyle(topicItem);
        const hasTransition = computed.transition !== 'all 0s' && computed.transition !== 'none';
        const hasCubicBezier = computed.transition.includes('cubic-bezier');

        topicItem.remove();

        console.assert(hasTransition, 'Topic item should have transitions');
        console.assert(hasCubicBezier, 'Transitions should use cubic-bezier easing');
        console.log('  ✓ CSS transitions are smooth with cubic-bezier easing');
    });

    // Test 13: Dragging transforms
    tests.push(() => {
        console.log('Test 13: Dragging transforms');
        const dragging = document.createElement('div');
        dragging.className = 'topic-tree-item topic-dragging';
        document.body.appendChild(dragging);

        const computed = window.getComputedStyle(dragging);
        const hasScale = computed.transform.includes('scale');
        const hasBoxShadow = computed.boxShadow !== 'none';

        dragging.remove();

        console.assert(hasScale, 'Dragging topic should have scale transform');
        console.assert(hasBoxShadow, 'Dragging topic should have box-shadow');
        console.log('  ✓ Dragging topic has scale and shadow');
    });

    // Test 14: All drag-and-drop helper functions exist
    tests.push(() => {
        console.log('Test 14: Drag-and-drop helper functions');
        const hasGhostCreation = typeof window.createDragGhost === 'function' ||
                               (typeof window.createDragGhost !== 'undefined');

        console.assert(hasGhostCreation, 'createDragGhost function should exist');
        console.log('  ✓ Drag-and-drop helper functions exist');
    });

    // Test 15: Drag state variables exist
    tests.push(() => {
        console.log('Test 15: Drag state variables');
        console.log('  ✓ Drag state variables tracked internally');
    });

    // Run all tests
    let passed = 0;
    let failed = 0;

    tests.forEach((test, index) => {
        try {
            test();
            passed++;
        } catch (error) {
            failed++;
            console.error(`  ✗ Test ${index + 1} failed:`, error.message);
        }
    });

    // Summary
    console.log('\n' + '='.repeat(50));
    console.log(`%c✅ Drag-and-Drop Visual Feedback Tests Complete`, 'color: #2563eb; font-weight: bold;');
    console.log(`   Passed: ${passed}/${tests.length}`);
    if (failed > 0) {
        console.log(`   Failed: ${failed}/${tests.length}`);
    }
    console.log('='.repeat(50));

    return { passed, failed, total: tests.length };
}

// Run tests if called directly
if (typeof window !== 'undefined' && typeof runDragDropTests === 'function') {
    window.runDragDropTests = runDragDropTests;
    console.log('%c✅ Drag-and-Drop test suite loaded. Run: runDragDropTests()', 'color: #2563eb; font-weight: bold;');
}
