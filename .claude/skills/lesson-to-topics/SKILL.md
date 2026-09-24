---
name: lesson-to-topics
description: Turn a German lesson note (teacher's screenshots with red handwritten marks, notes, transcript) from the user's Outline knowledge base into new/updated drill topics in the gct topic tree for the Goethe B1 exam (Sprechen/Schreiben). Use when the user gives an Outline doc slug/URL of a lesson ("<date>-<title>-<urlId>"), says "разбери урок", "обнови темы по уроку", "new lesson transcript", or asks to create training exercises from a lesson.
---

# Lesson → gct topics

Goal: after every lesson, extract **what the teacher focused on** and turn it into SRS drill leaves in the Goethe B1 root topic of the user's gct tree, so the user drills exactly those phrases.

## 1. Fetch the lesson

- Outline connector: `mcp__claude_ai_outline__fetch` (`resource=document`, `id=<urlId>` — the last `-XXXXXXXX` part of the slug). Other Outline connectors may fail auth — use this one.
- The doc is large → saved to a tool-results file. Extract: `jq -r '.[].text' <file> > $SCRATCH/lesson.md`. Read **all** of it: summary on top, transcript (RU/DE mixed, duplicated STT passes) at the bottom inside `<details>`.
- Images: `grep -o 'attachments.redirect?id=[a-f0-9-]*'` → for each id `fetch resource=attachment` → `curl -sfo imgN.png '<signedUrl>'` (URL expires in ~5 min, download right away) → `Read` each png. Skip the avatar (id appears in `createdBy.avatarUrl`).
- Earlier lessons live in the same collection (same breadcrumb as the new note); fetch them only if the new one refers back.

## 2. Analyse — what counts as focus

Priority order:
1. **Red handwriting / red underlines / red circles on screenshots** — teacher's explicit focus. List each marked phrase verbatim.
2. **Teacher corrections in the transcript** ("не кохан, а цубирайтен", word-order fixes) — the user's actual mistakes. Capture wrong → right.
3. **Teacher's stated strategy** (e.g. "эта структура одинаковая для любой темы — выучить", "задать вопрос — много баллов").
4. Summary/Next Steps section of the note.

Ignore logistics (Teams/Zoom), listening-only content (no gct drill fits it unless the user asks).

Before building, show the user a short table: marked phrase / correction → where it goes in the tree. Don't wait for approval unless something is ambiguous.

## 3. Map onto the tree

- Builder: `tmp/build_goethe.py` (idempotent; `NODES.append((key, parent_key, name, leaf(...), sort))`; ids in `tmp/goethe_ids.json`). Read its `NODES.append` lines first to see existing branches: S1 Teil 1 planen, S2 Teil 2 Präsentation, S3 Teil 3 Feedback/Fragen, S4 Notfall, W1–W3 Schreiben.
- Check which marked phrases are already covered: `grep -c "<phrase in ae/oe/ue/ss spelling>" tmp/build_goethe.py`.
- Rule: generic leaves stay as they are. For each lesson add **"Fokus DD.MM" leaves** under the matching branch (next free letter, e.g. `S1i`, `S2i`, `S3d`), one per exam part touched. Each Fokus leaf contains: the red-marked phrases verbatim, the corrections (wrong → right, stated explicitly), and the lesson's scenario (e.g. Kochaktion, Fitnessstudio) as examples — but rotate topics in the english_hint rule so it transfers.
- Only change an existing leaf (`./gct topics update <id> --prompt-file -`, and edit its NODES entry to match) when it is factually wrong.
- New exam part not yet in the tree → new folder node (like `S1`) + leaves.

## 4. Leaf prompt convention (keep exactly)

Use `leaf(guidelines, wortfeld, vocab, clarity)` from the builder:
- guidelines: numbered blocks `1. Title: "phrase", "phrase" (grammar note)` + `   * Example patterns: "..." / "..."`. 3–5 blocks.
- German in the prompt uses ae/oe/ue/ss transport spelling (CONSTRAINTS tells the model to output real umlauts).
- vocab: nouns with article; verbs; particles/connectors — separated by `;`.
- clarity: "The english_hint must ..." — says which move the hint expresses so the learner produces the target frame; add hard rules for corrected mistakes (e.g. "never 'kochen' for pizza", "modal verb last in wenn/ob clauses").

## 5. Build and verify

```bash
python3 tmp/build_goethe.py | grep -v skip          # creates only new keys
./gct exercises generate <new-id> --watch           # per new leaf
./gct exercises generate <id> --json | python3 -c "import json,sys;[print(e['exercise_json']['correct_german_sentence']) for e in json.load(sys.stdin)]"
```

Read the sample sentences: they must contain the marked phrases and correct forms. Bad output → fix the prompt (`topics update`) and regenerate.

## 6. Report (in the user's language)

- Что учитель отметил (фразы по разделам) и какие ошибки исправил.
- Какие листы созданы/обновлены (name + id), 2–3 примера сгенерированных предложений.
- Что выучить наизусть к следующему уроку (the teacher's "Next steps").
- Update the project memory note about the Goethe tree with the new leaves (one line per lesson).

Server and user: `./gct whoami`. Root topic id and builder live in local, untracked `tmp/`; don't delete it.
