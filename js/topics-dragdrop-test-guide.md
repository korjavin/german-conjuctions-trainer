# Drag-and-Drop Visual Feedback Test Guide

This guide provides step-by-step instructions for manually testing the improved drag-and-drop visual feedback in the topic tree.

## Setup

1. Start the application:
   ```bash
   go run .
   ```

2. Open http://localhost:8080 in your browser

3. Click "Settings" button to open settings modal

4. Scroll to the Topics section

## Test Cases

### 1. Ghost Element Preview Test

1. Create at least 3 topics (root level)

2. Start dragging one of the topics (click and hold on the topic)

3. Verify:
   - A semi-transparent ghost element appears following your cursor
   - Ghost element has a blue border (2px solid #2563eb)
   - Ghost element has a drop shadow
   - Ghost element is slightly rotated (2 degrees)
   - Ghost element has pointer-events: none (doesn't block interaction)

4. Move the cursor around the page

5. Verify:
   - Ghost element follows cursor smoothly
   - Ghost element stays in front of other elements (high z-index)

### 2. Drop Zone Indicator Test

1. Create at least 2 topics at the same level

2. Start dragging one topic

3. Hover over the gap between topics

4. Verify:
   - A drop zone indicator appears in the gap
   - Drop zone has a dashed blue border (2px dashed #2563eb)
   - Drop zone has a light blue background (#eff6ff)
   - Drop zone expands in height (from 0.75rem to 1.5rem)
   - Drop zone has a subtle pulse animation

5. Move cursor away from the drop zone

6. Verify:
   - Drop zone indicator disappears smoothly (with transition)

### 3. Parent Topic Highlight Test

1. Create a parent topic with at least 1 child topic

2. Create another root-level topic

3. Start dragging the root-level topic

4. Hover over the parent topic (to make it a child)

5. Verify:
   - Parent topic gets highlighted with a blue border
   - Parent topic gets a light blue gradient background
   - Parent topic gets a blue box-shadow
   - Parent topic scales up slightly (scale(1.02))

6. Move cursor away

7. Verify:
   - Parent highlight disappears smoothly
   - Parent scales back to normal size

### 4. Sibling Reordering Highlight Test

1. Create at least 3 topics at the same level

2. Start dragging one topic

3. Hover over another topic at the same level

4. Verify:
   - The hovered topic gets a light blue border
   - The hovered topic gets a light blue background
   - The hovered topic gets a subtle box-shadow

### 5. Drop Animation Test

1. Create at least 2 topics

2. Drag and drop one topic onto the other (or between topics)

3. Verify:
   - After successful drop, the target topic shows a brief animation
   - Animation shows a scale-up then scale-down effect
   - Animation has a blue glow that fades out
   - Animation lasts approximately 0.4 seconds
   - Tree re-renders after animation completes

### 6. Cursor Feedback Test

1. Hover over a draggable topic

2. Verify:
   - Cursor changes to 'grab' (open hand)

3. Start dragging the topic

4. Verify:
   - Cursor changes to 'grabbing' (closed hand)

5. Drop the topic

6. Verify:
   - Cursor returns to 'grab'

### 7. Topic Dragging Visuals Test

1. Start dragging a topic

2. Verify:
   - Original topic becomes semi-transparent (opacity: 0.4)
   - Original topic scales down slightly (scale(0.98))
   - Original topic gets a drop shadow
   - Original topic maintains its position during drag

3. Drop the topic

4. Verify:
   - Topic returns to full opacity
   - Topic returns to normal scale
   - Topic shadow disappears
   - Transition is smooth

### 8. CSS Transitions Test

1. Start and stop dragging topics multiple times

2. Verify:
   - All state changes (opacity, scale, border, background) have smooth transitions
   - Transitions use cubic-bezier easing for natural motion
   - Transitions last approximately 0.2s for most properties
   - No jarring or abrupt visual changes

### 9. Drop Zone Pulse Animation Test

1. Start dragging a topic

2. Hover over a drop zone (gap between topics)

3. Verify:
   - Drop zone has a pulsing glow effect
   - Pulse animation cycles between two states
   - Pulse animation is smooth and subtle
   - Pulse doesn't distract from the drag operation

### 10. Multiple Topics Test

1. Create a complex tree structure:
   - Root Topic A
     - Child A1
     - Child A2
   - Root Topic B
     - Child B1
   - Root Topic C

2. Test dragging each type of node

3. Verify:
   - Ghost element appears for all draggable topics
   - Drop zones appear correctly at all levels
   - Parent highlights work for all parent topics
   - Sibling highlights work for all siblings
   - Animations work consistently across all topics

### 11. Collapsed Topics Test

1. Create topics at multiple depths

2. Collapse some parent topics

3. Drag a topic

4. Verify:
   - Ghost element still appears
   - Drop zones still work
   - Visual feedback is not affected by collapsed state

### 12. Edge Cases Test

1. Try dragging to invalid locations:
   - Drag topic to itself (should not work)
   - Drag parent to its own descendant (should show alert)
   - Drag topic outside the drop zone

2. Verify:
   - Invalid drops are prevented
   - Error messages are clear
   - Visual feedback is removed after failed drop
   - No ghost element remains after failed drop

## Browser Console Testing

For automated testing, run the test suite in the browser console:

```javascript
// Import and run the tests
import { runDragDropTests } from './js/topics-dragdrop-test.js';
runDragDropTests();
```

Or if running from the browser directly:

1. Open the browser console (F12)
2. Paste the contents of topics-dragdrop-test.js
3. Run: `runDragDropTests()`

## Expected Results

After completing all tests, verify the following:

- Ghost element appears during drag and follows cursor smoothly
- Drop zones are clearly visible with dashed blue borders
- Parent topics highlight with blue border and gradient when accepting children
- Sibling topics highlight with light blue when reordering
- Successful drops show a brief scale/glow animation
- Cursor changes between 'grab' and 'grabbing' appropriately
- All transitions are smooth with cubic-bezier easing
- Drop zones have a subtle pulse animation
- Dragged topics are semi-transparent and scaled down
- Visual feedback works correctly with collapsed/expanded states
- Invalid drops are prevented and visual feedback is cleaned up

## Known Issues

None at this time.

## Browser Compatibility

Test in multiple browsers:
- Chrome/Edge (Chromium)
- Firefox
- Safari

Note: Drag-and-drop behavior may vary slightly between browsers, especially with custom drag images.
