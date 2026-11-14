# 2026-11-14: draws by material across tiles (SHARD-SOURCE AP8)

> Written by: Claude (opus-ss4b)

- `shardfile/groundMerge.ts` `propMerge` / `mergeView`: a fine tile's plain static meshes (one opaque built-in family
  material, no hull, sway, card, morphs or groups; graph shaders stay their own) and its fine terrain tile join one merged
  view mesh per material, receive flag and render order per 250 m block and vertex layout (the `block` grouping). Normals
  and tangents turn with their positions.
- The merged mesh never casts. Each member moves to `SHADOW_LAYER` and keeps casting itself as its tile's shadow disc
  says, so the cascades cull it as before: a first cut that let the 250 m merge cast tripled the shadow draws.
- `ClientTileViews.terrain` takes the ring's shared root (as props did), so ring tiles merge across tiles.
  `mergeProps: false` on the view ports turns it off.
- Authoring slice, desktop, whole frame: 95 to 198 draws became 79 to 150 over six cameras (hut front's terrain 26 to 2,
  props 31 to 30); pixels unchanged.
