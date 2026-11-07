import { SCRIPT_V1_COMMANDS, SCRIPT_V1_EVENTS, SCRIPT_V1_LAYOUT, SCRIPT_V1_LISTS, SCRIPT_V1_READS, scriptV1Layout, type ScriptV1Command, type ScriptV1CommandName, type ScriptV1Event, type ScriptV1EventName, type ScriptV1ListName, type ScriptV1ReadName } from '@wildshard/format/scriptAbiV1';
import { DecisionModule } from '../../../shared/engine/script/decisionModule';

/** Resolved ids are produced from admitted rows, never looked up through a shard runtime module. */
export type DecisionIdKind = 'actors' | 'moves' | 'strikes' | 'timers' | 'cues' | 'fields' | 'flags' | 'zones' | 'spots' | 'targets' | 'spawns' | 'signals' | 'facts' | 'rewards' | 'channels' | 'impulses' | 'weather' | 'bodies' | 'colliders';
/** Durable numeric slots; JSON boolean values occupy f64 0/1 in the IO block. */
export interface DecisionStateSlot { name: string; type: 'bool' | 'i32' | 'f64'; default: number | boolean; scope: 'binding' | 'actor' | 'player'; min?: number; max?: number }
/** Renderer-free, resolved script declaration. Wire-schema admission remains the format's responsibility. */
export interface DecisionScript {
  id: string; module: string; side: 'sim'; on: readonly ScriptV1EventName[]; tick: number | null;
  stateVersion: number; state: readonly DecisionStateSlot[]; params: Readonly<Record<string, number>>;
  ids: Readonly<Partial<Record<DecisionIdKind, Readonly<Record<string, number>>>>>;
  reads: readonly ScriptV1ReadName[]; lists: readonly ScriptV1ListName[]; commands: readonly ScriptV1CommandName[];
  onFail: 'hold' | 'reset' | 'skip';
}
/** Stable, numeric binding identity and its actor ownership. Instance seeds a fresh encounter stream. */
export interface DecisionBinding { id: number; script: string; self: number; actors: readonly number[]; instance: number }
/** Every query and transaction knows the trusted binding, not caller-supplied actor ownership. */
export interface DecisionContext { tick: number; binding: DecisionBinding; script: DecisionScript; observed: ReadonlySet<number> }
/** Validation is read-only; commit cannot fail and is invoked only after the complete call validates. */
export interface DecisionCommit { commit: () => void }
/** Bounded ABI2 command words carried by the SAME native staged transaction.
 * The original concrete world validates operation capabilities and operands. */
export type DecisionExternalCommand = readonly [number,number,number,number,number,number];
/** Engine adapters only. Shard-authored callbacks never cross this boundary. */
export interface DecisionWorld {
  /** Trusted observed player for bindings granted requested movement; never an owned actor. */
  readonly player?: number;
  read: (op: number, a: number, b: number, context: DecisionContext) => number;
  list: (op: number, a: number, b: number, output: Float64Array, context: DecisionContext) => number;
  prepare: (commands: readonly ScriptV1Command[], context: DecisionContext) => DecisionCommit;
  /** Explicit external/v2 mode only; all mixed command families preflight here. */
  prepareExternal?: (commands: readonly DecisionExternalCommand[], context: DecisionContext) => DecisionCommit;
  failed: (mode: DecisionScript['onFail'], context: DecisionContext, reason: string) => void;
}
/** Complete logical continuation; restoring it must not enter Wasm, including ws_init. */
export interface DecisionSnapshot {
  version: 1; tick: number;
  /** Validated at a decision tick, applied only by the next fixed step. Restore re-prepares without Wasm. */
  staged: readonly {
    binding: number; tick: number; observed: readonly number[]; commands: readonly ScriptV1Command[];
    external?: readonly DecisionExternalCommand[];
    slots: Readonly<Record<string, number | boolean>>; timers: Readonly<Record<string, number>>; rng: number; lastCall: number;
  }[];
  bindings: readonly {
    id: number; script: string; stateVersion: number; slots: Readonly<Record<string, number | boolean>>;
    timers: Readonly<Record<string, number>>; rng: number; failures: number; disabled: boolean;
    pending: readonly ScriptV1Event[]; lastCall: number | null; enabled?: boolean;
  }[];
}
/** Trace observers are tooling ports and are absent from the allocation-free production hot path. */
export type DecisionTrace =
  | { kind: 'read'; tick: number; binding: number; op: number; a: number; b: number; result: number }
  | { kind: 'list'; tick: number; binding: number; op: number; a: number; b: number; result: readonly number[] }
  | { kind: 'call'; tick: number; binding: number; ok: boolean; fuel: number; reason: string | null;
      before: Readonly<Record<string, number | boolean>>; after: Readonly<Record<string, number | boolean>>; commands: readonly ScriptV1Command[] };
export interface DecisionMetrics { binding: number; calls: number; fuel: number; maxFuel: number; commands: number; refusals: number; carried: number; disabled: boolean }
/** Constructor contract for the real host. One module instance per hash, logical state per binding. */
export interface DecisionHostOptions {
  scripts: readonly DecisionScript[]; bindings: readonly DecisionBinding[]; modules: ReadonlyMap<string, Uint8Array>;
  seed: readonly [number, number]; world: DecisionWorld; trace?: (entry: DecisionTrace) => void;
  limits?: { fuelPerCall?: number; fuelPerTick?: number };
  /** A v2 runner borrows this SAME logical continuation/command authority. */
  externalDivisor?: 2 | 6;
}
type Command = [number, number, number, number, number];
type Slots = Record<string, number | boolean>;
const idKinds: readonly DecisionIdKind[] = ['actors', 'moves', 'strikes', 'timers', 'cues', 'fields', 'flags', 'zones', 'spots', 'targets', 'spawns', 'signals', 'facts', 'rewards', 'channels', 'impulses', 'weather', 'bodies', 'colliders'];
const readNames = new Map<number, ScriptV1ReadName>(Object.entries(SCRIPT_V1_READS).map(([key, value]) => [value, key as ScriptV1ReadName]));
const listNames = new Map<number, ScriptV1ListName>(Object.entries(SCRIPT_V1_LISTS).map(([key, value]) => [value, key as ScriptV1ListName]));
const commandNames = new Map<number, ScriptV1CommandName>(Object.entries(SCRIPT_V1_COMMANDS).map(([key, value]) => [value, key as ScriptV1CommandName]));
const eventNames = new Map<number, ScriptV1EventName>(Object.entries(SCRIPT_V1_EVENTS).map(([key, value]) => [value, key as ScriptV1EventName]));
const subjectActors = new Set([7, 8, 9, 10, 11, 15, 16, 17]);
const argumentActors = new Set([4, 5, 6, 7, 9, 14]);
const ownedCommands = new Set([1, 2, 3, 4, 6]);
const playerCommands = new Set([7, 10, 11, 14]);
function check(ok: boolean, reason: string): asserts ok { if (!ok) throw new Error(`Decision ${reason}`); }
function integer(value: number, min = 0, max = Number.MAX_SAFE_INTEGER): boolean { return Number.isSafeInteger(value) && value >= min && value <= max; }
function width(values: readonly number[], expected: number): boolean { return values.length === expected; }
function externalCommand(input: unknown): input is DecisionExternalCommand {
  if (!Array.isArray(input) || input.length !== 6 || !input.every((word: unknown) => typeof word === 'number' && Number.isFinite(word))) return false;
  const op: unknown = input[0], target: unknown = input[1];
  return typeof op === 'number' && integer(op,1,65535) && typeof target === 'number' && integer(target,0,0x7fffffff);
}
function externalCommands(input: unknown): input is readonly DecisionExternalCommand[] {
  return Array.isArray(input) && input.length <= 32 && input.every(externalCommand);
}
function name(value: string): boolean { return /^[a-zA-Z_][a-zA-Z0-9_.-]*$/u.test(value) && !['__proto__', 'constructor', 'prototype'].includes(value); }
function mix(input: number): number { let value = Math.imul(input ^ (input >>> 16), 0x7feb352d); value = Math.imul(value ^ (value >>> 15), 0x846ca68b); return (value ^ (value >>> 16)) >>> 0; }
function slotNumber(slot: DecisionStateSlot, value: number | boolean): number {
  const number = typeof value === 'boolean' ? Number(value) : value;
  check((slot.type === 'bool' || typeof value === 'number') && Number.isFinite(number) && (slot.type !== 'bool' || number === 0 || number === 1)
    && (slot.type !== 'i32' || integer(number, -2147483648, 2147483647))
    && (slot.min === undefined || number >= slot.min) && (slot.max === undefined || number <= slot.max), 'state value outside declaration');
  return number;
}

/** Packed queue: draining a call never allocates an event array. Growth is confined to enqueue. */
class EventQueue {
  private data = new Float64Array(16 * 6);
  private head = 0;
  size = 0;
  push(kind: number, subject: number, a: number, b: number, c: number, d: number): void {
    if (this.size * 6 === this.data.length) {
      const next = new Float64Array(this.data.length * 2);
      for (let i = 0; i < this.size * 6; i++) next[i] = this.at(Math.floor(i / 6), i % 6);
      this.data = next; this.head = 0;
    }
    const start = (this.head + this.size * 6) % this.data.length;
    this.data[start] = kind; this.data[start + 1] = subject; this.data[start + 2] = a;
    this.data[start + 3] = b; this.data[start + 4] = c; this.data[start + 5] = d; this.size++;
  }
  at(row: number, column: number): number { return this.data[(this.head + row * 6 + column) % this.data.length] ?? 0; }
  consume(count: number): void { this.head = (this.head + count * 6) % this.data.length; this.size -= count; }
  clear(): void { this.head = 0; this.size = 0; }
  saved(): ScriptV1Event[] {
    return Array.from({ length: this.size }, (_, i) => [this.at(i, 0), this.at(i, 1), this.at(i, 2), this.at(i, 3), this.at(i, 4), this.at(i, 5)]);
  }
}
interface BindingState {
  binding: DecisionBinding; script: DecisionScript; module: DecisionModule; context: DecisionContext;
  ids: ReadonlyMap<DecisionIdKind, ReadonlySet<number>>; timerIds: number[]; timerNames: string[];
  values: Float64Array; next: Float64Array; timers: Float64Array; nextTimers: Float64Array;
  io: Float64Array; layout: ReturnType<typeof scriptV1Layout>; params: number[];
  queue: EventQueue; observed: Set<number>; players: Set<number>; owners: Set<number>;
  pool: Command[]; commands: Command[]; external: DecisionExternalCommand[] | null; staged: DecisionCommit | null;
  rng: number; nextRng: number; lastCall: number | null; nextLastCall: number;
  failures: number; disabled: boolean; enabled?: boolean; metric: DecisionMetrics;
}

/** Event-driven, renderer-free decision scheduler. Module memory is scratch, never save state. */
export class DecisionHost {
  private readonly options: DecisionHostOptions;
  private readonly rows: BindingState[] = [];
  private readonly bindings = new Map<number, BindingState>();
  private readonly modules = new Map<string, DecisionModule>();
  private readonly listScratch = new Float64Array(96);
  private readonly listViews = Array.from({ length: 97 }, (_, length) => new Float64Array(this.listScratch.buffer, 0, length));
  private readonly callFuel: number;
  private readonly tickFuel: number;
  private remainingFuel = 0;
  private usedCommands = 0;
  private tick = 0;
  private revision = 0;
  private active: BindingState | null = null;
  private busy = false;
  private committing = false;
  constructor(options: DecisionHostOptions) {
    check(options.externalDivisor === undefined || [2,6].includes(options.externalDivisor), 'external schedule');
    this.options = { ...options, seed: [options.seed[0], options.seed[1]] };
    this.callFuel = options.limits?.fuelPerCall ?? 400_000;
    this.tickFuel = options.limits?.fuelPerTick ?? 2_000_000;
    check(integer(this.callFuel, 1, 2_000_000) && integer(this.tickFuel, 1, 8_000_000), 'fuel ceilings');
    check(width(options.seed, 2) && options.seed.every(value => integer(value, 0, 0xffffffff)), 'seed');
    if (options.world.player !== undefined) check(integer(options.world.player, 1), 'world player handle');
    const scripts = new Map<string, DecisionScript>();
    const scopedOwners = new Set<string>();
    for (const input of options.scripts) {
      check(!scripts.has(input.id) && input.id.length > 0, 'duplicate script');
      const script = structuredClone(input);
      check(integer(script.stateVersion, 1) && script.state.length <= 16 && Object.keys(script.params).length <= 32, 'declaration limits');
      check(script.tick === null || [1, 2, 5, 10].includes(script.tick), 'tick subscription');
      check((script.tick !== null) === script.on.includes('tick'), 'tick event/rate mismatch');
      check(['hold', 'reset', 'skip'].includes(script.onFail), 'fallback');
      const seen = new Set<string>();
      for (const slot of script.state) {
        check(name(slot.name) && !seen.has(slot.name) && ['bool', 'i32', 'f64'].includes(slot.type)
          && ['binding', 'actor', 'player'].includes(slot.scope), 'state declaration');
        check((slot.min === undefined || Number.isFinite(slot.min)) && (slot.max === undefined || Number.isFinite(slot.max))
          && (slot.min === undefined || slot.max === undefined || slot.min <= slot.max), 'state bounds');
        seen.add(slot.name); slotNumber(slot, slot.default);
      }
      for (const [key, value] of Object.entries(script.params)) check(name(key) && Number.isFinite(value), 'parameter');
      for (const [kind, ids] of Object.entries(script.ids)) {
        check(idKinds.includes(kind as DecisionIdKind), 'id kind');
        for (const [key, value] of Object.entries(ids)) check(name(key) && integer(value, 1), 'declared id');
      }
      for (const event of script.on) check(Object.hasOwn(SCRIPT_V1_EVENTS, event) && SCRIPT_V1_EVENTS[event] < 30, 'event capability');
      for (const read of script.reads) check(Object.hasOwn(SCRIPT_V1_READS, read), 'read capability');
      for (const list of script.lists) check(Object.hasOwn(SCRIPT_V1_LISTS, list), 'list capability');
      for (const command of script.commands) check(Object.hasOwn(SCRIPT_V1_COMMANDS, command) && SCRIPT_V1_COMMANDS[command] < 100, 'command capability');
      scripts.set(script.id, script);
    }
    for (const input of options.bindings) {
      check(integer(input.id, 1) && !this.bindings.has(input.id) && integer(input.instance) && integer(input.self), 'binding identity');
      const binding = structuredClone(input), script = scripts.get(binding.script);
      check(script !== undefined, 'binding script missing');
      if (script.state.some(slot => slot.scope === 'actor' || slot.scope === 'player')) {
        const owner = `${script.id}:${binding.self}`;
        check(binding.self > 0 && !scopedOwners.has(owner), 'actor/player state needs one binding per owner');
        scopedOwners.add(owner);
      }
      const actors = new Set(Object.values(script.ids.actors ?? {}));
      check(binding.actors.every(actor => integer(actor, 1) && actors.has(actor)) && (binding.self === 0 || binding.actors.includes(binding.self)), 'binding ownership');
      let module = this.modules.get(script.module);
      if (module === undefined) {
        check(this.modules.size < 8, 'module count');
        const bytes = options.modules.get(script.module); check(bytes !== undefined, 'module bytes missing');
        module = new DecisionModule(bytes, options.seed, { read: (op, a, b) => this.read(op, a, b), list: (op, a, b, out, cap) => this.list(op, a, b, out, cap) });
        this.modules.set(script.module, module);
      }
      const params = Object.keys(script.params).sort().map(key => script.params[key] ?? 0), layout = scriptV1Layout(script.state.length, params.length);
      check(module.io + layout.bytes <= module.memory.buffer.byteLength, 'IO range');
      const observed = new Set<number>(), owners = new Set(binding.actors), ids = new Map<DecisionIdKind, ReadonlySet<number>>();
      for (const kind of idKinds) ids.set(kind, new Set(Object.values(script.ids[kind] ?? {})));
      const timerNames = Object.keys(script.ids.timers ?? {}).sort(), timerIds = timerNames.map(key => script.ids.timers?.[key] ?? 0);
      check(new Set(timerIds).size === timerIds.length, 'duplicate timer id');
      const row: BindingState = {
        binding, script, module, ids, timerNames, timerIds, context: { tick: 0, binding, script, observed },
        values: Float64Array.from(script.state.map(slot => slotNumber(slot, slot.default))), next: new Float64Array(script.state.length),
        timers: new Float64Array(timerIds.length), nextTimers: new Float64Array(timerIds.length),
        io: new Float64Array(module.memory.buffer, module.io, layout.bytes / 8), layout, params,
        queue: new EventQueue(), observed, players: new Set(), owners,
        pool: Array.from({ length: 32 }, () => [0, 0, 0, 0, 0]), commands: [], external: null, staged: null,
        rng: 0, nextRng: 0, lastCall: null, nextLastCall: 0, failures: 0, disabled: false,
        metric: { binding: binding.id, calls: 0, fuel: 0, maxFuel: 0, commands: 0, refusals: 0, carried: 0, disabled: false },
      };
      this.rows.push(row); this.bindings.set(binding.id, row);
    }
    this.rows.sort((a, b) => a.binding.id - b.binding.id);
  }
  private row(id: number): BindingState { const row = this.bindings.get(id); check(row !== undefined, 'unknown binding'); return row; }
  /** Platform binding lifetime: inactive bindings receive no periodic ticks or timer events.
   * Explicit start/stop inboxes may still drain. Disabling cancels uncommitted work, never enters Wasm.
   */
  setEnabled(binding: number, enabled: boolean): void {
    check(!this.busy && typeof enabled === 'boolean', 'binding lifetime');
    const row = this.row(binding);
    this.revision++; row.enabled = enabled;
    if (!enabled) { row.staged = null; row.timers.fill(0); }
  }
  /** Reset a replaced actor's durable slots and stream without executing or resetting its module. */
  restart(binding: number): void {
    check(!this.busy, 'reentrant restart');
    const row = this.row(binding);
    this.revision++; row.enabled = false; row.staged = null; row.queue.clear(); row.timers.fill(0); row.nextTimers.fill(0);
    row.rng = 0; row.nextRng = 0; row.lastCall = null; row.failures = 0; row.disabled = false;
    for (const [index, slot] of row.script.state.entries()) row.values[index] = slotNumber(slot, slot.default);
    row.next.set(row.values); row.commands.length = 0; row.external = null; row.observed.clear(); row.players.clear();
  }
  enqueue(binding: number, event: ScriptV1Event): void {
    check(!this.busy || this.committing, 'reentrant enqueue');
    const row = this.row(binding), eventName = eventNames.get(event[0]);
    check(width(event, 6) && event.every(Number.isFinite) && eventName !== undefined && event[0] < 30, 'event');
    if (event[0] === SCRIPT_V1_EVENTS.start && row.disabled) {
      row.disabled = false; row.failures = 0; row.rng = 0; row.queue.clear(); row.timers.fill(0); row.lastCall = null;
      for (let i = 0; i < row.script.state.length; i++) { const slot = row.script.state[i]; if (slot) row.values[i] = slotNumber(slot, slot.default); }
    }
    this.revision++;
    if (!row.script.on.includes(eventName)) return;
    if (!row.disabled) row.queue.push(...event);
  }
  step(tick: number): void {
    check(this.options.externalDivisor === undefined, 'external runner owns this step');
    this.advance(tick, false);
  }
  /** Commit/timer/inbox phases only. The external engine runner executes its
   * guest after this; native movement/contact remains with the existing owner. */
  /** The borrowed native clock, without serializing its continuation. */
  get externalTick(): number {
    check(!this.busy && this.options.externalDivisor !== undefined, 'external clock ownership');return this.tick;
  }
  /** Cheap external inbox probe; no continuation copy on an idle fixed step. */
  get pendingExternal(): boolean {
    check(!this.busy && this.options.externalDivisor !== undefined, 'external inbox ownership');
    return this.rows.some(row => row.queue.size > 0);
  }
  stepExternal(tick: number): void {
    check(this.options.externalDivisor !== undefined, 'missing external runner');
    this.advance(tick, true);
  }
  private advance(tick: number, external: boolean): void {
    check(!this.busy && integer(tick, 1) && tick === this.tick + 1, 'nonconsecutive step');
    this.busy = true;
    try {
      this.revision++;this.tick = tick;
      for (const row of this.rows) {
        if (row.staged !== null) {
          // An engine transaction promises a non-throwing commit; no script executes here.
          this.committing = true;
          try { row.staged.commit(); } finally { this.committing = false; }
          row.staged = null;
          row.values.set(row.next); row.timers.set(row.nextTimers); row.rng = row.nextRng; row.lastCall = row.nextLastCall;
        }
        row.context.tick = tick;
        if (row.disabled || row.enabled === false) continue;
        for (let i = 0; i < row.timers.length; i++) {
          const deadline = row.timers[i] ?? 0;
          if (deadline > 0 && deadline <= tick) {
            row.timers[i] = 0;
            if (row.script.on.includes('timer')) row.queue.push(3, row.timerIds[i] ?? 0, 0, 0, 0, 0);
          }
        }
      }
      if (tick % (this.options.externalDivisor ?? SCRIPT_V1_LAYOUT.decisionDivisor) !== 0) return;
      this.remainingFuel = this.tickFuel; this.usedCommands = 0;
      let calls = 0;
      for (const row of this.rows) {
        if (row.disabled) continue;
        if (row.enabled !== false && row.script.tick !== null && tick % (60 / row.script.tick) === 0) row.queue.push(2, 0, 0, 0, 0, 0);
        if (external) continue;
        if (row.queue.size > 0 && calls < 64 && this.remainingFuel > 0) { calls++; this.call(row); }
        row.metric.carried = row.queue.size;
      }
    } finally { this.active = null; this.busy = false; }
  }
  private observe(row: BindingState, handle: number, player = false, owned = false): void {
    check(integer(handle), 'actor handle'); if (handle === 0) return;
    row.observed.add(handle); if (player) row.players.add(handle); if (owned) row.owners.add(handle);
  }
  private call(row: BindingState): void {
    this.active = row;
    row.module.rewind(); row.module.begin(Math.min(this.callFuel, this.remainingFuel));
    row.io.fill(0); row.io[0] = this.tick; row.io[1] = (this.tick - (row.lastCall ?? 0)) / 60;
    row.io[2] = row.binding.id; row.io[3] = row.binding.self;
    row.io.set(row.values, row.layout.state); row.io.set(row.params, row.layout.params);
    row.nextTimers.set(row.timers); row.nextRng = row.rng; row.nextLastCall = this.tick;
    row.observed.clear(); row.players.clear(); row.owners.clear();
    for (const actor of row.binding.actors) { row.observed.add(actor); row.owners.add(actor); }
    const player = this.options.world.player;
    if (row.script.reads.includes('playerIntent') && player !== undefined) this.observe(row, player, true);
    const count = Math.min(16, row.queue.size); row.io[4] = count;
    const before = this.options.trace ? this.named(row, row.values) : null;
    row.commands.length = 0;
    try {
      for (let i = 0; i < count; i++) {
        const kind = row.queue.at(i, 0), subject = row.queue.at(i, 1), a = row.queue.at(i, 2);
        for (let j = 0; j < 6; j++) row.io[row.layout.inbox + i * 6 + j] = row.queue.at(i, j);
        if (subjectActors.has(kind)) this.observe(row, subject, kind === 15 || kind === 16, kind === 17);
        if (argumentActors.has(kind)) this.observe(row, a, kind === 6 || kind === 14);
        if (kind === 13) this.observe(row, row.queue.at(i, 3));
      }
      const commands = row.module.invoke('ws_handle');
      check(integer(commands, 0, 32) && this.usedCommands + commands <= 128, 'command quota');
      for (let i = 0; i < row.values.length; i++) {
        const slot = row.script.state[i]; check(slot !== undefined, 'missing slot');
        row.next[i] = slotNumber(slot, row.io[row.layout.state + i] ?? Number.NaN);
      }
      let spawns = 0, timers = 0;
      for (let i = 0; i < commands; i++) {
        const command = row.pool[i]; check(command !== undefined, 'command pool');
        for (let j = 0; j < 5; j++) { const value = row.io[row.layout.outbox + i * 5 + j] ?? Number.NaN; check(Number.isFinite(value), 'nonfinite command'); command[j] = value; }
        this.validateCommand(row, command);
        if (command[0] === 5 || command[0] === SCRIPT_V1_COMMANDS['body.spawn']) spawns++;
        if (command[0] === 8) {
          timers++; const index = row.timerIds.indexOf(command[2]); check(index !== -1, 'timer id');
          row.nextTimers[index] = command[3] === 0 ? 0 : this.tick + command[3] * 60;
        }
        row.commands.push(command);
      }
      check(spawns <= 4 && timers <= 8, 'spawn/timer quota');
      row.staged = this.options.world.prepare(row.commands, row.context);
      this.usedCommands += commands; row.metric.commands += commands;
      if (before) this.trace({ kind: 'call', tick: this.tick, binding: row.binding.id, ok: true, fuel: row.module.fuel, reason: null, before, after: this.named(row, row.next), commands: row.commands.map(command => [...command]) });
    } catch (error) {
      row.staged = null; row.failures++; row.metric.refusals++;
      const reason = error instanceof Error ? error.message : 'Decision refused';
      if (row.failures >= 3) { row.disabled = true; this.options.world.failed(row.script.onFail, row.context, reason); }
      if (before) this.trace({ kind: 'call', tick: this.tick, binding: row.binding.id, ok: false, fuel: row.module.fuel, reason, before, after: this.named(row, row.values), commands: [] });
    } finally {
      row.queue.consume(count); row.metric.calls++; row.metric.fuel += row.module.fuel;
      row.metric.maxFuel = Math.max(row.metric.maxFuel, row.module.fuel); row.metric.disabled = row.disabled;
      this.remainingFuel = Math.max(0, this.remainingFuel - row.module.fuel); this.active = null;
    }
  }
  private current(): BindingState { check(this.active !== null, 'query outside handle'); return this.active; }
  private id(row: BindingState, kind: DecisionIdKind, value: number): void {
    if (!integer(value, 1) || row.ids.get(kind)?.has(value) !== true) throw new Error(`Decision undeclared ${kind} id`);
  }
  private actor(row: BindingState, value: number): void { check(integer(value, 1) && row.observed.has(value), 'unobserved actor'); }
  private read(op: number, a: number, b: number): number {
    const row = this.current(), capability = readNames.get(op);
    check(capability !== undefined && row.script.reads.includes(capability) && Number.isFinite(a) && Number.isFinite(b), 'read capability');
    if (op <= 9 || op === 13 || op === 15 || op === 16 || op === 19) this.actor(row, a);
    if (op === 8 || op === 19) this.actor(row, b);
    if (op === 7) this.id(row, 'fields', b);
    if (op === 10) this.id(row, 'flags', a);
    if (op === 17) { this.actor(row, a); this.id(row, 'flags', b); }
    if (op === 13) this.id(row, 'zones', b);
    if (op === 14) this.id(row, 'zones', a);
    if (op === 18) this.id(row, 'spawns', a);
    if (op >= SCRIPT_V1_READS.bodyX && op <= SCRIPT_V1_READS.bodyVisible) { this.id(row, 'bodies', a); check(b === 0, 'body read arguments'); }
    if (op === SCRIPT_V1_READS.playerIntent) check((a === 0 || a === 1) && b === 0, 'player intent axis');
    let result: number;
    if (op === 11) { this.id(row, 'timers', a); result = Math.max(0, ((row.timers[row.timerIds.indexOf(a)] ?? 0) - this.tick) / 60); }
    else if (op === 12) {
      check(integer(row.nextRng, 0, Number.MAX_SAFE_INTEGER - 1), 'RNG counter');
      const seed = this.options.seed;
      result = mix(mix(seed[0] ^ row.binding.id) ^ mix(seed[1] ^ row.binding.instance)
        ^ mix(Math.floor(row.binding.id / 4294967296)) ^ mix(Math.floor(row.binding.instance / 4294967296))
        ^ mix(row.nextRng % 4294967296) ^ mix(Math.floor(row.nextRng / 4294967296))) / 4294967296;
      row.nextRng++;
    } else result = this.options.world.read(op, a, b, row.context);
    check(Number.isFinite(result), 'nonfinite read');
    if (op === 9) this.observe(row, result, true);
    if (this.options.trace) this.trace({ kind: 'read', tick: this.tick, binding: row.binding.id, op, a, b, result });
    return result;
  }
  private list(op: number, a: number, b: number, out: number, cap: number): number {
    const row = this.current(), capability = listNames.get(op), view = this.listViews[cap];
    check(capability !== undefined && row.script.lists.includes(capability) && Number.isFinite(a) && Number.isFinite(b), 'list capability');
    check(integer(cap, 0, 96) && view !== undefined && integer(out) && out % 8 === 0 && out + cap * 8 <= row.module.memory.buffer.byteLength, 'list range');
    if (op === 1) this.id(row, 'zones', a);
    if (op === 2 || op === 5) this.actor(row, a);
    if (op === 2) check(b >= 0, 'list radius');
    if (op === 5) this.actor(row, b);
    view.fill(0); const count = this.options.world.list(op, a, b, view, row.context);
    check(integer(count, 0, cap), 'list count');
    const memory = row.module.view;
    for (let i = 0; i < count; i++) { const value = view[i] ?? Number.NaN; check(Number.isFinite(value), 'nonfinite list'); memory.setFloat64(out + i * 8, value, true); if (op === 1 || op === 2) this.observe(row, value, op === 2); }
    if (this.options.trace) this.trace({ kind: 'list', tick: this.tick, binding: row.binding.id, op, a, b, result: Array.from(view.subarray(0, count)) });
    return count;
  }
  private validateCommand(row: BindingState, command: ScriptV1Command): void {
    const [op, target, a, b] = command, capability = commandNames.get(op);
    check(capability !== undefined && op < 100 && row.script.commands.includes(capability), 'command capability');
    check(integer(target), 'command target');
    if (op === SCRIPT_V1_COMMANDS['body.spawn']) {
      check(target === 0 && b === 0 && command[4] === 0, 'body spawn arguments'); this.id(row, 'bodies', a); return;
    }
    if (op === SCRIPT_V1_COMMANDS['body.teleport'] || op === SCRIPT_V1_COMMANDS['body.place']) { this.id(row, 'bodies', target); return; }
    if (op === SCRIPT_V1_COMMANDS['body.visible'] || op === SCRIPT_V1_COMMANDS['body.retire']) {
      this.id(row, 'bodies', target); check(b === 0 && command[4] === 0 && (op === SCRIPT_V1_COMMANDS['body.visible'] ? a === 0 || a === 1 : a === 0), 'body state arguments'); return;
    }
    if (op === SCRIPT_V1_COMMANDS['collider.enabled']) {
      check(target === 0 && (b === 0 || b === 1) && command[4] === 0, 'collider arguments'); this.id(row, 'colliders', a); return;
    }
    if (ownedCommands.has(op)) check(row.owners.has(target), 'command ownership');
    else if (target !== 0) { this.actor(row, target); check(playerCommands.has(op) || row.players.has(target) || row.owners.has(target), 'command ownership'); }
    if (op === 1 || op === 2) { this.id(row, op === 1 ? 'moves' : 'strikes', a); if (b !== 0) this.actor(row, b); }
    if (op === 4) this.id(row, 'fields', a);
    if (op === 5) { check(target === 0, 'spawn target'); this.id(row, 'spawns', a); }
    if (op === 7) { this.id(row, 'flags', a); check(b === 0 || b === 1, 'flag value'); }
    if (op === 8) { check(target === 0 && b >= 0 && b <= (Number.MAX_SAFE_INTEGER - this.tick) / 60, 'timer duration'); this.id(row, 'timers', a); }
    if (op === 9) this.id(row, 'signals', a);
    if (op === 10) this.id(row, 'facts', a);
    if (op === 11) this.id(row, 'rewards', a);
    if (op === 12) this.id(row, 'cues', a);
    if (op === 13) this.id(row, 'channels', a);
    if (op === 14) this.id(row, 'impulses', a);
    if (op === 15) check(target === 0 && integer(a, 1, 3), 'encounter verb');
    if (op === 16) this.id(row, 'weather', a);
  }
  private named(row: BindingState, values: Float64Array): Slots {
    const out: Slots = {};
    for (let i = 0; i < row.script.state.length; i++) { const slot = row.script.state[i]; if (slot) out[slot.name] = slot.type === 'bool' ? values[i] === 1 : values[i] ?? 0; }
    return out;
  }
  private savedTimers(row: BindingState, values: Float64Array): Record<string, number> {
    const out: Record<string, number> = {};
    for (let i = 0; i < values.length; i++) { const key = row.timerNames[i], deadline = values[i] ?? 0; if (key !== undefined && deadline > 0) out[key] = Math.max(0, (deadline - this.tick) / 60); }
    return out;
  }
  state(binding: number): Readonly<Slots> { check(!this.busy, 'state during call'); const row = this.row(binding); return this.named(row, row.values); }
  metrics(): readonly DecisionMetrics[] { return this.rows.map(row => ({ ...row.metric, disabled: row.disabled, carried: row.queue.size })); }
  snapshot(): DecisionSnapshot {
    check(!this.busy, 'snapshot during call');
    return { version: 1, tick: this.tick,
      bindings: this.rows.map(row => ({ id: row.binding.id, script: row.script.id, stateVersion: row.script.stateVersion,
        slots: this.named(row, row.values), timers: this.savedTimers(row, row.timers), rng: row.rng, failures: row.failures,
        disabled: row.disabled, pending: row.queue.saved(), lastCall: row.lastCall, ...(row.enabled === undefined ? {} : { enabled: row.enabled }) })),
      staged: this.rows.filter(row => row.staged !== null).map(row => {
        const saved: DecisionSnapshot['staged'][number] = { binding: row.binding.id, tick: this.tick,
          observed: [...row.observed], commands: row.commands.map(command => [...command]), slots: this.named(row, row.next),
          timers: this.savedTimers(row, row.nextTimers), rng: row.nextRng, lastCall: row.nextLastCall };
        if (row.external !== null) saved.external = row.external.map(command => [...command]);
        return saved;
      }),
    };
  }
  restore(input: DecisionSnapshot): void { this.prepareRestore(input)(); }
  /** Validate the complete continuation and native command suffix without
   * mutation or Wasm. The nonthrowing owner commit is guarded against a stale
   * capture. Used by the v2 runner as well as quiet restore, never content. */
  prepareRestore(input: DecisionSnapshot): (() => void) & { readonly validate: () => void } {
    check(!this.busy, 'restore during call'); this.busy = true;
    try {
    const snapshot = structuredClone(input);
    check(integer(snapshot.version, 1, 1) && integer(snapshot.tick) && snapshot.bindings.length === this.rows.length, 'snapshot identity');
    const staged = new Map<number, DecisionSnapshot['staged'][number]>();
    let commands = 0;
    for (const value of snapshot.staged) { check(!staged.has(value.binding) && this.bindings.has(value.binding), 'staged binding'); staged.set(value.binding, value); commands += value.commands.length + (value.external?.length ?? 0); }
    check(staged.size <= 64 && commands <= 128, 'snapshot quotas');
    const prepared = this.rows.map(row => {
      const saved = snapshot.bindings.find(value => value.id === row.binding.id);
      check(saved !== undefined && saved.script === row.script.id && saved.stateVersion === row.script.stateVersion, 'snapshot binding/version');
      check(integer(saved.rng) && integer(saved.failures, 0, 3) && saved.disabled === (saved.failures >= 3)
        && (saved.enabled === undefined || typeof saved.enabled === 'boolean')
        && (saved.lastCall === null || integer(saved.lastCall, 0, snapshot.tick)), 'snapshot counters');
      const decodeSlots = (slots: Readonly<Slots>): Float64Array => {
        check(Object.keys(slots).length === row.script.state.length, 'snapshot slots');
        return Float64Array.from(row.script.state.map(slot => { const value = slots[slot.name]; check(value !== undefined, 'snapshot slot missing'); return slotNumber(slot, value); }));
      };
      const decodeTimers = (timers: Readonly<Record<string, number>>): Float64Array => {
        for (const [key, value] of Object.entries(timers)) check(row.timerNames.includes(key) && Number.isFinite(value) && value >= 0 && value <= (Number.MAX_SAFE_INTEGER - snapshot.tick) / 60, 'snapshot timer');
        return Float64Array.from(row.timerNames.map(key => Object.hasOwn(timers, key) ? snapshot.tick + (timers[key] ?? 0) * 60 : 0));
      };
      const values = decodeSlots(saved.slots), timers = decodeTimers(saved.timers), queue = new EventQueue();
      for (const event of saved.pending) { const eventName = eventNames.get(event[0]); check(width(event, 6) && event.every(Number.isFinite) && eventName !== undefined && row.script.on.includes(eventName), 'snapshot event'); queue.push(...event); }
      const pending = staged.get(row.binding.id);
      let transaction: DecisionCommit | null = null, next = values, nextTimers = timers;
      if (pending) {
        check(!saved.disabled && snapshot.tick % (this.options.externalDivisor ?? 6) === 0 && pending.tick === snapshot.tick && pending.lastCall === snapshot.tick
          && integer(pending.rng) && pending.commands.length <= 32, 'snapshot staged tick');
        next = decodeSlots(pending.slots); nextTimers = decodeTimers(pending.timers);
        const observed = new Set(pending.observed); for (const actor of observed) check(integer(actor, 1), 'snapshot observed actor');
        const validation = { ...row, observed, players: observed, owners: observed };
        let spawns = 0, timerCount = 0;
        for (const command of pending.commands) {
          check(width(command, 5) && command.every(Number.isFinite), 'snapshot command');
          this.validateCommand(validation, command);
          if (command[0] === 5 || command[0] === SCRIPT_V1_COMMANDS['body.spawn']) spawns++;
          if (command[0] === 8) timerCount++;
        }
        check(spawns <= 4 && timerCount <= 8, 'snapshot spawn/timer quotas');
        const context: DecisionContext = { tick: snapshot.tick, script: row.script, binding: row.binding, observed };
        // The authoritative world revalidates the entire mixed bank before any
        // branch can publish. V1 retains its exact command tuple and save wire.
        if (pending.external === undefined) transaction = this.options.world.prepare(pending.commands, context);
        else {
          const prepare = this.options.world.prepareExternal;
          check(this.options.externalDivisor !== undefined && prepare !== undefined && pending.commands.length === 0
            && externalCommands(pending.external), 'external command authority');
          let externalSpawns = 0, externalTimers = 0;
          for (const command of pending.external) {
            if (command[0] <= 13) {
              check(Object.is(command[5],0), 'external native command padding');
              this.validateCommand(validation,[command[0],command[1],command[2],command[3],command[4]]);
              if (command[0] === 5) externalSpawns++;
              if (command[0] === 8) externalTimers++;
            }
          }
          check(externalSpawns <= 4 && externalTimers <= 8, 'external spawn/timer quotas');
          transaction = prepare(pending.external,context);
        }
      }
      return { row, saved, values, timers, queue, pending, transaction, next, nextTimers };
    });
    const revision = this.revision;
    const validate = (): void => { check(!this.busy && this.revision === revision, 'stale prepared continuation'); };
    return Object.assign(() => {
      validate();
      this.busy = true;
      try {
    this.tick = snapshot.tick;
    for (const value of prepared) {
      const { row, saved, pending } = value;
      row.values.set(value.values); row.timers.set(value.timers); row.queue = value.queue;
      row.rng = saved.rng; row.failures = saved.failures; row.disabled = saved.disabled; row.lastCall = saved.lastCall;
      if (saved.enabled === undefined) delete row.enabled; else row.enabled = saved.enabled;
      row.next.set(value.next); row.nextTimers.set(value.nextTimers); row.staged = value.transaction;
      row.nextRng = pending?.rng ?? saved.rng; row.nextLastCall = pending?.lastCall ?? 0; row.commands.length = 0;
      row.external = pending?.external?.map(command => [...command]) ?? null;
      row.observed.clear(); for (const actor of pending?.observed ?? []) row.observed.add(actor);
      for (const command of pending?.commands ?? []) row.commands.push([...command]);
      row.context.tick = snapshot.tick;
    }
      this.revision++;
      } finally { this.busy = false; }
    }, { validate });
    } finally { this.busy = false; }
  }
  private trace(entry: DecisionTrace): void {
    // Diagnostics cannot change refusal/commit semantics if a tooling observer throws.
    try { this.options.trace?.(entry); } catch { /* Tooling is outside the simulation transaction. */ }
  }
}
