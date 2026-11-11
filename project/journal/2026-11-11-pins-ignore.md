# Pins outputs ignored in worktrees (opus-pinignore)

- The reaper kept go7-one-way-in, mmo-keep and ms7-rooms: each held Nalati's new `astc6/` variants untracked.
  `pins.ts install` lists published mounts only in the canonical checkout's `info/exclude`, which is shared but
  written from the canonical's own (older) pins, and `git worktree remove` refuses untracked files.
- `.gitignore` now names every `public/assets/` folder that holds pin output and no tracked file, plus any shard's
  `astc6/`. Folders, not files, so a re-pin's new hashes stay covered. The 70 pin files that sit beside tracked
  files (hdri, models/hatchet, music/folk ...) stay with `info/exclude`.
- `test/tooling/pins-ignore.test.mjs` reads `.gitignore` alone in a scratch repo: the pin folders ignored, and no
  tracked `public/` file matched.
- Worktrees made before this keep their old `.gitignore`, so the three stuck ones still need the canonical
  `pnpm pins` (after the canonical checkout catches up with main) or their own owners.
