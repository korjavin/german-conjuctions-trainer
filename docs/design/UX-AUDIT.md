# UX audit and redesign brief (October 2026)

Inputs: `current/CAPABILITIES.md` and the screenshots in `current/screenshots/`. Files `01–06` were taken logged out, `10–17` logged in as admin.

## Who uses this, really
1. **The exam learner.** This is the main user today. They prepare for telc B1 or Goethe B1 Sprechen with a teacher, and after each lesson new "Fokus DD.MM" leaves appear in a deep tree. The daily loop:
   - "What's due?"
   - Practice the due items, or this week's lesson.
   - Listen to a podcast on the commute.
   - Repeat.
2. **The casual learner** (anonymous): picks a topic and scrambles a few sentences.
3. **The author/admin** (the same person as #1, wearing another hat): curates the topic tree and prompts after each lesson.

The UI today is built around #2: a topic box plus "Start Practice". #1's loop is spread across a header combobox, the History modal and the Podcast modal. #3's tools are buried inside Settings.

## What's wrong (ranked by impact)

### P1. There is no home: SRS is invisible until you dig
- "57 ready to practice" sits only inside the History modal (14). On launch the app drops you into an arbitrary exercise for a topic you didn't choose (01). There is no "due today", no streak, no "continue Fokus 02.10".
- The topic picker shows no progress: no due counts, no mastery, no "new" marker on the latest lesson leaves.
- **Opportunity:** a Today/Home screen built around due reviews and the current exam track.

### P2. The header does everything
- One row holds up to 9 controls (10): combobox, Start Practice, three emoji toggle buttons (🔊 🎤 🎧) styled exactly like primary CTAs, then History, Logout, Settings and a faint Privacy link.
- Everything uses the same orange gradient, so nothing reads as primary.
- On mobile the header takes about 200px before any content (05).
- Sound and voice are *session preferences*, not navigation. Podcast is a *destination*. Logout belongs in an account menu.

### P3. Topic selection does not scale to deep trees
- The tree is 4–5 levels deep (telc has 97 sub-topics, Goethe 45) and lives inside a text-input dropdown (02, 06).
- The selected value is a leaf name with no context. Folders and leaves look alike. Long German names wrap or truncate.
- On mobile the dropdown covers the whole exercise.
- Practicing a folder practices its whole subtree, but the UI never says so.

### P4. Settings is a junk drawer that mixes learner and admin
- Offline cache and RSS (learner) sit above Observability, the full topic CRUD tree, DB stats and CLI tokens (admin) in one modal (16, 17).
- The topic manager repeats four pastel Tailwind buttons (Add child, Edit, Archive, Delete) on *every row*, along with "Created: date", a `::` text drag handle and `+`/`−` characters. At depth the rows wrap and the buttons break: "Add / child" splits across two lines in 17.
- Managing ~150 topics inside a modal is the wrong container.

### P5. Exercise screen: hierarchy and small bugs
- The counter "1 / 2" wraps onto two lines (01, 10). Progress shows **50% before the first answer** (off by one).
- Skip and Hint sit *between* the answer and the word bank. The word bank should sit right under the answer, with the actions secondary.
- After a correct answer (11), "in 1h" is a lone green pill, so the SRS meaning is unclear. "Replay Audio" has the same weight as "Next Exercise →", and Next should be the only primary. "Explain mistakes" doesn't appear when there were no mistakes, which is fine, but its placement when it does appear is untested in design.
- The voice "Listening…" state (12) is a tiny gray line. It needs a clear mic state on the card itself (pulse ring, live transcript chip).
- The Skip dialog (04) for anonymous users offers one real action plus Cancel, and Cancel is styled as the primary.

### P6. The session-complete screen is broken
- In 13 the four stats render as an unstyled vertical stack. The Chart.js default bar is green, gray and blue (off-brand).
- Three identical primary buttons sit at the end.
- It is the most emotional moment of the loop and gives no "what's next": next review time, what to repeat, or a nudge to the podcast.

### P7. Visual system drift
- Five pill/badge systems and three small-button styles.
- A Tailwind gray, blue and green palette inside a warm brand: the saturated green "Ready to Practice" badge on every History row (14), the blue "with hints" value, a gray native `<audio>` (15).
- Emoji icons in buttons next to stroke SVGs.
- `alert()` and `confirm()` instead of toasts and in-app confirms.
- No offline indicator, although offline practice exists.

### What works (keep)
- The warm orange-on-cream identity, Nunito Sans, and the glass cards.
- Word chips with hotkey badges, a fast keyboard flow, and per-word TTS.
- The podcast concept ("Listen & Recall"), the episode list, and the RSS feed.
- History filters by SRS state, and the upcoming-reviews histogram (the idea, not its placement).

## Options

### A. Polish in place (S)
- Keep the IA and fix P5–P7: one badge system, one icon set (Lucide stroke), toasts, a session-complete layout, a header with icon-only toggles plus an account menu, counter and progress fixes, and an offline chip.
- **Pro:** cheap. **Con:** leaves P1–P4, the real UX problems.

### B. Learner app + separate Manage area (M) — **recommended**
- **Navigation:**
  - Desktop: a slim top bar (logo, "Today", "Topics", "Listen", "History", then an account menu).
  - Mobile: a bottom tab bar with Today, Topics, Practice, Listen, Me.
  - Sound and voice toggles move *into the exercise card* toolbar.
- **Today (home):**
  - Due-now count with a "Review 57" primary button.
  - "Continue: Fokus 02.10" for the latest lesson leaf.
  - The exam track card (telc / Goethe) with section progress.
  - A small upcoming-reviews histogram, streak or week activity, and "New podcast episode" if any.
- **Topics:** a full-page tree browser. Breadcrumbs, folder cards at the top level (B1 Panorama, telc B1, Goethe B1, Amt), per-node due count and mastery bar, a "new" dot on recently added leaves, search, "Practice this folder (n items)" and "Make podcast" actions.
- **Practice:** a focused full-screen card with minimal chrome.
  - Breadcrumb topic and a single-line progress.
  - Answer area, then the word bank, then secondary actions (hint, skip, sound, mic).
  - The post-answer row shows "Next →" as primary, and "✓ Perfect · next review in 1 h" as one readable status line.
- **Session summary:** a big score, three stat tiles in brand colors, a mini list of the sentences that had mistakes with "Retry these", and "Back to Today" as primary.
- **Listen:** today's podcast modal as a page, with a brand-styled player (play button, scrubber, speed) and an episodes list.
- **History:** a page, not a modal. Keep the filters and sort; status as a subtle dot plus text, not a saturated badge.
- **Me / Settings:** offline cache, RSS feed, sound and voice defaults, logout, privacy.
- **Manage (admin only, separate route):**
  - A two-pane topic editor: tree on the left, editor on the right with name, parent, prompt and version history.
  - Row actions on hover or in a ⋯ menu.
  - Observability, DB stats and CLI tokens as tabs.
- **Pro:** fixes P1–P4 and matches the real exam-prep loop. **Con:** routing and page layouts need real frontend work (still vanilla JS, hash routes).

### C. Exam-first product (L)
- B, plus Today *is* the exam: mock-exam structure (Teil 1–3), lesson timeline (Fokus by date), readiness score.
- Strong for the current user, but it hardcodes the telc/Goethe shape into the UI. Defer, and let B's "track card" grow into it.

## Ask for Claude Design
Using the existing brand (README, `colors_and_type.css`), design option **B**:
1. Foundations refresh: one badge/pill component (neutral, success, warning, info-in-brand-amber, danger), one icon set, a toast, a confirm dialog, an offline chip, and a brand-styled audio player. Remove blue and Tailwind gray from the palette.
2. Screens, desktop 1280 and mobile 390:
   - Today
   - Topics browser
   - Practice: idle, voice listening, wrong-chip, correct with status and explain
   - Session summary
   - Listen
   - History
   - Me
   - Manage: topic editor
3. Update `ui_kits/app` so these are clickable.
4. Copy stays English UI chrome, German content. Keep it lowercase-friendly and free of emoji in chrome.
