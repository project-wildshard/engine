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
    The cave leg gets its own native group (the routes group would push
  the planner past its floor); its first local clock, 41 s on a loaded
  machine, and the worker file's 28 s are recorded; the full plan is
  232.8 s of 240.
    J206 MUST: a fresh cave-leg world lost the whole-tour check
  (duplicate notices or a quest fact once all 17 are found). The cave
  leg's save now first earns the eight entry places in the same world by
  standing in each (one notice each, checked), so its tour runs on every
  earlier discovery and must add no repeat notice.
    Both new files join their originals in test/pins/ring-2-tests.json
  (Ring 1 has no full Nalati product: the cave leg hit ENOENT there), so
  their Ring 1 weights go.
- FS4 hosted ran 49-65 s. Of eleven standing spots, (-3,-3) also wins
  all five rounds first time and earns the prompt about 520 ticks
  sooner. The checkpoint stays mid-round 4 (J206: moving it to 945 would
  drop the restored round 4-to-5 transition). The planted restore bug
  still fails on the checkpoint assertion.
- FS7 awareness (not quarantined; 63.6 and 64.6 s on slow runners
  broke other lanes' lands): nothing senses the player for the first
  3,468 ticks of the walk, yet the independent worker replayed all of
  them with a checkpoint per 512. The resident now walks the first
  3,200 inputs unrecorded (asserting awareness stays 'none'), saves,
  and the replay worker starts from that save; Visible, Noticed and
  Detected land on the same ticks (3,468, 3,780, 3,786). The restored
  worker starts admitting the Noticed checkpoint as soon as it is
  earned. Teleporting along the bank at tick 0 was tried and rejected:
  the herds are elsewhere then and skip straight to Detected. Locally
  18.5 s becomes 14.7 s; a dropped replay input fails both versions.
  J206: the input cap counts the prelude, cleanup releases every owner
  independently, and the first 3,200 inputs are no longer replayed here
  (field taming keeps the full physical walk, unreplayed).
- FS4 field taming, split in two legs (opus-fastqual): hosted still ran
  45-61 s on landed main, and the approach can't get shorter: from ten
  standing spots after the walk the prompt comes 2,257-2,971 ticks
  later (the trust law, not the spot). So the walk-earned prompt and
  the rounds go to two files. Leg 1 (the quarantined file) walks from
  spawn, earns the prompt with no grant, presses into breaking, saves
  that breaking start, and the restored world rides on in step for a
  second. Leg 2 (`nalati-taming-verbs-rounds.test.ts`, own native
  group) stands 2 m west of the living stallion at spawn time, lets the
  law's own `forceBreak()` put the player on (FS3's trigger), saves
  that breaking start and rides all five rounds on the restored world:
  the mid-round-4 checkpoint at 735, adoption, the post-bond call and
  every bonded assertion, unchanged. Locally 19.7-21 s becomes 11.7 s
  plus 5.3 s. A restore that drops the taming law fails the old file
  and both legs on their restore assertions; a restore that zeroes the
  bucking shake and roll fails the old file and leg 2 on "the earned
  mid-round checkpoint restores quietly".
