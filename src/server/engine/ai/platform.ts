import * as v from 'valibot';
import type { AnimalSim, AnimalSimSpec } from '../../../shared/engine/entities/AnimalSim';
import type { SimHost, SimSpawn, SimStrike, SimValue } from '../sim';
import { castRay } from '../../../shared/engine/physics/query';

/** One reusable pursuit archetype; all tuning is authored data, never a shard callback. */
export interface PlatformBrainSpec {
  id: string; kind: 'pursue'; awareRadius: number; leashRadius: number; speed: number; returnSpeed: number;
  stopDistance: number; turnRate: number; thinkDivisor: number; attackCooldownTicks: number; wanderRadius: number; wanderEveryTicks: number;
}
/** Stable spawn identities produce the exact same entity set when a fresh sim restores a snapshot. */
export interface PlatformSpawn { id: string; species: string; variant: string; brain: string | null; strike: string | null; seed: number; scale: number; at: readonly [number, number, number]; yaw: number }
/** A perceived live target, identified independently of its renderer or collision handle. */
export interface BrainTarget { id: string; position: { x: number; y: number; z: number }; alive: boolean }
/** Read-only perception/navigation and an explicit attack request; the motor and damage pipeline stay authoritative. */
export interface PlatformBrainPorts {
  targets: () => readonly BrainTarget[]; visible: (from: BrainTarget['position'], to: BrainTarget['position']) => boolean;
  path: (from: BrainTarget['position'], to: BrainTarget['position']) => readonly BrainTarget['position'][];
  attack: (targetId: string) => void; random: () => number;
}
const mode = v.picklist(['idle', 'wander', 'pursue', 'attack', 'return', 'dead']);
const finite = v.pipe(v.number(), v.finite());
const natural = v.pipe(finite, v.integer(), v.minValue(0));
const stateSchema: v.GenericSchema<PursuitBrainStateDataInput, PursuitBrainStateData> = v.strictObject({ mode, target: v.nullable(v.string()), cooldown: natural, wanderUntil: natural, waypoint: v.tuple([finite, finite, finite]), tick: natural });
const brainCheckpoint = v.strictObject({ contract: v.string(), state: stateSchema });
type BrainState = v.InferOutput<typeof stateSchema>;
const distance = (a: BrainTarget['position'], b: BrainTarget['position']): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
/** Per-entity fixed-tick pursuit, perception, leashing and idle wandering with a complete continuation. */
export class PlatformBrain {
  private state: BrainState;
  private readonly spec: PlatformBrainSpec;
  private readonly home: BrainTarget['position'];
  private readonly contract: string;
  private readonly actor: AnimalSim;
  private readonly ports: PlatformBrainPorts;
  constructor(actor: AnimalSim, spec: PlatformBrainSpec, home: BrainTarget['position'], ports: PlatformBrainPorts) {
    if (!Object.values(home).every(Number.isFinite) || ![spec.awareRadius, spec.leashRadius, spec.speed, spec.returnSpeed, spec.stopDistance, spec.turnRate, spec.wanderRadius].every((n) => Number.isFinite(n) && n >= 0)
      || spec.awareRadius > spec.leashRadius || spec.leashRadius > 500 || spec.speed > 15 || spec.returnSpeed > 15 || spec.stopDistance > spec.awareRadius
      || !Number.isSafeInteger(spec.thinkDivisor) || spec.thinkDivisor < 1 || 60 % spec.thinkDivisor !== 0
      || !Number.isSafeInteger(spec.attackCooldownTicks) || spec.attackCooldownTicks < 1 || !Number.isSafeInteger(spec.wanderEveryTicks) || spec.wanderEveryTicks < 1) throw new Error('Invalid platform brain');
    this.actor = actor; this.spec = { ...spec }; this.home = { ...home }; this.ports = ports;
    this.contract = JSON.stringify({ spec: this.spec, home: this.home });
    this.state = { mode: 'idle', target: null, cooldown: 0, wanderUntil: 0, waypoint: [home.x, home.y, home.z], tick: 0 };
  }
  /** Observable state for diagnostics and data-driven encounter hooks. */
  get mode(): BrainState['mode'] { return this.state.mode; }
  /** Plain numeric continuation; no ports, actor objects or navigation heap are serialized. */
  snapshot(): SimValue { return { contract: this.contract, state: { ...this.state, waypoint: [...this.state.waypoint] } }; }
  /** Restore a validated continuation on a matching registered actor. */
  restore(saved: SimValue): void {
    const checked = v.parse(brainCheckpoint, saved); if (checked.contract !== this.contract) throw new Error('Incompatible brain continuation');
    this.state = checked.state;
  }
  /** Think at the authored divisor; motion remains fixed-step through AnimalSim and its collision motor. */
  step(tick: number): void {
    if (!Number.isSafeInteger(tick) || tick <= this.state.tick) throw new Error('Non-monotonic brain tick');
    this.state.tick = tick; this.state.cooldown = Math.max(0, this.state.cooldown - 1);
    if (!this.actor.alive) { this.state.mode = 'dead'; this.state.target = null; this.actor.setMotion(this.actor.yaw, 0, this.spec.turnRate); return; }
    if (tick % this.spec.thinkDivisor !== 0) return;
    const at = this.actor.position, homeDistance = distance(at, this.home), targets = this.ports.targets();
    let target = targets.find((candidate) => candidate.id === this.state.target && candidate.alive);
    if (homeDistance > this.spec.leashRadius || (target && distance(target.position, this.home) > this.spec.leashRadius)) { target = undefined; this.state.mode = 'return'; }
    if (this.state.mode === 'return' && homeDistance > this.spec.stopDistance) { this.move(this.home, this.spec.returnSpeed); return; }
    target ??= targets.filter((candidate) => candidate.alive && distance(at, candidate.position) <= this.spec.awareRadius && distance(candidate.position, this.home) <= this.spec.leashRadius && this.ports.visible(at, candidate.position))
      .sort((a, b) => distance(at, a.position) - distance(at, b.position) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))[0];
    if (target) {
      this.state.target = target.id;
      if (distance(at, target.position) <= this.spec.stopDistance && this.ports.visible(at, target.position)) {
        this.state.mode = 'attack'; this.actor.setMotion(Math.atan2(target.position.x - at.x, target.position.z - at.z), 0, this.spec.turnRate);
        if (this.state.cooldown === 0) { this.ports.attack(target.id); this.state.cooldown = this.spec.attackCooldownTicks; }
      } else { this.state.mode = 'pursue'; this.move(target.position, this.spec.speed); }
      return;
    }
    this.state.target = null;
    if (this.spec.wanderRadius === 0) { this.state.mode = 'idle'; this.actor.setMotion(this.actor.yaw, 0, this.spec.turnRate); return; }
    if (tick >= this.state.wanderUntil) {
      const angle = this.ports.random() * Math.PI * 2, radius = this.ports.random() * this.spec.wanderRadius;
      this.state.waypoint = [this.home.x + Math.sin(angle) * radius, this.home.y, this.home.z + Math.cos(angle) * radius]; this.state.wanderUntil = tick + this.spec.wanderEveryTicks;
    }
    this.state.mode = 'wander'; this.move({ x: this.state.waypoint[0], y: this.state.waypoint[1], z: this.state.waypoint[2] }, this.spec.speed * 0.5);
  }
  private move(target: BrainTarget['position'], speed: number): void {
    const at = this.actor.position, path = this.ports.path(at, target);
    if (path.length === 0) { this.actor.setMotion(this.actor.yaw, 0, this.spec.turnRate); return; }
    const point = path.find((p) => distance(at, p) > 0.4) ?? target;
    if (![point.x, point.y, point.z].every(Number.isFinite)) throw new Error('Invalid brain path');
    this.actor.setMotion(Math.atan2(point.x - at.x, point.z - at.z), distance(at, target) > this.spec.stopDistance ? speed : 0, this.spec.turnRate);
  }
}
/** Catalogue lookup may resolve variant-specific health/modifiers before a spawn is constructed. */
export type PlatformSpecies = ReadonlyMap<string, AnimalSimSpec> | ((species: string, variant: string) => AnimalSimSpec);
/** Expand declarative spawns before boot: no hidden allocations or random entity ids appear mid-tick. */
export function buildPlatformSpawns(rows: readonly PlatformSpawn[], species: PlatformSpecies, strikes: ReadonlyMap<string, SimStrike> = new Map()): SimSpawn[] {
  if (rows.length > 10000 || new Set(rows.map((row) => row.id)).size !== rows.length) throw new Error('Spawn identity/count');
  return rows.map((row) => {
    const spec = typeof species === 'function' ? species(row.species, row.variant) : species.get(row.species);
    if (!spec || !row.at.every((n) => Number.isFinite(n) && Math.abs(n) <= 250) || !Number.isFinite(row.scale) || row.scale <= 0 || row.scale > 10 || !Number.isFinite(row.yaw) || !Number.isSafeInteger(row.seed)) throw new Error('Invalid declared spawn');
    const strike = row.strike === null ? undefined : strikes.get(row.strike); if (row.strike !== null && !strike) throw new Error('Unresolved spawn strike');
    return { id: row.id, spec: { ...spec, variant: row.variant, mods: { ...spec.mods }, dims: { ...spec.dims, feet: [...spec.dims.feet] } }, seed: row.seed, scale: row.scale, at: { x: row.at[0], y: row.at[1], z: row.at[2] }, yaw: row.yaw, ...(strike ? { strike: { ...strike, shape: { ...strike.shape }, tags: [...strike.tags] } } : {}) };
  });
}
/** A bounded path port can be backed by the engine navmesh; direct pursuit still resolves collisions in the motor. */
export type BrainNavigation = PlatformBrainPorts['path'];
/** Validate and construct all pursuit policies without registering fixed-step work or consuming random state. */
export function preparePlatformBrains(sim: SimHost, rows: readonly PlatformSpawn[], specs: readonly PlatformBrainSpec[], navigation: BrainNavigation = (_from, to) => [to]): ReadonlyMap<string, PlatformBrain> {
  const definitions = new Map(specs.map((spec) => [spec.id, spec])), result = new Map<string, PlatformBrain>();
  if (definitions.size !== specs.length) throw new Error('Duplicate brain archetype');
  for (const row of rows) {
    if (row.brain === null) continue; // A phase encounter owns this actor.
    const actor = sim.entities.get(row.id), spec = definitions.get(row.brain);
    if (!actor || !spec || result.has(row.id)) throw new Error('Unresolved brain/spawn');
    const brain = new PlatformBrain(actor, spec, { x: row.at[0], y: row.at[1], z: row.at[2] }, {
      targets: () => Array.from(sim.players.values(), player => ({ id: player.id, position: player.position, alive: player.health.alive })),
      visible: (from, to) => {
        const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z, length = Math.hypot(dx, dy, dz);
        if (length < 1e-6) return true;
        const hit = castRay(sim.physics, { x: from.x, y: from.y + 1, z: from.z }, { x: dx / length, y: dy / length, z: dz / length }, length);
        return !hit || hit.distance >= length - 0.1;
      }, path: navigation, attack: (target) => { sim.startStrike(row.id, target); }, random: () => sim.rng.stream('ai').next(),
    });
    result.set(row.id, brain);
  }
  return result;
}

/** Complete admitted continuation, independent of validator implementation metadata. */
type PursuitBrainStateDataInput = PursuitBrainStateData;
interface PursuitBrainStateDataFields {
    mode: "idle" | "wander" | "pursue" | "attack" | "return" | "dead";
    target: string | null;
    cooldown: number;
    wanderUntil: number;
    waypoint: [
        number,
        number,
        number
    ];
    tick: number;
}
type PursuitBrainStateData = { [Key in keyof PursuitBrainStateDataFields]: PursuitBrainStateDataFields[Key] };
