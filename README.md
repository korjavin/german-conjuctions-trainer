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
- **Legacy Airtable Integration**: Support for Airtable (Deprecated).
- **Optional Google Login**: Allows users to log in with their Google account to enable the SRS feature and save settings.

## Optional Google Login
This application provides an optional login feature using Google OAuth 2.0. When a user logs in, the application will store their statistics and settings, allowing them to track their progress across sessions. This feature is entirely optional and the application is fully functional without logging in.

For more information on the data we store, please see our [Privacy Policy](privacy.html).

## Prompt Refinement

This application uses a unique **Prompt Refinement** feature to enhance the quality of the generated exercises. When you request new exercises, the application first sends your custom prompt to a language model with a "meta-prompt". This meta-prompt instructs the model to refine your original prompt for better clarity, creativity, and variety, all while preserving the core task and required JSON output format.

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
| `MODEL_NAME` | No | `gpt-3.5-turbo-1106` | Model name to use |
| `SQLITE_PATH` | No | `german.db` | Path to the SQLite database file |
| `PORT` | No | `8080` | Port for the web server |
| `GOOGLE_CLIENT_ID` | No | - | Your Google OAuth 2.0 Client ID |
| `GOOGLE_CLIENT_SECRET` | No | - | Your Google OAuth 2.0 Client Secret |
| `GOOGLE_REDIRECT_URL` | No | - | Your Google OAuth 2.0 Redirect URL |
| `COOKIE_HASH_KEY` | No | Randomly generated | A 64-byte key for HMAC authentication of cookies. If not set, a temporary key is generated at startup. **It is strongly recommended to set this for production.** |
| `COOKIE_BLOCK_KEY` | No | Randomly generated | A 32-byte key for AES-256 encryption of cookie data. If not set, a temporary key is generated at startup. **It is strongly recommended to set this for production.** |

## Airtable Setup (Deprecated)

**Note:** Airtable storage is deprecated and will be removed in future versions. Use SQLite (default) instead.

To use Airtable (legacy), set `STORAGE_TYPE=airtable` and configure the following:

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `AIRTABLE_TOKEN` | Yes (if Airtable) | - | Your Airtable Personal Access Token |
| `AIRTABLE_BASE_ID` | Yes (if Airtable) | - | Your Airtable Base ID |

### Default Topics

On first startup, the application will create three default topics:
- **Conjunctions**: Focus on German conjunctions (weil, obwohl, etc.)
- **Verb + Preposition**: Verb-preposition combinations
- **Preterite vs Perfect**: Practice with German tenses

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

## CLI for Exercise Generation

This project includes a command-line interface (CLI) to pre-generate exercises for a specific topic and save them to your database. This is useful for populating your database with content without using the web interface.

### Usage

To run the CLI, use the following command from the root of the project:

```bash
go run cmd/generator/main.go "<topic_name>"
```

Replace `<topic_name>` with the exact name of the topic you want to generate exercises for. The topic name is case-insensitive.

### Required Environment Variables

The CLI requires the same environment variables as the main application to connect to the database and the OpenAI API.

- `OPENAI_API_KEY`: Your OpenAI API key.

Make sure these variables are exported in your shell session before running the command.

### Example

If you have a topic named "Verb + Preposition", you can generate new exercises for it by running:

```bash
export OPENAI_API_KEY="sk-..."

go run cmd/generator/main.go "Verb + Preposition"
```

The script will then:
1. Find the topic in your database.
2. Fetch all existing exercises for that topic to prevent duplicates.
3. Call the OpenAI API to generate a new set of exercises.
4. Filter out any exercises that are already in your database.
5. Save the new, unique exercises to the database.
