#!/usr/bin/env node
/**
 * check-models — the model contract's static check (E306 / E315 row M8; the contract is src/client/engine/models/model.ts).
 *
 * FAILS (exit 1) on a broken rule, anywhere:
 *   1. `defineModel(` outside `src/client/engine/models/` and `src/shards/<slug>/models/`
 *   2. a file under `src/shards/<slug>/models/` that defines no model and is not an exact declared model support module
 *   3. a model id not prefixed by its folder: `<slug>/…` in a shard's models, `shared/…` in src/client/engine/models/
 *   4. a shard importing another shard's models (`src/shards/<a>/**` → `shards/<b>/models/`)
 *   5. `src/client/engine/models/` importing a shard (`shards/…`): the contract stays shard-agnostic
 *   6. a file already on the contract (`ON_CONTRACT`) registering a built thing by hand again (a registry `.add({ … })` with
 *      an `object`, found by a balanced scan of the literal: `addsWithObject`)
 *   7. any area (`DONE`: every shard since its wave, the shared code since M6) drawing or registering a thing by hand
 *      outside a models folder — only the files it declares world may, each with its reason and its counts. The old
 *      registrations (`addBuilt`, `registerModel`, `registerSolid`) are gone, and a registry `add` with a `model` is
 *      `place` / `listModel`'s alone (src/client/engine/models/): each counts, and no area declares one. The dev labs were deleted in E357 F7; there is no dev exemption
 *   8. a species rig with no model (E315 M5): every kind a file registers (`registerSpecies({ … kind: '<kind>'` or a string
 *      constant) is some model's species rig — `creature(<kind>…)` (src/client/engine/models/creature.ts) or its `rig: { species }` — so a
 *      new creature can't slip past the Model Explorer
 *   9. a named place with no Set (E315 M12, Jake: "all four shards need to have models and sets"): every place in a
 *      shard's list of named places (`NAMED_PLACES`: Driftwood's DRIFTWOOD_PLACES, Nalati's map POIs = NALATI_PLACES,
 *      Pine Hollow's PINE_HOLLOW_POIS + its quest places, Nine Dragon's NINE_DRAGON_PLACES) is named by some
 *      `placeSet({ … place: '<slug>/<id>' … })` (or a set table's row), and every such `place` names a real place.
 *      Enforced per shard (`PLACES_ENFORCED`) once its pass has registered them; reported for the rest
 * REPORTS each area's declared world (its hand registrations and hand-rolled drawing: `new InstancedMesh` /
 * `BatchedMesh`, `mergeGeometries`, a registry `add` with an `object`), every one held by rule 7 since M6.
 *
 *   node scripts/check-models.mjs            # the report + the rules
 *   node scripts/check-models.mjs --quiet    # the rules only
 * test/model-contract-paths.test.ts runs the rules on the real tree in vitest, so CI's full suite enforces them
 * (TEST-COVERAGE row 11). Test files are fixtures, not shipped code, and are not read.
 */
import { shardFolders } from './shard-folders.mjs';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const primaryFolders = () => shardFolders(ROOT);

/** every .ts under src/, repo-relative with forward slashes */
function sources(dir = join(ROOT, 'src')) {
  const out = [];
  for (const name of readdirSync(dir)) {
    // a workspace package's node_modules links another package's sources (src/commons → @wildshard/sdk): counted once, at home
    if (name === 'node_modules') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...sources(p));
    // TEST-COVERAGE row 11: the contract governs shipped code; a test's fixture draw is not a world thing
    else if (name.endsWith('.ts') && !name.endsWith('.d.ts') && !name.endsWith('.test.ts')) out.push(relative(ROOT, p).split('\\').join('/'));
  }
  return out;
}

/**
 * 6. Files already moved onto the contract never register a built thing by hand again (a `registerSolid` /
 *    `registerModel`, a registry `add` with an `object`, a `model:` flag): they place models. Each wave adds its files
 *    (M3, Nalati: every place; the camps and the roads joined in the second pass, with NalatiPOIs itself; E315).
 */
export const ON_CONTRACT = [
  // e6b43b9aa retired the primary; LD5-LD7 deleted its frozen copy.
];

/**
 * 7. A shard whose migration wave is done draws and registers only through `defineModel` / `place` (E315 M8): outside
 *    its models/ folder, no hand registration and no hand-rolled drawing (the report's counters) except in the files it
 *    declares world — each with why, and how many of what (a declared file that grows one more fails too).
 */
export const DONE = {
  'driftwood-isle': {},
  'nalati-grasslands': {},
  'nine-dragon-stack': {},
  'pine-hollow': {
    // 2d0e3fcb7 removed the primary gun builds.
  },
  // M6: the code every shard shares — systems, effects, gear, the fields that scatter — declared, so a new thing drawn or
  // registered by hand here fails too
  'shared (src/world, src/player, src/entities, …)': {
    'src/client/engine/render/scatterInstances.ts': { why: '2d917c567c: the existing bounded scatter draw moved from Nalati dressing; authored placements and collision remain data', counts: { InstancedMesh: 1 } },
    'src/client/game/ambient/wingField.ts': { why: '2d917c567c: the former two ambient wing draws share one row-owned allocation site; creatures remain model-owned', counts: { InstancedMesh: 1 } },
    'src/client/game/devScene/host.ts': { why: 'SHARD-SOURCE AP5: DEVSERVER-only `wildshard watch` host; it redraws an author\'s three.js parts as the author wrote them, never in a production bundle (check-devserver.mjs)', counts: { InstancedMesh: 1 } },
    'src/client/game/boss/arenaFire.ts': { why: 'f524ad70dc: the existing flame and smoke effect draws moved from stormTitanLook with their original ceiling', counts: { InstancedMesh: 2 } },
    'src/client/game/boss/encounterView.ts': { why: 'Moved from Nalati: a cloud body\'s puffs (one row-sized draw) and an encounter site\'s empty stand-in for a variant no site wears; the sites themselves are placed through place()', counts: { InstancedMesh: 2 } },
    'src/client/game/practice/course.ts': { why: 'The existing riding and grapple practice rooms share one row-owned registration; no shard world content', counts: { 'registry add with object': 1 } },
    'src/client/game/weapons/heldPolearm.ts': { why: '90b6eb13ce: the held spear retains its original single thrown-javelin draw; the empty placeholder allocation is retired', counts: { InstancedMesh: 1 } },
    'src/client/game/shardfile/worldSceneBatch.ts': { why: 'G483: one declared world-scene batch of fixed LOD instances, drawn instanced (E271 / E272: no multi-draw) and registered as one world piece; bounded rows own capacity and material, never shard drawing callbacks. Its `merge: true` copies fold into one geometry at their near LOD', counts: { 'registry add with object': 1, mergeGeometries: 1 } },
    // TEST-COVERAGE row 11: draws the lift imported (1a9fdc62) or added since, declared at their current counts so the
    // real tree holds and the next one fails
    'src/client/engine/player/firstPersonArms.ts': { why: "the player's own first-person arms, merged into one geometry: the player, not a thing in the world", counts: { mergeGeometries: 1 } },
    'src/client/engine/render/graph/glslMaterial.ts': { why: "an instanced mesh's outline hull, mirroring the mesh it outlines: a material effect, never a new world thing", counts: { InstancedMesh: 1 } },
    'src/client/engine/render/lookLight.ts': { why: 'look.light pools of light (85944cce, behind Debug): an effect', counts: { InstancedMesh: 1 } },
    'src/client/engine/render/lookRender.ts': { why: 'meta SHARD-SOURCE M4.8 lamp halos: one additive billboard per declared lamp, an effect', counts: { InstancedMesh: 1 } },
    'src/client/game/ambient/crowdDraw.ts': { why: 'the ambient crowd draw from admitted rows: a population, like the flock in posedInstances', counts: { InstancedMesh: 1 } },
    'src/client/game/ambient/foragerDraw.ts': { why: 'the native forager population, one draw over its owner rows: a population, not placed world', counts: { InstancedMesh: 1 } },
    'src/client/game/loot/CoinMotion.ts': { why: 'loot coins in flight to the player: an effect, like CoinBurst', counts: { InstancedMesh: 1 } },
    'src/client/game/plugin/scene.ts': { why: "a plugin scene's declared instanced nodes, built from admitted scene data; the shard's data owns what is drawn", counts: { InstancedMesh: 1 } },
    'src/client/game/plugin/weaponFamily.ts': { why: "a declared weapon family's held frame merged from primitives: held gear, not a thing in the world", counts: { mergeGeometries: 1 } },
    'src/client/game/population/projection.ts': { why: "a population's projectile volley: an effect", counts: { InstancedMesh: 1 } },
    'src/client/game/quest/figures.ts': { why: "G571: a quest page's placed kit figures, built from admitted kit rows; the still part registers once as world", counts: { 'registry add with object': 1 } },
    'src/client/game/shardfile/sceneInstances.ts': { why: "a shard's admitted instanced scene rows, one draw per row: world drawn from data, like bakedKinds", counts: { InstancedMesh: 1 } },
    'src/client/game/shardfile/skinPlayback.ts': { why: "TE-ENG10: one loaded GLB creature's primitives merged onto its one skeleton, grouped by mapped part; the creature stays its model's, no new world thing", counts: { mergeGeometries: 1 } },
    'src/client/game/shardfile/slabLibrary.ts': { why: "an admitted storage chunk's one-instance draw, kept in the chunk's channel layout: world drawn from data", counts: { InstancedMesh: 1 } },
    'src/client/game/shardfile/clientForestPage.ts': { why: "G571: a forest page's cave lights (the interior's shaft and drips) added as world, without colliders, as Pine's landmarks did", counts: { 'registry add with object': 1 } },
    'src/client/game/weather/forest.ts': { why: 'Weather particles and puddles are effects; the retained instance draw follows the prepared weather rows.', counts: { InstancedMesh: 1 } },
    'src/client/game/shardfile/worldSceneWeld.ts': { why: 'Frozen Z2 instances hydrate declared capacity and matrix rows as Scope-owned native draws; no procedural shard content', counts: { InstancedMesh: 1 } },
    'src/client/game/shardfile/worldScenes.ts': { why: 'G483: declared static scene parts own their collider rows through the resident registry; no procedural shard construction', counts: { 'registry add with object': 1 } },
    // 7def4ee68: same Sky chain / Signal rope instance draw, moved to its host.
    'src/client/game/plugin/ui.ts': { why: '7def4ee68: the existing private-scene instance owner moved from Sky islet chains and Signal well rope; the called model owns the geometry, never a new world thing', counts: { InstancedMesh: 1 } },
    // 3b5ac8c9a: same authored cord merge, moved into the offline curve bake.
    'src/sharddev/bake/glb.ts': { why: '3b5ac8c9a: the offline curve weld for the existing Sky fan tassels, replacing their private cord geometry; no runtime world registration', counts: { mergeGeometries: 1 } },
    // bf05c8c27: same Pine wildlife / Nalati flock instance draw, shared owner.
    'src/client/game/looks/posedInstances.ts': { why: 'bf05c8c27: the existing posed creature instance owner shared by Pine wildlife and the Nalati flock (creatures, M5); geometry and poses stay with their model', counts: { InstancedMesh: 1 } },
    'src/sharddev/sceneGraph.ts': { why: 'DS1.2 authoring-only Node reconstruction of persisted scene data: restores the authored instance matrices for build compilers without a renderer, runtime host or newly placed world thing', counts: { InstancedMesh: 1 } },
    'src/client/engine/render/precompile.ts': { why: 'Compile-only detached shader stand-in borrows the source instance layout and buffers; never placed or drawn as world content', counts: { InstancedMesh: 1 } },
    'src/client/engine/render/calibrationGpu.ts': { why: 'E357 S1.6 synthetic unit-cost scene: temporary calibration geometry, never shard content or a Model Explorer asset', counts: { InstancedMesh: 1 } },
    'src/client/engine/entities/AnimalFactory.ts': { why: "the species rigs' builder: a creature's parts merged per bone (creatures are models, M5: each shard's roster)", counts: { mergeGeometries: 4 } },
    'src/client/engine/fx/Impacts.ts': { why: 'hit sparks and debris: an effect', counts: { InstancedMesh: 1 } },
    'src/client/game/loot/CoinBurst.ts': { why: 'the coins bursting from a kill: an effect', counts: { InstancedMesh: 1 } },
    'src/client/game/cosmetics/bodyShadow.ts': { why: "the player's own shadow-casting body: the player, not a thing in the world", counts: { mergeGeometries: 2 } },
    'src/client/game/systems/items/declaredSword.ts': { why: "SF54: the declared kit.sword item view's private copy of the low-poly sword build (Gear), moved with the declared item families out of the kit; deleted when they graduate", counts: { mergeGeometries: 2 } },
    'src/client/engine/combat/view/projectile.ts': { why: 'bolts and arrows in flight: an effect of the held gear', counts: { InstancedMesh: 1 } },
    'src/client/engine/player/WeaponPickup.ts': { why: "a weapon lying in the world to pick up: its Gear model's display copy", counts: { mergeGeometries: 1 } },
    'src/client/engine/practice/playground/devGrid.ts': { why: "the playgrounds' grid floor (a practice scene, not a shard)", counts: { mergeGeometries: 1 } },
    'src/client/engine/practice/TrainingArena.ts': { why: "the practice room's walls and floor (the arena's world)", counts: { 'registry add with object': 1 } },
    'src/client/engine/practice/TrainingDummy.ts': { why: "the shared training dummy's builder (the model shared/training-dummy, M5: listed on every shard)", counts: { mergeGeometries: 1 } },
    'src/client/game/grid/roadLook.ts': { why: "the grid's boulevard (SF17b, G80 / G81): asphalt, kerbs, streetlights and signs generated along the platform deck's 24 km of road from its layout — world, welded to the deck (no fixed copies for place() to count)", counts: { InstancedMesh: 2 } },
    'src/client/game/grid/voidLook.ts': { why: "the grid's edge (SF17b, G89): the VR void's floor, its rail and the rail's posts round the outer road — world, like the shard's edge in Boundary.ts", counts: { InstancedMesh: 2 } },
    'src/client/engine/world/Boundary.ts': { why: "the shard's edge — cliffs, walls, the sea wall: world, welded to the ground", counts: { mergeGeometries: 6 } },
    'src/client/engine/world/forest/Forest.ts': { why: 'the forest field: a scatter (world, §1); Pine Hollow places its trees as the forest tree model, the other forests are the field', counts: { InstancedMesh: 1, BatchedMesh: 1 } },
    'src/client/engine/world/Grass.ts': { why: 'the grass blades: a shader-drawn field (world, §1)', counts: { InstancedMesh: 2 } },
    'src/client/engine/render/streamedInstances.ts': { why: "G475 streamed cover: the existing twin instance tier draws a scatter field from admitted rows; streamed kinds have no fixed copies for place() to count", counts: { InstancedMesh: 1 } },
    'src/client/game/systems/looks/particles.ts': { why: 'mist and needle fall: an effect', counts: { InstancedMesh: 2 } },
    'src/sharddev/bake/kinds.ts': { why: "SF72: the offline bake folds a shard's code-built world piece into instanced kinds (build time only, never in the client): world", counts: { InstancedMesh: 1 } },
    'src/client/game/shardfile/bakedKinds.ts': { why: "SF72: a shard's baked world piece drawn from its bake, one InstancedMesh per kind on the bake's own transforms (world, like the bake it draws)", counts: { InstancedMesh: 1 } },
    'src/client/engine/world/interact/Interactables.ts': { why: "draws the interactables' copies (models in src/client/engine/models/interact.ts, placed drawnInto its batches)", counts: { BatchedMesh: 2 } },
    'src/client/engine/world/lowpolyKit.ts': { why: "a geometry kit the models' builders share (no thing of its own)", counts: { mergeGeometries: 1 } },
    'src/client/engine/world/geometryKit.ts': { why: "the engine geometry kit's shape builders (a rope's segments merged; no thing of its own)", counts: { mergeGeometries: 1 } },
    'src/client/game/plugin/geometry.ts': { why: "the kit system's merged primitives (SHARD-PLATFORM M3, from Pine Hollow's models/antlerKing.ts, a models file): a worn prop's primitive parts (a lantern frame, a ribcage) merged into one geometry, no thing of its own; and a scatter baked offline drawn as one instanced draw per set (Sky Reach's island dressing): a generator's placed copies, their float32 instance matrices and colours, in the caller's geometry and material", counts: { mergeGeometries: 1, InstancedMesh: 1 } },
  },
};

/**
 * How many registry `.add({ … })` calls in `code` (comments stripped) give the piece an `object` — the key `object:` or
 * the shorthand `object` at the literal's TOP level, however deeply the rest of it nests (E323: a `[^}]*` regex stopped
 * at the first nested `}`, so `.add({ colliders: [{ … }], object })` escaped rules 6 and 7).
 */
export function addsWithObject(code) { return addsWithKey(code, 'object'); }

/** the same for any top-level key of the literal (M6: `model`, a catalog entry — `place` / `listModel`'s alone) */
export function addsWithKey(code, key) {
  const at = new RegExp(`^${key}\\s*[:,}]`);
  let n = 0;
  for (const m of code.matchAll(/\.add\(\s*\{/g)) {
    let depth = 0;
    for (let i = m.index + m[0].length - 1; i < code.length; i++) {
      const c = code[i];
      if (c === "'" || c === '"' || c === '`') { const q = c; for (i++; i < code.length && code[i] !== q; i++) if (code[i] === '\\') i++; continue; }
      if (c === '{' || c === '[' || c === '(') { depth++; continue; }
      if (c === '}' || c === ']' || c === ')') { if (--depth === 0) break; continue; }
      if (depth === 1 && c === key[0] && /[\s,{]/.test(code[i - 1] ?? '') && at.test(code.slice(i, i + key.length + 8))) { n++; break; }
    }
  }
  return n;
}

/** a file's hand registrations and hand-rolled draws (comments stripped): the report's counters */
function countsOf(code) {
  return {
    addBuilt: (code.match(/\baddBuilt\(/g) ?? []).length - (/const addBuilt\s*=/.test(code) ? 1 : 0),
    registerModel: (code.match(/\bregisterModel\(/g) ?? []).length - (/export function registerModel/.test(code) ? 1 : 0),
    registerSolid: (code.match(/\bregisterSolid\(/g) ?? []).length - (/export function registerSolid/.test(code) ? 1 : 0),
    'registry add with object': addsWithObject(code),
    'registry add with model': addsWithKey(code, 'model'),
    InstancedMesh: (code.match(/new (?:THREE\.)?InstancedMesh\(/g) ?? []).length,
    BatchedMesh: (code.match(/new (?:THREE\.)?BatchedMesh\(/g) ?? []).length,
    mergeGeometries: (code.match(/\bmergeGeometries\(/g) ?? []).length,
  };
}

const SHARD_MODELS = /^src\/shards\/([^/]+)\/models\//;
// G463 model-folder moves retain the exact former model contract. Every
// relocation is a literal source entry; no runtime directory gains an exemption.
const MODEL_RELOCATIONS = new Map([
  ['driftwood-isle', 'generators/trailsideModels.ts', 'trailside.ts'],
  ['nalati-grasslands', 'generators/gear.ts', 'gear.ts'],
].map(([slug, source, name]) => [`src/shards/${slug}/${source}`, `src/shards/${slug}/models/${name}`]));
const modelPath = file => MODEL_RELOCATIONS.get(file) ?? MODEL_RELOCATIONS.get(`${file}.ts`) ?? file;
/**
 * TEST-COVERAGE row 11: after the lift (J88) a shard's models arrive as admitted data, and these literal engine hosts
 * define them from it. Each is a literal file with its reason; no directory gains an exemption, and ids keep their rules.
 */
export const DATA_MODEL_HOSTS = {
  'src/client/game/quest/figures.ts': "G571: a quest page's kit figure cards, defined from the admitted kit catalogue",
  'src/client/game/shardfile/forestPage.ts': "a forest page's ground-cover kinds, each defined as a model from the admitted forest field rows",
  'src/client/game/shardfile/sceneDressing.ts': "a shard's dressing models, defined from its admitted scene rows",
};
const SHARD_FILE = /^src\/shards\/([^/]+)\//;
/** Pine Hollow's remaining generic world builders retain their report area after the move. */
const PINE_WORLD = /^src\/(?:client|cook|server|shared)\/engine\/world\/(Cabin|Undergrowth|Props)\.ts$/;

/** which area a file belongs to, for the report */
export function areaOf(file) {
  const m = SHARD_FILE.exec(file);
  if (m) return m[1];
  if (PINE_WORLD.test(file)) return 'pine-hollow';
  if ((file.startsWith('src/client/engine/models/') || file.startsWith('src/client/game/models/'))) return 'models (contract)';
  return 'shared (src/world, src/player, src/entities, …)';
}

/** the import specifiers of a file, resolved repo-relative when they are relative */
function importsOf(file, text) {
  const out = [];
  for (const m of text.matchAll(/(?:import|export)\s[^'"]*?from\s+['"]([^'"]+)['"]/g)) {
    const spec = m[1];
    out.push(spec.startsWith('.') ? relative(ROOT, resolve(ROOT, file, '..', spec)).split('\\').join('/') : spec);
  }
  return out;
}

/**
 * 9. Every named place is a Set (M12). A shard's named places, read from its own list: `file` holds `list`, an array
 *    whose rows carry `id: '…'` (or, `labels`, `label: '…'` slugged the way NALATI_PLACES slugs them). A shard's list
 *    file not in the checked files (a test's partial map) skips that shard. New shards may omit quest/Places.ts;
 *    a declared list is still fully checked, and the original shards' required lists cannot disappear.
 */
/** @type {Record<string, {file:string,list:string,optional?:boolean,labels?:boolean}[]>} */
export const NAMED_PLACES = {
  ...Object.fromEntries(primaryFolders().map((slug) => [slug, [{ file: `src/shards/${slug}/quest/Places.ts`, list: 'PLACES', optional: true }]])),
  'driftwood-isle': [{ file: 'src/shards/driftwood-isle/generators/discovery.ts', list: 'DRIFTWOOD_PLACES' }],
  'nalati-grasslands': [{ file: 'src/shards/nalati-grasslands/generators/layout.ts', list: 'pois', labels: true }], // NALATI_PLACES = NALATI_MAP.pois, slugged (src/shards/nalati-grasslands/data/questStory.ts)
  'pine-hollow': [{ file: 'src/shards/pine-hollow/generators/layout.ts', list: 'PINE_HOLLOW_POIS' }, { file: 'src/shards/pine-hollow/generators/placeSets.ts', list: 'PINE_HOLLOW_QUEST_PLACES', optional: true }],
  'nine-dragon-stack': [{ file: 'src/shards/nine-dragon-stack/generators/places.ts', list: 'NINE_DRAGON_PLACES' }],
};
/** a shard whose source lives in this checkout; engine holds none since the lift (J88), only pinned products */
const hasSource = (slug) => existsSync(join(ROOT, 'src', 'shards', slug));
/** the shards whose every named place must have its set (the rest are reported) */
export const PLACES_ENFORCED = primaryFolders();

/** the text of the array `name` (`name = [` or `name: [`), brackets matched; null when absent */
function arrayText(code, name) {
  const m = new RegExp(`\\b${name}\\b[^=\\n]*=\\s*\\[`).exec(code) ?? new RegExp(`\\b${name}\\s*:\\s*\\[`).exec(code);
  if (!m) return null;
  let depth = 0;
  for (let i = m.index + m[0].length - 1; i < code.length; i++) {
    const c = code[i];
    if (c === "'" || c === '"' || c === '`') { const q = c; for (i++; i < code.length && code[i] !== q; i++) if (code[i] === '\\') i++; continue; }
    if (c === '[') depth++;
    else if (c === ']' && --depth === 0) return code.slice(m.index + m[0].length - 1, i + 1);
  }
  return null;
}

const placeSlug = (s) => s.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-').replaceAll(/^-|-$/g, '');

/** rule 9: each shard's named places, the places some set names, and the gaps */
function namedPlaceSets(texts, whole, strip) {
  const named = new Map(), problems = [];
  for (const [shard, lists] of Object.entries(NAMED_PLACES)) {
    if (whole && !hasSource(shard)) continue; // TEST-COVERAGE row 11: its source and its lists live in its own repo
    const ids = [];
    let read = false;
    for (const l of lists) {
      const text = texts[l.file];
      if (text === undefined) { if (whole && !l.optional) problems.push({ shard, msg: `${l.file}: ${shard}'s list of named places (${l.list}) is missing` }); continue; }
      const arr = arrayText(strip(text), l.list);
      if (arr === null) { problems.push({ shard, msg: `${l.file}: no ${l.list} array — ${shard}'s named places` }); continue; }
      read = true;
      for (const m of arr.matchAll(l.labels ? /\blabel:\s*'([^']+)'/g : /\{\s*id:\s*'([^']+)'/g)) ids.push(l.labels ? placeSlug(m[1]) : m[1]);
    }
    // B83/Z3: no optional list means no named places, not a missing required source.
    // Partial fixture maps still skip absent lists rather than inventing empty declarations.
    if (read || whole && lists.every((l) => l.optional === true)) named.set(shard, ids);
  }
  const setFor = new Map();
  for (const [file, text] of Object.entries(texts)) {
    for (const m of strip(text).matchAll(/\bplace:\s*'(_?[a-z0-9-]+)\/([a-z0-9-]+)'/g)) {
      const [, shard, id] = m;
      const ids = named.get(shard);
      if (ids !== undefined && !ids.includes(id)) problems.push({ shard, msg: `${file}: a set names the place '${shard}/${id}', which is not in ${shard}'s named places` });
      setFor.set(`${shard}/${id}`, file);
    }
  }
  const places = {};
  for (const [shard, ids] of named) {
    const missing = ids.filter((id) => !setFor.has(`${shard}/${id}`));
    places[shard] = { named: ids.length, sets: ids.length - missing.length, missing };
    for (const id of missing) problems.push({ shard, msg: `${shard}: the named place '${id}' has no set — placeSet({ … place: '${shard}/${id}' … }) with the models placed there` });
  }
  return { places, problems };
}

/** Check the tree (or the given { file: text } map): the broken rules, and the not-yet-migrated report. */
export function checkModels(files) {
  const texts = files ?? Object.fromEntries(sources().map((f) => [f, readFileSync(join(ROOT, f), 'utf8')]));
  const violations = [];
  const report = new Map();
  // rule 8: the kinds registered (kind → the file) and the kinds some model is; a kind given as a constant is resolved
  // through the tree's `const NAME = '…'` string constants (the file's own first)
  const strip = (t) => t.replaceAll(/\/\*[\s\S]*?\*\//g, '').replaceAll(/^\s*\/\/.*$/gm, '');
  const constsIn = (code) => new Map([...code.matchAll(/\bconst\s+([A-Z][A-Z0-9_]*)\s*=\s*'([^']+)'/g)].map((m) => [m[1], m[2]]));
  const globalConsts = new Map();
  for (const text of Object.values(texts)) for (const [k, v] of constsIn(strip(text))) if (!globalConsts.has(k)) globalConsts.set(k, v);
  const speciesKinds = new Map(), modelled = new Set();
  for (const [file, text] of Object.entries(texts)) {
    const code = strip(text), own = constsIn(code);
    const value = (lit, name) => lit ?? own.get(name) ?? globalConsts.get(name);
    for (const m of code.matchAll(/\bregisterSpecies\(\{[^}]*?\bkind:\s*(?:'([^']+)'|([A-Z][A-Z0-9_]*)\b)/g)) { const k = value(m[1], m[2]); if (k !== undefined) speciesKinds.set(k, file); }
    if (SHARD_MODELS.test(modelPath(file)) || (file.startsWith('src/client/engine/models/') || file.startsWith('src/client/game/models/'))) for (const m of code.matchAll(/\b(?:creature\(\s*|species:\s*)(?:'([^']+)'|([A-Z][A-Z0-9_]*)\b)/g)) { const k = value(m[1], m[2]); if (k !== undefined) modelled.add(k); }
  }
  for (const [kind, file] of speciesKinds) if (!modelled.has(kind)) violations.push(`${file}: the species '${kind}' is no model — define it in a models folder with creature('${kind}') (src/client/engine/models/creature.ts) and list it in its shard's roster`);
  const bump = (area, key, n) => { if (n === 0) return; const r = report.get(area) ?? {}; r[key] = (r[key] ?? 0) + n; report.set(area, r); };
  for (const [file, text] of Object.entries(texts)) {
    const code = text.replaceAll(/\/\*[\s\S]*?\*\//g, '').replaceAll(/^\s*\/\/.*$/gm, ''); // comments don't count
    const model = modelPath(file);
    const inShardModels = SHARD_MODELS.exec(model), inShared = (file.startsWith('src/client/engine/models/') || file.startsWith('src/client/game/models/'));
    const defines = [...code.matchAll(/define(?:Geometry)?Model(?:<[^(]*>)?\(\s*\{\s*id:\s*'([^']+)'/g)].map((m) => m[1]);
    // The typed geometry/catalogue factories now own these model definitions.
    // Recognize them only inside the existing model contract, not elsewhere.
    const calls = (code.match(/\bdefineModel(?:<[^(]*>)?\(/g) ?? []).length - (/export function defineModel/.test(code) ? 1 : 0)
      + (inShardModels ? (code.match(/\b(?:defineGeometryModel|modelCatalogue|defineSpecimenCatalogue)(?:<[^(]*>)?\(/g) ?? []).length : 0);
    if (calls > 0 && !inShardModels && !inShared && !(file in DATA_MODEL_HOSTS)) violations.push(`${file}: defineModel outside src/client/engine/models/ and src/shards/<slug>/models/`);
    if (inShardModels && calls === 0) violations.push(`${file}: a file in a models folder that defines no model`);
    for (const id of defines) {
      const want = inShardModels ? `${inShardModels[1]}/` : 'shared/';
      if ((inShardModels || inShared) && !id.startsWith(want)) violations.push(`${file}: model id '${id}' must start with '${want}'`);
    }
    const shard = SHARD_FILE.exec(file)?.[1];
    for (const spec of importsOf(file, code)) {
      const target = /(?:^#?|\/)shards\/([^/]+)\/models\//.exec(modelPath(spec))?.[1];
      if (shard !== undefined && target !== undefined && target !== shard) violations.push(`${file}: imports another shard's models (${spec})`);
      if (inShared && /(?:^#?|\/)shards\//.test(spec)) violations.push(`${file}: src/client/engine/models/ imports a shard (${spec})`);
    }
    if (inShared || inShardModels) continue;
    // a shard's generators are build-time only (SHARDS.md: run by the bake, never imported by the runtime, never shipped):
    // what they build reaches the page as baked data, drawn and registered through the model contract there
    if (/^src\/shards\/[^/]+\/generators\//.test(file)) continue;
    if (ON_CONTRACT.includes(file) && (/\bregisterSolid\(|\bregisterModel\(/.test(code) || addsWithObject(code) > 0 || addsWithKey(code, 'model') > 0)) {
      violations.push(`${file}: on the model contract — it places models, it never registers a built thing by hand`);
    }
    const area = areaOf(file);
    const counts = countsOf(code);
    for (const [key, n] of Object.entries(counts)) bump(area, key, n);
    const done = DONE[area];
    if (done !== undefined) {
      const declared = done[file]?.counts ?? {};
      for (const [key, n] of Object.entries(counts)) {
        if (n > (declared[key] ?? 0)) violations.push(`${file}: ${area} is on the model contract (DONE) — ${n} × ${key} here; draw and register things through defineModel / place, or declare the file world in DONE with its reason`);
      }
    }
  }
  const { places, problems } = namedPlaceSets(texts, files === undefined, (t) => t.replaceAll(/\/\*[\s\S]*?\*\//g, '').replaceAll(/^\s*\/\/.*$/gm, ''));
  for (const p of problems) if (PLACES_ENFORCED.includes(p.shard)) violations.push(p.msg);
  return { violations, report: Object.fromEntries([...report].sort(([a], [b]) => a.localeCompare(b))), places, placeProblems: problems.map((p) => p.msg) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { violations, report, places } = checkModels();
  if (!process.argv.includes('--quiet')) {
    console.info('Declared world, per area (M6: every area is held — a new thing drawn or registered by hand fails, rule 7):');
    for (const [area, r] of Object.entries(report)) console.info(`  ${area.padEnd(50)} ${Object.entries(r).map(([k, n]) => `${k} ${n}`).join(' · ')}`);
    console.info('Named places with a set (M12), per shard:');
    for (const [shard, p] of Object.entries(places)) console.info(`  ${shard.padEnd(50)} ${p.sets} / ${p.named}${PLACES_ENFORCED.includes(shard) ? ' (enforced)' : ''}${p.missing.length > 0 ? ` · no set: ${p.missing.join(', ')}` : ''}`);
    for (const shard of Object.keys(NAMED_PLACES)) if (!(shard in places)) console.info(`  ${shard.padEnd(50)} no list of named places yet (${NAMED_PLACES[shard].map((l) => `${l.list} in ${l.file}`).join(', ')})`);
  }
  if (violations.length > 0) {
    console.error(`check-models: ${violations.length} broken rule(s):\n  ${violations.join('\n  ')}`);
    process.exit(1);
  }
  console.info('check-models: the contract holds');
}
