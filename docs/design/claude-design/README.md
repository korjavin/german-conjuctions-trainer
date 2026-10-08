# German Conjunctions Trainer — Design System (v2, October 2026)

> Local mirror of the approved Claude Design project. **Implementation reference** — see `INDEX.md` for the screen → file → data map.

**Product:** German Conjunctions Trainer. B1 learners build German sentences from scrambled words, review with spaced repetition (SRS), and listen to generated "Listen & Recall" podcasts.
**Stack:** Go + vanilla JS (ES modules, hash routes), SQLite, LLM exercises, ElevenLabs TTS, PWA with offline mode.
**v2 scope:** Option B from `../UX-AUDIT.md`. That means a learner app (Today, Topics, Practice, Listen, History, Me) plus a separate admin **Manage** area. It is built on refreshed foundations.

---

## Files

| Path | What |
|---|---|
| `colors_and_type.css` | Tokens: color, type, spacing, radius, shadow, motion. v2 removes blue and Tailwind gray. |
| `components.css` | Framework-free `gct-*` component classes for the vanilla JS app (buttons, badge, pill, chip, toast, dialog, offline chip, player, inputs, switch, progress, motion helpers). |
| `assets/icons.js` | The one icon set (Lucide-style stroke). Use `<i data-icon="mic">` or `gctIconSvg(name, size)`. |
| `ui_kits/app/index.html` | Clickable v2 prototype. Responsive, with the mobile layout below 760px. Use `?screen=practice&demo=listening` to deep-link a screen; `&offline=1` shows the offline chip. |

---

## Components

React components in the design project (`components/<name>/`, not mirrored) render the same `gct-*` classes the vanilla JS app uses:

- `Icon` — the one icon set
- `Button` — primary, secondary, ghost, danger; sizes sm and lg
- `IconButton` — toolbar toggles, favorite and row actions
- `Badge` — the only status pill: neutral, info, success, warning, danger; dot and quiet variants
- `FilterPill` — toggle filter with a count
- `WordChip` — states: default, hint, wrong, used, placed; optional hotkey
- `Toast` — replaces `alert()`
- `ConfirmDialog` — replaces `confirm()`
- `OfflineChip` — light and on-dark variants
- `ProgressBar` — answered ÷ total
- `Switch` — settings toggles
- `AudioPlayer` — the brand player for Listen

---

## Information architecture (Option B, topic-scoped)

### The topic scope
The **topic is the central navigation piece**. One scope holds a folder, a leaf, or All topics. Today, Topics, Listen, History, Practice and Summary all show that topic and its whole subtree.

**Where you set it**
- **Desktop:** the scope button sits first in the top bar. It shows a breadcrumb and the due count, and opens a picker with search, All topics, recent scopes and the tree.
- **Mobile:** a scope bar is the first row of Today, Listen and History. It opens the same picker as a bottom sheet.
- **Topics screen:** this is the scope browser. Rows move the scope down, breadcrumbs move it up, and the play icon on a row practises that topic without changing the scope.
- **Today:** the section rows and the narrowing chips on the due card also set the scope.

**What the scope does to each screen**
- **Today:** due count, latest lesson, sections, episode, week activity and upcoming reviews all come from the scope.
- **Listen:** episodes are filtered to the subtree, and new episodes are generated from the scope.
- **History:** rows are filtered to the subtree, and topic labels are shown relative to the scope.
- **Practice:** "Review N" reviews what is due in the scope.
- **Me and Manage are global** and hide the scope button.

On filtered desktop pages, a scope note ("Sentences in X and its N topics · Change · Show all") keeps the filter from ever being invisible. The scope persists across sessions.

### Navigation
- **Desktop:** a 56px top bar with the scope button, then Today, Topics, Listen and History. On the right are the offline chip, Manage (admin only) and the avatar menu. There is **no wordmark**.
- **Mobile:** a bottom tab bar with Today, Topics, Listen, History and Me. Today shows a due-count badge.
- **Practice** is a focused takeover on both sizes. The nav is hidden, and it has its own bar: close, topic breadcrumb, progress and "n of N".
- **Session summary** follows Practice.
- **Manage** is its own route, with tabs for Topics, Observability, Database and CLI access.

---

## Content fundamentals
- UI chrome is in English and German content is in German. Labels are sentence case. There are **no emoji in chrome**.
- Be direct and encouraging, and use the second person. Errors say what happened and what to do next, with no "Oops" and no exclamation marks.
- Explain SRS in plain words: "Next review in 4 h", "57 sentences ready". Never show the term "SRS".
- Numbers carry the copy: "Review 57", "Practice folder · 64", "Retry these 2".
- Use German proverbs only in empty states, always with the English translation, in italic.

---

## Visual foundations (v2)

### Color
- **Brand:** orange `#d86424`, dark `#a33f11`, bright `#ef8639`, and `#6c290d` for the header start. Surfaces are cream `#fffaf4` (page) and `#fffcf7` (card).
- **Text:** `#43281b`, `#7a5a47`, and muted `#8a6652` (4.5:1 on cream).
- **States are warm-tuned.** Each has text, bg, border and dot values: neutral (taupe); **info = brand orange tint** (New, Due); success (Perfect); warning (With hints); danger (With mistakes).
- **Removed:** `#2563eb`, `#eff6ff`, `#6b7280`, `#374151`, `#16a34a`, `#dc2626`, `#ca8a04`. Focus rings and links are orange.
- Charts use `--outcome-perfect`, `--outcome-hints`, `--outcome-mistakes`. Never hard-code hex values in JS.

### Type
- Nunito Sans at 400–800. Page titles 26–30/800; display numbers (due count, session score) 64–80/800 in orange-dark.
- **12px minimum**.

### Hierarchy rules
- **One gradient primary per view.** Everything else is secondary (cream with orange border), ghost, or icon button.
- Status is a **dot plus words**, not a saturated fill. Filled badges for emphasis; quiet badges for dense lists.
- Hit targets 40px desktop, 44px mobile. Word chips 44px tall everywhere.

### Surfaces
- Cards are **solid** `#fffcf7`, 1px warm border, 12px radius, `--shadow-card`.
- Blur only on floating chrome: mobile tab bar and dialog scrim.
- Page background is a static warm gradient; the 25s "breathing" animation is dropped.

### Motion
- Ease `cubic-bezier(.4,0,.2,1)`, 150/250/300ms.
- **Wrong chip:** 300ms shake. **Mic:** pulse ring plus 4-bar equalizer. Confetti only for perfect answers.
- Respect `prefers-reduced-motion`.

### Feedback
- **Toast** replaces `alert()`: dark brown, bottom center (above tab bar on mobile), 4s, optional action (Undo).
- **Confirm dialog** replaces `confirm()`: stacked actions, safe action primary, destructive uses `danger`.
- **Offline chip** in the top bar (on dark) and the practice bar whenever offline.

---

## Iconography
- `assets/icons.js` only: 24 grid, 2px stroke, round caps, `currentColor`.
- No emoji, no icon font, no other sets. `✓` and `✗` allowed as inline glyphs in dense number runs.
- Logo is still the placeholder (`favicon.svg`). No wordmark in chrome.

---

## Where v2 departs from the audit (and why)

1. **Mobile tabs are Today, Topics, Listen, History, Me — no "Practice" tab.** Practice is a mode entered with a scope; every entry point (Review 57, a lesson, a folder) launches it.
2. **"Info" is brand orange, not amber** — amber would collide with the gold "With hints" warning.
3. **No streak.** Today shows week activity ("5 of 7 days").
4. **Summary primary is "Keep reviewing · N due".** Back to Today is ghost; when nothing is due, Back to Today becomes primary.
5. **Glass cards dropped from content.** Solid cream cards; blur only on floating chrome.
6. **No mastery bars on Manage tree rows** — name, count and a "new" dot only. Mastery is learner-side.
7. **Hotkey badges only with a keyboard.**
8. **Manage on mobile uses push navigation** (tree → editor). Drag-reorder is desktop-only.

---

## Open items
- A real logo in the orange palette.
- Loading state for LLM generation (10–30s): skeleton card with a seconds counter and "Usually 15 s"; not yet designed.
- Anonymous Today: a pick-a-track empty state with a proverb.
