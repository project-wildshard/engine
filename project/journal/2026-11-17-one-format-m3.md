# ONE-FORMAT M3: the phone (opus-of-m3)

- CC53: `scripts/creature-bench.mjs` + `scripts/creature-bench/` draw 30 of Pine's
  phone deer (`deer-hind.phone.rigged.glb`, 3k tris, 20 bones, one material) on the
  iPhone 17 Pro viewport at the phone pixel ratio, 4x CPU, rAF-capped. Skinned rigs:
  27-31 draws, render CPU p95 1.4-1.9 ms, GPU ~0.3 ms (M5 Max) at 20/60/120 m. The
  cost is the draws (~35-50 us each at 4x, over the 30 us phone rule), not the pose.
- CC54a: `entities/bakedHerd.ts` bakes one gait cycle of a SkinnedMesh into a float
  texture (frame rows, 4 texels a bone) and draws a species as ONE InstancedMesh
  skinned from it in the vertex stage (patchShader 'baked-herd', own depth material).
  Bench at 40 m, 600 frames: skinned 31 draws / CPU p95 1.5 ms; baked 2 draws / p95
  0.7 ms against an empty scene's 0.6 ms (the p95 is harness noise; the herd adds
  ~0.1 ms). Tests: baked frames match three's live skinning to 1e-4; mid-frame gap
  under 0.1 m on a deer-sized quadruped.
