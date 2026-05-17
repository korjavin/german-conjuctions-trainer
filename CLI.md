# `gct` — Command-Line Client

`gct` is a Go-based CLI that lets admins and coding agents manage topics and
trigger exercise generation without going through the web UI. It authenticates
once via Google OAuth (device flow) and stores a long-lived bearer token in
`~/.config/gct/config.json`, after which every subcommand is non-interactive
and safe to script.

The device flow does not require a local browser, so the CLI works equally
well on laptops, SSH sessions, and headless agent containers.

## Install / Build

Both binaries live under `cmd/`. The Makefile target builds only the CLI; the
HTTP server is built inside Docker for production.

```bash
make build-cli
# → ./gct
```

The Makefile injects `version` and `commit` strings via `-ldflags`, so
`./gct version` reports the exact commit the binary was built from. A plain
`go build ./cmd/cli` works too; in that case `gct version` falls back to
`runtime/debug.ReadBuildInfo` for the VCS revision.

To embed Google OAuth credentials directly in the binary (so end users do not
need to set env vars), pass them as ldflags during build:

```bash
go build \
  -ldflags "-X 'german-conjunctions-trainer/internal/cli.googleClientID=<client-id>' \
            -X 'german-conjunctions-trainer/internal/cli.googleClientSecret=<client-secret>'" \
  -o gct ./cmd/cli
```

If you do not embed them at build time, set `GCT_GOOGLE_CLIENT_ID` and
`GCT_GOOGLE_CLIENT_SECRET` in the environment before running `gct login`.

## One-time GCP setup

`gct login` uses the OAuth 2.0 Device Authorization Grant against Google's
`oauth2.googleapis.com/device/code` endpoint. Before it can work, an admin
needs to create a Google OAuth client of the appropriate type:

1. In Google Cloud Console, open APIs & Services → Credentials.
2. Click **Create credentials → OAuth client ID**.
3. Pick application type **TVs and Limited Input devices** (this is the type
   that supports the Device Authorization Grant). If only **Desktop app** is
   available in the picker, that works too — Google's device endpoint accepts
   both client types for `userinfo.email` / `userinfo.profile` scopes.
4. On the OAuth consent screen, confirm the project lists `userinfo.email`
   and `userinfo.profile` scopes. (Already true if the web app uses them.)
5. Distribute the resulting client ID / secret either by baking them into the
   `gct` binary (`-ldflags`, see above) or by setting `GCT_GOOGLE_CLIENT_ID` /
   `GCT_GOOGLE_CLIENT_SECRET` in the environment.

The web app's existing OAuth client (`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`
on the server) is **not** reused. The CLI client and the web client are
independent; rotating one does not affect the other.

## `gct login`

```bash
gct login --server https://german.example.com [--label my-laptop]
```

`gct` prints a short user code and a verification URL:

```
To sign in, open this URL on any device:
    https://www.google.com/device
And enter this code:
    XYZW-ABCD
Waiting for confirmation… (expires in 15m0s)
```

Open the URL on any browser (the same machine, your phone, or a teammate's
device), enter the code, and sign in with your Google account. The CLI polls
Google until the sign-in completes, then exchanges the Google token with the
server for a long-lived bearer (`gct_…`) and writes it to
`~/.config/gct/config.json` with mode `0600`.

Re-running `gct login --label phone` does **not** invalidate prior tokens —
the server accumulates them, one per device/agent context. `--label`
defaults to `"cli"` and is purely a human-readable tag for future revocation
tooling.

Related commands:

- `gct logout` — clears the token from local config. Does **not** revoke the
  token on the server; for that, update `cli_tokens.revoked_at` directly or
  use the web admin (a `gct auth tokens revoke` subcommand is planned).
- `gct whoami` — shows the configured server URL and user ID.

## Common commands

Global flags (apply to most subcommands): `--server URL`, `--config PATH`,
`--token TOKEN`, `--json`.

Topics:

```bash
gct topics list [--tree] [--json]
gct topics get <id> [--json]
gct topics create --name X --prompt Y [--parent ID] [--sort N]
gct topics create --name X --prompt-file path/to/prompt.md [--parent ID]
gct topics create --name X --prompt-file -          # prompt from stdin
gct topics update <id> [--name X] [--prompt Y | --prompt-file PATH]
                       [--parent ID | --no-parent] [--sort N]
gct topics delete <id> [--yes]
gct topics move <id> --parent ID|--no-parent [--position N]
```

Exercises:

```bash
gct exercises generate <topic-id>            # summary (count + topic id)
gct exercises generate <topic-id> --json     # raw exercises payload
gct exercises generate <topic-id> --watch    # poll until ≥10 exercises (up to 5 tries)
```

Misc:

```bash
gct version       # also: gct --version
gct help          # also: gct -h, gct --help
```

## Troubleshooting

**`google OAuth client credentials are not configured`** — the binary was
built without `-ldflags`-injected credentials and neither
`GCT_GOOGLE_CLIENT_ID` nor `GCT_GOOGLE_CLIENT_SECRET` is set. See
*One-time GCP setup* above.

**`token revoked or invalid — run 'gct login'`** (or any 401 from the server)
— your bearer is missing, malformed, or has been revoked. Run `gct login`
again. `gct logout && gct login` is a safe reset if you want to start clean.

**`server URL is not configured`** — `gct whoami` and other commands look up
the server URL from `~/.config/gct/config.json`. Either pass `--server URL`
once with `gct login` (which persists it), or supply `--server URL` on every
invocation.

**Server URL config** — the canonical place is `~/.config/gct/config.json`
(or `$XDG_CONFIG_HOME/gct/config.json`, or whatever path `--config` /
`$GCT_CONFIG` points at). The file is plain JSON; you can edit it by hand:

```json
{
  "server_url": "https://german.example.com",
  "token": "gct_…",
  "user_id": "uuid"
}
```

**Token expiry** — server-issued bearer tokens currently do not expire and
must be revoked explicitly (DB update, or the web admin). Treat the token
file as a secret; it is mode `0600` on disk for that reason.

**Admin-only commands return 403** — topic CRUD (`gct topics create`,
`update`, `delete`, `move`) requires the authenticated user to be the
configured `ADMIN_GOOGLE_ID`. Read-only endpoints (`gct topics list`,
`get`, `gct whoami`) and `gct exercises generate` accept any valid token.

## Environment variables

| Variable | Description |
|----------|-------------|
| `GCT_CONFIG` | Override the config file path (otherwise `$XDG_CONFIG_HOME/gct/config.json` or `~/.config/gct/config.json`). |
| `GCT_GOOGLE_CLIENT_ID` | Google OAuth client ID for the device flow. Required if not baked in via `-ldflags`. |
| `GCT_GOOGLE_CLIENT_SECRET` | Google OAuth client secret for the device flow. Required if not baked in via `-ldflags`. |

On the **server** side, `GCT_GOOGLE_CLIENT_ID` must be set to the same
Google OAuth client ID the CLI uses. The cli-exchange endpoint verifies
that incoming Google access tokens were issued to this client before
minting a server bearer; without it the endpoint returns
`503 CLI_LOGIN_NOT_CONFIGURED`. This audience check prevents a token
minted for an unrelated third-party OAuth client from being replayed to
log in as the same Google user.

Existing web cookie auth is unchanged and uses the separate
`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` web-app credentials.
