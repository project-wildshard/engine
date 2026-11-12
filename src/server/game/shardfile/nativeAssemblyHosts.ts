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
import { parseNativeQuestComposition } from '@wildshard/format/nativeQuestComposition';
import { QuestRuntimeDocumentSchema } from '@wildshard/format/questRuntime';
import { TOON_DAY_PRESET } from '@wildshard/format/toonLook';
import { parseWeatherProgram } from '@wildshard/format/weatherProgram';
import { parse } from 'valibot';
import { installGroundBoss } from '../boss/native';
import { EliteCore, memoryElitePersistence, type EliteCoreRule, type EliteCoreScript } from '../../../shared/game/eliteSystem';
import { installNativeHeldAmmunition } from '../loadout/nativeAmmunition';
import { prepareHeldArms } from '../weapons/nativeHeld';
import { openArenaArrows, prepareOpenArena, type OpenArenaPlan } from '../boss/openArenaNative';
import { patrolOf, preparePatrol } from '../boss/patrolNative';
import { prepareSlots } from '../boss/slotsNative';
import type { Wind } from '@wildshard/engine/world/steppeWind';
import { dayClock } from '../../../shared/game/looks/dayClock';
import { keyedSkyDaySpec } from '../../../shared/game/looks/keyedSkyClock';
import { readDirectorProduct } from '../../../shared/game/plugin/director';
import { installNativeItems, otherCombatFrame } from '../plugin/nativeItems';
import { addBakedPieces, bindNativeLoadout, weaponRow } from '../plugin/simulation';
import { installHostPortalRide, type PortalRideRows } from '../../../shared/game/shardfile/portalRide';
import { installPopulationEnvironment } from '../population/environment';
import { installMixedPopulation, type MixedPopulationInput } from '../population/mixedRoster';
import { installNativeCollision } from '../population/nativeBake';
import { NativeWildEnvironment } from '../population/nativeManager';
import { ReturnProgram } from '../../../shared/game/population/returnProgram';
import { installPopulationRoster } from '../population/roster';
import { installNativeHerdShelter } from '../population/shelter';
import { installNativeSpawnScript, readSpawnScript } from '../population/spawnScript';
import { headlessSpecCatalogue } from '../population/specCatalogue';
import { ownContractCatalogue } from '../../../shared/game/quest/contracts';
import type { AnimalSim } from '@wildshard/engine/entities/AnimalSim';
import { installNativeEliteFeature, readEliteFeature } from '../quest/eliteFeature';
import { eliteDrops } from '../quest/eliteDrops';
import { installQuestKillSteps } from '../quest/killSteps';
import { installNativeChapterDirector } from '../quest/nativeChapter';
import { installNativeQuestComposition, readNativeQuestSpots, type NativeQuestCompositionInput } from '../quest/nativeComposition';
import { readNativeQuestSecret } from '../quest/nativeSecret';
import { installMountedPlayer } from '../riding/native';
import { installNativeBootRoster, installNativePopulationHunt, type NativePopulationBootRows } from '../riding/nativePopulation';
import { installNativeTaming, type NativeTamingRows } from '../riding/nativeTaming';
import { prepareNativeStealth } from '../stealth/nativeStealth';
import { installGrapple } from '../grapple/native';
import { arenaSpecies, installArenaEntry } from '../boss/arenaRoomEntry';
import { parseGrappleProfile } from '@wildshard/format/grapple';
import { tagOf } from '@wildshard/engine/physics/surface';
import { installTrampleTrail } from '../../../shared/game/systems/looks/trampleField';
import { installWeatherContinuation, type NativeWeatherWorld } from '../weather/continuation';
import { nativeWeatherBundle, type WeatherReactions } from '../weather/reactions';
import { nativeDecisionAuthority } from './borrowedDecisions';
import { installNativeGroupRows } from './groupRuntime';
import { need, readAssemblyInput, type AssemblyPrepared, type NativeAssemblyContext } from './nativeAssemblyInput';
import { installBodyScripts, installCombatMotion } from './nativeRuntimeLoans';

/** What one install's hosts hand each other, in the plan's order. A later host reads what an earlier one left. */
export interface AssemblyRun<C extends NativeAssemblyContext> {
  readonly host: SimHost; readonly context: C; input: { readonly ledger: { readonly fact: (name: string, actorId: string) => void } } | null;
  day: DayCycleClock | null; boss?: ReturnType<typeof installGroundBoss>; quest?: ReturnType<typeof installNativeQuestComposition>;
  ammunition?: ReturnType<typeof installNativeHeldAmmunition>; elites?: ReturnType<typeof installNativeEliteFeature>;
  island?: ReturnType<typeof installMixedPopulation>; bindings?: NativeEliteBindings; roster?: ReturnType<typeof installNativeBootRoster>;
  weather?: { readonly wind: Wind; readonly storm: WeatherReactions }; patrol?: () => void; arena?: OpenArenaPlan;
  wild?: NativeWildEnvironment; groups?: ReturnType<typeof installNativeGroupRows>; nativeElites?: NativeEliteRoster; eliteCore?: ReturnType<typeof nativeEliteCore>; creatures?: ReturnType<typeof installNativePopulationHunt>; taming?: ReturnType<typeof installNativeTaming>;
}
type Step<C extends NativeAssemblyContext> = (run: AssemblyRun<C>) => void;
const combatOf = <C extends NativeAssemblyContext>(run: AssemblyRun<C>) => need(run.context.combat, 'Native assembly requires its combat frame');
const dayOf = <C extends NativeAssemblyContext>(run: AssemblyRun<C>): DayCycleClock => need(run.day, 'Native assembly host requires a day clock before it');
const bootOf = <C extends NativeAssemblyContext>(at: AssemblyPrepared<C>) => need(at.boot, 'Native assembly host requires boot rows') as NativePopulationBootRows & {
  riding: NativeTamingRows['programs'] & { riding: unknown }; rest: NativeTamingRows['rest']; mountable: readonly string[] };
const fieldOf = <C extends NativeAssemblyContext>(at: AssemblyPrepared<C>) => need(at.field, 'Native assembly host requires its field');

async function prepareQuest<C extends NativeAssemblyContext>(row: Extract<NativeAssemblyFeature, { host: 'quest.composition' }>, at: AssemblyPrepared<C>): Promise<Step<C>> {
  const { product } = at, shard = product.shardfile, read = <T>(input: Parameters<typeof readAssemblyInput>[1]): Promise<T> => readAssemblyInput<T>(product, input);
  const counters = parseAchievementCounterData(await read(row.counters)), content = row.document === undefined ? undefined : parse(QuestRuntimeDocumentSchema, await read(row.document));
  const spots = await read<NativeQuestCompositionInput['spots']>(row.spots), contracts = row.contracts === undefined ? undefined : await read<NonNullable<NativeQuestCompositionInput['contracts']>>(row.contracts);
  const table = row.table === undefined ? need(content, 'Native quest needs a table').table : await read<NativeQuestCompositionInput['table']>(row.table);
  const rows = parseNativeQuestComposition(await read(row.rows)), director = row.director === true ? await readDirectorProduct(product) : undefined;
  const feats = counters.feats.filter(feat => feat.kind === undefined);
  const native = row.nativeFeats !== true ? counters : parseAchievementCounterData({ ...counters, feats, write: 'each',
    flags: feats.map(feat => counters.flags.find(flag => flag.id === feat.id) ?? { id: feat.id, method: 'count', value: { constant: 0 } }) });
  const props = row.props === undefined ? undefined : await read<unknown>(row.props);
  const trades = row.barter === true ? parseBarterEconomy(need(shard.rows.loot[0], 'Missing barter row').economy).exchange : undefined;
  const secret = content === undefined ? undefined : await readNativeQuestSecret(product);
  return run => { run.quest = installNativeQuestComposition(run.host, { source: shard, table, rows, spots: row.readSpots === true ? readNativeQuestSpots(spots) : spots, counters: native,
    ...(content === undefined ? {} : { steps: content.steps, deaths: content.deaths, readings: content.readings, lead: content.lead }),
    ...(contracts === undefined ? {} : { contracts: ownContractCatalogue(contracts, run.host.scope) }), ...(trades === undefined ? {} : { trades }), ...(director === undefined ? {} : { director }),
    ...(props === undefined ? {} : { props }), ...(secret === undefined ? {} : { secret }), ...(row.restoring === true ? { restoring: run.context.restoring } : {}) }); };
}
async function prepareMixed<C extends NativeAssemblyContext>(row: Extract<NativeAssemblyFeature, { host: 'population.mixed' }>, at: AssemblyPrepared<C>): Promise<Step<C>> {
  const { product, bake, nav } = at, shard = product.shardfile, species = product.section('actors/species-programs');
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
      run.roster = installNativeBootRoster(run.host, { boot: bootOf(at), bake: bake as Parameters<typeof installNativeBootRoster>[1]['bake'], spawnY: shard.spawn.y, clock: { phase: dayOf(run).dayPhase, storm: false }, elites: run.bindings, field });
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
      const profile = await readAssemblyInput<object>(product, row.profile), { world } = at;
      return run => { const boot = bootOf(at); installMountedPlayer(run.host, { ...profile, world, mountable: boot.mountable.concat(need(run.creatures, 'Riding needs its creatures').bondedHorseIds()), program: boot.riding.riding }, need(at.pond, 'Riding needs its pond'), at.wet); };
    }
    case 'boss.arena': {
      const input = await readAssemblyInput<unknown>(product, { file: row.file }), spec = arenaSpecies(await readAssemblyInput<unknown>(product, { file: 'server/arena-species.json' }));
      return run => { if (run.context.room === true) installArenaEntry(run.host, input, row, { spec, grantItem: at.ports.grantItem(run.context), snapshot: run.context.snapshot }); };
    }
    case 'held.arms': {
      const arms = await prepareHeldArms(product, { ...row, weather: await readAssemblyInput<unknown>(product, row.weather) }), stealth = prepareNativeStealth(product);
      return run => { if (run.context.room === true) { installCombatMotion(run.host, run.context, row.speed); const tick = at.ports.heldTick(run.context);
        arms(run.host, { combat: combatOf(run), room: true, tick, arrowTargets: openArenaArrows,
          contacts: (host, from, direction, distance, hit) => patrolOf(host)?.target(from, direction, distance, hit) ?? hit });
        // SS4: the sneak shot the page doubles, decided here from each player's own Hidden state. Installed after the arms so
        // exportSeats keeps its indexes; a shot therefore reads the state one tick old, where the page reads the same frame's.
        stealth?.(run.host, { tick, groups: run.groups }); } };
    }
    case 'encounter.patrol': {
      if (at.ports.room !== true) return () => undefined;
      const external = await readAssemblyInput<readonly unknown[]>(product, row.external), patrol = await preparePatrol(product, { ...row, external }), slots = await prepareSlots(product, row);
      const elites = at.plan.features.find((feature): feature is Extract<NativeAssemblyFeature, { host: 'riding.elites' }> => feature.host === 'riding.elites');
      const kernels = elites === undefined ? [] : (await readAssemblyInput<{ readonly kernels: readonly { readonly knockdown: CaptainKnock }[] }>(product, elites.rows)).kernels;
      const [kernel] = kernels, ride = elites === undefined || kernel === undefined ? null : await prepareCaptain(product, external, row.actors, kernel.knockdown), fly = kernel === undefined ? null : prepareWindElite(product, kernel.knockdown);
      return run => {
        let captain: NativeCaptain | null = null, windElite: NativeWindElite | null = null;
        const finish = patrol.begin(run.host, { eliteDamage: (host, actor, request) => captain?.scale(actor, request.point) ?? run.arena?.eliteDamage(host, actor, request) ?? 1, beforePatrol: (host, dt) => { slots?.advance(host, dt); captain?.advance(dt); windElite?.advance(dt); }, afterPatrol: (host, dt) => { run.arena?.advance(host, dt); } });
        run.patrol = () => {
          finish(); slots?.install(run.host, need(run.bindings, 'Slots need their bindings'), run.context.restoring);
          if (ride !== null && elites !== undefined) { captain = ride(run.host, decisions => nativeEliteCore(run.host, elites.conditions, decisions, dayOf(run), need(run.wild, 'A captain needs his environment')), `${row.step}.captain`); if (captain.lair.record !== undefined) need(run.eliteCore, 'A captain needs the world\'s lairs').share(captain.lair.id, captain.lair.record); }
          if (fly !== null && elites !== undefined) {
            const env = need(run.wild, 'A wind elite needs its environment'), world = need(run.eliteCore, 'A wind elite needs the world\'s lairs');
            windElite = fly(run.host, need(run.bindings, 'A wind elite needs its bindings'), () => nativeEliteCore(run.host, elites.conditions, ReturnProgram.native(run.host, bootOf(at).admission), dayOf(run), env), `${row.step}.wind`, () => env.wind);
            if (windElite.lair.record !== undefined) world.share(windElite.lair.id, windElite.lair.record);
          }
        };
      };
    }
    case 'boss.open-arena': {
      if (at.ports.room !== true) return () => undefined;
      const arena = await prepareOpenArena(product, row);
      return run => {
        const { host, context } = run; run.arena = arena;
        arena.observeWeather(host, need(run.weather, 'An open arena needs its weather')); arena.cover(host); need(run.patrol, 'An open arena needs its patrol')();
        arena.install(host, { presentation: need(at.ports.arena, 'An open arena needs its presentation'), commands: at.ports.heldTick(context).commands, ledger: at.ports.ledger(context), restoring: context.restoring, grantItem: at.ports.grantItem(context) });
      };
    }
    case 'grapple': {
      const profile = parseGrappleProfile(await readAssemblyInput<unknown>(product, row.profile)), hooks = await readAssemblyInput<readonly { readonly x: number; readonly y: number; readonly z: number }[]>(product, row.hooks);
      const mode = shard.modes?.grapple?.find(entry => entry.id === row.mode);
      if (mode === undefined) throw new Error(`Grapple row names no mode ${row.mode}`);
      return run => {
        const { context } = run, guard = context.restoring ? [] : run.host.physics.world.colliders.getAll().filter(collider => tagOf(collider)?.owner === row.guard).map(collider => collider.handle);
        installGrapple(run.host, at.ports.grappleTick(context), profile, mode, hooks, guard, row.rise === true);
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
      // GC15: a cell open onto the road leaves out the shard's own page walls, as a cell held near its player does (`nativeBake.ts`).
      return run => { if (row.skipOnRestore !== true || !run.context.restoring) installNativeCollision(run.host, at.bake, (run.context.road === true ? { ...collision, omit: [...(collision as { omit?: readonly string[] }).omit ?? [], 'edge'] } : collision) as Parameters<typeof installNativeCollision>[2]); };
    }
    case 'collision.pieces': { const pieces = await readAssemblyInput<unknown>(product, row.rows); return run => { if (!run.context.restoring) addBakedPieces(run.host.physics, pieces); }; }
    case 'portal.ride': {
      const ride = await readAssemblyInput<PortalRideRows>(product, row.rows);
      return run => { installHostPortalRide(run.host, row.step, shard, ride, at.ports.ledger(run.context).fact); };
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
      };
    }
    case 'item.swept': { const policy = await readAssemblyInput(product, row.policy); return run => { installNativeItems(run.host, combatOf(run), { kind: 'swept', items: shard.items.rows, policy }); }; }
    case 'loadout': {
      const policy = need(shard.items.loadout.native, 'Missing native loadout'), input = need(policy.input, 'Missing native equipment input policy');
      return run => { const combat = combatOf(run); bindNativeLoadout(run.host, policy, { flags: run.host.flags, frame: combat,
        locked: () => run.boss?.locked() === true || run.quest?.riding() === true || run.quest?.talking() === true,
        others: { frame: player => otherCombatFrame(combat, player.id), locked: () => run.boss?.locked() === true },
        step: { id: input.step, phase: input.phase, pick: (player, first) => {
          if (!first) return otherCombatFrame(combat, player.id).scripts.get(input.command) ?? null;
          const taken = run.quest?.takePickup() === true ? 1 : null; return combat.scripts.get(input.command) ?? taken;
        } } }); };
    }
    case 'ammunition': {
      const held = product.section('held/loadout');
      return run => { const ammunition = installNativeHeldAmmunition(run.host, held, shard.items); run.host.onStep(row.step, () => { ammunition.update(); }, undefined, 'afterBodies'); run.host.events.on('player.respawned', ({player}) => { if(player!==undefined)ammunition.refillFor(player,row.refill); }, run.host.scope); run.ammunition = ammunition; };
    }
    case 'boss.ground': {
      const encounter = await readAssemblyInput<{ profile: unknown }>(product, row.encounter), program = need(product.section('actors/species-programs').program, 'Native boss needs its decision programme');
      return run => { run.boss = installGroundBoss(run.host, encounter, encounter.profile, program, row.binding, at.ports.grantItem(run.context)); };
    }
    case 'population.environment': { const input = await readAssemblyInput(product, row.rows); return run => { installPopulationEnvironment(run.host, need(at.grid, 'Population environment needs its grid'), input); }; }
    case 'population.shelter': { const input = await readAssemblyInput(product, row.rows); return run => { installNativeHerdShelter(run.host, rows['shelterTrees'] as Parameters<typeof installNativeHerdShelter>[1], input); }; }
    case 'population.roster': {
      const input = await readAssemblyInput<{ step: string }>(product, row.rows), population = product.section('actors/species-programs');
      return run => { installPopulationRoster(run.host, { population, bake: bake as Parameters<typeof installPopulationRoster>[1]['bake'], nav, spawnY: shard.spawn.y, saved: run.context.snapshot }, input); };
    }
    case 'population.elites': { const input = await readEliteFeature(product, row.file); return run => { run.elites = installNativeEliteFeature(run.host, dayOf(run), input); }; }
    case 'population.spawn-script': { const input = await readSpawnScript(product, row.id); return run => { installNativeSpawnScript(run.host, dayOf(run), input); }; }
    case 'population.elites-ready': return run => { need(run.elites, 'Native elites are not installed').initialize(); };
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
      return run => { installQuestKillSteps(run.host, input, counters.feats, need(run.island, 'Kill steps need the island population').bodies, need(run.input, 'Kill steps need their commands').ledger.fact); };
    }
    case 'quest.chapter': {
      const director = await readDirectorProduct(product), input = parseChapterDirector(await readAssemblyInput(product, row.rows)), wake = parseChapterWake(await readAssemblyInput(product, row.wake));
      const captain = rows['captain'] as { pool: { x: number; z: number }; arena: unknown };
      return run => { installNativeChapterDirector(run.host, director, { id: row.id, rows: input, reward: row.reward, wake: { population: row.population, encounter: wake.encounter, placement: { pool: { x: captain.pool.x, z: captain.pool.z }, arena: captain.arena }, cues: wake.cues.map(({ id, operation }) => ({ id, operation })) } }, run.context.restoring); };
    }
    default: throw new Error('Unknown native assembly host');
  }
}
