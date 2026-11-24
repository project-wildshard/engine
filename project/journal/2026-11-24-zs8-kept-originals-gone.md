# Kept originals and the frozen hall leave the tests (ZONE-SNAPSHOTS ZS8)

> Written by: Claude (lane opus-snap). 2026-11-24.

J507: no old zone snapshots in tests. Deleted by hand, nothing unique lost (each was read from the API or a pin, and
git history keeps the bytes):

- `test/fixtures/kept-native-plans.json` (20 kept originals' native plans) with `kept-native-plans.test.ts` and
  `kept-originals-play.test.ts`. Only rollback copies and stale pointers named those revisions (ZS2: they are not users).
- `test/fixtures/legacy-slot-originals.json` (24 kept originals' weapon rows). `legacy-slot-migration.test.ts` now makes
  each shard's rows up from its dev-world saves (`saves/worn-skins-dev.json`: the slot each weapon was saved under, the
  item it plays as) and round-trips every worn skin and save on them; the locked v2 saves stay.
- `test/fixtures/frozen-hall` (Blender Template r1, format 0.1) and its declared journey (door, USE reach, guardian):
  no live shard has that hall, so the journey went with it. The cook chain tests (`pin-admit`, `cook-provenance`,
  `cook-rename-chain`) read `test/fixtures/made-up-old`, shard-format's made-up CLI product at format 0.1;
  `cook-rename-chain` writes a region trigger into it, since it holds none.

The guard lets a made-up product (no zone slug) under `test/fixtures/` sit at an old format, as shard-format's does.
