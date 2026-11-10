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
