---
name: mockup-to-model
description: Make one Wildshard model (a prop, building, rock, plant, creature, NPC or weapon) from a mockup or reference image, end to end. Covers the mockup in the game's own frame, a reference sheet with a detail list, picking the pipeline (three.js code, TRELLIS.2, Hunyuan3D-2, a Blender script or CC0), building it, LODs and phone tiers, registering it for physics and the Model Explorer, self-review, and Jake's portrait board or spin clip. Use it when asked to "model", "add", "replace", "remaster" or "generate" a thing in a shard, or to turn an image into a three.js model. Not for an area's overall look, a place of a new WorldClaw shard (worldclaw-interactive's checkpoint), a slice of a shipped shard (that shard's own plan, D90), render bugs or HUD work.
---

# Mockup to model

> Written by: Claude (opus-k9, REPO-KIT K9, 2026-11-11). Carried from singleplayer's mockup-to-model skill.

**Where things are.** Paths are engine's unless they start with `$SD`,
the sharddev checkout (`SD=~/projects/games/wildshard/sharddev`), which
owns the image-to-3D, Blender and asset tools, or name a shard repo
(`../shard-<name>`), which owns its models and art. Paths marked
*(history)* are singleplayer records, cited for reasons only: nothing
here needs a singleplayer tree.

One model, from a picture to a registered, reviewed, shipped thing. This
is the workflow the game's shipped models were made with (*(history)*
`docs/audits/models-and-model-explorer.md` §2), written down once (E315,
M11). The reasons behind it are in
`docs/design/image-to-threejs-review.md` and
`docs/design/blender-practice.md`.

A **model** is one reusable thing built by exactly one builder, in its
own space: metres, +Y up, pivot at the centre of its foot on y = 0,
front toward +Z (*(history)*
`project/archive/2026-09-30-model-architecture.md` §1). A place (a camp,
a field, a cove) is a Set of models, not a model. If you are about to
model a place, split it first.

## 0. Before you start

- Claim the ask: run `src/scripts/ask-new.sh "<Jake's words>"` in the
  owning repo's checkout and read its output (parallel sessions claim
  ids in the same second). Keep its Status line true.
- Read the shard repo's plans (`../shard-<name>/docs/plans/`) and its
  look:
  - Driftwood is **toon low-poly**: flat-shaded, vertex colour
    (`COLOR_0` rgb = albedo, a = baked AO), never photoreal.
  - Nalati is **painterly**: one atlas, roughness ~0.85, no normal map.
  - Pine Hollow is **photoreal PBR**: base colour + normal, KTX2.
  - Nine Dragon is **Jiehua**: Nine Dragon's `Kit` with its analytic
    ruled-line material.
  - Never unify the looks across shards.
- New shards use the baseline HUD. The facade multi-draw ban covers
  every model: instance, never `BatchedMesh` a facade.
- All art for this job goes in the owning repo's
  `art/<subject>/round-<n>-<label>/` (the next free round), as JPEG,
  with a short README listing every file.

## 1. The mockup: the model in the game's frame

Show what the model should be **where it will stand**, not on a white
void.

1. Take a live capture at iPhone portrait size, the only size Jake
   reviews at: serve a build
   (`URL=$(scripts/serve-build.sh --head --shard <slug>)`),
   `agent-browser --session <s> set viewport 390 844`, then open
   `${URL}?touch&tier=phone&skipintro&nolock&mute=1&chunk=<slug>`
   (headless, always muted). Walk or fly to the spot, `screenshot`, and
   `close`.
   - Before you open a browser, check `agent-browser session list` and
     `pgrep -fl chrome-headless-shell`: at most 3 game browsers run on
     this Mac. Or run inside `scripts/browser-lane.sh`.
2. Edit the capture into the target:
   - **fast, local:**
     `$SD/scripts/mockup-local.sh --ref <capture.jpg> --prompt-file <p.txt> --out <png>`
     (Qwen-Image, ~30 s; `--mask` for a localised edit; run 2–3 seeds);
   - **fidelity:** codex `image_gen` (one image per run, runs in
     parallel).
   - Make 2–4 variants (A / B / C) when the look is a taste call. Read
     every image before you use it.
3. If Jake has to choose a direction, stop here. Send one portrait board
   (§8) and ask with `AskUserQuestion`.

## 2. The reference sheet and the detail list

- **A reference for image-to-3D** is one object, alone, on a plain white
  background, three-quarter view, whole, and unoccluded.
  - Examples *(history)*: `art/driftwood-isle/round-8-assets/ref-*.jpg`,
    `art/hud-explorer/round-7-dummy-rebuild/ref-*.jpg`.
  - Make it by editing a crop of the approved mockup (codex or
    `$SD/scripts/mockup-local.sh`) in the shard's style.
  - A sheet of several small objects comes back from TRELLIS as one
    pile: cut it with `$SD/scripts/img2mesh/split_sheet.py` first.
  - A figure that will be rigged stands with its arms off its body and
    closed fists (the dummy lesson, E285).
- **A reference for a code or Blender build** is the same view, plus a
  front and a side when proportions matter.
- **The detail list** goes in the round's README before any build.
  Number the identity-defining details: silhouette masses, bands and
  trims, fasteners, carved or painted marks, colour zones, wear. Give
  each detail the part or material that will carry it. When you review,
  check each number; a detail you can't place on a real part is dropped,
  not faked.
- **The numbers** go in the same README:
  - height and footprint in metres;
  - the pivot and the front;
  - the triangle budget per tier (desktop / phone / far);
  - how many copies the world will place;
  - what it collides with (box / capsule / hull / treads / none);
  - whether it moves (rig, pivots, sockets).

## 3. Pick the pipeline

Each model gets one pipeline, which becomes its card's badge: CODE ·
BLENDER · TRELLIS · HUNYUAN · CC0.

| Pipeline | Pick it when | Proven on |
|---|---|---|
| **Code** (TypeScript builder, runs at load) | The shape is parametric or follows game data (stairs with treads, a pier to the terrain, per-copy lean); flat vertex colour or an analytic material; it must change often; its build fits the 30 ms load slices | Driftwood's hut, pier, wreck, palms (`src/client/engine/world/lowpolyKit.ts`); Nine Dragon's facade and market (`../shard-nine-dragon/src/shards/nine-dragon-stack/generators/kit.ts`); Nalati's yurt (Jake picked it over the Hunyuan and the Blender yurt, `609f4242`) |
| **TRELLIS.2** (image → mesh, local, MIT) | Organic or sculptural hero props, statues, rocks, plants, creature hulls: things code draws badly | Driftwood hero props, Pine Hollow's 8 hero props, Nalati's 18 models, Nine Dragon's lion and dragon hook, the dummies |
| **Hunyuan3D-2** (image → mesh, local) | The same jobs. It is ~10× faster, and its masses are often more solid. Run it beside TRELLIS and ship the better take. It is as allowed as TRELLIS: never write a territory caveat | the Drowned Captain, Nalati's horses, King, collie, people; Pine Hollow's creatures and NPCs |
| **+ Hi3D refine** (after either generator, opt-in) | The generation decimates into spikes, torn flaps or holes; a faceted prop; a normal-mapped hero. Not for detail the generator only painted, nor a look with no normal map (`$SD/scripts/img2mesh/README.md` §4b) | the HI3D-REFINE boards: Driftwood wreck, Pine Hollow ranger and bear, Far Reach roc |
| **Blender script** (`$SD/scripts/blender/`, runs once, ships a GLB) | It needs an offline bake (Cycles AO or bounce, a normal map, atlases, impostors, lightmaps), bevel / boolean / remesh, a UV unwrap, skin weights, or would cost the phone more to build than to download | the Driftwood cove, Pine Hollow's trees, crags, cave, rifle and knife |
| **CC0** (Poly Haven, Kenney, Quaternius) | A real-world photoscan fits a PBR shard, or a kit piece fits after a palette snap | Pine Hollow's rocks, stump, logs, cabin props; the cove's CC0 palms (`$SD/scripts/img2mesh/CC0.md`) |

- If you can't tell, build two (code vs TRELLIS, or TRELLIS vs Hunyuan)
  and put them side by side (§7). That is how the yurt and the Nalati
  bosses were decided.
- In parallel work, give each subagent one pipeline or one variant and
  disjoint files.

## 4. Build

Every model builder, whatever the pipeline:
- builds in its own space;
- seeds every random draw (`Rng(seed)` from
  `src/shared/engine/core/rng.ts`, never `Math.random`);
- gives its colliders in its own space (`ColliderDesc`: box / capsule /
  ball / hull; `treads` for any stair, rise ≤ 0.35 m, tread ≥ 0.36 m;
  trimesh only for walk-inside shapes);
- never imports Rapier.

### Code

- **Where it goes:** a shared model in engine's
  `src/client/engine/models/`, a shard's own in its shard repo
  (`../shard-<name>/src/shards/<slug>/`, next to the shard's other
  builders).
- **Its kit:** the shard's.
  - Toon: `LowPolyKit` (`src/client/engine/world/lowpolyKit.ts`).
  - Painterly: `PaintKit`
    (`../shard-nalati/src/shards/nalati-grasslands/generators/paint.ts`:
    smooth parts, painted vertex colour, one shared painterly material).
  - Jiehua: Nine Dragon's `Kit` / `KitX`.
  - PBR: Pine Hollow's cabin kit (`../shard-pine-hollow/src/shards/`).
  - Merge each model to one mesh on one shared material. Detail costs
    triangles, not draw calls.
- **Materials:** go through the shard's material and
  `sky.setupMaterial(mat)`, or the shard's look breaks.
- **Geometry rules** (from measured failures):
  - pick the surface class before the primitive: an organic form is a
    lathe or a sweep, never a box; a cable, root or rope is a tube;
  - sweep a changing cross-section along parallel-transport frames
    (Frenet frames flip at an inflection);
  - a crisp edge is a real chamfer (0.02–0.08 of the part, 1–4
    segments);
  - parts overlap 0.02–0.05 m at a seam;
  - never scale the root to hide a thing.
- **Mirrored pairs:** a left/right pair is a **reflection**, negate x
  only. Reflecting flips the triangle winding: flip it back, or flat
  shading lights the part from behind. A 180° turn is not a mirror.
- **Repeats:** a repeat inside a model is merged (or instanced with a
  slight per-copy cant). Repeats of the model across the world are
  `place()`'s job, not the builder's.

### TRELLIS.2 / Hunyuan3D-2

Both run under the machine-wide model lock. Keep a batch under 30
minutes. Installs, weights and traps: `$SD/scripts/img2mesh/README.md`
and `~/projects/localai/docs/3d-models.md`.

```bash
L=~/projects/localai/bin/img2mesh/run-locked.sh
# TRELLIS.2 (1024_cascade by default; --pipeline 512 for a fast pass)
$L ~/ml/img2mesh/logs/<job>.log ~/ml/img2mesh/trellis-mac/.venv/bin/python \
  $SD/scripts/img2mesh/trellis_batch.py --out ~/ml/img2mesh/out/<shard> <ref.jpg …>
# Hunyuan3D-2, the same refs
$L ~/ml/img2mesh/logs/<job>-hy.log ~/ml/img2mesh/Hunyuan3D-2/.venv/bin/python \
  ~/projects/localai/bin/img2mesh/hy3d_batch.py --out ~/ml/img2mesh/out/<shard>-hy --shape turbo <ref.jpg …>
```

- **Post (Blender, headless):** add the model to a prop list,
  `$SD/scripts/img2mesh/props/<list>.json` (one row per tier: LOD0,
  `-phone`, `-lod1`), then
  `python3 $SD/scripts/img2mesh/build_props.py $SD/scripts/img2mesh/props/<list>.json <owning repo>/public/assets/models/<dir> <ref>`.
  - Toon shards take the default post: faceted, per-facet colour, AO in
    `COLOR_0.a`.
  - Photoreal shards pass `--keep-texture`: smooth shading, the texture
    baked ungraded, a normal map.
  - `$SD/scripts/img2mesh/pine_hollow_phone.sh` moves the `-phone` copy
    to `<ref>.phone.glb`.
- **Traps already paid for:**
  - open plank shells tear under every decimator:
    `--solidify 0.004 --remesh 0.005`;
  - a flat item comes back as a sheet: `--up x90 --remesh 0.025`;
  - a straight pinnate leaf falls apart;
  - Hunyuan paints palm trunks in stripes;
  - TRELLIS picks a figure's facing per generation, so check it with a
    render;
  - a boulder decimated to ~800 triangles can show see-through gaps.
- **Compare the takes** under the same light and camera:
  `python3 $SD/scripts/img2mesh/versus_board.py <trellis_dir> <hunyuan_dir> <renders_dir> <out.jpg> name=<ref> …`
  (stills from `$SD/scripts/img2mesh/render_still.py`).
- **The creature/NPC rig bakers** (`creature-rig-bake.mjs`,
  `nalati-rig-bake.mjs`) were deleted in E357 F7: needed the dev labs. A
  standalone rig is modelled on `$SD/scripts/practice/rig_dummy.py` and
  gated by `$SD/scripts/practice/dummy_rig_gate.py`. Every rig gate
  checks:
  - weights sum to 1, within the storage's rounding (half a quantum per
    weight);
  - indices are in range;
  - the bind pose restores;
  - no NaN;
  - no tear in the pose sweep: the welded copies of a bind position stay
    together; edge stretch is measured and reported, or held to a
    measured baseline such as the motion already shipped (E388: no
    invented 2× bar);
  - every clip really moves its bones (a clip that exists is not a clip
    that plays).

### Blender script

Read `docs/design/blender-practice.md` first.
- The script is the source; commit the GLB, never a `.blend`.
- Run it
  `blender -b --factory-startup --python-exit-code 1 -P <script> -- <args>`
  (Blender 5.2.1).
- Take `lockf -k ~/projects/localai/.model.lock` for Cycles bakes or
  anything over a minute.
- Build into `~/.cache/wildshard-blender/<target>/`, then
  `pnpm dlx @gltf-transform/cli meshopt <in> <out> --level medium`, then
  copy into the owning repo's `public/`.
- Existing builders to copy from: `$SD/scripts/blender/` and each shard
  repo's `scripts/blender/`; add a `targets.json` row and build with
  `$SD/scripts/blender/build.sh` (never commit a `.blend`;
  `$SD/scripts/blender/README.md`).

### CC0

- Poly Haven: add the id to `scripts/fetch-assets.mjs` and run
  `node scripts/fetch-assets.mjs`.
- A heavy photoscan gets an offline LOD
  (`$SD/scripts/simplify-models.mjs`).
- A kit piece on the toon shard gets a palette snap
  (`$SD/scripts/img2mesh/cc0_export.py --family rock|bleach|wood`, via
  `$SD/scripts/img2mesh/build_cc0.sh`).
- Record the licence and URL in `$SD/scripts/img2mesh/CC0.md`.

## 5. LODs, tiers and weight

- **The phone gets its own copy** when it would download or hold less:
  `<name>.phone.glb` next to `<name>.glb`.
  `src/client/engine/boot/bytes.ts` `tierUrl` / `phoneUrl` pick it;
  don't write a branch.
- **Distance LODs:**
  - a `-lod1` file (the TRELLIS props, a quarter of the triangles);
  - a `.far.glb` (Nalati's herds);
  - a two-card impostor
    (`~/projects/localai/bin/img2mesh/blender_impostor.py`, the tree
    set's impostor atlas);
  - or a runtime simplified copy (Nine Dragon's `simplifiedCopy`,
    meshoptimizer).
  - Fade or dither the switch where it pops.
  - Once M0 lands, the LODs go in the model's `lods`, and `place()`
    applies them.
- **Textures:** every GPU texture gets a KTX2 twin
  (`node $SD/scripts/bake-ktx2.mjs`; add new files to
  `$SD/scripts/bake-ktx2.list.json`). Geometry is meshopt-compressed;
  load with `new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)`.
- **Budgets:**
  - the whole phone frame is ~2 M triangles and ~150 draws (Nine Dragon
    180);
  - memory is 1.8 GB while loading and 1.0 GB in the Explorer;
  - one model's copies are one draw (instanced or merged), and its card
    must say which.
  - A new drawing technique needs a physical-iPhone memory reading, not
    a desktop number (E271 / E272).
- **Commit JPEG / WebP**, not PNG: preview images ≤ 250 KB, boards ≤ 500
  KB (the hooks refuse more). The uplink is 10–100 KB/s.

## 6. Register it

- **Today:**
  `registry.add({ id, name, category, file, object, colliders, surface, floor?, solidFloor, model })`
  (`src/client/engine/world/registry.ts`). One of a batch, built on
  view, uses `registerModel({ …, live: false, object, buildAt })`
  (`src/client/engine/explore/registry.ts`). Never register a built
  thing twice, and don't push into `player.colliders`.
- **Once M0 lands:** the model is a file that calls
  `defineModel({ id, name, category, pipeline, file, source?, variants, build, lods?, colliders?, rig? })`,
  and the world places it with `place(model, placements)`. Every
  `defineModel` is in the Model Explorer, and nothing else is. A
  `pipeline: 'blender'` model names its `source` script.
- **After any collider change:**
  - `node scripts/physics-baseline.mjs --no-build --mode=walk` (and
    `--trails`): 0 stuck is the bar;
  - if structures moved, re-check the owning shard's navmesh bake.
- **Check the card** in the Model Explorer (the harness param
  `?explore=model&chunk=<slug>`):
  - it is under the right tab;
  - the triangles per copy and the draws are what §2 planned;
  - TIERS shows the phone copy;
  - VIEW IN WORLD lands on a real copy.

## 7. Review it yourself first

- **Four views at least:** front, both sides, back, plus three-quarter
  and top, on the Explorer's turntable at phone size. Look for:
  - holes through the model (background showing inside the silhouette);
  - floating parts, and parts sunk into each other;
  - mirrored parts on the wrong side;
  - a wrong pivot (the model hovers or sinks);
  - a wrong front.
  - Never approve from the hero angle alone (a checkpoint's Form gate,
    worldclaw-interactive).
- **Tick the detail list** (§2) against the render, number by number.
- **In the game:** the mockup's camera, then a walk-around, a 12-frame
  orbit for cutouts, seams and popping. Check it at the LOD switch
  distances, and at dawn and night if the shard has a clock.
- **Cost:**
  - read the draws and triangles on the card;
  - for a model placed hundreds of times, run the shard's GPU ruler
    (`../shard-nine-dragon/scripts/nine-dragon-gpu.mjs`,
    `../shard-pine-hollow/scripts/pine-hollow-gpu.mjs`) before and
    after;
  - every change is the same or cheaper, or Jake is told the price.
- **Bounded loop:** at most 3 fixes per problem and 6 in total. Stop
  early when the same defect comes back, a fix undoes the last one, or
  the gain is flat. Then ask Jake, with the evidence, instead of
  iterating blind.

## 8. Jake's review

- **One portrait board, one image,** labelled A / B / C: mockup ·
  candidate(s) · today's model, at the same camera, plus a 4-view strip
  of the candidate. Use the real in-game frame, not a turntable alone
  (*(history)* `art/pine-hollow/round-15-rifle/board.jpg` is the
  pattern).
- **A spin clip** of about 10 s, when the form is the question:
  `node scripts/model-spin.mjs --url=<build> --shard=<slug> --models=<id,…> --out=<art path>.mp4`,
  run inside `scripts/browser-lane.sh` (M9). It turns 1–5 models on the
  real Model Explorer at phone size. Files over 30 MB silently don't
  arrive.
- **If it's a taste call,** ship both as a Debug variant:
  - a key in `OPTION_VALUES` / `OPTION_SPECS`
    (`src/client/engine/ui/Settings.ts`);
  - one `opt(…)` row in `DEBUG_ROWS`
    (`src/client/engine/ui/debugOptions.ts`), under its domain's group;
  - never a `?param`.
  - When Jake picks, delete the row, the option and the losing model in
    one commit.
- **Ask with `AskUserQuestion`,** with a short text summary above it.
  Don't build further on an unpicked direction.

## 9. Ship

- **Commit** with a pathspec (`git add <new files>`, then
  `git commit -m "…" -- <paths>`): the model's files, its GLBs, its art
  round.
  - Never `git add -A`, stash, or restore anyone else's files.
  - One model family per commit.
- **Land:** engine code from a plan worktree
  (`node scripts/worktree.mjs new <slug>`, then
  `WS_LANE_NAME=<lane> node scripts/land.mjs`, AGENTS.md); a shard
  repo's model by pathspec commit, `git pull --rebase`, `git push`, and
  watch its CI.
- **Close the ask:** write the commit and build id into the ask file.
- **Before you report:** close every browser session, and don't leave a
  model job holding the lock.

## What this skill is not

- Not a promise that a generated model is final. Jake's pick is.
- Not for a whole area's look, render bugs, pop-in or performance hunts
  (show real builds and Debug toggles, not mockups), or HUD layouts.
- Not a replacement for the open-source `img2threejs` skill's
  spec-and-gate machinery. We took six of its ideas (the detail list,
  four views and holes, the mirror rule, surface class before primitive,
  the bounded loop, the rig-gate checklist) and none of its code.
