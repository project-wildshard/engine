import { populationEnvironment } from './environment';
import { installNativeLimbPoses } from '../animation/limbPopulation';
import * as v from 'valibot';
import type { SpeciesPrograms } from '@wildshard/format/speciesPrograms';
import { fnv1a32, Rng } from '@wildshard/engine/core/rng';
import { ANIMAL_STATES } from '@wildshard/engine/entities/animalStates';
import { CreatureRefill, syncRefillState } from '@wildshard/engine/entities/creatureRefill';
import type { AnimalSim, AnimalSimSpec } from '@wildshard/engine/entities/AnimalSim';
import { spawnRolls, type HuntBody, type HuntNav } from '@wildshard/engine/ai/hunt';
import { createNativeHunt } from '../plugin/brain';
import { NativeManager } from './nativeManager';
import { admitNativeRosterServices, createNativeCreatureRoster, type NativeCreatureSlot, type NativeRosterSaved } from '../shardfile/homeKeeper';
import { parseNativePopulationRows } from '@wildshard/format/populationRoster';
import type { SimHost } from '@wildshard/engine/sim';
import type { PlayerSim } from '@wildshard/engine/sim/playerSim';

/** Native actor observations; optional shard-specific pose queries can be attached by a pose service. */
export type NativePopulationActor = AnimalSim & { hidden: boolean; sampleTerrain: () => void };
export interface PopulationBody { readonly id: string; readonly kind: string; readonly actor: NativePopulationActor; readonly scripted: boolean }
/** A reserved rolled recipe with no native body, adopted later without drawing RNG. */
export interface DormantPopulationActor { readonly id: string; readonly kind: string; readonly variant: string; readonly spec: AnimalSimSpec; readonly seed: number; readonly scale: number }
interface BakedActor { readonly id: string; readonly kind: string; readonly variant: string; readonly spec: AnimalSimSpec; readonly seed: number; readonly scale: number; readonly scripted?: boolean }
export interface PopulationRosterPorts {
  readonly population: SpeciesPrograms;
  readonly bake: { readonly actors: readonly BakedActor[]; readonly parked: readonly BakedActor[]; readonly herds: readonly { readonly members: readonly string[] }[] };
  readonly nav: HuntNav | null;
  readonly spawnY: number;
  readonly saved?: NativeRosterSaved | undefined;
}

const installed = new WeakMap<SimHost, Map<string, ReturnType<typeof installPopulationRoster>>>();
/** Resolve an installed built-in roster by its declared step id; no shard hook is accepted. */
export function populationRoster(host: SimHost, id: string): ReturnType<typeof installPopulationRoster> {
  const roster = installed.get(host)?.get(id); if (roster === undefined) throw new Error('Missing native population service'); return roster;
}

const finite = v.pipe(v.number(), v.finite());
const Stream = v.strictObject({ version: v.literal(1), state: finite, initial: finite, scrambledFork: v.boolean() });
const Memory = v.record(v.string(), v.union([finite, v.boolean(), v.array(v.tuple([finite, finite, finite]))]));
const savedSchema = (minimum: number, maximum: number) => v.strictObject({ version: v.literal(3), rng: Stream, clock: finite, speed: v.strictObject({ init: v.boolean(), x: finite, z: finite, v: finite }),
  next: v.pipe(v.number(), v.integer(), v.minValue(minimum)),
  bodies: v.pipe(v.array(v.strictObject({ id: v.string(), kind: v.string(), seen: v.boolean(), memory: Memory })), v.maxLength(maximum)),
  herds: v.array(v.tuple([finite, finite])) });
/** Data-driven native population keeper. Boot herd draws, identity replacement, dormant reserves and encounter homes
 * run in declared order on the existing creature stream. Every live recipe is checked against the trusted bake. The
 * v3 continuation retains the established body/memory order; reinstall does not retain any RNG draw. */
export function installPopulationRoster(host: SimHost, ports: PopulationRosterPorts, input: unknown): {
  bodies: () => readonly PopulationBody[]; parked: () => readonly DormantPopulationActor[]; hunt: ReturnType<typeof createNativeHunt>['hunt'];
  /** AnimalManager.spawn in play: a live creature (the stream's draws, the next entity id), at the end of the list */
  spawn: (kind: string, x: number, z: number, yaw: number, variant: string) => NativePopulationActor;
  /** Spawn an encounter-owned body outside the ordinary AI list. */
  spawnLoose: (kind: string, x: number, z: number, yaw: number, variant: string) => NativePopulationActor;
  /** AnimalManager.retire: out of the list, the brain and the host */
  retire: (a: HuntBody) => void;
  /** Materialize a reserved recipe outside the ordinary list, without any RNG draw. */
  adoptParked: (id: string, x: number, z: number, yaw: number) => NativePopulationActor;
  /** a body this roster made (listed or not) by entity id */
  actor: (id: string) => NativePopulationActor | null;
  /** Script transactions preflight recipes and capacity without allocating or drawing. */
  validateSpawn: (kind: string, variant: string) => void;
  available: () => number;
} {
  const rows = parseNativePopulationRows(input);
  const poses = rows.limbPose === undefined ? undefined : installNativeLimbPoses(host, rows.limbPose);
  const BODY_COUNT = rows.bodyCount, LIVE_MAX = rows.limit, ROSTER_STEP = rows.step;
  const SCRIPTED = v.parse(v.picklist(ANIMAL_STATES), rows.scripted);
  const Saved = savedSchema(BODY_COUNT, LIVE_MAX);
  const settings = ports.population.hunt;
  if (settings === undefined) throw new Error('native population requires its admitted hunt settings');
  const { bake } = ports, rng = new Rng(rows.seed), player = host.playerFocus;
  // the page's distance bands (engine/sim/bands.ts, native population overrides no tier ticks): the scheduler's 'ai' rate for the herds
  // (every frame within 60 m, every other frame to 160 m, paused beyond; decisions at 20 / 10 Hz), 'always' for a scripted
  // elite (pinned: it thinks every frame), and the creature body LOD (a capsule within 45 m, released past 55). Before any
  // spawn, and on a restoring host before the host restores its clocks.
  if (rows.reserves.some(row => !bake.parked.some(actor => actor.kind === row.kind))) throw new Error('Missing native dormant recipe');
  const species = new Map(ports.population.native.map(row => [row.kind, row]));
  const environment = populationEnvironment(host, rows.environment);
  const { hunt, reach } = createNativeHunt(host, settings, { rng, ground: environment, nav: ports.nav, species,
    wanderGoal: (herd: number) => environment.wanderGoals[herd] ?? null, present: body => !('hidden' in body) || body.hidden !== true });
  // the shared native roster (G454 rows): the bake's first spec per kind.variant, the manager's spawn ray and creature floor
  // over the page's terrain grid (the host's ground), every kind adopted by the hunting brain, no turn cap, a restoring
  // host's saved floor flags
  const intake = createNativeCreatureRoster<NativeCreatureSlot>(host, { specs: [...bake.actors, ...bake.parked].map(row => row.spec), duplicates: 'first',
    variants: new Map(), rng, spawnY: ports.spawnY, services: admitNativeRosterServices(host, rows.step, hunt), hunted: 'every', ...(ports.saved === undefined ? {} : { saved: ports.saved }) });
  /** Every body this roster made, listed or kept out of the list by a fight, by entity id. */
  const made = (id: string): NativePopulationActor | null => intake.byId.get(id)?.actor ?? null;
  const list: PopulationBody[] = [], parked: DormantPopulationActor[] = [];
  const baked = new Map(bake.actors.map(a => [a.id, a] as const)), bakedParked = new Map(bake.parked.map(a => [a.id, a] as const));
  let booted = false;
  const rolls = (kind: string, variant: string | string[] | undefined): { id: string; spec: AnimalSimSpec; seed: number; scale: number; variant: string } => {
    const r = spawnRolls(rng, kind, variant, list.some(b => b.actor.kind === kind && b.actor.rarity === 'legendary' && b.actor.alive), known => {
      const row = species.get(known); if (row === undefined) throw new Error(`native population has no creature row '${known}'`); return row; });
    const id = intake.identities.allocate();
    // a live spawn takes the next id past the load-time list, with the recipe the bake read for its kind and variant
    if (booted) return { id, spec: intake.spec(kind, r.variant.id), seed: r.seed, scale: r.scale, variant: r.variant.id };
    const row = baked.get(id) ?? bakedParked.get(id);
    if (row === undefined) {
      // only a herd body that rolled an elite's identity is missing from the load-time list (the boot swap retired it): its
      // recipe is that identity's, which the elite at its lair carries
      if (!rows.identities.some(identity => identity.kind === kind && identity.variant === r.variant.id)) throw new Error(`native population roster diverges from the page at ${id}`);
      return { id, spec: intake.spec(kind, r.variant.id), seed: r.seed, scale: r.scale, variant: r.variant.id };
    }
    // the bake is the page's own roll: a divergent draw anywhere refuses the roster rather than simulating another world
    if (row.kind !== kind || row.variant !== r.variant.id || row.seed !== r.seed || row.scale !== r.scale) throw new Error(`native population roster diverges from the page at ${id}`);
    return { id, spec: row.spec, seed: r.seed, scale: r.scale, variant: r.variant.id };
  };
  const continuation = new NativeManager(host, hunt, rng, { limit: settings.limit, sightSlots: 0, initialSight: false,
    ...(settings.memoryFields === undefined ? {} : { memoryFields: settings.memoryFields }) });
  const seen = continuation.sight;
  const slot = (id: string, kind: string, variant: string, spec: AnimalSimSpec, seed: number, scale: number, at: { x: number; y: number; z: number }, yaw: number): NativeCreatureSlot =>
    ({ id, kind, variant, herd: -1, range: [scale, scale], actor: null, recipe: { id, spec, seed, scale, at, yaw } });
  /** a body the shared roster made, out of any herd; the reserved encounter's pose joins his; a listed body joins the manager's list */
  const join = (a: NativePopulationActor, kind: string, listed: boolean): NativePopulationActor => {
    if (rows.poseKinds.includes(kind)) poses?.attach(a);
    a.herd = -1;
    intake.identities.own(a.entityId, { group: null, encounter: listed ? null : rows.encounter, listed });
    if (!listed) return a;
    if (list.length >= LIVE_MAX) throw new Error('native population roster is full');
    list.push({ id: a.entityId, kind, actor: a, scripted: false }); seen.push(false);
    return a;
  };
  /** AnimalManager.spawnAnimal: the shared stream's rolls, the creature floor from a metre over the ground, the brain's memory. */
  const spawn = (kind: string, x: number, z: number, yaw: number, variant: string | string[] | undefined, listed = true): NativePopulationActor => {
    const r = rolls(kind, variant), body = slot(r.id, kind, r.variant, r.spec, r.seed, r.scale, { x, y: 0, z }, yaw);
    const a = join(intake.arrive(body), kind, listed);
    intake.remember(body);
    return a;
  };
  /** AnimalManager.retire: out of the list, the reserved encounter's pose, the brain and the host */
  const retire = (a: HuntBody): void => {
    const i = list.findIndex(b => b.actor === a); if (i !== -1) { list.splice(i, 1); seen.splice(i, 1); }
    poses?.retire(a.entityId);
    const body = intake.byId.get(a.entityId);
    if (body === undefined) { hunt.forget(a); host.retire(a.entityId); } else intake.retire(body);
  };
  Array.from(hunt.placeHerds(rows.fauna, rows.spawn, spawn)); // every herd in one go
  // Retire every reserved identity rolled in a herd, then respawn its declared ordinary replacement in place.
  for (const a of list.map(body => body.actor).filter(actor => rows.identities.some(identity => identity.kind === actor.kind && identity.variant === actor.variant))) {
    const { herd, position: { x, z }, yaw, kind } = a;
    retire(a);
    const replacement = spawn(kind, x, z, yaw, rows.ordinary[kind] ?? []);
    replacement.herd = herd;
    const group = hunt.herds[herd];
    if (group !== undefined) { const at = group.members.indexOf(a); if (at === -1) group.members.push(replacement); else group.members[at] = replacement; }
  }
  // Reserve identities and their recipe draws in declared order, without materializing bodies.
  rows.reserves.forEach(reserve => {
    const { kind } = reserve, variant = reserve.variant ?? bake.parked.find(actor => actor.kind === kind)?.variant;
    if (variant === undefined) throw new Error('Missing native dormant variant');
    const r = rolls(kind, variant);
    for (let i = 0; i < 3; i++) rng.next(); // its memory's three draws (HuntBrain.adopt: timer, fleeUntil, callT)
    intake.identities.dormant({ id: r.id, kind, variant: r.variant }, { group: null, encounter: rows.encounter, listed: false });
    parked.push({ id: r.id, kind, variant: r.variant, spec: r.spec, seed: r.seed, scale: r.scale });
  });
  rows.homes.forEach(home => {
    const yaw = new Rng(fnv1a32(`${String(host.level.seed)}:${home.stream}`)).next() * Math.PI * 2;
    const a = spawn(home.kind, home.x, home.z, yaw, home.variant);
    a.herd = -1; a.state = SCRIPTED; a.scripted = true;
    intake.identities.own(a.entityId, { group: null, encounter: home.stream, listed: true });
    const i = list.findIndex(b => b.actor === a), body = list[i];
    if (body !== undefined) list[i] = { ...body, scripted: true };
  });
  if (list.length !== BODY_COUNT || bake.actors.length !== BODY_COUNT || list.some((b, i) => { const row = bake.actors[i]; return row === undefined || b.id !== row.id || b.scripted !== row.scripted; })
    || hunt.herds.length !== bake.herds.length || hunt.herds.some((h, i) => JSON.stringify(h.members.map(m => m.entityId)) !== JSON.stringify(bake.herds[i]?.members))) throw new Error('native population roster diverges from the page\'s list');
  const herdOwners = (): void => {
    for (const body of list) {
      const owner = intake.identities.identity(body.id);
      intake.identities.own(body.id, { group: body.actor.herd < 0 ? null : `herd:${String(body.actor.herd)}`,
        encounter: owner?.encounter ?? null, listed: true });
    }
  };
  herdOwners();

  booted = true;
  const speed = continuation.noise;
  const cadence = hunt.bindRoster({ limit: LIVE_MAX, order: 'combined', at: i => list[i], actor: body => body.actor,
    id: body => body.id, player, noise: speed, sight: seen, reach,
    brainDt: (id, urgent) => host.brainDt(id, urgent) });
  host.events.on('damage.dealt', ({ req, killed }) => { cadence.damaged(req.target, killed); }, host.scope);

  // J109, J108: a room's herds fill again; one player's stay as they fell, and their saves never carry this row
  const REFILL_STATE = `${ROSTER_STEP}.refill`, room = (): readonly PlayerSim[] => [...host.players.values()];
  const refill = new CreatureRefill({ players: room, room: () => BODY_COUNT - list.filter(body => body.actor.alive).length,
    random: () => host.rng.stream('spawn').next(), spawn: ({ kind, variant, herd, x, z, from }, yaw) => {
      const fallen = list.find(body => body.id === from)?.actor, group = hunt.herds[herd];
      if (fallen?.alive === false) retire(fallen);
      if (list.length >= LIVE_MAX) return;
      const a = spawn(kind, x, z, yaw, rows.ordinary[kind] ?? variant);
      a.herd = herd;
      const at = fallen === undefined ? -1 : group?.members.indexOf(fallen) ?? -1;
      if (at === -1) group?.members.push(a); else if (group !== undefined) group.members[at] = a;
    } });
  host.events.on('actor.died', ({ actor }) => {
    if (host.players.size <= 1) return;
    const a = list.find(body => body.actor.combatActor() === actor)?.actor, group = a === undefined ? undefined : hunt.herds[a.herd];
    if (a !== undefined && group !== undefined) refill.left({ kind: a.kind, variant: a.variant, herd: a.herd, x: group.cx, z: group.cz, from: a.entityId });
  }, host.scope);
  host.events.on('creature.tamed', tamed => {
    if (host.players.size > 1 && list.some(body => body.id === tamed.id)) refill.left({ ...tamed, from: tamed.id });
  }, host.scope);
  host.onStep(ROSTER_STEP, dt => {
    cadence.observe(dt); continuation.advance(dt); cadence.decide();
    refill.step(dt); syncRefillState(host.adapters, REFILL_STATE, refill);
    // a running charge on the body clock: its band's step (0 on a paused or off frame, both frames' time on the next)
    for (let i = 0; i < LIVE_MAX; i++) {
      const body = list[i], a = body?.actor;
      if (body === undefined) break;
      if (a?.alive !== true || a.stunned || a.state !== 'charge') continue;
      const step = host.bodyDt(body.id); if (step > 0) hunt.advanceCharge(a, step, player);
    }
  }, {
    snapshot: () => { const ids = list.map(body => body.id), common = continuation.snapshot(ids, ids); return ({ version: 3, rng: common.rng, clock: common.clock, speed: { init: common.noise.seen, x: common.noise.prev[0], z: common.noise.prev[2], v: common.noise.speed }, next: intake.identities.allocatorState().next,
      bodies: list.map((b, i) => {
        const memory = common.memories[i]; if (memory === undefined || memory === null) throw new Error(`native population body ${b.id} has no memory`);
        return { id: b.id, kind: b.kind, seen: seen[i] === true, memory };
      }),
      herds: common.herds }); },
    restore: value => {
      const state = v.parse(Saved, value);
      if (state.bodies.length !== list.length || state.herds.length !== hunt.herds.length || state.bodies.some((b, i) => b.id !== list[i]?.id)) throw new Error('Incompatible native population roster continuation');
      intake.identities.restoreAllocator({ next: state.next, used: Array.from({ length: state.next }, (_, i) => `creature:${String(i)}`) });
      continuation.restore({ rng: state.rng, clock: state.clock, noise: { seen: state.speed.init, prev: [state.speed.x, 0, state.speed.z], speed: state.speed.v },
        memories: state.bodies.map(body => body.memory), sight: state.bodies.map(body => body.seen), herds: state.herds }, list.map(body => body.id), list.map(body => body.id));
      herdOwners();
    },
  });
  // a restoring install: the saved list's live spawns from the host's own recipes, in order (a body retired in play leaves it)
  const saved = ports.saved, keeper = saved === undefined ? undefined : v.parse(Saved, saved.adapters.find(adapter => adapter.id === ROSTER_STEP)?.state);
  if (saved?.adapters.some(adapter => adapter.id === REFILL_STATE) === true) host.adapters.set(REFILL_STATE, refill.state);
  if (saved !== undefined && keeper !== undefined) {
    const kept = new Map(keeper.bodies.map(b => [b.id, b] as const));
    [...list].forEach(b => { if (!kept.has(b.id)) retire(b.actor); });
    // every saved body the boot did not make, in the host's own order: the live spawns in the list, and the bodies a fight
    // keeps outside the ordinary AI list, driven by its own encounter service.
    saved.entities.forEach(({ id }) => {
      if (host.entities.has(id)) return;
      const checked = intake.read(saved, id), b = kept.get(id), kind = b?.kind ?? checked.spec.kind, variant = checked.spec.variant;
      const a = join(intake.reinstall(slot(id, kind, variant, intake.spec(kind, variant), checked.seed, checked.scale, { ...checked.at }, checked.yaw), saved), kind, b !== undefined);
      if (b !== undefined) hunt.adopt(a, checked.at.x, checked.at.z); // its memory: the continuation overwrites it and the stream it drew from
    });
    if (keeper.bodies.some((b, i) => b.id !== list[i]?.id)) throw new Error('Incompatible native population roster continuation');
  }
  /** a parked prewarm body made real where the page spawned it, out of the list (the reserved encounter when he first comes): no draws */
  const adoptParked = (id: string, x: number, z: number, yaw: number): NativePopulationActor => {
    const row = parked.find(p => p.id === id);
    if (row === undefined) throw new Error(`native population has no parked body ${id}`);
    return join(intake.arrive(slot(id, row.kind, row.variant, row.spec, row.seed, row.scale, { x, y: 0, z }, yaw)), row.kind, false);
  };
  const service: ReturnType<typeof installPopulationRoster> = { bodies: () => list, parked: () => parked, hunt, spawn: (kind, x, z, yaw, variant) => spawn(kind, x, z, yaw, variant),
    spawnLoose: (kind, x, z, yaw, variant) => spawn(kind, x, z, yaw, variant, false), retire, adoptParked,
    actor: made, available: () => LIVE_MAX - list.length,
    validateSpawn: (kind, variant) => { intake.spec(kind, variant); const row = species.get(kind);
      if (row === undefined || ![...row.variants, ...row.spawnOnly ?? []].some(entry => entry.id === variant)) throw new Error('Missing native spawn species'); },
  };
  const services = installed.get(host) ?? new Map<string, ReturnType<typeof installPopulationRoster>>();
  if (services.has(rows.step)) throw new Error('Duplicate native population service');
  services.set(rows.step, service); installed.set(host, services);
  return service;
}
