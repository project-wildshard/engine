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
  },
};


export type EngineTierKnobs = (typeof TIER_TABLE)['phone'];
