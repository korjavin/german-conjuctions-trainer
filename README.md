# German Conjunctions Trainer

An interactive German language learning application that helps B1-level students master German grammar through engaging word-scramble exercises.

## Features

- **Exercise Caching**: Generated exercises are cached for instant access, reducing API costs and wait times.
- **Spaced Repetition System (SRS)**: For logged-in users, exercises are presented using an SRS algorithm to optimize learning and retention.
- **On-Demand Generation**: New exercises are generated automatically only when the cache is empty or a user has seen all available exercises.
- **Automatic Prompt Refinement**: Uses a meta-prompt to improve user-defined prompts during on-demand generation, leading to more creative and varied exercises.
- **Searchable Topic Selector**: A searchable combobox in the header to easily find and switch between grammar topics.
- **Interactive Exercises**: Engaging word-scramble exercises with customizable topics.
- **Hint System**: Provides hints for the next correct word, with usage tracking.
- **Session Statistics**: Detailed performance tracking, including mistakes, hints used, accuracy, and time per exercise.
- **Local Word Scrambling**: Ensures instant feedback by scrambling words locally.
- **Keyboard Hotkeys**: Use keys 1-9 and a-z for quick word selection.
- **Automatic Punctuation**: Handles punctuation automatically for a smoother experience.
- **Secure Backend**: API keys are stored securely on the server-side.
- **Custom API Support**: Compatible with any OpenAI-compatible API.
- **Responsive Design**: Fully functional on both desktop and mobile devices.
- **Topics Management**: Create, edit, and delete grammar topics.
- **Prompt Customization**: Tailor exercise generation prompts for each topic.
- **Version History**: Track and restore the last 10 versions of a prompt.
- **Persistent Storage**: Uses SQLite for fast and reliable data storage.
- **Database Statistics** (Admin): View total exercises, topics, audio cache size/file count, database size, and per-topic exercise counts from the settings modal.
- **Legacy Airtable Integration**: Support for Airtable (Deprecated).
- **Optional Google Login**: Allows users to log in with their Google account to enable the SRS feature and save settings.

## Optional Google Login
This application provides an optional login feature using Google OAuth 2.0. When a user logs in, the application will store their statistics and settings, allowing them to track their progress across sessions. This feature is entirely optional and the application is fully functional without logging in.

For more information on the data we store, please see our [Privacy Policy](privacy.html).

## Prompt Refinement

This application uses a **Simple Intent** approach combined with optional **Prompt Refinement** to enhance the quality of generated exercises.

**Simple Intent Prompts**: When creating topics, you only need to describe what you want to practice—grammar topic, vocabulary themes, and situations. The backend automatically adds all technical details (system role instructions, variation profiles, JSON output format) before sending to the language model.

Example simple intent prompt:
```
Topic: um...zu and damit conjunctions
Level: B1
Vocabulary: daily life, travel, work
Situations: explaining reasons, expressing goals, giving instructions
```

**Optional Refinement**: If enabled, the application can send your simple intent to a language model with a meta-prompt that expands vocabulary range, suggests diverse real-life situations, and clarifies difficulty level while keeping the result concise.

This ensures that the exercises you receive are not repetitive and are of higher pedagogical quality.

## Observability

To provide insight into the prompt refinement process, you can view the most recently used refined prompt. This is useful for debugging and understanding how the AI is interpreting and improving your prompts.

You can access this feature via the "View Last Refined Prompt" button in the settings menu.

## Running with Docker

### Using the pre-built image from GHCR:

```bash
docker run -p 8080:8080 \
  -e OPENAI_API_KEY=your_openai_api_key_here \
  -e OPENAI_URL=https://api.openai.com/v1 \
  -e MODEL_NAME=gpt-3.5-turbo-1106 \
  ghcr.io/YOUR_USERNAME/german-conjuctions-trainer:latest
```

### Building locally:

```bash
# Build the image
docker build -t german-conjunctions-trainer .

# Run the container
docker run -p 8080:8080 \
  -e OPENAI_API_KEY=your_openai_api_key_here \
  -e OPENAI_URL=https://api.openai.com/v1 \
  -e MODEL_NAME=gpt-4 \
  german-conjunctions-trainer
```

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `OPENAI_API_KEY` | Yes | - | Your OpenAI API key or compatible API key |
| `OPENAI_URL` | No | `https://api.openai.com/v1` | API endpoint URL |
| `OPENAI_TIMEOUT_SECONDS` | No | `180` | Timeout for each LLM request (refinement and generation) |
| `ENABLE_PROMPT_REFINEMENT` | No | `false` | When `true`, runs refinement before generation; otherwise uses variation-profile generation directly |
| `MODEL_NAME` | No | `gpt-3.5-turbo-1106` | Model name to use |
| `SQLITE_PATH` | No | `german.db` | Path to the SQLite database file |
| `PORT` | No | `8080` | Port for the web server |
| `CORS_ALLOWED_ORIGINS` | No | `*` | Comma-separated list of allowed CORS origins. Defaults to wildcard (`*`) for development. **It is strongly recommended to set this to your specific domain(s) in production.** |
| `AUDIO_CACHE_MAX_SIZE_MB` | No | `2048` | Maximum size of the local TTS audio cache in MB (e.g., `2048` for 2GB). Older files are removed when the limit is reached. |
| `GOOGLE_CLIENT_ID` | No | - | Your Google OAuth 2.0 Client ID |
| `GOOGLE_CLIENT_SECRET` | No | - | Your Google OAuth 2.0 Client Secret |
| `GOOGLE_REDIRECT_URL` | No | - | Your Google OAuth 2.0 Redirect URL |
| `COOKIE_HASH_KEY` | No | Randomly generated | A 64-byte key for HMAC authentication of cookies. If not set, a temporary key is generated at startup. **It is strongly recommended to set this for production.** |
| `COOKIE_BLOCK_KEY` | No | Randomly generated | A 32-byte key for AES-256 encryption of cookie data. If not set, a temporary key is generated at startup. **It is strongly recommended to set this for production.** |

## Database Migrations

The application automatically runs database migrations on startup to update the schema. If you're upgrading from an older version:

- Migrations will add `parent_id` and `sort_order` columns to the topics table
- A unique constraint on (parent_id, name) will be added to prevent duplicate topic names at the same level
- Additional tracking columns may be added for user exercise statistics

**Important**: If you have duplicate topic names at the same parent level in your existing database, the migration will fail. You must manually resolve duplicates by renaming or deleting duplicate topics before the migration can complete.

Migrations are designed to be idempotent - running them multiple times has no effect.

## Running Tests

The project includes comprehensive test suites for both backend and frontend functionality.

### Backend Tests (Go)

```bash
# Run all tests
go test ./...

# Run tests for specific package
go test ./internal/app/...
go test ./pkg/storage/...

# Run tests with verbose output
go test -v ./...

# Run tests with coverage
go test -cover ./...
```

### Frontend Tests (JavaScript)

JavaScript tests are designed for browser-based verification:

1. **Browser Console Tests**:
   - Open the application in your browser
   - Open Developer Tools (F12)
   - Go to Console tab
   - Paste the contents of any test file from `js/topics-*-test.js`
   - Tests will run automatically and report results

2. **Performance Test Runner**:
   - Open `js/topics-performance-test-runner.html` in your browser
   - Click "Run All Tests" button
   - Results appear in console and on the page

3. **Test Guides**: Each feature has a corresponding test guide:
   - `js/topics-accessibility-test-guide.md` - Accessibility feature verification
   - `js/topics-collapse-test-guide.md` - Expand/collapse functionality
   - `js/topics-dragdrop-test-guide.md` - Drag-and-drop behavior
   - `js/topics-form-test-guide.md` - Form validation and UX
   - `js/topics-icon-test-guide.md` - Topic icons rendering
   - `js/topics-search-test-guide.md` - Search functionality
   - `js/topics-sort-test-guide.md` - Sorting behavior

### Test Coverage

The comprehensive test suite covers:
- Backend API validation and error handling
- Database operations and migrations
- Frontend UI interactions
- Accessibility compliance (WCAG, ARIA)
- Performance characteristics (virtual scrolling, debouncing)
- User workflows (CRUD operations, drag-and-drop)

## Airtable Setup (Deprecated)

**Note:** Airtable storage is deprecated and will be removed in future versions. Use SQLite (default) instead.

To use Airtable (legacy), set `STORAGE_TYPE=airtable` and configure the following:

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `AIRTABLE_TOKEN` | Yes (if Airtable) | - | Your Airtable Personal Access Token |
| `AIRTABLE_BASE_ID` | Yes (if Airtable) | - | Your Airtable Base ID |

### Default Topics

On first startup, the application will create two default topics:
- **Conjunctions**: Focus on German conjunctions (weil, obwohl, etc.)
- **Verb + Preposition**: Verb-preposition combinations

### Topic Hierarchy
Topics can be organized hierarchically in a tree structure with advanced features:

**Topic Hierarchy Features:**

- **Visual Tree Lines**: Clear visual connectors show parent-child relationships at any depth level
- **Expand/Collapse**: Collapse branches to reduce clutter, with state persisted across sessions. Collapse All / Expand All buttons in the toolbar for quick bulk toggling
- **Topic Icons**: Folder icons for topics with children, file icons for leaf topics
- **Search & Filter**: Instant search with auto-expansion of parent topics and text highlighting
- **Top-Level Sorting**: Sort top-level topics by name (A-Z, Z-A), date (newest/oldest), or custom order without affecting nested children
- **Enhanced Drag-and-Drop**: Improved visual feedback with ghost preview, drop zone indicators, and animations
- **Better Form UX**: Real-time validation, hierarchy preview, recently-used topics quick-select, and keyboard shortcuts (Ctrl+Enter to save, Escape to cancel)
- **Accessibility**: Full keyboard navigation (Arrow keys, Home, End, Enter/Space to expand), ARIA attributes, and screen reader announcements
- **Performance**: Virtual scrolling for large topic lists (100+ topics) and debounced search input

**Topic Name Uniqueness:** Topic names must be unique at the same parent level (case-insensitive). You cannot create two topics with the same name that share the same parent, but you can reuse names at different levels (e.g., "Grammar" -> "Verbs" and "Adjectives" -> "Verbs" are both allowed).

**Sort Order Field:** Topics have a `sort_order` field that determines their display position within their parent. Lower values appear first. When using the "Custom Order" sort option, topics are displayed based on their `sort_order` value.

**Tree Depth Limit:** Topic trees are limited to a maximum depth of 100 levels to prevent performance issues.

**Topic Creation Rules:**

When creating or editing topics, the following validation rules apply:
- **Topic Name**: Required, max 200 characters
- **Prompt**: Required, min 10 characters, max 10,000 characters
- **Sort Order**: Required, must be a non-negative integer (0-999,999)

You can assign a parent topic to any new or existing topic to keep your exercises neatly categorized (e.g., "Grammar" -> "Verbs" -> "Verb + Preposition"). Deleting a topic that has children is prevented with a HTTP 409 Conflict to ensure data integrity.

**Keyboard Shortcuts for Topic Tree:**
- Arrow Up/Down/Left/Right: Navigate between topics
- Home: Jump to first topic
- End: Jump to last topic
- Enter or Space: Toggle expand/collapse for topics with children
- Escape: Exit tree navigation
- Ctrl+F or Cmd+F: Focus topic search input

## Custom API Providers

The application supports any OpenAI-compatible API through environment variables:

```bash
# Example: Using Claude via Anthropic API
docker run -p 8080:8080 \
  -e OPENAI_API_KEY=your_anthropic_key \
  -e OPENAI_URL=https://api.anthropic.com/v1 \
  -e MODEL_NAME=claude-3-sonnet-20240229 \
  german-conjunctions-trainer

# Example: Using Azure OpenAI
docker run -p 8080:8080 \
  -e OPENAI_API_KEY=your_azure_key \
  -e OPENAI_URL=https://your-resource.openai.azure.com/v1 \
  -e MODEL_NAME=gpt-4 \
  german-conjunctions-trainer
```

## Development

### Local Development:

```bash
# Set required environment variables
export OPENAI_API_KEY=your_openai_api_key

# Run the Go backend
go run main.go

# The server will serve static files from ./static/ (for Docker) or current directory (local)
# Access the app at http://localhost:8080
```

### Rate Limiting
The backend includes rate limiting to prevent abuse. By default, it allows one request every three seconds per IP address.

### Project Structure

```
.
├── main.go              # Go backend server with API and Airtable integration
├── index.html           # Main application UI
├── app.js               # Frontend JavaScript for interactivity and topics management
├── agent.md             # Context file for AI development
├── Dockerfile           # Container definition for production
├── docker-compose.yml   # Docker Compose for local development
├── go.mod               # Go module dependencies
├── example.prompt.md    # Example prompt for exercise generation
└── .github/workflows/   # CI/CD pipelines for Docker builds
```

## Security

- API keys are stored server-side only
- No sensitive data in browser localStorage
- CORS headers properly configured
- Non-root container user

## License

MIT License - see LICENSE file for details.

---
### Automated Frontend Unit Tests (Vitest)

The application includes a fast, automated unit test suite for the vanilla JS frontend using Vitest and happy-dom.

To run the automated tests:
```bash
# Run all tests once
pnpm test

# Run tests in watch mode
pnpm run test:watch

# Run tests and generate coverage report
pnpm run test:coverage
```
