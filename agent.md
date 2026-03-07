# German Conjunctions Trainer - Agent Documentation

## Project Overview
A web-based application for learning German grammar. It features interactive word-scramble exercises, customizable topics, and a unique prompt refinement system to ensure high-quality, varied content. The application now includes exercise caching and a Spaced Repetition System (SRS) for authenticated users to optimize learning. It also tracks user performance and provides session statistics.

## Architecture
- **Backend**: Go HTTP server featuring an on-demand, AI-powered exercise generation system with prompt refinement. It handles exercise caching, SRS logic, and data persistence via a local SQLite database.
- **Frontend**: Vanilla JavaScript with Tailwind CSS, providing a responsive UI for exercises and topics management.
- **Storage**: SQLite for storing grammar topics, their version history, cached exercises, and user SRS data.
- **Deployment**: Docker container with environment-based configuration for easy deployment.

## File Structure
```
.
├── main.go              # Go backend server with API and SQLite integration
├── cmd/migrate/main.go  # Data migration tool from Airtable to SQLite
├── index.html           # Main application UI
├── app.js               # Frontend JavaScript for interactivity and topics management
├── agent.md             # Context file for AI development
├── Dockerfile           # Container definition for production
├── docker-compose.yml   # Docker Compose for local development
├── go.mod               # Go module dependencies
├── german.db            # SQLite database file
└── .github/workflows/   # CI/CD pipelines for Docker builds
```

## Backend (main.go)
### Key Components:
- **Exercise Caching**: The system caches all generated exercises in a local SQLite database to reduce latency and API costs.
- **Spaced Repetition System (SRS)**: For authenticated users, the backend calculates which exercises are due for review based on their viewing history.
- **On-Demand Generation**: The `generateAndCacheExercises` function is triggered only when the cache is insufficient for a user's request. It uses a `metaPrompt` to refine the topic prompt before calling the OpenAI API.
- **API Endpoint `/api/exercises`**: The primary endpoint for the frontend. It orchestrates fetching from cache, applying SRS logic, and triggering generation.
- **Static File Serving**: Custom handlers serve `index.html` with dynamic cache-busting and `app.js` with long-term caching.
- **Rate Limiting**: IP-based rate limiting (1 request every 3 seconds) to prevent abuse.
- **CORS Configuration**: Configurable CORS support via the `CORS_ALLOWED_ORIGINS` environment variable. All API handlers use this configuration to set proper CORS headers, defaulting to wildcard for development.
- **SQLite Database**: Manages all CRUD operations for topics, versions, exercises, and user data.

### Environment Variables:
- `OPENAI_API_KEY`: Required for AI exercise generation.
- `STORAGE_TYPE`: (Optional) `sqlite` (default) or `airtable`.
- `SQLITE_PATH`: (Optional) Path to the SQLite database file. Defaults to `german.db`.
- `AIRTABLE_TOKEN`: (Deprecated) Required only if `STORAGE_TYPE` is `airtable`.
- `AIRTABLE_BASE_ID`: (Deprecated) Required only if `STORAGE_TYPE` is `airtable`.
- `OPENAI_URL`: API endpoint (defaults to `https://api.openai.com/v1`).
- `MODEL_NAME`: AI model (defaults to `gpt-3.5-turbo-1106`).
- `PORT`: Server port (defaults to `8080`).
- `CORS_ALLOWED_ORIGINS`: Comma-separated list of allowed CORS origins (defaults to `*`).
- `ELEVENLABS_MODEL_ID`: ElevenLabs model to use for TTS (defaults to `eleven_multilingual_v2`).
- `ELEVENLABS_VOICE_SPEED`: ElevenLabs voice speed for TTS (defaults to `1.0`).

### API Structure:
```go
// Exercise Fetching & Generation
POST /api/exercises
{ "topic_id": "string" }
// -> Returns a JSON object with an array of exercises, either from cache or newly generated.

// Topics Management
GET    /api/topics                 // Get all topics
POST   /api/topics                 // Create a new topic
GET    /api/topics/{id}            // Get a specific topic
PUT    /api/topics/{id}            // Update a topic (creates a new version)
PUT    /api/topics/{id}/move       // Move a topic to a new parent or position
{ "parent_id": "string", "position": number }
// -> Returns the updated topic with new parent and sort order
DELETE /api/topics/{id}            // Delete a topic and its versions

// Version History
GET  /api/versions/{topicId}                  // Get version history for a topic
POST /api/versions/{topicId}/restore/{versionId} // Restore a specific version

// Observability
GET /api/last-refined-prompt // Get the most recently used refined prompt
```

## Database Schema (SQLite)

### `topics`
- `id` (TEXT, PK): UUID for the topic.
- `name` (TEXT): The name of the topic.
- `prompt` (TEXT): The prompt used for generation.
- `created_at` (DATETIME): Timestamp of creation.
- `updated_at` (DATETIME): Timestamp of last update.

### `prompt_versions`
- `id` (TEXT, PK): UUID for the version.
- `topic_id` (TEXT, FK): Foreign key to the `topics` table.
- `prompt` (TEXT): The prompt content for this version.
- `version` (INTEGER): Sequential version number.
- `created_at` (DATETIME): Timestamp of creation.

### `exercises`
- `id` (TEXT, PK): UUID for the exercise.
- `topic_id` (TEXT, FK): Foreign key to the `topics` table.
- `prompt_hash` (TEXT): SHA256 hash of the prompt that generated the exercise.
- `exercise_json` (TEXT): The full JSON of the exercise.
- `audio_file_path` (TEXT): Path to the cached TTS audio file.
- `created_at` (DATETIME): Timestamp of creation.

### `users`
- `id` (TEXT, PK): UUID for the user.
- `google_id` (TEXT, UNIQUE): The user's unique Google ID.

### `user_exercise_views`
- `id` (TEXT, PK): UUID for the view record.
- `user_id` (TEXT, FK): Foreign key to the `users` table.
- `exercise_id` (TEXT, FK): Foreign key to the `exercises` table.
- `last_viewed` (DATETIME): Timestamp of the last time the user viewed the exercise.
- `repetition_counter` (INTEGER): Counter for the Spaced Repetition System.

### `user_stats`
- `user_id` (TEXT, PK, FK): Foreign key to the `users` table.
- `total_exercises`, `total_mistakes`, `total_hints`, `total_time` (INTEGER): User statistics.
- `last_topic_id` (TEXT): The last topic the user was working on.

### Key Features:
- **Persistent Storage**: All topics, versions, exercises, and user data stored in a local SQLite database file (`german.db`).
- **Exercise Caching**: Serves as the cache for all generated exercises.
- **SRS Tracking**: Stores user-specific exercise view history to enable SRS.
- **Version Management**: Automatic versioning for topic prompts.
- **Default Topics**: Auto-creation on first startup if the database is empty.

## Frontend (js/main.js, js/topics.js, js/state.js, js/dom.js)

### File Structure
The frontend has been reorganized into modular JavaScript files:
- `js/main.js`: Main application entry point, event handlers, and core logic
- `js/topics.js`: Topic tree management, including rendering, drag-and-drop, and UI interactions
- `js/state.js`: Application state management (topics, exercises, user data)
- `js/dom.js`: DOM element references and caching
- `js/api.js`: API calls to backend
- `js/exercise.js`: Exercise rendering and word scrambling logic
- `js/session.js`: Session management and statistics
- `js/audio.js`: Text-to-speech functionality
- `js/history.js`: Version history management for topics
- `js/auth.js`: Google OAuth authentication

### Topic Tree Features

The application includes a comprehensive topic tree management system with advanced features for organizing, searching, and managing grammar topics.

#### Visual Hierarchy
- **Tree Lines**: Vertical and horizontal lines connect parent to child topics, making it easy to understand relationships at any depth
- **Depth-Based Indentation**: Topics are indented 20px per depth level for visual clarity
- **Topic Icons**: Folder icons (amber) for topics with children, file icons (gray) for leaf topics

#### Expand/Collapse Functionality
- Topics can be collapsed to reduce clutter in the tree view
- Collapse state is persisted in localStorage (`topicCollapseState`)
- Chevron buttons indicate expand/collapse state with rotation animation
- When collapsed, child topics are hidden from the view

#### Search and Filter
- Real-time search with debounced input (300ms delay)
- Text highlighting shows matching characters in topic names
- Parent topics are automatically expanded when children match the search
- Keyboard shortcut: Ctrl+F or Cmd+F focuses the search input
- Clear button to reset search results

#### Sorting Options
- Top-level topics can be sorted without affecting nested children
- Sort options: Tree (custom order), Name (A-Z), Name (Z-A), Date (newest), Date (oldest)
- Sort preference is persisted in localStorage (`topicSortOrder`)

#### Drag and Drop
- Enhanced visual feedback with ghost element preview during drag
- Drop zone indicators show exactly where a topic will be dropped
- Parent drop highlighting indicates when a topic can become a child
- Smooth CSS transitions and animations for drop actions
- Prevents invalid operations (e.g., making a topic its own parent)

#### Accessibility Features
- **ARIA Attributes**: `role="tree"`, `role="treeitem"`, `aria-expanded`, `aria-level`, `aria-selected`
- **Keyboard Navigation**:
  - Arrow Up/Down/Left/Right: Navigate between topics
  - Home: Jump to first visible topic
  - End: Jump to last visible topic
  - Enter or Space: Toggle expand/collapse for topics with children
  - Escape: Exit tree navigation
  - Ctrl+F or Cmd+F: Focus topic search input
- **Screen Reader Support**: Live region announcements for expand/collapse actions and drag operations
- **Focus Indicators**: Clear visual feedback when topics are focused via keyboard

### Keyboard Shortcuts Reference

**Topic Tree Navigation (in Settings Modal):**
- `Arrow Up` / `Arrow Down`: Navigate to previous/next visible topic
- `Arrow Right` / `Arrow Left`: Alternative navigation (same as Up/Down)
- `Home`: Jump to first visible topic
- `End`: Jump to last visible topic
- `Enter` / `Space`: Toggle expand/collapse for topics with children
- `Escape`: Exit keyboard navigation and remove focus

**Topic Search:**
- `Ctrl+F` / `Cmd+F`: Focus the topic search input

**Form Shortcuts (Add/Edit Topic Forms):**
- `Ctrl+Enter` / `Cmd+Enter`: Save the form
- `Escape`: Cancel and close the form

**Exercise Interface:**
- `1-9`, `a-z`: Select the corresponding word in the scrambled list
- `Enter`: Submit completed sentence (when all words selected)
- `?` / `h`: Show hint for the next correct word

### Accessibility Implementation Details

**ARIA Tree Pattern:**
The topic tree implements the WAI-ARIA tree pattern for accessibility:

- Container element has `role="tree"` and `aria-label="Topic tree"`
- Each topic item has `role="treeitem"` and `tabindex="0"`
- Parent topics have `aria-expanded` set to "true" or "false"
- `aria-level` indicates the depth level (1 = root, 2 = child, etc.)
- `aria-selected` tracks which topic currently has keyboard focus
- Collapse buttons have `aria-label` with action description (e.g., "Expand [topic name]")

**Screen Reader Announcements:**
- Uses a live region (`aria-live="polite"`) to announce dynamic changes
- Announces expand/collapse actions (e.g., "Verbs collapsed", "Grammar expanded")
- Announces drag operations (e.g., "Conjunctions moved to Grammar")
- Provides context for navigation (e.g., "Topic N of M")

**Focus Management:**
- Topics can receive keyboard focus via Tab
- Arrow keys move focus between visible topics
- Focus indicators show clear visual state (blue outline in dark mode)
- `aria-selected` updates when focus moves between topics
- Pressing Escape removes focus from the tree

**Visual Accessibility:**
- Color contrast ratios meet WCAG AA standards
- Tree lines use adequate contrast for visibility
- Focus indicators have strong visual feedback
- Icons have aria-hidden="true" to avoid redundant screen reader output
- Icons are accompanied by text labels where needed

#### Performance Optimizations
- **Virtual Scrolling**: Enabled for topic lists with 100+ items, rendering only visible topics
- **Debounced Search**: Search input is debounced to reduce re-renders
- **Efficient Tree Building**: Stack-based tree flattening instead of recursion for better performance
- **Tree Caching**: Flattened tree nodes are cached to avoid repeated calculations

#### Form Improvements
- **Real-Time Validation**: Immediate feedback on topic name and prompt fields
- **Hierarchy Preview**: Shows the full path where a topic will be created (e.g., "Grammar / Verbs / New Topic")
- **Recently Used Topics**: Quick-select badges for recently used parent topics
- **Loading States**: Visual feedback during create/update operations
- **Keyboard Shortcuts**: Ctrl+Enter to save, Escape to cancel

### Topic Tree Data Structures

```javascript
// Topic state structure (from state.js)
{
  topics: [],                    // Array of all topic objects
  currentTopicId: '',            // Currently selected topic
  topicsSearchQuery: '',         // Current search query
  topicsMatchingIds: Set<string>, // IDs of matching topics
  topicSortOrder: 'tree',        // Sort order for top-level topics
  flattenedTopicNodes: [],        // Cached flattened tree structure
  virtualScrollEnabled: false,   // Whether virtual scrolling is active
  recentlyUsedTopics: [],         // Recently used topics for quick-select
}

// Topic tree node structure (built from API topics)
{
  id: string,
  name: string,
  prompt: string,
  parent_id: string | null,
  sort_order: number,
  created_at: string,
  children: array               // Array of child tree nodes
}
```

### Key Topic Tree Functions (topics.js)

**Tree Building and Flattening:**
- `buildTopicTree(topics, sortOrder)`: Converts flat topic array to hierarchical tree structure
- `flattenTopicTree(roots, nodesById, searchExpandedIds)`: Flattens tree to linear array for rendering, respecting collapse state
- `sortTreeNodes(nodes, sortOrder, isTopLevel)`: Sorts tree nodes, with special handling for top-level only sorting

**Rendering:**
- `renderTopicsList()`: Main rendering function, handles search, filtering, and virtual scrolling
- `createTopicItem(topic, depth, parentId, indexInParent, totalSiblings)`: Creates a single topic item with all features
- `createTreeLines(depth, indexInParent, totalSiblings)`: Generates tree line connectors for visual hierarchy
- `renderVirtualScrollItems()`: Renders only visible items when virtual scrolling is enabled

**Search and Filter:**
- `findMatchingTopics(searchQuery, nodesById)`: Finds topics matching search query and expands parent topics
- `highlightText(text, searchQuery)`: Highlights matching text with `<mark>` tags

**Drag and Drop:**
- `createDragGhost(sourceElement)`: Creates a ghost preview element for drag operations
- `updateDragGhostPosition(event)`: Updates ghost element position during drag
- `attachDropHandlers(element, config)`: Sets up drop zone handlers for sibling and child drops
- `clearDropHighlights()`: Removes all drop zone highlight styles

**Accessibility:**
- `handleTopicKeyboard(event)`: Handles keyboard navigation for the topic tree
- `announceToScreenReader(message)`: Sends announcements to screen readers via ARIA live region

**Form Helpers:**
- `validateTopicName(name)`: Validates topic name with detailed error messages
- `validateTopicPrompt(prompt)`: Validates prompt with detailed error messages
- `updateHierarchyPreview(parentSelect, previewElement, topicName)`: Updates the hierarchy preview in forms
- `renderRecentlyUsedTopics(containerId, parentSelectId)`: Renders recently-used topic badges

### Topic Tree Storage (localStorage)

The topic tree uses the following localStorage keys for persistence:

- `topicCollapseState`: JSON array of collapsed topic IDs
  - Format: `["topic-id-1", "topic-id-2"]`
  - Persisted across page reloads to maintain expanded/collapsed state

- `topicSortOrder`: String value for sort order preference
  - Possible values: `'tree'`, `'name-asc'`, `'name-desc'`, `'date-newest'`, `'date-oldest'`
  - Default: `'tree'` (custom sort order from sort_order field)
  - Only affects top-level topics, not nested children

- `recentlyUsedTopics`: Array of recently used topic objects for quick-select in forms
  - Format: `[{id: "topic-id", name: "Topic Name"}, ...]`
  - Limited to most recent 10 topics
  - Updated whenever a user creates a new topic or selects a parent in forms

- `selectedTopicId`: The currently selected topic for exercise generation
  - Format: `"topic-id"` (string)
  - Persisted to remember last selected topic across sessions
### Application State:
```javascript
state = {
  currentTopicId: '',         // Selected topic for exercise generation
  topics: [],                 // Array of available topics
  exercises: [],              // Array of exercise objects
  currentExerciseIndex: 0,    // Current position
  userSentence: [],           // User's constructed sentence
  isLocked: false,            // Prevent clicks during completion
  mistakes: 0,                // Session mistake count
  hintsUsed: 0,              // Session hint count
  startTime: null,            // Session start timestamp
  sessionTime: 0,            // Total session duration
  isSessionComplete: false,   // Session completion flag
  editingTopicId: null        // Currently editing topic ID
}
```

### Topics Management UI:
- **Topic Selector**: A searchable combobox in the header allows users to quickly find and select a topic for exercise generation.
- **Topics List**: (Inside Settings Modal) View, edit, delete existing topics.
- **Topic Editor**: (Inside Settings Modal) A modal for editing topic prompts with access to version history.
- **Add Topic Form**: (Inside Settings Modal) A form to create new topics with a name and a custom prompt.
- **Version History Modal**: (Inside Settings Modal) View and restore previous prompt versions for a selected topic.

### Exercise Object Structure:
```javascript
{
  conjunction_topic: "weil",
  english_hint: "He is learning German because...",
  correct_german_sentence: "Er lernt Deutsch, weil...",
  scrambled_words: ["er", "lernt", "Deutsch,", "weil", ...]
}
```

### Key Functions:
- `renderExercise()`: Displays current exercise with scrambled words.
- `handleWordClick()`: Processes word selection and validation.
- `handleSentenceCompletion()`: Manages exercise completion flow.
- `showStatisticsPage()`: Displays final statistics after session completion.
- `fetchExercises()`: Calls the new `/api/exercises` backend endpoint to get a batch of exercises. The backend handles whether to serve from cache or generate new ones.
- `loadTopics()`: Fetches all topics from Airtable backend.
- `createTopic()`: Creates new topic via API.
- `updateTopicPrompt()`: Updates topic prompt (creates new version).
- `showVersionHistory()`: Displays version history modal for topic.
- `restoreVersion()`: Restores a previous prompt version.
- `handleHintClick()`: Provides a hint to the user by highlighting the next correct word.
- `showStatisticsPage()`: Displays a detailed statistics page upon session completion.

### Key Features:
- **Local Word Scrambling**: The `renderExercise` function tokenizes the correct sentence and shuffles the words locally using a Fisher-Yates shuffle algorithm. This provides instant feedback without waiting for an API call.
- **Hint System**: The `handleHintClick` function highlights the next correct word in the sequence. Hint usage is tracked in the session statistics.
- **Statistics Tracking**: The application tracks mistakes, hints used, and session time. A detailed statistics page is shown at the end of a session.
- **Observability**: A "View Last Refined Prompt" button allows the user to see the prompt that was actually sent to the AI, which is useful for debugging.

## On-Demand Prompt Refinement & Generation
The application uses an on-demand generation system. The `refinePrompt` function is a key part of this, designed to improve exercise quality by using a two-step AI process:

1.  **Meta-Prompt**: A hardcoded `metaPrompt` wraps the user's custom prompt, instructing the language model to act as a "prompt engineering assistant" and refine it.
2.  **Refined Prompt Generation**: The combined prompt is sent to the AI, which returns a *refined prompt*.
3.  **Exercise Generation**: This new, refined prompt is then used to generate the actual exercises in the required JSON format.

This entire process is now triggered **only when the exercise cache is insufficient**. It does not run on every user click of the "Generate Exercises" button, making the system much more efficient. If the refinement step fails, the system gracefully falls back to using the user's original prompt for generation.

## Recent Changes
- **Exercise Caching and SRS**: Implemented a full caching layer and Spaced Repetition System to manage exercises and optimize learning.
- **On-Demand Generation**: Changed the exercise generation from a per-request model to an on-demand system triggered by the backend logic.
- **Searchable Combobox for Topic Selection**: Replaced the simple topic dropdown with a searchable combobox in the header for a better user experience.
- **Prompt Refinement**: Added a system to automatically refine user prompts for better exercise quality.
- **Hint System**: Implemented a hint button and tracked hint usage.
- **Statistics Page**: Added a comprehensive session statistics page.
- **Local Word Scrambling**: Moved word scrambling from the AI to the frontend for instant feedback.
- **Rate Limiting**: Added server-side rate limiting to prevent abuse.
- **Observability**: Added a feature to view the last refined prompt.
- **Airtable Integration**: Added persistent storage for topics and prompt versions. (Legacy, deprecated)

## Development Workflow
1. **Local Development**: `go run cmd/server/main.go` → http://localhost:8080
2. **Docker Build**: `docker-compose up`
3. **Cache Issues**: Server restart generates new timestamps
4. **API Testing**: Requires valid OpenAI API key in environment

## Frontend Dependencies
- **Tailwind CSS**: Via CDN for styling
- **Google Fonts**: Inter font family
- **No Build Process**: Pure vanilla JavaScript

## Known Considerations
- **Sample Data**: App initializes with sample exercises for testing
- **Error Handling**: API failures show alerts with error details
- **Keyboard Support**: Full hotkey navigation (1-9, a-z)
- **Responsive Design**: Mobile-friendly with Tailwind classes
- **State Persistence**: Only master prompt setting persists via localStorage

## Debugging Tips
- Console logging added for exercise completion flow
- Check browser developer tools for API response errors
- Cache issues resolved by server restart (generates new timestamps)
- Sample exercises automatically loaded for testing

## Future Enhancement Areas
- Exercise difficulty levels
- Performance analytics over time
- User authentication and progress saving
- More exercise types beyond sentence construction
- Offline mode support