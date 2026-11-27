# 2026-11-27 The golden cook takes a fence shard (cook 1.18.0)

44ab5ec53 made a fence shard's phone whole set carry its own sfx folders, which changes real cooked output (Driftwood's
boot set goes from 75 to 91 recordings), but it declared same output from 65f53bd8: the golden cook's only input,
made-up-old, is a migrated draft with no preparation, no fence and no mounts, so its digest could not move. PV25's
cooked indexes sit at that donor hash, so a worker could have reused a stale one. codex-r2api caught it.

Fixed forward: cook 1.18.0, an output-changing bump with no same-output declaration. The golden now cooks a second
made-up shard, `test/fixtures/made-up-fence`: made-up-old through the migration chain, prepared at spec 4 with a
recorded fence (one prop) and its own sfx set (a manifest and one variant). Its cooked digest is e1178f9c with the
own-sfx carry and a5419b12 without, so the golden now sees this kind of change. `test/cook-own-sfx.test.ts` keeps the
fixture in the golden list and checks its phone sets.
