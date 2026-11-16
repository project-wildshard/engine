# Detail layers in a camera ring (SHARD-SOURCE AP32b)

> Written by: Claude (opus-ss16h)
> State: built on `plan/ss16h`, 2026-11-16; wired to the shard file once format v0.7.0 (`look.details`) is pinned.

- `world/detailRing.ts` is `Grass.ts`'s toroidal 4 m cell ring made general for a shard's `look.details` layer: a cell
  is seeded from a hash of its coordinates and the layer id (FNV-1a), so the same square metre grows the same clumps
  after the ring leaves and comes back. A clump is kept with its mask cell's probability, stands on the baked u16
  height and takes a seeded yaw, lean, scale and tint. The phone gets half the radius and half the slots.
- `world/detailLayer.ts` hands the ring's tables to one InstancedMesh (one draw per layer), builds the card from the
  format's binary mesh file and adds an optional sway on the shared wind field to a clone of the look material.
- No base64 anywhere (G649): the format moved the mesh, mask and heights to binary files for this.
- Review fixes (opus-ss16i): the clone keeps the look's shader patches (`copyShaderPatches`; three's `clone` drops
  them), the wind field goes in only when the look has none (twice would not compile), and every layer shrinks its clumps
  to nothing over the last few metres of its radius, as `Grass.ts` does, so a square ring's cells never pop at full size.
