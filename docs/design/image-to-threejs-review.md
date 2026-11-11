# The img2threejs skill: a review (MODEL-ARCHITECTURE M11, E315)

> Carried from singleplayer `docs/design/` by opus-k9 (REPO-KIT K9, 2026-11-11) for the mockup-to-model skill. Its
> `scripts/blender/`, `scripts/img2mesh/` and `scripts/practice/` paths are in the sharddev repo now; links into
> `project/`, `docs/audits/` and `src/` are singleplayer history.

2026-09-29. Research and a recommendation; no game code changed. Plan:
[MODEL-ARCHITECTURE](../../project/archive/2026-09-30-model-architecture.md)
row M11. Companion: [blender-practice](blender-practice.md) (M10). The
skill this review recommends is drafted at
[`.claude/skills/mockup-to-model/SKILL.md`](../../.claude/skills/mockup-to-model/SKILL.md).

Jake's words (E315): *"Image to three.js skill: review whether it should
be added to the repository. Review whether it's Opus 5.5 native or a
legacy project for Opus 4.8. Maybe image-to-three.js is just not
something we need. Maybe we need a tiny subset of it. Maybe we read that
whole repository, that whole skill, and take all of our learnings within
this project and make our own image-to-three.js thing, because we are
doing that: we make mockups and we generate models with procedural
three.js code. We have a workflow; we might just not be documenting
it."*

## The verdict

- **What it is.** img2threejs is an open-source, Apache-2.0 skill that
  rebuilds one object from one photo as a hand-coded-style three.js
  `Group` factory. It works through a JSON spec and Python gates. It is
  already installed on this Mac, user-wide, and unused by this repo: 0
  of ~300 shapes came from it.
- **Its era.** It is current by date: July to September 2026, co-written
  with Claude Sonnet 5 and Codex. But it is built for the weakest agent
  host it supports: one agent, a context that gets compacted, no
  subagents, kept on rails by ~45 k lines of Python. **It is not Opus
  5.5-native.** It is not an Opus 4.x leftover either. It is a
  host-agnostic, context-scarce design.
- **Recommendation: write our own skill; vendor none of its code; carry
  over six of its ideas** (§8). The workflow Jake describes exists and
  works: 41 generated models and ~100 code-built ones ship. It was never
  written down in one place. It is now:
  `.claude/skills/mockup-to-model/SKILL.md`.

---

## 1. What it is, where it lives, who made it

| | |
|---|---|
| Repo | [github.com/img2threejs/img2threejs](https://github.com/img2threejs/img2threejs) (was `hoainho/img2threejs`), Apache-2.0 |
| People | hoainho, 35 commits on main; kokorolx, 66, and all 23 commits of the `img2` harness. Sponsors: Atlas Cloud (an inference broker), Tripo, Hyper3D |
| Dates | created 2026-07-15; v1.4.0 07-26, v1.5-beta 08-06, v1.5.1 08-23, v1.5.2 09-03, **v2.0.0 09-06** (the head of main) |
| Size | 414 files, 7.3 MB. `forge/`: 44.8 k lines of Python + 26.4 k lines of tests (1,416 tests pass, 64 skip). ~104 k words of Markdown (`SKILL.md` 4.1 k words, `grimoire/`, `docs/`) |
| Popularity | 17.2 k stars, 1.4 k forks |
| On this Mac | `~/.agents/skills/img2threejs` at `6e60b5e` (= v2.0.0), symlinked as `~/.claude/skills/img2threejs` and `~/.codex/skills/img2threejs`. The `img2` harness is at `~/.img2/harness`, with **plugin-character v0.2.0** (`~/.img2/plugins/character`, linked as `~/.claude/skills/img2-character`). All installed 2026-09-15 |
| Used here | **Never.** No `.img2threejs/` state folder, no commit. Two ideas from plugin-character were re-implemented for the training dummy (E285): geodesic binding in `scripts/practice/rig_dummy.py` and the rig-gate sweep in `scripts/practice/dummy_rig_gate.py` |
| Companions | [plugin-character](https://github.com/img2threejs/plugin-character) (rigging and animation, a 12-check rig gate); [plugin-img2glb](https://github.com/img2threejs/plugin-img2glb) (image → GLB through the *hosted* TRELLIS v1 HF Space: v0.1.0, and its only step dies on import); plugin-cs2 (CS2 weapon skins); the [showcase](https://img2threejs.io/) (knives, guns, earbuds, a BMX, an anime swordswoman, Pikachu) |

## 2. What it does, step by step

1. **`forge/next.py --state .img2threejs/state.json`** at every start
   and resume. A JSON checklist is "the authority"; exit code 3 is a
   hard stop.
2. **Look at the image** in 8 layers: identity, silhouette,
   macro/meso/micro parts, joins, PBR, colour, identity marks, what is
   hidden. Grade the reference pass / conditional / reject.
3. **BM25 search** over a local 3D-vocabulary corpus for domain facts.
4. **Pre-spec assessment:** 8 complexity scores → a tier → a "quality
   contract". Then a **detail inventory**: 3 / 6 / 10 / 16 identity
   details by tier, each mapped to a spec field.
5. **Projection** for patterned surfaces and faces: solve the camera,
   de-light the photo, project and bake it into UVs.
6. **The spec (`ObjectSculptSpec`):**
   - The script writes one placeholder root box and ~800 lines of
     checklists.
   - The agent authors the real component tree: about 89 fields, each
     part's surface class before its primitive, and at most 5 critical +
     3 important review targets.
   - `--strict-quality` promotes 84 warnings to errors.
7. **Generate the TypeScript factory for the unlocked pass only.**
   `generate_threejs_factory.py` is 4,111 lines of real codegen from the
   spec JSON. It emits primitives, lathe / extrude / tube / tapered
   sweeps, SDF marching cubes, a visual hull and subdivision.
8. **Passes:** blockout → structural → form → material → surface →
   lighting → interaction → optimization.
9. **Each pass:**
   - render in a browser and shoot a 4-view turntable;
   - run the deterministic gates (turntable holes, self-intersection,
     attachment, "Divine Eye" metrics on a 64 × 64 luma grid, interior
     difference);
   - make one reference-vs-render sheet;
   - **the agent looks at it and types a score**; `continue` needs ≥
     0.7.
10. **Exactly one decision per pass:** continue / refine-spec /
    refine-code / request-input / stop. The cap is 3 corrections per
    pass and 6 in total, and a plateau or oscillation stops the loop
    early.
11. **Part coverage:** every part is clickable and explodable, with
    pivots, sockets and collider *intent*.
12. **Rig (plugin-character, `--profile animated-character`):**
    - read the skeleton from a GLB, repair → freeze → bind (add-only) →
      parity → measure the clips;
    - the 12-check gate (G1 a clip really drives its node … G12 the rig
      reference);
    - the gate is declared non-blocking, because 4 of its checks have no
      input yet.

## 3. Opus 5.5-native, or an older-generation project?

| Evidence | What it shows |
|---|---|
| **Dates** | Created 2026-07-15, v2.0 on 2026-09-06: 3 weeks old. Not legacy by age |
| **Who wrote it** | Commits carry `Co-Authored-By: Claude Sonnet 5`; PR bodies say "Generated with Claude Code"; a `codex/beta-release-flow` branch; the docs configure Codex MCP; docs cite "5 adversarial reviews, 43+ recorded decisions". Agent-written, Codex-first, with Claude as one host |
| **No model named anywhere.** It targets "Claude Code, Codex, or OpenCode" (`SKILL.md:18`) | Written to the lowest common denominator of three hosts |
| **Context is rationed.** "Conversation context is disposable; `.img2threejs/state.json` is the local checklist authority" (`SKILL.md:61`). "read the named file at the moment you reach that stage, not before" (`SKILL.md:24`). A token budget of ~80–180 k per object (`docs/TOKEN_COST.md`). "Pure Python stdlib … nothing to install means nothing to debug in-context" | Designed for an agent that loses its plan when its context is compacted |
| **No subagents, no parallel work.** A "multi-agent generation pipeline" is a v3.0 roadmap item (`ROADMAP.md:91`) | Everything is one agent, one pass at a time |
| **Vision is distrusted.** The VLM is "never consulted on a hard-gate failure"; the model sees "one image per review", but types its own `aiVisionScore`, which the gates then trust | Rails for a judge it doesn't trust, which still depend on that judge |
| **Guards against literal agents.** "Told to 'run the gate and do not advance', an agent stops on its first command, every time" (`docs/standard-prompts/README.md:27-28`) | Prompting around an agent that follows words, not intent |
| Prompt style | Few capitals (6 MUST in `SKILL.md`); long "why this exists" failure records with measured numbers. That style is modern, and it is the best part of the repo |

**Conclusion.** The ceremony (the checklist state, the 89-field spec,
the pass locks, the self-typed scores) exists to keep a forgetful single
agent on track. An Opus 5.5 session in this repo does not work like
that:
- it runs up to five build subagents in parallel;
- it holds the plan and the audit in context;
- it reads a turntable board itself;
- it hands Jake one A/B/C image to pick from.

The parts that last are the **measured failure records** and a few
gates. The rest is the host-agnostic, context-scarce style of 2025–26
agent skills, not something built for how we work.

## 4. Where it overlaps with our workflow

| Stage | img2threejs | Wildshard today |
|---|---|---|
| Reference | One photo or screenshot of an object, graded by a rubric | A **mockup in the game's own frame**: codex `image_gen` or local Qwen-Image edits a live capture (AGENTS.md ▸ Mockups, `scripts/mockup-local.sh`). For image-to-3D: one object on white, 3/4 view (`art/driftwood-isle/round-8-assets/ref-*.jpg`; `scripts/img2mesh/split_sheet.py` for a sheet) |
| Analysis | 8-layer read, detail inventory, BM25 corpus, an 89-field JSON spec | A plan row and the mockup. **No written detail inventory** |
| Build | One pipeline: a TS factory generated from the spec, pass by pass | **Five pipelines, picked per model:** hand-written TS builders (`LowPolyKit`, Nine Dragon `Kit`); TRELLIS.2 / Hunyuan3D-2 on MPS → Blender post (`scripts/img2mesh/`); Blender scripts (`scripts/blender/`); CC0 (Poly Haven, Kenney) |
| Review | 4-view turntable gate, pixel metrics, one sheet, a self-typed score ≥ 0.7, capped loops | The Model Explorer turntable (SOLID · WIREFRAME · FACETS · TIERS, DAWN…NIGHT); 8-view turntable sheets (`art/nalati-grasslands/round-5-models/*-turntable.jpg`); `versus_board.py` (TRELLIS vs Hunyuan); **in-game A/B boards on the iPhone portrait frame** (`art/pine-hollow/round-15-rifle/board.jpg`); Jake picks; model-spin clips (M9) |
| Rig | plugin-character: GLB skeleton, geodesic skinning, 12 gates | `scripts/creature-rig-bake.mjs` (deleted in E357 F7: needed the dev labs) / `nalati-rig-bake.mjs` (deleted in E357 F7: needed the dev labs) (a generated hull on the species' code skeleton), `scripts/practice/rig_dummy.py` + `dummy_rig_gate.py`, Nine Dragon's rig gate (`art/nine-dragon-stack/round-13-viewmodel-rig/`) |
| Ship | A `THREE.Group` factory; colliders as metadata | A GLB + `.phone` / `-lod1` / `.far` copies + KTX2 twins, meshopt; `registry.add` (Rapier colliders, floors, an Explorer card), `defineModel` / `place()` once M0 lands; phone budgets; the walk test |

## 5. What it has that we lack

1. **A written, repeatable procedure from reference to finished model.**
   Ours lives in eight places: AGENTS.md, `scripts/img2mesh/README.md`,
   `scripts/blender/README.md`,
   `art/nalati-grasslands/round-5-models/README.md`, the
   shard-checkpoints skill, LOOK-LOOP.md, plan rows and memory. **This
   is the real gap, and the new skill closes it.**
2. **A detail inventory before building:** list the identity-defining
   details of the reference (bevels, bands, fasteners, carved marks,
   colour zones) and map each one to a part or a material. Our code
   builders go straight from mockup to code.
3. **A four-view turntable gate with a hole check.** A flood fill from
   the border finds background enclosed by the silhouette, i.e. a hole
   through the model. We found Nalati's `boulder-2` see-through gaps and
   the wreck's torn planks by eye.
4. **The mirror rule for paired parts.** A left/right pair is a
   reflection (negate x only), never a 180° turn. Mirroring also flips
   triangle winding, which must be flipped back or `flatShading` lights
   the part from behind. That matters to every flat-shaded kit here.
5. **Geometry know-how from measured failures:**
   - pick the surface class before the primitive: organic → lathe /
     sweep, never a box; cables → tube;
   - use parallel-transport frames for sweeps (Frenet frames flip at an
     inflection);
   - bevels are real chamfers (0.02–0.08 of the part, 1–4 segments);
   - frames are tube networks, not one closed sweep;
   - parts overlap 0.02–0.05 at seams;
   - scale stays 1 at the root;
   - repeats are instanced with a slight per-copy cant.
6. **A bounded self-correction loop:** 3 fixes per pass, 6 in total;
   stop on a repeated defect, oscillation or a plateau. Then ask a
   person.
7. **An action-ready hierarchy** (named pivots and sockets for moving
   parts). We have anchors ad hoc: `Hut` anchors, the knife's `bladeTip`
   sidecar, `fpArms`' `muzzle`.

## 6. What we have that it lacks

- **References in the game's own frame and style**, per shard: Driftwood
  toon, Nalati painterly, Pine Hollow PBR, Nine Dragon Jiehua. A
  reference photo of a product has none of that.
- **Local image-to-3D that ships.** TRELLIS.2-4B and Hunyuan3D-2 run on
  MPS, and both are run so the better model ships. The skill's position
  is that a generated mesh is "never the output"
  (`docs/RESEARCH_TRELLIS2_TO_IMG2THREEJS.md`). Here ~21 TRELLIS and ~20
  Hunyuan models ship, and its own image→GLB plugin wraps a hosted
  TRELLIS v1 that fails to import.
- **Blender** for bakes, decimation, per-facet colour, atlases,
  impostors, rigs: the choices are in M10.
- **Game-engine concerns**, which it scores as thin. It has no LOD ("the
  pipeline has no LOD concept"), colliders are metadata, instancing is
  radial only, there is no draw-call budget, and it never mentions
  mobile or iOS. Here:
  - phone budgets: 2 M triangles / 150 draws (Nine Dragon 180), and 1.8
    GB loading / 1.0 GB Explorer memory;
  - the facade multi-draw ban;
  - tier files and KTX2 twins;
  - Rapier colliders through the registry, the walk test and navmesh;
  - the Model Explorer.
- **Human taste in the loop.** An iPhone-portrait decision board with A
  / B / C, the Debug registry for variants (never a `?param`), and Jake
  picks. Its loop ends at the agent's own score.
- **Parallel work:** several pipelines and variants built at once, under
  the shared model lock.

## 7. Could it run here as it is? No

- **Its output breaks our rules:**
  - `MeshPhysicalMaterial` everywhere;
  - five 1024² canvas textures per material, filled pixel by pixel **on
    the CPU at load**;
  - a 250 k-triangle budget;
  - `type SculptMaterialSpec = Record<string, any>`
    (`generate_threejs_factory.py:2346`) fails our no-`any` oxlint gate.
- **Its generator is never type-checked** in its own test run: the 39
  `tsc` tests skip without a separate showcase checkout.
- **It validates fields it doesn't use.** Bevels (`edgeTreatment`) and
  taper / bend (`deformationStack`) never reach the emitted code. The
  frozen test fixture expects a body declared 1.0 × 0.46 × 0.78 to come
  out as a unit box.
- **Its code-rig emitter uses Euclidean weights.** Its own
  `geodesic_skinning.py` is a standalone tool nothing calls.
- **Its process is heavy for what we make:** an ~89-field spec per prop,
  a state folder in the repo root, 80–180 k tokens per object, and gates
  that trust a score the agent types.
- **Hazards:**
  - one of its tests rewrites `~/.claude/settings.json` and
    `~/.claude/skills` when sibling repos are present;
  - `SKILL.md` tells agents to run `runtime/scripts/*.mjs`, which the
    repo gitignores and doesn't ship;
  - its focus is photo-real product and character likeness (CS2 knife
    skins, 12.5 k lines of hair), not stylised, phone-budget game props.

## 8. Adopt, take a subset, or write our own?

| | Adopt as is | Vendor a subset (copy some of its code) | **Write our own (recommended)** |
|---|---|---|---|
| Fits the five pipelines | no: one pipeline, code only | no: the subset still assumes its spec and state | yes: it picks one of the five per model |
| Fits budgets, tiers, registry, Explorer, boards | no | no | yes: it cites them |
| Upkeep | a 7 MB external repo on the Mac, with a moving major version (v2.1 in flight) | a fork to maintain in Python | one Markdown file plus scripts we already own |
| What we'd gain | its gates | the turntable gate, the chirality check | the same ideas, re-implemented in our tools (below) |

**The six ideas we take** (as rules in the skill now, and as small tools
when a model wave needs them):

| Idea | Where it lands |
|---|---|
| Detail inventory before building | the skill's step 2: a numbered detail list in the round's README, each detail mapped to a part |
| Four views + a hole check | the skill's review step. Later a `--views` mode for `scripts/model-spin.mjs` (M9), or a small Node flood fill on the Explorer's turntable captures |
| Mirror = negate x, and flip the winding back | a rule in the skill, and a helper in `LowPolyKit` / Nine Dragon `Kit` when the next paired part is built |
| Surface class → primitive; parallel-transport sweeps; real bevels; seam overlap | the skill's "code builder" rules |
| Bounded loop: 3 fixes per pass, 6 total, then ask | the skill's self-review step |
| The rig-gate checklist (weights sum to 1, indices in range, bind restore, no NaN, foot slide, clip really drives a bone) | already in `scripts/practice/dummy_rig_gate.py` and Nine Dragon's rig gate; the skill points at them |

**The user-wide install.** `~/.claude/skills/img2threejs` and
`~/.claude/skills/img2-character` stay visible to every session on this
Mac. Their descriptions ("image-to-3D reconstruction …") will match a
request in this repo before ours does. Jake's call:

```bash
rm ~/.claude/skills/img2threejs ~/.claude/skills/img2-character   # removes the symlinks only; the checkout stays in ~/.agents/skills
```

## 9. The skill

[`.claude/skills/mockup-to-model/SKILL.md`](../../.claude/skills/mockup-to-model/SKILL.md) documents the workflow end to end,
with this repo's real scripts:

1. mockup;
2. reference sheet and detail list;
3. pick a pipeline: code / TRELLIS / Hunyuan / Blender / CC0;
4. build;
5. LODs and tiers;
6. register (`registry.add` today, `defineModel` / `place()` once M0
   lands);
7. review (turntable, in-game board, spin clip);
8. Jake's pick.

It sits beside `shard-checkpoints` (a shard's slice) and
[LOOK-LOOP](LOOK-LOOP.md) (an area's look). This skill is one model.

## Sources

- The skill: `~/.agents/skills/img2threejs/` (`SKILL.md`, `README.md`,
  `CHANGELOG.md`, `ROADMAP.md`, `docs/`, `grimoire/`, `forge/`),
  `~/.img2/plugins/character/`, `~/.img2/harness/`. Read in full by two
  research passes; the forge test suite run on a scratch copy with an
  empty `HOME`: 1,416 ran, OK, 64 skipped.
- GitHub (via `gh api`): the repo's metadata, contributors, releases,
  102 commit messages on main, PR bodies; the metadata of `img2`,
  `plugin-character` and `plugin-img2glb`.
- This repo:
  [models-and-model-explorer](../audits/models-and-model-explorer.md)
  §2, `scripts/img2mesh/README.md`, `scripts/practice/`,
  `art/nalati-grasslands/round-5-models/README.md`,
  `docs/design/LOOK-LOOP.md`,
  `.claude/skills/shard-checkpoints/SKILL.md`.
