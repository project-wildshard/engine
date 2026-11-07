import * as scriptLimits from '@wildshard/format/scriptLimits';
import { SCRIPT_ABI, SCRIPT_PARAMETER_QUERY } from '@wildshard/format/scriptAbi';
import { admitScript, type ScriptAdmission } from '@wildshard/format/scriptAdmission';
import { SCRIPT_OP, type ScriptEffect, type ScriptEvent, type ScriptWorld } from './effects';
import { scriptFailure } from './strings';
import { observeWasmMemory } from '../core/memoryResources';
import { freshScriptMemory } from './fixedMemory';
import { constructionOwner, currentOwner, ownerOr } from '../app/ownership';
import type { Scope } from '../app/scope';
import { nextDrawnFrame, presenting } from '../core/framePacing';
import { checkpointByteText } from './checkpointBytes';

/** Existing host limit type is defined by pure format admission. */
export type ScriptLimits = scriptLimits.ScriptLimits;
/** Existing host defaults retain the identical defining format object. */
export const SCRIPT_LIMITS: typeof scriptLimits.SCRIPT_LIMITS = scriptLimits.SCRIPT_LIMITS;
/** Deterministic, read-only query input/output; replies may be recorded for replay/conformance. */
export type ScriptQuery = (kind: number, input: readonly number[], entity: number) => readonly number[];
/** A complete linear-memory + mutable-global snapshot, never a live view of Wasm state. */
export interface ScriptSnapshot { memory: Uint8Array; globals: ReadonlyMap<string, number | bigint> }
/** JSON-compatible complete continuation; counters, pending events and quarantine history affect replay. */
export interface ScriptHostState {
  tick: number; used: { effects: number; spawns: number; events: number; queries: number; fuel: number }; pending: readonly ScriptEvent[];
  modules: readonly { name: string; memory: readonly number[]; globals: readonly { name: string; type: 'number' | 'bigint'; value: string }[]; failures: number; disabled: boolean }[];
}
/** Trusted schedulers retain events for sleeping bindings and consume request-only outputs without redelivery. */
export interface ScriptEventDelivery { targets: ReadonlySet<number>; consume: ReadonlySet<number> }
/** Results expose validated requests only after the atomic world-state transaction succeeds. */
export interface ScriptCall { ok: boolean; effects: readonly ScriptEffect[]; events: readonly ScriptEvent[]; fuel: number; reason: string | undefined; disabled: boolean }
/** Host dependencies are explicitly installed; no import creates an instance or changes a service. */
export interface ScriptHostOptions {
  world: ScriptWorld; query: ScriptQuery; limits?: Partial<ScriptLimits>; development?: boolean; toast?: (text: string) => void; onDisabled?: (disabled: ScriptDisabled) => void;
  /** A call's effect records (and their list) and its query inputs are refilled by the module's next call or query: for a
   * caller and a query port that read them only inside that call (a presentation lane); anything kept must be copied. */
  transientCallData?: boolean;
}
/** A module crossed its failure limit and stays switched off (G168): told once per module, never on a restored checkpoint. */
export interface ScriptDisabled { module: string; entity: string; reason: string; failures: number }
interface Layout { input: number; inputBytes: number; output: number; outputRecords: number }
interface Running { memory: WebAssembly.Memory; instance: WebAssembly.Instance }
interface OwnedSnapshot { memory: Uint8Array; globals: Map<string, number | bigint> }
interface ModuleState { bytes: Uint8Array; admission: ScriptAdmission; maximumPages: number; running: Running | undefined; layout: Layout; good: OwnedSnapshot; spare?: OwnedSnapshot; records?: ScriptEffect[]; query?: number[]; failures: number; disabled: boolean; remaining: number; depth: number; entity: number; busy: boolean }
function integer(n: number, min: number, max: number): boolean { return Number.isSafeInteger(n) && n >= min && n <= max; }
interface PreparedMemory { initial: number; maximum: number; memory: WebAssembly.Memory }
const preparedMemories = new Map<Scope, PreparedMemory[]>();
const preparingOwners = new WeakSet<Scope>();
function requirePreparationOwner(owner: Scope): void {
  if (owner.disposed) throw new Error('Script memory preparation owner disposed');
}
function scriptOwner(): Scope | null {
  const construction = constructionOwner();
  return construction === null ? currentOwner() : ownerOr(construction);
}
async function preparationWait<T>(owner: Scope, work: () => T | Promise<T>): Promise<T> {
  requirePreparationOwner(owner);
  let cancel = (): void => { /* The promise installs its rejection synchronously. */ };
  const retired = new Promise<never>((_resolve, reject) => { cancel = () => { reject(new Error('Script memory preparation owner disposed')); }; });
  const forget = owner.capture('disposers', cancel);
  try {
    return await Promise.race([Promise.resolve().then(() => { requirePreparationOwner(owner); return work(); }), retired]);
  } finally { forget(); }
}
function takePreparedMemory(initial: number, maximum: number): WebAssembly.Memory | undefined {
  const owner = scriptOwner();
  if (owner === null || owner.disposed) return undefined;
  for (const [scope, memories] of preparedMemories) {
    if (!owner.belongsTo(scope)) continue;
    const index = memories.findIndex(entry => entry.initial === initial && entry.maximum === maximum);
    if (index !== -1) return memories.splice(index, 1)[0]?.memory;
  }
  return undefined;
}
/**
 * Allocate fresh, never-used script memories between caller-supplied frame yields (null uses the standard
 * owned macrotask yield), then consume them only during
 * the owned installer. Async installers carry their owner across awaits as usual. Each module describes one default-limit host; custom limits use a fresh allocation
 * when their descriptor differs. No seed, initialization, call or snapshot runs before the installer. Unused references
 * are dropped on return, failure or owner disposal; allocation attribution includes every prepared memory.
 */
async function preparedMemoryLease(modules: readonly Uint8Array[], owner: Scope, wait: () => Promise<void>): Promise<() => void> {
  requirePreparationOwner(owner);
  if (modules.length > SCRIPT_LIMITS.instances) throw new Error('Invalid script memory preparation');
  if (preparingOwners.has(owner)) throw new Error('Script memory preparation already active');
  const plans = modules.map(bytes => {
    const admission = admitScript(bytes);
    const maximum = Math.min(admission.maximumPages, Math.floor(SCRIPT_LIMITS.memoryBytes / (3 * 65536)));
    if (maximum < admission.initialPages) throw new Error('Aggregate script memory allowance');
    return { initial: admission.initialPages, maximum };
  });
  if (plans.reduce((sum, plan) => sum + plan.initial * 65536, 0) > SCRIPT_LIMITS.memoryBytes) throw new Error('Prepared script memory allowance');
  preparingOwners.add(owner);
  const memories: PreparedMemory[] = []; let active = true;
  const clear = (): void => { if (!active) return; active = false; preparedMemories.delete(owner); preparingOwners.delete(owner); memories.length = 0; };
  const forget = owner.capture('disposers', clear);
  try {
    for (const plan of plans) {
      await preparationWait(owner, wait);
      requirePreparationOwner(owner);
      const memory = owner.run(() => {
        const allocated = freshScriptMemory(plan.initial, plan.maximum);
        observeWasmMemory(allocated, { owner: owner.name, asset: 'script/prepared' });
        return allocated;
      });
      memories.push({ ...plan, memory });
    }
    await preparationWait(owner, wait);
    requirePreparationOwner(owner);
    if (preparedMemories.has(owner)) throw new Error('Script memory preparation owner unavailable');
    preparedMemories.set(owner, memories);
    return () => { clear(); forget(); };
  } catch (error) { clear(); forget(); throw error; }
}
/** Allocate an owner-scoped lease using declared task/frame yields. The caller
 * releases unused memories in finally; no installer callback enters this API. */
export function prepareScriptMemoryLease(modules: readonly Uint8Array[], owner: Scope, yieldMode: 'frame' | 'task'): Promise<() => void> {
  return preparedMemoryLease(modules, owner, () => yieldMode === 'frame' && presenting() ? nextDrawnFrame(owner) : new Promise<void>(resolve => { owner.timeout(0, resolve); }));
}

function bounds(ptr: number, bytes: number, memory: WebAssembly.Memory): void {
  if (!integer(ptr, 0, memory.buffer.byteLength) || ptr % 8 !== 0 || !integer(bytes, 0, memory.buffer.byteLength) || ptr + bytes > memory.buffer.byteLength) throw new Error('ABI buffer outside memory');
}
function invoke(running: Running, name: string, args?: readonly number[]): number {
  const fn = running.instance.exports[name]; if (typeof fn !== 'function') throw new Error(`Missing callable ${name}`);
  const call = fn as (...values: number[]) => unknown, value = args === undefined ? call() : call(...args); if (value === undefined) return 0; if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('Non-finite ABI result'); return value;
}
function currentInstance(state: ModuleState): Running { if (!state.running) throw new Error('Uninitialized script'); return state.running; }
// One whole-memory view per live buffer (a grow replaces the buffer), so per-tick ABI reads, writes and
// snapshot copies allocate no typed-array wrapper.
const float64Views = new WeakMap<ArrayBuffer, Float64Array>(), byteViews = new WeakMap<ArrayBuffer, Uint8Array>();
function float64(memory: WebAssembly.Memory): Float64Array {
  const buffer = memory.buffer; let view = float64Views.get(buffer);
  if (view === undefined) { view = new Float64Array(buffer); float64Views.set(buffer, view); }
  return view;
}
function byteView(memory: WebAssembly.Memory): Uint8Array {
  const buffer = memory.buffer; let view = byteViews.get(buffer);
  if (view === undefined) { view = new Uint8Array(buffer); byteViews.set(buffer, view); }
  return view;
}
function finiteAll(values: readonly number[]): boolean { for (let i = 0; i < values.length; i++) if (!Number.isFinite(values[i])) return false; return true; }
const NO_NUMBERS: readonly number[] = Object.freeze([]), NO_EVENTS: readonly ScriptEvent[] = Object.freeze([]), NO_EFFECTS: readonly ScriptEffect[] = Object.freeze([]);
function snapshot(state: ModuleState, reuse?: OwnedSnapshot): OwnedSnapshot {
  const current = currentInstance(state), globals = reuse?.globals ?? new Map<string, number | bigint>(), names = state.admission.globals;
  for (let i = 0; i < names.length; i++) {
    const name = names[i] ?? '';
    const global = current.instance.exports[name]; if (!(global instanceof WebAssembly.Global)) throw new Error('Missing state global');
    const value: unknown = global.value; if (typeof value !== 'number' && typeof value !== 'bigint') throw new Error('Non-numeric global'); globals.set(name, value);
  }
  const memory = reuse?.memory.length === current.memory.buffer.byteLength ? reuse.memory : new Uint8Array(current.memory.buffer.byteLength);
  memory.set(byteView(current.memory));
  // The retired snapshot is refilled in place: the caller makes it the module's good state and nothing else holds it.
  return reuse !== undefined && reuse.memory === memory ? reuse : { memory, globals };
}
function clone(s: ScriptSnapshot): OwnedSnapshot { return { memory: s.memory.slice(), globals: new Map(s.globals) }; }
/** Keep the JSON byte array detached without allocating a typed-array iterator
 * result per byte or repeatedly growing the output backing store. */
function checkpointMemory(source: Uint8Array): number[] {
  const memory: number[] = []; memory.length = source.length;
  for (let index = 0; index < source.length; index++) memory[index] = source[index] ?? 0;
  return memory;
}
/** One module instance per host; every call carries its current entity handle in IN[3]. */
export class ScriptHost {
  readonly world: ScriptWorld;
  readonly limits: Readonly<ScriptLimits>;
  private readonly options: ScriptHostOptions;
  private readonly modules = new Map<string, ModuleState>();
  private tick = -1;
  private used = { effects: 0, spawns: 0, events: 0, queries: 0, fuel: 0 };
  private pending: ScriptEvent[] = [];
  private active = false;
  private reservedMemory = 0;
  private readonly observed = { revision: 0, used: [0, 0, 0, 0, 0], pending: [] as ScriptEvent[], modules: new Map<string, { memory: Uint8Array; globals: Map<string, number | bigint>; failures: number; disabled: boolean }>() };
  constructor(options: ScriptHostOptions) {
    this.options = { ...options }; this.world = options.world;
    const limits = { ...SCRIPT_LIMITS, ...options.limits };
    for (const key of Object.keys(SCRIPT_LIMITS) as (keyof ScriptLimits)[]) if (!integer(limits[key], 1, SCRIPT_LIMITS[key])) throw new Error(`Invalid script limit: ${key}`);
    this.limits = Object.freeze(limits);
  }
  /** Read the authoritative tick without copying module memories or checkpoint data. */
  get currentTick(): number { return this.tick; }
  private charge(state: ModuleState, cost: number): void {
    if (!integer(cost, 1, 0x7fffffff)) throw new Error('Invalid fuel cost');
    state.remaining -= cost; if (state.remaining < 0) throw new Error('Script fuel exhausted');
    if (state.busy) { this.used.fuel += cost; if (this.used.fuel > this.limits.fuelPerTick) throw new Error('Script tick fuel exhausted'); }
  }
  private instantiate(state: ModuleState, saved?: ScriptSnapshot): Running {
    const initial = saved ? saved.memory.length / 65536 : state.admission.initialPages;
    const memory = (saved === undefined ? takePreparedMemory(initial, state.maximumPages) : undefined)
      ?? freshScriptMemory(initial, state.maximumPages);
    observeWasmMemory(memory, { owner: scriptOwner()?.name ?? 'engine/script', asset: `script/entity:${state.entity}` });
    const instance = new WebAssembly.Instance(new WebAssembly.Module(new Uint8Array(state.bytes)), { env: {
      memory,
      enter: () => { this.charge(state, 1); if (++state.depth > SCRIPT_ABI.callDepth) throw new Error('Script call-depth exhausted'); },
      leave: () => { if (--state.depth < 0) throw new Error('Invalid call depth'); },
      fuel: (cost: number) => this.charge(state, cost),
      finite32: (value: number) => { this.charge(state, 1); if (!Number.isFinite(value)) throw new Error('Non-finite script number'); return value; },
      finite64: (value: number) => { this.charge(state, 1); if (!Number.isFinite(value)) throw new Error('Non-finite script number'); return value; },
      abort: () => { throw new Error('Script abort'); },
      query: (kind: number, request: number, response: number) => {
        if (!state.busy || (!integer(kind, 1, 4) && kind !== SCRIPT_PARAMETER_QUERY)) throw new Error('Query outside a tick');
        this.charge(state, 256); if (++this.used.queries > this.limits.queries) throw new Error('Query allowance');
        bounds(request, 64, memory); bounds(response, 768, memory);
        const view = float64(memory), at = request / 8, input: number[] = this.options.transientCallData === true ? (state.query ??= []) : [];
        for (let i = 0; i < 8; i++) { const n = view[at + i] ?? Number.NaN; if (!Number.isFinite(n) || Math.abs(n) > 10000) throw new Error('Invalid query input'); input[i] = n; }
        const answer = this.options.query(kind, input, state.entity);
        if (answer.length > 96 || !finiteAll(answer)) throw new Error('Invalid query response');
        // The answer may have grown memory; write through the current buffer.
        const out = float64(memory), base = response / 8; out.fill(0, base, base + 96);
        for (let i = 0; i < answer.length; i++) out[base + i] = answer[i] ?? 0;
        return answer.length;
      },
    } });
    if (saved) {
      new Uint8Array(memory.buffer).set(saved.memory);
      for (const [name, value] of saved.globals) { const global = instance.exports[name]; if (!(global instanceof WebAssembly.Global)) throw new Error('Missing saved global'); global.value = value; }
    }
    return { memory, instance };
  }
  /** Admit before instantiation; one instance is shared by all handles invoking this module. */
  install(name: string, bytes: Uint8Array, seedLo = 0, seedHi = 0): void {
    if (this.active || this.modules.has(name) || this.modules.size >= this.limits.instances) throw new Error('Instance allowance or duplicate module');
    if (!integer(seedLo, -0x80000000, 0x7fffffff) || !integer(seedHi, -0x80000000, 0x7fffffff)) throw new Error('Invalid seed');
    const owned = new Uint8Array(bytes), admission = admitScript(owned);
    // Reserve three full copies: live memory, last-good snapshot and an in-flight snapshot/restore copy.
    const maximumPages = Math.min(admission.maximumPages, Math.floor((this.limits.memoryBytes - this.reservedMemory) / (3 * 65536)));
    if (maximumPages < admission.initialPages) throw new Error('Aggregate script memory allowance');
    // Imports cannot run until instance construction has completed: admission forbids a start section.
    const state: ModuleState = { bytes: owned, admission, maximumPages, running: undefined, layout: { input: 0, inputBytes: 0, output: 0, outputRecords: 0 }, good: { memory: new Uint8Array(), globals: new Map() }, failures: 0, disabled: false, remaining: this.limits.fuelPerCall, depth: 0, entity: 0, busy: false };
    state.running = this.instantiate(state);
    invoke(state.running, '__start'); if (invoke(state.running, 'abi_version') !== SCRIPT_ABI.version) throw new Error('Wrong script ABI version');
    invoke(state.running, 'init', [seedLo, seedHi]);
    const input = invoke(state.running, 'in_ptr'), inputBytes = invoke(state.running, 'in_cap'), output = invoke(state.running, 'out_ptr'), outputRecords = invoke(state.running, 'out_cap');
    bounds(input, inputBytes, state.running.memory); bounds(output, outputRecords * 40, state.running.memory);
    if (inputBytes < 33 * 8 || inputBytes % 8 !== 0 || !integer(outputRecords, 1, SCRIPT_LIMITS.effects) || !(input + inputBytes <= output || output + outputRecords * 40 <= input)) throw new Error('Invalid/overlapping ABI regions');
    state.layout = { input, inputBytes, output, outputRecords }; state.good = snapshot(state); this.modules.set(name, state); this.reservedMemory += maximumPages * 3 * 65536;
  }
  /** Reset shared allowances only for a strictly later fixed tick; return prior queued events in insertion order. */
  beginTick(tick: number, delivery?: ScriptEventDelivery): readonly ScriptEvent[] {
    if (this.active || !integer(tick, 0, Number.MAX_SAFE_INTEGER) || tick <= this.tick) throw new Error('Non-monotonic script tick');
    if (delivery !== undefined) {
      for (const id of delivery.targets) if (!integer(id, 1, 0x7fffffff) || delivery.consume.has(id)) throw new Error('Invalid scheduled event delivery');
      for (const id of delivery.consume) if (!integer(id, 1, 0x7fffffff)) throw new Error('Invalid scheduled event delivery');
    }
    // The allowance record is reset in place: checkpoints and restores copy it, nothing else holds it.
    const used = this.used; used.effects = 0; used.spawns = 0; used.queries = 0; used.fuel = 0;
    if (this.pending.length === 0) { this.tick = tick; used.events = 0; return NO_EVENTS; }
    const events: ScriptEvent[] = [], retained: ScriptEvent[] = [];
    for (const event of this.pending) {
      if (delivery?.consume.has(event.target)) continue;
      (delivery === undefined || delivery.targets.has(event.target) ? events : retained).push({ ...event });
    }
    // Retained events occupy the same allowance as deliveries and newly emitted events.
    this.tick = tick; used.events = retained.length; this.pending = retained; return events;
  }
  /** Drop what is queued for entities that have left, so it holds no allowance and no save names them. */
  forget(handles: readonly number[]): void { if (handles.length > 0) this.pending = this.pending.filter(event => !handles.includes(event.target)); }
  /** Queue a declared gameplay/scene event for the next script tick, under the same bounded event allowance. */
  enqueue(event: ScriptEvent): void {
    if (this.active || this.pending.length >= this.limits.events) throw new Error('Script event queue allowance');
    const checked = this.world.prepare([{ op: SCRIPT_OP.event, a: event.type, b: event.target, c: event.value, d: 0 }], event.target, 0, 1);
    this.pending.push(...checked.events);
  }
  /**
   * Advances when anything checkpoint() carries other than the tick and the ABI scratch rows (module memories and
   * globals, failure history, allowances, pending events) differs from what the previous call saw. It compares in place against the copies it
   * kept and copies only what changed, so an idle caller allocates nothing.
   */
  stateRevision(): number {
    const seen = this.observed, used = this.used, last = seen.used; let changed = false;
    if (last[0] !== used.effects || last[1] !== used.spawns || last[2] !== used.events || last[3] !== used.queries || last[4] !== used.fuel) {
      last[0] = used.effects; last[1] = used.spawns; last[2] = used.events; last[3] = used.queries; last[4] = used.fuel; changed = true;
    }
    let same = seen.pending.length === this.pending.length;
    for (let i = 0; same && i < this.pending.length; i++) { const a = seen.pending[i], b = this.pending[i]; same = a !== undefined && b !== undefined && a.type === b.type && a.target === b.target && Object.is(a.value, b.value); }
    if (!same) { seen.pending = this.pending.map((e) => ({ ...e })); changed = true; }
    for (const [name, state] of this.modules) {
      const good = state.good, row = seen.modules.get(name);
      if (row === undefined || row.memory.length !== good.memory.length) {
        seen.modules.set(name, { memory: good.memory.slice(), globals: new Map(good.globals), failures: state.failures, disabled: state.disabled }); changed = true; continue;
      }
      if (row.failures !== state.failures || row.disabled !== state.disabled) { row.failures = state.failures; row.disabled = state.disabled; changed = true; }
      let globals = row.globals.size === good.globals.size;
      if (globals) for (const [key, value] of good.globals) if (!Object.is(row.globals.get(key), value)) { globals = false; break; }
      if (!globals) { row.globals = new Map(good.globals); changed = true; }
      // The ABI input and output rows are cleared and refilled (the tick included) before any guest code runs on a call,
      // so their bytes never reach a later call or a restore's future: they are not compared.
      const memory = good.memory, kept = row.memory, { input, inputBytes, output, outputRecords } = state.layout;
      for (let i = 0; i < memory.length; i++) {
        if (i === input) { i += inputBytes - 1; continue; }
        if (i === output) { i += outputRecords * 40 - 1; continue; }
        if (memory[i] !== kept[i]) { kept.set(memory); changed = true; break; }
      }
    }
    if (changed) seen.revision++;
    return seen.revision;
  }
  /** Snapshot copies are safe to retain for deterministic replay. */
  snapshot(name: string): ScriptSnapshot { const state = this.modules.get(name); if (!state) throw new Error('Unknown module'); return clone(state.good); }
  /** Admission can detect a refused call without copying every guest memory into a checkpoint. */
  get failureCount(): number { let total = 0; for (const state of this.modules.values()) total += state.failures; return total; }
  /** Capture at a fixed-step boundary; module memory and globals are detached copies. */
  checkpoint(): ScriptHostState {
    if (this.active) throw new Error('Active script checkpoint');
    return { tick: this.tick, used: { ...this.used }, pending: this.pending.map((e) => ({ ...e })), modules: [...this.modules].map(([name, state]) => ({
      name, memory: checkpointMemory(state.good.memory), globals: [...state.good.globals].map(([key, value]) => ({ name: key, type: typeof value === 'bigint' ? 'bigint' as const : 'number' as const, value: String(value) })), failures: state.failures, disabled: state.disabled,
    })) };
  }
  /** Same historical replay wire as checkpoint(), without boxed byte arrays.
   * Public checkpoint() stays detached and mutable for in-memory callers. */
  checkpointText(): string {
    if (this.active) throw new Error('Active script checkpoint');
    const modules: string[] = [];
    for (const [name, state] of this.modules) {
      const globals = [...state.good.globals].map(([key, value]) => ({ name: key,
        type: typeof value === 'bigint' ? 'bigint' : 'number', value: String(value) }));
      modules.push(`{"name":${JSON.stringify(name)},"memory":${checkpointByteText(state.good.memory)},"globals":${JSON.stringify(globals)},"failures":${state.failures},"disabled":${state.disabled}}`);
    }
    return `{"tick":${this.tick},"used":${JSON.stringify(this.used)},"pending":${JSON.stringify(this.pending)},"modules":[${modules.join(',')}]}`;
  }
  /** Validate every module before publishing; reuse equal-sized memories without running initialization, queries or author functions. */
  restoreState(saved: ScriptHostState): void {
    if (this.active || !integer(saved.tick, -1, Number.MAX_SAFE_INTEGER) || saved.modules.length !== this.modules.size
      || new Set(saved.modules.map((m) => m.name)).size !== saved.modules.length || Object.values(saved.used).some((n) => !integer(n, 0, Number.MAX_SAFE_INTEGER))
      || saved.pending.length > this.limits.events || saved.pending.some((e) => !integer(e.type, 1, 0x7fffffff) || !integer(e.target, 1, 0x7fffffff) || !Number.isFinite(e.value))) throw new Error('Invalid host checkpoint');
    const staged: { state: ModuleState; good: OwnedSnapshot; running: Running; writes: { memory: Uint8Array; globals: readonly { global: WebAssembly.Global; value: number | bigint }[] } | undefined; failures: number; disabled: boolean }[] = [];
    for (const entry of saved.modules) {
      const state = this.modules.get(entry.name);
      if (!state || !integer(entry.failures, 0, Number.MAX_SAFE_INTEGER) || entry.disabled !== (entry.failures >= this.limits.failures)
        || entry.memory.length < state.admission.initialPages * 65536 || entry.memory.length > state.maximumPages * 65536 || entry.memory.length % 65536 !== 0
        || entry.memory.some((n) => !integer(n, 0, 255)) || entry.globals.length !== state.admission.globals.length || new Set(entry.globals.map((g) => g.name)).size !== entry.globals.length) throw new Error('Invalid module checkpoint');
      const globals = new Map<string, number | bigint>();
      for (const global of entry.globals) {
        const value = global.type === 'bigint' ? BigInt(global.value) : Number(global.value);
        const live = currentInstance(state).instance.exports[global.name];
        if (!state.admission.globals.includes(global.name) || !(live instanceof WebAssembly.Global) || typeof live.value !== typeof value
          || (typeof value === 'number' && !Number.isFinite(value))) throw new Error('Invalid saved global');
        globals.set(global.name, value);
      }
      const good = { memory: Uint8Array.from(entry.memory), globals };
      const current = currentInstance(state);
      let writes: { memory: Uint8Array; globals: { global: WebAssembly.Global; value: number | bigint }[] } | undefined;
      let running = current;
      if (current.memory.buffer.byteLength === good.memory.length) {
        const globalWrites: { global: WebAssembly.Global; value: number | bigint }[] = [];
        for (const [name, value] of good.globals) {
          const global = current.instance.exports[name];
          if (!(global instanceof WebAssembly.Global)) throw new Error('Missing saved global');
          globalWrites.push({ global, value });
        }
        writes = { memory: new Uint8Array(current.memory.buffer), globals: globalWrites };
      } else running = this.instantiate(state, good);
      staged.push({ state, good, running, writes, failures: entry.failures, disabled: entry.disabled });
    }
    // Admission forbids tables/start/passive data and exposes every mutable global. After staging, these
    // complete memory copies and type-checked mutable-global writes cannot invoke guest code or allocate.
    for (const entry of staged) if (entry.writes) {
      entry.writes.memory.set(entry.good.memory);
      for (const { global, value } of entry.writes.globals) global.value = value;
    }
    for (const entry of staged) { entry.state.good = entry.good; entry.state.running = entry.running; entry.state.failures = entry.failures; entry.state.disabled = entry.disabled; entry.state.depth = 0; entry.state.busy = false; }
    this.tick = saved.tick; this.used = { ...saved.used }; this.pending = saved.pending.map((e) => ({ ...e }));
  }
  /**
   * Return a module to a snapshot of its own in place (a pure call's admitted state): the bytes are copied into the live
   * memory and the globals set, with no new instance, when the memory has not grown; otherwise as `restore`.
   */
  rewind(name: string, saved: ScriptSnapshot): void {
    const state = this.modules.get(name); if (!state || this.active) throw new Error('Unknown or active module');
    const running = currentInstance(state);
    if (running.memory.buffer.byteLength !== saved.memory.length || saved.globals.size !== state.admission.globals.length) { this.restore(name, saved); return; }
    for (const [global, value] of saved.globals) { const live = running.instance.exports[global]; if (!(live instanceof WebAssembly.Global)) throw new Error('Missing saved global'); live.value = value; }
    new Uint8Array(running.memory.buffer).set(saved.memory); state.good = clone(saved); state.remaining = this.limits.fuelPerCall; state.depth = 0;
  }
  /** Restore complete state into a new instance without running initialization again. */
  restore(name: string, saved: ScriptSnapshot): void {
    const state = this.modules.get(name); if (!state || this.active) throw new Error('Unknown or active module');
    if (saved.memory.length % 65536 !== 0 || saved.memory.length < state.admission.initialPages * 65536 || saved.memory.length > state.maximumPages * 65536 || saved.globals.size !== state.admission.globals.length || state.admission.globals.some((n) => !saved.globals.has(n)) || [...saved.globals.values()].some((v) => typeof v === 'number' && !Number.isFinite(v))) throw new Error('Invalid script snapshot');
    const owned = clone(saved); state.remaining = this.limits.fuelPerCall; state.depth = 0; state.running = this.instantiate(state, owned); state.good = owned;
  }
  /** Resume only by an explicit host action; repeated offenders remain disabled. */
  resume(name: string, entity: number): void { const state = this.modules.get(name); if (!state || state.disabled || this.active) throw new Error('Disabled or active module'); this.world.freeze(entity, false); }
  /** Execute and validate a full batch, then publish numeric world state and script snapshot together. */
  call(name: string, entity: number, input: readonly number[], events: readonly number[] = NO_NUMBERS): ScriptCall {
    return this.runCall(name, entity, input, events, true);
  }
  /** The identical committed call when its caller does not consume a result
   * envelope. Validation, quotas, snapshots and failure notifications still run. */
  callWithoutResult(name: string, entity: number, input: readonly number[], events: readonly number[] = NO_NUMBERS): void {
    this.runCall(name, entity, input, events, false);
  }
  private runCall(name: string, entity: number, input: readonly number[], events: readonly number[], retain: true): ScriptCall;
  private runCall(name: string, entity: number, input: readonly number[], events: readonly number[], retain: false): void;
  private runCall(name: string, entity: number, input: readonly number[], events: readonly number[], retain: boolean): ScriptCall | void {
    const state = this.modules.get(name), available = this.world.callable(entity);
    if (!state || !available || state.disabled) return retain ? { ok: false, effects: [], events: [], fuel: 0, reason: 'Unavailable script/entity', disabled: state?.disabled ?? false } : undefined;
    if (this.used.fuel >= this.limits.fuelPerTick) return retain ? { ok: false, effects: [], events: [], fuel: 0, reason: 'Script tick fuel allowance', disabled: false } : undefined;
    if (this.active || this.tick < 0) throw new Error('Reentrant call or missing fixed tick');
    state.remaining = this.limits.fuelPerCall; state.depth = 0; state.entity = entity; state.busy = true; this.active = true;
    const currentRunning = currentInstance(state);
    try {
      if (input.length > 32 || input[0] !== this.tick || !finiteAll(input) || events.length % 6 !== 0 || events.length / 6 + this.used.events > this.limits.events || !finiteAll(events)) throw new Error('Invalid input/events');
      this.used.events += events.length / 6;
      const { input: ptr, inputBytes, output, outputRecords } = state.layout;
      bounds(ptr, inputBytes, currentRunning.memory); if (33 * 8 + events.length * 8 > inputBytes) throw new Error('Input/event capacity');
      const slots = float64(currentRunning.memory), at = ptr / 8, out = output / 8;
      slots.fill(0, at, at + inputBytes / 8);
      for (let i = 0; i < input.length; i++) slots[at + i] = input[i] ?? 0;
      slots[at + 3] = this.world.contentHandle(entity); slots[at + 32] = events.length / 6;
      for (let i = 0; i < events.length; i++) slots[at + 33 + i] = events[i] ?? 0;
      slots.fill(0, out, out + outputRecords * 5);
      invoke(currentRunning, 'on_tick'); const count = invoke(currentRunning, 'out_count');
      if (!integer(count, 0, outputRecords) || count + this.used.effects > this.limits.effects) throw new Error('Effect allowance');
      // on_tick may have grown memory: read the records through the current buffer.
      const view = float64(currentRunning.memory); let effects = NO_EFFECTS;
      if (count > 0) {
        const records: ScriptEffect[] = this.options.transientCallData === true ? (state.records ??= []) : [];
        for (let i = 0; i < count; i++) {
          const record = out + i * 5, op = view[record] ?? Number.NaN, a = view[record + 1] ?? Number.NaN, b = view[record + 2] ?? Number.NaN, c = view[record + 3] ?? Number.NaN, d = view[record + 4] ?? Number.NaN;
          const kept = records[i];
          if (kept === undefined) records[i] = { op, a, b, c, d }; else { kept.op = op; kept.a = a; kept.b = b; kept.c = c; kept.d = d; }
        }
        records.length = count; effects = records;
      }
      const eventAllowance = Math.min(this.limits.events - this.used.events, this.limits.events - this.pending.length);
      const tx = this.world.prepare(effects, entity, this.limits.spawns - this.used.spawns, eventAllowance);
      const good = snapshot(state, state.spare); tx.commit(); state.spare = state.good; state.good = good;
      this.used.effects += count; this.used.spawns += tx.spawns; this.used.events += tx.events.length; if (tx.events.length > 0) this.pending.push(...tx.events);
      const publishedEvents = tx.events, fuel = this.limits.fuelPerCall - state.remaining;
      return retain ? { ok: true, effects, events: publishedEvents, fuel, reason: undefined, disabled: false } : undefined;
    } catch (error) {
      const fuel = this.limits.fuelPerCall - state.remaining;
      state.failures++; state.disabled = state.failures >= this.limits.failures;
      state.remaining = this.limits.fuelPerCall; state.depth = 0; state.running = this.instantiate(state, state.good);
      this.world.freeze(entity, true);
      const reason = error instanceof Error ? error.message : 'Script trap';
      if (this.options.development) this.options.toast?.(scriptFailure(this.world.entity(entity)?.name ?? String(entity), name, reason, state.disabled));
      // a disabled module never reaches this call, so this is its one crossing
      if (state.disabled) this.options.onDisabled?.({ module: name, entity: this.world.entity(entity)?.name ?? String(entity), reason, failures: state.failures });
      return retain ? { ok: false, effects: [], events: [], fuel, reason, disabled: state.disabled } : undefined;
    } finally { state.busy = false; this.active = false; }
  }
}
