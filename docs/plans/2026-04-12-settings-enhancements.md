# Settings Enhancements: Collapse/Expand All + Database Stats

## Overview
Two enhancements to the settings modal:
1. **Collapse All / Expand All** icon buttons in the topic tree toolbar (next to search & sort)
2. **Database statistics section** at the bottom of the settings modal showing: total exercises, audio cache size/file count, DB file size, and per-topic exercise counts. Admin-only.

## Context
- Settings modal: `index.html:160-320`, toolbar at lines 175-198
- Topic collapse state: `js/state.js` — `state.collapsedTopicIds` (Set), persisted to localStorage
- `toggleTopicCollapse()` in `state.js:205`, `renderTopicsList()` in `js/topics.js:1133`
- DOM references: `js/dom.js`, API functions: `js/api.js`
- Backend routes: `internal/app/app.go:119-159`, admin middleware: `internal/app/middleware.go:81`
- Storage interface: `pkg/storage/storage.go:100-145`
- Audio cache dir: `audio_cache/`, managed in `internal/app/cache.go`
- DB file: `german.db` (SQLite)

## Development Approach
- **Testing approach**: Regular (code first, then tests)
- Complete each task fully before moving to the next
- **CRITICAL: every task MUST include new/updated tests**
- **CRITICAL: all tests must pass before starting next task**
- **CRITICAL: update this plan file when scope changes during implementation**

## Testing Strategy
- **Unit tests**: Go tests for new storage method + handler; JS tests for collapse/expand logic
- **No e2e tests** in this project

## Progress Tracking
- Mark completed items with `[x]` immediately when done
- Add newly discovered tasks with ➕ prefix
- Document issues/blockers with ⚠️ prefix

## Implementation Steps

### Task 1: Add Collapse All / Expand All buttons to topic tree toolbar
- [x] Add two icon buttons (`collapse-all-btn`, `expand-all-btn`) in `index.html` after the sort dropdown (line ~187), before the "Add New Topic" button — use chevron-down-double / chevron-up-double SVG icons
- [x] Add `collapseAllBtn` and `expandAllBtn` to `js/dom.js`
- [x] Add `collapseAllTopics()` and `expandAllTopics()` functions in `js/state.js` — collapseAll adds all parent topic IDs to `collapsedTopicIds`, expandAll clears the set; both call `_saveTopicCollapseState()`
- [x] Wire click handlers in `js/main.js` — call collapse/expand function then `renderTopicsList()`
- [x] Style buttons to match existing toolbar (small icon buttons, consistent spacing) in `style.css`
- [x] Write tests for `collapseAllTopics()` and `expandAllTopics()` in state tests
- [x] Run tests — must pass before next task

### Task 2: Add `GetDatabaseStats` to storage layer
- [x] Define `DatabaseStats` struct in `pkg/storage/storage.go`:
  ```go
  type DatabaseStats struct {
      TotalExercises       int              `json:"total_exercises"`
      TotalTopics          int              `json:"total_topics"`
      AudioCacheSizeMB     float64          `json:"audio_cache_size_mb"`
      AudioCacheFileCount  int              `json:"audio_cache_file_count"`
      DatabaseSizeMB       float64          `json:"database_size_mb"`
      ExercisesPerTopic    []TopicExerciseCount `json:"exercises_per_topic"`
  }
  type TopicExerciseCount struct {
      TopicID   string `json:"topic_id"`
      TopicName string `json:"topic_name"`
      Count     int    `json:"count"`
  }
  ```
- [x] Add `GetDatabaseStats(audioCacheDir, dbFilePath string) (*DatabaseStats, error)` to `Storage` interface
- [x] Implement in `pkg/storage/sqlite.go`: query `SELECT COUNT(*) FROM exercises`, `SELECT COUNT(*) FROM topics`, `SELECT t.id, t.name, COUNT(e.id) FROM topics t LEFT JOIN exercises e ON t.id = e.topic_id GROUP BY t.id` for per-topic counts; walk `audioCacheDir` for file count + total size; `os.Stat(dbFilePath)` for DB size
- [x] Write tests for `GetDatabaseStats` — verify counts match inserted test data
- [x] Run tests — must pass before next task

### Task 3: Add admin-only `/api/db/stats` endpoint
- [x] Add `handleDatabaseStats` handler in `internal/app/user.go` (or new `stats.go`) — GET only, calls `a.DB.GetDatabaseStats("./audio_cache", dbFilePath)`, returns JSON
- [x] Register route in `internal/app/app.go`: `http.HandleFunc("/api/db/stats", a.withAuth(a.adminOnly(a.handleDatabaseStats)))`
- [x] Write handler test — mock storage, verify admin-only access, verify JSON response shape
- [x] Run tests — must pass before next task

### Task 4: Add Database section to settings modal frontend
- [ ] Add `fetchDatabaseStatsAPI()` function in `js/api.js` — `GET /api/db/stats`
- [ ] Add HTML section at bottom of settings modal in `index.html` (after topics list, before close button) — "Database" heading with `db-stats-container` div, initially hidden
- [ ] Add DOM references in `js/dom.js` for the new container
- [ ] Add rendering logic in `js/topics.js` (or `js/main.js`) — on settings modal open, if user is admin, fetch stats and render: total exercises, total topics, audio cache (size + file count), DB size, per-topic exercise counts as a simple list
- [ ] Style the database section in `style.css` — separator line, consistent with existing sections, compact layout
- [ ] Only show section for admin users (check `state.isAdmin`)
- [ ] Run tests — must pass before next task

### Task 5: Verify acceptance criteria
- [ ] Collapse All button collapses every parent topic in the tree
- [ ] Expand All button expands every collapsed topic
- [ ] Buttons work correctly during search (respect search state)
- [ ] Database stats section visible only for admin users
- [ ] Stats show total exercises, topics, audio cache info, DB size, per-topic counts
- [ ] Run full test suite (unit tests)
- [ ] Run linter — all issues must be fixed

### Task 6: [Final] Update documentation
- [ ] Update README.md if needed

## Technical Details

**Collapse/Expand All logic:**
- `collapseAllTopics()`: iterate `state.topics`, collect IDs of topics that have children (are parents), add all to `collapsedTopicIds`
- `expandAllTopics()`: clear `collapsedTopicIds` set
- Both persist via existing `_saveTopicCollapseState()`
- During active search: operate on the visible tree state, don't interfere with `preSearchCollapsedTopicIds`

**Database stats query:**
- Total exercises: `SELECT COUNT(*) FROM exercises`
- Total topics: `SELECT COUNT(*) FROM topics`
- Per-topic: `SELECT t.id, t.name, COUNT(e.id) FROM topics t LEFT JOIN exercises e ON e.topic_id = t.id GROUP BY t.id, t.name ORDER BY t.name`
- Audio cache: `filepath.Walk` on `audio_cache/` directory
- DB size: `os.Stat` on the DB file path

**API response format:**
```json
{
  "total_exercises": 342,
  "total_topics": 15,
  "audio_cache_size_mb": 156.2,
  "audio_cache_file_count": 1204,
  "database_size_mb": 12.4,
  "exercises_per_topic": [
    {"topic_id": "...", "topic_name": "Konjunktiv II", "count": 45},
    ...
  ]
}
```

## Post-Completion

**Manual verification:**
- Open settings modal as admin — verify stats section appears with correct numbers
- Open settings modal as non-admin — verify stats section is hidden
- Test collapse/expand all with nested topics (3+ levels deep)
- Test collapse/expand all during active search
