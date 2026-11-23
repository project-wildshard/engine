# FP26: the engine reads the save lineage under either spelling

> Written by: Claude (opus-nalati3)

Jake's J493 renames the shard file's `identity.revision` to `identity.saveRevision` (shard-format format 0.1.0.4). The
engine read `source.identity.revision` in 33 files: the quest ledger, region durability, the player store, client
checkpoints, the build caches and the pin tools.

- `saveRevision(identity)` (`src/shared/game/shardfile/saveRevision.ts`) reads `saveRevision` when the format gives it,
  else `revision`. Every reader goes through it, so this lands now on the 0.70.x pin and the 0.71.0 pin bump needs no
  engine change.
- No save moves: saves are keyed by the number, and the number is the same under both names. That is the save migration
  J493 asks for, proved by the restore tests passing with the helper in place.
