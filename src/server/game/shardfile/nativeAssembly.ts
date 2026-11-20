import { bakedSamplers, parseBakedTerrain } from '@wildshard/engine/world/BakedTerrain';
import { clamp } from '@wildshard/format/noise';
import { readNavmesh } from '@wildshard/engine/physics/navmesh';
import { createSimHost, type SimHost, type SimLevel } from '@wildshard/engine/sim';
import { parseNativeAssembly, NATIVE_ASSEMBLY_FILE, type NativeAssemblyBake, type NativeAssemblyFeature, type NativeAssemblyPlan } from '@wildshard/format/nativeAssembly';
import { decodeTerrainTile, terrainTileHeight } from '@wildshard/format/terrainTileBytes';
import { nativeArenaSealSolids } from '../boss/nativeArenaSeal';
import type { ArenaSealDimensions } from '../../../shared/game/boss/arenaCollision';
import { proveTerrainEntries } from '../plugin/mover';
import { shardLevel } from '../plugin/simulation';
import { createNativeBakeReader, installNativeCollision, nativeBakeGround, type NativeCollisionBake, type NativeCollisionSolid } from '../population/nativeBake';
import { NativePopulationField } from '../population/environment';
import { need, readAssemblyInput, type AssemblyGround, type AssemblyPrepared, type NativeAssemblyContext, type NativeAssemblyPorts } from './nativeAssemblyInput';
import { prepareAssemblyFeature, type AssemblyRun } from './nativeAssemblyHosts';
import { installAssemblySolids, standsOwnSolids } from './assemblySolids';
import { readPatrolIntake } from '../boss/patrolNative';
import { readSlotIntake } from '../boss/slotsNative';
import { readWindIntake } from '../boss/windEliteNative';
import { withEncounters, type EncounterIntake } from '../population/encounterIntake';
import { installNativeHarvest } from '../loot/harvest';
import { PopulationFieldSchema, type PopulationFieldRows } from '@wildshard/format/populationEnvironment';
import { parse } from 'valibot';
import { prepareReturns } from './nativeRuntimeLoans';
import { recordPrimitives } from './hostPrimitives';
import type { ShardFolder } from '../../../shared/game/shardfile/shardFolder';
import { outputDescriptor } from '../../../shared/game/shardfile/outputDescriptor';
import type { Shardfile } from '@wildshard/format/shardSchema';
import { decisionScriptsFromSections } from '@wildshard/format/scriptContract';
import { countedShard } from './declaredSpawnCount';
import { DayCycle, type DayCycleClock } from '@wildshard/engine/world/dayCycle';
import { declaredWaterBody } from '@wildshard/engine/world/water/declared';
import { waveHeight } from '@wildshard/engine/world/waves';
import { TOON_DAY_PRESET } from '@wildshard/format/toonLook';
import { dayClock } from '../../../shared/game/looks/dayClock';
import { declaredDay } from '../../../shared/game/shard/declaredRows';
import { admitRuntimeCreatures, declaredSpawnEntities, installRuntimeCreatures, type keeperOwnership } from './runtimeCreatures';

/** One prepared native world: identical to a typed runtime plan, built from data alone. */
export interface NativeAssemblyRuntime<C extends NativeAssemblyContext> {
  readonly level: SimLevel;
  readonly ports: { readonly ground: false; readonly heightAt: (x: number, z: number) => number };
  readonly install: (host: SimHost, context: C) => void;
  readonly proveEntries: (host: SimHost) => ReturnType<typeof proveTerrainEntries>;
}
const MEADOW_FILE = 'world/meadow.json';
const TAMING_FILE = 'server/taming.json';
/** A world with no population has no bake: no ground lattice and no solids of its own. */
const NO_BAKE: NativeCollisionBake & Readonly<Record<string, unknown>> = { ground: { heights: new Float32Array(0), friction: 0, groups: 0, scale: { x: 0, y: 0, z: 0 }, at: { x: 0, y: 0, z: 0 } }, solids: [] };
/** The bake every population host reads: the reader's rows joined with the plan's owners. Each host admits its fields. */
async function prepareBake(product: ShardFolder, row: NativeAssemblyBake | undefined): Promise<NativeCollisionBake & Readonly<Record<string, unknown>>> {
  if (row === undefined) return NO_BAKE;
  const rows = await readAssemblyInput<Record<string, unknown>>(product, row.rows), ground = { file: row.ground, bytes: await product.file(row.ground) };
  const colliders = await Promise.all(row.colliders.map(async file => ({ file, bytes: await product.file(file) })));
  const reader = createNativeBakeReader(rows, row.reader, ground, colliders);
  const read: NativeCollisionBake = row.read === 'bake' ? reader.read()
    : { ground: nativeBakeGround(rows['ground'] as Parameters<typeof nativeBakeGround>[0], row.reader.resolution, row.reader.size, row.reader.label, ground),
      solids: (rows['solids'] as readonly Parameters<typeof reader.solid>[0][]).map(solid => reader.solid(solid)) };
  const kept = Object.fromEntries((row.keep ?? []).map(name => [name, need(rows[name], `Missing native bake row ${name}`)]));
  const owners = row.owners === undefined ? {} : await readAssemblyInput<Record<string, unknown>>(product, row.owners);
  const picked = row.pick === undefined ? owners : Object.fromEntries(row.pick.map(name => [name, need(owners[name], `Missing native bake owner ${name}`)]));
  const solids: readonly NativeCollisionSolid[] = row.seal === undefined ? read.solids
    : nativeArenaSealSolids(rows, read.solids, await readAssemblyInput<ArenaSealDimensions & { sealId: string; origin: { x: number; y: number; z: number } }>(product, row.seal));
  return { ...kept, ...picked, ...read, solids };
}
async function prepareGround(product: ShardFolder, assets: ReadonlyMap<string, Uint8Array>, plan: NativeAssemblyPlan, bake: NativeCollisionBake): Promise<AssemblyGround> {
  const shard = product.shardfile;
  if (plan.terrain.kind === 'flat') { const { height } = plan.level.ground; return { grid: null, samplers: null, heightAt: () => height }; }
  if (plan.terrain.kind === 'bake-ground') {
    const { resolution, size } = need(plan.bake, 'Bake ground needs its bake').reader, half = size / 2;
    return { grid: null, samplers: null, heightAt: (x: number, z: number): number => terrainTileHeight({ resolution, x: -half, z: -half, size, heights: bake.ground.heights }, x, z, { layout: 'column-major', boundary: 'clamp' }) };
  }
  const grid = plan.terrain.kind === 'baked'
    ? need(parseBakedTerrain(await product.file(plan.terrain.file), plan.terrain.rows as Parameters<typeof parseBakedTerrain>[1]), 'Native assembly requires its baked terrain grid')
    : decodeTerrainTile(need(shard.terrain?.sampling === undefined ? undefined : assets.get(shard.terrain.sampling.file), 'Native assembly requires its terrain tile'), { resolution: plan.terrain.resolution, size: plan.terrain.size, seed: shard.identity.seed });
  const samplers = bakedSamplers(grid);
  return { grid, samplers, heightAt: samplers.heightAt };
}
function fieldScalarFile(row: PopulationFieldRows['world']['pond']): string | undefined {
  return typeof row === 'string' || typeof row.data === 'string' ? undefined : row.data.file;
}
/** The meadow file names the same pond and wet rasters the older plan pointed to. */
async function prepareField(product: ShardFolder, plan: NativeAssemblyPlan, grid: AssemblyGround['grid'], bake: NativeCollisionBake & Readonly<Record<string, unknown>>): Promise<Pick<AssemblyPrepared<never>, 'field' | 'world' | 'pond' | 'wet'>> {
  if (plan.field === undefined && !product.hasFile(MEADOW_FILE)) return { field: null, world: null, pond: null, wet: undefined };
  const rows = parse(PopulationFieldSchema, await readAssemblyInput(product, plan.field?.rows ?? { file: MEADOW_FILE }));
  const { world } = rows;
  const pondFile = need(plan.field?.pond ?? fieldScalarFile(world.pond), 'A declared meadow needs its pond scalar file');
  const pond = { file: pondFile, bytes: await product.file(pondFile) };
  const wetFile = fieldScalarFile(world.wet);
  const wet = wetFile === undefined ? undefined : { file: wetFile, bytes: await product.file(wetFile) };
  return { pond, wet, world, field: new NativePopulationField(need(grid, 'A native field needs its terrain grid'), rows, bake['trees'] as readonly (readonly [number, number, number])[], bake['tops'] as readonly number[], pond, wet) };
}
const mergedIntake = (a: EncounterIntake, ...more: readonly EncounterIntake[]): EncounterIntake => more.reduce((all, row) => ({ species: [...all.species, ...row.species], recipes: [...all.recipes, ...row.recipes], motorless: [...all.motorless ?? [], ...row.motorless ?? []] }), a);
/**
 * OF22b0: what a native assembly's hosts keep beside declared creature rows. Its bodies are its hosts' own (a declared id
 * one of them stands refuses as it spawns, `SimHost.spawn`); its decision rows are every row that binds a body no declared
 * spawn is, which its `decisions` host lends to the bodies that bind them. A row binding both refuses at preparation.
 */
function assemblyKeeper(shard: Shardfile, sections: ReadonlyMap<string, unknown>): ReturnType<typeof keeperOwnership> {
  const declared = new Set(shard.creatures.spawns.map(row => row.id));
  return { actors: new Set(), scripts: new Set(decisionScriptsFromSections(sections).flatMap(row => {
    const ids = Object.values(row.actors); return ids.length === 0 || ids.some(id => !declared.has(id)) ? [row.id] : []; })) };
}
/**
 * OF22a1: the day and the sea a native assembly's plan names no host for, from its sections: the look's toon sky clock
 * (`look/toon` `sky.day` over `sky.cycleSeconds`, as the page's toon sky runs it) else the first `world/days` row; the declared sea row's water
 * (as the `water.sea` host, its swell when the row has `waves`). A plan that still names a `day.*` or `water.*` host keeps it.
 */
function sectionWorld(product: ShardFolder, plan: NativeAssemblyPlan, field: NativePopulationField | null): (host: SimHost) => DayCycleClock | null {
  const shard = product.shardfile, families = new Set(plan.features.map(row => row.host.split('.')[0]));
  const toon = families.has('day') || !product.has('look/toon') ? undefined : product.section('look/toon').sky;
  const days = families.has('day') || toon !== undefined ? undefined : shard.rows.days[0];
  const meadow = families.has('water') || !product.hasFile(MEADOW_FILE) ? null : field;
  const sea = families.has('water') || meadow !== null ? undefined : shard.water.find(row => row.kind === 'sea');
  const body = sea === undefined ? undefined : declaredWaterBody(structuredClone(sea));
  return host => {
    if (meadow !== null) host.useWater({ surfaceAt: meadow.queries.surfaceAt });
    else if (body !== undefined) host.useWater({ surfaceAt: body.restAt, ...(sea?.waves === true ? { bob: (x: number, z: number) => waveHeight(x, z, host.clock.now) } : {}) });
    if (toon !== undefined) { const clock = new DayCycle(dayClock(TOON_DAY_PRESET, toon.day, { dusk: 'dusk' }).spec); clock.cycle = toon.cycleSeconds; return host.useDayClock(clock); }
    return days === undefined ? null : host.useDayClock(declaredDay(days));
  };
}
/** Admit cooked world owners at the same point as their original explicit features. */
function assemblyFeatures(product: ShardFolder, plan: NativeAssemblyPlan): readonly NativeAssemblyFeature[] {
  let features = plan.features;
  const environment = features.findIndex(row => row.host === 'riding.environment');
  const forest = 'world/forest-weather.json';
  const legacy = product.hasFile('server/shelters.json') && product.hasFile('server/weather.json');
  if (environment !== -1 && !features.some(row => row.host === 'weather.native' || row.host === 'weather.program')
    && product.hasFile('world/weather.json') && (legacy || product.hasFile(forest))) {
    // Native storm reactions borrow the environment before groups and the arena use it.
    const weather: NativeAssemblyFeature = { host: 'weather.native', program: { file: 'world/weather.json' },
      shelters: legacy ? { file: 'server/shelters.json' } : { file: forest, path: ['storm', 'shelters'] },
      rows: legacy ? { file: 'server/weather.json' } : { file: forest, path: ['storm', 'world'] } };
    features = [...features.slice(0, environment + 1), weather, ...features.slice(environment + 1)];
  }
  // Taming binds before the elite continuation reads the bonded mount.
  if (!product.hasFile(TAMING_FILE)
    || !features.some(row => row.host === 'riding.mounted')
    || features.some(row => row.host === 'riding.taming')) return features;
  const taming: NativeAssemblyFeature = {
    host: 'riding.taming',
    rows: { file: TAMING_FILE },
    poses: { file: 'sim/taming-poses.json', path: ['poses'] },
    pose: { file: 'actors/species-looks.json', path: ['poses', 'horse'] },
  };
  const at = features.findIndex(row => row.host === 'riding.elites-ready');
  return at === -1 ? [...features, taming] : [...features.slice(0, at), taming, ...features.slice(at)];
}
/** True when this product ships a native-assembly plan. */
export function hasNativeAssembly(product: ShardFolder): boolean { return product.hasFile(NATIVE_ASSEMBLY_FILE); }
/**
 * Build one native world from a product's `server/native-assembly.json` (P1-E3.1b). Every read happens here, so a bad
 * plan refuses before a host exists; `install` is synchronous, in the plan's order, and restores like a typed plan.
 */
export async function prepareNativeAssembly<C extends NativeAssemblyContext>(input: ShardFolder, assets: ReadonlyMap<string, Uint8Array>, ports: NativeAssemblyPorts<C>): Promise<NativeAssemblyRuntime<C>> {
  const preparation = { product: input, assets }, lendReturns = await prepareReturns(preparation);
  const plan = parseNativeAssembly(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await input.file(NATIVE_ASSEMBLY_FILE))));
  const patrol = ports.room === true ? plan.features.find(row => row.host === 'encounter.patrol') : undefined;
  const product = patrol === undefined ? input : await withEncounters(input, mergedIntake(await readPatrolIntake(input, patrol), await readSlotIntake(input, patrol), await readWindIntake(input, patrol.actors)));
  const shard = product.shardfile, bake = await prepareBake(product, plan.bake), ground = await prepareGround(product, assets, plan, bake);
  const navigation = plan.navigation === 'shard' ? assets.get(need(shard.navigation, 'Missing navigation').file) : await product.file(plan.navigation.file);
  const nav = readNavmesh(navigation, 'Native assembly requires its navigation', () => 0);
  const prepared: AssemblyPrepared<C> = { ...ground, ...await prepareField(product, plan, ground.grid, bake), product, assets, ports, plan, bake, nav,
    boot: plan.boot === undefined ? null : await readAssemblyInput(product, plan.boot) };
  const features = assemblyFeatures(product, plan);
  const steps = await Promise.all(features.map(feature => prepareAssemblyFeature(feature, prepared)));
  const species = product.has('actors/species-programs') ? product.section('actors/species-programs') : undefined;
  const harvest = species === undefined ? [] : [...species.native, ...species.program?.species ?? []];
  const heightAt = ground.heightAt, speed = plan.level.authorCap === true ? clamp(shard.authorCaps.speed, 0, plan.level.speed) : plan.level.speed;
  const level = shardLevel(shard, { at: { x: shard.spawn.x, y: Math.max(shard.spawn.y, plan.level.stand ?? heightAt(shard.spawn.x, shard.spawn.z) + 0.1), z: shard.spawn.z }, yaw: shard.spawn.yaw, speed }, plan.level.ground);
  // OF22b0: the declared spawns stand in the native level as in an ordinary upload's, beside the assembly's hosts, and the
  // declared creature host drives them (`installRuntimeCreatures`, as OF19b0 does beside a runtime plan's keeper)
  const counted = countedShard(shard), sections = outputDescriptor(shard)?.sections ?? new Map<string, unknown>(), keeper = assemblyKeeper(counted, sections);
  admitRuntimeCreatures(counted, sections, keeper);
  const summoned = new Set((shard.questHost?.stages ?? []).flatMap(stage => stage.row.stages.flatMap(entry => entry.do.flatMap(action => 'spawn' in action ? [action.spawn] : []))));
  const declaredLevel: SimLevel = { ...level, entities: declaredSpawnEntities(counted) };
  const world = sectionWorld(product, plan, prepared.field);
  // OF22a3: with no collision host the bake lends its ground alone and the shard's prop solids stand beside it
  const ownSolids = standsOwnSolids(plan.features.map(row => row.host));
  const ownGround = ownSolids && plan.bake !== undefined && plan.collision !== undefined ? { bake, resolution: plan.collision.resolution } : null;
  const levelPorts = { ground: false as const, heightAt };
  const hosts = features.map(row => row.host);
  if (prepared.field !== null && product.hasFile(MEADOW_FILE) && !hosts.some(name => name.startsWith('water.'))) hosts.push('water.field');
  const walk = (host: SimHost): ReturnType<typeof proveTerrainEntries> => proveTerrainEntries(host.physics, shard.entryways, heightAt, plan.entries.walk as Parameters<typeof proveTerrainEntries>[3]);
  return { level: declaredLevel, ports: levelPorts, proveEntries: host => {
    const { fresh, proven } = plan.entries;
    if (proven !== undefined) return proven;
    if (fresh === undefined) return walk(host);
    const proof = createSimHost(level, { ...levelPorts, rapier: ports.rapier });
    try { installNativeCollision(proof, bake, { ...need(plan.collision, 'A fresh entry walk needs its collision'), omit: fresh.omit } as Parameters<typeof installNativeCollision>[2]); proof.step(); return walk(proof); } finally { proof.dispose(); }
  }, install: (host, context) => {
    lendReturns(host);
    recordPrimitives(host, shard, hosts); // OF17b1: native features name their families until M8
    const run: AssemblyRun<C> = { host, context, input: null, day: world(host) };
    // OF22a3: the ground and prop solids stand first, where a plan's `collision` host stood, before any host reads them
    if (ownSolids) installAssemblySolids(host, shard, assets, ownGround, context.restoring);
    for (const step of steps) step(run);
    installRuntimeCreatures(host, counted, assets, sections, { restoring: context.restoring, keeper, summoned,
      fact: (name, actor) => { need(run.input, 'A declared decision grant needs the commands host').ledger.fact(name, actor); } });
    installNativeHarvest(host, harvest);
  } };
}
