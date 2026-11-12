# repo-kit sync v2.0.0 (meta REPO-KIT-PLAN K7)

- Stamped the agent layer from repo-kit `v2.0.0` (`54a9b9f`) with
  `agent-sync --from`: the nine kit skills, the 40-line session brief
  (K4) and the herdr question guard (K3, `guard-herdr-prompt.sh` on
  Bash). A blob-history read found every replaced file an older kit
  copy, no local edit; engine's own skills (goldens, drain-inbox,
  mockup-to-model) and `.agents/hooks.local.json` are untouched.
- `kit.mjs apply`: one update (`plan-gate.test.mjs`) and four of its
  five creates (`herdr-guard.test.mjs`, `docs/chromium.md`, the two
  herdr helpers in `src/scripts/`). Not taken: the kit's
  `test/tooling/worktree-guard.test.mjs`. Engine keeps its own wider
  guard (`worktree-ignore.test.mjs`, as the kit file itself says), and
  the kit copy fails here: it runs oxfmt from `node_modules/.bin`
  (engine's is in `.bin-deps/`) and Vitest's `test/**/*.test.mjs` would
  pick it up. Recorded for the kit owner (meta REPO-KIT K7). The 15 files
  pinned as engine's own in `local-variants.json` stay its own; two
  took a hand port, below.
- Engine's own `check-index.mjs` took the kit's State plan gate by hand
  (new plans need `State:` with draft, ready for review, in progress,
  held or done; `Status:` is refused), so the updated plan-gate test
  holds. `main-only.test.mjs` now matches the slimmer brief's
  `plan worktrees (n):` line.

- Stamped the agent layer from repo-kit v2.1.0 (2 paths): the tenth kit
  skill, look-loop (Jake, 2026-11-11: the look loop into all the
  repositories); owner skills untouched. Landed with land.mjs (J240).
