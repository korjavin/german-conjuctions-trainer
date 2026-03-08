# Top-Level Topic Sorting - Test Guide

This guide helps you manually verify the top-level topic sorting functionality.

## Manual Testing Steps

### 1. Basic Sort Functionality Test
1. Start the application (`go run ./cmd/server`)
2. Open http://localhost:8080 in your browser
3. Click "Settings" button to open the settings modal
4. Scroll to the Topics section
5. Locate the "Sort by:" dropdown near "Add New Topic" button
6. Verify the dropdown has these options:
   - Tree Order (Manual)
   - Name (A-Z)
   - Name (Z-A)
   - Newest First
   - Oldest First

### 2. Tree Order Sort Test (Default)
1. Ensure "Sort by:" is set to "Tree Order (Manual)"
2. Verify topics are displayed in their manual/custom order (based on sort_order field)
3. Create a few topics at different positions
4. Verify they appear in the order you manually arranged them (via drag-and-drop)

### 3. Name (A-Z) Sort Test
1. Set "Sort by:" to "Name (A-Z)"
2. Verify top-level topics are sorted alphabetically (A to Z)
3. Verify nested children (topics with parent) maintain their tree/manual order
4. Create topics with names like "Zebra", "Apple", "Mango"
5. Verify they appear as: Apple, Mango, Zebra

### 4. Name (Z-A) Sort Test
1. Set "Sort by:" to "Name (Z-A)"
2. Verify top-level topics are sorted alphabetically in reverse (Z to A)
3. Create topics with names like "Zebra", "Apple", "Mango"
4. Verify they appear as: Zebra, Mango, Apple

### 5. Newest First Sort Test
1. Set "Sort by:" to "Newest First"
2. Verify top-level topics are sorted by creation date (newest at top)
3. Create a new topic
4. Verify it appears at the top of the list (immediately)
5. Verify existing topics with older dates appear below

### 6. Oldest First Sort Test
1. Set "Sort by:" to "Oldest First"
2. Verify top-level topics are sorted by creation date (oldest at top)
3. Create a new topic
4. Verify it appears at the bottom of the list
5. Verify existing topics with older dates appear above

### 7. Nested Children Preserved Test
1. Create a nested structure:
   - Topic A (root)
     - Child 1
     - Child 2
   - Topic B (root)
     - Child 3
2. Manually arrange children in specific order (via drag-and-drop)
3. Change top-level sort to "Name (A-Z)"
4. Verify:
   - Topic A and Topic B may reorder alphabetically
   - Child 1 and Child 2 remain in their original manual order under Topic A
   - Child 3 remains in its position under Topic B
5. Change top-level sort back to "Tree Order"
6. Verify all topics (top-level and nested) return to their manual order

### 8. Sort Persistence Test (localStorage)
1. Set "Sort by:" to "Name (A-Z)"
2. Verify topics are sorted alphabetically
3. Refresh the browser page (F5)
4. Re-open Settings modal
5. Verify "Sort by:" still shows "Name (A-Z)"
6. Verify topics are still sorted alphabetically
7. Repeat with other sort options

### 9. Drag-and-Drop Compatibility Test
1. Set "Sort by:" to "Tree Order (Manual)"
2. Drag a topic to a new position
3. Verify the topic moves correctly
4. Set "Sort by:" to "Name (A-Z)"
5. Verify topics are sorted alphabetically
6. Try to drag a topic
7. Verify drag-and-drop still works (visual feedback should appear)
8. After drop, the topic should remain sorted alphabetically

### 10. Expand/Collapse Compatibility Test
1. Create nested topics with multiple levels
2. Set "Sort by:" to "Name (A-Z)"
3. Collapse a topic with children
4. Verify children are hidden
5. Expand the topic
6. Verify children reappear in their manual order (not alphabetically sorted)
7. Repeat with other sort options

### 11. Tree Lines Compatibility Test
1. Create a nested topic structure with multiple levels
2. Verify tree lines (vertical connectors) are visible
3. Change between different sort options
4. Verify tree lines update correctly to show the new hierarchy

### 12. Search Compatibility Test
1. Set "Sort by:" to "Name (A-Z)"
2. Type a search term in the search box
3. Verify matching topics are found
4. Verify the matching topics are still sorted alphabetically
5. Clear search
6. Verify all topics are shown in alphabetical order

### 13. Multiple Topics Sort Test
1. Create at least 5 top-level topics with varying names and dates
2. Test each sort option:
   - Tree Order (Manual): Verify custom order
   - Name (A-Z): Verify alphabetical order
   - Name (Z-A): Verify reverse alphabetical order
   - Newest First: Verify newest topic at top
   - Oldest First: Verify oldest topic at top
3. For each option, verify nested children maintain their tree order

## Browser Console Testing

You can run automated tests in the browser console:

1. Open the application in your browser
2. Open browser console (F12 or Ctrl+Shift+I)
3. Copy and paste the content of `topics-sort-test.js`
4. Press Enter to run the tests
5. Review the test results in the console

## Expected Results

- Sort dropdown is visible and functional in the Settings modal
- All sort options work correctly (tree, name-asc, name-desc, date-newest, date-oldest)
- Only top-level topics are affected by sorting
- Nested children maintain their tree/manual order regardless of top-level sort
- Sort preference persists across page reloads
- Drag-and-drop continues to work with sorted topics
- Expand/collapse continues to work with sorted topics
- Tree lines render correctly with different sort orders
- Search/filter works correctly with sorted topics

## Debugging

If issues occur:

1. Check console for JavaScript errors
2. Inspect localStorage for `topicSortOrder` key:
   ```javascript
   console.log(localStorage.getItem('topicSortOrder'));
   ```
3. Check the sort order in state:
   ```javascript
   console.log(window.state.topicSortOrder);
   ```
4. Manually test sort order change:
   ```javascript
   // Change sort order
   window.state.topicSortOrder = 'name-asc';
   window.renderTopicsList();
   ```
5. Check buildTopicTree output:
   ```javascript
   const result = window.buildTopicTree(window.state.topics, 'name-asc');
   console.log('Roots:', result.roots.map(r => r.name));
   ```
6. Verify nested children structure:
   ```javascript
   const { roots } = window.buildTopicTree(window.state.topics, 'name-asc');
   roots.forEach(root => {
       console.log('Root:', root.name);
       root.children.forEach(child => {
           console.log('  Child:', child.name, '(sort_order:', child.sort_order + ')');
       });
   });
   ```
