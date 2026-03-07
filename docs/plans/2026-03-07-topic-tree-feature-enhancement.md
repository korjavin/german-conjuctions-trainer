# Topic Tree Feature Enhancement

## Overview
A comprehensive overhaul of the topic tree functionality and visualization in the German Grammar Trainer application. This enhancement will transform the current basic tree view into a modern, feature-rich interface with improved usability, visual hierarchy, and interactive features.

**Problem it solves:**
- Current tree view lacks visual hierarchy indicators, making it difficult to understand parent-child relationships
- No way to collapse large branches, leading to cluttered views with many topics
- Drag-and-drop visual feedback is minimal
- No search/filter capability within the tree
- Limited sorting options for top-level siblings
- Settings page usability for creating/editing topics can be improved

**Key benefits:**
- Clear visual hierarchy with tree lines and icons
- Collapsible branches for better organization
- Enhanced drag-and-drop with improved visual feedback
- Search/filter functionality to quickly find topics
- Flexible sorting for top-level topics
- Better user experience on settings page for topic management

## Context (from discovery)

**Files/components involved:**
- `js/topics.js` - Core topic tree logic, rendering, drag-and-drop, tree building/flatten
- `internal/app/topics.go` - Backend API for topics, validation, move operations
- `style.css` - Current tree styling, drag-drop visual feedback
- `index.html` - Topics list container in settings modal
- `js/dom.js` - DOM references for topics list
- `js/state.js` - Application state management

**Related patterns found:**
- Current implementation uses depth-based indentation (20px per level)
- Drag-and-drop with sibling reordering already implemented
- Cycle detection prevents invalid tree operations
- Sort order calculation for new topics
- Tree building with `buildTopicTree()` and `flattenTopicTree()` functions

**Dependencies identified:**
- Backend move endpoint: `PUT /api/topics/{id}/move`
- Backend topic CRUD endpoints
- SQLite database with parent_id and sort_order fields
- Vanilla JavaScript (no framework dependencies)

## Development Approach

**Testing approach**: Regular (code first, then tests)

**Complete each task fully before moving to the next**
**Make small, focused changes**
**CRITICAL: every task MUST include new/updated tests** for code changes in that task
- tests are not optional - they are a required part of the checklist
- write unit tests for new functions/methods
- write unit tests for modified functions/methods
- add new test cases for new code paths
- update existing test cases if behavior changes
- tests cover both success and error scenarios

**CRITICAL: all tests must pass before starting next task** - no exceptions

**CRITICAL: update this plan file when scope changes during implementation**

**Run tests after each change**
**Maintain backward compatibility**

## Testing Strategy

**Unit tests**: Required for every task (see Development Approach above)

**E2E tests**: Not applicable - project doesn't have UI-based e2e tests (Playwright, Cypress, etc.)

## Progress Tracking

- Mark completed items with `[x]` immediately when done
- Add newly discovered tasks with ➕ prefix
- Document issues/blockers with ⚠️ prefix
- Update plan if implementation deviates from original scope
- Keep plan in sync with actual work done

## What Goes Where

- **Implementation Steps** (`[ ]` checkboxes): tasks achievable within this codebase - code changes, tests, documentation updates
- **Post-Completion** (no checkboxes): items requiring external action - manual testing, changes in consuming projects, deployment configs, third-party verifications

## Implementation Steps

### Task 1: Add tree lines visual connectors
- [x] Add CSS styles for tree line connectors (vertical and horizontal lines)
- [x] Modify `renderTopicsList()` to add tree line elements before each topic item
- [x] Implement CSS to render tree lines based on topic depth using left borders or pseudo-elements
- [x] Add tree line connectors that connect parent to children across different depths
- [x] Test tree lines render correctly for various tree depths and structures
- [x] Test tree lines work with existing drag-and-drop functionality
- [x] Run all tests - must pass before next task

### Task 2: Add expand/collapse functionality
- [x] Add `collapsed` state property to each topic in state management
- [x] Add expand/collapse button (chevron icon) to topics with children
- [x] Modify `flattenTopicTree()` to respect collapsed state and skip collapsed children
- [x] Add click handler to toggle collapse state
- [x] Persist collapse state in localStorage
- [x] Add CSS styles for collapsed state (hide children, rotate chevron)
- [x] Test expand/collapse with nested topics at various depths
- [x] Test expand/collapse persistence across page reloads
- [x] Test expand/collapse doesn't break drag-and-drop
- [x] Run all tests - must pass before next task

### Task 3: Add topic icons
- [x] Add folder icon for topics with children, file icon for leaf topics
- [x] Use SVG icons inline or as CSS background (minimal deps approach)
- [x] Add icon element to topic rendering in `renderTopicsList()`
- [x] Add CSS styles for topic icons
- [x] Update icons when children are added/removed
- [x] Test icons display correctly for parent and leaf topics
- [x] Test icons update dynamically when structure changes
- [x] Run all tests - must pass before next task

### Task 4: Add tree search/filter functionality
- [x] Add search input field to topics section in settings modal
- [x] Add search/filter state to state management
- [x] Implement filtering logic in `renderTopicsList()` to show only matching topics
- [x] Auto-expand parent topics when child matches search
- [x] Highlight matching text in topic names
- [x] Add clear search button
- [x] Add keyboard shortcut (Ctrl+F or Cmd+F) to focus search input
- [x] Test search finds topics by name at various depths
- [x] Test search auto-expands parent topics
- [x] Test search highlighting works correctly
- [x] Test clear search resets view
- [x] Run all tests - must pass before next task

### Task 5: Add top-level sibling sorting
- [ ] Add sort control for top-level topics only (not full tree)
- [ ] Modify `buildTopicTree()` or `sortTreeNodes()` to support top-level-only sorting
- [ ] Add sort options: Name (A-Z), Name (Z-A), Date Newest, Date Oldest, Custom Order
- [ ] Implement top-level sorting logic that doesn't affect nested children
- [ ] Add UI controls for top-level sort selection
- [ ] Persist top-level sort preference in localStorage
- [ ] Test top-level sorting works without affecting nested children
- [ ] Test sorting persists across page reloads
- [ ] Run all tests - must pass before next task

### Task 6: Improve drag-and-drop visual feedback
- [ ] Add drop zone indicators that show exactly where topic will be dropped
- [ ] Add ghost element preview during drag
- [ ] Add highlight to potential parent topic when dragging over it
- [ ] Add animation for drop action
- [ ] Improve drag cursor and visual cues
- [ ] Add CSS transitions for smoother drag interactions
- [ ] Test improved visual feedback for sibling reordering
- [ ] Test improved visual feedback for making topic a child
- [ ] Test animations and transitions are smooth
- [ ] Run all tests - must pass before next task

### Task 7: Improve settings page usability for create/edit
- [ ] Improve add topic form UX (better validation feedback, clearer labels)
- [ ] Add topic preview in add/edit forms showing hierarchy context
- [ ] Add recently used topics quick-select in parent dropdown
- [ ] Improve error messages for validation failures
- [ ] Add loading states for create/update operations
- [ ] Add confirmation dialogs for destructive operations
- [ ] Add keyboard shortcuts for form actions (Enter to save, Escape to cancel)
- [ ] Test improved form validation and feedback
- [ ] Test topic preview shows correct hierarchy
- [ ] Test recently used topics quick-select
- [ ] Test keyboard shortcuts work
- [ ] Run all tests - must pass before next task

### Task 8: Add accessibility improvements
- [ ] Add ARIA attributes for tree structure (role="tree", role="treeitem")
- [ ] Add keyboard navigation (Arrow keys to navigate, Enter/Space to expand/collapse)
- [ ] Add screen reader announcements for tree actions
- [ ] Add focus indicators for keyboard navigation
- [ ] Test keyboard navigation works with Tab, Arrow keys, Enter, Space
- [ ] Test screen reader compatibility with tree structure
- [ ] Run all tests - must pass before next task

### Task 9: Add performance optimizations for large trees
- [ ] Implement virtual scrolling for large topic lists (> 100 topics)
- [ ] Optimize tree building and flattening algorithms
- [ ] Add debouncing for search input
- [ ] Test performance with 100+ topics
- [ ] Test virtual scrolling maintains smooth interactions
- [ ] Run all tests - must pass before next task

### Task 10: Write comprehensive tests
- [ ] Write unit tests for new tree line rendering logic
- [ ] Write unit tests for expand/collapse state management
- [ ] Write unit tests for tree search/filter functionality
- [ ] Write unit tests for top-level sorting logic
- [ ] Write unit tests for improved drag-and-drop handlers
- [ ] Write unit tests for settings page form improvements
- [ ] Write integration tests for complete tree workflows
- [ ] Run all tests - must pass before next task

### Task 11: Verify acceptance criteria
- [ ] Verify tree lines display correctly for all depth levels
- [ ] Verify expand/collapse works for topics with children
- [ ] Verify topic icons display correctly (folder for parents, file for leaves)
- [ ] Verify tree search finds topics by name and highlights matches
- [ ] Verify top-level sorting works without affecting nested children
- [ ] Verify drag-and-drop has improved visual feedback
- [ ] Verify settings page has better UX for creating/editing topics
- [ ] Verify keyboard navigation works throughout tree
- [ ] Verify accessibility features work with screen readers
- [ ] Verify performance is acceptable with large topic lists
- [ ] Verify all existing features still work (backward compatibility)
- [ ] Run full test suite - must pass
- [ ] Run linter - all issues must be fixed

### Task 12: Update documentation
- [ ] Update README.md with new topic tree features
- [ ] Update agent.md with new topic tree functionality
- [ ] Add inline code comments for complex tree logic
- [ ] Document keyboard shortcuts for tree navigation
- [ ] Document accessibility features

## Technical Details

### Data Structures and Changes

**Topic state extension:**
```javascript
{
  id: string,
  name: string,
  parent_id: string | null,
  sort_order: number,
  collapsed: boolean, // NEW - for expand/collapse state
  hasChildren: boolean, // NEW - for icon rendering
  children: array // existing
}
```

**Tree line rendering:**
- Use CSS pseudo-elements (::before, ::after) on topic items
- Left border for vertical line
- Horizontal pseudo-element for connector to topic
- Dynamic left margin/position based on depth

**Search state:**
```javascript
{
  searchQuery: string,
  matchingTopicIds: Set<string>
}
```

### Parameters and Formats

**Collapse state storage in localStorage:**
- Key: `topic-collapse-state`
- Format: JSON object mapping topic IDs to boolean collapse state

**Top-level sort preference:**
- Key: `topic-toplevel-sort-order`
- Format: String - 'tree', 'name-asc', 'name-desc', 'date-newest', 'date-oldest'

### Processing Flow

**Tree rendering with new features:**
1. Fetch topics from API
2. Build tree structure (existing `buildTopicTree()`)
3. Apply top-level sorting if enabled
4. Filter topics based on search query
5. Auto-expand parents of matching search results
6. Flatten tree respecting collapse state
7. Render with tree lines, icons, and collapse buttons

**Search flow:**
1. User types in search input (debounced)
2. Filter topics matching query (case-insensitive)
3. Collect all parent IDs of matching topics
4. Expand all parent topics
5. Highlight matching text in topic names
6. Re-render tree

**Expand/collapse flow:**
1. User clicks collapse button
2. Toggle collapsed state for topic
3. Update localStorage
4. Re-flatten tree with new collapse state
5. Re-render tree

## Post-Completion

**Manual verification** (if applicable):
- Test tree lines render correctly across different browsers (Chrome, Firefox, Safari)
- Test expand/collapse animations are smooth on mobile devices
- Test drag-and-drop works well on touch devices
- Test keyboard navigation works consistently across browsers
- Test accessibility with various screen readers (NVDA, VoiceOver, JAWS)

**External system updates** (if applicable):
- None identified for this feature set

*Note: ralphex automatically moves completed plans to `docs/plans/completed/`*
