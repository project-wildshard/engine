# Scatter clusters (meta SHARD-SOURCE AP33a, AP33b), opus-ss16m

- A props tile's `EXT_mesh_gpu_instancing` node parsed to one InstancedMesh for the whole 62.5 m tile: three culled it
  as one sphere and drew every copy at any distance. `world/instanceClusters.ts` cuts each such mesh (16 or more copies,
  culled, more than one cell) into clusters of 15.6 m squares, each with its own bounds, so the frustum drops the ones off
  screen; the copy total is unchanged, and the clusters take the original's place, frame, material and shadows.
- AP33b: past the tier's `far` (desktop 90 m, phone 45 m) a cluster draws a stable prefix of its copies (desktop half,
  phone a quarter), set in `onBeforeRender` from the main view; a shadow pass keeps what the view drew.
- `installDeclaredProps` clusters each tile as it loads (panels and library models stay whole). Test:
  `test/scene-clusters.test.ts`. Also registers SS8c's `world/swings.ts` side and names its GLSL type for the lint.
