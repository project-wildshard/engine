---
name: drain-inbox
description: Pull the in-game review notes and client error reports (pnpm inbox:pull → .review/inbox/), read every note next to its screenshot, file one ask per note, reproduce it on the spot it was filed from (the note's repro URL), then fix or dispatch to the owning repo. Use when Jake says "drain the inbox", "process my notes", "act on my feedback", or after a playtest.
---

# Drain the review inbox

> Written by: Claude (opus-k9, REPO-KIT K9, 2026-11-11). Carried from singleplayer's drain-inbox skill.

Playtesters unlock the review inbox in **Settings → REVIEW** (the
password is `REVIEW_PASSWORD`, in `.env.local` or the environment). Then
**F8** on desktop or the **✎ NOTE** disc on a phone (or the menu's
**FEEDBACK** tab, `src/client/engine/ui/Feedback.ts`) sends a note:
their words, a category chip, a JPEG of the frame with any pen marks,
and the repro context. It lands in private Blob storage through
api-server's `/api/inbox` (api-server `src/server/routes/`). Draining is
**on demand**: nothing drains the inbox until Jake asks.

The notes are Jake's own words: authoritative about *what looks or feels
wrong*, a hypothesis about *why*.

## 1. Pull and read

```bash
pnpm inbox:pull          # scripts/inbox-pull.mjs: new notes → .review/inbox/<id>.json + <id>.jpg (gitignored); prints a table
# --url <site> or INBOX_URL points it at another API; --all fetches handled notes again
```

Read every `.json` and **open its `.jpg` with the Read tool**: a note is
only actionable next to its picture, and a cyan scribble on it is the
tester pointing at the thing. Each note has `category` (bug / art / feel
/ perf / idea), `note`, and `context`: `shard`, `pos` [x, y, z], `yaw`,
`pitch`, `weapon`, `health`, `swimming`, `hover`, `tier`, `fps`,
`calls`, `tris`, `build` (git sha + time), `dpr`, `viewport`, `canvas`,
`ua`, `url` and **`repro`**.

**Error reports** (category `error`, E133) land in the same folder with
no jpg: the game sends them by itself (`window.onerror`, unhandled
rejections, a frame-loop system switched off, a fatal crash;
`src/client/engine/core/errorReport.ts` → api-server `/api/errors`),
deduped and capped at 10 a session. `note` is `[system] message`;
`error` holds `system`, `message`, `stack`, `count`, `fatal`, `disabled`
and `sinceBootMs`. One ask per distinct error (same message + stack from
several players = one ask); the stack names the file.

**Check `build` first** against `git log --oneline`: a note filed on an
older sha may already be fixed. Verify that before you spend any effort
on it.

## 2. One ask per note, before any work

`src/scripts/ask-new.sh "<the note's words, shortened> (review note <id>)"`
for each note. Status `open`, evidence `.review/handled/<id>`. The rules
are in `docs/tasks/asks/README.md` (done = on origin/main with green
CI). A note about one shard's content gets its ask in that shard repo
(`../shard-<name>/src/scripts/ask-new.sh`).

## 3. Reproduce on the spot

`context.repro` is the note's own URL path:
`/?chunk=<shard>&at=x,y,z,yaw,pitch&weapon=<id>&skipintro`; the game
starts you exactly where the note was filed. Serve a build
(`scripts/serve-build.sh --head`, or `--rev <build sha>`) and open
`<preview URL><repro>` with agent-browser, headless, at the note's
`viewport` (add `&tier=phone&touch` when `tier` is `phone`). Wrap
browser work in `scripts/browser-lane.sh` (at most 3 game browsers on
this Mac) and close the session when done. Screenshot it and compare
with the note's jpg. Cannot reproduce it? Say so in the ask and move on.

## 4. Fix or dispatch by area

| Category / symptom | Where |
|---|---|
| terrain, props, water, sky, POIs of one shard | that shard repo (`../shard-<name>/src/shards/`) |
| shared world, render, streaming | `src/client/engine/world/`, `src/client/engine/render/` |
| animals, enemies, their models | `src/client/engine/entities/`, `src/client/game/` |
| movement, weapons, viewmodels, touch controls | `src/client/engine/player/`, `src/client/engine/input/`, `src/client/game/weapons/` |
| HUD, menu, settings, this inbox | `src/client/engine/ui/`, `src/client/game/ui/` |
| sound, music | `src/client/engine/audio/`, `src/client/game/audio/` |
| perf, load | `src/client/engine/core/`, `src/client/engine/boot/` |
| the inbox API itself | api-server repo |

Fix it yourself, one note after another, in an engine plan worktree
(`node scripts/worktree.mjs new <slug>`, land with `scripts/land.mjs`,
AGENTS.md). Only a big note with disjoint files goes to a subagent;
brief it with the note's words, the jpg path, the repro URL and the
owning files, and "prove it with a screenshot at the repro URL".

## 5. Close the loop

```bash
mkdir -p .review/handled && mv .review/inbox/<id>.* .review/handled/
```

Move a note only once it is fixed and seen fixed (a screenshot at its
repro URL), dropped, or handed to an owner. Flip its ask: **done**
(commit + build id), **dropped** (why), or **in flight** (who). Report
per note: fixed / already fixed at `<sha>` / not reproducible /
dispatched / deferred with a reason. Notes stay in Blob;
`pnpm inbox:pull` skips anything already in `.review/handled/`.
