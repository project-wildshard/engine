import type { Flags } from '@wildshard/engine/world/interact/flags';
import type { Interactable } from '@wildshard/engine/world/interact/types';
import { Vector3 } from 'three';
import { tagOf } from "@wildshard/engine/physics/surface";
import { CharacterMotor } from "@wildshard/engine/physics/CharacterMotor";
import type { Physics } from "@wildshard/engine/physics/Physics";
import { CHUNK_HALF, ENTRY_ASPHALT, ENTRY_WIDTH } from "@wildshard/engine/core/config";
import * as v from "valibot";
import { ScriptHost, type ScriptQuery } from "@wildshard/engine/script/host";
import type { ScriptLanePort } from "@wildshard/engine/script/lane";
import { SCRIPT_PARAMETER_QUERY } from '@wildshard/format/scriptAbi';
import { ScriptWorld } from "@wildshard/engine/script/effects";
import { scriptPhysicsQueries } from "@wildshard/engine/script/queries";
import type { SimHost } from "@wildshard/engine/sim";
import { createShardfileComposedLane, type DeclaredScriptBrainPorts, type DeclaredScriptRoleBinding } from "../shardfile/scriptComposition";
import { verifiedScriptModules, type ShardScriptContent, type ShardScriptPorts } from "../shardfile/scripts";
import type { ScriptRole, ScriptSchedule } from "@wildshard/engine/script/composition";
import type { Scope } from "@wildshard/engine/app/scope";
import { KinematicMover, type MoverPose } from "@wildshard/engine/physics/mover";
import { RopeChain } from "@wildshard/engine/physics/ropeChain";
import { MOVER_FIELDS, MOVER_FIELD_RANGES, moverScriptEntities } from "../../../shared/game/shardfile/movers";
import { MoverLifecycle, MoverLifecycleStateSchema, moverEndState, type MoverEndEvent } from '@wildshard/engine/sim/moverLifecycle';
import { MoverMechanic, type NativeMoverMotion } from '@wildshard/engine/sim/moverMotion';
import { parseMovers, type MoverData } from "@wildshard/format/movers";
import { carryPrompt } from "../../../shared/game/shardfile/wirePrompts";
import { actRoutes } from "@wildshard/engine/sim/actRoutes";
import { leadPlayer } from '@wildshard/engine/sim/leadPlayer';
import { publishScriptBody } from '@wildshard/engine/sim/shardRows';

/** One declared entryway as the shardfile states it (a midpoint opening on an edge). */
export interface TerrainEntryway { readonly edge: 'north' | 'east' | 'south' | 'west'; readonly kind?: string | undefined }
/** The walk: lanes per opening, metres walked in, where on the axis the feet start, and the step budget per lane. */
export interface TerrainEntryWalk {
  readonly lanes: number; readonly walk: number; readonly start: number; readonly maxTicks: number;
  /** Optional socket-to-deck flare. Start/walk are distances in from the edge for this profile. */
  readonly ramp?: { readonly at: number; readonly run: number; readonly height: number;
    readonly halfWidths: Readonly<Record<TerrainEntryway['edge'], number>>; readonly stride: number; readonly look: number };
}
/** The player's capsule (the engine's edge walk's). */
/** Metres past a carry prompt's radius a press still lands: it is judged a command behind the page. */
const CARRY_REACH = 2;
const CAPSULE = { radius: 0.35, height: 1.8, step: 0.3, maxClimbDeg: 45, snap: 0.2, group: 'PLAYER', blockedBy: ['WORLD'] } as const;

/**
 * An entry proof on a shard's native terrain (SF27): a real player capsule walks `walk` m in from each of the four
 * declared ground entryways, `lanes` lanes across the opening, through the host's own collision world. The engine's edge
 * walk holds every step at y = 0, which only a flat shard meets; here the first `ENTRY_ASPHALT` m (the socket) must be
 * flat at y = 0, and past it the feet follow the admitted heights within 0.15 m on ground no steeper than the capsule
 * climbs. A stall, a fall, a drift out of the lane or an unwalkable slope refuses the proof.
 */
export function proveTerrainEntries(physics: Physics, entryways: readonly TerrainEntryway[], heightAt: (x: number, z: number) => number, spec: TerrainEntryWalk): { lanes: number; steps: number } {
  const ramp = spec.ramp;
  if (ramp !== undefined) {
    if (!Number.isInteger(spec.lanes) || spec.lanes < 2 || spec.lanes > 64 || !Number.isInteger(spec.maxTicks)
      || spec.maxTicks < 1 || spec.maxTicks > 1200 || [spec.start, spec.walk, ramp.at, ramp.run, ramp.height, ramp.stride, ramp.look,
        ...Object.values(ramp.halfWidths)].some(value => !Number.isFinite(value) || value <= 0 || value > CHUNK_HALF)
      || spec.walk <= spec.start || ramp.run < 0.1 || ramp.stride > 1 || ramp.look > 10
      || Object.values(ramp.halfWidths).some(width => width <= CAPSULE.radius)) throw new Error('Invalid bounded entry ramp');
    if (entryways.length !== 4 || entryways.some(entry => entry.kind !== 'socketOverWater')) throw new Error('The ramp entry proof needs four socket-over-water entryways');
  }
  if (ramp === undefined && (entryways.length !== 4 || entryways.some(entry => (entry.kind ?? 'ground') !== 'ground'))) throw new Error('The terrain entry proof needs four ground entryways');
  const motor = new CharacterMotor(physics, CAPSULE), half = ENTRY_WIDTH / 2 - CAPSULE.radius, slope = Math.cos(Math.PI / 4);
  let lanes = 0, steps = 0;
  try {
    if (ramp !== undefined) {
      for (const edge of ['north', 'east', 'south', 'west'] as const) {
        if (!entryways.some(entry => entry.edge === edge)) throw new Error(`Missing ${edge} entryway`);
        const open = half, top = ramp.halfWidths[edge] - CAPSULE.radius;
        // the lane's offset across at `a` metres in: the opening's, narrowing with the ramp's flare to the deck's
        const across = (share: number, a: number): number => {
          const t = Math.min(1, Math.max(0, (a - ramp.at) / ramp.run));
          return share * (open + (top - open) * t);
        };
        const floor = (a: number): number => (a < ramp.at ? 0 : a < ramp.at + ramp.run ? ramp.height * (a - ramp.at) / ramp.run : ramp.height);
        const ns = edge === 'north' || edge === 'south', sign = edge === 'north' || edge === 'east' ? -1 : 1;
        // level space ↔ (in from the edge, across)
        const toWorld = (a: number, c: number): { x: number; z: number } => (ns ? { x: c, z: -sign * CHUNK_HALF + sign * a } : { x: -sign * CHUNK_HALF + sign * a, z: c });
        const inOf = (p: { x: number; z: number }): number => sign * (ns ? p.z : p.x) + CHUNK_HALF;
        const acrossOf = (p: { x: number; z: number }): number => (ns ? p.x : p.z);
        for (let lane = 0; lane < spec.lanes; lane++) {
          const share = -1 + lane * 2 / (spec.lanes - 1), start = toWorld(spec.start, across(share, spec.start));
          const feet = { x: start.x, y: 0.5, z: start.z };
          // dropped from 0.5 m onto the socket first (a capsule started skin-deep in the floor falls through it)
          for (let k = 0; k < 20; k++) { steps++; if (motor.move(feet, { x: 0, y: -0.05, z: 0 }).grounded) break; }
          let stalled = 0, reached = false;
          for (let tick = 0; tick < spec.maxTicks; tick++) {
            const a = inOf(feet);
            if (a >= spec.walk) { reached = true; break; }
            const goal = toWorld(a + ramp.look, across(share, a + ramp.look)), dx = goal.x - feet.x, dz = goal.z - feet.z, d = Math.hypot(dx, dz);
            const result = motor.move(feet, { x: dx / d * ramp.stride, y: -9.81 / 3600, z: dz / d * ramp.stride }); steps++;
            const now = inOf(feet);
            stalled = now - a < ramp.stride * 0.5 ? stalled + 1 : 0;
            const where = `${edge} lane ${String(lane)} at ${now.toFixed(2)} m in`;
            if (stalled >= 5) throw new Error(`Stalled on ramp entry ${where}`);
            if (!result.grounded) throw new Error(`Off the ground on ramp entry ${where}`);
            if (Math.abs(acrossOf(feet) - across(share, now)) > CAPSULE.radius) throw new Error(`Out of its lane on ramp entry ${where}`);
            if (Math.abs(feet.y - floor(now)) > 0.15) throw new Error(`Off the floor on ramp entry ${where}: feet ${feet.y.toFixed(3)} m, floor ${floor(now).toFixed(3)} m`);
            if (now < ENTRY_ASPHALT && result.groundNormalY < 0.99) throw new Error(`Socket not flat on ramp entry ${where}`);
          }
          if (!reached) throw new Error(`Blocked ramp entry ${edge} lane ${String(lane)}: ${String(spec.maxTicks)} steps`);
          lanes++;
        }
      }
      return { lanes, steps };
    }
    for (const edge of ['north', 'east', 'south', 'west'] as const) for (let lane = 0; lane < spec.lanes; lane++) {
      if (!entryways.some(entry => entry.edge === edge)) throw new Error(`Missing the ${edge} entryway`);
      const offset = -half + lane * (2 * half) / (spec.lanes - 1), along = edge === 'north' || edge === 'east' ? spec.start : -spec.start, sign = edge === 'north' || edge === 'east' ? -1 : 1;
      const ns = edge === 'north' || edge === 'south';
      const feet = { x: ns ? offset : along, y: 0.03, z: ns ? along : offset };
      const delta = { x: ns ? 0 : sign * 0.1, y: -9.81 / 3600, z: ns ? sign * 0.1 : 0 };
      let travelled = 0, stalled = 0;
      for (let tick = 0; tick < spec.maxTicks; tick++) {
        if (travelled >= spec.walk) break;
        const before = ns ? feet.z : feet.x;
        const result = motor.move(feet, delta); steps++;
        const advance = sign * ((ns ? feet.z : feet.x) - before);
        travelled += advance; stalled = advance < 0.05 ? stalled + 1 : 0;
        const ground = heightAt(feet.x, feet.z), socket = travelled < ENTRY_ASPHALT - (250 - spec.start);
        if (stalled >= 5 || !result.grounded || Math.abs((ns ? feet.x : feet.z) - offset) > CAPSULE.radius
          || Math.abs(feet.y - ground) > 0.15 || result.groundNormalY < slope || (socket && (ground !== 0 || result.groundNormalY < 0.99))) {
          throw new Error(`Blocked entry ${edge} lane ${String(lane)} at ${travelled.toFixed(2)} m`);
        }
      }
      if (travelled < spec.walk) throw new Error(`Blocked entry ${edge} lane ${String(lane)}: ${String(spec.maxTicks)} steps reached ${travelled.toFixed(2)} m`);
      lanes++;
    }
    return { lanes, steps };
  } finally { motor.dispose(); }
}

/** Transitional standalone composition; a full session injects its existing host and merges entities/rules/queries instead. */
export async function createMoverHost(data: MoverData, assets: ReadonlyMap<string, Uint8Array>, physicsQueries: ScriptQuery): Promise<ScriptHost> {
  const checked = parseMovers(data), modules = await verifiedMoverModules(assets, checked);
  const host = new ScriptHost({ world: new ScriptWorld({ fields: MOVER_FIELD_RANGES, archetypes: [], events: [], maxEntities: 32 }, moverScriptEntities(checked)), query: moverQueries(checked, physicsQueries) });
  for (const [hash, bytes] of modules) host.install(hash, bytes);
  return host;
}

/** Verified extra author modules and trusted roles share the existing 32-entity mover host. */
export interface MoverRoleComposition { modules: ReadonlyMap<string, Uint8Array>; roles: readonly ScriptRole[]; declarations?: readonly DeclaredScriptRoleBinding[]; schedules?: readonly ScriptSchedule[]; seed: number }
/** Declared constants are read only and selected by the trusted calling entity; physics queries keep their adapter. */
function moverQueries(data: MoverData, physicsQueries: ScriptQuery): ScriptQuery {
  const parameters = new Map(parseMovers(data).map((m) => [m.entity, [...m.input]]));
  return (kind, input, entity) => {
    if (kind !== SCRIPT_PARAMETER_QUERY) return physicsQueries(kind, input, entity);
    if (input.length !== 8 || input.some((value) => value !== 0)) throw new Error('Declared parameters take no author-selected entity');
    const values = parameters.get(entity); if (values === undefined) throw new Error('Unknown declared parameter entity');
    return [...values];
  };
}

/** Transitional view recipe only; a shard may project published poses but cannot author physics or tick ownership. */
export interface MoverView { pose: (value: MoverPose, fields: Readonly<Record<number, number>>) => void; chain?: RopeChain;
  /** A replay's deck: its collider stands at `at` now, and `next` waits for the physics step after the replay. No view moves. */
  place?: (at: MoverPose, next: MoverPose) => void }
/** Declared rows plus trusted legacy view callbacks; the platform owns context, world, scripts, scope and fixed systems. */
export interface MoverInstallation {
  flags?: Pick<Flags, 'has' | 'set'>;
  prompts?: Interactable[];
  data: MoverData; modules: ReadonlyMap<string, string>; views?: ReadonlyMap<string, MoverView>; systemId: string;
  shared?: { host: ScriptHost; tick: () => number };
  /** Additional consuming item roles join this installer's single host and tick. Incompatible with an injected shared host. */
  composition?: MoverRoleComposition;
  /** A grid cell's admitted product bytes by module hash (`runtimeProduct(...).assets.retained`): a module present here is
   *  read from them (hash-checked again by {@link createMoverHost}) instead of fetched a second time from `modules`. */
  admitted?: ReadonlyMap<string, Uint8Array>;
  /** Read a declared module through its existing product reader; SHA verification and tick ownership stay here. */
  read?: (hash: string) => Promise<Uint8Array>;
  permissions?: () => ReadonlyMap<string, number>;
  /** Saved flag data is read only at fresh installation, never observed by a render frame. */
  restoreFlags?: ReadonlySet<string>;
  onDispose?: () => void;
  activation?: MoverActivationPorts;
}
/** What every player in the world stands on. A seat with no capsule is not in the world. */
export function* playerGrounds(host: Pick<SimHost, 'players' | 'parked'>): Generator<CharacterMotor['result']> { for (const player of host.players.values()) if (player.hasMotor && !host.parked.has(player.id)) yield player.motor.result; }
/** Trusted activation observes real grounded collider ownership and the admitted host shared state. */
export interface MoverActivationPorts {
  ground?: () => Iterable<CharacterMotor['result']>;
  shared?: (field: number) => number | boolean | undefined;
}
/** The shared script host already owns modules, entity handles and one beginTick per fixed step. */
export interface MoverPorts { lane?: ScriptLanePort; flags?: Pick<Flags, 'has' | 'set'>; physics: Physics | (() => Physics); host: ScriptHost; scope: Scope; adopt?: (id: string) => MoverView | undefined; restoring?: boolean; activation?: MoverActivationPorts; restoreFlags?: ReadonlySet<string> }
function nativeMotion(row: MoverData[number]): NativeMoverMotion {
  if (row.driver === undefined || row.trigger === undefined) throw new Error('Missing admitted native mover motion');
  return { driver: row.driver, trigger: row.trigger, at: row.at, euler: row.euler, ...(row.track === undefined ? {} : { track: row.track }), ...(row.carry === undefined ? {} : { carry: row.carry }) };
}
function continuationRows(rows: MoverData): MoverData {
  return rows.map(({ execution: _execution, ...source }) => {
    const { track: _track, driver, trigger: _trigger, ...compiled } = source;
    return driver?.kind === 'track' || driver?.kind === 'pendulum' || source.restoreFrom !== undefined || source.carry !== undefined ? source : compiled;
  });
}
/** Native handle identity is restored before reconnecting to the replacement world. */
export interface MoverBodyState { id: string; handle: number }
const continuation = v.strictObject({ riders: v.exactOptional(v.pipe(v.array(v.tuple([v.string(), v.string()])), v.maxLength(32))), lifecycle: v.exactOptional(MoverLifecycleStateSchema), pending: v.pipe(v.array(v.tuple([v.string(), v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(3))])), v.maxLength(32)),
  bodies: v.pipe(v.array(v.strictObject({ id: v.string(), handle: v.pipe(v.number(), v.finite(), v.minValue(0)) })), v.maxLength(32)) });
export interface MoverRideTransition { readonly riding: boolean; readonly arrived?: 1 | -1; readonly hint?: string }
interface CarryPose { readonly riding: boolean; readonly at: readonly [number, number, number]; readonly yaw: number }
/** Data/script bridge to engine physics; imported code installs nothing, and presentation only reads published state. */
export class MoverRuntime {
  readonly data: MoverData;
  private readonly rideEvents = new Map<string, MoverRideTransition[]>();
  private readonly carryPoses = new Map<string, CarryPose>();
  /** Who rides each carry mover, when it is not the lead (P1-E3.10). A lone player's save never holds one. */
  private readonly riders = new Map<string, string>();
  private readonly previousRides = new Map<string, boolean>();
  private readonly flags: Pick<Flags, 'has' | 'set'> | undefined;
  readonly chains: Map<string, RopeChain> = new Map<string, RopeChain>();
  private readonly sinks = new Map<string, (pose: MoverPose) => void>();
  /** the presentation-only views (adopted rows), for {@link showRest} */
  private readonly views = new Map<string, (pose: MoverPose) => void>();
  private readonly host: ScriptHost;
  private readonly composed: ScriptLanePort | undefined;
  /** Trusted item bindings use this already installed host's actor grants and current tick. */
  get scriptHost(): ScriptHost { return this.host; }
  /** The lane it was installed on, where a seat may be taken. */
  get lane(): ScriptLanePort | undefined { return this.composed; }
  private readonly physics: () => Physics;
  private readonly bodies = new Map<string, KinematicMover>();
  private bodyHandles = new Map<string, number>();
  private pending = new Map<string, number>();
  private readonly lifecycle: MoverLifecycle;
  private seedLifecycleOnReconnect = false;
  private readonly activation: MoverActivationPorts;
  private readonly mechanics = new Map<string, MoverMechanic>();
  constructor(data: MoverData, ports: MoverPorts) {
    this.data = parseMovers(data); this.flags = ports.flags;
    for (const row of this.data) if (row.carry?.arrival !== undefined && this.flags === undefined) throw new Error('Mover arrival requires the actual flags owner');
    this.host = ports.host; this.composed = ports.lane; this.activation = ports.activation ?? {};
    for (const row of this.data) if (row.execution === 'native') this.mechanics.set(row.id, new MoverMechanic(nativeMotion(row)));
    this.lifecycle = new MoverLifecycle(this.data.map(row => ({ id: row.id,
      ...(row.atEnd === undefined ? {} : { atEnd: row.atEnd }), ...(row.restoreFrom === undefined ? {} : { restoreFrom: row.restoreFrom }) })));
    if (ports.restoring !== true && this.data.some(row => row.restoreFrom !== undefined) && ports.restoreFlags === undefined) throw new Error('Mover restore requires saved flag data');
    for (const row of this.data) {
      if (row.trigger?.kind === 'stand' && this.activation.ground === undefined) throw new Error('Stand mover requires the real player ground result');
      if (row.trigger?.kind === 'shared') {
        const value = this.activation.shared?.(row.trigger.field);
        if (typeof value !== typeof row.trigger.equals || typeof value === 'number' && !Number.isFinite(value)) throw new Error('Shared mover requires its admitted typed host field');
      }
    }
    const physics = ports.physics; this.physics = typeof physics === 'function' ? physics : () => physics;
    if (ports.restoring && (ports.adopt !== undefined || this.data.some(row => row.kind === 'chain'))) throw new Error('Native mover restore requires declared platform/static bodies');
    for (const m of this.data) if (ports.host.world.entity(m.entity) === undefined) throw new Error('Missing mover script entity');
    const restored = new Map(this.data.flatMap(row => ports.restoring !== true && row.restoreFrom !== undefined && ports.restoreFlags?.has(row.restoreFrom.flag) === true
      ? [[row.entity, moverEndState(row)] as const] : []));
    if (restored.size > 0) {
      // state() returns detached rows; restore() alone publishes the fully validated replacement.
      const state = this.host.world.state();
      for (const entity of state) {
        const end = restored.get(entity.id);
        if (end !== undefined) { entity.position = end.position; entity.fields = { ...entity.fields, ...end.fields }; }
      }
      this.host.world.restore(state);
    }
    for (const row of this.data) this.lifecycle.seed(row.id, this.host.world.entity(row.entity)?.fields ?? {});
    for (const m of this.data) {
      const adopted = ports.adopt?.(m.id);
      if (adopted !== undefined) {
        if (m.carry !== undefined) this.rideEvents.set(m.id, []);
        const chain = adopted.chain; let enabled = m.enabled;
        this.sinks.set(m.id, (pose) => { if (chain !== undefined && enabled !== pose.enabled) { enabled = pose.enabled; chain.setEnabled(enabled); } adopted.pose(pose, this.host.world.entity(m.entity)?.fields ?? {}); });
        this.views.set(m.id, (pose) => { adopted.pose(pose, this.host.world.entity(m.entity)?.fields ?? {}); });
        if (chain !== undefined) this.chains.set(m.id, chain); continue;
      }
      if (m.kind === 'channel') continue;
      if (m.kind === 'chain') { if (m.chain === undefined) throw new Error('Missing chain'); const chain = new RopeChain(this.physics(), m.chain); this.chains.set(m.id, chain); let enabled = m.enabled; chain.setEnabled(enabled); this.sinks.set(m.id, (pose) => { if (enabled !== pose.enabled) { enabled = pose.enabled; chain.setEnabled(enabled); } }); ports.scope.onDispose(() => { chain.dispose(); }); }
      else {
        if (!ports.restoring) { const body = new KinematicMover(this.physics(), m.boxes, this.pose(m.id), m.id, m.kind === 'static'); this.bodies.set(m.id, body); this.bodyHandles.set(m.id, body.body.handle); }
        this.sinks.set(m.id, pose => { const body = this.bodies.get(m.id); if (body === undefined) throw new Error('Mover native body is not reconnected'); body.setPose(pose); });
        ports.scope.onDispose(() => { this.bodies.get(m.id)?.dispose(); });
      }
    }
  }
  /** Queue a host-validated interact command; scene dispatch resolves the stable mover id, never an arbitrary function export. */
  command(id: string, action: 1 | 2 | 3, player?: string): void {
    const row = this.data.find(m => m.id === id); if (row === undefined) throw new Error('Unknown mover');
    if (row.carry !== undefined) {
      if (this.riding(id) || this.carrying(player) || action === 3) return;
      if (player === undefined) this.riders.delete(id); else this.riders.set(id, player);
    }
    this.pending.set(id, action);
  }
  /** Live ride state is the same entity/command queue the motion host owns. */
  riding(id?: string): boolean {
    const rows = id === undefined ? this.data : this.data.filter(row => row.id === id);
    if (id !== undefined && rows.length === 0) throw new Error('Unknown mover');
    return rows.some(row => row.carry !== undefined && (this.pending.has(row.id) || [1, 0.5].includes(this.host.world.entity(row.entity)?.fields[6] ?? 0)));
  }
  /** Whether `player` (the lead when absent) is on a carry mover: each carries the one who called it. */
  carrying(player?: string): boolean { return this.data.some(row => row.carry !== undefined && this.riders.get(row.id) === player && this.riding(row.id)); }
  /** View-only edges, including first arrival hints, never an authored update hook. */
  takeRideTransitions(id: string): readonly MoverRideTransition[] { return this.rideEvents.get(id)?.splice(0) ?? []; }
  /** Borrow the same declared prompts on the page; the native command names are the stable mover ids. */
  ridePrompts(): Interactable[] {
    const busy = (): boolean => this.riding();
    return this.data.flatMap(row => row.carry?.prompts.map((prompt, end): Interactable => ({ position: new Vector3(...prompt.at),
      get radius() { return busy() ? 0 : prompt.radius; }, label: prompt.label,
      wireId: carryPrompt(row.id, end), onInteract: () => { this.command(row.id, end === 0 ? 1 : 2); } })) ?? []);
  }
  private publishCarry(row: MoverData[number], entity: NonNullable<ReturnType<ScriptWorld['entity']>>): void {
    const carry = row.carry; if (carry === undefined) return;
    const active = entity.fields[6] ?? 0, riding = active === 1 || active === 0.5, was = this.previousRides.get(row.id) ?? false;
    this.previousRides.set(row.id, riding);
    if (!riding && !was) return;
    const arrived = active === 0.25 ? 1 : -1, hint = !riding && arrived === 1 && carry.arrival !== undefined && this.flags?.has(carry.arrival.flag) === false ? carry.arrival.hint : undefined;
    if (!riding && arrived === 1 && carry.arrival !== undefined) this.flags?.set(carry.arrival.flag);
    this.carryPoses.set(row.id, { riding, at: riding ? [entity.position[0], entity.position[1] + carry.seat, entity.position[2]] : carry.landings[arrived === 1 ? 1 : 0], yaw: (entity.fields[2] ?? 0) + carry.yaw });
    if (was !== riding) {
      const queue = this.rideEvents.get(row.id); if ((queue?.length ?? 0) >= 2) throw new Error('Mover ride transitions were not consumed');
      queue?.push({ riding, ...(!riding ? { arrived } : {}), ...(hint === undefined ? {} : { hint }) });
    }
  }
  /** The page's actual player receives carry in the mover's fixed phase. */
  carryPlayer(player: { position: Vector3; velocity: Vector3; carried: boolean; yaw: number }): void {
    for (const carry of this.carryPoses.values()) { player.position.set(...carry.at); player.velocity.set(0, 0, 0); player.carried = carry.riding; if (!carry.riding) player.yaw = carry.yaw; }
    this.carryPoses.clear();
  }
  private carryNative(host: SimHost): void {
    for (const [id, carry] of this.carryPoses) {
      const named = this.riders.get(id), rider = named === undefined ? leadPlayer(host) : host.players.get(named);
      if (!carry.riding) this.riders.delete(id);
      if (rider === undefined) continue; // left the world mid-ride: the boat goes on without them
      rider.position.set(...carry.at); rider.motor.resetAt(rider.position); rider.velocity.y = 0; rider.fall.grounded = false; if (!carry.riding) rider.yaw = carry.yaw;
    }
    this.carryPoses.clear();
  }
  /** Protect ordinary walking while the existing fixed mover lane publishes carry. */
  bindNativeCarry(host: SimHost): void {
    if (!this.data.some(row => row.carry !== undefined)) return;
    host.events.answer('player.carrying', carried => carried || this.carrying(), host.scope);
    const lead = leadPlayer(host);
    host.leading.push(body => this.carrying(body === lead ? undefined : body.id)); // a client's capsule stays out of a boat's way
    const routes = actRoutes(host);
    for (const row of this.data) row.carry?.prompts.forEach(({ at: [x, y, z], radius }, end) => {
      routes.claims.set(carryPrompt(row.id, end), player => {
        const body = host.players.get(player)?.position;
        if (body !== undefined && Math.hypot(body.x - x, body.y - y, body.z - z) <= radius + CARRY_REACH) this.command(row.id, end === 0 ? 1 : 2, player === lead.id ? undefined : player);
        else routes.refused++;
      });
    });
    host.events.answer('player.traversal', dt => {
      const player = host.traversing;
      if (typeof dt !== 'number') return dt;
      if (player === null || player === lead) return this.carrying();
      return this.carrying(player.id) ? true : dt;
    }, host.scope);
    host.onStep('movers.carry', () => { this.carryNative(host); }, undefined, 'afterBodies');
  }
  /** Read this mover role's ABI input without starting a tick or touching any other script role's allowance. */
  scriptInput(id: string, tick: number, permission = 0): readonly number[] {
    const m = this.data.find(row => row.id === id), e = m === undefined ? undefined : this.host.world.entity(m.entity);
    if (m === undefined || e === undefined) throw new Error('Missing mover');
    let gate = permission;
    if (m.trigger?.kind === 'stand') gate = Number(this.stoodOn(m.id));
    else if (m.trigger?.kind === 'shared') {
      const value = this.activation.shared?.(m.trigger.field);
      if (typeof value !== typeof m.trigger.equals || typeof value === 'number' && !Number.isFinite(value)) throw new Error('Unavailable shared mover field');
      gate = Number(value === m.trigger.equals);
    } else if (m.trigger?.kind === 'interact') gate = permission === m.trigger.permission
      ? m.driver?.kind === 'winch' && m.driver.mode === 'hinge' ? permission : 1 : 0;
    return [tick, 1 / 60, this.pending.get(m.id) ?? 0, m.entity, gate, m.input.length,
      e.fields[MOVER_FIELDS.pitch] ?? 0, e.fields[MOVER_FIELDS.yaw] ?? 0, e.fields[MOVER_FIELDS.roll] ?? 0,
      e.fields[MOVER_FIELDS.enabled] ?? 0, e.fields[MOVER_FIELDS.raised] ?? 0, e.fields[MOVER_FIELDS.raising] ?? 0];
  }
  /** Anyone's real ground: one player on a plate holds it down for the room. */
  private stoodOn(id: string): boolean {
    for (const ground of this.activation.ground?.() ?? []) if (ground.grounded && ground.groundCollider !== null && tagOf(ground.groundCollider)?.owner === id) return true;
    return false;
  }
  /** Apply an admitted call once; a composed scheduler already owns execution and the global host tick. */
  publish(id: string, ok: boolean): void {
    if (!this.data.some(row => row.id === id)) throw new Error('Unknown mover');
    this.pending.delete(id);
    if (ok) {
      const row = this.data.find(value => value.id === id), entity = row === undefined ? undefined : this.host.world.entity(row.entity);
      if (entity === undefined) throw new Error('Missing mover publication');
      const published = this.data.find(value => value.id === id); if (published === undefined) throw new Error('Missing mover declaration');
      this.publishCarry(published, entity);
      this.lifecycle.observe(id, entity.fields); this.sinks.get(id)?.(this.pose(id));
    }
  }
  /** Fixed.pre after beginTick, before physics; parameter data and current state are explicit ABI input. */
  step(tick: number, permissions: ReadonlyMap<string, number> = new Map()): void {
    for (const m of this.data) {
      const input = this.scriptInput(m.id, tick, permissions.get(m.id) ?? 0), mechanic = this.mechanics.get(m.id);
      if (mechanic === undefined) { const call = this.host.call(m.module, m.entity, input); this.publish(m.id, call.ok); }
      else {
        const entity = this.host.world.entity(m.entity); if (entity === undefined) throw new Error('Missing native mover');
        const next = mechanic.step(entity, { tick, dt: 1 / 60, action: input[2] ?? 0, permission: input[4] ?? 0 });
        this.host.world.prepare(next.effects, m.entity, 0, 0).commit(); this.publish(m.id, true);
      }
    }
  }
  /** Read the admitted committed endpoint without consulting a render pose. */
  atEnd(id: string): boolean { return this.lifecycle.atEnd(id); }
  /** KA6 consumes these bounded fixed-step edges as named signals, distinct from actor move.done. */
  drainEndEvents(): readonly MoverEndEvent[] { return this.lifecycle.drain(); }
  /** Capture chain poses after the world step, then let the existing bridge renderer interpolate them. */
  capture(): void { for (const chain of this.chains.values()) chain.capture(); }
  /** Published state; no presentation caller may mutate script memory or authoritative fields. */
  pose(id: string): MoverPose {
    const m = this.data.find((row) => row.id === id), e = m === undefined ? undefined : this.host.world.entity(m.entity); if (e === undefined) throw new Error('Unknown mover');
    return { position: { x: e.position[0], y: e.position[1], z: e.position[2] }, euler: { x: e.fields[1] ?? 0, y: e.fields[2] ?? 0, z: e.fields[3] ?? 0 }, enabled: !e.frozen && e.fields[4] === 1 };
  }
  /**
   * Draw every adopted view at its declared rest pose (the row's `at` and `euler`), presentation only: no script memory, no
   * body, no tick. The next fixed step publishes the live poses again. The map bake (scripts/bake-maps.mjs, SF66 / G252)
   * calls it, through the level's debug exposure, in the same task as its render, so a moving deck is drawn where it rests.
   */
  showRest(): void {
    for (const m of this.data) this.views.get(m.id)?.({ position: { x: m.at.x, y: m.at.y, z: m.at.z }, euler: { x: m.euler.x, y: m.euler.y, z: m.euler.z }, enabled: m.enabled });
  }
  /** After a logical checkpoint load, bring fresh native bodies to the restored published poses without a physics step. */
  resetPublishedPoses(): void { for (const [id, body] of this.bodies) body.resetPose(this.pose(id)); }
  /** Pending interactions are continuation state; the shared host's own adapter owns fields and full Wasm memory/globals. */
  snapshot(resetIds: ReadonlySet<string> = new Set()): readonly (readonly [string, number])[] { return [...this.pending].filter(([id]) => !resetIds.has(id)); }
  /** Restore pending commands only after validating every row, without partial publication. */
  restore(pending: readonly (readonly [string, number])[]): void { if (new Set(pending.map(([id]) => id)).size !== pending.length || pending.some(([id, action]) => !this.data.some((m) => m.id === id) || ![1, 2, 3].includes(action))) throw new Error('Invalid mover commands'); this.pending = new Map(pending); }
  /** Handle-only continuation; native poses and velocities already belong to the host's physics snapshot. */
  snapshotBodies(): MoverBodyState[] { return [...this.bodyHandles].map(([id, handle]) => ({ id, handle })); }
  /** Validate the whole handle table before publishing any new native identity. */
  restoreBodies(rows: readonly MoverBodyState[]): void {
    const ids = this.data.filter(row => row.kind !== 'chain' && row.kind !== 'channel').map(row => row.id);
    if (rows.length !== ids.length || new Set(rows.map(row => row.id)).size !== rows.length || new Set(rows.map(row => row.handle)).size !== rows.length
      || rows.some(row => !ids.includes(row.id) || !Number.isFinite(row.handle) || row.handle < 0)) throw new Error('Invalid mover native continuation');
    this.bodyHandles = new Map(rows.map(row => [row.id, row.handle]));
  }
  /** Commands and native handles share one bounded adapter; transient lift interactions are not replayed after loading. */
  snapshotState(resetIds: ReadonlySet<string> = new Set()): string { return JSON.stringify({ pending: this.snapshot(resetIds), bodies: this.snapshotBodies(), lifecycle: this.lifecycle.snapshot(), ...(this.riders.size === 0 ? {} : { riders: [...this.riders] }) }); }
  /** Parse all continuation fields atomically, without a command, native mutation or gameplay step. */
  restoreState(text: string): void {
    const saved = v.parse(continuation, JSON.parse(text)), pending = this.pending, handles = this.bodyHandles, lifecycle = this.lifecycle.snapshot(), seed = this.seedLifecycleOnReconnect;
    try {
      this.restore(saved.pending); this.restoreBodies(saved.bodies);
      this.riders.clear(); for (const [mover, rider] of saved.riders ?? []) this.riders.set(mover, rider);
      this.seedLifecycleOnReconnect = saved.lifecycle === undefined;
      if (saved.lifecycle !== undefined) this.lifecycle.restore(saved.lifecycle);
      else this.lifecycle.drain();
    } catch (error) { this.pending = pending; this.bodyHandles = handles; this.lifecycle.restore(lifecycle); this.seedLifecycleOnReconnect = seed; throw error; }
  }
  /** After native world/tag restore, reconnect existing bodies and reset only durable lift road poses. */
  reconnect(resetIds: ReadonlySet<string> = new Set()): void {
    for (const row of this.data) if (row.carry !== undefined) this.previousRides.set(row.id, [1, 0.5].includes(this.host.world.entity(row.entity)?.fields[6] ?? 0));
    if (this.data.some(row => row.kind === 'chain') || [...resetIds].some(id => !this.data.some(row => row.id === id))) throw new Error('Unsupported mover native reconnect');
    const bodies = new Map<string, KinematicMover>();
    for (const row of this.data) {
      if (row.kind === 'channel') continue;
      const handle = this.bodyHandles.get(row.id); if (handle === undefined) throw new Error('Missing mover native continuation');
      bodies.set(row.id, new KinematicMover(this.physics(), row.boxes, this.pose(row.id), row.id, row.kind === 'static', handle));
    }
    this.bodies.clear(); for (const [id, body] of bodies) { this.bodies.set(id, body); if (resetIds.has(id)) body.resetPose(this.pose(id)); }
    if (this.seedLifecycleOnReconnect) {
      // Old native saves have no latch state. Seed only after the host world has also restored.
      for (const row of this.data) this.lifecycle.seed(row.id, this.host.world.entity(row.entity)?.fields ?? {});
      this.seedLifecycleOnReconnect = false;
    }
  }
}

const driverFinite = v.pipe(v.number(), v.finite());
const driverEntity = v.strictObject({ id: v.pipe(driverFinite, v.integer(), v.minValue(1), v.maxValue(0x7fffffff)), name: v.pipe(v.string(), v.maxLength(128)),
  position: v.tuple([driverFinite, driverFinite, driverFinite]), fields: v.record(v.string(), driverFinite), frozen: v.boolean(), interactive: v.boolean() });
/** Native composition facts on the existing host: verified modules and actor-bound role aliases are supplied by its session. */
export interface DeclaredMoverComposition { content: Omit<ShardScriptContent, 'sim'> & { sim: Omit<ShardScriptContent['sim'], 'scripts'> }; assets: ReadonlyMap<string, Uint8Array>;
  rules: ShardScriptPorts['rules']; declarations?: readonly DeclaredScriptRoleBinding[] }
/** The mover's field/query role shares its level's host, module union, fuel, events and effect allowances. */
export class MoverScriptDriver {
  readonly data: MoverData;
  readonly world: ScriptWorld;
  readonly nativeMotions: readonly NativeMoverMotion[];
  private readonly contract: string;
  private readonly query: ScriptQuery;
  private readonly resetIds: ReadonlySet<string>;
  private runtime: MoverRuntime | undefined;
  /** Lift-only modules reset on load; sharing their memory with persistent movers is refused. */
  readonly transientModules: readonly string[];
  constructor(input: MoverData, physicsQueries: ScriptQuery | Pick<SimHost, 'physics'>, resetIds: readonly string[] = []) {
    const query: ScriptQuery = typeof physicsQueries === 'function' ? physicsQueries : (kind, values, entity) =>
      scriptPhysicsQueries({ physics: physicsQueries.physics, navigation: { closestWalkable: () => null, findPath: () => null }, handle: () => undefined })(kind, values, entity);
    this.data = parseMovers(input); this.query = moverQueries(this.data, query);
    this.resetIds = new Set(resetIds);
    if (this.resetIds.size !== resetIds.length || resetIds.some(id => !this.data.some(row => row.id === id))) throw new Error('Invalid transient mover identity');
    this.nativeMotions = this.data.filter(row => row.execution === 'native').map(nativeMotion);
    this.transientModules = [...new Set(this.data.filter(row => row.execution !== 'native' && this.resetIds.has(row.id)).map(row => row.module))].sort();
    if (this.data.some(row => !this.resetIds.has(row.id) && this.transientModules.includes(row.module))) throw new Error('Lift module cannot own persistent movers');
    const savedRows = continuationRows(this.data);
    this.contract = JSON.stringify(resetIds.length === 0 ? savedRows : { data: savedRows, resetIds: [...resetIds].sort() });
    this.world = new ScriptWorld({ fields: MOVER_FIELD_RANGES, archetypes: [], events: [], maxEntities: 32 }, moverScriptEntities(this.data));
  }
  /** No events cross into mover entity fields from the numeric/brain role. */
  role(): ScriptRole { return { id: 'mover', world: this.world, query: this.query, events: 'consume', snapshot: () => this.snapshot(), restore: text => { this.restore(text); } }; }
  /** Every due call runs under the existing one beginTick; the runtime only publishes admitted collision poses. */
  schedule(runtime: () => MoverRuntime, permissions: () => ReadonlyMap<string, number> = () => new Map()): ScriptSchedule {
    const rows = new Map(this.data.map(row => [row.entity, row]));
    return { id: 'mover', role: 'mover', bindings: this.data.map(row => ({ module: row.module, entity: row.entity, divisor: 1,
      ...(row.execution === 'native' ? { motion: nativeMotion(row) } : {}) })),
      input: (binding, tick) => {
        const row = rows.get(binding.entity); if (row === undefined) throw new Error('Missing mover binding');
        return runtime().scriptInput(row.id, tick, permissions().get(row.id) ?? 0);
      }, committed: (binding, call) => {
        const row = rows.get(binding.entity); if (row === undefined) throw new Error('Missing mover binding');
        runtime().publish(row.id, call.ok);
      },
    };
  }
  /** Compose numeric, mover and optional trusted roles under one host's aggregate allowances.
   * Extra roles retain their own owner grants and event policy; omitted roles preserve the existing continuation. */
  compose(content: ShardScriptContent, assets: ReadonlyMap<string, Uint8Array>, ports: ShardScriptPorts,
    brains?: DeclaredScriptBrainPorts, permissions: () => ReadonlyMap<string, number> = () => new Map(),
    extra?: { roles: readonly ScriptRole[]; declarations?: readonly DeclaredScriptRoleBinding[]; schedules?: readonly ScriptSchedule[] }): ReturnType<typeof createShardfileComposedLane> {
    return createShardfileComposedLane(content, assets, ports, brains, { roles: [this.role(), ...(extra?.roles ?? [])], transientModules: this.transientModules, nativeMotions: this.nativeMotions, ...(extra?.declarations === undefined ? {} : { declarations: extra.declarations }),
      schedules: [this.schedule(() => { if (this.runtime === undefined) throw new Error('Missing mover runtime'); return this.runtime; }, permissions), ...(extra?.schedules ?? [])] });
  }
  /** Attach native handles to the same host; an explicit drive owns one fixed tick, never another script host. */
  install(sim: SimHost, input: ReturnType<typeof createShardfileComposedLane> | DeclaredMoverComposition, options: { id: string; restoring?: boolean; restoreFlags?: ReadonlySet<string>; activation?: MoverActivationPorts; drive?: boolean; permissions?: () => ReadonlyMap<string, number> }): MoverRuntime {
    if (this.runtime !== undefined) throw new Error('Mover driver is already installed');
    const lane = 'host' in input ? input : this.compose({ ...input.content, sim: { ...input.content.sim, scripts: [...input.assets.keys()] } }, input.assets,
      { rules: input.rules, entities: [], actors: new Map(), query: () => [] }, undefined, options.permissions,
      { roles: [], ...(input.declarations === undefined ? {} : { declarations: input.declarations }) });
    const runtime = new MoverRuntime(this.data, { lane, flags: sim.flags, host: lane.host, physics: () => sim.physics, scope: sim.scope,
      ...(options.restoring === undefined ? {} : { restoring: options.restoring }),
      ...(options.restoreFlags === undefined ? {} : { restoreFlags: options.restoreFlags }),
      activation: { ground: () => playerGrounds(sim), ...options.activation } });
    this.runtime = runtime; runtime.bindNativeCarry(sim);
    for (const row of this.data) publishScriptBody(sim, row.id, () => runtime.pose(row.id));
    sim.onStep(options.id, () => { if (options.drive === true) lane.step(sim.state.tick); runtime.capture(); }, {
      snapshot: () => runtime.snapshotState(this.resetIds), restore: value => {
        if (typeof value !== 'string') throw new Error('Invalid mover continuation'); runtime.restoreState(value);
      }, physicsRestored: () => { runtime.reconnect(this.resetIds); } });
    if (options.drive === true) sim.onStep(`${options.id}.script`, () => undefined, { snapshot: () => lane.snapshot(), restore: value => {
      if (typeof value !== 'string') throw new Error('Invalid script adapter snapshot'); lane.restore(value);
    } });
    return runtime;
  }
  /** Typed role state; the owning composition captures module memories and host quotas once. */
  snapshot(): string {
    const initial = new Map(moverScriptEntities(this.data).map(row => [row.id, row]));
    return JSON.stringify({ contract: this.contract, entities: this.world.state().map(row => this.resetIds.has(row.name) ? initial.get(row.id) : row) });
  }
  /** Restore matching entity identities atomically without commands, body movement or script execution. */
  restore(text: string): void {
    const saved = v.parse(v.strictObject({ contract: v.string(), entities: v.pipe(v.array(driverEntity), v.maxLength(32)) }), JSON.parse(text));
    if (saved.contract !== this.contract || saved.entities.length !== this.data.length
      || saved.entities.some(row => !this.data.some(mover => mover.entity === row.id && mover.id === row.name))) throw new Error('Incompatible mover role continuation');
    const initial = new Map(moverScriptEntities(this.data).map(row => [row.id, row]));
    if (saved.entities.some(row => this.resetIds.has(row.name) && JSON.stringify(row) !== JSON.stringify(initial.get(row.id)))) throw new Error('Lift continuation must reset at the road stop');
    this.world.restore(saved.entities);
  }
}

/** Prepare one page composition; mover calls still run in their original fixed.pre phase. */
export async function createComposedMoverHost(data: MoverData, assets: ReadonlyMap<string, Uint8Array>, physicsQueries: ScriptQuery,
  extra: MoverRoleComposition): Promise<ReturnType<typeof createShardfileComposedLane>> {
  if (!Number.isSafeInteger(extra.seed) || extra.seed < 0) throw new Error('Invalid composed mover seed');
  const driver = new MoverScriptDriver(data, physicsQueries), modules = new Map(await verifiedMoverModules(assets, driver.data));
  for (const [hash, bytes] of await verifiedScriptModules(extra.modules, [...extra.modules.keys()])) modules.set(hash, bytes);
  return createShardfileComposedLane({ identity: { seed: extra.seed }, sim: { scripts: [...modules.keys()], bindings: [], scriptTickDivisor: 1 },
    state: { shared: [], player: [] } }, modules, { rules: { fields: {}, archetypes: [], events: [], maxEntities: 32 }, entities: [], actors: new Map(), query: () => [] },
  undefined, { roles: [driver.role(), ...extra.roles], schedules: extra.schedules ?? [], transientModules: driver.transientModules, nativeMotions: driver.nativeMotions, ...(extra.declarations === undefined ? {} : { declarations: extra.declarations }) });
}

/** Copy and SHA-256-check each declared module before constructing a headless host. */
export function verifiedMoverModules(assets: ReadonlyMap<string, Uint8Array>, rows: MoverData): Promise<ReadonlyMap<string, Uint8Array>> {
  return verifiedScriptModules(assets, parseMovers(rows).filter(row => row.execution !== 'native').map(row => row.module));
}
