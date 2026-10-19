#!/usr/bin/env bash
# Starts the real Go server on a fresh seeded SQLite DB for the Playwright suite
# (playwright.config.js webServer). No OAuth, LLM or TTS keys: sessions come
# from `seed user`, exercises from `seed init`.
set -euo pipefail
cd "$(dirname "$0")/.."

tmp=e2e/.tmp
rm -rf "$tmp/db"
mkdir -p "$tmp/db"

go build -o "$tmp/server" ./cmd/server
go build -o "$tmp/seed" ./e2e/seed
"$tmp/seed" init "$E2E_DB"

# Served from the repo root so the server picks up index.html, js/ and css/.
# Its request log goes to a file (uploaded by CI on failure), not the test output.
exec "$tmp/server" 2>"$tmp/server.log"
