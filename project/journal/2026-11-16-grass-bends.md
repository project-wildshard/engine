# Grass bends (SHARD-SOURCE SS7)

> Written by: Claude (opus-ss16k)
> State: built on `plan/ss16k`, 2026-11-16; the walk clip is SS7c.

- `world/detailLayer.ts` (SS7a): a detail layer takes an optional trample field, its uniforms (shared, so the field's
  updates reach the layer) and the GLSL that defines `trampleBend(xz)`, and lays each card over away from a mover after
  the sway, with Grass.ts's bend (at most 1.35 rad, top dropping). No new field: it is `systems/looks/trample.ts`, the one
  Nalati's and Pine's grass already use, with live movers and a trample map that recovers, so the grass springs back.
- `game/shardfile/clientDetails.ts` and `client.ts` (SS7b): the shard page registers the field when no other system owns
  it (a native forest's grass does), pushes the player (0.55 m) and every creature body (0.7 m) each frame with their
  velocity, a step over 30 m/s pushed still, and advances it once a frame.
