# Topic Accessibility Features - Test Guide

This guide helps you manually verify accessibility improvements for the topic tree.

## Manual Testing Steps

### 1. ARIA Attributes Test
1. Start the application (`go run ./cmd/server`)
2. Open http://localhost:8080 in your browser
3. Click "Settings" button to open the settings modal
4. Open browser developer tools (F12)
5. Inspect the topics list container
6. Verify:
   - The container has `role="tree"`
   - The container has an accessible label (`aria-label` or `aria-labelledby`)
7. Inspect a topic item
8. Verify:
   - Topic items have `role="treeitem"`
   - Topic items have `tabindex="0"`
   - Topic items have `aria-expanded` attribute
   - Topic items have `aria-level` attribute
   - Topic items have `aria-selected` attribute
   - Topic items have `aria-label` describing the topic

### 2. Keyboard Navigation Test
1. With the settings modal open, press Tab until a topic item is focused
2. Verify a visible focus ring appears around the focused topic
3. Test the following keyboard shortcuts:
   - **Arrow Down**: Move to the next topic
   - **Arrow Up**: Move to the previous topic
   - **Arrow Right**: Move to the next topic (alternative)
   - **Arrow Left**: Move to the previous topic (alternative)
   - **Home**: Jump to the first topic
   - **End**: Jump to the last topic
   - **Enter**: Toggle expand/collapse (for topics with children)
   - **Space**: Toggle expand/collapse (for topics with children)
   - **Escape**: Remove focus from the topic tree
4. Verify:
   - Focus moves smoothly through all visible topics
   - Focus ring remains visible during navigation
   - Navigation doesn't skip any topics
   - Collapse/expand works with Enter and Space keys

### 3. Screen Reader Test (with screen reader enabled)
1. Enable a screen reader (NVDA on Windows, VoiceOver on macOS, or JAWS)
2. Navigate to the topics section
3. Verify screen reader announces:
   - "Topic tree, list" when entering the topics area
   - Each topic's name when navigating
   - "collapsed" or "expanded" state for topics with children
   - Number of children for topics with children (e.g., "3 children")
4. Test expanding/collapsing a topic
5. Verify screen reader announces the action (e.g., "Topic expanded" or "Topic collapsed")
6. Navigate through topics using screen reader shortcuts
7. Verify navigation works correctly

### 4. Focus Indicators Test
1. Press Tab to focus on a topic item
2. Verify:
   - A visible focus ring appears
   - Focus ring has good contrast (blue or orange outline)
   - Focus ring is at least 2-3px wide
3. Navigate through topics with arrow keys
4. Verify focus moves smoothly
5. Verify focus always remains visible
6. Test in different browsers:
   - Chrome/Edge
   - Firefox
   - Safari

### 5. Action Buttons Accessibility Test
1. Focus on a topic item
2. Tab to the action buttons (Add child, Edit, Delete)
3. Verify:
   - Each button has a visible focus indicator
   - Buttons can be activated with Enter or Space
4. Inspect the action button container
5. Verify:
   - Container has `role="toolbar"`
   - Each action button has a descriptive `aria-label` (e.g., "Edit topic Topic Name")

### 6. Expand/Collapse Button Test
1. Find a topic with children (has a chevron button)
2. Inspect the collapse button
3. Verify:
   - Button has `aria-label` (e.g., "Expand Topic Name")
   - Button has `aria-expanded` attribute
   - `aria-expanded` is "true" when expanded, "false" when collapsed
4. Click the collapse button
5. Verify:
   - `aria-expanded` updates to the correct value
   - Screen reader announces the state change

### 7. Screen Reader Announcer Test
1. Open browser console
2. Run:
   ```javascript
   window.announceToScreenReader('Test announcement');
   ```
3. Verify screen reader announces "Test announcement"
4. Collapse/expand a topic
5. Verify screen reader announces the action

### 8. Decorative Elements Test
1. Inspect topic icons (folder/file icons)
2. Verify they have `aria-hidden="true"`
3. Inspect the date text below topic names
4. Verify it has `aria-hidden="true"` (decorative information)
5. Verify screen reader doesn't announce these decorative elements

### 9. High Contrast Mode Test
1. Enable high contrast mode in your OS or browser
2. Navigate to the topics section
3. Verify:
   - Focus indicators remain visible
   - Topic text remains readable
   - Action buttons are distinguishable
4. Navigate with keyboard
5. Verify focus is clearly visible

### 10. Reduced Motion Test
1. Enable reduced motion preference in your OS or browser
2. Navigate to the topics section
3. Collapse/expand a topic
4. Verify animations respect the reduced motion preference (no jarring animations)

## Browser Console Testing

You can run automated tests in the browser console:

1. Open the application in your browser
2. Open browser console (F12 or Ctrl+Shift+I)
3. Copy and paste the content of `topics-accessibility-test.js`
4. Press Enter to run tests
5. Review the test results in the console

## Expected Results

### ARIA Attributes
- Topics list container has `role="tree"`
- Topic items have `role="treeitem"`
- Topic items have `tabindex="0"` for keyboard focus
- Topic items have `aria-expanded` indicating collapsed/expanded state
- Topic items have `aria-level` indicating hierarchy depth
- Topic items have `aria-selected` indicating focus state
- Topic items have descriptive `aria-label`

### Keyboard Navigation
- Arrow keys navigate through topics
- Home/End keys jump to first/last topics
- Enter/Space toggles expand/collapse
- Escape removes focus
- Focus indicators are visible at all times

### Screen Reader Support
- Tree structure is announced correctly
- Topic names are announced
- Expand/collapse state is announced
- Action buttons are labeled
- Decorative elements are hidden from screen readers
- Announcements are made for user actions

### Focus Indicators
- High-contrast focus rings on all interactive elements
- Focus follows keyboard navigation
- Focus works across different browsers
- Focus is visible in high contrast mode

## Debugging

If issues occur:

### Check ARIA Attributes
```javascript
// Inspect topics list attributes
const topicsList = document.getElementById('topics-list');
console.log('Role:', topicsList.getAttribute('role'));
console.log('Label:', topicsList.getAttribute('aria-label'));

// Inspect first topic item
const firstTopic = document.querySelector('[data-topic-id]');
console.log('Topic Role:', firstTopic.getAttribute('role'));
console.log('Expanded:', firstTopic.getAttribute('aria-expanded'));
console.log('Level:', firstTopic.getAttribute('aria-level'));
```

### Check Keyboard Navigation
```javascript
// Focus on first topic and test navigation
const topics = document.querySelectorAll('[data-topic-id]');
topics[0].focus();

// Simulate arrow key
const event = new KeyboardEvent('keydown', { key: 'ArrowDown' });
document.activeElement.dispatchEvent(event);

console.log('Current focus:', document.activeElement);
```

### Check Screen Reader Announcer
```javascript
// Verify announcer exists
const announcer = document.getElementById('a11y-announcer');
console.log('Announcer exists:', !!announcer);
console.log('Announcer aria-live:', announcer?.getAttribute('aria-live'));

// Test announcement manually
window.announceToScreenReader('Test message');
```

### Check Focus Styles
```javascript
// Check computed focus styles
const testTopic = document.querySelector('[data-topic-id]');
testTopic.focus();

const styles = window.getComputedStyle(testTopic, ':focus');
console.log('Focus outline:', styles.outline);
console.log('Focus box-shadow:', styles.boxShadow);
```

## Accessibility Best Practices Implemented

1. **Semantic HTML**: Using proper ARIA roles for tree structure
2. **Keyboard Support**: Full keyboard navigation with standard shortcuts
3. **Focus Management**: Clear focus indicators and logical tab order
4. **Screen Reader Support**: Proper labels and announcements
5. **Progressive Enhancement**: Works with and without screen readers
6. **WCAG 2.1 AA Compliance**: Meets key success criteria:
   - 1.3.1 Info and Relationships (ARIA roles)
   - 2.1.1 Keyboard (all functions keyboard accessible)
   - 2.4.3 Focus Order (logical navigation)
   - 4.1.2 Name, Role, Value (proper attributes)

## Testing Checklist

- [ ] ARIA attributes are correctly set
- [ ] Keyboard navigation works with all documented keys
- [ ] Focus indicators are visible and clear
- [ ] Screen reader announces tree structure
- [ ] Screen reader announces expand/collapse actions
- [ ] Action buttons are properly labeled
- [ ] Decorative elements are hidden from screen readers
- [ ] Focus moves logically through the tree
- [ ] Keyboard shortcuts don't conflict with browser defaults
- [ ] Works in high contrast mode
- [ ] Works with reduced motion enabled
- [ ] Tested across multiple browsers (Chrome, Firefox, Safari, Edge)
- [ ] Tested with at least one screen reader
