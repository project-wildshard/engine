import { NativeActors } from '../population/actors';
import { NativeReturns } from '../population/nativeReturns';
import { clearBody } from '@wildshard/engine/entities/bodyClear';
import * as v from 'valibot';
import { Rng, type RngState } from '@wildshard/format/seededRng';
import type { AnimalSim, AnimalSimSpec } from '@wildshard/engine/entities/AnimalSim';
import type { SimHost, SimSpawn, SimValue } from '@wildshard/engine/sim';
import { castRay } from '@wildshard/engine/physics/query';
import { HuntBrain, type HuntBody } from '@wildshard/engine/ai/hunt';
import { isNativeCreaturePoseService, type createNativeCreaturePoses } from '../../../shared/game/plugin/animation';
import { CharacterMotor } from '@wildshard/engine/physics/CharacterMotor';
import { withOwner } from '@wildshard/engine/app/ownership';
import { creatureBodyDistance, keepsCreatureBody } from '@wildshard/engine/sim/bands';
import { StalkerBrain } from '@wildshard/engine/ai/stalker';
import type { SpeciesData } from '@wildshard/format/speciesPrograms';

/**
 * A creature's floor in a renderer-free host (the creature manager's `creatureFloor`; Pine Hollow, Sky Reach): the first
 * WORLD hit under `fromY` at (x, z), else `terrainAt` (also when the hit is the ground's heightfield), and whether it
 * stands on a structure. `hollow` (TC-B3b, declared cleanroom solids): the ray starts inside a solid without hitting it and
 * only an upward face is a floor, so a body that walks or spawns into a solid stays on the ground instead of climbing it.
 */
export function creatureFloor(host: Pick<SimHost, 'physics'>, terrainAt: (x: number, z: number) => number, heightfield: 'ground' | 'any' = 'ground', hollow = false): (x: number, z: number, fromY: number) => { y: number; structure: boolean } {
  const origin = { x: 0, y: 0, z: 0 }, down = { x: 0, y: -1, z: 0 }, sees = ['WORLD'] as const;
  return (x, z, fromY) => {
    const terrain = terrainAt(x, z);
    origin.x = x; origin.y = fromY; origin.z = z;
    const hit = castRay(host.physics, origin, down, Math.max(201, fromY - terrain + 1), sees, undefined, !hollow);
    if (hit === null || (hollow && hit.normal.y <= 0.5)
      || ((heightfield === 'any' || hit.material === 'ground') && hit.collider.shape.type === host.physics.R.ShapeType.HeightField)) return { y: terrain, structure: false };
    return { y: hit.point.y, structure: true };
  };
}

/** One live body's policy, built at its spawn: decisions on its cadence, movement every tick, its own continuation. */
export interface KeptPolicy { decide: (dt: number) => void; move: (dt: number) => void; snapshot: () => SimValue; restore: (value: SimValue) => void }

const finite = v.pipe(v.number(), v.finite());
const Value: v.GenericSchema<SimValue> = v.lazy(() => v.union([v.null(), v.boolean(), finite, v.string(), v.array(Value), v.record(v.string(), Value)]));
/** A saved native recipe's placement; the spec is this build's bake, so a changed spec refuses at the host's restore. */
const Placed = v.object({ id: v.string(), seed: finite, scale: finite, at: v.strictObject({ x: finite, y: finite, z: finite }), yaw: finite });
const NativeRecipe: v.GenericSchema<BoundedHomeNativeRecipeInput, BoundedHomeNativeRecipe> = v.looseObject({ ...Placed.entries, spec: v.looseObject({ kind: v.string(), variant: v.string() }) });

/** The roster owns visibility; hunting consumers only read it through HuntBody. */
interface NativeCreatureActor extends HuntBody { hidden: boolean }

/** Mutable identity/recipe slot owned by a native roster; a retired slot keeps its recipe with no live actor. */
export interface NativeCreatureSlot {
  id: string; kind: string; variant: string; herd: number; readonly recipe: SimSpawn;
  range: readonly [number, number]; actor: NativeCreatureActor | null;
}

const nativeRosterServices = new WeakMap<SimHost, Map<string, { hunt: StalkerBrain<HuntBody>; poses?: ReturnType<typeof createNativeCreaturePoses> }>>();
/** Admit concrete built-in services at setup, never structural adopt/forget or pose ports.
 * Roster rows resolve this scope-owned id; registration neither schedules nor draws. */
export function admitNativeRosterServices(host: SimHost, id: string, hunt: StalkerBrain<HuntBody>, poses?: ReturnType<typeof createNativeCreaturePoses>): string {
  const prototype: unknown = Object.getPrototypeOf(hunt);
  if (host.scope.disposed || !/^[a-zA-Z][a-zA-Z0-9._-]{0,127}$/u.test(id) || !(hunt instanceof StalkerBrain)
    || (prototype !== StalkerBrain.prototype && prototype !== HuntBrain.prototype)
    || (poses !== undefined && !isNativeCreaturePoseService(poses))) throw new Error('Invalid built-in native roster services');
  const services = nativeRosterServices.get(host) ?? new Map<string, { hunt: StalkerBrain<HuntBody>; poses?: ReturnType<typeof createNativeCreaturePoses> }>();
  if (services.has(id)) throw new Error('Duplicate native roster service');
  services.set(id, { hunt, ...(poses === undefined ? {} : { poses }) }); nativeRosterServices.set(host, services);
  host.scope.onDispose(() => { services.delete(id); }); return id;
}

/** Immutable baked kind/variant lookup and the existing dynamic-actor placement wire.
 * `first` retains the first baked recipe; the default `last` retains the latest.
 * Reading validates the actor identity and finite placement, without spawning or drawing RNG.
 */
export function nativeCreatureRecipes(specs: Iterable<AnimalSimSpec>, duplicates: 'first' | 'last' = 'last'): {
  readonly spec: (kind: string, variant: string) => AnimalSimSpec;
  readonly read: (saved: { readonly adapters: readonly { readonly id: string; readonly state: unknown }[] }, id: string) => v.InferOutput<typeof NativeRecipe>;
} {
  const recipes = new Map<string, Map<string, AnimalSimSpec>>();
  for (const known of specs) {
    let group = recipes.get(known.kind);
    if (group === undefined) { group = new Map(); recipes.set(known.kind, group); }
    if (duplicates === 'last' || !group.has(known.variant)) group.set(known.variant, known);
  }
  return {
    spec: (kind: string, variant: string): AnimalSimSpec => {
      const known = recipes.get(kind)?.get(variant);
      if (known === undefined) throw new Error(`Missing native creature recipe: ${kind}.${variant}`);
      return known;
    },
    read: (saved: { readonly adapters: readonly { readonly id: string; readonly state: unknown }[] }, id: string): v.InferOutput<typeof NativeRecipe> => {
      const contract = saved.adapters.find(adapter => adapter.id === `runtime.actor.${id}`)?.state;
      if (typeof contract !== 'string') throw new Error(`Missing saved native creature ${id}`);
      const recipe = v.parse(NativeRecipe, JSON.parse(contract));
      if (recipe.id !== id) throw new Error(`Incompatible saved native creature ${id}`);
      return recipe;
    },
  };
}

/** What differs between two native rosters, as data (G454): the baked specs and their duplicate rule, the scale table, the
 *  spawn ray's floor, the attack turn cap, which kinds the hunting brain adopts, the platform pose roster and the restoring
 *  host's saved floor flags. The roster calls no shard code: a shard acts on the bodies it is handed back. */
export interface NativeRosterRows {
  readonly specs: Iterable<AnimalSimSpec>;
  /** Admitted gameplay metadata, rebound at attachment without changing a saved simulation recipe. */
  readonly species?: readonly Pick<SpeciesData, 'kind' | 'harvest' | 'capExempt'>[];
  /** Which baked spec a kind.variant keeps when the bake lists it twice (`nativeCreatureRecipes`). */
  readonly duplicates?: 'first' | 'last';
  readonly variants: ReadonlyMap<string, readonly { readonly id: string; readonly scale: readonly [number, number] }[]>;
  readonly rng: Rng; readonly spawnY: number;
  /** A body's turn cap while it attacks (a melee shard); absent: the body keeps its own. */
  readonly attackTurnCap?: number;
  readonly heightfield?: 'ground' | 'any';
  /** Offset above a moving actor's reported feet for its later floor rays. */
  readonly floorOffset?: number;
  /** Scope-owned built-in hunt/pose service id, admitted during setup. */
  readonly services: string;
  /** The kinds whose memory the hunting brain adopts at spawn (`remember`); every other kind skips its three draws. */
  readonly hunted: readonly string[] | 'every';
  /** Native body-phase ranges. Policies keep their separate admitted decision clocks. */
  readonly bodyPhase?: { readonly animateWithin: number; readonly clearWithin: number };
  /** A restoring host's decoded entities: a body it holds keeps its saved floor flag over a fresh install's sample. */
  readonly saved?: Pick<NativeRosterSaved, 'entities'>;
}
/** A restoring host's decoded continuation as a native roster reads it (`SimSnapshot`'s adapters and entities). */
export interface NativeRosterSaved {
  readonly adapters: readonly { readonly id: string; readonly state: unknown }[];
  readonly entities: readonly { readonly id: string; readonly state: { readonly flags: { readonly levelGround: boolean } } }[];
}

/** Existing native adapters select their historical release and corpse wire. */
export interface NativeRetirementRows {
  readonly membership: 'detach' | 'retain'; readonly native: 'before' | 'after';
  readonly final?: { readonly alive: boolean; readonly y: number; readonly hidden?: boolean };
}

/** A bare native body for the hunting brain: never hidden (no view), no ground tilt to sample. */
const bareBody = (native: AnimalSim): NativeCreatureActor => Object.assign(native, { hidden: false, sampleTerrain: (): void => undefined });

const nativeRosters = new WeakMap<object, SimHost>();

/** Baked native creature intake: one native roster for every shard that runs its creatures natively (G454: data rows).
 * Callers keep their spawn rolls, boot order, policies, ecology and their save envelope; every function here returns the
 * body it made and calls back into nothing. Spawn draws use the supplied stream in scale/rig-seed/body-seed/memory order;
 * reinstall never draws. The roster owns kind/variant admission, structure-aware placement, herd membership, the hunting
 * brain's adoption and release, and the pose roster's attachment. */
export function createNativeCreatureRoster<B extends NativeCreatureSlot>(host: SimHost, rows: NativeRosterRows): {
  body: (id: string, kind: string, variant: string, herd: number, at: { x: number; z: number }, yaw: number,
    range?: readonly [number, number], authored?: { seed: number; scale: number }) => {
      id: string; kind: string; variant: string; herd: number; range: readonly [number, number]; actor: null; recipe: SimSpawn };
  spec: (kind: string, variant: string) => AnimalSimSpec;
  read: ReturnType<typeof nativeCreatureRecipes>['read'];
  byId: Map<string, B>;
  /** Identity lifecycle above the native body map, including dormant prewarm and permanent retirement. */
  identities: NativeActors<HuntBody>;
  /** Bind declared return rules to this roster's real identities and death events. */
  returns: (rows: unknown, reserved?: (id: string) => boolean) => NativeReturns;
  /** Advance native charge motion and report whether an owned live policy may move. */
  beforeBody: (id: string, dt: number) => boolean;
  /** Integrate the admitted pose, charge contact and hunted-body clearance in order. */
  afterBody: (id: string, dt: number) => void;
  floor: (x: number, z: number, fromY: number) => number;
  /** Join an already materialized host actor without spawning, sampling or drawing. */
  attach: (body: B, actor: AnimalSim) => HuntBody;
  materialize: (body: B, recipe: SimSpawn, structure: boolean) => HuntBody;
  arrive: (body: B) => HuntBody;
  draw: (body: B, consumeMemory?: boolean) => void;
  /** The body's memory: the hunting brain adopts a hunted kind at its recipe point, any other kind skips three draws. */
  remember: (body: B) => void;
  /** Retire an owned live identity and detach its herd membership. Never draws. */
  retire: (body: B, rows?: NativeRetirementRows) => void;
  /** Detach a body while preserving its dormant recipe/identity for later materialization. Never draws. */
  sleep: (body: B) => void;
  /** Retire a pending predecessor only when its owned actor is still present and dead; returns the retired body. */
  retireDead: (id: string | undefined) => B | null;
  /** Refill the same recipe slot: retire, allocate, replace its herd, draw, then arrive. */
  refill: (body: B, home: { readonly x: number; readonly z: number }) => HuntBody;
  /** Replay authored memory-adoption checkpoints into the hunting brain, then continue at the declared stream. Preflight is effect-free. */
  adopt: (rows: readonly { readonly id: string; readonly x: number; readonly z: number; readonly seed?: number; readonly stream: Readonly<RngState> }[],
    stream: Readonly<RngState>) => void;
  retarget: (body: (B & { herd: number }) | undefined, kind: string, variant: string | undefined, herd: number,
    x: number, z: number, yawStream: Parameters<SimHost['rng']['stream']>[0]) => B & { herd: number };
  reinstall: (body: B, saved: NativeRosterSaved) => HuntBody;
} {
  const service = nativeRosterServices.get(host)?.get(rows.services);
  if (service === undefined) throw new Error('Missing built-in native roster service');
  const recipes = nativeCreatureRecipes(rows.specs, rows.duplicates), byId = new Map<string, B>(), { hunt, poses } = service;
  const species = new Map(rows.species?.map(row => [row.kind, row]));
  if (species.size !== (rows.species?.length ?? 0)) throw new Error('Duplicate native roster species');
  const identities = new NativeActors<HuntBody>('creature', 16384);
  const hunted = rows.hunted === 'every' ? null : new Set(rows.hunted);
  const phase = rows.bodyPhase;
  if (phase !== undefined && [phase.animateWithin, phase.clearWithin].some(value => !Number.isFinite(value) || value < 0))
    throw new Error('Invalid native body phase ranges');
  const sample = creatureFloor(host, (x, z) => host.groundHeightAt(x, z), rows.heightfield);
  const floor = (x: number, z: number, fromY: number): number => sample(x, z, fromY).y;
  const spec = recipes.spec;
  const body = (id: string, kind: string, variant: string, herd: number, at: { x: number; z: number }, yaw: number,
    range?: readonly [number, number], authored?: { seed: number; scale: number }) => {
    const scale = range ?? rows.variants.get(kind)?.find(row => row.id === variant)?.scale;
    if (scale === undefined) throw new Error(`Missing native creature scale: ${kind}.${variant}`);
    return { id, kind, variant, herd, range: scale, actor: null,
      recipe: { id, spec: spec(kind, variant), seed: authored?.seed ?? 0, scale: authored?.scale ?? 1, at: { x: at.x, y: 0, z: at.z }, yaw } };
  };
  const attach = (item: B, native: AnimalSim): NativeCreatureActor => {
    if (host.entities.get(item.id) !== native || native.entityId !== item.id || native.kind !== item.kind || native.variant !== item.variant)
      throw new Error('Foreign native roster admission');
    poses?.binding.preflight(item); identities.preflight(item);
    const actor = poses === undefined ? bareBody(native) : poses.binding.attach(native, item);
    const declared = species.get(item.kind);
    if (declared !== undefined) { actor.harvest = declared.harvest; actor.capExempt = declared.capExempt; }
    identities.materialize(item, actor);
    if (item.herd >= 0) identities.own(item.id, { group: `herd:${String(item.herd)}`, encounter: null, listed: true });
    item.actor = actor; byId.set(item.id, item); hunt.herds[item.herd]?.members.push(actor);
    return actor;
  };
  const materialize = (item: B, recipe: SimSpawn, structure: boolean): HuntBody => {
    if (recipe.id !== item.id || recipe.spec.kind !== item.kind || recipe.spec.variant !== item.variant) throw new Error('Foreign native roster recipe');
    poses?.binding.preflight(item); identities.preflight(item);
    const actor = attach(item, host.spawn(recipe));
    const level = rows.saved?.entities.find(entity => entity.id === recipe.id)?.state.flags.levelGround ?? structure;
    actor.levelGround = level;
    if (level) actor.groundHeight = (x, z, fromY) => floor(x, z, fromY + (rows.floorOffset ?? 0));
    if (rows.attackTurnCap !== undefined) actor.attackTurnCap = rows.attackTurnCap;
    return actor;
  };
  const arrive = (item: B): HuntBody => {
    const at = item.recipe.at, found = sample(at.x, at.z, Math.max(rows.spawnY, host.groundHeightAt(at.x, at.z)) + 1);
    at.y = found.y; return materialize(item, item.recipe, found.structure);
  };
  const draw = (item: B, consumeMemory = true): void => {
    item.recipe.scale = rows.rng.range(item.range[0], item.range[1]); rows.rng.next(); item.recipe.seed = rows.rng.next();
    if (consumeMemory) { rows.rng.next(); rows.rng.next(); rows.rng.next(); }
  };
  const remember = (item: B): void => {
    const actor = item.actor;
    if (actor === null) throw new Error('Missing native creature to remember');
    if (hunted === null || hunted.has(item.kind)) hunt.adopt(actor, item.recipe.at.x, item.recipe.at.z);
    else { rows.rng.next(); rows.rng.next(); rows.rng.next(); }
  };
  const release = (item: B, detach: boolean, permanent = true, retirement?: NativeRetirementRows): void => {
    const actor = item.actor, members = hunt.herds[item.herd]?.members;
    if (actor === null || byId.get(item.id) !== item || host.entities.get(item.id) !== actor || (members !== undefined && members.length > 1024)
      || (retirement?.final !== undefined && !Number.isFinite(retirement.final.y))) throw new Error('Foreign native roster retirement');
    if (permanent) identities.retire(item.id); else identities.sleep(item.id);
    const at = detach ? members?.indexOf(actor) ?? -1 : -1; if (at >= 0) members?.splice(at, 1);
    if (retirement?.native === 'before') host.retire(item.id);
    if (retirement?.final !== undefined) { actor.alive = retirement.final.alive; actor.position.y = retirement.final.y;
      if (retirement.final.hidden !== undefined) Object.assign(actor, { hidden: retirement.final.hidden }); }
    if (retirement?.native === 'before') { hunt.forget(actor); byId.delete(item.id); }
    else { byId.delete(item.id); hunt.forget(actor); host.retire(item.id); }
    poses?.delete(item.id); item.actor = null;
  };
  const retire = (item: B, retirement?: NativeRetirementRows): void => { release(item, retirement?.membership !== 'retain', true, retirement); };
  const sleep = (item: B): void => { release(item, true, false); };
  const retireDead = (id: string | undefined): B | null => {
    const item = id === undefined ? undefined : byId.get(id);
    if (item?.actor === null || item?.actor === undefined || item.actor.alive) return null;
    retire(item); return item;
  };
  const refill = (item: B, home: { readonly x: number; readonly z: number }): HuntBody => {
    if (!Number.isFinite(home.x) || !Number.isFinite(home.z) || (hunt.herds[item.herd]?.members.length ?? 0) > 1) throw new Error('Invalid native roster replacement');
    poses?.binding.preflight(item); release(item, false);
    const id = identities.allocate();
    if (id.length === 0 || id.length > 128 || byId.has(id)) throw new Error('Invalid native replacement identity');
    item.id = id; item.recipe.id = id;
    const old = hunt.herds[item.herd]; if (old !== undefined) old.members.length = 0;
    item.herd = hunt.addHerd(item.kind, home.x, home.z);
    draw(item); return arrive(item);
  };
  const adopt = (checkpoints: readonly { readonly id: string; readonly x: number; readonly z: number; readonly seed?: number; readonly stream: Readonly<RngState> }[],
    stream: Readonly<RngState>): void => {
    const check = new Rng(0), initial = rows.rng.snapshot(), ids = new Set<string>();
    const validate = (state: Readonly<RngState>): void => {
      check.restore(state);
      if (state.initial !== initial.initial || state.scrambledFork !== initial.scrambledFork) throw new Error('Foreign native adoption stream');
    };
    if (checkpoints.length > 1024) throw new Error('Native adoption roster exceeds its bound');
    validate(stream);
    const ready = checkpoints.map(row => {
      const item = byId.get(row.id), actor = item?.actor;
      if (row.id.length === 0 || row.id.length > 128 || ids.has(row.id) || actor === null || actor === undefined
        || !Number.isFinite(row.x) || !Number.isFinite(row.z) || (row.seed !== undefined && row.seed !== item?.recipe.seed)) throw new Error('Invalid native adoption row');
      ids.add(row.id); validate(row.stream); return { row, actor };
    });
    for (const { row, actor } of ready) { rows.rng.restore(row.stream); hunt.adopt(actor, row.x, row.z); }
    rows.rng.restore(stream);
  };
  const retarget = (item: (B & { herd: number }) | undefined, kind: string, variant: string | undefined, herd: number,
    x: number, z: number, yawStream: Parameters<SimHost['rng']['stream']>[0]): B & { herd: number } => {
    if (variant === undefined) throw new Error('Missing native creature variant');
    if (item === undefined) throw new Error('Missing native creature recipe slot');
    const range = rows.variants.get(kind)?.find(row => row.id === variant)?.scale, native = spec(kind, variant);
    if (range === undefined) throw new Error(`Missing native creature scale: ${kind}.${variant}`);
    if (!/^[a-zA-Z][a-zA-Z0-9._-]{0,127}$/u.test(yawStream)) throw new Error('Invalid native yaw stream');
    const id = identities.allocate(), yaw = host.rng.stream(yawStream).next() * Math.PI * 2;
    item.id = id; item.kind = kind; item.variant = variant; item.herd = herd; item.range = range;
    item.recipe.id = id; item.recipe.spec = native; item.recipe.at.x = x; item.recipe.at.z = z; item.recipe.yaw = yaw;
    return item;
  };
  const reinstall = (item: B, saved: NativeRosterSaved): HuntBody => {
    const recipe = recipes.read(saved, item.id);
    item.recipe.yaw = recipe.yaw; item.recipe.seed = recipe.seed; item.recipe.scale = recipe.scale;
    Object.assign(item.recipe.at, recipe.at);
    const found = sample(recipe.at.x, recipe.at.z, recipe.at.y + 1);
    const level = saved.entities.find(entity => entity.id === item.id)?.state.flags.levelGround;
    return materialize(item, item.recipe, level ?? found.structure);
  };
  const returns = (input: unknown, reserved?: (id: string) => boolean): NativeReturns => new NativeReturns(host, byId, hunt, input, reserved);
  let poseNear = false;
  const beforeBody = (id: string, dt: number): boolean => {
    const actor = byId.get(id)?.actor;
    if (phase === undefined || actor === null || actor === undefined) return false;
    const player = host.nearestPlayer(actor.position).position;
    poseNear = actor.position.distanceToSquared(player) < phase.animateWithin * phase.animateWithin;
    if (!actor.alive || actor.stunned) return false;
    if ((hunted === null || hunted.has(actor.kind)) && actor.state === 'charge') hunt.advanceCharge(actor, dt, player);
    return true;
  };
  const afterBody = (id: string, dt: number): void => {
    const actor = byId.get(id)?.actor;
    if (phase === undefined || actor === null || actor === undefined) return;
    poses?.get(id)?.advance(dt, host.clock.now, poseNear);
    const player = host.nearestPlayer(actor.position).position;
    if (actor.state === 'charge' && actor.alive && !actor.stunned) hunt.chargeContact(actor, player);
    if ((hunted === null || hunted.has(actor.kind)) && actor.alive && actor.position.distanceToSquared(player) < phase.clearWithin * phase.clearWithin) clearBody(actor, player);
  };
  const roster = { body, spec, read: recipes.read, byId, identities, returns, beforeBody, afterBody, floor, attach, materialize, arrive, draw, remember, retire, sleep, retireDead, refill, adopt, retarget, reinstall };
  nativeRosters.set(roster, host); return roster;
}

/** A deferred actor's exact placement and memory-adoption checkpoint. */
export interface NativeDeferredSpawn { id: string; variant: string; seed: number; scale: number; at: [number, number, number]; yaw: number; adopted: RngState & { version: 1 } }
/** Existing manager-owned deferred actors use the same identity allocator,
 * stream and native admission as boot actors. No factory callback is accepted. */
export class NativeDeferredRoster {
  private readonly host: SimHost;
  private readonly intake: ReturnType<typeof createNativeCreatureRoster<NativeCreatureSlot>>;
  private readonly hunt: StalkerBrain<HuntBody>;
  private readonly rng: Rng;
  private readonly bodies: HuntBody[];
  private readonly sight: (boolean | null | undefined)[];
  private readonly retired: Set<string>;
  private readonly absent: Set<AnimalSim>;
  private readonly rows: { limit: number; spawnY: number; motorKinds: readonly string[]; retiredY: number };
  constructor(host: SimHost, intake: ReturnType<typeof createNativeCreatureRoster<NativeCreatureSlot>>, hunt: StalkerBrain<HuntBody>, rng: Rng,
    bodies: HuntBody[], sight: (boolean | null | undefined)[], retired: Set<string>,
    absent: Set<AnimalSim>, rows: { limit: number; spawnY: number; motorKinds: readonly string[]; retiredY: number }) {
    this.host = host; this.intake = intake; this.hunt = hunt; this.rng = rng; this.bodies = bodies; this.sight = sight; this.retired = retired; this.absent = absent; this.rows = rows;
    if (nativeRosters.get(intake) !== host || !(hunt instanceof StalkerBrain) || !(rng instanceof Rng) || rows.limit < 1 || rows.limit > 1024
      || bodies.length > rows.limit || bodies.length !== sight.length || bodies.some(actor => host.entities.get(actor.entityId) !== actor)) throw new Error('Invalid deferred roster owners');
  }
  roll(kind: string, variant: string, x: number, z: number, yaw: number): NativeDeferredSpawn {
    const next = this.intake.identities.allocatorState().next;
    const slot = this.intake.body(`creature:${String(next)}`, kind, variant, -1, { x, z }, yaw); this.intake.draw(slot, false);
    const y = this.intake.floor(x, z, Math.max(this.rows.spawnY, this.host.groundHeightAt(x, z))+1);
    return { id: slot.id, variant, seed: slot.recipe.seed, scale: slot.recipe.scale, at: [x, y, z], yaw, adopted: { ...this.rng.snapshot(), version: 1 } };
  }
  materialize(saved: NativeDeferredSpawn, kind: string, herd: number, restoring: boolean): HuntBody {
    const state = this.intake.identities.allocatorState(), id = Number(saved.id.slice(9));
    if (this.host.entities.size >= this.rows.limit || !/^creature:\d+$/u.test(saved.id) || id < state.next || saved.scale <= 0) throw new Error('Invalid deferred native actor');
    this.intake.identities.restoreAllocator({ next: id, used: state.used });
    if (this.intake.identities.allocate() !== saved.id) throw new Error('Invalid deferred native identity');
    const [x, y, z] = saved.at, slot = this.intake.body(saved.id, kind, saved.variant, herd, { x, z }, saved.yaw, [saved.scale, saved.scale], saved);
    slot.recipe.at.y = y; const actor = this.intake.materialize(slot, slot.recipe, y !== this.host.groundHeightAt(x, z));
    actor.herd = herd; this.bodies.push(actor); this.sight.push(false); this.rng.restore(saved.adopted); this.hunt.adopt(actor, x, z);
    if (!restoring && this.rows.motorKinds.includes(kind) && this.host.bodyBands?.physics === true
      && keepsCreatureBody(false, actor.alive, actor.driven, creatureBodyDistance(actor.position, this.host.nearestPlayer(actor.position).position))) {
      const motor = withOwner(null, () => new CharacterMotor(this.host.physics, this.host.creatureMotorOptions(actor))); motor.resetAt(actor.position); actor.motor = motor;
    }
    return actor;
  }
  /** Retire permanently or keep the real dormant body with its original group.
   * Both operations remove the same manager/sight slot without drawing. */
  release(id: string, mode: 'retire' | 'park'): void {
    const slot = this.intake.byId.get(id), actor = slot?.actor, at = actor === undefined || actor === null ? -1 : this.bodies.indexOf(actor);
    if (slot === undefined || actor === undefined || actor === null || at === -1 || (mode === 'park' && this.absent.has(actor))) throw new Error(mode === 'park' ? 'Foreign dormant native actor' : 'Foreign deferred native actor');
    if (mode === 'park') {
      Object.assign(actor, { hidden: true }); actor.alive = false; actor.position.y = this.rows.retiredY; actor.motor?.dispose(); actor.motor = null; this.absent.add(actor);
      const owner = this.intake.identities.identity(id); if (owner !== null) this.intake.identities.own(id, { ...owner, listed: false });
      this.host.bodyDt(id); this.host.brainDt(id); this.hunt.forget(actor); this.intake.byId.delete(id);
    } else this.intake.retire(slot, { membership: 'retain', native: 'before', final: { alive: false, y: this.rows.retiredY } });
    this.bodies.splice(at, 1); this.sight.splice(at, 1); if (mode === 'retire') this.retired.add(id);
  }
}

/** Complete admitted data, independent of validator implementation metadata. */
type BoundedHomeNativeRecipeInput = BoundedHomeNativeRecipe;
type BoundedHomeNativeRecipe = {
    spec: {
        kind: string;
        variant: string;
    } & Record<string, unknown>;
    id: string;
    seed: number;
    scale: number;
    at: {
        x: number;
        y: number;
        z: number;
    };
    yaw: number;
} & Record<string, unknown>;
