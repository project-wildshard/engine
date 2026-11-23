# SP1b2: a cook preparation sidecar

> Written by: Claude (opus-compat-w6), 2026-11-23

A spec 3 author preparation names the renderer that recorded it, so every
engine release that moves the renderer opens it `stale`: the cook goes by the
author's lists and pays link hitches (SP1a). The box's cook may record the
shard again on its own renderer (the same recorder `wildshard prepare` runs; a
local canary on Dunes matched the pinned r5 fence, packs and all 3,041 program
lines) and keep the result beside the original, never inside it.

`openShardfile` and `cookShard` take that sidecar. One recorded on this
renderer and bound to the original's inputs (format's `requireCookPreparation`
over the original index, then every mount's bytes) is taken: the shard opens
`cook` and the cook says `prepared by cook: <slug>`. One for another renderer
is a miss, one whose bytes don't hold is corrupt; both warn and fall back to
the stale path. A current author preparation never reads it. The record job,
the canary gate and the four entry points are SP1b3 to SP1b5.
