# 2026-11-12 A skinned creature's glowing part (TE-ENG10, opus-teeng10)

> Written by: Claude (opus-teeng10)

- A skin drew in its binding's one family material (`clientSkins.ts` cleared
  the hull to one group), so Brasscap's bandit eye and Wyrm gullet were bright
  vertex colour, never LF1-2's emissive look material, and no bloom.
- Format (shardfile 37f272e, 6ec5cff): a skin binding's `materials` maps GLB
  material names to `look.materials` IDs, as `props.materials` does; the GLB's
  one skinned mesh may carry up to eight primitives with the same channels.
- Engine: `loadSkin` merges the primitives (three loads one SkinnedMesh per
  primitive) into one geometry, grouped: group 0 every unmapped primitive (the
  family material), then one group per mapped name. `loadClientSkins` compiles
  each mapped look material fresh per rig (`SpeciesLook.partMaterials`), the
  factory draws them after the body, and `Animal` flashes every part with the
  body (an unlit emissive part by its colour) and returns each to its own base.
  The far draw LOD never folds a part into the body.
- Cost: one more draw per rig per mapped material, plus one more shadow draw
  per cascade where the rig casts. A skin without the map is unchanged.
- Test `src/client/game/shardfile/skin-parts.test.ts` (red before, green after).
- Codex review, four MUSTs fixed: primitives whose same channel differs in
  encoding merge as floats; neighbour cells (`neighbourLife.ts`) draw the parts
  too; a fading corpse keeps each part material whole (a clone dropped the
  emissive family's shader patch); a graph look material is refused as a part
  by the format (shardfile 0916c10), since an unlit graph ignores the emissive
  port the flash writes.
