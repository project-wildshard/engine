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
- SS7b test: two movers push with their velocity, the field updates once a frame, a 10 m jump pushes still, an owned field is left alone.
- Review fixes: the page settles who owns the field on its first frame, after every plan phase (a forest page registers
  during the world phase, so deciding earlier drove the field twice a frame); no push while a practice room is open
  (E321); a mover missing for a frame is forgotten; a look that already declares `trampleBend` keeps its one copy.
  Left: creatures drawn by a herd view may be pushed twice (two of 16 slots); a layer bends on the module field even when
  another field owns the page; shadows stay upright.
