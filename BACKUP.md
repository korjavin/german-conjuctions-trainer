# Backup & Restore

The app keeps two stateful pieces outside the container image:

| Asset | Where it lives | What's lost if gone |
|---|---|---|
| **SQLite database** (`/data/german.db`) | podman volume `gct_database` | User accounts, **SRS schedules** (years of spaced-repetition state), generated exercises, topics, settings |
| **Audio cache** (`/app/audio_cache/*.mp3`) | podman volume `gct_audio_cache` | ElevenLabs TTS output. Regenerable, but each re-fetch costs real $ |

The SRS state is the only piece that is genuinely *irrecoverable* — the others regenerate (though not free). Plan accordingly.

## Why a podman volume alone is not a backup

Both assets are in **named podman volumes** (not bind mounts). A single `podman system prune -a --volumes` run while the container is not active will wipe them — they look "unused" to podman. Redeploying the stack after that creates fresh empty volumes. Off-site backup is the only insurance against that class of mistake.

## Recommended: daily off-site encrypted backup

Uses the same shape as `paperlessngx-compose/BACKUP.md` Strategy 4 — a systemd **user** timer triggers a small wrapper that takes a consistent SQLite snapshot, mirrors the audio cache, and pushes both to an encrypted rclone remote. Deletions land in a dated trash folder so they're recoverable.

> Placeholders below:
> - `REMOTE:` — your rclone **encrypted** remote (typically a `crypt` layered on any cloud provider). See the [rclone crypt docs](https://rclone.org/crypt/).
> - `youruser` — the unprivileged user that owns the timer (not root).

### Why "daily is enough"

SRS state changes at human cadence (a handful of exercise ratings per session). Losing up to 24 h means losing at most one study session, which is acceptable for a personal tool. Continuous replication (Litestream) is available if that RPO is too loose — see the "When daily isn't enough" section below.

### Prerequisites on the host

1. **`sqlite3` CLI installed** (for the online-backup snapshot — safe to run with a live writer).
2. **rclone** with an encrypted remote configured. Keep a copy of `~/.config/rclone/rclone.conf` somewhere off-host; without the crypt passwords the remote is unreadable.
3. **User lingering**, so user-level timers run even when nobody is logged in:
   ```bash
   sudo loginctl enable-linger $(whoami)
   ```
4. **Narrow sudoers rule** for the three privileged reads the wrapper makes (the podman volume paths are root-700). Create `/etc/sudoers.d/gct-backup`:
   ```
   youruser ALL=(root) NOPASSWD: /usr/bin/sqlite3 /var/lib/containers/storage/volumes/gct_database/_data/german.db *
   youruser ALL=(root) NOPASSWD: /usr/bin/cp -a /var/lib/containers/storage/volumes/gct_audio_cache/_data/. /home/youruser/gct-backup-stage/audio_cache/
   youruser ALL=(root) NOPASSWD: /usr/bin/chown -R [0-9]*\:[0-9]* /home/youruser/gct-backup-stage
   ```
   Validate with `sudo visudo -c`.

### Wrapper script

`~/bin/gct-backup.sh`:

```bash
#!/bin/bash
set -euo pipefail

STAGE="$HOME/gct-backup-stage"
DB_SRC=/var/lib/containers/storage/volumes/gct_database/_data/german.db
AUDIO_SRC=/var/lib/containers/storage/volumes/gct_audio_cache/_data

mkdir -p "$STAGE/audio_cache"

# Consistent SQLite snapshot (online backup API — safe with a live writer).
sudo -n /usr/bin/sqlite3 "$DB_SRC" ".backup '$STAGE/german.db'"

# Audio cache mirror. Content is addressed by SHA256; cp -a is idempotent.
sudo -n /usr/bin/cp -a "$AUDIO_SRC/." "$STAGE/audio_cache/"

# Return stage ownership to the user so rclone (running as the user) can read.
sudo -n /usr/bin/chown -R "$(id -u):$(id -g)" "$STAGE"

# Push to encrypted remote. Deletions land in a dated trash folder.
/usr/bin/rclone sync "$STAGE/" REMOTE:srs/ \
  --backup-dir "REMOTE:srs-trash/$(date +%F)" \
  --log-file "$HOME/logs/gct-backup-rclone.log" \
  --log-level INFO
```

```bash
chmod +x ~/bin/gct-backup.sh
mkdir -p ~/logs
```

### systemd user units

`~/.config/systemd/user/gct-backup.service`:

```ini
[Unit]
Description=gct SQLite snapshot + audio cache sync
Wants=network-online.target
After=network-online.target

[Service]
Type=oneshot
ExecStart=%h/bin/gct-backup.sh
Nice=10
IOSchedulingClass=best-effort
IOSchedulingPriority=7
```

`~/.config/systemd/user/gct-backup.timer`:

```ini
[Unit]
Description=Daily gct off-site backup

[Timer]
OnCalendar=*-*-* 03:00:00
RandomizedDelaySec=30m
Persistent=true

[Install]
WantedBy=timers.target
```

Enable and verify:

```bash
systemctl --user daemon-reload
systemctl --user enable --now gct-backup.timer
systemctl --user list-timers gct-backup.timer
```

### Operations

```bash
# Next fire
systemctl --user list-timers gct-backup.timer

# Manual run (returns after completion — usually seconds for a small DB)
systemctl --user start gct-backup.service

# Watch transfer
tail -f ~/logs/gct-backup-rclone.log

# Unit result
systemctl --user status gct-backup.service
journalctl --user -u gct-backup.service --since today

# Remote size check
rclone size REMOTE:srs/
```

A healthy first run uploads `german.db` plus however many `.mp3` files exist — a few hundred KB for a fresh deployment, growing with TTS usage.

## Restore

### Fresh host, only the encrypted remote survives

1. **Install rclone on the new host** and restore your rclone config. Without the crypt passwords the remote is unreadable.
   ```bash
   mkdir -p ~/.config/rclone
   cp /path/to/saved/rclone.conf ~/.config/rclone/rclone.conf
   chmod 600 ~/.config/rclone/rclone.conf
   ```

2. **Deploy the gct stack** (from this repo's compose file) but **stop it immediately** so we can seed the volumes before it starts writing:
   ```bash
   sudo podman-compose up -d
   sudo podman stop gct
   ```

3. **Pull the backup from the remote**:
   ```bash
   mkdir -p ~/gct-restore
   rclone copy REMOTE:srs/ ~/gct-restore/
   ```

4. **Write into the named volumes**. Volumes now exist (empty) because step 2 created them. Seed via throwaway containers so permissions line up with the app's uid/gid:
   ```bash
   # DB
   sudo podman run --rm -v gct_database:/dst -v ~/gct-restore:/src:ro alpine \
     sh -c "cp /src/german.db /dst/german.db"

   # Audio cache
   sudo podman run --rm -v gct_audio_cache:/dst -v ~/gct-restore/audio_cache:/src:ro alpine \
     sh -c "cp -a /src/. /dst/"
   ```

5. **Start the app**:
   ```bash
   sudo podman start gct
   ```

6. **Verify** by signing in — SRS schedules, completed exercises, users, and settings should all be present.

### Restore a single prior day

The `REMOTE:srs-trash/YYYY-MM-DD/` folders hold files that existed on that date but were overwritten or deleted since. To roll the DB back to a specific day:

```bash
rclone copy REMOTE:srs-trash/2026-04-20/german.db ~/gct-restore-2026-04-20/
# then seed the volume as in step 4 above
```

Trash contents grow over time; prune them with a separate scheduled `rclone delete --min-age 90d REMOTE:srs-trash/` if disk or cloud quota matters.

## When daily isn't enough

If losing up to 24 h of SRS progress is unacceptable, swap the daily timer for **Litestream** continuous replication (seconds of RPO). Two common layouts:

- **Litestream → S3-compatible provider directly** (Backblaze B2, Cloudflare R2, MinIO). Simplest; provider charges per API op.
- **Litestream → local replica dir, rclone sync on a short timer** (e.g. every 15 min). Keeps the single-remote story via rclone; local continuous replication covers the prune/crash scenario, rclone cadence bounds off-site freshness.

Litestream adds a sidecar container to the compose stack and a small amount of operational surface. For a personal tool the daily flow above is usually the right trade-off.

## Security notes

- **rclone config contains the crypt passwords** — without that file the remote is opaque, so store a copy somewhere safe (password manager, separate backup location). Losing it means losing the backup.
- **Narrow the sudoers rule** to the three specific commands shown above; do not give the backup user broad NOPASSWD.
- **Do not commit the rclone config** to git.
- **Logs may contain file paths** but not content; they're safe to keep locally.
