# Topic Icons Feature - Test Guide

This guide helps you manually verify the topic icons functionality.

## Manual Testing Steps

### 1. Basic Icon Display Test
1. Start the application (`go run ./cmd/server`)
2. Open http://localhost:8080 in your browser
3. Click "Settings" button to open settings modal
4. Scroll to Topics section
5. Verify:
   - Topics with children display a folder icon (orange/amber colored)
   - Topics without children display a file icon (gray colored)
   - Icons are positioned before the "::" separator
   - Icons are clearly visible and have proper spacing

### 2. Icon Color and Style Test
1. Look at the folder icons
2. Verify the folder icon is orange/amber colored (expected: #f59e0b)
3. Verify the folder has a light orange fill background
4. Look at the file icons
5. Verify the file icon is gray colored (expected: #6b7280)
6. Verify the file icon has a document-like appearance with folded corner

### 3. Icon with Children Badge Test
1. Find a topic with children (it should have a badge like "(3)")
2. Verify:
   - The topic displays a folder icon
   - The child count badge is still visible
   - The icon, "::" separator, name, and badge are properly aligned

### 4. Icon with Collapse Button Test
1. Find a topic with children
2. Verify:
   - The collapse button (chevron) is visible
   - The folder icon is visible
   - Both elements are properly spaced
   - Clicking the collapse button doesn't affect the icon

### 5. Dynamic Icon Update Test
1. Note the current icon for a leaf topic (should be file icon)
2. Add a child topic to that leaf topic
3. Verify:
   - The topic now displays a folder icon instead of file icon
   - The icon update happens immediately after adding the child
4. Delete the child topic
5. Verify:
   - The topic now displays a file icon again
   - The icon update happens immediately after deleting the child

### 6. Multiple Topics Icon Test
1. Create several topics at different hierarchy levels
2. Verify:
   - All topics display appropriate icons based on their children
   - Root topics with children show folder icons
   - Child topics with their own children show folder icons
   - Leaf topics at any depth show file icons

### 7. Icon Size Consistency Test
1. Look at multiple topic items
2. Verify:
   - All folder icons are the same size
   - All file icons are the same size
   - Icons are vertically centered with the topic name

### 8. Icon Accessibility Test
1. Inspect the icon elements in browser dev tools
2. Verify:
   - Icons are properly sized for readability
   - Icon colors have sufficient contrast
   - Icons don't interfere with text readability

### 9. Icon with Tree Lines Test
1. Create a nested topic structure with at least 3 levels
2. Verify:
   - Tree lines are visible
   - Icons are positioned correctly relative to tree lines
   - Icons and tree lines don't overlap
   - The visual hierarchy remains clear with icons present

### 10. Icon Persistence Test
1. Collapse or expand topics
2. Verify:
   - Icons remain visible in all states
   - Icons don't disappear or move unexpectedly
3. Drag and drop topics
4. Verify:
   - Icons move with their topics
   - Icons update correctly after drag-and-drop operations

## Browser Console Testing

You can run automated tests in the browser console:

1. Open the application in your browser
2. Open the browser console (F12 or Ctrl+Shift+I)
3. Copy and paste the content of `topics-icon-test.js`
4. Press Enter to run the tests
5. Review the test results in the console

## Expected Results

- Topics with children display folder icons (orange/amber)
- Topics without children display file icons (gray)
- Icons are positioned before the "::" separator
- Icons update dynamically when children are added or removed
- Icons don't interfere with existing features (collapse, drag-and-drop, tree lines)
- Icons have consistent sizing and proper alignment
- Icons are accessible and readable

## Debugging

If issues occur:

1. Check the console for JavaScript errors
2. Inspect icon elements in dev tools:
   ```javascript
   console.log(document.querySelectorAll('.topic-icon'));
   ```
3. Verify icon functions are available:
   ```javascript
   console.log(typeof window.getFolderIcon, typeof window.getFileIcon);
   ```
4. Test icon generation directly:
   ```javascript
   console.log(window.getFolderIcon());
   console.log(window.getFileIcon());
   ```
5. Check icon classes in CSS:
   ```javascript
   console.log(getComputedStyle(document.querySelector('.topic-icon')).display);
   ```

## Visual Reference

- **Folder Icon**: Orange/amber colored folder with tab at top
- **File Icon**: Gray colored document with folded corner at top-right
- **Size**: 16x16 pixels
- **Position**: Between collapse button and "::" separator
- **Spacing**: 8px (0.5rem) margin to right
