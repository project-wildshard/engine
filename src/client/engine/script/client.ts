import * as v from 'valibot';
import { ScriptHost, type ScriptHostState, type ScriptCall } from '../../../shared/engine/script/host';
import { SCRIPT_PARAMETER_QUERY } from '@wildshard/format/scriptAbi';
import { ScriptWorld, type ScriptEffect, type ScriptEvent, type EffectTransaction } from '../../../shared/engine/script/effects';
import type { ScriptModule } from '../../../server/engine/script/lane';

/** Presentation-only operations. Authoritative field, position, spawn, event and shared/player writes are refused. */
export const CLIENT_SCRIPT_OP: Readonly<{ offset: 101; rotation: 102; scale: 103; particle: 104; }> = Object.freeze({ offset: 101, rotation: 102, scale: 103, particle: 104 });
/** Aggregate presentation ceilings; emitted particles are visual instances, never simulation entities. */
export const CLIENT_SCRIPT_LIMITS: Readonly<{ bindings: 128; particlesPerTick: 256; particlesLive: 4096; emitters: 16; fields: 24; parameters: 64; }> = Object.freeze({ bindings: 128, particlesPerTick: 256, particlesLive: 4096, emitters: 16, fields: 24, parameters: 64 });
/** An admitted visual emitter; its recipe, lifetime and limits are host declarations rather than script effects. */
export interface ClientScriptEmitter { id: number; perTick: number; live: number; lifetimeTicks: number }
/** One stable visual target. Parameters and read count are fixed before any bytecode is instantiated. */
export interface ClientScriptBinding {
  module: string; entity: number; name: string; readCount: number; parameters: readonly number[];
  pose: boolean; maxOffset: number; minScale: number; maxScale: number; emitters: readonly ClientScriptEmitter[];
}
/** A copied, read-only observation supplied by the platform; frozen describes the authoritative sim, not this lane. */
export interface ClientScriptObservation { position: readonly [number, number, number]; frozen: boolean; values: readonly number[] }
/** Validated particle request, published only after the entire script call commits. */
export interface ClientParticleRequest { emitter: number; count: number; lifetimeTicks: number }
/** A visual transform relative to the host's authoritative anchor, plus this tick's bounded particle requests. */
export interface ClientScriptFrame {
  entity: number; tick: number; offset: readonly [number, number, number]; rotation: readonly [number, number, number];
  scale: readonly [number, number, number]; particles: readonly ClientParticleRequest[];
}
/** Explicit module installation. The lane has no reference to physics, a save store or an authoritative script world. */
export interface ClientScriptOptions { modules: readonly ScriptModule[]; bindings: readonly ClientScriptBinding[]; divisor: number; memoryBytes?: number }

const finite = v.pipe(v.number(), v.finite()), natural = v.pipe(finite, v.integer(), v.minValue(0), v.maxValue(Number.MAX_SAFE_INTEGER));
const positive = v.pipe(natural, v.minValue(1), v.maxValue(0x7fffffff)), vec3 = v.tuple([finite, finite, finite]);
const bindingSchema = v.strictObject({ module: v.pipe(v.string(), v.minLength(1), v.maxLength(128)), entity: positive, name: v.pipe(v.string(), v.minLength(1), v.maxLength(128)),
  readCount: v.pipe(natural, v.maxValue(CLIENT_SCRIPT_LIMITS.fields)), parameters: v.pipe(v.array(finite), v.maxLength(CLIENT_SCRIPT_LIMITS.parameters)),
  pose: v.boolean(), maxOffset: v.pipe(finite, v.minValue(0), v.maxValue(50)), minScale: v.pipe(finite, v.minValue(0.01), v.maxValue(1)), maxScale: v.pipe(finite, v.minValue(1), v.maxValue(16)),
  emitters: v.pipe(v.array(v.strictObject({ id: positive, perTick: v.pipe(positive, v.maxValue(256)), live: v.pipe(positive, v.maxValue(4096)), lifetimeTicks: v.pipe(positive, v.maxValue(3600)) })), v.maxLength(CLIENT_SCRIPT_LIMITS.emitters)),
});
const frameSchema = v.strictObject({ entity: positive, tick: v.pipe(finite, v.integer(), v.minValue(-1), v.maxValue(Number.MAX_SAFE_INTEGER)), offset: vec3, rotation: vec3, scale: vec3,
  particles: v.pipe(v.array(v.strictObject({ emitter: positive, count: positive, lifetimeTicks: positive })), v.maxLength(128)) });
const liveSchema = v.pipe(v.array(v.strictObject({ entity: positive, emitter: positive, count: positive, expires: natural })), v.maxLength(4096));
/** A frame the world owns; its pose arrays are written in place only while it is a target's private spare. */
interface OwnedFrame { entity: number; tick: number; offset: [number, number, number]; rotation: [number, number, number]; scale: [number, number, number]; particles: readonly ClientParticleRequest[] }
function copy(frame: ClientScriptFrame): OwnedFrame {
  return { entity: frame.entity, tick: frame.tick, offset: [...frame.offset], rotation: [...frame.rotation], scale: [...frame.scale], particles: frame.particles.map((p) => ({ ...p })) };
}
function refill(into: OwnedFrame, from: OwnedFrame): void {
  into.tick = from.tick; into.particles = from.particles;
  for (let i = 0; i < 3; i++) { into.offset[i] = from.offset[i] ?? 0; into.rotation[i] = from.rotation[i] ?? 0; into.scale[i] = from.scale[i] ?? 1; }
}
const NO_EVENTS: readonly ScriptEvent[] = Object.freeze([]);
const coordinate = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= -250 && n <= 250;
/** The admission verdict of a strict { position: three finite coordinates within ±250, frozen: boolean, values: at most 24
 * finite numbers } record with exactly readCount values, copied into the binding's reused slots (each getter read once). */
function observe(value: unknown, readCount: number, into: { position: [number, number, number]; frozen: boolean; values: number[] }): void {
  if (typeof value !== 'object' || value === null) throw new Error('Invalid read-only client observation');
  for (const key in value) if (Object.hasOwn(value, key) && key !== 'position' && key !== 'frozen' && key !== 'values') throw new Error('Invalid read-only client observation');
  const position: unknown = Reflect.get(value, 'position'), frozen: unknown = Reflect.get(value, 'frozen'), values: unknown = Reflect.get(value, 'values');
  if (!Array.isArray(position) || position.length < 3 || typeof frozen !== 'boolean' || !Array.isArray(values) || values.length > 24) throw new Error('Invalid read-only client observation');
  const x: unknown = position[0], y: unknown = position[1], z: unknown = position[2];
  if (!coordinate(x) || !coordinate(y) || !coordinate(z)) throw new Error('Invalid read-only client observation');
  into.position[0] = x; into.position[1] = y; into.position[2] = z; into.frozen = frozen;
  into.values.length = values.length;
  for (let i = 0; i < values.length; i++) { const n: unknown = values[i]; if (typeof n !== 'number' || !Number.isFinite(n)) throw new Error('Invalid read-only client observation'); into.values[i] = n; }
  if (values.length !== readCount) throw new Error('Invalid read-only client observation');
}

class ClientWorld extends ScriptWorld {
  readonly bindings: ReadonlyMap<number, ClientScriptBinding>;
  private frames = new Map<number, OwnedFrame>();
  // Each target's retired frame is reused as its next private state; `lent` names the revision a prepared
  // transaction borrowed it at, so a second prepare in that revision copies instead of sharing it.
  private readonly spares = new Map<number, OwnedFrame>();
  private readonly lent = new Map<number, number>();
  private frameRevision = 0;
  private live: v.InferOutput<typeof liveSchema> = [];
  private tick = -1;
  private particles = 0;
  /** The bindings (and their entities) in their map order, for per-tick loops without an iterator. */
  readonly order: readonly ClientScriptBinding[];
  private readonly targets: readonly number[];
  constructor(bindings: readonly ClientScriptBinding[]) {
    super({ fields: {}, archetypes: [], events: [], maxEntities: Math.max(1, bindings.length) }, bindings.map((b) => ({ id: b.entity, name: b.name, position: [0, 0, 0], fields: {}, frozen: false, interactive: false })));
    this.bindings = new Map(bindings.map((b) => [b.entity, b])); this.order = [...this.bindings.values()]; this.targets = this.order.map((b) => b.entity);
    for (const b of bindings) this.frames.set(b.entity, { entity: b.entity, tick: -1, offset: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], particles: [] });
  }
  beginTick(tick: number): void {
    this.tick = tick; this.particles = 0;
    if (this.live.length > 0) this.live = this.live.filter((p) => p.expires > tick);
    for (let i = 0; i < this.targets.length; i++) { const frame = this.frames.get(this.targets[i] ?? 0); if (frame !== undefined) { frame.tick = tick; if (frame.particles.length > 0) frame.particles = []; } }
    this.frameRevision++;
  }
  outputs(): readonly ClientScriptFrame[] { return [...this.frames.values()].sort((a, b) => a.entity - b.entity).map(copy); }
  /** The published frame itself, for a same-frame reader that copies what it keeps; valid until the next tick. */
  published(entity: number): Readonly<ClientScriptFrame> | undefined { return this.frames.get(entity); }
  get currentTick(): number { return this.tick; }
  private pose(frame: ClientScriptFrame, binding: ClientScriptBinding): boolean {
    for (let i = 0; i < 3; i++) {
      const offset = frame.offset[i] ?? Number.NaN, rotation = frame.rotation[i] ?? Number.NaN, scale = frame.scale[i] ?? Number.NaN;
      if (!(Math.abs(offset) <= binding.maxOffset) || !(Math.abs(rotation) <= Math.PI) || !(scale >= binding.minScale && scale <= binding.maxScale)) return false;
    }
    return true;
  }
  override prepare(effects: readonly ScriptEffect[], self: number, _spawns: number, _events: number): EffectTransaction {
    const binding = this.bindings.get(self), current = this.frames.get(self), before = this.frameRevision;
    if (binding === undefined || current === undefined) throw new Error('Unknown client script target');
    let frame = current, particles = this.particles, live = this.live, seen = 0;
    if (effects.length > 0) {
      const spare = this.spares.get(self);
      if (spare !== undefined && this.lent.get(self) !== before) { refill(spare, current); frame = spare; this.lent.set(self, before); }
      else frame = copy(current);
    }
    for (let index = 0; index < effects.length; index++) {
      const effect = effects[index]; if (effect === undefined) continue;
      const { op, a, b, c, d } = effect;
      if (!Number.isFinite(op) || !Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(c) || !Number.isFinite(d)) throw new Error('Non-finite client effect');
      if (op === CLIENT_SCRIPT_OP.particle) {
        const emitter = binding.emitters.find((row) => row.id === a);
        if (emitter === undefined || !Number.isSafeInteger(b) || b < 1 || c !== 0 || d !== 0) throw new Error('Undeclared client particle request');
        const emitted = frame.particles.filter((p) => p.emitter === a).reduce((n, p) => n + p.count, 0), alive = live.filter((p) => p.entity === self && p.emitter === a).reduce((n, p) => n + p.count, 0);
        if (emitted + b > emitter.perTick || alive + b > emitter.live || particles + b > CLIENT_SCRIPT_LIMITS.particlesPerTick || live.reduce((n, p) => n + p.count, 0) + b > CLIENT_SCRIPT_LIMITS.particlesLive) throw new Error('Client particle allowance');
        const expires = this.tick + emitter.lifetimeTicks; if (!Number.isSafeInteger(expires)) throw new Error('Client particle lifetime overflow');
        if (live === this.live) live = live.slice();
        live.push({ entity: self, emitter: a, count: b, expires }); particles += b;
        frame.particles = [...frame.particles, { emitter: a, count: b, lifetimeTicks: emitter.lifetimeTicks }];
      } else {
        const bit = op === CLIENT_SCRIPT_OP.offset ? 1 : op === CLIENT_SCRIPT_OP.rotation ? 2 : op === CLIENT_SCRIPT_OP.scale ? 4 : 0;
        if (!binding.pose || bit === 0 || d !== 0 || (seen & bit) !== 0) throw new Error('Client scripts cannot write authoritative state');
        seen |= bit;
        const into = bit === 1 ? frame.offset : bit === 2 ? frame.rotation : frame.scale;
        into[0] = a; into[1] = b; into[2] = c;
        if (!this.pose(frame, binding)) throw new Error('Client pose outside declared range');
      }
    }
    return { spawns: 0, events: NO_EVENTS, commit: () => {
      if (this.frameRevision !== before) throw new Error('Stale client transaction');
      // -1 is no revision: marking the spare free never deletes a key (a Map delete per tick shrinks and regrows it).
      if (frame !== current) { this.spares.set(self, current); this.lent.set(self, -1); }
      this.frames.set(self, frame); this.live = live; this.particles = particles; this.frameRevision++;
    } };
  }
  snapshot(): object { return { tick: this.tick, particles: this.particles, frames: this.outputs(), live: this.live.map((p) => ({ ...p })), entities: this.state() }; }
  restoreSnapshot(input: unknown): void {
    const saved = v.parse(v.strictObject({ tick: v.pipe(finite, v.integer(), v.minValue(-1), v.maxValue(Number.MAX_SAFE_INTEGER)), particles: v.pipe(natural, v.maxValue(256)), frames: v.pipe(v.array(frameSchema), v.maxLength(128)), live: liveSchema,
      entities: v.array(v.strictObject({ id: positive, name: v.string(), position: vec3, fields: v.record(v.string(), finite), frozen: v.boolean(), interactive: v.boolean() })) }), input);
    if (saved.frames.length !== this.bindings.size || saved.entities.length !== this.bindings.size || new Set(saved.frames.map((f) => f.entity)).size !== saved.frames.length || saved.frames.some((f) => {
      const binding = this.bindings.get(f.entity); return binding === undefined || f.tick !== saved.tick || !this.pose(f, binding) || f.particles.some((p) => !binding.emitters.some((e) => e.id === p.emitter && e.lifetimeTicks === p.lifetimeTicks && f.particles.filter((q) => q.emitter === e.id).reduce((n, q) => n + q.count, 0) <= e.perTick));
    }) || new Set(saved.entities.map((e) => e.id)).size !== saved.entities.length || saved.frames.reduce((n, f) => n + f.particles.reduce((m, p) => m + p.count, 0), 0) !== saved.particles || saved.live.reduce((n, p) => n + p.count, 0) > CLIENT_SCRIPT_LIMITS.particlesLive || saved.live.some((p) => {
      const emitter = this.bindings.get(p.entity)?.emitters.find((e) => e.id === p.emitter);
      return emitter === undefined || p.expires <= saved.tick || p.expires > saved.tick + emitter.lifetimeTicks || saved.live.filter((q) => q.entity === p.entity && q.emitter === p.emitter).reduce((n, q) => n + q.count, 0) > emitter.live;
    }) || saved.entities.some((e) => this.bindings.get(e.id)?.name !== e.name || e.position.some((n) => n !== 0) || Object.keys(e.fields).length > 0)) throw new Error('Invalid client continuation');
    this.restore(saved.entities); this.frames = new Map(saved.frames.map((f) => [f.entity, copy(f)])); this.tick = saved.tick; this.particles = saved.particles; this.live = saved.live; this.frameRevision++;
  }
}

/** Bounded presentation lane with private Wasm memory and private visual output; a frozen sim is never stepped or mutated. */
export class ClientScriptLane {
  private host: ScriptHost | undefined;
  private readonly world: ClientWorld;
  private readonly contract: string;
  // One admitted observation copy and one ABI input row per binding, refilled each presentation tick.
  private readonly slots = new Map<number, { position: [number, number, number]; frozen: boolean; values: number[]; input: number[] }>();
  readonly divisor: number;
  constructor(options: ClientScriptOptions) {
    if (!Number.isSafeInteger(options.divisor) || options.divisor < 1 || 60 % options.divisor !== 0 || options.bindings.length > CLIENT_SCRIPT_LIMITS.bindings) throw new Error('Invalid client script cadence or target cap');
    this.divisor = options.divisor;
    const bindings = options.bindings.map((b) => v.parse(bindingSchema, b)).sort((a, b) => a.entity - b.entity), modules = [...options.modules].sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
    if (new Set(bindings.map((b) => b.entity)).size !== bindings.length || new Set(modules.map((m) => m.name)).size !== modules.length || bindings.some((b) => !modules.some((m) => m.name === b.module) || new Set(b.emitters.map((e) => e.id)).size !== b.emitters.length)
      || modules.some((m) => !bindings.some((b) => b.module === m.name))) throw new Error('Invalid client module/target binding');
    this.world = new ClientWorld(bindings);
    // The lane reads each call's effects and query input only inside that call (its world copies the values): transient.
    this.host = new ScriptHost({ world: this.world, transientCallData: true, limits: { fuelPerCall: 200000, fuelPerTick: 2000000, ...(options.memoryBytes === undefined ? {} : { memoryBytes: options.memoryBytes }) }, query: (kind, request, entity) => {
      const binding = this.world.bindings.get(entity);
      let zero = true; for (let i = 0; i < request.length; i++) if (request[i] !== 0) zero = false;
      if (kind !== SCRIPT_PARAMETER_QUERY || !zero || binding === undefined) throw new Error('Client query requires declared parameters');
      // The host only copies the answer into guest memory; the admitted binding's own parameters are never written.
      return binding.parameters;
    } });
    for (const b of bindings) this.slots.set(b.entity, { position: [0, 0, 0], frozen: false, values: [], input: [] });
    for (const module of modules) this.host.install(module.name, module.bytes, module.seedLo, module.seedHi);
    this.contract = JSON.stringify({ divisor: this.divisor, bindings, memoryBytes: this.host.limits.memoryBytes, modules: modules.map((m) => ({ name: m.name, seedLo: m.seedLo, seedHi: m.seedHi, bytes: Array.from(m.bytes) })) });
  }
  /** Fixed presentation ticks are supplied by the page, independently of each authoritative sim's frozen tick. */
  step(tick: number, observations: ReadonlyMap<number, ClientScriptObservation>): readonly ScriptCall[] {
    return this.advance(tick, observations, true);
  }
  /** Publish the same guest step when only frames/continuation are consumed;
   * no call-result envelopes or result list are constructed. */
  stepWithoutResults(tick: number, observations: ReadonlyMap<number, ClientScriptObservation>): void {
    this.advance(tick, observations, false);
  }
  private advance(tick: number, observations: ReadonlyMap<number, ClientScriptObservation>, retain: true): readonly ScriptCall[];
  private advance(tick: number, observations: ReadonlyMap<number, ClientScriptObservation>, retain: false): void;
  private advance(tick: number, observations: ReadonlyMap<number, ClientScriptObservation>, retain: boolean): readonly ScriptCall[] | void {
    const host = this.host; if (host === undefined) throw new Error('Disposed client script lane');
    if (!Number.isSafeInteger(tick) || tick < 0) throw new Error('Invalid client script tick');
    if (tick % this.divisor !== 0) return retain ? [] : undefined;
    // Every observation is admitted and copied before any host or visual tick.
    const order = this.world.order;
    for (let at = 0; at < order.length; at++) {
      const binding = order[at]; if (binding === undefined) continue;
      const slot = this.slots.get(binding.entity); if (slot === undefined) throw new Error('Missing client observation');
      observe(observations.get(binding.entity), binding.readCount, slot);
    }
    host.beginTick(tick); this.world.beginTick(tick);
    const calls: ScriptCall[] | undefined = retain ? [] : undefined;
    for (let at = 0; at < order.length; at++) {
      const binding = order[at]; if (binding === undefined) continue;
      const o = this.slots.get(binding.entity); if (o === undefined) throw new Error('Missing client observation');
      const input = o.input; input.length = 8 + o.values.length;
      input[0] = tick; input[1] = this.divisor / 60; input[2] = Number(o.frozen); input[3] = binding.entity;
      input[4] = o.position[0]; input[5] = o.position[1]; input[6] = o.position[2]; input[7] = binding.readCount;
      for (let field = 0; field < o.values.length; field++) input[8 + field] = o.values[field] ?? Number.NaN;
      if (calls === undefined) host.callWithoutResult(binding.module, binding.entity, input);
      else calls.push(host.call(binding.module, binding.entity, input));
    }
    return calls;
  }
  /** Detached output copies are safe for renderer adapters; no command is applied to simulation entities. */
  frames(): readonly ClientScriptFrame[] { if (this.host === undefined) return []; return this.world.outputs(); }
  /** One target's published frame without a copy, for a same-frame reader that copies what it keeps; never retain it past
   * the next step. Undefined once disposed. */
  frame(entity: number): Readonly<ClientScriptFrame> | undefined { return this.host === undefined ? undefined : this.world.published(entity); }
  /** The tick every published frame carries; -1 before the first step and once disposed. */
  get tick(): number { return this.host === undefined ? -1 : this.world.currentTick; }
  /** A failed presentation binding may resume explicitly; its authoritative entity was never quarantined. */
  resume(entity: number): void { const binding = this.world.bindings.get(entity); if (binding === undefined || this.host === undefined) throw new Error('Unknown/disposed client binding'); this.host.resume(binding.module, entity); }
  /** Complete same-engine visual replay, including author memory, failure history and outstanding particle lifetimes. */
  snapshot(): string { if (this.host === undefined) throw new Error('Disposed client script lane'); return JSON.stringify({ contract: this.contract, host: this.host.checkpoint(), world: this.world.snapshot() }); }
  /** Restore visual continuation only; no authoritative snapshot, query or author callback is invoked. */
  restore(text: string): void {
    const host = this.host; if (host === undefined) throw new Error('Disposed client script lane');
    const raw: unknown = JSON.parse(text);
    if (typeof raw !== 'object' || raw === null || !('contract' in raw) || !('host' in raw) || !('world' in raw) || raw.contract !== this.contract) throw new Error('Incompatible client script continuation');
    const before = host.checkpoint(), world = this.world.snapshot();
    try { this.world.restoreSnapshot(raw.world); host.restoreState(raw.host as ScriptHostState);
      const savedTick = v.parse(v.object({ tick: v.number() }), raw.world).tick; if (host.checkpoint().tick !== savedTick) throw new Error('Client continuation tick mismatch'); }
    catch (error) { this.world.restoreSnapshot(world); host.restoreState(before); throw error; }
  }
  /** Release all guest instances; further ticks or restores are refused and no output remains visible. */
  dispose(): void { this.host = undefined; }
}
