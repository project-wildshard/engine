# Water splashes (SHARD-SOURCE SS6a)

> Written by: Claude (opus-ss16j)
> State: built on `plan/ss16j`, 2026-11-16; the Mossgate pond clip is SS6b.

- `world/waterSplash.ts`: a mover entering, wading (over 0.6 m/s, a ring every 0.4 s) or leaving a pool throws droplets
  (one additive `Points`, 192 slots, 96 on a phone) and spreading rings (one additive `InstancedMesh`, 24 and 12), slots
  reused oldest first, so any number of splashes is two draws. Look only: nothing reaches the server.
- `game/shardfile/clientSplash.ts`: every scene pool (a pool row with a `surface`, which only `Water` writes) splashes;
  a pool with no surface (a habitat's, a native pond) is its owner's. The movers are the player and every declared
  creature's body (SS6c, ids `creature:<spawn>`).
- Review fixes (opus-ss16k): both draws go after the water (renderOrder 2) and take no fog (additive + fog adds the fog
  colour); spent droplets park at y = -1000; a step over 2 m is a teleport and throws nothing; a leave splashes at the
  last point in the water; wading averages over each 0.4 s stretch, so a 120 Hz page rings as often as a 60 Hz one.
- No format change: a scene's `Water` is the authoring, so the reaction comes with it (the reversible call, taken while
  Jake slept; a `splash: false` on the surface is the opt-out if one is wanted).
