# 2026-11-13: a content-named file may not change size (AUDIO AU21)

> Written by: Claude (opus-au21)

- sharddev's AU7 re-encoded Driftwood's `island-calm-05125ed8.m4a` under its hashed name (710,677 to 476,617 bytes).
  A content-named path gets no `?v=`, the worker keeps it and `/assets/*` is immutable, so a returning player could
  keep the old bytes for a year. sharddev 0.2.10 now names a re-encoded recording by its encoded bytes.
- The engine's guard: `scripts/app-build/gen.ts` `bytesModule()` compares the new byte table against the committed one
  (the staged copy, `git show :`, not the file a local run last wrote) and refuses a content-named path whose size moved. A renamed
  file is a new row and passes. Proved by swapping the 710,677-byte copy back into a worktree's `public/`.
- A pin of a shard re-prepared with sdk 0.2.10 renames its recordings. Driftwood's and Pine's `island` and `pine` slot
  files are named in `public/assets/music/piano/music.json`, so that pin must take the new names in the same commit;
  the cook refuses a missing engine slot (AU18) until it does.
- Land's own stamp commit `05c51ad7` (ds22-stamps) had regenerated the boot tables from a checkout whose `public/`
  held pre-AU7 audio: folk and orchestral styles back, 42 recordings at their old sizes. The guard refused it on the
  next land, so that commit is reverted here and the tables match the pinned products again.
