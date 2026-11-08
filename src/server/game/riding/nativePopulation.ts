import { NativePastureRaid } from './pastureController';
import type { PastureCues } from '../../../shared/game/riding/pastureCues';
import * as v from 'valibot';
import { ATTACK_TURN, type HuntBody, type HuntNav } from '@wildshard/engine/ai/hunt';
import type { StalkerBrain } from '@wildshard/engine/ai/stalker';
import { Rng, type RngState } from '@wildshard/engine/core/rng';
import type { SimHost } from '@wildshard/engine/sim';
import type { SimSnapshot } from '@wildshard/engine/sim/snapshot';
import type { AnimalSim, AnimalSimSpec } from '@wildshard/engine/entities/AnimalSim';
import { nativeBodySchema } from '@wildshard/format/nativePhysics';
import { SpeciesSchema } from '@wildshard/format/speciesPrograms';
import { parseFlock } from '@wildshard/format/crowds';
import { ForagerContinuation as MarmotContinuation, ForagerPopulationSchema } from '@wildshard/format/ambientLife';
import { ForagerPopulation } from '@wildshard/engine/ai/ambientForager';
import { FlockBrain, type FlockPorts } from '@wildshard/engine/ai/flock';
import type { PackBrain } from '@wildshard/engine/ai/pack';
import type { HerdBrain } from '@wildshard/engine/ai/herd';
import { nativeGroupCollection, nativeHerdCollection } from '../shardfile/groupRuntime';
import { creatureFloor, admitNativeRosterServices, createNativeCreatureRoster, NativeDeferredRoster, type NativeCreatureSlot } from '../shardfile/homeKeeper';
import { BondedMountRoster } from './roster';
import { mountedPlayerOf } from './native';
import { nativeTamingOf } from './nativeTaming';
import { installWildRefill } from './wildRefill';
import { createNativeHunt } from '../plugin/brain';
import { NativePopulationField } from '../population/environment';
import type { NativeEliteBindings } from '@wildshard/engine/ai/eliteRoster';
import { ReturnProgram } from '../../../shared/game/population/returnProgram';
import { NativeManager, NativePopulationDriver, NativeWildlifeFrame, type NativeWildlifeRows } from '../population/nativeManager';

const finite = v.pipe(v.number(), v.finite());
const SpawnTable = v.pick(SpeciesSchema, ['kind', 'variants', 'spawnOnly']);
const Stream = v.strictObject({ version: v.literal(1), state: finite, initial: finite, scrambledFork: v.boolean() });
const Memory = v.record(v.string(), v.union([finite, v.boolean(), v.array(v.tuple([finite, finite, finite]))]));
const RaidBody = v.strictObject({ id: v.string(), variant: v.string(), seed: finite, scale: finite,
  at: v.tuple([finite, finite, finite]), yaw: finite, adopted: Stream });
const EliteSpawn = v.strictObject({ body: RaidBody, kind: v.string() });
const BondedSpawn = v.strictObject({ body: RaidBody, upgraded: v.boolean() });
const PopulationPack = v.strictObject({ x: finite, z: finite, herd: v.pipe(finite, v.integer()), bodies: v.array(RaidBody) });
const PopulationSaved = v.strictObject({ calm: v.exactOptional(v.boolean()), rng: Stream, clock: finite, speed: v.strictObject({ init: v.boolean(), x: finite, z: finite, v: finite }),
  seen: v.array(v.boolean()), memories: v.array(v.tuple([v.string(), Memory])), herds: v.array(v.tuple([finite, finite])),
  // the declared groups' continuations (PackBrain / HerdBrain `snapshot()`), packs then herds: they decide on this step
  groups: v.array(v.string()),
  // Wildlife's own smoothed player speed (the flocks read it) and the flocks' continuations (FlockBrain `snapshot()`)
  wild: v.strictObject({ init: v.boolean(), x: finite, z: finite, v: finite, at: v.exactOptional(finite),
    company: v.exactOptional(v.record(v.string(), v.strictObject({ x: finite, z: finite, v: finite, at: finite }))) }), flocks: v.array(v.string()),
  marmots: MarmotContinuation, placement: Stream, raids: v.array(PopulationPack), elitePacks: v.array(PopulationPack), dormant: v.array(v.string()), elites: v.array(EliteSpawn),
  bonded: v.exactOptional(v.pipe(v.array(BondedSpawn), v.maxLength(32))), hiddenStallions: v.exactOptional(v.pipe(v.array(v.string()), v.maxLength(32))),
  retired: v.array(v.string()), nextId: v.pipe(finite, v.integer(), v.minValue(0)), dodgeCd: v.pipe(finite, v.minValue(0)), otherDodges: v.exactOptional(v.record(v.string(), finite)) });
type SavedMemory = v.InferOutput<typeof Memory>;


/** Data bound to the existing native hunt, group and roster owners. */
export interface NativePopulationConfig {
  step: string; raidStep: string; groups: string; herds: string; tokens: string; preyPrefix: string;
  packKind: string; dogKind: string; eliteKinds: readonly string[]; motorKinds: readonly string[]; retiredY: number;
  variants: readonly { kind: string; rows: readonly { id: string; scale: readonly [number, number] }[] }[];
  flocks: readonly { row: unknown; dog: boolean }[]; forager: { row: unknown; seed: number };
  frame: NativeWildlifeRows; driver: { dispatch: string;projection?:unknown;readonly alwaysKinds?:readonly string[] };
  companion: { id: string; kind: string; variant: string; wildKinds: readonly string[] };
  shepherdOffset: readonly [number, number]; raidVariants: readonly string[];
}
export interface NativePopulationBoot {
  admission: unknown; pasture: unknown; streamSeed: number; species: Readonly<Record<string, unknown>>; recipes: readonly AnimalSimSpec[];
}
/** Boot identity rows join the admitted physics bake before any body exists. */
export interface NativePopulationBootBody {
  readonly id: string; readonly kind: string; readonly variant: { readonly id: string }; readonly seed: number; readonly scale: number;
  readonly herd: number; readonly position: { readonly x: number; readonly z: number }; readonly yaw: number;
  readonly adopted: { readonly stream: RngState; readonly x: number; readonly z: number };
}
export interface NativePopulationBootHerd { readonly kind: string; readonly cx: number; readonly cz: number; readonly members: readonly NativePopulationBootBody[] }
export interface NativePopulationBootRows extends NativePopulationBoot {
  readonly phases: readonly string[]; readonly hunt: Readonly<Record<string,unknown>>;
  readonly roster: { readonly bodies: readonly NativePopulationBootBody[]; readonly herds: readonly NativePopulationBootHerd[]; readonly stream: RngState; readonly wildStream: RngState };
}
interface BootBake {
  readonly actors: readonly { readonly id: string; readonly kind: string; readonly variant: string; readonly seed: number; readonly scale: number; readonly herd: number; readonly spec: AnimalSimSpec; readonly scripted: boolean }[];
  readonly herds: readonly { readonly kind: string; readonly members: readonly string[] }[];
}
/** Compare the exact admitted identity join before spawning on native floors. */
export function installNativeBootRoster(host: SimHost, ports: { boot: NativePopulationBootRows; bake: BootBake; field: NativePopulationField; spawnY: number;
  clock: { readonly phase: string; readonly storm: boolean }; elites: NativeEliteBindings }): {
  bodies: { boot: NativePopulationBootBody; baked: BootBake['actors'][number]; actor: AnimalSim }[]; herds: readonly NativePopulationBootHerd[]; stream: RngState; wildStream: RngState;
} {
  const { bake,boot,field } = ports, roster = structuredClone(boot.roster);
  if (!(field instanceof NativePopulationField) || !boot.phases.includes(ports.clock.phase) || ports.clock.storm) throw new Error('Native boot phase is not hosted');
  if (roster.bodies.length !== bake.actors.length || JSON.stringify(roster.herds.map(h => ({ kind: h.kind,members: h.members.map(m => m.id) }))) !== JSON.stringify(bake.herds)
    || roster.bodies.some((row,index) => { const body = bake.actors[index]; return body?.id !== row.id || body.kind !== row.kind || body.variant !== row.variant.id || body.seed !== row.seed || body.scale !== row.scale || body.herd !== row.herd; })) throw new Error('Native boot roster diverges from its admitted bake');
  host.useBodyBands({ present: actor => !ports.elites.absent.has(actor) && (!('hidden' in actor) || actor.hidden !== true),
    rate: actor => actor.driven || actor.state === 'sidestep' || ports.elites.pinned.has(actor) ? 'always' : 'ai' });
  const floorAt = creatureFloor(host,field.hunt.heightAt);
  const bodies = roster.bodies.map((row,index) => {
    const baked = bake.actors[index]; if (baked === undefined) throw new Error('Missing native boot body');
    const { x,z } = row.position, at = floorAt(x,z,Math.max(ports.spawnY,field.hunt.heightAt(x,z))+1);
    const actor = host.spawn({ id: row.id,spec: baked.spec,seed: row.seed,scale: row.scale,at: { x,y: at.y,z },yaw: row.yaw });
    actor.levelGround = at.structure; if (at.structure) actor.groundHeight = (px,pz,py) => floorAt(px,pz,py).y;
    actor.herd = row.herd; actor.scripted = baked.scripted; actor.attackTurnCap = ATTACK_TURN; return { boot: row,baked,actor };
  });
  return { bodies,herds: roster.herds,stream: roster.stream,wildStream: roster.wildStream };
}
/** Bind the built-in hunt to an admitted world owner, rather than shard queries. */
export function installNativePopulationHunt(host: SimHost, ports: NativePopulationBindings & { boot: NativePopulationBootRows; field: NativePopulationField; nav: HuntNav }): NativePopulation {
  if (!(ports.field instanceof NativePopulationField)) throw new Error('Missing native population field');
  const rng = new Rng(ports.boot.streamSeed);
  const { hunt } = createNativeHunt(host,{ limit: 64,fight: { telegraphed: true },player: 'origin',bands: null,hit: { namespace: 'creature',tags: ['feel.blow','cover.checked'] } },
    { rng,ground: ports.field.hunt,nav: ports.nav,species: new Map(Object.entries(ports.boot.hunt).map(([kind,row]) => [kind,v.parse(v.object(v.pick(SpeciesSchema,['aggressive','tuning','sounds','walkSpeed','chargeSpeed','chargeWindup','ringRadius']).entries),row)])) });
  hunt.navSteer = true; return installNativePopulation(host,hunt,rng,ports);
}
export interface NativePopulationBindings {
  boot: NativePopulationBoot; config: NativePopulationConfig;
  bodies: readonly { actor: AnimalSim; boot: { id: string; seed: number; adopted: { x: number; z: number; stream: RngState } } }[];
  herds: readonly { kind: string; cx: number; cz: number }[]; stream: RngState; wildStream: RngState;
  bake: { actors: readonly { spec: AnimalSimSpec }[]; marmots: unknown }; spawnY: number; elites: NativeEliteBindings; snapshot?: Readonly<Omit<SimSnapshot, 'physics'>>;
  /** CI12: the raid's presentation cues (the page's PagePastureRaid rows), read by a native tape; absent, none are kept */
  pastureCues?: PastureCues;
}
/** The feature's concrete native owners and ordinary actor-id actions. */
export interface NativePopulation {
  /** The original encounter-owned calm state; false is omitted from old saves. */
  calm: boolean;
  readonly id: string;
  readonly host: SimHost;
  readonly hunt: StalkerBrain<HuntBody>; readonly rng: Rng; readonly bodies: readonly HuntBody[]; readonly flocks: readonly FlockBrain[];
  readonly scare: (x: number, z: number, radius?: number) => void;
  readonly raid: NativePastureRaid<AnimalSim, PackBrain<AnimalSim>>; readonly marmots: ForagerPopulation;
  readonly spawnElite: (kind: string, x: number, z: number, yaw: number, variant: string) => HuntBody;
  /** Preflight the same admitted encounter recipe without allocating or drawing. */
  readonly validateSpawn: (kind: string, variant: string) => void;
  /** Remaining native body capacity, including the installed population. */
  readonly available: () => number;
  readonly bondedHorseIds: () => readonly string[]; readonly retireElite: (actor: AnimalSim) => void;
  readonly spawnElitePack: (x: number, z: number, variants: readonly string[]) => PackBrain<AnimalSim>; readonly retirePack: (pack: PackBrain<AnimalSim>) => void;
  /** CI12: a kind's bodies decide and scale hits through its directed law (NativePopulationDriver.bindSpecies) */
  readonly bindSpecies: NativePopulationDriver['bindSpecies'];
}
const POP_BODY_MAX = 64, POP_GROUP_MAX = 8, POP_FLOCK_MAX = 4;
const nativePopulations = new WeakMap<SimHost, NativePopulation>();
export function nativePopulationOf(host: SimHost): NativePopulation | undefined { return nativePopulations.get(host); }
/** Extend the approved native mounted continuation around concrete game owners.
 * Config, source records and continuations are rows; no shard callback is bound. */
export function installNativePopulation(host: SimHost, hunt: StalkerBrain<HuntBody>, rng: Rng, ports: NativePopulationBindings): NativePopulation {
  const cfg = ports.config, groups = nativeGroupCollection(host, cfg.groups), env = groups.environment, ground = hunt.ground;
  if (env === undefined || nativePopulations.has(host)) throw new Error('Missing or installed native population world');
  const author = ReturnProgram.native(host, ports.boot.admission);
  if (ports.bodies.length > POP_BODY_MAX) throw new Error(`native population headless hosts at most ${String(POP_BODY_MAX)} manager bodies`);
  // the manager's herds (its hunting brain's), as the boot roster added them
  ports.herds.forEach(h => { hunt.addHerd(h.kind, h.cx, h.cz); });
  const spawnTables = new Map(Object.entries(ports.boot.species).map(([kind, row]) => [kind, v.parse(SpawnTable, row)]));
  const scaleVariants = new Map<string, readonly { readonly id: string; readonly scale: readonly [number, number] }[]>(
    [...spawnTables].map(([kind, row]) => [kind, [...row.variants, ...row.spawnOnly ?? []]]));
  for (const row of cfg.variants) scaleVariants.set(row.kind, row.rows);
  const intake = createNativeCreatureRoster<NativeCreatureSlot>(host, { specs: [...ports.bake.actors.map(row => row.spec), ...ports.boot.recipes],
    variants: scaleVariants,
    rng, spawnY: ports.spawnY, floorOffset: 1, attackTurnCap: ATTACK_TURN, services: admitNativeRosterServices(host, cfg.step, hunt), hunted: 'every' });
  const bodies: HuntBody[] = ports.bodies.map(({ actor }) => {
    const slot = intake.body(actor.entityId, actor.kind, actor.variant, actor.herd, actor.position, actor.yaw, [actor.scale, actor.scale], actor);
    slot.recipe.at.y = actor.position.y; return intake.attach(slot, actor);
  });
  // every body's memory where the page adopted it (the stream at its three draws)
  intake.adopt(ports.bodies.map(({ boot }) => ({ id: boot.id, seed: boot.seed,
    x: boot.adopted.x, z: boot.adopted.z, stream: boot.adopted.stream })), ports.stream);
  const packOf = new Map<AnimalSim, PackBrain<AnimalSim>>(), herdOf = new Map<AnimalSim, HerdBrain<AnimalSim>>();
  // the groups this step decides for, whose continuations its adapter carries
  const decided = (): readonly (PackBrain<AnimalSim> | HerdBrain<AnimalSim>)[] => [...groups.packs, ...groups.herds];
  groups.packs.forEach(p => { p.members.forEach(m => { packOf.set(m, p); }); });
  groups.herds.forEach(h => { h.members.forEach(m => { herdOf.set(m, h); }); if (h.stallion !== null) herdOf.set(h.stallion, h); });
  // Wildlife's flocks (creatures/wildlife.ts spawnFlock), on the engine's FlockBrain: the shipping flock's own rules (the
  // page's default creatures/flock.ts runs the same spans, test/fixtures/flock-oracle; its declared crowds run FlockBrain), each
  // set up on its own seed as Wildlife builds it, over the page's ground, water and wild view; its dog (the roster's sheepdogs in
  // order, one a flock that has one) thinks on the one sheepdog rule (species/sheepdog.ts) over the host's 'ai' stream
  const rows = cfg.flocks.map(row => parseFlock(row.row));
  if (rows.length > POP_FLOCK_MAX) throw new Error('Native flock bound exceeded');
  const flockPorts: FlockPorts = { heightAt: ground.heightAt, normalY: ground.normalY, inBounds: ground.inChunk,
    wetAt: ground.wetAt, playerCrouched: () => env.playerCrouched, grassHeightAt: (x,z) => env.grassHeightAt(x,z),
    trample: (x,z,r,s,vx,vz) => { env.trample(x,z,r,s,vx,vz); }, centre: () => undefined };
  // Wildlife's living wolves (its `wolves`: the pack's, in placement order), refreshed every frame (the page's `dogWolves`)
  const wildWolves = bodies.filter(a => a.kind === cfg.packKind && packOf.has(a)), wolves: HuntBody[] = [];
  const dogs = bodies.filter(a => a.kind === cfg.dogKind);
  let dogIndex = 0;
  const flocks = rows.map((row, i) => {
    const brain = new FlockBrain(flockPorts, row);
    brain.initialize();
    if (cfg.flocks[i]?.dog === true) {
      const dog = dogs[dogIndex++];
      if (dog === undefined) throw new Error(`native population flock ${String(i)} has no dog in the roster`);
      brain.dog = dog;
    }
    return brain;
  });
  const marmots = new ForagerPopulation(v.parse(ForagerPopulationSchema, cfg.forager.row), cfg.forager.seed);
  marmots.restore(ports.bake.marmots);
  const preyRows = groups.bindFlocks(flocks, cfg.preyPrefix);
  if (dogIndex !== dogs.length) throw new Error('native population roster has a sheepdog with no flock');
  const frame = new NativeWildlifeFrame(host, author, bodies, wildWolves, wolves, groups.packs, groups.herds, flocks, marmots, env.trampleField, cfg.frame);
  const wildScare = frame.scare.bind(frame);
  env.bind(host, frame);

  const manager = new NativeManager(host, hunt, rng, { limit: POP_BODY_MAX, sightSlots: bodies.length, initialSight: false });
  const speed = manager.noise, seen = manager.sight;
  const driver = new NativePopulationDriver(host, manager, hunt, rng, bodies, packOf, herdOf, ports.elites, flocks, wolves,
    { ...cfg.driver, tokens: cfg.tokens, program: ports.boot.admission, packKind: cfg.packKind, dogKind: cfg.dogKind, eliteKinds: cfg.eliteKinds }, groups);
  // A room's creatures sense the player nearest each of them: their stance, heading and health, not the first player's.
  driver.focused = () => {
    if (host.players.size < 2) return;
    const near = host.focusedPlayer, seat = mountedPlayerOf(host, near.id), vital = near.health.attributes;
    env.playerFwdX = -Math.sin(near.yaw); env.playerFwdZ = -Math.cos(near.yaw);
    env.playerCrouched = seat?.rider.crouching === true; env.playerMounted = seat?.mounted === true; env.playerHealth01 = vital.health / vital.maxHealth;
  };
  const placement = new Rng(0); placement.restore(ports.wildStream);
  const raids: v.InferOutput<typeof PopulationPack>[] = [], elitePacks: v.InferOutput<typeof PopulationPack>[] = [];
  const deferredSpec = (kind: string, variant: string) => v.parse(nativeBodySchema('axis'), ports.boot.recipes.find(row => row.kind === kind && row.variant === variant));
  const nextId = (): number => intake.identities.allocatorState().next;
  const continueIds = (next: number): void => { intake.identities.restoreAllocator({ next, used: intake.identities.allocatorState().used }); };
  continueIds(Math.max(-1, ...bodies.map(a => Number(a.entityId.slice('creature:'.length)))) + 1);
  const eliteSpawns: v.InferOutput<typeof EliteSpawn>[] = [], retired = new Set<string>();
  const mountRoster = new BondedMountRoster(host, { id: cfg.companion.id, services: cfg.step, herds: cfg.herds,
    kind: cfg.companion.kind, variant: cfg.companion.variant, wildKinds: cfg.companion.wildKinds, specs: ports.boot.recipes,
    scale: scaleVariants.get(cfg.companion.kind)?.find(row => row.id === cfg.companion.variant)?.scale ?? [1,1], spawnY: ports.spawnY, program: ports.boot.admission },
    { host, id: cfg.step, identities: intake.identities, random: rng, hunt, bodies, sight: seen, retired, flocks });
  const bonded = mountRoster.records, hiddenStallions = mountRoster.hidden;
  const stepWildRefill = installWildRefill(host, mountRoster, () => nativeHerdCollection(host, cfg.herds).herds, cfg.step, ports.snapshot);
  const deferred = new NativeDeferredRoster(host, intake, hunt, rng, bodies, seen, retired, ports.elites.absent,
    { limit: POP_BODY_MAX, spawnY: ports.spawnY, motorKinds: cfg.motorKinds, retiredY: cfg.retiredY });
  let reinstalling = ports.snapshot !== undefined;
  const makeBody = (saved: v.InferOutput<typeof RaidBody>, kind: string, herd: number): HuntBody => {
    const actor = deferred.materialize(saved, kind, herd, reinstalling); driver.admit(actor); if (kind === cfg.packKind) wildWolves.push(actor); return actor;
  };
  const finishPack = (record: v.InferOutput<typeof PopulationPack>, members: AnimalSim[], elite = false): PackBrain<AnimalSim> => {
    const pack = groups.addPack(members, record.x, record.z);
    members.forEach(a => { packOf.set(a, pack); }); (elite ? elitePacks : raids).push(record); return pack;
  };
  const rollBody = deferred.roll.bind(deferred);
  const freeSpot = (x: number, z: number, radius: number): { x: number; z: number } => {
    const attempts = v.parse(finite, author.project('begin', {})['attempts']);
    for (let i = 0; i < Math.min(attempts, 1024); i++) {
      const at = v.parse(v.object({ x: finite, z: finite }), author.project('spot', { x, z, radius }, placement));
      const clash = bodies.some(a => Math.abs(a.position.x - at.x) < 2 && Math.abs(a.position.z - at.z) < 2);
      if (author.project('accept', { ...at, normal: ground.normalY(at.x, at.z), height: ground.heightAt(at.x, at.z), water: ground.waterLevel(),
        wet: Number(ground.wetAt(at.x, at.z)), clash: Number(clash) })['accept'] === 1) return at;
    }
    return { x, z };
  };
  const spawnPack = (x: number, z: number, variants: readonly string[], elite = false): PackBrain<AnimalSim> => {
    if (author.project('pack', { elite: Number(elite), packs: raids.length, groups: decided().length, variants: variants.length, bodies: host.entities.size })['accept'] !== 1) throw new Error('native population raid pack bound exceeded');
    for (let i = 0; i < 5; i++) { const variant = variants[i]; if (variant === undefined) break; deferredSpec(cfg.packKind, variant); }
    const herd = hunt.herds.length; hunt.addHerd(cfg.packKind, x, z);
    const record: v.InferOutput<typeof PopulationPack> = { x, z, herd, bodies: [] };
    const radius = v.parse(finite, author.project('packPlan', {})['radius']);
    const members = variants.map(variant => {
      const at = freeSpot(x, z, radius), yaw = v.parse(finite, author.project('yaw', {}, placement)['yaw']);
      const saved = rollBody(cfg.packKind, variant, at.x, at.z, yaw); record.bodies.push(saved); return makeBody(saved, cfg.packKind, herd);
    });
    return finishPack(record, members, elite);
  };
  const spawnElite = (kind: string, x: number, z: number, yaw: number, variant: string): HuntBody => {
    if (!cfg.eliteKinds.includes(kind)) throw new Error('Foreign native elite kind');
    const body = rollBody(kind, variant, x, z, yaw);
    const a = makeBody(body, kind, -1); eliteSpawns.push({ kind, body }); return a;
  };
  const retireElite = (a: AnimalSim): void => {
    if (!cfg.eliteKinds.includes(a.kind)) throw new Error('Invalid native population elite retirement');
    deferred.release(a.entityId, 'retire');
    const extra = eliteSpawns.findIndex(row => row.body.id === a.entityId); if (extra !== -1) eliteSpawns.splice(extra, 1);
  };
  const spawnElitePack = (x: number, z: number, variants: readonly string[]): PackBrain<AnimalSim> => spawnPack(x, z, variants, true);
  const parkWolf = (actor: AnimalSim): void => { if (actor.kind !== cfg.packKind) throw new Error('Foreign native population pack member'); deferred.release(actor.entityId, 'park'); };
  const retirePack = (pack: PackBrain<AnimalSim>): void => {
    if (!elitePacks.some(record => record.bodies.length === pack.members.length && record.bodies.every((row, i) => row.id === pack.members[i]?.entityId))) throw new Error('Foreign native population elite pack');
    // A killed member stays in the manager as its real corpse. Only living members leave, in their shipping order.
    for (let i = 0; i < 5; i++) { const a = pack.members[i]; if (a === undefined) break; if (a.alive) parkWolf(a); }
  };
  // Strict state supplies only the roster at reinstall, in GLOBAL allocation order even when raids and elite respawns interleave.
  const restoreRoster = (): void => {
    if (ports.snapshot === undefined) return;
    const value = ports.snapshot.adapters.find(a => a.id === cfg.step)?.state;
    const saved = v.parse(PopulationSaved, value);
    if (saved.elites.some(row => !cfg.eliteKinds.includes(row.kind))) throw new Error('Foreign saved native elite');
    if (author.project('restoreBounds', { packs: saved.raids.length, groups: saved.elitePacks.length + saved.raids.length + decided().length,
      elites: saved.elites.length, retired: saved.retired.length, dormant: saved.dormant.length,
      unique: Number(new Set(saved.dormant).size === saved.dormant.length && new Set(saved.retired).size === saved.retired.length) })['accept'] !== 1) throw new Error('Invalid native population saved roster bounds');
    const initial = nextId();
    saved.retired.forEach(id => {
      if (!/^creature:\d+$/u.test(id) || Number(id.slice(9)) >= saved.nextId) throw new Error('Invalid native population retired id');
      const a = host.entities.get(id); if (a !== undefined) retireElite(a); else if (Number(id.slice(9)) < initial) throw new Error('Missing native population retired boot actor');
      retired.add(id);
    });
    const packs = [...saved.raids.map(record => ({ record, elite: false })), ...saved.elitePacks.map(record => ({ record, elite: true }))].sort((a, b) => a.record.herd - b.record.herd);
    const ids = new Set(packs.flatMap(({ record }) => record.bodies.map(body => body.id)));
    if (saved.dormant.some(id => !saved.elitePacks.some(pack => pack.bodies.some(body => body.id === id)) || saved.retired.includes(id))
      || ids.size !== packs.reduce((n, { record }) => n + record.bodies.length, 0)) throw new Error('Invalid native population dormant pack identities');
    for (let i = 0; i < POP_BODY_MAX; i++) {
      const id = saved.dormant[i]; if (id === undefined) break;
      const row = ports.snapshot.entities.find(actor => actor.id === id);
      if (row?.state.kind !== cfg.packKind || row.state.flags.alive || row.state.position[1] !== -9999 || row.motor !== null) throw new Error('Invalid native population dormant body');
    }
    packs.forEach(({ record, elite }) => {
      if (author.project('restorePack', { herd: record.herd, expected: hunt.herds.length, variants: record.bodies.length, elite: Number(elite) })['accept'] !== 1) throw new Error('Invalid native population saved raid herd');
      hunt.addHerd(cfg.packKind, record.x, record.z);
    });
    const spawnRows: { body: v.InferOutput<typeof RaidBody>; kind: string; herd: number }[] = [];
    for (let i = 0; i < POP_GROUP_MAX; i++) {
      const pack = packs[i]; if (pack === undefined) break;
      for (let j = 0; j < 5; j++) { const body = pack.record.bodies[j]; if (body === undefined) break; spawnRows.push({ body, kind: cfg.packKind, herd: pack.record.herd }); }
    }
    for (let i = 0; i < POP_BODY_MAX; i++) { const row = saved.elites[i]; if (row === undefined) break; spawnRows.push({ body: row.body, kind: row.kind, herd: -1 }); }
    const savedBond = saved.bonded?.[0];
    if (savedBond !== undefined && author.project('restoreBond', { variant: Number(savedBond.body.variant === cfg.companion.variant) })['accept'] !== 1) throw new Error('Foreign native population bonded body recipe');
    if (savedBond !== undefined) spawnRows.push({ body: savedBond.body, kind: cfg.companion.kind, herd: -1 });
    if (host.entities.size + spawnRows.length > POP_BODY_MAX || new Set(spawnRows.map(row => row.body.id)).size !== spawnRows.length) throw new Error('Invalid native population saved spawn bounds');
    spawnRows.sort((a, b) => Number(a.body.id.slice(9)) - Number(b.body.id.slice(9)));
    for (let i = 0; i < POP_BODY_MAX; i++) {
      const row = spawnRows[i]; if (row === undefined) break;
      if (author.project('restoreBody', { id: Number(row.body.id.slice(9)), initial: nextId(), nextId: saved.nextId, retired: Number(retired.has(row.body.id)) })['accept'] !== 1) throw new Error('Invalid native population active spawn id');
      const actor = row.kind === cfg.companion.kind ? mountRoster.materialize(row.body) : makeBody(row.body, row.kind, row.herd);
      const bond = saved.bonded?.find(b => b.body.id === row.body.id);
      if (bond?.upgraded === true) actor.scale = v.parse(finite, author.project('bond', { x: row.body.at[0], z: row.body.at[2], bonds: 0, elite: 1 })['scale']);
    }
    if (saved.nextId < nextId()) throw new Error('Invalid native population next spawn identity');
    continueIds(saved.nextId);
    packs.forEach(({ record, elite }) => { finishPack(record, record.bodies.map(b => {
      const a = host.entities.get(b.id); if (a === undefined) throw new Error('Missing restored native population raid actor'); return a;
    }), elite); });
    saved.dormant.forEach(id => { const a = host.entities.get(id); if (a === undefined) throw new Error('Missing dormant native population pack member'); parkWolf(a); });
    eliteSpawns.push(...saved.elites); bonded.push(...saved.bonded ?? []);
    const hidden = saved.hiddenStallions ?? [];
    if (new Set(hidden).size !== hidden.length) throw new Error('Duplicate native population tamed stallion');
    for (let i = 0; i < 32; i++) { const id = hidden[i]; if (id === undefined) break; const actor = host.entities.get(id); if (actor === undefined) throw new Error('Missing tamed native population stallion'); mountRoster.hide(actor.entityId); }
  };
  const firstFlock = flocks[0] ?? null;
  const horse = bodies.find(a => a.kind === cfg.companion.kind && a.herd === -1 && firstFlock !== null
    && a.position.x === firstFlock.cx + cfg.shepherdOffset[0] && a.position.z === firstFlock.cz + cfg.shepherdOffset[1]) ?? null;
  const raid = new NativePastureRaid<AnimalSim, PackBrain<AnimalSim>>(ReturnProgram.native(host, ports.boot.pasture), host.rng.stream('ai'), horse, firstFlock, groups.packs, i => {
    const prey = preyRows[0]?.[i]; if (prey === undefined) throw new Error('Unknown native population sheep'); return prey;
  }, spawnPack, groups.firstRaid, cfg.raidVariants, ports.pastureCues?.sink);
  host.onStep(cfg.raidStep, () => undefined, { snapshot: () => raid.snapshot(), restore: value => { raid.restore(value); } });
  const savePacks = (list: readonly v.InferOutput<typeof PopulationPack>[]): v.InferOutput<typeof PopulationPack>[] => list.map(r => ({ x: r.x, z: r.z, herd: r.herd, bodies: r.bodies.map(b => ({ id: b.id, variant: b.variant, seed: b.seed, scale: b.scale, at: [...b.at], yaw: b.yaw, adopted: { ...b.adopted } })) }));
  host.onStep(cfg.step, dt => {
    // Wildlife's frame: the player into the wild view, the grass movers, a stampede scaring the packs
    const near = host.focusedPlayer, yaw = near.yaw, fx = -Math.sin(yaw), fz = -Math.cos(yaw), fl = Math.hypot(fx, fz);
    if (fl > 1e-4) { env.playerFwdX = fx / fl; env.playerFwdZ = fz / fl; }
    const seat = mountedPlayerOf(host, near.id); env.playerCrouched = seat?.rider.crouching === true; env.playerMounted = seat?.mounted === true;
    const vital = near.health.attributes; env.playerHealth01 = vital.health / vital.maxHealth;
    frame.update(dt, env.playerCrouched);
    // Ride.update follows Wildlife and precedes the manager's think loop on the page.
    nativeTamingOf(host)?.update(dt);
    stepWildRefill(dt);
    // the raid watches for whoever is closest to the flock it hunts
    const flock = flocks[0]; raid.update(dt, (flock === undefined ? near : host.nearestPlayer({ x: flock.cx, y: near.position.y, z: flock.cz })).position, wolves, host.clock.now);
    driver.update(dt);
  }, {
    snapshot: () => {
      const ids = bodies.map(a => a.entityId), common = manager.snapshot(ids, ids);
      return ({ ...(driver.calm ? { calm: true } : {}), ...(bonded.length === 0 ? {} : { bonded: bonded.map(row => ({ upgraded: row.upgraded, body: { ...row.body, at: [...row.body.at], adopted: { ...row.body.adopted } } })) }),
      ...(hiddenStallions.size === 0 ? {} : { hiddenStallions: [...hiddenStallions] }), elitePacks: savePacks(elitePacks), dormant: [...ports.elites.absent].map(a => a.entityId), dodgeCd: driver.snapshot(), ...(Object.keys(driver.otherCooldowns()).length === 0 ? {} : { otherDodges: driver.otherCooldowns() }), nextId: nextId(), retired: [...retired], elites: eliteSpawns.map(row => ({ kind: row.kind, body: { ...row.body, at: [...row.body.at], adopted: { ...row.body.adopted } } })), rng: common.rng, clock: common.clock, speed: { init: speed.seen, x: speed.prev.x, z: speed.prev.z, v: speed.speed }, seen: common.sight.map(value => value === true),
      memories: bodies.flatMap((a, i) => { const memory = common.memories[i]; return memory === null || memory === undefined ? [] : [[a.entityId, memory] as [string, SavedMemory]]; }),
      herds: common.herds, groups: decided().map(g => g.snapshot()), ...frame.snapshot(), placement: { ...placement.snapshot() }, raids: savePacks(raids) });
    },
    restore: value => {
      const saved = v.parse(PopulationSaved, value);
      if (saved.seen.length !== bodies.length || saved.herds.length !== hunt.herds.length || saved.groups.length !== decided().length || saved.flocks.length !== flocks.length) throw new Error('Incompatible native population creatures continuation');
      driver.restore(saved.dodgeCd); driver.restoreOthers(saved.otherDodges); driver.calm = saved.calm ?? false;
      frame.restore(saved); placement.restore(saved.placement);
      const memories = new Map(saved.memories), ids = bodies.map(a => a.entityId);
      manager.restore({ rng: saved.rng, clock: saved.clock, noise: { seen: saved.speed.init, speed: saved.speed.v,
        prev: [saved.speed.x, 0, saved.speed.z] }, sight: saved.seen,
        memories: ids.map(id => memories.get(id) ?? null), herds: saved.herds }, ids, ids);
      saved.groups.forEach((state, i) => { decided()[i]?.restore(state); });
    },
  });
  // Match the original adapter insertion order: fixed controllers first, actors materialized later.
  restoreRoster(); reinstalling = false;
  const out = { id: cfg.step, host, hunt, rng, bodies, flocks, raid, marmots, spawnElite, retireElite, spawnElitePack, retirePack,
    get calm(): boolean { return driver.calm; }, set calm(value: boolean) { driver.calm = value; },
    validateSpawn: (kind: string, variant: string): void => {
      if (!cfg.eliteKinds.includes(kind)) throw new Error('Foreign native elite kind');
      intake.spec(kind, variant);
      if (!scaleVariants.get(kind)?.some(row => row.id === variant)) throw new Error('Missing native creature scale');
    },
    available: (): number => Math.max(0, POP_BODY_MAX - host.entities.size),
    bondedHorseIds: (): readonly string[] => bonded.map(row => row.body.id), scare: wildScare,
    bindSpecies: (kind: string, law: Parameters<NativePopulationDriver['bindSpecies']>[1], eliteDamage?: Parameters<NativePopulationDriver['bindSpecies']>[2]): void => { driver.bindSpecies(kind, law, eliteDamage); } };
  nativePopulations.set(host, out);
  return out;
}
