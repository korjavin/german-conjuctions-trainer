# v2 design — implementation index

Approved prototype (Claude Design, App UI kit v2). **This folder is the source of truth for the redesign.**
Open locally: `cd docs/design/claude-design && python3 -m http.server 8765` → `http://localhost:8765/ui_kits/app/index.html?screen=today`
(`?screen=` today | topics | listen | history | me | manage | practice | summary; `&demo=…` for states; `&offline=1`). Resize below 760px for mobile.

The prototype is React for demo only. **The app stays vanilla JS** — port markup/behaviour, reuse `colors_and_type.css` + `components.css` (`gct-*` classes) and `assets/icons.js` as-is.

| Screen | File | Key states | Data it needs (mock in `Data.jsx`) |
|---|---|---|---|
| Shell: desktop top bar, mobile tab bar, toast, confirm, offline chip | `App.jsx`, `Primitives.jsx` | admin / non-admin, offline | user (name, initials, admin), online state |
| Topic scope: ScopeButton, ScopeBar, picker (popover / bottom sheet), ScopeNote | `Scope.jsx` | All / folder / leaf, search, recent scopes | topic tree with per-node `due`, `total`, `mastery`, `isNew`; recent scopes (localStorage `gct-scope`) |
| Today | `ScreensHome.jsx` `TodayScreen` | due > 0 / nothing due, episode / no episode | scope stats (due), children with due, newest leaf in scope, week activity (7 days), upcoming reviews histogram, latest episode in scope |
| Topics | `ScreensHome.jsx` `TopicsScreen` | roots grid, folder list, leaf detail, search results, archive link | tree as above; per-leaf recent sentences, created date |
| Practice + Summary | `ScreensPractice.jsx` | building, hint, wrong (shake), voice listening, correct, explain, summary (perfect/hints/mistakes, keep reviewing / back to today) | exercise queue for scope, progress n of N, outcome per item |
| Listen | `ScreensMore.jsx` `ListenScreen`, `Player` | playing, empty scope, generating | episodes filtered by scope subtree, generate from scope (+ only favorites) |
| History | `ScreensMore.jsx` `HistoryScreen` | Due / Training / Favorites / Ignored, sort, empty | sentences filtered by subtree, ok/err/hint counts, status, fav; upcoming histogram |
| Me / Settings | `ScreensMore.jsx` `MeScreen` | admin line shown only for admins | prefs (sound, autoplay, voice), offline cache stats, podcast feed URL + regenerate |
| Manage (admin) | `ScreensManage.jsx` | Topics tree+editor (two-pane desktop, push nav mobile), row ⋯ menu, delete confirm with Archive instead, prompt versions; Observability; Database; CLI access | existing admin APIs |

Rules (see `README.md`): one primary per view · no emoji in chrome · 12px min text · solid cards · toast instead of `alert()` · ConfirmDialog instead of `confirm()` · hotkeys only with a keyboard · no blue / Tailwind gray.

Background: `../UX-AUDIT.md` (problems P1–P7), `../CAPABILITIES.md` (what exists today).
