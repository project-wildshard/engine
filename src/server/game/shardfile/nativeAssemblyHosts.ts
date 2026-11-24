import { pageStateOf } from '../../../shared/game/shardfile/runtimeState';
import { prepareCaptain, type CaptainKnock, type NativeCaptain } from '../boss/captainNative';
import { prepareWindElite, type NativeWindElite } from '../boss/windEliteNative';
import { strikeFromData } from '@wildshard/engine/ai/strikeRows';
import { StrikeRunner } from '@wildshard/engine/ai/strikes';
import { NativeEliteRoster, nativeEliteBindings, type NativeEliteBindings } from '@wildshard/engine/ai/eliteRoster';
import type { NativeEliteKernelLoans } from '@wildshard/engine/ai/eliteKernels';
import type { SimHost } from '@wildshard/engine/sim';
import { DayCycle, type DayCycleClock } from '@wildshard/engine/world/dayCycle';
import { declaredWaterBody } from '@wildshard/engine/world/water/declared';
import { waveHeight } from '@wildshard/engine/world/waves';
import { parseAchievementCounterData } from '@wildshard/format/achievementCounters';
import { parseChapterDirector, parseChapterWake } from '@wildshard/format/chapterDirector';
import { parseBarterEconomy } from '@wildshard/format/lootEconomy';
import type { NativeAssemblyFeature, NativeEliteConditions } from '@wildshard/format/nativeAssembly';
import type { NativeRidingRows } from '@wildshard/format/nativeRiding';
import type { Shardfile } from '@wildshard/format/shardSchema';
import type { RuntimeEncounter } from './runtimeCreatures';
import type { ShardFolder } from '../../../shared/game/shardfile/shardFolder';
import { parseNativeQuestComposition } from '@wildshard/format/nativeQuestComposition';
import { QuestRuntimeDocumentSchema } from '@wildshard/format/questRuntime';
import { TOON_DAY_PRESET } from '@wildshard/format/toonLook';
import { parseWeatherProgram } from '@wildshard/format/weatherProgram';
import { parse } from 'valibot';
import { installGroundBoss } from '../boss/native';
import { EliteCore, memoryElitePersistence, type EliteCoreRule, type EliteCoreScript } from '../../../shared/game/eliteSystem';
import { installNativeHeldAmmunition } from '../loadout/nativeAmmunition';
import { prepareHeldArms } from '../weapons/nativeHeld';
import { prepareOpenArenaHost, type OpenArenaRuntime } from '../boss/openArenaNative';
import { preparePatrol } from '../boss/patrolNative';
import { prepareSlots } from '../boss/slotsNative';
import type { Wind } from '@wildshard/engine/world/steppeWind';
import { dayClock } from '../../../shared/game/looks/dayClock';
import { keyedSkyDaySpec } from '../../../shared/game/looks/keyedSkyClock';
import { readDirectorDocument } from '../../../shared/game/plugin/director';
import { installNativeItems, otherCombatFrame } from '../plugin/nativeItems';
import { addBakedPieces, bindNativeLoadout, weaponRow } from '../plugin/simulation';
import { installHostPortalRide, type PortalRideRows } from '../../../shared/game/shardfile/portalRide';
import { installPopulationEnvironment } from '../population/environment';
import { installMixedPopulation, type MixedPopulationInput } from '../population/mixedRoster';
import { installNativeCollision } from '../population/nativeBake';
import { NativeWildEnvironment } from '../population/nativeManager';
import { ReturnProgram } from '../../../shared/game/population/returnProgram';
import { installPopulationRoster } from '../population/roster';
import { declaredBossProgram, declaredRosterPopulation, keptSpeciesPrograms } from '../population/declaredNative';
import { parseNativePopulationRows } from '@wildshard/format/populationRoster';
import { NativeBossBindingSchema, parseRoamingEncounter } from '@wildshard/format/bossEncounter';
import { installNativeHerdShelter } from '../population/shelter';
import { installNativeSpawnScript, readSpawnScript } from '../population/spawnScript';
import { headlessSpecCatalogue } from '../population/specCatalogue';
import { ownContractCatalogue } from '../../../shared/game/quest/contracts';
import type { AnimalSim } from '@wildshard/engine/entities/AnimalSim';
import { installNativeEliteFeature, readEliteFeature } from '../quest/eliteFeature';
import { eliteDrops } from '../quest/eliteDrops';
import { installQuestKillSteps, rosterKind } from '../quest/killSteps';
import { declaredQuestBodies } from '../quest/declaredQuestBodies';
import { installNativeChapterDirector } from '../quest/nativeChapter';
import { installNativeQuestComposition, readNativeQuestSpots, type NativeQuestCompositionInput } from '../quest/nativeComposition';
import { readNativeQuestSecret } from '../quest/nativeSecret';
import { installMountedPlayer } from '../riding/native';
import { mountSpeeds } from './declaredRiding';
import { installNativeBootRoster, installNativePopulationHunt, type NativePopulationBootRows } from '../riding/nativePopulation';
import { installNativeTaming, type NativeTamingRows } from '../riding/nativeTaming';
import { prepareNativeStealth } from '../stealth/nativeStealth';
import { installGrapple } from '../grapple/native';
import { installArenaEntry, prepareArenaBody } from '../boss/arenaRoomEntry';
import { readEncounterPoses } from '../population/encounterBook';
import { parseGrappleProfile } from '@wildshard/format/grapple';
import { tagOf } from '@wildshard/engine/physics/surface';
import { installTrampleTrail } from '../../../shared/game/systems/looks/trampleField';
import { installWeatherContinuation, type NativeWeatherWorld } from '../weather/continuation';
import { nativeWeatherBundle, type WeatherReactions } from '../weather/reactions';
import { nativeDecisionAuthority } from './borrowedDecisions';
import { installNativeGroupRows } from './groupRuntime';
import { need, readAssemblyInput, type AssemblyPrepared, type NativeAssemblyContext } from './nativeAssemblyInput';
import { installBodyScripts, installCombatMotion } from './nativeRuntimeLoans';
import { registerInstalled } from './installedSides';

/** What one install's hosts hand each other, in the plan's order. A later host reads what an earlier one left. */
export interface AssemblyRun<C extends NativeAssemblyContext> {
  readonly host: SimHost; readonly context: C; input: { readonly ledger: { readonly fact: (name: string, actorId: string) => void } } | null;
  day: DayCycleClock | null; boss?: ReturnType<typeof installGroundBoss>; quest?: ReturnType<typeof installNativeQuestComposition>;
  ammunition?: ReturnType<typeof installNativeHeldAmmunition>; elites?: ReturnType<typeof installNativeEliteFeature>;
  island?: ReturnType<typeof installMixedPopulation>; bindings?: NativeEliteBindings; roster?: ReturnType<typeof installNativeBootRoster>;
  weather?: { readonly wind: Wind; readonly storm: WeatherReactions }; finishPatrol?: () => void; arena?: OpenArenaRuntime;
  wild?: NativeWildEnvironment; groups?: ReturnType<typeof installNativeGroupRows>; nativeElites?: NativeEliteRoster; eliteCore?: ReturnType<typeof nativeEliteCore>; creatures?: ReturnType<typeof installNativePopulationHunt>; taming?: ReturnType<typeof installNativeTaming>;
  /** OF22c1: the declared encounters by their spawn, once the declared creature host stands (after every host). */
  declared?: ReadonlyMap<string, RuntimeEncounter>;
}
/** OF22c1: the declared boss fight on a chapter wake row's spawn, if the shard declares one. */
export function declaredWakeFight(shard: Pick<Shardfile, 'encounters'>, spawn: string): { readonly encounter: string; readonly entity: string } | undefined {
  const row = shard.encounters.find(entry => entry.entity === spawn && entry.kind === 'boss');
  return row === undefined ? undefined : { encounter: row.id, entity: row.entity };
}
type Step<C extends NativeAssemblyContext> = (run: AssemblyRun<C>) => void;
const combatOf = <C extends NativeAssemblyContext>(run: AssemblyRun<C>) => need(run.context.combat, 'Native assembly requires its combat frame');
const dayOf = <C extends NativeAssemblyContext>(run: AssemblyRun<C>): DayCycleClock => need(run.day, 'Native assembly host requires a day clock before it');
const bootOf = <C extends NativeAssemblyContext>(at: AssemblyPrepared<C>) => need(at.boot, 'Native assembly host requires boot rows') as NativePopulationBootRows & {
  riding: NativeTamingRows['programs'] & { riding: unknown }; rest: NativeTamingRows['rest']; mountable?: readonly string[] };
const fieldOf = <C extends NativeAssemblyContext>(at: AssemblyPrepared<C>) => need(at.field, 'Native assembly host requires its field');
function installSweptMelee<C extends NativeAssemblyContext>(run: AssemblyRun<C>, items: readonly unknown[], policy: unknown): void {
  installNativeItems(run.host, combatOf(run), { kind: 'swept', items, policy }); registerInstalled(run.host, 'heldArms'); registerInstalled(run.host, 'loadout');
}
/**
 * ONE-FORMAT OF22d2: a native plan that names no `item.swept` host stands its swept melee from the shard's `held/melee`
 * section (the same policy the host read from a server file), before any host, so a quest host that lends its sword finds it.
 */
export function prepareSectionMelee<C extends NativeAssemblyContext>(product: ShardFolder, hosts: readonly string[]): ((run: AssemblyRun<C>) => void) | null {
  if (hosts.includes('item.swept') || !product.has('held/melee')) return null;
  const policy = product.section('held/melee'), items = product.shardfile.items.rows;
  return run => { installSweptMelee(run, items, policy); };
}

/** The held hosts whose families (format `primitiveOfHost`: `held.melee`, `held.ranged`) a section now stands. */
/** ONE-FORMAT OF22c3: Driftwood's island population (its reserved Captain, item reactions, settle and poses) is declared rows
 *  since OF22b4 and OF22c2, so no writer names these hosts. Kept originals Driftwood r4 (prod's head) and r5 still do, so
 *  they stand for them (SHARD-COMPAT CP16, FORMAT-PRUNE FP21 s8); ZONE-SNAPSHOTS ZS8 dropped their kept-plan test. */
export const ISLAND_HOSTS: ReadonlySet<string> = new Set(['population.mixed', 'population.reactions', 'population.settle', 'population.poses']);
export const HELD_HOSTS: ReadonlySet<string> = new Set(['item.swept', 'held.arms', 'item.ranged', 'loadout', 'combat.motion', 'ammunition']);
/** The engine's sprint speed (`walkingSpeed`), the motion a held ranged kit scales its spread and sway against. */
export const SPRINT_SPEED = 7.2;
interface RangedRow { readonly id: string; readonly ranged?: unknown; readonly profile?: { readonly family: string; readonly action?: string } }
/** A ranged weapon's install kind, from its admitted profile: a bow draws, a lever rifle cycles, any other firearm bolts. */
export function rangedKind(row: RangedRow): 'bolt' | 'cycle' | 'bow' {
  const profile = need(row.profile, `Missing ranged profile for ${row.id}`);
  return profile.family === 'bow' ? 'bow' : profile.action === 'lever' ? 'cycle' : 'bolt';
}
/**
 * ONE-FORMAT OF38d: a native plan that names no held host stands the `held.ranged` family from its sections, before any
 * host, in the order the hosts it replaces stood: the equip route (`combat/items` loadout), combat motion, each
 * `combat/items` weapon that carries `ranged` (in row order), then the `held/loadout` pouch, refilled with its fallback
 * on respawn. A plan that still names a held host keeps it, so a product built before the move boots unchanged.
 */
export function prepareSectionRanged<C extends NativeAssemblyContext>(product: ShardFolder, hosts: readonly string[]): ((run: AssemblyRun<C>) => void) | null {
  const shard = product.shardfile, weapons = (shard.items.rows as readonly RangedRow[]).filter(row => row.ranged !== undefined);
  if (weapons.length === 0 || hosts.some(name => HELD_HOSTS.has(name))) return null;
  const kits = weapons.map(row => ({ kind: rangedKind(row), policy: row.ranged, profile: need(row.profile, `Missing ranged profile for ${row.id}`) }));
  const native = shard.items.loadout.native, melee = product.has('held/melee');
  const held = product.has('held/loadout') ? product.section('held/loadout') : undefined;
  return run => {
    const combat = combatOf(run);
    // the swept kit (OF22d2) owns the equip route when the shard also holds a melee section
    if (native !== undefined && !melee) bindLoadout(run, native);
    installCombatMotion(run.host, run.context, SPRINT_SPEED);
    for (const { kind, policy, profile } of kits) {
      if (kind === 'bow') installNativeItems(run.host, combat, { kind, policy, profile });
      else if (kind === 'cycle') installNativeItems(run.host, combat, { kind, policy, profile });
      else installNativeItems(run.host, combat, { kind, policy, profile });
    }
    registerInstalled(run.host, 'heldRanged');
    if (held === undefined) return;
    const ammunition = installNativeHeldAmmunition(run.host, held, shard.items);
    run.host.onStep('held.ammunition', () => { ammunition.update(); }, undefined, 'afterBodies');
    run.host.events.on('player.respawned', ({ player }) => { if (player !== undefined) ammunition.refillFor(player, held.pouch.fallback); }, run.host.scope);
    run.ammunition = ammunition;
  };
}
type NativeLoadout = NonNullable<Shardfile['items']['loadout']['native']>;
function bindLoadout<C extends NativeAssemblyContext>(run: AssemblyRun<C>, policy: NativeLoadout): void {
  const combat = combatOf(run), input = need(policy.input, 'Missing native equipment input policy');
  registerInstalled(run.host, 'loadout');
  bindNativeLoadout(run.host, policy, { flags: run.host.flags, frame: combat,
    locked: () => run.boss?.locked() === true || run.quest?.riding() === true || run.quest?.talking() === true,
    others: { frame: player => otherCombatFrame(combat, player.id), locked: () => run.boss?.locked() === true },
    step: { id: input.step, phase: input.phase, pick: (player, first) => {
      if (!first) return otherCombatFrame(combat, player.id).scripts.get(input.command) ?? null;
      const taken = run.quest?.takePickup() === true ? 1 : null; return combat.scripts.get(input.command) ?? taken;
    } } });
}

async function prepareQuest<C extends NativeAssemblyContext>(row: Extract<NativeAssemblyFeature, { host: 'quest.composition' }>, at: AssemblyPrepared<C>): Promise<Step<C>> {
  const { product } = at, shard = product.shardfile, read = <T>(input: Parameters<typeof readAssemblyInput>[1]): Promise<T> => readAssemblyInput<T>(product, input);
  const counters = parseAchievementCounterData(await read(row.counters)), content = row.document === undefined ? undefined : parse(QuestRuntimeDocumentSchema, await read(row.document));
  const spots = await read<NativeQuestCompositionInput['spots']>(row.spots), contracts = row.contracts === undefined ? undefined : await read<NonNullable<NativeQuestCompositionInput['contracts']>>(row.contracts);
  const table = row.table === undefined ? need(content, 'Native quest needs a table').table : await read<NativeQuestCompositionInput['table']>(row.table);
  const rows = parseNativeQuestComposition(await read(row.rows)), director = row.director === true ? await readDirectorDocument(product) : undefined;
  const feats = counters.feats.filter(feat => feat.kind === undefined);
  const native = row.nativeFeats !== true ? counters : parseAchievementCounterData({ ...counters, feats, write: 'each',
    flags: feats.map(feat => counters.flags.find(flag => flag.id === feat.id) ?? { id: feat.id, method: 'count', value: { constant: 0 } }) });
  const props = row.props === undefined ? undefined : await read<unknown>(row.props);
  const trades = row.barter === true ? parseBarterEconomy(need(shard.rows.loot[0], 'Missing barter row').economy).exchange : undefined;
  const secret = content === undefined ? undefined : await readNativeQuestSecret(product);
  // OF22e1: a plan with no `population.mixed` host guards its quest with the declared bodies alone
  const island = at.plan.features.some(feature => feature.host === 'population.mixed');
  return run => { registerInstalled(run.host, 'questComposition'); run.quest = installNativeQuestComposition(run.host, { source: shard, table, rows, island, spots: row.readSpots === true ? readNativeQuestSpots(spots) : spots, counters: native,
    ...(content === undefined ? {} : { steps: content.steps, deaths: content.deaths, readings: content.readings, lead: content.lead }),
    ...(contracts === undefined ? {} : { contracts: ownContractCatalogue(contracts, run.host.scope) }), ...(trades === undefined ? {} : { trades }), ...(director === undefined ? {} : { director }),
    ...(props === undefined ? {} : { props }), ...(secret === undefined ? {} : { secret }), ...(row.restoring === true ? { restoring: run.context.restoring } : {}) }); };
}
async function prepareMixed<C extends NativeAssemblyContext>(row: Extract<NativeAssemblyFeature, { host: 'population.mixed' }>, at: AssemblyPrepared<C>): Promise<Step<C>> {
  const { product, bake, nav } = at, shard = product.shardfile, species = need(keptSpeciesPrograms(product), 'The island population needs its species programme');
  const launch = need(need(shard.items.launches, 'Missing launch rows')[row.launch], 'Native assembly requires its admitted launch'), sea = need(shard.water.find(body => body.id === row.sea && body.kind === 'sea'), 'Native assembly requires its admitted sea');
  const actors = bake['actors'] as readonly { readonly spec: { readonly kind: string; readonly variant: string } }[], captain = bake['captain'] as { readonly spec: { readonly kind: string; readonly variant: string } };
  const specs = headlessSpecCatalogue([...actors.map(actor => actor.spec), captain.spec]) as MixedPopulationInput['specs'];
  const input = { perchProgram: await readAssemblyInput(product, row.perch), rows: await readAssemblyInput(product, row.rows), keeper: await readAssemblyInput(product, row.keeper),
    placement: await readAssemblyInput<MixedPopulationInput['placement']>(product, row.placement), fauna: new Map(species.native.map(entry => [entry.kind, entry] as const)) };
  need(species.program, 'Native assembly requires its admitted species program');
  const waterLevel = declaredWaterBody(structuredClone(sea)).level;
  return run => { run.island = installMixedPopulation(run.host, { ...input, reserved: bake['captain'], launch, population: species, specs, seed: shard.identity.seed, waterLevel, spawnY: shard.spawn.y, nav,
    bake: { ground: bake.ground, actors: bake['actors'], herds: bake['herds'], habitat: bake['habitat'] } } as MixedPopulationInput, run.context.snapshot); };
}
/** The elite core a riding world binds: each rule's word, read through its programme from the clock and the storm. */
export function nativeEliteCore(host: SimHost, conditions: NativeEliteConditions, program: Pick<ReturnProgram, 'project'>, day: { readonly dayPhase: string }, env: Pick<NativeWildEnvironment, 'storm'>): EliteCore<EliteCoreScript<AnimalSim>> {
  const drops = eliteDrops<EliteCoreScript<AnimalSim>>(host);
  const core = new EliteCore<EliteCoreScript<AnimalSim>>({ players: host.players, condition: (rule: EliteCoreRule) => {
    const code = need(conditions.rules[rule], 'Missing elite rule');
    return program.project('eliteRule', { rule: code.rule, phase: code.phase ? conditions.phases[day.dayPhase] ?? 0 : 0, storm: code.storm ? (env.storm ? conditions.storm.storm : conditions.storm.calm) : 0 })['accept'] === 1;
  } }, drops.hooks, host.level.id, memoryElitePersistence(host.level.id, pageStateOf(host, '.elites')));
  drops.bind(core);
  return core;
}
async function prepareRidingElites<C extends NativeAssemblyContext>(row: Extract<NativeAssemblyFeature, { host: 'riding.elites' }>, at: AssemblyPrepared<C>): Promise<Step<C>> {
  const rows = await readAssemblyInput(at.product, row.rows), [swipe, pounce, bite] = await readAssemblyInput<readonly Parameters<typeof strikeFromData>[0][]>(at.product, row.strikes);
  return run => {
    const strikes = [swipe, pounce, bite].map(strike => strikeFromData(need(strike, 'Missing elite strikes')));
    const { host } = run, clock = dayOf(run), env = need(run.wild, 'Native elites need their environment'), boot = bootOf(at);
    const core = nativeEliteCore(host, row.conditions, ReturnProgram.native(host, boot.admission), clock, env);
    const elites = new NativeEliteRoster(rows, { host, core, bindings: need(run.bindings, 'Native elites need their bindings'), groups: need(run.groups, 'Native elites need their groups'),
      kernel: { contacts: new StrikeRunner(), strikes, terrain: need(at.samplers, 'Native elites need terrain samplers'), environment: env, ledges: at.bake['ledges'] as NativeEliteKernelLoans['ledges'] } });
    elites.bindProjected(row.projected, ReturnProgram.native(host, boot.admission), core); elites.install(); run.nativeElites = elites; run.eliteCore = core;
  };
}
/** Read one feature's rows now, and return the synchronous step that installs its host. */
export async function prepareAssemblyFeature<C extends NativeAssemblyContext>(row: NativeAssemblyFeature, at: AssemblyPrepared<C>): Promise<Step<C>> {
  const { product, assets, plan, nav } = at, shard = product.shardfile, rows: Readonly<Record<string, unknown>> = at.bake, bake: unknown = at.bake;
  switch (row.host) {
    case 'riding.roster': return run => {
      const field = fieldOf(at); run.bindings = nativeEliteBindings();
      run.roster = installNativeBootRoster(run.host, { boot: bootOf(at), bake: bake as Parameters<typeof installNativeBootRoster>[1]['bake'], spawnY: shard.spawn.y, clock: { phase: dayOf(run).dayPhase, storm: false }, elites: run.bindings, field, declared: at.declaredRoster });
    };
    case 'riding.trample': { const { id, radius, strength, speedLimit } = row; return run => { installTrampleTrail(run.host, fieldOf(at).grass.trample, { id, radius, strength, speedLimit }); }; }
    case 'riding.environment': return run => { const { grass } = fieldOf(at); run.wild = new NativeWildEnvironment(grass.field, grass.trample, { wind: row.wind, flatten: row.flatten }, ReturnProgram.native(run.host, bootOf(at).admission)); };
    case 'riding.groups': { const input = await readAssemblyInput(product, row.rows); return run => { run.groups = installNativeGroupRows(run.host, input, need(at.grid, 'Native groups need their grid'), need(run.wild, 'Native groups need their environment')); }; }
    case 'riding.elites': return prepareRidingElites(row, at);
    case 'riding.hunt': {
      const config = await readAssemblyInput<Parameters<typeof installNativePopulationHunt>[1]['config']>(product, row.config);
      return run => { const roster = need(run.roster, 'Native hunt needs its roster'); run.creatures = installNativePopulationHunt(run.host, { boot: bootOf(at), elites: need(run.bindings, 'Native hunt needs its bindings'), bodies: roster.bodies, herds: roster.herds, nav, stream: roster.stream, wildStream: roster.wildStream,
        bake: bake as Parameters<typeof installNativePopulationHunt>[1]['bake'], spawnY: shard.spawn.y, config, field: fieldOf(at), ...(at.ports.pastureCues === undefined ? {} : { pastureCues: at.ports.pastureCues }), ...(run.context.snapshot === undefined ? {} : { snapshot: run.context.snapshot }) }); };
    }
    case 'riding.mounted': {
      const profile = await readAssemblyInput<Pick<NativeRidingRows, 'adopted'> & Partial<Pick<NativeRidingRows, 'speeds' | 'mountable'>>>(product, row.profile);
      const { world } = at;
      const mounts = shard.rows.species.filter(species => species.kind === profile.adopted.kind && species.mount !== undefined);
      if (profile.speeds === undefined && mounts.length > 1) throw new Error('Native riding has multiple mount rows for the adopted kind');
      const gaits = mounts[0]?.mount?.gaits ?? shard.modes?.ride?.find(mode => mode.id === 'ride')?.gaits;
      const speeds = profile.speeds ?? (gaits === undefined ? undefined : mountSpeeds(gaits));
      return run => {
        const boot = bootOf(at), camp = need(profile.mountable ?? boot.mountable, 'Native riding needs its camp mounts');
        const mountable = [...camp, ...need(run.creatures, 'Riding needs its creatures').bondedHorseIds()];
        installMountedPlayer(run.host, { ...profile, speeds, world, mountable, program: boot.riding.riding }, need(at.pond, 'Riding needs its pond'), at.wet);
      };
    }
    case 'boss.arena': {
      const input = await readAssemblyInput<unknown>(product, { file: row.file }), spec = await prepareArenaBody(product, row.body);
      const poses = at.ports.room === true ? await readEncounterPoses(product, [row.body.kind]) : undefined;
      return run => { if (run.context.room === true) { installArenaEntry(run.host, input, row, { spec, ...(poses === undefined ? {} : { poses }), grantItem: at.ports.grantItem(run.context), snapshot: run.context.snapshot }); registerInstalled(run.host, 'arenaRoom'); } };
    }
    case 'held.arms': {
      const arms = await prepareHeldArms(product, { ...row, weather: await readAssemblyInput<unknown>(product, row.weather) }), stealth = prepareNativeStealth(product);
      return run => { if (run.context.room === true) { installCombatMotion(run.host, run.context, row.speed); const tick = at.ports.heldTick(run.context);
        arms(run.host, { combat: combatOf(run), room: true, tick });
        // SS4: the sneak shot the page doubles, decided here from each player's own Hidden state. Installed after the arms so
        // exportSeats keeps its indexes; a shot therefore reads the state one tick old, where the page reads the same frame's.
        // SS3: the held arms own the room's equip swap, the server half of the page's catalogue kit
        registerInstalled(run.host, 'heldArms'); registerInstalled(run.host, 'loadout');
        if (stealth !== null) { stealth(run.host, { tick, groups: run.groups }); registerInstalled(run.host, 'stealth'); } } };
    }
    case 'encounter.patrol': {
      if (at.ports.room !== true) return () => undefined;
      const external = await readAssemblyInput<readonly unknown[]>(product, row.external), patrol = await preparePatrol(product, { ...row, external }), slots = await prepareSlots(product, row);
      const elites = at.plan.features.find((feature): feature is Extract<NativeAssemblyFeature, { host: 'riding.elites' }> => feature.host === 'riding.elites');
      const kernels = elites === undefined ? [] : (await readAssemblyInput<{ readonly kernels: readonly { readonly knockdown: CaptainKnock }[] }>(product, elites.rows)).kernels;
      const [kernel] = kernels, ride = elites === undefined || kernel === undefined ? null : await prepareCaptain(product, external, row.actors, kernel.knockdown), fly = kernel === undefined ? null : prepareWindElite(product, kernel.knockdown);
      return run => {
        let captain: NativeCaptain | null = null, windElite: NativeWindElite | null = null;
        const finish = patrol.begin(run.host, { eliteDamage: (_host, actor, request) => captain?.scale(actor, request.point) ?? run.arena?.eliteDamage(actor, request) ?? 1, beforePatrol: (host, dt) => { slots?.advance(host, dt); captain?.advance(dt); windElite?.advance(dt); }, afterPatrol: (_host, dt) => { run.arena?.advance(dt); } });
        run.finishPatrol = () => {
          delete run.finishPatrol;
          finish();
          if (slots !== null) { slots.install(run.host, need(run.bindings, 'Slots need their bindings'), run.context.restoring); registerInstalled(run.host, 'slots'); registerInstalled(run.host, 'poseViews'); }
          if (ride !== null && elites !== undefined) { captain = ride(run.host, decisions => nativeEliteCore(run.host, elites.conditions, decisions, dayOf(run), need(run.wild, 'A captain needs his environment')), `${row.step}.captain`); if (captain.lair.record !== undefined) need(run.eliteCore, 'A captain needs the world\'s lairs').share(captain.lair.id, captain.lair.record); }
          if (fly !== null && elites !== undefined) {
            const env = need(run.wild, 'A wind elite needs its environment'), world = need(run.eliteCore, 'A wind elite needs the world\'s lairs');
            windElite = fly(run.host, need(run.bindings, 'A wind elite needs its bindings'), () => nativeEliteCore(run.host, elites.conditions, ReturnProgram.native(run.host, bootOf(at).admission), dayOf(run), env), `${row.step}.wind`, () => env.wind);
            if (windElite.lair.record !== undefined) world.share(windElite.lair.id, windElite.lair.record);
            registerInstalled(run.host, 'windElite');
          }
        };
      };
    }
    case 'boss.open-arena': {
      if (at.ports.room !== true) return () => undefined;
      const bind = await prepareOpenArenaHost(product, row);
      return run => {
        const { host, context } = run, arena = bind(host); run.arena = arena;
        arena.observeWeather(need(run.weather, 'An open arena needs its weather')); arena.cover(); need(run.finishPatrol, 'An open arena needs its patrol')();
        arena.install({ presentation: need(at.ports.arena, 'An open arena needs its presentation'), commands: at.ports.heldTick(context).commands, ledger: at.ports.ledger(context), restoring: context.restoring, grantItem: at.ports.grantItem(context) });
        registerInstalled(host, 'poseViews');
      };
    }
    case 'grapple': {
      const profile = parseGrappleProfile(await readAssemblyInput<unknown>(product, row.profile)), hooks = await readAssemblyInput<readonly { readonly x: number; readonly y: number; readonly z: number }[]>(product, row.hooks);
      const mode = shard.modes?.grapple?.find(entry => entry.id === row.mode);
      if (mode === undefined) throw new Error(`Grapple row names no mode ${row.mode}`);
      return run => {
        const { context } = run, guard = context.restoring ? [] : run.host.physics.world.colliders.getAll().filter(collider => tagOf(collider)?.owner === row.guard).map(collider => collider.handle);
        installGrapple(run.host, at.ports.grappleTick(context), profile, mode, hooks, guard, row.rise === true);
        registerInstalled(run.host, 'grapple');
      };
    }
    case 'riding.taming': {
      const input = await readAssemblyInput<object>(product, row.rows), poses = await readAssemblyInput<NativeTamingRows['poses']>(product, row.poses), poseProgram = await readAssemblyInput(product, row.pose);
      return run => { const boot = bootOf(at); run.taming = installNativeTaming(run.host, { commands: at.ports.tamingCommands(run.context) }, { ...input, programs: boot.riding, rest: boot.rest, poses, poseProgram } as NativeTamingRows); };
    }
    case 'riding.elites-ready': return run => {
      const elites = need(run.nativeElites, 'Native elites are not installed');
      elites.bindPopulation(need(run.creatures, 'Native elites need their population')); elites.bindBond(need(run.taming, 'Native elites need their taming')); if (!run.context.restoring) elites.initialize();
      at.ports.observeBindings?.(run.host, need(run.bindings, 'Native elites need their bindings'));
    };
    case 'decisions': return run => { nativeDecisionAuthority(shard, assets, run.host); };
    case 'commands': return run => { run.input = at.ports.bindCommands(run.context, run.host); };
    case 'collision': {
      const collision = need(plan.collision, 'Native collision needs its settings'); need(plan.bake, 'Native collision needs its bake');
      // GC36 (J322, no walls): an older bake still holds its page's chunk-edge walls (`edge`); no world stands them, as a cell held near
      // its player never did (`nativeBake.ts`).
      return run => { registerInstalled(run.host, 'collision'); if (row.skipOnRestore !== true || !run.context.restoring) installNativeCollision(run.host, at.bake, { ...collision, omit: [...(collision as { omit?: readonly string[] }).omit ?? [], 'edge'] } as Parameters<typeof installNativeCollision>[2]); };
    }
    case 'collision.pieces': { const pieces = await readAssemblyInput<unknown>(product, row.rows); return run => { registerInstalled(run.host, 'collision'); if (!run.context.restoring) addBakedPieces(run.host.physics, pieces); }; }
    case 'portal.ride': {
      const ride = await readAssemblyInput<PortalRideRows>(product, row.rows);
      return run => { installHostPortalRide(run.host, row.step, shard, ride, at.ports.ledger(run.context).fact); registerInstalled(run.host, 'portalRide'); };
    }
    case 'day.keyed-sky': { const spec = keyedSkyDaySpec(product.section('look/keyed-sky')); return run => { run.day = run.host.useDayClock(new DayCycle(spec)); }; }
    case 'day.toon': {
      const style = product.section('look/toon').sky.day;
      return run => { const clock = new DayCycle({ ...dayClock(TOON_DAY_PRESET, style, row.phases).spec, start: row.start }); clock.cycle = row.cycle; run.day = run.host.useDayClock(clock); };
    }
    case 'day.declared': { const clock = await readAssemblyInput<ConstructorParameters<typeof DayCycle>[0]>(product, row.clock); return run => { run.day = run.host.useDayClock(new DayCycle(clock)); }; }
    case 'water.sea': {
      const body = structuredClone(need(shard.water.find(water => water.id === row.id && water.kind === 'sea'), 'Native assembly requires its admitted sea'));
      return run => { const sea = declaredWaterBody(body); run.host.useWater({ surfaceAt: sea.restAt, bob: (x: number, z: number) => waveHeight(x, z, run.host.clock.now) }); };
    }
    case 'water.field': return run => { run.host.useWater({ surfaceAt: fieldOf(at).queries.surfaceAt }); };
    case 'combat.motion': return run => { installCombatMotion(run.host, run.context, row.speed); };
    case 'weather.program': { const weather = parseWeatherProgram(await readAssemblyInput(product, row.program)); return run => { installWeatherContinuation(run.host, weather, dayOf(run), undefined, combatOf(run)); }; }
    case 'weather.native': {
      const program = nativeWeatherBundle(await readAssemblyInput(product, row.program), await readAssemblyInput(product, row.shelters)), input = await readAssemblyInput(product, row.rows);
      return run => { const weather = installWeatherContinuation(run.host, { program, rows: input, clock: dayOf(run), env: need(run.wild, 'Native weather needs its environment'), bake: bake as NativeWeatherWorld['bake'] }); run.weather = weather; at.ports.observeWeather?.(run.host, weather); };
    }
    case 'item.ranged': {
      const weapon = weaponRow(shard, row.weapon), policy = need(weapon.ranged, 'Missing native ranged policy'), profile = need(weapon.profile, 'Missing native ranged profile');
      return run => {
        const combat = combatOf(run);
        if (row.kind === 'bolt') installNativeItems(run.host, combat, { kind: 'bolt', policy, profile });
        else if (row.kind === 'cycle') installNativeItems(run.host, combat, { kind: 'cycle', policy, profile });
        else installNativeItems(run.host, combat, { kind: 'bow', policy, profile });
        registerInstalled(run.host, 'heldRanged');
      };
    }
    case 'item.swept': { const policy = await readAssemblyInput(product, row.policy); return run => { installSweptMelee(run, shard.items.rows, policy); }; }
    case 'loadout': {
      const policy = need(shard.items.loadout.native, 'Missing native loadout');
      need(policy.input, 'Missing native equipment input policy');
      return run => { bindLoadout(run, policy); };
    }
    case 'ammunition': {
      const held = product.section('held/loadout');
      return run => { const ammunition = installNativeHeldAmmunition(run.host, held, shard.items); run.host.onStep(row.step, () => { ammunition.update(); }, undefined, 'afterBodies'); run.host.events.on('player.respawned', ({player}) => { if(player!==undefined)ammunition.refillFor(player,row.refill); }, run.host.scope); run.ammunition = ammunition; };
    }
    case 'boss.ground': {
      const encounter = await readAssemblyInput<{ profile: unknown; kind?: unknown }>(product, row.encounter);
      // OF30: a product with no species programme gives the boss its decision and body in its binding, its strikes in `actors/strikes`
      const kept = keptSpeciesPrograms(product);
      const program = kept !== undefined ? need(kept.program, 'Native boss needs its decision programme')
        : declaredBossProgram(shard.rows, parseRoamingEncounter(encounter, encounter.profile).kind, parse(NativeBossBindingSchema, row.binding),
          product.has('actors/strikes') ? product.section('actors/strikes') : []);
      return run => { run.boss = installGroundBoss(run.host, encounter, encounter.profile, program, row.binding, at.ports.grantItem(run.context), shard.creatures.spawns); };
    }
    case 'population.environment': { const input = await readAssemblyInput(product, row.rows); return run => { installPopulationEnvironment(run.host, need(at.grid, 'Population environment needs its grid'), input); }; }
    case 'population.shelter': { const input = await readAssemblyInput(product, row.rows); return run => { installNativeHerdShelter(run.host, rows['shelterTrees'] as Parameters<typeof installNativeHerdShelter>[1], input); }; }
    case 'population.roster': {
      const input = await readAssemblyInput<{ step: string }>(product, row.rows);
      // OF30: a roster with no species programme runs its own named declared species and hunt
      const population = keptSpeciesPrograms(product) ?? declaredRosterPopulation(shard.rows, shard.creatures, parseNativePopulationRows(input));
      return run => { installPopulationRoster(run.host, { population, bake: bake as Parameters<typeof installPopulationRoster>[1]['bake'], nav, spawnY: shard.spawn.y, saved: run.context.snapshot }, input); };
    }
    case 'population.elites': { const input = await readEliteFeature(product, row.file); return run => { run.elites = installNativeEliteFeature(run.host, dayOf(run), input, shard.creatures.spawns); }; }
    case 'population.spawn-script': { const input = await readSpawnScript(product, row.id); return run => { installNativeSpawnScript(run.host, dayOf(run), input, undefined, undefined, undefined, { spawns: shard.creatures.spawns, restoring: run.context.restoring }); }; }
    case 'population.elites-ready': return run => { need(run.elites, 'Native elites are not installed').initialize(); };
    // SHARD-COMPAT CP16, FORMAT-PRUNE FP21 s8: ONE-FORMAT OF22c3 retired Driftwood\'s island population (its writers declare
    // the creatures since OF22b4, OF22c2), but kept originals Driftwood r4 (prod\'s head) and r5 still name it, so it stands for them
    case 'population.mixed': return prepareMixed(row, at);
    case 'population.reactions': return run => {
      const island = need(run.island, 'Item reactions need the island population');
      run.host.events.answer('item.reaction', reaction => { if (reaction.kind === 'alarm') island.alarm(); else island.staggered(reaction.actor, reaction.strength, reaction.running); return reaction; }, run.host.scope);
    };
    case 'population.settle': return run => { need(run.island, 'Settling needs the island population').settle(); };
    case 'population.poses': return run => { run.host.onStep(row.step, need(run.island, 'Poses need the island population').publishPoses, undefined, 'afterBodies'); };
    case 'quest.composition': return prepareQuest(row, at);
    case 'quest.body-scripts': return run => { installBodyScripts(run.host, run.context, { product, assets: at.assets }); };
    case 'quest.kill-steps': {
      const input = await readAssemblyInput(product, row.rows), counters = parseAchievementCounterData(await readAssemblyInput(product, row.counters));
      // OF22e1: the island's bodies where the plan stands it, then the declared bodies (a body's kind is its species row's)
      return run => {
        const island = run.island === undefined ? undefined : rosterKind(run.island.bodies), declared = declaredQuestBodies(run.host, shard);
        installQuestKillSteps(run.host, input, counters.feats, actor => island?.(actor) ?? declared.kindOf(actor), need(run.input, 'Kill steps need their commands').ledger.fact);
      };
    }
    case 'quest.chapter': {
      const director = await readDirectorDocument(product), input = parseChapterDirector(await readAssemblyInput(product, row.rows)), wake = parseChapterWake(await readAssemblyInput(product, row.wake));
      const captain = rows['captain'] as { pool: { x: number; z: number }; arena: unknown };
      // OF22c1: a wake row naming a declared spawn with a boss encounter wakes that fight, not the population's reserved body
      const fight = declaredWakeFight(product.shardfile, wake.spawn);
      return run => {
        const declared = fight === undefined ? undefined : { ...fight, summon: () => { need(run.declared?.get(fight.entity), 'A declared wake needs its encounter').summon(); } };
        installNativeChapterDirector(run.host, director, { id: row.id, rows: input, ...(row.reward === undefined ? {} : { reward: row.reward }), wake: { ...(row.population === undefined ? {} : { population: row.population }), encounter: wake.encounter, placement: { pool: { x: captain.pool.x, z: captain.pool.z }, arena: captain.arena }, cues: wake.cues.map(({ id, operation }) => ({ id, operation })) } }, run.context.restoring, declared);
      };
    }
    default: throw new Error('Unknown native assembly host');
  }
}
