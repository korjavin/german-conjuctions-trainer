# Current product capabilities (October 2026)

This is a snapshot of what the live app does today. The April 2026 design system in this project (`ui_kits/app`, `preview/*`) only covers the empty state, the exercise card, a flat topic list, history and an old settings modal. Everything marked **NEW** below has no design yet. It was built ad hoc in code, mostly with a Tailwind-like gray, blue and green palette that sits beside the orange and cream brand.

Stack: Go server plus vanilla JS (ES modules). Google OAuth. SQLite. LLM-generated exercises. ElevenLabs TTS. PWA with offline mode.

## Roles
- **Anonymous.** Can pick a topic and practice. Nothing is saved.
- **Logged-in learner.** Spaced repetition (SRS), history, favorites, ignored exercises, offline cache, podcast and its RSS feed.
- **Admin.** Topic tree management, prompt observability, DB stats, CLI tokens. Today all of this sits inside the same Settings modal that learners see.

## Content model
- Topics form a **deep hierarchy**: folders, then sub-folders, then leaves. Each leaf holds an LLM prompt.
- Real trees today include exam-prep trees such as "telc B1 / DTZ" and "Goethe B1 Sprechen". They hold sections like Schreiben, Sprechen and per-move phrase leaves, plus per-lesson "Fokus DD.MM" leaves.
- An **Archive** root sits at the bottom of the tree for retired topics.
- Practicing a folder practices its whole subtree.

## Surfaces

### 1. Header (one row, wraps on mobile) — CHANGED
- Topic combobox. It opens a floating **tree** with folder and file icons, collapse buttons, sub-topic counts and search with highlighting and auto-expand. The selected topic shows as a path, e.g. "A › B".
- "Start Practice" (primary).
- Icon toggles: **Sound/TTS 🔊**, **Voice input 🎤** (hidden if the browser lacks support), **Podcast 🎧**.
- Login with Google. When logged in: History 📜, Logout 👋, Settings ⚙️ and a Privacy link.
- Up to 9 controls in total. Icons are emoji, and on mobile the text labels collapse to emoji.

### 2. Exercise card — CHANGED
- **Loading:** spinner, "Loading your practice session…" and a live seconds counter (LLM generation can take 10–30 s).
- **Header:** counter "n / N", a progress bar with 25/50/75% milestone ticks, a percentage, and the topic label.
- **Body:** English prompt, answer area, then scrambled word chips with hotkey badges (1–9, then a–z). Chips have collected, incorrect-shake and hint-highlight states. Punctuation is added automatically.
- **Actions:** Skip opens a dialog with three choices: skip for this session, remove completely (hide), or cancel. There is also a Hint button.
- **Audio:** each word is spoken on click, and the whole sentence is spoken on completion. **NEW**
- **Voice input** **NEW**:
  - A status strip with an animated equalizer and phase labels: Listening, Hearing you, Recognizing, Paused while audio plays.
  - A live transcript, with fuzzy matching against the answer.
  - Spoken commands: weiter, hinweis, überspringen.
- **After a correct answer** **NEW**:
  - Confetti.
  - A status pill: Perfect, With hints or With mistakes, plus an SRS label "review in 3 days".
  - Favorite star.
  - "Explain mistakes" (an LLM explanation appears inline).
  - Replay audio.
  - "Next exercise →" (Enter also advances).
- **Session complete** **NEW**:
  - Four stat boxes: Perfect, With hints, With mistakes, Total time.
  - A Chart.js bar chart.
  - Buttons: New session, Retry these exercises, View your progress.
- **Errors:** shown with native `alert()` (no topic, rate limit, AI timeout, offline with an empty cache).

### 3. History (large modal) — REDESIGNED IN CODE
- Compact stats: Total practiced • Attempts • Success rate.
- **Upcoming reviews** bar chart (SRS buckets).
- Filter pills with counts: Ready to practice (green dot), Training (yellow dot), Favorites (★), Ignored (eye).
- Sort toggles: Timing, Errors, Date (↑/↓).
- **Each row:**
  - German sentence with a favorite star, and the English line.
  - Status badge: Ready, Ready in X, or Ignored.
  - Ignore button.
  - Footer: topic • date, then ✓ ✗ 💡 Σ counts and a colored success %.
- Pagination.

### 4. Podcast (modal) — NEW
- Builds a 25-phrase "Listen & Recall" audio lesson from the selected topic subtree, optionally limited to favorites.
- A busy state while it generates.
- Native audio player with a "Download MP3" link, plus a transcript in `<details>`.
- "Your episodes (n)" list (kept 7 days).
- A private **RSS feed URL** (in Settings) so episodes show up in any podcast app.

### 5. Settings (modal) — COMPLETELY DIFFERENT
The old API key, model and URL fields are gone; that config is server-side now. Sections:
- **Offline practice** (learner): "N exercises cached · updated …", audio caching progress, and an "Update offline cache" button.
- **Podcast RSS feed** (learner): URL, Copy, Regenerate.
- **Admin: Observability.** "View last refined prompt" opens a code modal.
- **Admin: Topic manager.** A full tree editor:
  - Sort (Tree, A–Z, Z–A, Newest, Oldest), collapse/expand all, and search (Ctrl/Cmd+F).
  - Tree guide lines and drag handles. **Drag-drop** to nest or reorder, with drop zones and a ghost, plus full keyboard navigation.
  - Per-row actions: Add child, Edit, Archive or Restore, Delete (with `confirm()`).
  - Add/Edit form: recently used parent badges, a parent select, a hierarchy preview, name, and a prompt textarea with validation. Ctrl+Enter saves.
  - **Prompt version history** with Restore.
- **Admin: Database stats.** A 4-stat grid and per-topic counts.
- **Admin: CLI access.** Generate a personal token (shown once), copy it, and see a usage snippet.

### 6. Offline / PWA — NEW
- An installable PWA. The service worker caches the app shell and audio.
- An exercise stash lets the user practice offline. Results are queued and synced when the device is back online.
- **There is no visible offline indicator.**

### 7. Privacy page
A static page.

## Known visual debt
- The brand tokens (`--mr-*` orange and cream) compete with a hand-rolled Tailwind utility shim. Off-palette colors include `#6b7280`, `#374151`, `#2563eb`, `#eff6ff`, `#16a34a`, `#dc2626` and `#ca8a04`.
- Blue is used for focus rings, links, drag-drop, Restore and the "with hints" pill.
- Five unrelated pill/badge systems: filter pills, sort buttons, status badges, the completion pill and recent-topic badges. There are also three near-identical small-button styles.
- Emoji icons sit next to stroke SVG icons.
- `alert()` and `confirm()` are used instead of in-app toasts or confirm dialogs.
- The session chart and the history success % use hard-coded hex colors in JS.
