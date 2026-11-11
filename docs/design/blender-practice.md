# Blender: `.blend` files or Blender scripts? (MODEL-ARCHITECTURE M10, E315)

> Carried from singleplayer `docs/design/` by opus-k9 (REPO-KIT K9, 2026-11-11) for the mockup-to-model skill. Its
> `scripts/blender/`, `scripts/img2mesh/` and `scripts/practice/` paths are in the sharddev repo now; links into
> `project/`, `docs/audits/` and `src/` are singleplayer history.

2026-09-29. Research and a recommendation; no game code changed. Plan:
[MODEL-ARCHITECTURE](../../project/archive/2026-09-30-model-architecture.md)
row M10. Census it builds on:
[models-and-model-explorer](../audits/models-and-model-explorer.md) §2.

Jake's words (E315): *"Figure out if we're supposed to have .blend files
or Blender scripts: tell me what the best practice is, and we'll
refactor and do the thing."*

## The answer

**Scripts are the source. The exported GLB is what we commit and ship. A
`.blend` is never committed.** Every Blender model here is written by an
agent as a headless `bpy` script that builds the model and exports the
GLB. A builder may save a `.blend` next to its build output in the local
cache, for someone to open and look at. That copy is disposable.

This is already how all seven Blender-made models were built. The
refactor is about **where the scripts live, how they run, and whether
every shipped GLB can be traced to one.** Today one shipped model
cannot: the Nine Dragon first-person arms (details below).

---

## 1. What we have today

### Models whose author is a Blender script (the audit's 7, plus 2)

| Model | Builder | Output (shipped) | Loaded by | Model lock | Saves a `.blend` |
|---|---|---|---|---|---|
| Driftwood spawn cove: terrain tiles + ~60–72 prototypes, 16.7 k placements, AO + bounce lightmaps | `scripts/blender/build_island.py` (713 lines) + `assets.py` (385), fed by `export-scene.mjs` + `shards/driftwood-isle.mjs` (the game's own heights, colours and layout, run in Node); `pnpm blender:island` → `run.sh` | `public/assets/models/driftwood-blender/` (2.5 MB: `island.glb`, `placements.bin`, `island.json`, 4 lightmap WebPs) | `src/shards/driftwood-isle/world/BlenderIsland.ts` | **no** | no |
| Pine Hollow tree set: 14 variants × 5 LOD parts, card + impostor atlases, 4 bark sets | `scripts/blender/trees/{treegen,build_trees,barkgen,glb}.py` + `run.sh` | `public/assets/models/pine-hollow-trees/` (4.4 MB) + `public/assets/tex/{fir_bark,…}/` | `src/engine/client/world/forest/treeSet.ts`, `TreeFactory.ts` | yes | no |
| Pine Hollow crag kit (12 modules) | `scripts/blender/crags/{build_crags,rocklib}.py` + `run.sh kit` | `pine-hollow-crags/crags.glb` (348 KB) | `src/shards/pine-hollow/world/crags.ts` | yes | no |
| Pine Hollow bear cave | `scripts/blender/crags/build_cave.py`, fed by `export-cave.mjs` (the baked heights round the mouth) | `pine-hollow-crags/cave.glb` (373 KB) | `src/shards/pine-hollow/world/crags.ts` | yes | no |
| Lever rifle (hi / lo) | `scripts/blender/weapons/lever_rifle.py` (1,091 lines) + `run.sh` | `public/assets/pine-hollow/weapons/lever-rifle{,.phone}.glb` | `src/shards/pine-hollow/weapons/LeverRifle.ts` | yes | yes, into the build cache |
| Skinning knife in a gloved hand (hi / lo) | `scripts/blender/weapons/skinning_knife.py` (1,358) + `run-knife.sh` | `skinning-knife{,.phone}.glb` + `.json` | `src/shards/pine-hollow/runtime/models/skinningKnife.ts` | yes | yes, into the build cache |
| **Nine Dragon first-person arms**: hand, gauntlet, jian guard, rigged into `fp-rig.glb` with 16 clips | **not at HEAD.** `src/dev/nd-lab/viewmodel/blender/{hand,hand_lib,hand_model,hand_parts,gauntlet,gauntlet_geo,gauntlet_maps,gauntlet_parts,gauntlet_preview,guard}.py` (4,110 lines) were deleted with the lab in `7a339ed2`; they exist only in history (`7a339ed2^`). The rig bake that turns the parts into `fp-rig.glb` (`bake.ts`, `moves.ts` with the clips, `rigbake.mjs` (deleted in E357 F7: needed the dev labs), `riggate.mjs` (deleted in E357 F7: needed the dev labs), `gate_chart.py`) was **never committed**, and is not under `~/projects`, `~/.claude/jobs` or the scratch folders | `public/assets/nine-dragon/viewmodel/fp-rig.glb` (2.4 MB) + 16 map WebPs (5.5 MB folder) | `src/shards/nine-dragon-stack/vm/fpArms.ts` | — | — |
| *Lab only:* Fei Zhua grapple | `src/dev/nd-lab/grapple/blender/fei_zhua.py` (844) | `public/assets/nine-dragon/lab/grapple/fei-zhua.glb` (402 KB), shipped but loaded only by the dev lab page | `src/dev/nd-lab/grapple/feizhua.ts` | no | no |
| *Orphan:* Nalati yurt | `scripts/blender/nalati_yurt.py` (330) | none: Jake picked the procedural yurt and `609f4242` removed the GLB and its loader | — | — | — |

### Blender as a post-processing step (the model's author is TRELLIS.2, Hunyuan3D or a CC0 kit)

- **In the repo:**
  - `scripts/img2mesh/`: `driftwood_post.py` (clean-up, decimate,
    per-facet colour, AO, pivot), `build_props.py`, `cc0_export.py`,
    `render_still.py`, `board.py`, `versus_board.py`, `birds/*.py`;
  - `scripts/practice/`: `rig_dummy.py` and `dummy_rig_gate.py`, the
    training dummy's rig and its gate.
- **Outside the repo:**
  `~/projects/localai/bin/img2mesh/blender_post.py` and its job table
  `nalati-jobs.tsv` made the Nalati models. That is 62 GLBs under
  `public/assets/nalati/models/` (plus `sourced/`). The game repo does
  not hold the recipe for them.

### How they run

- **Always** `blender -b --factory-startup -P <script> -- <args>`
  (Blender 5.2.1 LTS, `/opt/homebrew/bin/blender`), then
  `gltf-transform meshopt`, then a copy into `public/`.
- Intermediate files go to `~/.cache/wildshard-blender/<target>/`.
  Downloaded inputs (Poly Haven bark and walnut) are fetched into the
  same cache by the runner.
- **No runner passes `--python-exit-code`.** A Python exception exits 0,
  so a failed build is caught only by `test -s <output>`. A partial
  export would pass.
- **The model lock is inconsistent.** The trees, crags and weapons
  runners take `lockf -k ~/projects/localai/.model.lock`. The island's
  `run.sh` and `build_dummies.sh`'s rig step don't, and the island runs
  Cycles bakes on the Metal GPU.

---

## 2. The options

| | **A. `.blend` is the source** (an artist's file; export by hand or by a script) | **B. Script is the source; GLB committed; `.blend` never committed** (recommended) | **C. Both committed** (script builds, `.blend` checked in "for convenience") |
|---|---|---|---|
| Who can author it | A person in Blender's UI. Our authors are agents; they don't drive the UI | Anyone who writes Python: every agent, today | Script authors; the `.blend` goes stale the moment the script changes |
| Reproducible | Only by reopening that exact file in a compatible Blender. No record of *how* a shape was made | Yes: script + pinned Blender + pinned inputs rebuild it. The Driftwood hero props' post step already re-produces the committed files byte for byte (`scripts/img2mesh/README.md` §1) | Two sources of truth that drift |
| Review | Binary: no diff, no review, no blame | A normal code diff. Every shape decision has a line and a commit message | The diff hides the part that matters |
| Git and the uplink (10–100 KB/s) | A rigged dummy's `.blend` is **12–15 MB** (measured, `~/ml/img2mesh/out/dummy-e285/work/*.blend`) against a **1.0–1.2 MB** shipped GLB. One save is 2–22 min of push, and every re-save is a whole new blob: `.blend` doesn't delta | All of `scripts/blender/` is ~350 KB of text; an edit pushes a few KB | The worst of both |
| 10 agents, one tree | Two agents touching one `.blend` = one loses; no merge exists | Normal text merges | Same as A |
| Game data in | A frozen copy: the file can't follow a moved pier or a retuned tree spec | Reads the game's own data at build time (`export-scene.mjs` runs the game's heightfield and layout; `treegen.SPECS` is `TREE_SPECS_V2`, checked by `test/tree-species.test.ts`) | — |
| Tiers, LODs, sidecars | By hand, per file | The same run emits hi + lo + phone copies, atlases, impostors and `.json` sidecars (the rifle, the knife, the trees) | — |
| Hand sculpting | **The one thing it's good at** | Not possible. You can only do what a script can express (`bmesh`, modifiers, remesh, bakes) | — |
| Blender version drift | A 5.2 file opens in later versions, but older versions can't open it | The script may need small fixes on a new Blender. The pin plus a rebuild check shows it | — |

**Why B is the best practice here, not just the habit.** Studios keep
`.blend` / `.ma` / `.spp` files, usually in Perforce or Git LFS, because
their sources are hand-made by artists. A binary is the only form that
work can take. None of that is true here:

- every author is an agent;
- every model is parametric (tiers, variants, LODs);
- several read the game's own data;
- the repo has a 10–100 KB/s uplink and ten writers on one working tree.

Procedural and generated-asset pipelines keep the generator as the
source and treat the export as a build artefact. They pin the tool
version, and they check geometry digests rather than bytes where the
exporter isn't byte-stable.

**Why the GLB is committed, not built in CI.**
- Vercel and GitHub Actions have no Blender, Metal GPU, TRELLIS or local
  caches.
- A Cycles bake takes minutes of GPU time.
- Some inputs aren't reproducible bit for bit. A TRELLIS.2 decode
  differs between runs, and the dummy's facing changes per generation
  (`scripts/practice/build_dummies.sh`). For those, the committed GLB is
  the pin.
- The same holds for every image-to-3D model, so it is one rule for all
  pipelines: **the recipe and the output are committed; the
  intermediates are not.**

### When a model should be a Blender script rather than three.js code

Both are "modelled from code". The difference is when the code runs:
once at build time on this Mac, or on every load on Jake's phone.

| Pick **three.js code** (`src/…`, runs at load) when | Pick a **Blender script** (`scripts/blender/…`, runs once, ships a GLB) when |
|---|---|
| The shape follows placement or game data at runtime (a stair's treads, a pier to the terrain, a per-copy lean) | It needs an offline **bake**: Cycles AO or bounce, a normal map from a high mesh, a texture atlas, an impostor, a lightmap |
| The look is flat vertex colour or an analytic shader: Driftwood's `LowPolyKit`, Nine Dragon's `Kit` with the Jiehua material | It needs modifier-grade geometry: bevel, boolean, solidify, voxel remesh, decimate, UV unwrap |
| It changes often and must hot-reload in the dev server | It needs skin weights or a rig built on the mesh (the dummy's geodesic binding) |
| Its build fits the 30 ms load slices (`slicer`, `macrotask`) | Building it at load would cost the phone more than downloading it (the cove: 16.7 k placements baked into tiles) |

---

## 3. Where the files live (B1)

B1 puts a model's **module** under `src/engine/client/models/` (shared)
or `src/chunks/<slug>/models/` (one shard). The module is the TypeScript
the game imports: its `defineModel` loads the GLB and owns variants,
LODs and colliders. The **builder** that made the GLB is a build tool,
and it stays out of `src/`:

```
scripts/blender/
  build.sh                 one entry point: build.sh <target> | --all | --check  (the flags, the lock, meshopt, copy)
  targets.json             target → script, args, outputs[], lock, blender "5.2.1", the model ids it feeds
  lib/                     shared Python + export: glb.py (the minimal glTF writer), rocklib.py, bake helpers,
                           export-scene.mjs (the game's data → the cache)
  driftwood-isle/          island.py, island_assets.py, export.mjs (was shards/driftwood-isle.mjs)
  pine-hollow/             trees/, crags/ (kit + cave), weapons/ (rifle, knife), export.mjs
  nine-dragon-stack/       viewmodel/ (hand, gauntlet, guard: restored from history), lab/fei_zhua.py
scripts/img2mesh/          unchanged: image-to-3D and its Blender post (TRELLIS / Hunyuan / CC0 → GLB)
public/assets/…            unchanged URLs: moving shipped files changes cache keys, precache and the byte tables for no gain
```

The model module names its builder, and the check (§5) keeps the link
true in both directions:

```ts
export const crags = defineModel({
  id: 'pine-hollow/crag', name: 'Granite crag module', category: 'rocks',
  pipeline: 'blender',
  source: 'scripts/blender/pine-hollow/crags/build_crags.py',   // a targets.json script
  file: 'src/chunks/pine-hollow/models/crag.ts',
  …
});
```

**Why not next to the model in `src/`?** Keeping them together is
tempting: delete the model and its builder goes too. But:
- `.py` files under `src/` are invisible to every gate (tsc, oxlint,
  vitest).
- Many builders feed several models or a model plus world. The cove
  builder makes world tiles and ~60 prototypes; the tree builder makes
  14 variants and their atlases.
- The Nine Dragon lab shows the failure mode. Deleting
  `src/dev/nd-lab/viewmodel/` deleted the Blender source of a model that
  still ships.

**Why not a new top-level `assets-src/`?** The builders' image inputs
already have a home, `art/<subject>/round-<n>/` (the dummy's
`ref-*.jpg`, Driftwood's `round-8-assets/ref-*.jpg`), and AGENTS.md
forbids new top-level art folders. Downloaded inputs are fetched by URL
into the cache (Poly Haven), so they need no copy in git.

**Hand-made `.blend` files, if one is ever needed.** Nothing needs one
today. The wreck's "hand retopo" in `scripts/img2mesh/README.md` §5 is a
job for a script. If a human artist ever works on the game:
- their `.blend` is the source, and it lives outside this repo: an
  art-source store like `~/projects/weights`, or Git LFS in a separate
  art repo;
- this repo commits the exported GLB plus a sidecar `.json` with the
  file's sha256, its store path and the Blender version;
- the model's `source` names that sidecar, and its badge stays BLENDER.

---

## 4. How a Blender build runs

- **Flags:**
  `blender -b --factory-startup --python-exit-code 1 -noaudio -P <script> -- <args>`.
  - `--factory-startup` ignores the user's prefs and add-ons.
  - `--python-exit-code 1` makes an exception fail the run instead of
    exiting 0.
  - The runner still checks that every output in `targets.json` exists.
- **Pin:** Blender 5.2.1 LTS in `targets.json`. `build.sh` warns on a
  different version, and a new version is adopted with a `--check`
  rebuild of every target.
- **Determinism:**
  - every random draw is seeded (the game's `SEED` or a per-target
    seed);
  - `build.sh --check <target>` rebuilds into the cache and compares a
    geometry digest (vertex and triangle counts, bounds, a hash of the
    quantised positions) against the committed GLB;
  - bytes are not compared, because the glTF exporter and meshopt aren't
    byte-stable across versions.
- **The model lock:**
  - **Cycles work** (bakes, Cycles renders) and **any run over a
    minute** go through `lockf -k ~/projects/localai/.model.lock`. They
    compete with TRELLIS, MiniMax and the image models for the GPU and
    unified memory.
  - **Short geometry-only or Eevee runs** skip it: `render_still.py`
    board stills (1–2 s), a rig pass. A 2 s still shouldn't queue behind
    a 15-minute TRELLIS batch.
  - **Never `evict.sh`:** Blender is not an LLM server.
- **Outputs:**
  - the build goes to `~/.cache/wildshard-blender/<target>/`;
  - `gltf-transform meshopt --level medium` is applied, plus the tier
    copies (`.phone.glb`, `-lod1`, `.far.glb`, as `tierUrl` / `phoneUrl`
    expect);
  - then the copy into `public/`;
  - `--save-blend` writes `<target>.blend` into the cache for a person
    or agent to open (the rifle, knife and dummy already do this).
- **The KTX2 twins and byte tables** follow as today:
  `scripts/bake-ktx2.mjs` for textures; the vite build regenerates
  `src/engine/boot/bytes.generated.ts` and `versions.generated.ts`.

---

## 5. Enforcement (with M8)

One check script, `scripts/check-model-sources.mjs`, run by vitest or CI
next to the M8 lint rules:

1. Every `defineModel` with `pipeline: 'blender'` has a `source` that
   exists and is a script in `scripts/blender/targets.json`, or a
   hand-made `.blend` sidecar (§3).
2. Every target's outputs exist under `public/`, and every target feeds
   at least one model id or a declared world piece.
3. Every `.py` / `.mjs` under `scripts/blender/` except `lib/` belongs
   to a target, so orphans like `nalati_yurt.py` fail.
4. Every GLB under `public/assets/` is loaded by a model or world module
   and has a producer. The producer is a `scripts/blender` target, a
   `scripts/img2mesh` prop list, a rig bake
   (`scripts/creature-rig-bake.mjs` (deleted in E357 F7: needed the dev
   labs), `nalati-rig-bake.mjs` (deleted in E357 F7: needed the dev
   labs)), or a CC0 entry in `scripts/img2mesh/CC0.md`. Existing gaps go
   on an allowlist that only shrinks.
5. No `.blend` / `.blend1` is tracked.
   - `.githooks/pre-commit` refuses them, like the `progress/` image
     cap.
   - `.gitattributes` gets `*.blend binary -delta` as belt and braces.
   - `.gitignore` gets `*.blend1`.

---

## 6. The refactor list

In order; each item is one small commit that doesn't collide with the
lanes live in the same files.

1. **Rescue the Nine Dragon arms' sources** (before anything else;
   history-only today).
   - Restore `hand*.py`, `gauntlet*.py` and `guard.py` from `7a339ed2^`
     into `scripts/blender/nine-dragon-stack/viewmodel/`.
   - Ask the Nine Dragon lane whether `bake.ts`, `moves.ts`,
     `rigbake.mjs` (deleted in E357 F7: needed the dev labs),
     `riggate.mjs` (deleted in E357 F7: needed the dev labs) and
     `gate_chart.py` survive anywhere (a worktree, an agent's scratch).
   - If they are lost, write down that `fp-rig.glb` is the only copy of
     its 16 clips. Its model card then says "source: partial". The clips
     are rebuilt only if they ever need to change.
   - Fix `art/nine-dragon-stack/round-13-viewmodel-rig/README.md` "How
     to rebuild", which points at deleted paths. (S)
2. **One runner and a manifest.**
   - Add `scripts/blender/build.sh` and `targets.json`, with the §4
     flags (`--python-exit-code 1`), the lock rule, the version pin,
     `--save-blend` and `--check`.
   - Point `pnpm blender:island` and the four existing `run*.sh` at it;
     each shrinks to a `targets.json` row. The island now takes the
     lock. (S–M)
3. **Move the builders to the per-shard layout** (§3), one shard per
   commit. Pure moves plus path fixes in the comments that cite them
   (`BlenderIsland.ts`, `PineCrags.ts`, `treeSet.ts`, `LeverRifle.ts`,
   `skinningKnife.ts`, `fpArms.ts`, `scripts/blender/README.md`).
   - `scripts/blender/{build_island,assets}.py` and
     `shards/driftwood-isle.mjs` → `driftwood-isle/`.
   - `trees/`, `crags/`, `weapons/` and `shards/pine-hollow.mjs` →
     `pine-hollow/`.
   - `export-scene.mjs` and `trees/glb.py` → `lib/`.
   - `crags/rocklib.py` stays with the crags until a second builder uses
     it.
   - Each move rebuilds with `--check` to prove the GLB is unchanged. (S
     each)
4. **Delete the orphan** `scripts/blender/nalati_yurt.py`: Jake picked
   the procedural yurt in `609f4242`, and history keeps the script. (XS)
5. **Fei Zhua:** move `fei_zhua.py` to
   `scripts/blender/nine-dragon-stack/lab/`. Ask the Nine Dragon owner
   whether `public/assets/nine-dragon/lab/grapple/fei-zhua.glb` should
   keep shipping: only the dev lab page loads it. (XS)
6. **Bring the Nalati recipe home.**
   - Copy the job rows of
     `~/projects/localai/bin/img2mesh/nalati-jobs.tsv` and the
     `blender_post.py` arguments into a prop list,
     `src/shards/nalati-grasslands/art/model-recipe.json`, run by
     `build_props.py`.
   - Vendor `blender_post.py` into `scripts/img2mesh/` if
     `driftwood_post.py` can't do its job.
   - Afterwards the game repo holds every recipe for what it ships;
     localai keeps the runners and the model installs. (S)
7. **With M1 / M2 / M5 (the model waves):**
   - each Blender-made model's `defineModel` gets `pipeline: 'blender'`
     and `source:`;
   - the cove's prototypes carry their own origin (TRELLIS / CC0 /
     code), with the cove builder as their `source`, and the cove's
     ground tiles stay world;
   - the crag kit becomes one model family with 12 variants;
   - the cave is world, or a model placed once. M2 decides; its builder
     reads the terrain at the mouth, which argues world;
   - the rifle, knife and arms become Gear. (in the waves)
8. **The check** (`scripts/check-model-sources.mjs`, §5), the pre-commit
   `.blend` refusal, `*.blend binary -delta` and `*.blend1` in
   `.gitignore`. It starts with an allowlist of today's gaps: the
   `driftwood-hero` / `driftwood-cc0` outputs whose prop-list names
   don't match their folder paths, and `nalati/sourced/`. (S, with M8)
9. **One paragraph in AGENTS.md** under "Local models": "Blender models
   are scripts in `scripts/blender/<slug>/`, run by
   `scripts/blender/build.sh`; commit the GLB, never a `.blend`." Plus a
   pointer here. (XS)

Sizes: items 1–6 and 8–9 are about a day in all, and none of them
changes a shipped pixel. Item 7 rides the approved waves.

## Sources

- Repo: `scripts/blender/`, `scripts/img2mesh/README.md`,
  `scripts/practice/build_dummies.sh`, `src/dev/nd-lab/grapple/`,
  `art/nine-dragon-stack/round-13-viewmodel-rig/README.md`,
  `.gitattributes`, `.vercelignore`.
- Git: `7a339ed2` (the viewmodel lab deleted), `5d8feae0` (the lab
  added), `609f4242` (the Blender yurt dropped).
- Measured: `.blend` sizes in `~/ml/img2mesh/out/dummy-e285/work/`;
  `blender --version` 5.2.1 LTS; `blender --help`
  (`--python-exit-code`).
- Background on binary art sources in Git: [Anchorpoint, Git with
  Blender](https://www.anchorpoint.app/blog/git-with-blender) (LFS and
  file locking for hand-made `.blend` files).
- Background on headless, pinned, digest-checked Blender pipelines:
  [openzigs/onyourleft#430](https://github.com/openzigs/onyourleft/issues/430) and
  [8r4n/adventure-snowcrash#179](https://github.com/8r4n/adventure-snowcrash/issues/179).
