# 2026-11-18 MMO-PLAN MP1.5b: others on the road at their place (opus-closer2)

- Wire 1.2.0 (shard-format `4e6cd959`, MP1.5a) adds `player.roadX`/`roadZ` over ±2,048 m. The road room marks its bodies
  (`PlayerSim.roadPlace`), `playerNet.ts` sends their world-frame place there and zero in a cell, and `otherPlayers.ts`
  stands a row at its road place (`placeOf`) when it has one: a room older than 1.2 reads the node floor, -2,048 m, as none.
- Red first: `test/dedicated-road-range.test.ts` puts two bots on Driftwood's road 1 km apart (z ±500, where `z` clamps at
  ±260); each reads the other within 0.1 m. Without the road room's mark both read roadX 0 and fail.
- `@wildshard/wire-released` moves from shardfile `669d1fc` (minor 0) to `npm:@wildshard/wire@1.1.0` (minor 1): HEAD is
  minor 2 and the window is one minor, so a minor-0 client is now told `reload`. Room-bytes digests re-taken (player rows
  carry the two fields); a repeat run matched.
