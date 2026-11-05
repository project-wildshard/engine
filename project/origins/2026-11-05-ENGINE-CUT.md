<!-- Copied from `Raynos/project-wildshard-meta` docs/multi-repo/ENGINE-CUT.md on 2026-11-05: history, not live. -->

# Engine cut: measured (P1.3)

> Written by: Claude

> **State:** measurement, 2026-11-04, on `Raynos/project-wildshard-singleplayer@727236c625`. Rerun it with
> `node docs/multi-repo/tools/measure-cut.mjs ~/projects/games/wildshard-singleplayer out.json`. This is row P1.3
> of [MULTI-REPO-PLAN.md](MULTI-REPO-PLAN.md).

## Headline

Today's headless sim is **already clean**: only 8 files and 10 imports keep it from building without the renderer
and the DOM. The headless host, though, runs a small slice of the game. Most of the gameplay a server must own runs
only in the browser today, and about half of that sits in files that also draw things.

The gameplay folders hold about 120k LOC of engine + game:

| Bucket | LOC | What it means |
|---|---|---|
| **On the server path already** | **33k** | The headless host reaches it and it is clean. It moves to `shared/` or `server/` as it is |
| **Browser-only, but clean** | **36k** | Logic with no renderer or DOM imports that only the client reaches today. It needs wiring into the server tick, not untangling |
| **Browser-only and mixed with rendering** | **49k** | Gameplay files that import renderer `three` or touch the DOM. Pass 2 (below) sorts them: **about 14–19k is real sim/view mix to split**, about 17k is client loading and session code that the MMO rewrites around the server connection, and about 11–15k is pure view that just moves to `client/` |

The other ~107k LOC of engine + game is presentation, boot or tooling: render, UI, audio, models, looks, explorers,
boot. It goes to `client/` (or `sharddev`) without a fight.

## Method

The script resolves every import in `src/engine` and `src/game`, using relative paths and the `@wildshard/*`
`exports` maps. Type-only imports and test files are skipped. It walks two reach sets:

- **Server:** from `src/sdk/{headless,headlessRuntime,tickWorkerHost,tickWorkerLoop}.ts`. This reaches 536 files,
  221 of them in engine + game; 469 are reached by static imports alone.
- **Client:** from `src/{main,entry,native}.ts`. This reaches 1,927 files.

It marks a file **render** if it value-imports anything from `three` beyond maths types (vectors, quaternions,
matrices, boxes, `Color`, `MathUtils`…), or imports `three/webgpu`, `three/tsl`, `three/examples`, `postprocessing`
or `n8ao`. It marks a file **DOM** if its code mentions `document.`, `window.`, `navigator.`, `localStorage`,
`requestAnimationFrame`, `HTMLElement`, `AudioContext` and similar.

| Group | Files | LOC | Rule |
|---|---|---|---|
| both | 211 | 36,328 | Reached by server and client; clean |
| server-only | 2 | 48 | Reached by server only; clean |
| entangled | 8 | 2,235 | Reached by server, but render or DOM |
| client-logic | 663 | 56,726 | Client only; clean |
| client-render | 508 | 111,564 | Client only; render or DOM |
| unreached | 53 | 20,199 | Neither root reaches it (mostly `game/boot` generated tables, calibration, bake) |
| **total** | **1,445** | **227,100** | Non-test `.ts` in `src/engine` + `src/game` |

## The 10 imports to cut first

Each one is a clean server-path file importing a render or DOM file:

| From | To | Why it's tainted |
|---|---|---|
| `sdk/headlessRuntime.ts` | `game/plugin/mover.ts` | `Object3D` |
| `game/plugin/simulation.ts` | `game/plugin/mover.ts` | `Object3D` |
| `game/plugin/simulation.ts` | `engine/physics/pieces.ts` | `Object3D` |
| `engine/physics/declaredProps.ts` | `engine/physics/pieces.ts` | `Object3D` |
| `game/shardfile/homeKeeper.ts` | `game/plugin/animation.ts` | `BufferGeometry`, `BufferAttribute` |
| `game/population/nativeManager.ts` | `game/systems/looks/trample.ts` | `DataTexture` |
| `engine/script/host.ts` | `engine/core/framePacing.ts` | DOM |
| `engine/script/decisionModule.ts` | `engine/core/framePacing.ts` | DOM |
| `engine/core/workSlice.ts` | `engine/core/framePacing.ts` | DOM |
| `engine/boot/waits.ts` | `engine/boot/download.ts` | DOM |

The 8 entangled files these imports reach:

| File | LOC | Why it's tainted |
|---|---|---|
| `game/plugin/animation.ts` | 599 | `BufferAttribute`, `BufferGeometry` |
| `game/plugin/mover.ts` | 589 | `Object3D` |
| `game/systems/looks/trample.ts` | 345 | `DataTexture` |
| `engine/physics/ropeChain.ts` | 208 | `Bone`, `Group`, `Skeleton`, `SkinnedMesh` |
| `engine/core/framePacing.ts` | 173 | DOM |
| `engine/boot/download.ts` | 157 | DOM |
| `engine/physics/pieces.ts` | 122 | `Object3D` |
| `engine/core/devMode.ts` | 42 | DOM |

The pattern is the usual one: a sim module holds a scene object, or reads frame pacing from the browser. The fix is
to pass the data in through a port, or split the module into a sim half and a view half.

## Gameplay folders, by bucket

LOC per folder. "On path" means the server reaches it today; "clean" means browser-only but untainted; "mixed"
means browser-only and render or DOM.

| Folder | On path | Clean | Mixed | Read |
|---|---|---|---|---|
| `game/shardfile` | 4,266 | 8,134 | 9,840 | Loading; much of it becomes the cook (packs), not runtime |
| `game/grid` | 1,281 | 6,164 | 10,459 | Grid sim vs map/crossing visuals; heavy split |
| `game/plugin` | 6,202 | 1,039 | 6,017 | The shard plugin runtime; partly on path |
| `engine/ai` | 6,793 | 565 | 596 | **Nearly done** |
| `engine/script` | 3,843 | 1,144 | 301 | **Nearly done** (Wasm shard scripts) |
| `engine/combat` | 1,673 | 1,253 | 2,253 | Half on path |
| `engine/entities` | 1,320 | 226 | 3,104 | Creature bodies mixed with meshes |
| `game/population` | 1,587 | 2,393 | 478 | Mostly clean |
| `game/quest` | 555 | 2,419 | 1,450 | Clean logic, needs wiring |
| `engine/player` | 695 | 640 | 2,999 | `Player.ts` mixes motor, input and view; this is the slice `shared/` needs for prediction |
| `engine/physics` | 1,426 | 1,711 | 490 | Mostly clean |
| `game/boss` | 0 | 819 | 3,091 | **Off path**; `arenaRoom.ts` (1.6k) mixes |
| `game/riding` | 0 | 2,348 | 803 | **Off path** but mostly clean (`physics.ts`, `native*.ts`) |
| `engine/sim` + `sim.ts` | 2,639 | 897 | 0 | **Done**: the sim core |
| `game/shard` | 21 | 1,917 | 198 | Clean |
| `game/weapons` | 0 | 685 | 1,147 | **Off path**; held-weapon files mix |
| `game/loadout` | 0 | 345 | 1,167 | **Off path** |
| `game/compendium` | 0 | 435 | 641 | Off path |
| `game/loot` | 0 | 420 | 651 | Off path |
| `game/grapple` | 0 | 324 | 627 | Off path |
| `game/weather` | 0 | 222 | 536 | Off path |
| `engine/quest` | 165 | 410 | 165 | Small |
| `game/ambient` | 0 | 459 | 251 | Small |
| `engine/level` | 160 | 403 | 106 | Small |
| `game/Elite.ts`, `game/Boss.ts` | 0 | 0 | 947 | Mixed single files |
| `game/bag` | 0 | 96 | 492 | Off path |
| `engine/saves` | 539 | 0 | 10 | **Done** |
| `game/eliteSystem.ts`, `stealth`, `achievements.ts`, `inventoryLaw.ts`, `Inventory.ts`, `combat` | 0 | 782 | 229 | Small |
| `game/ledger.ts`, `engine/events` | 283 | 0 | 0 | **Done** |

## What this means for P1.4

The engine cut is three kinds of work, smallest first:

1. **Cut the 10 imports** above. It's a small, contained job. Afterwards the headless host builds with no renderer
   and no DOM, and the server target exists for the slice it covers today.
2. **Wire the clean browser-only logic into the server tick** (36k). Boss law, riding physics and taming, quests,
   population, loot, weapons decisions. No file needs splitting; each system needs a headless entry point and a
   place in the server tick.
3. **Split the real mixes** (about 14–19k; pass 2 below). Each file gets a sim half and a view half.
4. **Rewrite client loading and sessions around the server** (about 17k in `game/shardfile`, `game/grid`,
   `game/plugin`). These are not split. In the MMO the client session connects to a server rather than running the
   sim, and the cook takes over much of the loading.
5. **Move pure view files to `client/`** (about 11–15k). No change needed.

The movement slice for `shared/` (prediction) is smaller than the 13k guessed earlier:

- `engine/player` and `engine/physics` hold about 2.1k LOC on the server path and 2.4k clean off it;
- the rest is view, touch controls, first-person arms and weapon pickup;
- `Player.ts` (693 LOC) is the key mixed file.

## Pass 2: sorting the 49k mixed lines

The script scores each mixed gameplay file (192 files) on four signals:

- whether gameplay logic or the SDK imports it, which suggests something sim-shaped lives there;
- how dense its sim words are (damage, health, quest, spawn, velocity, physics, loot…);
- how many clean gameplay modules it depends on;
- whether its name sounds like a view (view, hud, held, rig, projection…).

I then read the headers and exports of 19 of the biggest flagged files by hand to calibrate.

| Raw verdict | Files | LOC |
|---|---|---|
| real mix | 111 | 35,185 |
| view-only | 69 | 11,140 |
| unsure | 12 | 2,723 |

**Calibration.** The raw "real mix" count is too high in two ways:

- **Loading and session code** (16.6k of it, in `game/shardfile`, `game/grid` and `game/plugin`) reads as logic but
  is client composition. Examples:
  - `plugin/geometry.ts` is the model library, flagged only because riding and loaders import its model data;
  - `plugin/ui.ts` is the client-script view adapter and quest presentation;
  - `shardfile/worldScenes.ts` is the "client-only scene host";
  - `grid/session.ts` and `grid/liveSession.ts` are the grid client.

  In the MMO these are rewritten so the client session connects to a server, and the cook absorbs most loading. They
  are neither split nor moved.
- **View files with sim words** (about 4k by name and header): `boss/encounterView.ts`, `entities/AnimalView.ts`,
  `ai/view/eliteEntry.ts`, `player/firstPersonArms.ts`, `script/viewProgram.ts`, `boss/roamingProjection.ts`,
  `quest/figures.ts`, `weapons/heldPolearm.ts`, `weapons/heldLauncher.ts`, and `loadout/claims.ts` ("client-only
  held variant").

That leaves **about 14–19k LOC of real sim/view mix** across about 50–60 files. I read the headers and exports of the
biggest ones:

| File | LOC | Verdict from reading |
|---|---|---|
| `game/boss/arenaRoom.ts` | 1,609 | **Real mix.** `arenaRoomBrain`, `arenaRoomFight` and the encounter schema sit beside "client-only arena attachments and deformable floor" |
| `engine/entities/AnimalManager.ts` | 875 | **Real mix.** Wildlife spawning, hits and physics reads, plus blood decals |
| `engine/player/Player.ts` | 693 | **Real mix.** The motor and movement (the prediction slice) beside input and view |
| `game/Elite.ts` | 634 | **Real mix.** The generic named-elite system plus its `GroundTell` visuals |
| `engine/combat/view/ranged.ts` | 440 | **Real mix.** `worldHit` / `impactSurfaceOf` hit queries beside tracers, FOV and viewmodel textures |
| `game/quest/chapter.ts` | 454 | **Real mix.** "A client-only view over a quest", but it also installs quest flags and interactables |
| `engine/physics/ragdoll.ts` | 425 | **Design call.** Physics bodies for dying animals; server-owned or cosmetic client-only |
| `game/boss/openArenaFight.ts` | 567 | **Already split by ports.** "The page passes its views; the Node simulation its own." Moving it is cheap |
| `engine/combat/view/projectile.ts` | 285 | **Already split.** `Projectiles` (flight; damage stays caller-owned) and `ProjectilePresentation` are separate classes |
| `engine/combat/view/SweptMelee.ts` | 622 | **Mostly view.** A swept-contact *view*; contact reactions arrive as ports |
| `engine/combat/view/Bow.ts` | 395 | **Mostly view.** View strategy over supplied ports |
| `game/grapple/tool.ts` | 451 | **Mostly view.** "Client-only presentation; all rules below are native platform traversal" |

Several of the biggest "mixes" turned out to be already separated by ports inside the file, which is cheaper than
the raw score suggests. So expect the low end of 14–19k.

The 12 "unsure" files (2.7k) are mostly grid visuals (`cellClip.ts`, `borderShimmer.ts`, `gridHud.ts`) plus
`entities/AnimalFactory.ts`, `player/Hands.ts` and `riding/reins.ts`. They lean view.

**What that means:** splitting is the smallest of the three big jobs.

| Job | LOC |
|---|---|
| Wire clean browser-only logic into the server tick | 36k |
| Rewrite client loading and sessions around the server | 17k |
| Split real mixes | 14–19k |

A real sim/view split needs a design decision per system (what the server owns, what the client predicts, what is
cosmetic), so it pairs naturally with wiring each system into the server tick: bosses, creatures, combat, grapple,
quests.

## Caveats

- **Pass 2 is a heuristic.** I checked 19 files by hand (headers and exports, not full bodies). The 14–19k range covers the errors found, not a full read.
- **Taint is per file.** One render import marks a whole file, so "mixed" overstates the split work.
- **The DOM check is a regex.** A guard like `typeof window` counts as DOM use. 142 files (23.8k LOC) are tainted by
  DOM alone; some are false positives.
- **Reach follows static and dynamic imports.** Lazy thunks (for example in generated discovery modules) can pull in
  view code the server never calls at runtime.
- **The server roots are today's headless host.** That host covers what SHARD-PLATFORM proved headless, not the whole
  game. Nothing on the "off path" lines is broken. It has simply never run headless.
- **Not counted:** `src/sdk` (21.6k), `src/format` (in `shardfile`), the app root and the shards.
