import type { CombatTag } from '../combat/pipeline';
import { Hfsm } from './hfsm';

export interface BrainPoint { x: number; y: number; z: number }
export interface StrikeActor {
  readonly position: BrainPoint; readonly alive: boolean; readonly scale: number; readonly yaw: number;
  startAttack: (seconds: number) => void; cancelAttack: () => void;
  setMotion: (yaw: number, speed: number, turn: number) => void;
}
/** where a creature's strike lands, around it: an arc, a lane, a ring or a wedge */
export type StrikeShape =
  | { kind: 'arc'; radius: number; halfAngle: number; yawOffset?: number }
  | { kind: 'lane'; length: number; width: number }
  | { kind: 'ring'; inner: number; outer: number }
  | { kind: 'wedge'; length: number; halfAngle: number }
  | { kind: 'point'; radius: number; exclusive?: boolean }
  | { kind: 'sphere'; radius: number }
  | { kind: 'cone3d'; length: number; halfAngle: number }
  | { kind: 'ray3d'; length: number; radius: number };
export interface StrikeContext {
  readonly actor: StrikeActor; readonly target: BrainPoint;
  readonly airborne?: boolean;
  readonly origin?: BrainPoint;
  readonly ringRadius?: number;
  /** Actual three-dimensional aim for point contacts; never inferred from actor yaw. */
  readonly direction?: BrainPoint;
  canReach: () => boolean;
  hit: (spec: StrikeSpec) => void;
}
export interface StrikeSpec {
  id: string; shape: StrikeShape; windup: number; active: number; recover: number; cooldown: number;
  range: number; damage: number; tags: readonly CombatTag[];
  weight: (ctx: StrikeContext) => number;
  units?: 'world' | 'actor';
  alternatives?: readonly StrikeShape[];
  /**
   * A charge: the actor runs the lane, and its active window ends when it reaches the lane's end (or after
   * length / max(1, speed) + 1.2 s). `speed` is the runner's own drive (none when the owning brain drives the body, as
   * the ram grazer does). Without `motion` a lane is swept, not run: it ends at `active`.
   */
  motion?: { speed?: number; delay?: number; track?: 'none' | 'lead' | 'follow'; overshoot?: number; skid?: number };
  eligibility?: { maxDy?: number; jumpDodges?: boolean };
}
export interface UtilityScore { id: string; score: number }
export type StrikePhase = 'idle' | 'windup' | 'active' | 'recover' | 'cooldown';
interface StrikeState {
  version: number; phase: StrikePhase; currentId: string | null; hit: boolean; elapsed: number; speedMul: number; clock: number;
  deadlines: { id: string; at: number }[]; scores: UtilityScore[];
  x0: number; z0: number; x1: number; z1: number; yaw: number; length: number;
}
const PHASES = { idle: {}, windup: {}, active: {}, recover: {}, cooldown: {} };
const distance = (a: BrainPoint, b: BrainPoint): number => Math.hypot(b.x - a.x, b.z - a.z);
const wrap = (angle: number): number => Math.atan2(Math.sin(angle), Math.cos(angle));
const laneMotion = (spec: StrikeSpec): boolean => spec.shape.kind === 'lane' || (spec.shape.kind === 'sphere' && spec.motion?.track === 'lead');

/** One simulation clock, with presentation supplied by the owning creature's view. */
export class StrikeRunner {
  private readonly hfsm = new Hfsm<StrikePhase>(PHASES, 'idle', undefined);
  private current: StrikeSpec | null = null;
  private hit = false;
  private elapsed = 0;
  private speedMul = 1;
  private readonly deadlines = new Map<string, number>();
  private clock = 0;
  private readonly scores: UtilityScore[] = [];
  x0 = 0; z0 = 0; x1 = 0; z1 = 0; yaw = 0; length = 0;
  get state(): StrikePhase { return this.hfsm.state; }
  get time(): number { return this.elapsed; }
  /** Seconds since this strike began, through its windup and on: its `time` is only its current state's. */
  get through(): number {
    const spec = this.current;
    if (spec === null) return 0;
    return this.state === 'windup' ? this.elapsed : this.elapsed + spec.windup + (this.state === 'recover' || this.state === 'cooldown' ? spec.active : 0) + (this.state === 'cooldown' ? spec.recover : 0);
  }
  get spec(): StrikeSpec | null { return this.current; }
  get busy(): boolean { return this.state !== 'idle'; }
  get lastPick(): readonly UtilityScore[] { return this.scores; }
  snapshot(): StrikeState {
    return { version: 1, phase: this.state, currentId: this.current?.id ?? null, hit: this.hit, elapsed: this.elapsed,
      speedMul: this.speedMul, clock: this.clock, deadlines: [...this.deadlines].map(([id, at]) => ({ id, at })),
      scores: this.scores.map((row) => ({ ...row })), x0: this.x0, z0: this.z0, x1: this.x1, z1: this.z1, yaw: this.yaw, length: this.length };
  }
  /** Authored strike functions are supplied by the fresh host, never serialized. */
  restore(state: StrikeState, specs: readonly StrikeSpec[]): void {
    const current = state.currentId === null ? null : specs.find((spec) => spec.id === state.currentId);
    if (state.version !== 1 || !Object.hasOwn(PHASES, state.phase) || current === undefined
      || (state.phase !== 'idle' && current === null) || typeof state.hit !== 'boolean'
      || ![state.elapsed, state.speedMul, state.clock, state.x0, state.z0, state.x1, state.z1, state.yaw, state.length].every(Number.isFinite)
      || state.elapsed < 0 || state.clock < 0 || state.speedMul <= 0
      || state.deadlines.some((row) => !Number.isFinite(row.at)) || state.scores.some((row) => !Number.isFinite(row.score))) throw new RangeError('Invalid strike snapshot');
    this.current = current; this.hit = state.hit; this.elapsed = state.elapsed; this.speedMul = state.speedMul; this.clock = state.clock;
    this.deadlines.clear(); for (const row of state.deadlines) this.deadlines.set(row.id, row.at);
    this.scores.splice(0, this.scores.length, ...state.scores.map((row) => ({ ...row })));
    this.x0 = state.x0; this.z0 = state.z0; this.x1 = state.x1; this.z1 = state.z1; this.yaw = state.yaw; this.length = state.length;
    this.hfsm.transition(state.phase);
  }

  /** Stable list order breaks equal-score ties. Cooling and out-of-range rows are ineligible. */
  pick(specs: readonly StrikeSpec[], ctx: StrikeContext): StrikeSpec | null {
    let best: StrikeSpec | null = null, score = -Infinity; this.scores.length = 0;
    for (const spec of specs) {
      const reach = spec.shape.kind === 'sphere' ? Math.hypot(ctx.target.x - ctx.actor.position.x, ctx.target.y - ctx.actor.position.y, ctx.target.z - ctx.actor.position.z) : distance(ctx.actor.position, ctx.target);
      if ((this.deadlines.get(spec.id) ?? 0) > this.clock || reach > spec.range) continue;
      const value = spec.weight(ctx); if (!Number.isFinite(value)) continue;
      this.scores.push({ id: spec.id, score: value });
      if (value > score) { best = spec; score = value; }
    }
    this.scores.sort((a, b) => b.score - a.score); return best;
  }
  start(spec: StrikeSpec, actor: StrikeActor, target: BrainPoint, speedMul = 1): void {
    this.current = spec; this.elapsed = 0; this.hit = false; this.speedMul = speedMul;
    this.x0 = actor.position.x; this.z0 = actor.position.z;
    const dx = target.x - this.x0, dz = target.z - this.z0, d = Math.hypot(dx, dz) || 1;
    this.length = laneMotion(spec) ? (spec.motion?.track === 'lead' ? d : spec.shape.kind === 'lane' ? spec.shape.length : d) + (spec.motion?.overshoot ?? 0) : 0;
    this.x1 = this.x0 + dx / d * this.length; this.z1 = this.z0 + dz / d * this.length;
    this.yaw = Math.atan2(dx, dz); this.hfsm.transition('windup'); actor.startAttack(spec.windup);
  }
  cancel(): void { this.hfsm.transition('idle'); this.current = null; this.elapsed = 0; }
  /** An authored arena edge can end a committed lane without cancelling its recovery window. */
  recoverNow(): void { if (this.state === 'active') this.phase('recover'); }
  /** Contact on an authored goal/hazard clock; no timing or random draw is consumed. */
  contact(spec: StrikeSpec, ctx: StrikeContext): boolean {
    if (!this.contains(spec, ctx) || (!spec.tags.includes('cover.exempt') && !ctx.canReach())) return false;
    ctx.hit(spec); return true;
  }
  update(dt: number, ctx: StrikeContext): void {
    this.clock += dt; const spec = this.current; if (spec === null || this.state === 'idle') return;
    this.elapsed += dt; const a = ctx.actor;
    if (!a.alive) { this.cancel(); a.cancelAttack(); return; }
    if (this.state === 'windup') {
      if (laneMotion(spec)) a.setMotion(this.yaw, 0, 6);
      if (this.elapsed >= spec.windup) { this.phase('active'); a.cancelAttack(); }
      return;
    }
    if (this.state === 'active') {
      if (laneMotion(spec)) a.setMotion(this.yaw, (spec.motion?.speed ?? 0) * this.speedMul, 0.35);
      if (!this.hit && this.elapsed >= (spec.motion?.delay ?? 0)) this.hit = this.contact(spec, ctx);
      // a charge (declared `motion`) runs until the actor reaches the lane's end, or a runaway timeout; a motionless lane
      // (a wall of wind swept from a hover) keeps its full length for contact and ends at its declared `active` window
      if (laneMotion(spec) && spec.motion !== undefined) {
        const along = ((a.position.x - this.x0) * (this.x1 - this.x0) + (a.position.z - this.z0) * (this.z1 - this.z0)) / (this.length * this.length);
        if (along >= 1 || this.elapsed > this.length / Math.max(1, (spec.motion.speed ?? 0) * this.speedMul) + 1.2) this.phase('recover');
      } else if (this.elapsed >= spec.active) this.phase('recover');
      return;
    }
    if (this.state === 'recover') {
      if (laneMotion(spec)) a.setMotion(a.yaw, 0, 1.5);
      if (this.elapsed >= (spec.motion?.skid ?? spec.recover)) {
        this.deadlines.set(spec.id, this.clock + spec.cooldown);
        if (spec.cooldown > 0) this.phase('cooldown'); else this.cancel();
      }
      return;
    }
    if (this.elapsed >= spec.cooldown) this.cancel();
  }
  private phase(state: StrikePhase): void { this.hfsm.transition(state); this.elapsed = 0; }
  /** Pure overlap query for callers that own cover and damage. No callbacks run and no runner state changes. */
  contains(spec: StrikeSpec, ctx: Omit<StrikeContext, 'actor' | 'canReach' | 'hit'> & { actor: Pick<StrikeActor, 'position' | 'scale' | 'yaw'> }): boolean {
    const { actor: a, target: p } = ctx;
    const origin = ctx.origin ?? a.position;
    const scale = spec.units === 'world' ? 1 : spec.units === 'actor' ? a.scale : Math.max(1, a.scale);
    if (spec.eligibility?.maxDy !== undefined && Math.abs(p.y - a.position.y) > spec.eligibility.maxDy) return false;
    if (spec.eligibility?.jumpDodges === true && ctx.airborne === true) return false;
    const d = distance(origin, p);
    return this.containsShape(spec.shape, spec, ctx, d, scale, origin) || (spec.alternatives?.some((shape) => this.containsShape(shape, spec, ctx, d, scale, origin)) ?? false);
  }
  private containsShape(shape: StrikeShape, spec: StrikeSpec, ctx: Omit<StrikeContext, 'actor' | 'canReach' | 'hit'> & { actor: Pick<StrikeActor, 'position' | 'scale' | 'yaw'> }, d: number, scale: number, origin: BrainPoint): boolean {
    const { actor: a, target: p } = ctx;
    if (shape.kind === 'cone3d' || shape.kind === 'ray3d') {
      const dir = ctx.direction;
      if (dir === undefined) return false;
      const x = p.x - origin.x, y = p.y - origin.y, z = p.z - origin.z;
      const dot = x * dir.x + y * dir.y + z * dir.z;
      if (shape.kind === 'cone3d') {
        const length = Math.hypot(x, y, z);
        return length <= shape.length * scale && (length < 1e-3
          || dot / (length * Math.max(Math.hypot(dir.x, dir.y, dir.z), 1e-6)) >= Math.cos(shape.halfAngle));
      }
      return dot >= 0 && dot <= shape.length * scale
        && Math.hypot(x - dir.x * dot, y - dir.y * dot, z - dir.z * dot) <= shape.radius * scale;
    }
    if (shape.kind === 'sphere') return Math.hypot(p.x - origin.x, p.y - origin.y, p.z - origin.z) <= shape.radius * scale;
    if (shape.kind === 'lane') {
      if (d >= spec.range * scale) return false;
      const dx = this.x1 - this.x0, dz = this.z1 - this.z0, len2 = dx * dx + dz * dz;
      if (len2 < 1e-9) return Math.hypot(p.x - this.x0, p.z - this.z0) <= shape.width * 0.5 + 0.4;
      const t = ((p.x - this.x0) * dx + (p.z - this.z0) * dz) / len2;
      return t >= 0 && t <= 1 && Math.hypot(p.x - (this.x0 + dx * t), p.z - (this.z0 + dz * t)) <= shape.width * 0.5 + 0.4;
    }
    if (shape.kind === 'point') return shape.exclusive === true ? d < shape.radius * scale : d <= shape.radius * scale;
    if (shape.kind === 'ring') {
      const r = ctx.ringRadius ?? (spec.motion?.speed ?? 0) * this.elapsed;
      return d >= shape.inner + r && d <= shape.outer + r;
    }
    const radius = shape.kind === 'arc' ? shape.radius : shape.length;
    const offset = shape.kind === 'arc' ? shape.yawOffset ?? 0 : 0;
    return d <= radius * scale && (d < 1e-4 || Math.abs(wrap(Math.atan2(p.x - origin.x, p.z - origin.z) - a.yaw - offset)) <= shape.halfAngle);
  }
}
