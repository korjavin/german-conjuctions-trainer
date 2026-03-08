# Enhance Main Screen Dropdown with Interactive Tree and Search

## Overview
Replace the flat list in the main screen topic dropdown with an interactive tree view (indented nodes, folder/file icons, collapse/expand toggles). When the user types in the search field, the tree filters to show matching topics with their parents auto-expanded and matching text highlighted.

## Context
- Files involved:
  - `js/topics.js` - main change: replace `renderTopicDropdown`, add dropdown collapse state
  - `js/main.js` - update event handlers to pass search query instead of filtered array
  - `style.css` - add styles for dropdown tree items, increase max-height
  - `js/topics-dropdown-tree-test.js` - new browser-console test file
- Related patterns:
  - `buildTopicTree`, `flattenTopicTree`, `findMatchingTopics`, `highlightText` already exist in topics.js
  - `getFolderIcon`, `getFileIcon` already exported from topics.js
  - Settings tree uses `state.collapsedTopicIds` (persisted); dropdown tree will use its own module-level Set (not persisted)
  - Browser-console test style follows existing `js/topics-search-test.js` pattern
- Dependencies: none new

## Development Approach
- **Testing approach**: Regular (code first, then browser-console tests)
- Complete each task fully before moving to the next
- The dropdown tree collapse state is separate from the settings modal tree collapse state
- `flattenTopicTree` uses `isTopicCollapsed` from state.js, so the dropdown render needs its own inline flatten with a custom collapse check

## Implementation Steps

### Task 1: Add dropdown collapse state and rewrite renderTopicDropdown in topics.js

**Files:**
- Modify: `js/topics.js`

- [x] Add module-level `const dropdownCollapsedTopicIds = new Set()` near other module-level state
- [x] Change `renderTopicDropdown(topicsToRender)` signature to `renderTopicDropdown(searchQuery = '')`
- [x] Inside the function, call `buildTopicTree(state.topics)` to get `{ roots, nodesById }`
- [x] When `searchQuery` is non-empty: call `findMatchingTopics(searchQuery, nodesById)` to get `{ matchingIds, expandedIds }`
- [x] Write an inline flatten that respects `dropdownCollapsedTopicIds` and `expandedIds` (search-expanded):
  - include a node if not-collapsed OR if in `expandedIds`
  - when searching: filter to only nodes in `matchingIds | expandedIds`
- [x] Render each flattened node as a div with class `topic-dropdown-tree-item`:
  - inline left-padding based on depth (`depth * 16px`)
  - if node has children: a small collapse toggle button (`.topic-dropdown-collapse-btn`)
  - icon: `getFolderIcon()` for parents, `getFileIcon()` for leaves
  - topic name text; when searching, apply `highlightText(escapeHtml(topic.name), searchQuery)`
  - on click: call `selectTopic(topic.id, getTopicPath(topic.id, state.topics))`
- [x] Collapse toggle button click: toggle `dropdownCollapsedTopicIds`, call `renderTopicDropdown(dom.topicSearch.value)`, stop propagation
- [x] Show "No topics found." message when result is empty
- [x] run project test suite: `go test ./...` must pass before task 2

### Task 2: Update main.js event handlers

**Files:**
- Modify: `js/main.js`

- [x] Change focus handler: replace `renderTopicDropdown(state.topics)` with `renderTopicDropdown('')`
- [x] Change input handler: replace the local filter + `renderTopicDropdown(filteredTopics)` with `renderTopicDropdown(dom.topicSearch.value)`
- [x] Keep the `renderTopicDropdown` import (signature changes but name stays)
- [x] run project test suite: `go test ./...` must pass before task 3

### Task 3: Add CSS styles for dropdown tree items in style.css

**Files:**
- Modify: `style.css`

- [ ] Increase `.topic-dropdown` max-height from `16rem` to `24rem`
- [ ] Add `.topic-dropdown-tree-item` styles: cursor pointer, padding (`0.6rem 1rem`), transition, border-bottom, font-size, color; hover: background highlight
- [ ] Add `.topic-dropdown-collapse-btn` styles: small inline button, hover background, no border
- [ ] Add `.topic-dropdown-tree-item .search-highlight` style (reuse existing `search-highlight` mark style if already defined, otherwise add)
- [ ] run project test suite: `go test ./...` must pass before task 4

### Task 4: Add browser-console test file for dropdown tree

**Files:**
- Create: `js/topics-dropdown-tree-test.js`

- [ ] Test: dropdown `#topic-dropdown` element exists
- [ ] Test: after focusing `#topic-search`, dropdown contains `.topic-dropdown-tree-item` elements (not `.topic-item`)
- [ ] Test: topics with children render a collapse button
- [ ] Test: clicking collapse button changes child count in rendered list
- [ ] Test: typing in `#topic-search` filters items and renders highlights (`.search-highlight`)
- [ ] Test: clearing search restores full tree
- [ ] run project test suite: `go test ./...` must pass before task 5

### Task 5: Verify acceptance criteria

- [ ] manual test: open page, click topic search input, verify tree renders with indentation and icons
- [ ] manual test: click collapse button on a parent topic, verify children hide
- [ ] manual test: type partial topic name, verify matching topics shown with text highlighted and parents expanded
- [ ] manual test: clear search field, verify full tree restored with previous collapse state
- [ ] manual test: click a topic to select it, verify search input shows full path
- [ ] run full test suite: `go test ./...`
- [ ] run linter: `go vet ./...`
- [ ] verify test coverage is maintained

### Task 6: Update documentation

- [ ] update CLAUDE.md if internal patterns changed
- [ ] move this plan to `docs/plans/completed/`
