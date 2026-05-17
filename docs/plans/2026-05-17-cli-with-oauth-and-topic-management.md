# CLI for Topic Management and Exercise Generation

## Overview

Currently topic creation/modification and exercise generation can only be triggered through the web UI by an authenticated admin. This is inconvenient when the user wants to delegate these tasks to a coding agent or run them as part of a script.

This plan adds a Go-based command-line tool (`gct`) that:

1. **Authenticates via Google OAuth** using the OAuth 2.0 **Device Authorization Grant** ("device flow"). User runs `gct login`; CLI prints a short user code and a URL (`https://www.google.com/device`); user opens that URL on any browser (laptop, phone) and enters the code; CLI polls Google's token endpoint until auth completes; CLI then exchanges the Google access token for a server-issued bearer token and persists it to `~/.config/gct/config.json`. This flow works equally well on laptops, SSH sessions, and headless agent containers — no browser needs to open on the CLI host.
2. **Manages topics**: list, get, create, update, delete, and move topics under the existing `/api/topics` endpoints.
3. **Triggers exercise generation** for a topic by calling the existing `POST /api/exercises` endpoint.

Once the token is saved, subsequent commands are fully non-interactive — an agent can invoke `gct topics create …` or `gct exercises generate …` without any browser interaction. The token is long-lived and revocable from the server.

## Context (from discovery)

**Files/components involved:**

Backend (modified):
- `cmd/server/main.go` — wire CLI OAuth client config + token storage
- `internal/app/app.go` — register new routes for CLI auth
- `internal/app/auth.go` — add CLI token exchange handler
- `internal/app/middleware.go` — extend `withAuth`/`withOptionalAuth`/`adminOnly` to accept `Authorization: Bearer <token>` alongside the existing `user-session` cookie
- `pkg/storage/storage.go` + `pkg/storage/sqlite.go` — new `cli_tokens` table + CRUD methods

CLI (new):
- `cmd/cli/main.go` — entry point, subcommand dispatch
- `internal/cli/` (new package) — command implementations, HTTP client, config storage, OAuth flow

**Related patterns found:**
- Existing OAuth flow: `internal/app/auth.go:14-91` (login/callback handlers using `golang.org/x/oauth2` + `google.golang.org/api/oauth2/v2` for userinfo)
- Auth middleware: `internal/app/middleware.go:39-79` (cookie-based; needs extension for bearer tokens)
- Admin gating: `internal/app/middleware.go:81-109` (checks `user.GoogleID == AdminGoogleID`)
- Topic endpoints: `internal/app/topics.go:160-276` (GET list / POST create), `:278+` (GET/PUT/DELETE by ID, PUT /move)
- Exercise generation: `internal/app/exercises.go:16-` (`POST /api/exercises` accepts `llm.GenerateRequest{TopicID}`)
- Storage migration pattern: `pkg/storage/sqlite.go:113-153` (idempotent `CREATE TABLE IF NOT EXISTS` migrations list)

**Dependencies identified:**
- Already present: `golang.org/x/oauth2`, `google.golang.org/api/oauth2/v2`, `github.com/google/uuid`, `github.com/mattn/go-sqlite3`
- No new third-party deps required. CLI uses stdlib `flag` for subcommand parsing to keep the dependency graph minimal. (If we later want richer help text, we can move to `cobra`.)

## Development Approach

- **Testing approach**: Regular (code first, then tests). Tests added in the same task as the code they cover.
- Complete each task fully before moving to the next.
- Make small, focused changes.
- **CRITICAL: every task MUST include new/updated tests** for code changes in that task.
- **CRITICAL: all tests must pass before starting next task** — no exceptions.
- **CRITICAL: update this plan file when scope changes during implementation.**
- Run `go test ./...` after each change.
- Maintain backward compatibility: existing web-based cookie auth must continue to work unchanged.

## Testing Strategy

- **Unit tests**: required for every task. New code goes alongside existing `*_test.go` files in the same package.
  - `internal/app/middleware_test.go` — bearer token path through middleware.
  - `internal/app/auth_cli_test.go` — `/api/auth/cli-exchange` handler.
  - `pkg/storage/sqlite_cli_tokens_test.go` — token CRUD.
  - `internal/cli/*_test.go` — config storage, HTTP client (with `httptest.Server`), OAuth callback handler.
- **Integration test for CLI ↔ server**: a single test in `internal/cli/integration_test.go` that spins up the real `app.New(...)` against a temp SQLite, stubs the Google `userinfo` endpoint, and exercises login → topics create → exercises generate end-to-end.
- **E2E (Playwright)**: out of scope — CLI has no UI. The web admin UI is unchanged.

## Progress Tracking

- Mark completed items with `[x]` immediately when done.
- Add newly discovered tasks with ➕ prefix.
- Document issues/blockers with ⚠️ prefix.
- Update plan if implementation deviates from original scope.
- Keep plan in sync with actual work done.

## What Goes Where

- **Implementation Steps** (`[ ]` checkboxes): tasks achievable within this codebase — code changes, tests, documentation updates.
- **Post-Completion** (no checkboxes): items requiring external action — creating the Google "Desktop App" OAuth credential, building/distributing the binary, manual verification.

## Design Rationale (chosen approach + alternatives)

**Chosen: OAuth 2.0 Device Authorization Grant + server-issued bearer token.**

1. CLI POSTs to Google's device endpoint (`https://oauth2.googleapis.com/device/code`) with the CLI's client ID and scopes `userinfo.email userinfo.profile`. Response includes `device_code`, `user_code`, `verification_url`, `interval`, `expires_in`.
2. CLI prints to the user:
   ```
   To sign in, open this URL on any device:
       https://www.google.com/device
   And enter this code:
       XYZW-ABCD
   Waiting for confirmation… (expires in 15 min)
   ```
3. CLI polls Google's token endpoint every `interval` seconds with `grant_type=urn:ietf:params:oauth:grant-type:device_code` and the `device_code` until it returns an access token (or until expiry / user denial). `golang.org/x/oauth2` (v0.18+, we have v0.30) supports this natively via `Config.DeviceAuth` / `Config.DeviceAccessToken`.
4. CLI POSTs the Google access token to `POST /api/auth/cli-exchange` on our server, along with an optional `label` (defaults to `"cli"`).
5. Server calls `oauth2v2.Userinfo.Get()` with that token (reusing the existing pattern from `auth.go:44-57`), finds-or-creates the user, generates a random 256-bit token, stores its SHA-256 hash in the new `cli_tokens` table, and returns the plaintext token to the CLI.
6. CLI writes the token to `~/.config/gct/config.json` with mode `0600`. `gct login` can be re-run with a different `--label` to accumulate additional tokens (one per device/agent context); each new login does **not** invalidate prior tokens.

**Token accumulation:** server allows multiple active tokens per user. Each token row has a `label` for human identification. A future `gct auth tokens list/revoke` subcommand will let users manage them; for now, revocation is possible via direct DB update or via the web admin.

**Alternatives considered and rejected:**

- **A. OAuth loopback redirect flow** (browser opens automatically, CLI listens on `127.0.0.1`): great UX on laptops but doesn't work on headless/SSH/agent boxes — exactly the case that motivated this work.
- **B. Server-issued token via web UI ("PAT" style)**: simpler but the user explicitly asked for an OAuth Google flow; also forces a context switch to the web UI every time a new device needs access.
- **C. Reuse the web `GOOGLE_CLIENT_ID`**: technically possible but a separate "Desktop"/"TV-and-limited-input" client in GCP is the documented best practice and keeps web-app credential rotation independent.

## Implementation Steps

### Task 1: Add `cli_tokens` storage layer

- [x] add `CLIToken` struct to `pkg/storage/storage.go` (fields: `ID string`, `UserID string`, `TokenHash string`, `Label string`, `CreatedAt time.Time`, `LastUsedAt *time.Time`, `RevokedAt *time.Time`)
- [x] extend `Storage` interface with `CreateCLIToken(userID, tokenHash, label string) (*CLIToken, error)`, `GetCLITokenByHash(tokenHash string) (*CLIToken, error)`, `TouchCLIToken(id string) error`, `RevokeCLIToken(id, userID string) error`, `ListCLITokensForUser(userID string) ([]*CLIToken, error)`
- [x] add `CREATE TABLE IF NOT EXISTS cli_tokens (...)` to the migrations slice in `pkg/storage/sqlite.go` around line 119 (columns: `id TEXT PRIMARY KEY`, `user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE`, `token_hash TEXT NOT NULL UNIQUE`, `label TEXT NOT NULL DEFAULT ''`, `created_at DATETIME NOT NULL`, `last_used_at DATETIME`, `revoked_at DATETIME`), plus `CREATE INDEX IF NOT EXISTS idx_cli_tokens_user_id ON cli_tokens(user_id)`
- [x] implement the five new methods on `*SQLiteStorage` in `pkg/storage/sqlite.go`
- [x] write `pkg/storage/sqlite_cli_tokens_test.go` covering: create returns row; get-by-hash finds it; get-by-hash returns nil for unknown hash; revoked tokens are still returned but `RevokedAt` is set; cascade delete when user deleted; `TouchCLIToken` updates `last_used_at`; list filters out revoked tokens
- [x] write tests for error cases (duplicate hash → unique constraint error; unknown user_id → FK violation)
- [x] run `go test ./pkg/storage/...` — must pass before next task

### Task 2: Add `POST /api/auth/cli-exchange` endpoint

- [x] in `internal/app/auth.go`, add `handleCLIExchange(w, r)`:
  - decode `{ "google_access_token": "..." , "label": "..." }`
  - call `oauth2v2.Userinfo.Get().Do()` using `oauth2.StaticTokenSource` with the supplied access token (mirror `auth.go:44-57`)
  - find-or-create user via `a.DB.GetUserByGoogleID` / `a.DB.CreateUser` (mirror `auth.go:59-72`)
  - generate 32 random bytes via `crypto/rand`, base64-url-encode without padding → `plaintext`
  - hash with `sha256.Sum256([]byte(plaintext))` → hex string
  - call `a.DB.CreateCLIToken(user.ID, hash, label)`
  - respond `{ "token": "<plaintext>", "token_id": "...", "user_id": "..." }`
- [x] in `internal/app/app.go`, register `http.HandleFunc("/api/auth/cli-exchange", a.handleCLIExchange)` (unauthenticated — the Google token *is* the credential)
- [x] write `internal/app/auth_cli_test.go`: covers happy path + format/hash/user assertions via a fake UserInfoFetcher (preferred over httptest.Server because the oauth2v2 SDK URL is hardcoded)
- [x] write tests for error cases (invalid Google token → 401; missing body → 400; userinfo fetch failure → 502)
- [x] **Note on testability**: the Google userinfo URL is hardcoded inside `oauth2v2`. To test, abstract the userinfo fetch behind an interface field on `App` (default: real `oauth2v2`; in tests: a fake). Document this in code.
- [x] run `go test ./internal/app/...` — must pass before next task

### Task 3: Extend auth middleware to accept bearer tokens

- [x] in `internal/app/middleware.go`, add helper `func (a *App) resolveBearerUserID(r *http.Request) (string, bool)`:
  - read `Authorization` header; if not `Bearer <token>`, return `"", false`
  - hash the token with SHA-256
  - call `a.DB.GetCLITokenByHash(hash)`; if nil or `RevokedAt != nil`, return `"", false`
  - fire `a.DB.TouchCLIToken(tok.ID)` in a goroutine (don't block requests)
  - return `tok.UserID, true`
  - (Implemented as `resolveBearer` returning a three-state result so an explicit-but-invalid bearer rejects rather than silently falling back to cookie.)
- [x] modify `withAuth` (line 61): before falling through to cookie check, try `resolveBearerUserID`; if it succeeds, inject `userContextKey` and call `next`
- [x] modify `withOptionalAuth` (line 39) identically
- [x] `adminOnly` (line 81) needs no change — it reads `userIDFromRequest` which we've already populated
- [x] write `internal/app/middleware_test.go` (extend existing file if present): table-driven test covering: valid bearer → user injected; revoked bearer → 401 from `withAuth`, guest path from `withOptionalAuth`; unknown bearer → 401/guest; bearer + cookie present → bearer wins; cookie-only still works; bearer for admin user passes `adminOnly`; bearer for non-admin user fails `adminOnly`
- [x] run `go test ./internal/app/...` — must pass before next task

### Task 4: Scaffold CLI binary structure

- [x] create `cmd/cli/main.go` with stdlib `flag`-based subcommand router; subcommands: `login`, `logout`, `whoami`, `topics`, `exercises`
- [x] create `internal/cli/config.go`:
  - `Config struct { ServerURL, Token, UserID string }`
  - `Load() (*Config, error)` — reads `$XDG_CONFIG_HOME/gct/config.json` (fallback `~/.config/gct/config.json`); returns zero-value config if file missing
  - `Save(cfg *Config) error` — writes JSON with mode `0600`, creates parent dirs as needed
  - `Path() string` — exposed for `--config` flag override
- [x] create `internal/cli/client.go`:
  - `Client struct { BaseURL, Token string, HTTP *http.Client }`
  - `func (c *Client) do(method, path string, body any, out any) error` — sets `Authorization: Bearer <token>`, JSON encode/decode, surfaces non-2xx as typed errors with body text
- [x] add a build tag `//go:build !cli` (or similar) so the server `go test` runs don't try to compile the CLI — actually skip this; both binaries can coexist in the same module. Just ensure `cmd/cli` has no server imports.
- [x] write `internal/cli/config_test.go`: round-trip save/load; permissions assertion; env var override; corrupt file returns error
- [x] write `internal/cli/client_test.go` using `httptest.Server`: GET/POST success, 401 returns a "not logged in" error, 4xx surfaces server error message, network errors are wrapped
- [x] run `go build ./cmd/cli` and `go test ./internal/cli/...` — must pass before next task

### Task 5: Implement `gct login` / `logout` / `whoami` (device flow)

- [x] create `internal/cli/oauth.go` implementing the device flow:
  - `func Login(ctx, serverURL, label string, out io.Writer) (*LoginResult, error)` — runs the OAuth 2.0 Device Authorization Grant and exchanges the resulting Google access token for a server-issued bearer via POST /api/auth/cli-exchange. Internal `loginWith(ctx, loginOptions)` is the test seam so httptest.Server can stand in for both Google and the project's own server.
  - build `oauth2.Config{ClientID, ClientSecret, Scopes: [userinfo.email, userinfo.profile], Endpoint}` (endpoint defaults to `google.Endpoint`)
  - call `cfg.DeviceAuth(ctx)` → get `*oauth2.DeviceAuthResponse{DeviceCode, UserCode, VerificationURI, Interval, Expiry}`
  - print prompt: `"To sign in, open this URL on any device:\n    <URI>\nAnd enter this code:\n    <CODE>\nWaiting for confirmation… (expires in <D>)\n"` to the supplied `io.Writer`
  - call `cfg.DeviceAccessToken(ctx, da)` — blocks, polling at `Interval` until success/expiry/denial; `friendlyDeviceErr` maps `*oauth2.RetrieveError` codes onto action-oriented messages for `access_denied`, `expired_token`
  - POST `{ "google_access_token": tok.AccessToken, "label": label }` to `<serverURL>/api/auth/cli-exchange`, return `LoginResult{Token, UserID, Label}`
- [x] embed `googleClientID` / `googleClientSecret` via `-ldflags "-X 'german-conjunctions-trainer/internal/cli.googleClientID=…' -X 'german-conjunctions-trainer/internal/cli.googleClientSecret=…'"`; also accept `GCT_GOOGLE_CLIENT_ID`/`GCT_GOOGLE_CLIENT_SECRET` env overrides; `ErrMissingGoogleClient` returned with a clear message if neither is set
- [x] add `gct login [--server URL] [--label NAME] [--config PATH]` command in `cmd/cli/main.go` (default label `"cli"`); on success, write token to config; print `"Logged in as <userID> (label: <label>)"`. Re-running `gct login` does NOT revoke prior tokens — server accumulates them. Ctrl-C cancels via a SIGINT-aware context.
- [x] add `gct logout` — clears token from local config only (server-side revocation is a future enhancement)
- [x] add `gct whoami` — `GET /api/auth/status` with bearer header; prints user ID and configured server URL. Required wrapping `handleAuthStatus` in `withOptionalAuth` so bearer-token requests authenticate the same way cookie requests do.
- [x] write `internal/cli/oauth_test.go`: stand up an `httptest.Server` that fakes both Google device endpoints (device auth, token poll) and the project's `/api/auth/cli-exchange`. Use a custom `oauth2.Endpoint{DeviceAuthURL, TokenURL}` pointing at the fake server. Asserts: happy path returns token + records label/google-token on the server; `authorization_pending` then success works; `access_denied` and `expired_token` return clean errors; context cancellation propagates as `context.DeadlineExceeded`; exchange failure surfaces an `ErrUnauthorized`-wrapped `*APIError`; missing client credentials → `ErrMissingGoogleClient`; env-var overrides bypass `ErrMissingGoogleClient`.
- [x] run `go test ./internal/cli/...` and `go build ./cmd/cli` — passes; full `go test ./...` is green.

### Task 6: Implement `gct topics` subcommands

- [x] in `internal/cli/topics.go`, implement client methods: `ListTopics()`, `GetTopic(id)`, `CreateTopic(name, prompt, parentID, sortOrder)`, `UpdateTopic(id, partial)`, `DeleteTopic(id)`, `MoveTopic(id, parentID, position)`
- [x] in `cmd/cli/main.go`, wire `topics` subcommands:
  - `gct topics list [--tree]` — flat JSON list, or indented tree if `--tree`
  - `gct topics get <id>` — JSON
  - `gct topics create --name X --prompt Y [--parent ID] [--sort N] [--prompt-file PATH]` — `--prompt-file` reads body from disk (since prompts can be long); `-` reads stdin
  - `gct topics update <id> [--name X] [--prompt Y | --prompt-file PATH] [--parent ID | --no-parent] [--sort N]`
  - `gct topics delete <id> [--yes]` — confirm prompt unless `--yes`
  - `gct topics move <id> --parent ID [--position N]`
- [x] all commands honor `--server URL`, `--config PATH`, `--json` (raw JSON output for scripting), `--token TOKEN` (env override). Positional id can appear before flags thanks to a small `reorderArgs` shim, since stdlib `flag` otherwise stops at the first non-flag token.
- [x] write `internal/cli/topics_test.go`: each method round-trips against `httptest.Server`; assert correct path, method, body shape; 401 surfaces "log in first"; 403 surfaces "admin required"
- [x] write command-level tests by invoking the dispatcher with `args []string` and asserting on stdout/stderr buffers (added in `cmd/cli/main_test.go`; `run` signature gained an `io.Reader` for the delete-confirmation prompt)
- [x] run `go test ./internal/cli/...` — passes; full `go test ./...` also green

### Task 7: Implement `gct exercises generate`

- [ ] in `internal/cli/exercises.go`, implement `GenerateExercises(topicID string) ([]Exercise, error)` calling `POST /api/exercises` with body `{"topic_id": "..."}`
- [ ] in `cmd/cli/main.go`, add `gct exercises generate <topic-id> [--watch]`:
  - default: prints summary (number of exercises returned, topic name, breakdown by type if available)
  - `--json`: raw response
  - `--watch`: poll the endpoint every 5s up to 5 attempts if fewer than 10 exercises returned (helps when LLM cache is cold and generation runs in background)
- [ ] write `internal/cli/exercises_test.go`: round-trip POST with topic_id, surface 404 for unknown topic, surface 500 with body text, `--watch` polls correctly
- [ ] run `go test ./...` — must pass before next task

### Task 8: Wire CLI build into Makefile / CI + add `gct --version`

- [ ] add `make build-cli` target to existing build pipeline (or new `Makefile` if none exists — check `.github/workflows/` first)
- [ ] add `gct --version` and `gct version` printing version + commit (use `runtime/debug.ReadBuildInfo` for module info; commit injected via `-ldflags`)
- [ ] update `.github/workflows/` to also `go build ./cmd/cli` so a broken CLI fails CI
- [ ] verify `go vet ./...` and `go build ./...` pass
- [ ] run full test suite `go test ./...` — must pass before next task

### Task 9: Verify acceptance criteria

- [ ] verify `gct login` flow works end-to-end against a local server instance (manual one-time check; document in Post-Completion)
- [ ] verify `gct topics list`, `create`, `update`, `delete`, `move` all work as a non-admin (should get 403 from server) and as the admin user (should succeed)
- [ ] verify `gct exercises generate <topic-id>` returns exercises for a known topic
- [ ] verify revoked tokens (via direct DB update) cause subsequent calls to fail with a clear "token revoked or invalid — run `gct login`" message
- [ ] verify existing web cookie auth still works (open the web app, log in, create a topic — should be unaffected)
- [ ] run full test suite `go test ./...` — all green
- [ ] run linter (whatever is used in CI) — all issues fixed
- [ ] verify test coverage of new packages meets 80%+

### Task 10: [Final] Documentation

- [ ] add a `CLI.md` (or extend `README.md`) covering: install/build, one-time GCP setup for the Desktop OAuth client, `gct login`, common commands, troubleshooting (token expiry, server URL config)
- [ ] document the new env vars (none required for server — Google CLI client config is in the CLI binary itself; optionally support `GCT_GOOGLE_CLIENT_ID`/`GCT_GOOGLE_CLIENT_SECRET` overrides for self-hosted forks)
- [ ] add a short section to `agent.md` noting that agents can use `gct` directly once an admin has run `gct login` in the agent's environment

*Note: ralphex automatically moves completed plans to `docs/plans/completed/`*

## Technical Details

**New table `cli_tokens`:**

```sql
CREATE TABLE IF NOT EXISTS cli_tokens (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    label TEXT NOT NULL DEFAULT '',
    created_at DATETIME NOT NULL,
    last_used_at DATETIME,
    revoked_at DATETIME
);
CREATE INDEX IF NOT EXISTS idx_cli_tokens_user_id ON cli_tokens(user_id);
```

**Token format:**

- 32 bytes from `crypto/rand`, base64-url-encoded without padding (~43 chars). Prefix with `gct_` for grep-ability — `"gct_" + base64url(32 random bytes)`.
- Stored as SHA-256 hex (64 chars) — server never persists plaintext.

**`POST /api/auth/cli-exchange` contract:**

Request:
```json
{ "google_access_token": "ya29...", "label": "laptop-agent" }
```
Response (201):
```json
{ "token": "gct_…", "token_id": "uuid", "user_id": "uuid" }
```
Errors: 400 (bad body), 401 (Google token invalid), 502 (userinfo fetch failed).

**Config file `~/.config/gct/config.json`** (mode 0600):
```json
{ "server_url": "https://german.example.com", "token": "gct_…", "user_id": "uuid" }
```

**CLI subcommand surface:**

```
gct login    [--server URL] [--label NAME]   # device flow; label defaults to "cli"
gct logout                                    # local-only; clears config token
gct whoami
gct topics   list [--tree] [--json]
gct topics   get <id> [--json]
gct topics   create  --name X --prompt Y|--prompt-file F [--parent ID] [--sort N]
gct topics   update  <id> [--name X] [--prompt Y|--prompt-file F] [--parent ID|--no-parent] [--sort N]
gct topics   delete  <id> [--yes]
gct topics   move    <id> --parent ID [--position N]
gct exercises generate <topic-id> [--watch] [--json]
gct version
```

Global flags: `--server URL`, `--config PATH`, `--token TOKEN`, `--json`.

**Authentication transport:** server middleware accepts the bearer token **only** via `Authorization: Bearer <token>`. No `?token=…` query parameter — keeps tokens out of access logs and proxy URLs.

**Backward compatibility:** No breaking changes. Cookie auth path is unchanged; bearer-token path is additive in middleware. All new endpoints/routes live under `/api/auth/cli-…` and don't overlap with existing paths.

## Post-Completion

*Items requiring manual intervention or external systems — no checkboxes, informational only.*

**One-time GCP setup (required before `gct login` will work):**
- In Google Cloud Console → APIs & Services → Credentials → Create OAuth client ID → application type **TVs and Limited Input devices** (this is the type that supports the Device Authorization Grant). If only "Desktop app" is available in the picker, that works too — Google's device endpoint accepts both client types for `userinfo.email`/`userinfo.profile` scopes.
- Verify the OAuth consent screen lists the project and that `userinfo.email` + `userinfo.profile` scopes are enabled (already true if the web app uses them).
- Copy the new client ID/secret into the build via `-ldflags "-X 'german-conjunctions-trainer/internal/cli.googleClientID=…' -X 'german-conjunctions-trainer/internal/cli.googleClientSecret=…'"`, set them via `GCT_GOOGLE_CLIENT_ID`/`GCT_GOOGLE_CLIENT_SECRET` env vars, or distribute prebuilt binaries.
- The web app's existing OAuth client is unaffected and is **not** reused.

**Manual verification:**
- Run `gct login --label laptop` end-to-end against staging. Confirm the terminal prints a code + URL, that visiting `https://www.google.com/device` on a phone or laptop and entering the code completes the sign-in, and that the terminal shows "Logged in as …".
- Run `gct topics create --name 'CLI Smoke Test' --prompt 'A short test prompt for the CLI plan acceptance test.'` and verify the topic appears in the web UI.
- Run `gct exercises generate <id>` and verify exercises return.
- Confirm the same flows work in a headless agent shell once `~/.config/gct/config.json` is in place — `gct login` should also work *from* the agent shell since device flow doesn't require a local browser.
- Run `gct login --label phone` again to confirm token accumulation: the new token works **and** the previous one still works (check by hitting `/api/auth/status` with each bearer value).

**External system updates:**
- If/when binaries are distributed (Homebrew tap, GH releases, etc.), document the install path.
- If a self-hosted fork sets `GCT_GOOGLE_CLIENT_ID`, document that override.

**Future enhancements (out of scope):**
- `gct auth tokens list` / `gct auth tokens revoke <id>` for managing issued tokens from CLI.
- `gct login --device` for headless SSH boxes (Google Device Authorization Grant).
- Token expiry / rotation policy on the server side.
