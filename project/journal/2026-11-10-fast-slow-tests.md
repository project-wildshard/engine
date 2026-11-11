# Fast rewrites of the five slow quarantined tests

Jake: "I don't believe in slow tests. There's always options." The
five J200 files (meta `docs/plans/FAST-SLOW-TESTS-PLAN.md`) were slow
because they stepped through idle game time, not because the game is
slow. Each now skips the idle part and keeps its assertions.

- FS2 Driftwood long session: the 43 minutes were return delays. Each
  second, `test/fixtures/ownerClock.ts` jumps the island's saved return
  clock (`ecology.now`) to its last owed return, through the owner's own
  save and quiet restore; the helper refuses any other field and checks
  the read-back. 262,320 ticks become 3,240. 20 jumped seconds at the
  bound bring 320 slot reuses against the original 1,200 seconds' 138,
  now asserted as a floor. Planting the original bug (`grow` always
  true) fails the old and the new file with the same
  "Missing native creature recipe slot".
- FS1 Nalati population: the raid was due 121.7 s after the restore,
  but the file stepped 18,000 ticks. The raid countdown jumps to 1 s;
  the programme's own tick admits it and spawns the three raiders. A
  never-spawning raid fails both versions with `expected 10 to be 13`.
- FS3 bot taming: 14,600 of 18,153 ticks were the bot re-earning a
  thrown stallion's trust. It is put back on with `forceBreak()`, as
  the original's first break already was: 2,359 ticks, all five rounds.
- FS5 discovery: the replay worker, not the recorder, set the pace,
  because every 512-tick part ended in a full ~13 MB checkpoint (15 in
  all). A part takes exactly one segment, and one streamed tape trips
  the worker's 30 s stream watchdog on a slow runner, so the replay now
  checks every 2,048 ticks: four parts, every input still replayed, the
  same exact feet, flags and owner state at each boundary and the end.
  A replay that drops one input fails both versions on the same
  position equality.
- FS1 again: hosted, the rewritten population file still took 46-56 s,
  half of it the worker case (fresh worker compile, two workers, a
  resident). Overlapping those steps saved nothing on a 4-vCPU runner,
  so the worker case moves verbatim into `nalati-headless-worker.test.ts`
  (same native group) and the population story runs on its own.
  Its first clock (10.0 s locally) is recorded by push-preflight timings.
- FS4 field taming: after the real walk, 5,900 ticks went on chasing a
  stallion that shied from an upright stranger. The player now stands
  6 m west of it (a position set, as the bot story already does); the
  stallion still shies, then the prompt is earned by the real law with
  no grant or forced break. Other spots lost rounds and re-chased for
  20,000-43,000 ticks, and stronger lean gains changed nothing, so this
  one is pinned. The earned checkpoint moves from breaking tick 250 to
  735 (mid-round 4), so the restored world still rides a round and a
  half and adopts. A taming restore that drops the law fails both
  versions on "the earned mid-round checkpoint restores quietly".
- FS5 again: hosted, the recorder alone took 18-34 s for 7,618 ticks,
  so fewer checkpoints could not bring the file under 60 s. The tour is
  now two legs in two files, each with its own independent replay: the
  entry leg (camp road, board, eight places to the snow leopard cave,
  4,436 ticks) keeps the quarantined name; the cave leg starts from a
  save with the player placed where the entry leg leaves the cave and
  boards on to the other nine places (3,248 ticks), in the same native
  group. Both legs assert the entry list names real places, and a
  dropped replay input fails both.
