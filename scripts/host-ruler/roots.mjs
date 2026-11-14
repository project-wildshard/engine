#!/usr/bin/env node
// HOST-RULER HR1 (meta docs/plans/HOST-RULER-PLAN.md): the page and section roots one built product reaches.
// Not a revival of the old census (retired by HR9): its roots walked src/shards/ and pre-J122 paths. A product reaches engine code
// only through what it declares: its `client/plan` kinds and its section names. A kind roots the import() targets of
// its one CLIENT_FEATURES entry (never the whole table); a section roots its row in SECTION_HOSTS. clientPlan.ts's own
// static imports are one shared root, `@client-plan`, reached by every product with a `client/plan`.
// Usage: node scripts/host-ruler/roots.mjs <product-dir>...   (a dir holding shard.json, e.g. shard-x/out/<slug>)
import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { parseSync } from 'vite';

export const ENGINE_ROOT = resolve(import.meta.dirname, '../..');
export const CLIENT_PLAN = 'src/client/game/shardfile/clientPlan.ts';
export const CLIENT_PLAN_ROOT = '@client-plan';

/** Section name -> the host bindings that execute it, side-first (J122). `@wildshard/format/x` resolves through the
 * pinned format package's exports map. An empty row is metadata read by another section's host: it roots nothing.
 * Moved from the old census's section table (old `<layer>/<side>/x` selectors -> `src/<side>/<layer>/x.ts`). Fixed there:
 * `game/server/shardfile/items` -> src/shared/game/shardfile/items.ts; `game/shardfile/directorClient` is gone, its
 * rows run in bindShardfileSim's DirectorStageLane. `client/plan` no longer roots `clientPlan#installClientPhase` (the
 * whole dispatch table, HA0 a) or `declaredEntry#declaredRuntimeEntry` (gone): it roots `@client-plan` and its kinds. */
export const SECTION_HOSTS = Object.freeze({
  'explore/catalogue': ['src/client/game/models/explorerCatalogue.ts#explorerRoster'],
  'collections/displays': ['src/client/game/models/collectionDisplay.ts#CollectionCatalogue'],
  'models/island-library': ['src/client/game/models/islandLibrary.ts#IslandLibrary'],
  'world/trees': ['src/client/game/models/treeSet.ts#productTreeSet', 'src/client/game/shardfile/forestPage.ts#placeForestPageModels'],
  'look/rigged-hulls': ['src/client/game/looks/riggedHulls.ts#productRiggedHulls'],
  'look/hull-book': ['src/client/game/looks/speciesBook.ts#productHullBook'],
  'look/painted': ['src/client/game/looks/paintedLook.ts#productPaintedLook'],
  'look/colour-functions': ['src/client/engine/render/graph/colourFunction.ts#materialColourGraph'],
  'look/toon': ['src/client/game/looks/toonLook.ts#toonLook'],
  'client/plan': [CLIENT_PLAN_ROOT],
  'world/tiles': ['src/client/game/shardfile/clientViews.ts#clientTileViews'],
  'world/terrain': ['src/shared/game/shardfile/clientGround.ts#clientGround'],
  'world/edge': ['src/shared/game/shardfile/portalTraversal.ts#createPortalTraversal'],
  'world/collision': ['src/shared/game/shardfile/collisionBindings.ts#installShardfileColliders'],
  'world/navigation': ['src/client/game/shardfile/productNavigation.ts#installProductNavigation'],
  'world/props': ['src/shared/game/shardfile/props.ts#propColliderDescriptors'],
  'world/water': ['src/client/game/shardfile/clientWater.ts#installClientWater', 'src/client/game/shardfile/water.ts#shardfileWater'],
  'world/movers': ['src/server/game/plugin/mover.ts#createComposedMoverHost', 'src/client/game/shardfile/clientMoverOwners.ts#installClientMoverOwners'],
  'world/traversal': ['src/shared/game/shardfile/portalTraversal.ts#createPortalTraversal'],
  'world/spawn': [], // Level admission metadata.
  'world/physics': [], // Handed to the runtime's explicitly imported native host.
  'world/days': ['src/shared/game/shard/declaredRows.ts#declaredDay'],
  'world/weather': ['src/shared/game/shard/declaredRows.ts#declaredWeather'],
  'look/look': ['src/client/game/shardfile/look.ts#shardfileLook'],
  'look/map': ['src/client/game/shardfile/mapImage.ts#reserveMapImage'],
  'look/materials': ['src/client/game/shardfile/clientMaterials.ts#clientMaterials'],
  'look/keyed-sky': ['src/client/game/looks/keyedSky.ts#keyedSkyBackdrop'],
  'actors/spawn-scripts': ['src/server/game/population/spawnScript.ts#SpawnScript', '@wildshard/format/spawnScripts#parseSpawnScript'],
  'player/stealth': ['src/client/game/stealth/controller.ts#StealthController', '@wildshard/format/stealth#StealthRowsSchema'],
  'view/modules': ['@wildshard/format/scriptContract#ViewModulesSchema', '@wildshard/format/scriptContract#admitScriptContract'],
  'actors/return-scripts': ['src/shared/game/population/returnProgram.ts#ReturnProgram', '@wildshard/format/decisionScripts#parseDecisionScripts'],
  'actors/moves': ['src/server/engine/ai/moves.ts#ActorMoveRunner', '@wildshard/format/actorMoves#parseActorMoves'],
  'actors/creatures': ['src/server/game/shardfile/brainRuntime.ts#installDeclaredBrains'],
  'actors/crowds': ['src/shared/game/shardfile/crowdRuntime.ts#prepareDeclaredCrowds'],
  'actors/npcs': ['src/server/game/plugin/simulation.ts#installDeclaredQuestHost'],
  'actors/species': ['src/server/game/plugin/brain.ts#speciesResolver', 'src/client/game/shardfile/clientRecipes.ts#clientSpeciesLooks'],
  'actors/spawns': ['src/server/game/shardfile/brainRuntime.ts#installDeclaredBrains'],
  'actors/strikes': [], // Consumed by the runtime's explicitly imported creature host.
  'actors/species-programs': [], // Metadata lent to existing page/native species and hunt owners.
  'held/arms': ['src/client/game/loadout/claims.ts#HeldClaims', 'src/client/game/systems/viewmodel/heldView.ts#HeldView'],
  'held/equipment': ['src/client/game/plugin/heldEquipment.ts#HeldEquipment'],
  'held/loadout': ['src/client/game/loadout/held.ts#installHeldLoadout'],
  'held/finishes': ['src/client/game/loadout/finishes.ts#HeldFinishes'],
  'held/gear': ['src/client/game/models/heldGear.ts#heldGear'],
  'combat/items': ['src/shared/game/shardfile/items.ts#installDeclaredItems'],
  'combat/encounters': ['src/server/game/plugin/simulation.ts#createShardfileSim'],
  'combat/strikes': ['src/server/game/plugin/simulation.ts#createShardfileSim'],
  'quests/quests': ['src/shared/game/quest/declared.ts#DeclaredQuests'],
  'quests/host': ['src/server/game/plugin/simulation.ts#installDeclaredQuestHost'],
  'quests/directors': ['src/shared/game/plugin/director.ts#DirectorStageLane'],
  'economy/ledger': ['src/shared/game/ledger.ts#Ledger', 'src/shared/game/ledger.ts#installLedgerEmitter'],
  'economy/loot': ['src/shared/game/shard/declaredRows.ts#declaredLootPresentation'],
  'state/state': ['src/server/game/shardfile/scripts.ts#numericScriptState'],
  'state/migrations': ['src/shared/game/shardfile/logicalState.ts#logicalStateFromLane'],
  'state/modes': ['src/shared/engine/player/modes.ts#playerModes'],
  'sim/runtime-plan': ['src/server/game/shardfile/nativePlan.ts#prepareProductRuntimePlan'],
  'world/scenes': ['src/client/game/shardfile/worldScenes.ts#installWorldScenes'],
  'world/targets': ['src/shared/game/shardfile/worldTargets.ts#WorldTargetHost'],
  'sim/scripts': ['src/server/engine/script/decision.ts#DecisionHost', '@wildshard/format/decisionScripts#parseDecisionScripts'],
  'sim/bodies': ['src/server/game/quest/bodyOps.ts#DeclaredBodyOps', '@wildshard/format/bodySlots#DeclaredBodyOpsSchema'],
  'sim/sim': ['src/server/game/shardfile/scripts.ts#createShardfileScriptLane'],
  'sim/hooks': ['src/server/game/shardfile/scripts.ts#createShardfileScriptLane'],
  'sim/client-scripts': ['src/client/game/shardfile/clientScripts.ts#createShardfileClientScripts'],
  'sim/client-channels': ['src/client/game/plugin/ui.ts#ClientScriptViews'],
  'sim/plumbing': ['src/client/game/shard/declaredPlumbing.ts#installDeclaredPlumbing'],
  'audio/audio': ['src/client/engine/audio/declared.ts#installDeclaredAudio'],
  'ui/card': [], // Discovery metadata; no per-shard executable implementation.
  'ui/level': [],
  'ui/ui': ['src/client/game/shard/declaredUi.ts#mountDeclaredUi', 'src/client/game/shard/declaredTargets.ts#installDeclaredTargets'],
  'ui/compendium': ['src/shared/game/shard/declaredRows.ts#declaredProductCompendium'],
  'ui/completion': ['src/client/game/complete/declared.ts#installCompletion'],
  'ui/strings': [], // Read by an explicitly imported consumer, not executed.
});

const json = (/** @type {string} */ path) => JSON.parse(readFileSync(path, 'utf8'));
const packages = new Map();
/** @param {string} root @param {string} name */
function packageExports(root, name) {
  const key = `${root}\0${name}`;
  if (!packages.has(key)) {
    const dir = name === '@wildshard/engine' ? root : join(root, 'node_modules', name);
    const manifest = json(join(dir, 'package.json'));
    packages.set(key, { dir, exports: manifest.exports ?? {} });
  }
  return packages.get(key);
}

/** Resolve one import specifier to a module id: an engine module as its repo path (`src/...ts`), a format module as
 * `@wildshard/format/<package path>` through the pinned package's exports map, any other bare package as `npm:<name>`.
 * @param {string} specifier @param {string} from repo path of the importing file @param {string} [root] */
export function resolveModule(specifier, from, root = ENGINE_ROOT) {
  if (specifier.startsWith('.')) {
    const base = resolve(root, dirname(from), specifier);
    for (const candidate of [base, `${base}.ts`, `${base}.tsx`, `${base}.mts`, join(base, 'index.ts')]) {
      if (/\.[cm]?[jt]sx?$/u.test(candidate) && existsSync(candidate)) return relative(root, candidate);
    }
    throw new Error(`Unresolved import ${specifier} from ${from}`);
  }
  for (const name of ['@wildshard/engine', '@wildshard/format']) {
    if (!specifier.startsWith(`${name}/`)) continue;
    const { exports } = packageExports(root, name), target = exports[`./${specifier.slice(name.length + 1)}`];
    if (typeof target !== 'string') throw new Error(`Unresolved import ${specifier} from ${from}: not in ${name} exports`);
    const path = target.replace(/^\.\//u, '');
    return name === '@wildshard/engine' ? path : `${name}/${path}`;
  }
  const bare = specifier.split('/').slice(0, specifier.startsWith('@') ? 2 : 1).join('/');
  return `npm:${bare}`;
}

/** @param {any} node @param {(node:any, parent:any)=>void} visit @param {any} [parent] */
function walk(node, visit, parent = null) {
  if (node === null || typeof node !== 'object') return;
  if (Array.isArray(node)) { for (const child of node) walk(child, visit, parent); return; }
  if (typeof node.type !== 'string') return;
  visit(node, parent);
  for (const [key, value] of Object.entries(node)) if (key !== 'parent' && value !== null && typeof value === 'object') walk(value, visit, node);
}
const unwrap = (/** @type {any} */ node) => {
  let inner = node;
  while (inner?.type === 'ParenthesizedExpression' || inner?.type === 'TSAsExpression' || inner?.type === 'TSNonNullExpression') inner = inner.expression;
  return inner;
};
const keyName = (/** @type {any} */ key) => key.type === 'Identifier' ? key.name : key.type === 'Literal' ? String(key.value) : null;
/** @param {any} pattern */
const patternNames = pattern => {
  if (pattern?.type !== 'ObjectPattern') return null;
  const names = pattern.properties.map((/** @type {any} */ p) => p.type === 'Property' && !p.computed ? keyName(p.key) : null);
  return names.includes(null) ? null : names;
};

/** Read clientPlan.ts statically: its static imports (the shared `@client-plan` root) and, per CLIENT_FEATURES kind,
 * the import() targets of that entry with the bindings it takes. Three shapes are read:
 * `member`  `(await import('x')).Y` (the loadFeature form),
 * `destructure`  `const { a, b } = await import('x')`,
 * `all`  `const [{ a }, { b }] = await Promise.all([import('x'), import('y')])`.
 * Any other import() shape, or an import() outside CLIENT_FEATURES, refuses.
 * @param {string} [root] */
export function clientPlanRoots(root = ENGINE_ROOT) {
  const source = readFileSync(join(root, CLIENT_PLAN), 'utf8');
  const parsed = parseSync(CLIENT_PLAN, source);
  if (parsed.errors.length > 0) throw new Error(`${CLIENT_PLAN}: parse errors`);
  const shared = parsed.module.staticImports.map((/** @type {any} */ row) => ({
    specifier: row.moduleRequest.value,
    module: resolveModule(row.moduleRequest.value, CLIENT_PLAN, root),
    // Type names never run: a mixed import keeps only its value bindings, and a type-only import roots nothing.
    bindings: row.entries.filter((/** @type {any} */ e) => !e.isType).map((/** @type {any} */ e) => e.importName.kind === 'Name' ? e.importName.name : e.importName.kind === 'Default' ? 'default' : '*').sort(),
    typeOnly: row.entries.length > 0 && row.entries.every((/** @type {any} */ e) => e.isType),
  }));
  /** @type {any} */
  let table = null;
  walk(parsed.program, node => {
    if (node.type === 'VariableDeclarator' && node.id.type === 'Identifier' && node.id.name === 'CLIENT_FEATURES') table = unwrap(node.init);
  });
  if (table?.type !== 'ObjectExpression') throw new Error(`${CLIENT_PLAN}: CLIENT_FEATURES is not an object literal`);
  /** @type {Map<string, Map<string, Set<string>>>} */
  const kinds = new Map();
  const shapes = { member: 0, destructure: 0, all: 0 };
  /** @type {Map<string, Set<'member'|'destructure'|'all'>>} */
  const kindShapes = new Map();
  const inside = new Set();
  for (const property of table.properties) {
    const kind = property.type === 'Property' && !property.computed ? keyName(property.key) : null;
    if (kind === null) throw new Error(`${CLIENT_PLAN}: CLIENT_FEATURES has a non-literal key`);
    /** @type {Map<string, Set<string>>} */
    const targets = new Map(), used = new Set();
    kindShapes.set(kind, used);
    walk(property.value, (node, parent) => {
      node.parent = parent;
      if (node.type !== 'ImportExpression') return;
      inside.add(node.start);
      if (node.source.type !== 'Literal' || typeof node.source.value !== 'string') throw new Error(`${CLIENT_PLAN}: ${kind} has a non-literal import()`);
      const specifier = node.source.value, at = `${kind} import('${specifier}')`;
      /** @type {string[] | null} */
      let names = null;
      let up = node.parent;
      while (up?.type === 'ParenthesizedExpression') up = up.parent;
      if (up?.type === 'AwaitExpression') {
        let user = up.parent;
        while (user?.type === 'ParenthesizedExpression') user = user.parent;
        if (user?.type === 'MemberExpression' && unwrap(user.object) === up && !user.computed) { names = [user.property.name]; shapes.member++; used.add('member'); }
        else if (user?.type === 'VariableDeclarator' && unwrap(user.init) === up) { names = patternNames(user.id); if (names !== null) { shapes.destructure++; used.add('destructure'); } }
      } else if (up?.type === 'ArrayExpression') {
        const call = up.parent, awaited = call?.parent, declarator = awaited?.parent;
        const callee = call?.type === 'CallExpression' ? call.callee : null;
        if (callee?.type === 'MemberExpression' && callee.object.name === 'Promise' && callee.property.name === 'all' && awaited?.type === 'AwaitExpression'
          && declarator?.type === 'VariableDeclarator' && declarator.id.type === 'ArrayPattern') {
          names = patternNames(declarator.id.elements[up.elements.indexOf(node)]);
          if (names !== null) { shapes.all++; used.add('all'); }
        }
      }
      if (names === null || names.length === 0) throw new Error(`${CLIENT_PLAN}: unread import() shape at ${at}`);
      const module = resolveModule(specifier, CLIENT_PLAN, root);
      const bindings = targets.get(module) ?? new Set();
      for (const name of names) bindings.add(name);
      targets.set(module, bindings);
    });
    kinds.set(kind, targets);
  }
  const outside = parsed.module.dynamicImports.filter((/** @type {any} */ row) => !inside.has(row.start));
  if (outside.length > 0) throw new Error(`${CLIENT_PLAN}: ${outside.length} import() outside CLIENT_FEATURES`);
  return {
    shared,
    kinds: new Map([...kinds].map(([kind, targets]) => [kind, [...targets].map(([module, names]) => ({ module, bindings: [...names].sort() })).sort((a, b) => a.module.localeCompare(b.module))])),
    kindShapes: new Map([...kindShapes].map(([kind, used]) => [kind, [...used].sort()])),
    shapes,
    dynamicImports: parsed.module.dynamicImports.length,
  };
}

/** @param {string} selector */
const hostRow = selector => {
  const [module, binding] = selector.split('#');
  return { module: module.startsWith('@wildshard/') ? resolveModule(module, CLIENT_PLAN) : module, binding };
};

/** The roots one product reaches, from its parsed shard.json and client plan. An unknown kind or section refuses.
 * @param {{ slug: string, sections: readonly string[], kinds: readonly string[] }} product
 * @param {ReturnType<typeof clientPlanRoots>} [plan] */
export function productRootsFrom(product, plan = clientPlanRoots()) {
  /** @type {{ from: string, module: string, bindings: string[] }[]} */
  const roots = [];
  if (product.kinds.length > 0 && !product.sections.includes('client/plan')) throw new Error(`${product.slug}: client plan kinds without a client/plan section`);
  for (const name of product.sections) {
    if (!Object.hasOwn(SECTION_HOSTS, name)) throw new Error(`${product.slug}: unknown section ${name}`);
    /** @type {Map<string, Set<string>>} */
    const byModule = new Map();
    for (const selector of /** @type {Record<string, string[]>} */ (SECTION_HOSTS)[name]) {
      if (selector === CLIENT_PLAN_ROOT) {
        for (const row of plan.shared) if (!row.typeOnly) roots.push({ from: CLIENT_PLAN_ROOT, module: row.module, bindings: row.bindings });
        continue;
      }
      const { module, binding } = hostRow(selector);
      byModule.set(module, (byModule.get(module) ?? new Set()).add(binding));
    }
    for (const [module, names] of byModule) roots.push({ from: `section:${name}`, module, bindings: [...names].sort() });
  }
  for (const kind of new Set(product.kinds)) {
    const targets = plan.kinds.get(kind);
    if (targets === undefined) throw new Error(`${product.slug}: unknown client/plan kind ${kind}`);
    for (const target of targets) roots.push({ from: `kind:${kind}`, ...target });
  }
  /** @type {Map<string, Set<string>>} */
  const modules = new Map();
  for (const root of roots) {
    const names = modules.get(root.module) ?? new Set();
    for (const name of root.bindings) names.add(name);
    modules.set(root.module, names);
  }
  return { slug: product.slug, sections: [...product.sections], kinds: [...new Set(product.kinds)], roots,
    modules: [...modules].map(([module, names]) => ({ module, bindings: [...names].sort() })).sort((a, b) => a.module.localeCompare(b.module)) };
}

/** The file behind a module id, or null for an npm package.
 * @param {string} module @param {string} [root] */
export function modulePath(module, root = ENGINE_ROOT) {
  if (module.startsWith('npm:')) return null;
  return module.startsWith('@wildshard/format/') ? join(root, 'node_modules', module) : join(root, module);
}
/** @param {string} module @param {string} root @param {Set<string>} [seen] @returns {Set<string>} */
function exportedNames(module, root, seen = new Set()) {
  const names = new Set(), path = modulePath(module, root);
  if (path === null || seen.has(module)) return names;
  seen.add(module);
  const parsed = parseSync(path, readFileSync(path, 'utf8'));
  for (const row of parsed.module.staticExports) for (const entry of row.entries) {
    if (entry.exportName.kind === 'Name') names.add(entry.exportName.name);
    else if (entry.exportName.kind === 'Default') names.add('default');
    else if (entry.moduleRequest !== null && entry.importName.kind === 'AllButDefault') {
      const from = module.startsWith('@wildshard/format/') ? relative(root, path) : module;
      for (const name of exportedNames(resolveModule(entry.moduleRequest.value, from, root), root, seen)) names.add(name);
    }
  }
  return names;
}
/** Every root that names a missing module or a binding its module does not export, as `module#binding` strings.
 * @param {readonly { module: string, bindings: readonly string[] }[]} rows @param {string} [root] */
export function unresolvedRoots(rows, root = ENGINE_ROOT) {
  const missing = [];
  for (const { module, bindings } of rows) {
    const path = modulePath(module, root);
    if (path === null) continue;
    if (!existsSync(path)) { missing.push(module); continue; }
    const names = exportedNames(module, root);
    for (const name of bindings) if (name !== '*' && !names.has(name)) missing.push(`${module}#${name}`);
  }
  return missing;
}
/** Every SECTION_HOSTS row as a root, for checking the table itself. */
export const sectionHostRows = () => Object.values(SECTION_HOSTS).flat().filter(selector => selector !== CLIENT_PLAN_ROOT).map(selector => {
  const { module, binding } = hostRow(selector);
  return { module, bindings: [binding] };
});

/** Read a built product dir (`shard.json`, its `client/plan` section file) and list its roots.
 * @param {string} dir @param {ReturnType<typeof clientPlanRoots>} [plan] */
export function productRoots(dir, plan = clientPlanRoots()) {
  const shard = json(join(dir, 'shard.json'));
  if (!Array.isArray(shard.sections)) throw new Error(`${dir}: shard.json has no sections list`);
  const sections = shard.sections.map((/** @type {any} */ row) => row.name);
  const planRow = shard.sections.find((/** @type {any} */ row) => row.name === 'client/plan');
  const kinds = planRow === undefined ? [] : json(join(dir, planRow.path)).features.map((/** @type {any} */ row) => row.kind);
  const slug = typeof shard.identity?.slug === 'string' ? shard.identity.slug : basename(resolve(dir));
  return productRootsFrom({ slug, sections, kinds }, plan);
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === import.meta.filename) {
  const dirs = process.argv.slice(2);
  if (dirs.length === 0) { console.error('usage: node scripts/host-ruler/roots.mjs <product-dir>...'); process.exit(2); }
  const plan = clientPlanRoots();
  console.log(JSON.stringify(dirs.map(dir => productRoots(dir, plan)), null, 2));
}
