# Topic Search/Filter Feature - Test Guide

## Overview
This guide explains how to run the functional tests for the topic search/filter feature.

## Test File Location
`js/topics-search-test.js`

## Running the Tests

### Prerequisites
1. The application must be running (e.g., `go run .` from the project root)
2. Navigate to `http://localhost:8080` (or whichever port the app uses)
3. Open the settings modal (click the "Settings" button in the header)

### Running Tests in Browser Console

1. Open the browser Developer Tools (F12 or Cmd+Option+I)
2. Switch to the "Console" tab
3. Copy the entire contents of `js/topics-search-test.js`
4. Paste into the console and press Enter
5. Review the test results in the console output

### Alternative: Loading from a Script Tag

You can also load the test file by adding a temporary script tag to `index.html`:

```html
<!-- Add this before the closing </body> tag, remove after testing -->
<script type="module" src="js/topics-search-test.js"></script>
```

## Test Coverage

The test suite covers:

1. **Search Input Field** - Verifies the search input exists and is properly configured
2. **Clear Button** - Verifies the clear button exists and shows/hides correctly
3. **State Management** - Verifies search state properties exist and update correctly
4. **Search Filtering** - Verifies topics are filtered by name
5. **Auto-Expand Parents** - Verifies parent topics are expanded when children match
6. **Text Highlighting** - Verifies matching text is highlighted
7. **Clear Functionality** - Verifies the clear button resets search
8. **No Results State** - Verifies appropriate message when no topics match
9. **Keyboard Shortcut** - Verifies Ctrl+F/Cmd+F works (when settings modal is open)
10. **Styling** - Verifies search highlight styles are applied

## Expected Test Output

All tests should pass with output similar to:

```
============================================================
Running Topic Search/Filter Tests
============================================================

Test 1:
✓ Topics search input field exists in DOM
  Input type: text
  Input placeholder: Search topics (Ctrl+F / Cmd+F)...

Test 2:
✓ Topics search clear button exists in DOM
  Button class: absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 hidden
  Button initially hidden: true

...

============================================================
Test Summary
============================================================
Passed: 15
Failed: 0
Total: 15
============================================================

✓ All tests passed!
```

## Troubleshooting

### Tests Fail with "Skipping: no topics loaded"
- Ensure the backend is running
- Ensure topics exist in the database
- Wait for the application to fully load before running tests

### Tests Fail with "Skipping: search input not found"
- Ensure the settings modal is open
- Refresh the page and try again

### Tests Fail with "Skipping: settings modal not open"
- Open the settings modal by clicking the "Settings" button
- Then run the tests again

### Search highlighting not visible
- Check that the CSS file includes `.search-highlight` styles
- Verify the CSS file is loaded (check browser DevTools Network tab)

## Manual Testing Checklist

In addition to automated tests, manually verify:

- [ ] Search input field is visible in settings modal topics section
- [ ] Typing in search input filters topics in real-time
- [ ] Clear button appears when search has text
- [ ] Clear button disappears when search is empty
- [ ] Clicking clear button resets search and shows all topics
- [ ] Matching text is highlighted in yellow
- [ ] Non-matching search shows "No topics found" message
- [ ] Ctrl+F (or Cmd+F on Mac) focuses search input when settings modal is open
- [ ] Parent topics are expanded when their children match search
- [ ] Search works across different tree depths

## Integration with Existing Features

Verify that search doesn't break existing functionality:

- [ ] Drag-and-drop still works
- [ ] Collapse/expand still works
- [ ] Topic icons still display
- [ ] Tree lines still render
- [ ] Sort controls still work
- [ ] Add/Edit/Delete topic buttons still work
