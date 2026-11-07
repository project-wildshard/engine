import type { Scope } from './scope';
import type { SystemSpec, TickRateId } from '../../../client/engine/app/systems';
import * as v from 'valibot';
import { DEFAULT_TICK_RATES, bandAt, checkTickRate, freshClock, tickClock, tickDistance, type TickClock } from '../sim/bands';

export interface TickPoint { readonly x: number; readonly y: number; readonly z: number }
/** Stable optional identity phases only fresh half-body wakes; decision clocks never read it. */
export interface TickActor { readonly position: TickPoint; readonly entityId?: string }
export interface TickBand { upTo: number; brainHz: number | 'paused'; body: 'frame' | 'half' | 'paused' }
export interface TickRate { bands: readonly TickBand[] }
export type InterruptReason = 'hit' | 'target.attack' | 'target.dodge' | 'lost.sight' | 'ally.died';
interface Subject { brain: TickClock; body: TickClock; interrupt: number }
interface Policy { pins: WeakMap<object, number>; interrupts: WeakMap<object, number>; wakes: WeakMap<object, () => void> }
const ORIGIN: TickPoint = { x: 0, y: 0, z: 0 };
// The rates, bands and clock arithmetic are sim/bands.ts's, shared with the renderer-free host (SF72).
const DEFAULTS = DEFAULT_TICK_RATES;
const finite = v.pipe(v.number(), v.finite());
const nonnegative = v.pipe(finite, v.minValue(0));
const frameIndex = v.pipe(v.number(), v.integer(), v.minValue(-1));
const savedClock = v.strictObject({ elapsed: nonnegative, credit: nonnegative, frame: frameIndex, dt: nonnegative,
  last: nonnegative, due: v.boolean(), tickFrame: frameIndex });
const isolatedState = v.strictObject({ contract: v.string(), time: nonnegative, frame: frameIndex, frameDt: nonnegative,
  player: v.strictObject({ x: finite, y: finite, z: finite }), interrupt: v.pipe(v.number(), v.integer(), v.minValue(0)),
  row: v.nullable(v.strictObject({ id: v.string(), brain: savedClock, body: savedClock,
    interrupt: v.pipe(v.number(), v.integer(), v.minValue(0)) })),
});

/** Clocks belong to subjects, not rate classes. Paused time is discarded, never replayed on return. */
export class TickScheduler {
  private readonly rates = new Map<TickRateId, TickRate>(DEFAULTS);
  private subjects = new WeakMap<object, Map<TickRateId, Subject>>();
  private readonly policy: Policy;
  private time = 0;
  private frame = 0;
  private frameDt = 0;
  private player: TickPoint = ORIGIN;
  private owner: object | undefined;
  private multipleSubjects = false;
  private readonly isolated: boolean;
  constructor(parent?: TickScheduler, continuation?: 'isolated') {
    this.policy = parent?.policy ?? { pins: new WeakMap(), interrupts: new WeakMap(), wakes: new WeakMap() };
    if (parent !== undefined && continuation !== undefined) throw new Error('Shared scheduler cannot own isolated continuation');
    this.isolated = continuation === 'isolated';
  }
  /** Create an explicitly private single-subject clock; ordinary application schedulers cannot be restored. */
  static isolated(): TickScheduler { return new TickScheduler(undefined, 'isolated'); }
  get frameHz(): number { return this.frameDt > 0 ? 1 / this.frameDt : 60; }
  configure(overrides: Readonly<Record<string, TickRate>> = {}): void {
    this.rates.clear();
    for (const [id, rate] of DEFAULTS) this.rates.set(id, rate);
    for (const [id, rate] of Object.entries(overrides)) this.rate(id, rate);
    this.subjects = new WeakMap();
    this.owner = undefined; this.multipleSubjects = false;
  }
  beginFrame(dt: number, player: TickPoint = this.player): void {
    if (!Number.isFinite(dt) || dt < 0) throw new Error('Scheduler dt must be finite and nonnegative');
    this.time += dt; this.frameDt = dt; this.frame++; this.player = player;
  }
  rate(id: TickRateId, rate: TickRate): void {
    checkTickRate(id, rate);
    this.rates.set(id, { bands: rate.bands.map((band) => ({ ...band })) });
  }
  pin(actor: object, scope: Scope): void {
    if (scope.disposed) return;
    this.policy.pins.set(actor, (this.policy.pins.get(actor) ?? 0) + 1);
    scope.onDispose(() => { const count = (this.policy.pins.get(actor) ?? 1) - 1; if (count === 0) this.policy.pins.delete(actor); else this.policy.pins.set(actor, count); });
  }
  pinned(actor: object): boolean { return this.policy.pins.has(actor); }
  onInterrupt(actor: object, wake: () => void): void { this.policy.wakes.set(actor, wake); }
  interrupt(actor: object, _why: InterruptReason): void {
    this.policy.interrupts.set(actor, (this.policy.interrupts.get(actor) ?? 0) + 1);
    this.policy.wakes.get(actor)?.();
  }
  forget(actor: object): void { this.subjects.delete(actor); }
  reset(): void { this.subjects = new WeakMap(); this.owner = undefined; this.multipleSubjects = false; }
  private assertIsolated(actor: object): void {
    if (!this.isolated || this.multipleSubjects || (this.owner !== undefined && this.owner !== actor)
      || this.pinned(actor) || this.policy.wakes.has(actor)) throw new Error('Scheduler continuation needs one isolated unpinned subject');
  }
  private rateContract(): string {
    return JSON.stringify([...this.rates].sort(([a], [b]) => a.localeCompare(b)), (_key, value: unknown) => value === Infinity ? 'infinity' : value);
  }
  /** Save a privately owned single-subject clock, including the half-body phase and discarded paused-time fence. */
  captureIsolated(actor: object): string {
    this.assertIsolated(actor);
    const rows = this.subjects.get(actor), row = rows?.entries().next().value;
    return JSON.stringify({ contract: this.rateContract(), time: this.time, frame: this.frame, frameDt: this.frameDt,
      player: { x: this.player.x, y: this.player.y, z: this.player.z }, interrupt: this.policy.interrupts.get(actor) ?? 0,
      row: row === undefined ? null : { id: row[0], ...row[1] } });
  }
  /** Restore only an isolated subject; application/shared clocks, pins and wake registrations are refused before mutation. */
  restoreIsolated(actor: object, saved: string): void {
    this.assertIsolated(actor);
    const parsed: unknown = JSON.parse(saved), state = v.parse(isolatedState, parsed);
    if (state.contract !== this.rateContract() || state.frame < 0 || (state.row !== null && (!this.rates.has(state.row.id)
      || state.row.interrupt > state.interrupt || [state.row.brain, state.row.body].some(c => c.frame > state.frame
        || c.tickFrame > state.frame || c.last > state.time)))) throw new Error('Incompatible scheduler continuation');
    this.time = state.time; this.frame = state.frame; this.frameDt = state.frameDt; this.player = state.player;
    this.subjects = new WeakMap(); this.owner = undefined; this.multipleSubjects = false;
    if (state.row !== null) {
      const { id, ...row } = state.row;
      this.subjects.set(actor, new Map([[id, row]])); this.owner = actor;
    }
    this.policy.interrupts.set(actor, state.interrupt);
  }
  private band(id: TickRateId, actor: TickActor, subject: object = actor): TickBand {
    const rate = this.rates.get(id);
    if (!rate) throw new Error(`Unknown tick rate: ${id}`);
    const distance = this.pinned(subject) ? 0 : tickDistance(actor.position, this.player);
    const band = bandAt(rate, distance);
    if (!band) throw new Error(`Uncovered tick distance: ${id}`);
    return band;
  }
  brainHz(id: TickRateId, actor: TickActor): number { const hz = this.band(id, actor).brainHz; return hz === 'paused' ? 0 : hz; }
  private subject(id: TickRateId, actor: object): Subject {
    let rows = this.subjects.get(actor);
    if (!rows) { rows = new Map(); this.subjects.set(actor, rows); }
    if (this.isolated) {
      if (this.owner === undefined) this.owner = actor;
      else if (this.owner !== actor) this.multipleSubjects = true;
    }
    let row = rows.get(id);
    if (!row) {
      // A driven/scripted actor can switch cadence. Its inactive clock must not catch up on return.
      rows.clear();
      row = { brain: freshClock(this.time, this.frameDt), body: freshClock(this.time, this.frameDt), interrupt: 0 };
      rows.set(id, row);
    }
    return row;
  }
  private due(id: TickRateId, actor: TickActor, body: boolean, subject: object = actor): number {
    const row = this.subject(id, subject), state = body ? row.body : row.brain, band = this.band(id, actor, subject);
    const interrupt = this.policy.interrupts.get(subject) ?? 0;
    // An interrupt wakes decisions only, without catching up the time spent far away.
    const urgent = !body && interrupt !== row.interrupt;
    if (!body) row.interrupt = interrupt; // unchanged unless urgent
    return tickClock(state, band, body, this.time, this.frame, urgent, body ? actor.entityId : undefined);
  }
  brainDt(id: TickRateId, actor: TickActor): number { return this.due(id, actor, false); }
  takeBrainDt(id: TickRateId, actor: TickActor): number {
    const dt = this.brainDt(id, actor), state = this.subject(id, actor).brain; state.dt = 0; state.due = false; return dt;
  }
  /** Instanced ambient rows have stable identities but store their position beside the row. */
  takeBrainDtAt(id: TickRateId, subject: object, point: TickPoint): number {
    const dt = this.due(id, { position: point }, false, subject), state = this.subject(id, subject).brain; state.dt = 0; state.due = false; return dt;
  }
  bodyDt(id: TickRateId, actor: TickActor): number { return this.due(id, actor, true); }
  brainDue(id: TickRateId, actor: TickActor): boolean { this.brainDt(id, actor); return this.subject(id, actor).brain.due; }
  bodyDue(id: TickRateId, actor: TickActor): boolean { this.bodyDt(id, actor); return this.subject(id, actor).body.due; }
  /** A system without an actor is located at the player; creature systems schedule their own subjects. */
  systemDt(system: SystemSpec, dt: number): number {
    if (!system.tick || system.tick === 'always') return dt;
    const hz = this.rates.get(system.tick)?.bands[0]?.brainHz;
    if (hz === undefined) throw new Error(`Unknown tick rate: ${system.tick}`);
    const subject = this.subject(system.tick, system), state = subject.brain;
    state.elapsed += dt;
    state.credit += dt;
    if (hz === 'paused' || state.credit + 1e-9 < 1 / hz) return 0;
    state.credit = hz === Infinity ? 0 : Math.max(0, state.credit - Math.floor((state.credit + 1e-9) * hz) / hz);
    const elapsed = state.elapsed; state.elapsed = 0; return elapsed;
  }
}
