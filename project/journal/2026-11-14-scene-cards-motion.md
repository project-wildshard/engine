# 2026-11-14: scene alpha, cards and motion (SHARD-SOURCE AP10 to AP12)

> Written by: Claude (opus-ss4)

- `render/families/sceneSurface.ts` draws format 0.5.4's scene-render keys on the family's own material after it
  compiles: pbr `blend: 'alpha'`, `depthOffset`, `sway` (reads the GLB's `_SWAY` channel), `uvScroll`; emissive
  `blend: 'alpha'`, `card` (reads `_CORNER`, camera-facing in the vertex shader) and its `motion` (pulse, drift, rise).
  Every number is a uniform on the emissive look's clock, so the cleanroom's `update(t)` plays with no shard code.
- `declaredProps.ts`: a prop GLB is opaque by default and its material used to win; a see-through family entry is now
  marked (`userData.sceneAlpha`) and stays see-through. Before, the slice's stencils drew as black plates.
- Proof: the authoring slice's yard (sharddev `plan/ss4`) at 60 fps headless desktop; flame and fern change frame to
  frame (3.4 and 3.1 of 255) while still ground does not (0.4); the lamps' intensities move.
