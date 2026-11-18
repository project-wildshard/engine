/** both tiers' tables — Explore's DETAIL TIERS view builds a model at the other tier with `withTier` (src/client/engine/explore/tiers.ts) */
export const TIER_TABLE = {
  phone: {
    maxTexture: 1024, layerSize: 512, dpr: 2, ao: false, // DPR 2 + SMAA on (E70: 1.5 was a ~2× upscale on a 3× iPhone — "really bad and blurry"; 1.0 was already unacceptable); Settings ▸ Render scale overrides (Native = the screen's 3×)
    // shadows: one cascade to 80 m, 1024² — the 2-cascade rig re-drew the whole world twice (9.8 M tris)
    cascades: 1, shadowMapSize: 1024, shadowFar: 80, shadowMargin: 60, softShadows: false,
    // PF3: the cascades redraw on every Nth drawn frame (skyRig.ts); a held map keeps the matrix it was drawn with, so a
    // static shadow stays exactly where it was and only a moving caster's shadow steps. 1 = every frame (a level's row may raise it)
    shadowEvery: 1,
    // NB5: the cascades' staggered cadence (shadowCadence.ts) on every shard, not only a `texelBias: 'phone'` rig (skyRig.ts);
    // the phone keeps its own rule, the desktop takes it (its three cascades were redrawn every frame)
    cascadeStagger: false,
    // animals shadow as far as the cascade reaches (E90: at 30 m an animal's shadow switched on in plain view)
    animalShadowDist: 80, animalHideDist: 150, furShells: false,
    // animal draws (Animal.setDrawLod): fur / hard / eye within animalEyeDist, eyes in the hard material to animalOneDrawDist,
    // then the whole body in the fur material — 3 → 2 → 1 draws per animal
    animalEyeDist: 45, animalOneDrawDist: 100,
    // ONE-FORMAT CC53/CC54/CC55 (creatureLods.ts): past animalBakedDist a model's walking animals draw as its baked herd,
    // one draw (30 deer: 31 draws → 2 on the bench); from animalHideDist to animalSpriteDist as its cards. 0 = off
    animalBakedDist: 40, animalSpriteDist: 300,
    // the far herd (farHerd.ts): past this, a rig is drawn in one draw per model with every other far animal; 0 = off (the
    // phone hides its animals at 150 m). Tried at 100 (cd9034c1d8): Nalati's rigs never batch (no vertex colours) and
    // only one stood in 100–150 m, while every coloured rig spawned would reserve GPU pages (Pine: 25 on the desktop)
    animalFarBatchDist: 0,
    // the far herd takes the generated hulls at every distance (one draw per model); off here: the batch keeps a
    // copy of the hull per animal on the GPU
    animalHullBatch: false,
    // the shadow herd (farHerd.ts { shadow }): the casting animals' shadows in one draw per model per cascade
    animalShadowBatch: true,
    // a far-herd page's slots (farHerd.ts): every spawned rig reserves one, so a page is memory whether drawn or not. PF7b:
    // Pine's 8 coat families held 14 pages of 16 (~113 MB of geometry); a family rarely shows 8 animals at once
    animalFarPageSlots: 8,
    // trees: hi cards → lo cards → far card beyond loDist (Forest dissolves lo → far over its last 12 m, twigs over 6 m).
    // E94: the hi cards reach the shadow cascade's edge (80 m; they swapped at 55 m, inside it, so a crown and its
    // shadow changed shape in plain view), so no shadow ever changes shape. The batched path's lo cards share the casting
    // needles mesh (loTreeShadows is the instanced fallback's; past 80 m there is no cascade to cast into). Phone ruler,
    // with Forest's shadow-aware cull: yaw π +0.02–0.17 M triangles (gate 1.32 → 1.42, cabin 1.65 → 1.67, pond
    // 1.39 → 1.56 M); looking down the sunset's shadows (yaw 0.95) +0.19–0.36 M (0.92 → 1.11, 1.35 → 1.61, 1.57 → 1.93 M).
    // Calls unchanged. (Hi to 110 m, E90's palm distance, was another +0.06–0.24 M: pond 2.13 M looking down the shadows.)
    treeHiDist: 80, treeLoDist: 130, treeTwigDist: 24, loTreeShadows: false,
    // grass carpet: ring radius / slots per 4 m cell / quads per clump
    grassRadius: 40, grassSlots: 56, grassQuads: 3,
    beaconLights: false,
    // item pickups (WeaponPickup): the floating item within this, the orb (sphere / rings / motes / sigil) within this
    pickupItemDist: 22, pickupOrbDist: 120,
    // post: god rays samples / resolution scale, volumetric march steps, SMAA preset
    // 3 full-res SMAA passes are the dearest part of the chain and DPR 1.0 is upscaled ×3 on the screen anyway;
    // volumetrics march at half res into their own target; god rays at a quarter
    // FC9 / FC10: bloom's mip chain at 2 levels (was 4): 4 fewer render-target switches a frame on Driftwood and Pine, same
    // frames day and night on the board (art/frame-cost/round-4-fc10-bloom)
    godRaysSamples: 24, godRaysScale: 0.25, volumetricSteps: 8, volumetricScale: 0.5, smaa: 'low' as 'off' | 'low' | 'high', bloomLevels: 2, // SMAA low back on: at DPR 1.0 the viewmodel's edges stair-step without it
    // every PMREM environment's cube size (pmremSize.ts; 0 = each source's own): one size, so no lit program compiles twice
    // for two shards' environments (the HDR backdrops' 128 cube, a 512-wide equirect, drawn at Driftwood's 64)
    pmremCube: 64,
    // NINE-DRAGON-BENCHMAX NB5 (mini-ninefps, 2026-11-15): a placed model's LOD start distances times this. The phone's
    // portrait camera (vertical FOV ~100°, 874 px at 1×) draws a copy at 0.36× the desktop window's pixels per metre
    // (1496x717 @2, ~70°), 0.72× at 2×: at 0.6 every level still switches at about the projected size the desktop switches at
    placedLodScale: 0.6,
    // NINE-DRAGON-BENCHMAX NB8 (mini-ninetris, 2026-11-15): a resident slab chunk's triangles in k-d order, drawn as the run
    // its camera can see (`slabRanges.ts`): Nine's phone spawn view 0.56 to ~0.47 M slab triangles, other views ~half
    slabRanges: true,
    // NB8 (mini-nb8d): with WEBGL_multi_draw, each slab chunk draws only its visible k-d leaves, each leaf cut to its
    // triangles at least this angle × its distance long (`visibleSlabDraws`; mini-nb8g: longest edge, not thickness, so
    // cables and trim stay): a dropped triangle is a speck under ~0.7 device pixels at DPR 2. 0 = the run
    slabLodAngle: 0.001,
    // NB8 (mini-nb8e): with WEBGL_multi_draw, a frustum-culled slab key's chunks in a bank draw as one merged geometry
    // (`slabMerge.ts`): Nine's 12 plain chunks are 1 draw; the leaf cut keeps its triangles where they were
    slabMerge: true,
    // ONE-FORMAT OF-EM28a: a merged key's run holds at most this many vertices (`slabMergeRuns`), so every run keeps a
    // 16-bit index; 0 = the whole key in one run, 32-bit past 65,535. Nine (headless WebKit, phone Low, 3 alternating cold
    // boots): ledger WebGL buffers 124.3 to 117.4 MB, WebContent peak 1,837 to 1,520 MB (no merge copy), +12-19 draws
    slabMergeVertices: 65_535,
    // NB8 (mini-nb8i): placed copies are chosen for the camera's view padded this many degrees (and re-chosen at a
    // quarter of that turn, `cull.ts`): Nine's copies at 7° drew ~0.1 M triangles outside the portrait view
    cullViewPad: 3,
    // NB8 (mini-nb8i): each slab chunk's tree also splits by facing, built in a worker as the chunk is read
    // (`slabLibrary.ts`), so a leaf showing the camera only its backs is left out: Nine's spawn 0.81 to 0.78 M
    slabFacing: true,
    // NINE-DRAGON-BENCHMAX NB23 (b), far slab decimation (Jake 2026-11-16): a slab leaf at least a far level's cell / this
    // away draws that level's coarse copy (`slabRanges.ts` `slabFarLevels`, built with the faced tree): a corner moves
    // at most ~1.7 × this of the view. Nine's street-route walk p95 0.96 to 0.90 M, same-instant 41-388 px at the look
    // poses, all on far towers; 0.005 drew 0.88 M but moved Nine's gate at ~90 m (776 px). 0 = off
    slabFarAngle: 0.004,
    // STAGING-BUGBASH SB47 (Jake's iPhone, Driftwood 67 s): no warm turns in the first frame. The parked draws (DL23) draw
    // every drawable in or out of view with its shadow-depth pipelines, so the four turned world draws (E153) only
    // re-rasterized the world and its shadow map on a GPU-bound phone: 246 of Driftwood's 954 first-frame draws
    warmTurns: 0,
  },
  desktop: {
    maxTexture: 4096, layerSize: 1024, dpr: 1.5, ao: true,
    cascades: 3, shadowMapSize: 2048, shadowFar: 220, shadowMargin: 120, softShadows: true, shadowEvery: 1, cascadeStagger: true,
    animalShadowDist: 90, animalHideDist: 400, furShells: true,
    // PH-P2: an eye is under a pixel past ~20 m at 1600×900 and a hoof tip past ~60 m, so the
    // phone's draw LOD at 1.3–1.5× its distances. ~150 animals × 3 draws were half of the desktop frame;
    // a same-instant A/B at the gate / cabin / lookout / shore (scripts: every rig forced to the LOD, then back) moved
    // no pixel past the frame-to-frame noise, next to an animal too
    animalEyeDist: 60, animalOneDrawDist: 150,
    // the desktop keeps its rigs and far herd (animalFarBatchDist); cards past its 400 m hide distance
    animalBakedDist: 0, animalSpriteDist: 600,
    // PH-P2: ~100 one-draw rigs at 150–400 m were 90–120 draws at the gate / lookout — the far herd draws them per model
    animalFarBatchDist: 150,
    // PH-P2: and the generated hulls at every distance — their batch draws the same pixels near as far (one group, no shells)
    animalHullBatch: true,
    animalShadowBatch: true,
    animalFarPageSlots: 16,
    treeHiDist: 110, treeLoDist: 210, treeTwigDist: 38, loTreeShadows: true,
    grassRadius: 55, grassSlots: 96, grassQuads: 5,
    beaconLights: true,
    // PH-P2: a pickup floats inside cabin 1 and was ~20 draws + 10 shadow from anywhere in the chunk. A
    // same-instant A/B hiding the whole pickup at 26 / 74 / 165 / 253 m, day and night, moved no pixel past the noise
    // (the walls hide it); in the open a 1 m item is ~8 px at 90 m, and the orb stays a beacon to 200 m
    pickupItemDist: 90, pickupOrbDist: 200,
    godRaysSamples: 60, godRaysScale: 0.5, volumetricSteps: 14, volumetricScale: 1, smaa: 'high' as 'off' | 'low' | 'high', bloomLevels: 8,
    pmremCube: 0,
    placedLodScale: 1,
    slabRanges: false,
    slabLodAngle: 0,
    slabMerge: false,
    slabMergeVertices: 0,
    cullViewPad: 7,
    slabFacing: false,
    slabFarAngle: 0,
    warmTurns: 4,
  },
};


export type EngineTierKnobs = (typeof TIER_TABLE)['phone'];
