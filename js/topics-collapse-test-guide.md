# Topic Collapse/Expand Feature - Test Guide

This guide helps you manually verify the expand/collapse functionality for topics.

## Manual Testing Steps

### 1. Basic Expand/Collapse Test
1. Start the application (`go run ./cmd/server`)
2. Open http://localhost:8080 in your browser
3. Click "Settings" button to open the settings modal
4. Scroll to the Topics section
5. Look for topics with children (they should show a child count like "(3)")
6. Verify that topics with children have a chevron icon button
7. Click a chevron button to collapse a topic
8. Verify:
   - The chevron rotates to point right (collapsed state)
   - The child topics disappear
   - The topic itself remains visible
9. Click the same chevron again to expand
10. Verify:
    - The chevron rotates to point down (expanded state)
    - The child topics reappear

### 2. Nested Collapse Test
1. Create a nested topic structure: Root -> Child 1 -> Child 2 -> Child 3
2. Collapse the Root topic
3. Verify all descendants (Child 1, Child 2, Child 3) are hidden
4. Expand the Root topic
5. Verify all descendants reappear
6. Collapse Child 1
7. Verify Child 2 and Child 3 are hidden, but Root and Child 1 are visible
8. Expand Child 1
9. Verify Child 2 and Child 3 reappear

### 3. Persistence Test (localStorage)
1. Collapse a topic with children
2. Refresh the browser page (F5)
3. Re-open the Settings modal
4. Verify the topic remains collapsed
5. Expand the topic
6. Refresh the browser page again
7. Verify the topic remains expanded

### 4. Drag-and-Drop Compatibility Test
1. Create multiple topics at different depths
2. Collapse some topics
3. Drag a topic and drop it into a different position
4. Verify:
   - The drag-and-drop works normally
   - The collapsed states are preserved
   - The tree structure updates correctly
5. Try dragging a topic into a collapsed parent
6. Verify the operation completes successfully

### 5. Tree Lines Compatibility Test
1. Create a nested topic structure with multiple levels
2. Verify tree lines (vertical connectors) are visible
3. Collapse and expand topics at various depths
4. Verify tree lines update correctly to show the new hierarchy

### 6. Multiple Topics Collapse Test
1. Create at least 3 topics with children
2. Collapse the first and third topics
3. Verify:
   - The first topic is collapsed
   - The second topic (and its children) remains expanded
   - The third topic is collapsed
4. Refresh the page
5. Verify all collapse states are preserved

## Browser Console Testing

You can run automated tests in the browser console:

1. Open the application in your browser
2. Open the browser console (F12 or Ctrl+Shift+I)
3. Copy and paste the content of `topics-collapse-test.js`
4. Press Enter to run the tests
5. Review the test results in the console

## Expected Results

- Topics with children display chevron buttons
- Chevron rotates between right (collapsed) and down (expanded) states
- Collapsed topics hide their children
- Collapsed state persists across page reloads
- Drag-and-drop continues to work with collapsed topics
- Tree lines render correctly with collapsed/expanded states

## Debugging

If issues occur:

1. Check console for JavaScript errors
2. Inspect localStorage for `topicCollapseState` key:
   ```javascript
   console.log(localStorage.getItem('topicCollapseState'));
   ```
3. Check the collapsed topic IDs in state:
   ```javascript
   console.log(window.state.collapsedTopicIds);
   ```
4. Manually test collapse toggle:
   ```javascript
   // Replace with actual topic ID
   window.toggleTopicCollapse('your-topic-id');
   window.renderTopicsList();
   ```
