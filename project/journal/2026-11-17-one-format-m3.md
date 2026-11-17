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
- CC55a: `render/spriteViews.ts` shoots a rig's rest pose from 8 bearings into one
  atlas row; `entities/herdSprites.ts` draws a model's far animals as one instanced,
  upright, camera-facing card that picks the nearest view. Bench 150/200/300 m: 2 draws
  (31 skinned), 62 triangles, render CPU p95 0.6-0.8 ms vs skinned 1.5 ms, GPU 0.11 ms.
  First shot was dark: the views are shot over clear black, so filtered texels are
  premultiplied; the card divides by alpha.
- CC54b/CC55b: `entities/creatureLods.ts` picks a far creature's draw by tier bands:
  rig < animalBakedDist (phone 40) < baked herd < animalHideDist (150) < cards <
  animalSpriteDist (phone 300, desktop 600). The herd's gait is RECORDED from the
  model's own walking rigs (GaitRecorder, one slot per gait phase), so a far deer shows
  what its poser gives at its own phase; until every slot is filled far deer stay rigs.
  Herd-drawn rigs stop posing (RowBodiesDraw.posesLive) and go to layer mask 0 (their
  kit still draws). Material: AnimalFactory.herdMaterial (the far herd's own-fur path,
  white, tint by instance colour). Cards are shot from a rest rig in a plain standard
  copy of its coat: the rig's shaders read the sky's cascades. Desktop baked band off.
  AnimalView already had `gaitPhase`, so M2's AnimalView is untouched.
- Pine proof (local preview, phone tier, iPhone 17 Pro viewport, 0 console errors):
  Pine's phone tier batches its hulls in the far herd at every distance (level
  override), so a herd-drawn rig must take its layers back from the far herd before
  the LOD keeps them, or a rig returning inside 40 m stayed at mask 0. After standing
  20 m from a herd for 16 s, 3 models had recorded bakes; at 80 m: 13 deer in baked
  herds, 22 on cards past 112.5 m, 74-77 draws (86 at spawn with fewer deer in view).
