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
import { PopulationFieldSchema, type PopulationFieldRows } from '@wildshard/format/populationEnvironment';
import { parse } from 'valibot';
import { NativePopulationField } from '../population/environment';
import { need, readAssemblyInput, type AssemblyGround, type AssemblyPrepared, type NativeAssemblyContext, type NativeAssemblyPorts } from './nativeAssemblyInput';
import { declaredWakeFight, HELD_HOSTS, prepareAssemblyFeature, prepareSectionMelee, prepareSectionRanged, SPRINT_SPEED, type AssemblyRun } from './nativeAssemblyHosts';
import { parseHeldSlots } from '@wildshard/format/heldArms';
import { parseChapterWake } from '@wildshard/format/chapterDirector';
import { NativeBossBindingSchema } from '@wildshard/format/bossEncounter';
import { declaredHarvest } from '../population/declaredNative';
import { installAssemblySolids, standsOwnSolids } from './assemblySolids';
import { declaredBootSpawns } from '../riding/nativePopulation';
import { readPatrolIntake } from '../boss/patrolNative';
import { readSlotIntake } from '../boss/slotsNative';
import { readWindIntake } from '../boss/windEliteNative';
import { withEncounters, type EncounterIntake } from '../population/encounterIntake';
import { installNativeHarvest } from '../loot/harvest';
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
import { keyedSkyDaySpec } from '../../../shared/game/looks/keyedSkyClock';
import { declaredDay } from '../../../shared/game/shard/declaredRows';
import { admitRuntimeCreatures, declaredSpawnEntities, installRuntimeCreatures, type keeperOwnership } from './runtimeCreatures';

/** One prepared native world: identical to a typed runtime plan, built from data alone. */
export interface NativeAssemblyRuntime<C extends NativeAssemblyContext> {
  readonly level: SimLevel;
  readonly ports: { readonly ground: false; readonly heightAt: (x: number, z: number) => number };
  readonly install: (host: SimHost, context: C) => void;
  readonly proveEntries: (host: SimHost) => ReturnType<typeof proveTerrainEntries>;
}
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
const MEADOW_FILE = 'world/meadow.json';
const TAMING_FILE = 'server/taming.json';

function fieldScalarFile(row: PopulationFieldRows['world']['pond']): string | undefined {
  return typeof row === 'string' || typeof row.data === 'string' ? undefined : row.data.file;
}

async function prepareField(product: ShardFolder, plan: NativeAssemblyPlan, grid: AssemblyGround['grid'], bake: NativeCollisionBake & Readonly<Record<string, unknown>>, meadow: boolean): Promise<Pick<AssemblyPrepared<never>, 'field' | 'world' | 'pond' | 'wet'>> {
  if (plan.field === undefined && !meadow) return { field: null, world: null, pond: null, wet: undefined };
  const rows = parse(PopulationFieldSchema, await readAssemblyInput(product, plan.field?.rows ?? { file: MEADOW_FILE }));
  const { world } = rows;
  const pondFile = need(plan.field?.pond ?? fieldScalarFile(world.pond), 'A declared meadow needs its pond scalar file');
  const pond = { file: pondFile, bytes: await product.file(pondFile) };
  const wetFile = fieldScalarFile(world.wet);
  const wet = wetFile === undefined ? undefined : { file: wetFile, bytes: await product.file(wetFile) };
  return { pond, wet, world, field: new NativePopulationField(need(grid, 'A native field needs its terrain grid'), rows,
    bake['trees'] as readonly (readonly [number, number, number])[], bake['tops'] as readonly number[], pond, wet) };
}
const mergedIntake = (a: EncounterIntake, ...more: readonly EncounterIntake[]): EncounterIntake => more.reduce((all, row) => ({ species: [...all.species, ...row.species], recipes: [...all.recipes, ...row.recipes], motorless: [...all.motorless ?? [], ...row.motorless ?? []] }), a);
/**
 * OF22b0: what a native assembly's hosts keep beside declared creature rows. Its bodies are its hosts' own (a declared id
 * one of them stands refuses as it spawns, `SimHost.spawn`); its decision rows are every row that binds a body no declared
 * spawn is, which its `decisions` host lends to the bodies that bind them. A row binding both refuses at preparation.
 */
function assemblyKeeper(shard: Shardfile, sections: ReadonlyMap<string, unknown>, brained: ReadonlySet<string>): ReturnType<typeof keeperOwnership> {
  const declared = new Set(shard.creatures.spawns.map(row => row.id));
  return { actors: new Set(), scripts: new Set(decisionScriptsFromSections(sections).flatMap(row => {
    const ids = Object.values(row.actors); return ids.length === 0 || ids.some(id => !declared.has(id)) || brained.has(row.id) ? [row.id] : []; })) };
}
/** OF23d, OF30: a ground boss's decision rides its binding (its declared body binds it), so the keeper keeps that row even
 *  when every actor it binds is a declared spawn. */
function declaredBossScripts(plan: NativeAssemblyPlan): ReadonlySet<string> {
  return new Set(plan.features.flatMap(row => {
    if (row.host !== 'boss.ground') return [];
    const binding = parse(NativeBossBindingSchema, row.binding);
    return binding.decision === undefined ? [] : [binding.decision.script];
  }));
}
/**
 * OF22a1: the day and the sea a native assembly's plan names no host for, from its sections: the look's toon sky clock
 * (`look/toon` `sky.day` over `sky.cycleSeconds`, as the page's toon sky runs it), else the keyed sky's clock (`look/keyed-sky`, as
 * the `day.keyed-sky` host, OF23e2), else the first `world/days` row, else (FORMAT-PRUNE FP16d) the forest weather's sky clock
 * (`world/forest-weather.json` `sky.clock`, as Nalati's `day.declared` host read it); the declared sea row's water
 * (as the `water.sea` host, its swell when the row has `waves`). A plan that still names a `day.*` or `water.*` host keeps it.
 */
function sectionWorld(product: ShardFolder, plan: NativeAssemblyPlan, field: NativePopulationField | null, forest: DayCycleSpec | undefined): (host: SimHost) => DayCycleClock | null {
  const shard = product.shardfile, families = new Set(plan.features.map(row => row.host.split('.')[0]));
  const toon = families.has('day') || !product.has('look/toon') ? undefined : product.section('look/toon').sky;
  const keyed = families.has('day') || toon !== undefined || !product.has('look/keyed-sky') ? undefined : keyedSkyDaySpec(product.section('look/keyed-sky'));
  const days = families.has('day') || toon !== undefined || keyed !== undefined ? undefined : shard.rows.days[0];
  const meadow = families.has('water') ? null : field;
  const sea = families.has('water') || meadow !== null ? undefined : shard.water.find(row => row.kind === 'sea');
  const body = sea === undefined ? undefined : declaredWaterBody(structuredClone(sea));
  return host => {
    if (meadow !== null) host.useWater({ surfaceAt: meadow.queries.surfaceAt });
    else if (body !== undefined) host.useWater({ surfaceAt: body.restAt, ...(sea?.waves === true ? { bob: (x: number, z: number) => waveHeight(x, z, host.clock.now) } : {}) });
    if (toon !== undefined) { const clock = new DayCycle(dayClock(TOON_DAY_PRESET, toon.day, { dusk: 'dusk' }).spec); clock.cycle = toon.cycleSeconds; return host.useDayClock(clock); }
    if (keyed !== undefined) return host.useDayClock(new DayCycle(keyed));
    if (days !== undefined) return host.useDayClock(declaredDay(days));
    return forest === undefined || families.has('day') ? null : host.useDayClock(new DayCycle(forest));
  };
}
type DayCycleSpec = ConstructorParameters<typeof DayCycle>[0];
/** FORMAT-PRUNE FP16d: the forest weather's sky clock, the day a plan with no `day.*` host stands when no look or day row names one. */
const FOREST_WEATHER = 'world/forest-weather.json';
async function forestClock(product: ShardFolder): Promise<DayCycleSpec | undefined> {
  if (!product.hasFile(FOREST_WEATHER)) return undefined;
  const weather = await readAssemblyInput<{ readonly sky?: { readonly clock?: DayCycleSpec } }>(product, { file: FOREST_WEATHER });
  return weather.sky?.clock;
}
/** The cooked weather files choose the storm owner after its native environment exists. */
function withSectionWeather(product: ShardFolder, features: readonly NativeAssemblyFeature[]): readonly NativeAssemblyFeature[] {
  const environment = features.findIndex(row => row.host === 'riding.environment');
  if (environment === -1 || features.some(row => row.host === 'weather.native' || row.host === 'weather.program')
    || !product.hasFile('world/weather.json')) return features;
  const forest = 'world/forest-weather.json';
  const legacy = product.hasFile('server/shelters.json') && product.hasFile('server/weather.json');
  if (!legacy && !product.hasFile(forest)) return features;
  const weather: NativeAssemblyFeature = { host: 'weather.native', program: { file: 'world/weather.json' },
    shelters: legacy ? { file: 'server/shelters.json' } : { file: forest, path: ['storm', 'shelters'] },
    rows: legacy ? { file: 'server/weather.json' } : { file: forest, path: ['storm', 'world'] } };
  return [...features.slice(0, environment + 1), weather, ...features.slice(environment + 1)];
}
/** OF23e3: a `world/weather` row that names its program runs as the `weather.program` host would, when the plan names no
 *  `weather.*` host: before the first population host (shelter reads the weather), else last. */
function withProgramWeather(shard: ShardFolder['shardfile'], features: readonly NativeAssemblyFeature[]): readonly NativeAssemblyFeature[] {
  const programs = shard.rows.weather.flatMap(row => 'program' in row ? [row.program] : []);
  if (programs.length === 0 || features.some(row => row.host.startsWith('weather.'))) return features;
  if (programs.length > 1) throw new Error('A native assembly runs one weather program');
  const weather: NativeAssemblyFeature = { host: 'weather.program', program: { file: programs[0] ?? '' } };
  const at = features.findIndex(row => row.host.startsWith('population.'));
  return at === -1 ? [...features, weather] : [...features.slice(0, at), weather, ...features.slice(at)];
}
/** OF29e1: where a plan with no population host finds the family's declared files (Pine's names). */
const POPULATION_FILES = { environment: 'server/habitat.json', shelter: 'actors/shelter.json', roster: 'actors/roster.json', elites: 'actors/elites.json' } as const;
/** ONE-FORMAT OF29e1: a native plan stands the population family from the product's declared files, in the hosts' own order
 *  (Pine r10's plan): environment, shelter, roster, elites, each spawn script no elite fight owns (the night director), then
 *  elites ready. The roster gates it. OF29e3 (J486): no writer names a `population.*` host since Pine r11 and Nalati r6.
 *  SHARD-COMPAT CP16 (kept originals admit as stored): a plan that still names them (Pine r5, r6 and r10, kept and Pine r5
 *  prod's head) runs its own rows as written, as before OF29e3; OF29e1 proved them tick for tick the derived family. */
export async function withSectionPopulation(product: ShardFolder, features: readonly NativeAssemblyFeature[]): Promise<readonly NativeAssemblyFeature[]> {
  if (features.some(row => row.host.startsWith('population.'))) return features;
  if (!product.hasFile(POPULATION_FILES.roster)) return features;
  const family: NativeAssemblyFeature[] = [];
  if (product.hasFile(POPULATION_FILES.environment)) family.push({ host: 'population.environment', rows: { file: POPULATION_FILES.environment } });
  if (product.hasFile(POPULATION_FILES.shelter)) family.push({ host: 'population.shelter', rows: { file: POPULATION_FILES.shelter } });
  family.push({ host: 'population.roster', rows: { file: POPULATION_FILES.roster } });
  const elites = product.hasFile(POPULATION_FILES.elites);
  const owned = new Set<string>();
  if (elites) {
    family.push({ host: 'population.elites', file: POPULATION_FILES.elites });
    const rows = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await product.file(POPULATION_FILES.elites))) as { fights?: { program?: { step?: unknown } }[] };
    for (const fight of rows.fights ?? []) if (typeof fight.program?.step === 'string') owned.add(fight.program.step);
  }
  const scripts = product.has('actors/spawn-scripts') ? product.section('actors/spawn-scripts') as readonly { readonly step: string }[] : [];
  for (const row of scripts) if (!owned.has(row.step)) family.push({ host: 'population.spawn-script', id: row.step });
  if (elites) family.push({ host: 'population.elites-ready' });
  return [...features, ...family];
}
/**
 * FORMAT-PRUNE FP16 (carries ONE-FORMAT OF17b3): each primitive family's server hosts have a home section (format
 * `server-hosts.ts`, `quest-server.ts`), holding the native plan's own rows for that family's hosts in install order.
 */
const HOST_SECTIONS: readonly { readonly name: string; readonly owns: (host: string) => boolean }[] = [
  { name: 'server/quest', owns: host => host.startsWith('quest.') },
  { name: 'server/riding', owns: host => host.startsWith('riding.') },
  { name: 'server/boss', owns: host => host.startsWith('boss.') },
  { name: 'server/patrol', owns: host => host === 'encounter.patrol' },
];
/**
 * The one install order a derived plan takes: the three pinned native plans' order (Driftwood r10, Pine r13, Nalati r7),
 * each proven digest for digest against its named plan. A host the list leaves out keeps its place after these.
 */
const HOST_ORDER: readonly string[] = ['decisions', 'commands', 'collision', 'collision.pieces', 'day.keyed-sky', 'day.toon', 'day.declared',
  'water.sea', 'water.field', 'riding.roster', 'riding.trample', 'riding.environment', 'riding.groups', 'riding.elites', 'riding.hunt',
  'riding.mounted', 'boss.ground', 'boss.arena', 'riding.taming', 'riding.elites-ready', 'held.arms', 'encounter.patrol', 'boss.open-arena',
  'quest.chapter', 'quest.kill-steps', 'quest.body-scripts', 'quest.composition'];
/** The untyped presence check and read, for sections this engine's pinned format may not name yet. */
interface AnySectionProduct { readonly has: (name: string) => boolean; readonly section: (name: string) => unknown }
/** A family section's rows, admitted as the native plan admits its own (the section holds the same rows). */
function sectionHostRows(name: string, owns: (host: string) => boolean, value: unknown): readonly NativeAssemblyFeature[] {
  const section = value as { readonly version?: unknown; readonly hosts?: unknown };
  if (section.version !== 1 || !Array.isArray(section.hosts) || section.hosts.length === 0) throw new Error(`${name} needs version 1 and at least one host`);
  const rows = parseNativeAssembly({ kind: 'native-assembly', level: { speed: 1, ground: { size: 1, height: 0 } }, terrain: { kind: 'flat' }, navigation: 'shard', entries: {}, features: section.hosts }).features;
  const other = rows.find(row => !owns(row.host));
  if (other !== undefined) throw new Error(`${name} holds its own family's hosts only, not ${other.host}`);
  if (new Set(rows.map(row => row.host)).size !== rows.length) throw new Error(`${name} names a host twice`);
  return rows;
}
/**
 * FORMAT-PRUNE FP16: a plan whose families all stand from their sections names no host. Format `c4a4a1a` admits an empty
 * list; until this engine pins that format, an empty list is admitted here with every other field checked as written.
 */
function parseWrittenPlan(raw: unknown): NativeAssemblyPlan {
  const empty = typeof raw === 'object' && raw !== null && Array.isArray((raw as { features?: unknown }).features) && (raw as { features: readonly unknown[] }).features.length === 0;
  if (!empty) return parseNativeAssembly(raw);
  return { ...parseNativeAssembly({ ...raw, features: [{ host: 'decisions' }] }), features: [] };
}
const rank = (host: string): number => { const at = HOST_ORDER.indexOf(host); return at === -1 ? HOST_ORDER.length : at; };
/**
 * FORMAT-PRUNE FP16: the hosts a native plan stands. A plan with no family section keeps its own list as written. With
 * one, each section's family stands from the section (a plan naming one of its hosts as well is refused: one place
 * only); the quest family brings its plumbing (`decisions`, `commands`, FP16e) and a plan whose bake is read whole
 * (`bake.read: 'bake'`) its `collision` host (FP16d, Pine's and Nalati's; Driftwood's `solids` bake stands its own solids,
 * OF22a3), where the plan names none; and the list takes `HOST_ORDER`.
 */
function withHostSections(product: ShardFolder, plan: NativeAssemblyPlan): NativeAssemblyFeature[] {
  const any = product as unknown as AnySectionProduct, present = HOST_SECTIONS.filter(row => any.has(row.name));
  if (present.length === 0) return plan.features;
  const rows = [...plan.features];
  for (const { name, owns } of present) {
    const named = plan.features.find(row => owns(row.host));
    if (named !== undefined) throw new Error(`Native plan names ${named.host} beside the ${name} section: a family stands from its section alone (FORMAT-PRUNE FP16)`);
    rows.push(...sectionHostRows(name, owns, any.section(name)));
  }
  const has = (...hosts: readonly string[]): boolean => rows.some(row => hosts.includes(row.host));
  if (present.some(row => row.name === 'server/quest') && !has('decisions', 'commands')) rows.push({ host: 'decisions' }, { host: 'commands' });
  if (plan.bake?.read === 'bake' && !has('collision', 'collision.pieces')) rows.push({ host: 'collision' });
  return rows.map((row, at) => ({ row, at })).sort((a, b) => rank(a.row.host) - rank(b.row.host) || a.at - b.at).map(({ row }) => row);
}
/** Put cooked taming at the same installation point as its explicit predecessor. Its pose program is the looks row of
 *  the taming rows' first kind, the species tamed before any upgrade (FORMAT-PRUNE FP42: the engine names no kind). */
async function withSectionTaming(product: ShardFolder, features: readonly NativeAssemblyFeature[]): Promise<readonly NativeAssemblyFeature[]> {
  if (!product.hasFile(TAMING_FILE) || !features.some(row => row.host === 'riding.mounted') ||
    features.some(row => row.host === 'riding.taming')) return features;
  const { kinds } = await product.json(TAMING_FILE) as { kinds?: unknown };
  const kind: unknown = Array.isArray(kinds) ? kinds[0] : undefined;
  if (typeof kind !== 'string') throw new Error(`${TAMING_FILE} names no tamed kind, whose looks row holds its pose`);
  const taming: NativeAssemblyFeature = { host: 'riding.taming', rows: { file: TAMING_FILE },
    poses: { file: 'sim/taming-poses.json', path: ['poses'] }, pose: { file: 'actors/species-looks.json', path: ['poses', kind] } };
  const at = features.findIndex(row => row.host === 'riding.elites-ready');
  return at === -1 ? [...features, taming] : [...features.slice(0, at), taming, ...features.slice(at)];
}
/** ONE-FORMAT OF38d4a: where a plan names no held host, the arsenal its `held/slots.json` declares (a blade with its passes,
 *  a bow and a polearm, Nalati's) stands as the `held.arms` host would, at the held hosts' place: before the patrol and the
 *  open arena, else last. Its names come from the slots id's namespace (`nalati` of `nalati.arsenal`): the step and save
 *  owner `<ns>.weapons`, the script inputs `<ns>.weapon.attack`, `.swap`, `.aim` and `.pitch` (a room routes its net
 *  commands through them), so a save made under a plan that named the host restores. Its motion is the engine's sprint
 *  speed and its wind the weather owner's rows. */
const HELD_SLOTS_FILE = 'held/slots.json';
async function withSectionArms(product: ShardFolder, features: readonly NativeAssemblyFeature[]): Promise<readonly NativeAssemblyFeature[]> {
  if (!product.hasFile(HELD_SLOTS_FILE) || features.some(row => HELD_HOSTS.has(row.host))) return features;
  const slots = parseHeldSlots(await product.json(HELD_SLOTS_FILE)), kind = (name: string) => slots.slots.find(row => row.kind === name);
  const blade = kind('blade');
  if (blade?.kind !== 'blade' || blade.source.kind !== 'passes' || kind('bow') === undefined || kind('polearm') === undefined) return features;
  const weather = features.find(row => row.host === 'weather.native');
  if (weather?.host !== 'weather.native') throw new Error('A held arsenal reads its wind from a weather.native owner');
  const ns = slots.id.split('.')[0] ?? slots.id, input = (verb: string): string => `${ns}.weapon.${verb}`;
  const arms: NativeAssemblyFeature = { host: 'held.arms', step: `${ns}.weapons`, slots: HELD_SLOTS_FILE, speed: SPRINT_SPEED, weather: weather.rows,
    input: { attack: input('attack'), swap: input('swap'), aim: input('aim'), pitch: input('pitch') } };
  const at = features.findIndex(row => row.host === 'encounter.patrol' || row.host === 'boss.open-arena');
  return at === -1 ? [...features, arms] : [...features.slice(0, at), arms, ...features.slice(at)];
}
/** True when this product ships a native-assembly plan. */
/** FORMAT-PRUNE FP21: a native world's own settings, the section that replaces the plan file (format `server-world.ts`). */
const WORLD_SECTION = 'server/world';
export function hasNativeAssembly(product: ShardFolder): boolean {
  return product.hasFile(NATIVE_ASSEMBLY_FILE) || (product as unknown as AnySectionProduct).has(WORLD_SECTION);
}
/** FORMAT-PRUNE FP21: the plan a product writes: its plan file (an older writer) or its `server/world` section, never both. */
async function writtenPlan(product: ShardFolder): Promise<NativeAssemblyPlan> {
  const any = product as unknown as AnySectionProduct, file = product.hasFile(NATIVE_ASSEMBLY_FILE);
  if (file && any.has(WORLD_SECTION)) throw new Error(`A native world ships ${NATIVE_ASSEMBLY_FILE} or the ${WORLD_SECTION} section, not both (FORMAT-PRUNE FP21)`);
  if (file) return parseWrittenPlan(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await product.file(NATIVE_ASSEMBLY_FILE))));
  const { version, ...world } = any.section(WORLD_SECTION) as { readonly version?: unknown } & Readonly<Record<string, unknown>>;
  if (version !== 1) throw new Error(`${WORLD_SECTION} needs version 1`);
  return parseWrittenPlan({ kind: 'native-assembly', ...world, features: [] });
}
/**
 * Build one native world from a product's `server/native-assembly.json` (P1-E3.1b). Every read happens here, so a bad
 * plan refuses before a host exists; `install` is synchronous, in the plan's order, and restores like a typed plan.
 */
export async function prepareNativeAssembly<C extends NativeAssemblyContext>(input: ShardFolder, assets: ReadonlyMap<string, Uint8Array>, ports: NativeAssemblyPorts<C>): Promise<NativeAssemblyRuntime<C>> {
  const preparation = { product: input, assets }, lendReturns = await prepareReturns(preparation);
  const written = await writtenPlan(input);
  const plan: NativeAssemblyPlan = { ...written, features: withHostSections(input, written) };
  const patrol = ports.room === true ? plan.features.find(row => row.host === 'encounter.patrol') : undefined;
  const product = patrol === undefined ? input : await withEncounters(input, mergedIntake(await readPatrolIntake(input, patrol), await readSlotIntake(input, patrol), await readWindIntake(input, patrol.actors)));
  const shard = product.shardfile, bake = await prepareBake(product, plan.bake), ground = await prepareGround(product, assets, plan, bake);
  const navigation = plan.navigation === 'shard' ? assets.get(need(shard.navigation, 'Missing navigation').file) : await product.file(plan.navigation.file);
  const nav = readNavmesh(navigation, 'Native assembly requires its navigation', () => 0);
  const boot = plan.boot === undefined ? null : await readAssemblyInput(product, plan.boot);
  const declaredRoster = declaredBootSpawns(plan.features.some(row => row.host === 'riding.roster') ? boot : null, shard);
  const meadow = plan.field === undefined && plan.features.some(row => row.host === 'riding.roster') && product.hasFile(MEADOW_FILE);
  const prepared: AssemblyPrepared<C> = { ...ground, ...await prepareField(product, plan, ground.grid, bake, meadow), product, assets, ports, plan, bake, nav, boot, declaredRoster };
  const features = await withSectionArms(product, await withSectionTaming(product, withSectionWeather(product, withProgramWeather(shard, await withSectionPopulation(product, plan.features)))));
  const steps = await Promise.all(features.map(feature => prepareAssemblyFeature(feature, prepared)));
  // OF30: an older pending carcass restores by the declared rows' harvest
  const harvest = declaredHarvest(shard.rows);
  const heightAt = ground.heightAt, speed = plan.level.authorCap === true ? clamp(shard.authorCaps.speed, 0, plan.level.speed) : plan.level.speed;
  const level = shardLevel(shard, { at: { x: shard.spawn.x, y: Math.max(shard.spawn.y, plan.level.stand ?? heightAt(shard.spawn.x, shard.spawn.z) + 0.1), z: shard.spawn.z }, yaw: shard.spawn.yaw, speed }, plan.level.ground);
  // OF22b0: the declared spawns stand in the native level as in an ordinary upload's, beside the assembly's hosts, and the
  // declared creature host drives them (`installRuntimeCreatures`, as OF19b0 does beside a runtime plan's keeper)
  // A placement loan belongs to the roster's existing birth point and save adapter.
  // The ordinary creature host only stands the remaining declarations.
  const ordinary = declaredRoster.size === 0 ? shard : { ...shard, creatures: { ...shard.creatures,
    spawns: shard.creatures.spawns.filter(row => !declaredRoster.has(row.id)) } };
  const counted = countedShard(ordinary), sections = outputDescriptor(shard)?.sections ?? new Map<string, unknown>(), keeper = assemblyKeeper(counted, sections, declaredBossScripts(plan));
  admitRuntimeCreatures(counted, sections, keeper);
  const summoned = new Set((shard.questHost?.stages ?? []).flatMap(stage => stage.row.stages.flatMap(entry => entry.do.flatMap(action => 'spawn' in action ? [action.spawn] : []))));
  // OF22c1: a chapter wake row's declared fight waits, as a quest page's summoned one does, for its wake cue
  for (const row of features) if (row.host === 'quest.chapter') {
    const { spawn } = parseChapterWake(await readAssemblyInput(product, row.wake));
    if (declaredWakeFight(shard, spawn) !== undefined) summoned.add(spawn);
  }
  const declaredLevel: SimLevel = { ...level, entities: declaredSpawnEntities(counted) };
  const world = sectionWorld(product, plan, meadow ? prepared.field : null, await forestClock(product));
  // OF22a3: with no collision host the bake lends its ground alone and the shard's prop solids stand beside it
  const ownSolids = standsOwnSolids(plan.features.map(row => row.host)), melee = prepareSectionMelee<C>(product, features.map(row => row.host));
  // OF38d4a: a held host the engine stood from the product's files counts as named
  const ranged = prepareSectionRanged<C>(product, features.map(row => row.host));
  const ownGround = ownSolids && plan.bake !== undefined && plan.collision !== undefined ? { bake, resolution: plan.collision.resolution } : null;
  const hosts = features.map(row => row.host);
  if (meadow && !hosts.some(name => name.startsWith('water.'))) hosts.push('water.field');
  const levelPorts = { ground: false as const, heightAt };
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
    melee?.(run); // OF22d2: the held/melee section's sword, where a plan names no item.swept host
    ranged?.(run); // OF38d: the held.ranged family from combat/items and held/loadout, where a plan names no held host
    for (const step of steps) step(run);
    // The arena finishes a borrowed patrol before installing the fight. A patrol can also own its room alone.
    run.finishPatrol?.();
    run.declared = installRuntimeCreatures(host, counted, assets, sections, { restoring: context.restoring, keeper, summoned,
      fact: (name, actor) => { need(run.input, 'A declared decision grant needs the commands host').ledger.fact(name, actor); } });
    installNativeHarvest(host, harvest);
  } };
}
