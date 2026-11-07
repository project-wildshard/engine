import type { SimHost } from '@wildshard/engine/sim';
import { flagValue } from '@wildshard/engine/world/interact/flags';
import * as v from "valibot";
import { BossBrain, type BossContinuation, type BossDefinition, type BossPorts, type BossPresentation, type BossSaved, type BossScript } from '@wildshard/engine/ai/BossBrain';
import { ScriptHost, type ScriptQuery } from "@wildshard/engine/script/host";
import { SCRIPT_PARAMETER_QUERY } from '@wildshard/format/scriptAbi';
import { ScriptWorld, type EffectTransaction, type ScriptEffect } from "@wildshard/engine/script/effects";
import { parseDirector, type DirectorData, type DirectorEvent } from "@wildshard/format/director";
import { parseDirectorStages, type DirectorStagesData, type DirectorAction } from '@wildshard/format/directorStages';
import { compileDirectorWhen, evaluateDirectorWhen, type DirectorWhenInstruction } from '@wildshard/format/directorWhen';

function payload(row: DirectorData['events'][number], value: number): boolean {
  return Number.isFinite(value) && value >= row.min && value <= row.max && (row.type === 'number' || Number.isInteger(value));
}
class DirectorWorld extends ScriptWorld {
  private readonly data: DirectorData;
  constructor(data: DirectorData) {
    super({ fields: {}, archetypes: [], events: data.events.filter((row) => row.direction === 'output').map((row) => row.id), maxEntities: 1 },
      [{ id: data.entity, name: data.id, position: [0, 0, 0], fields: {}, frozen: false, interactive: true }]);
    this.data = data;
  }
  override prepare(effects: readonly ScriptEffect[], self: number, spawns: number, events: number): EffectTransaction {
    for (const effect of effects) {
      const row = this.data.events.find((entry) => entry.id === effect.a && entry.direction === 'output');
      if (effect.op !== 3 || effect.b !== self || row === undefined || !payload(row, effect.c)) throw new Error('Invalid typed director event');
    }
    return super.prepare(effects, self, spawns, events);
  }
}
const pendingSchema = v.array(v.strictObject({ type: v.number(), value: v.number() }));
const worldSchema = v.pipe(v.array(v.strictObject({ id: v.number(), name: v.string(), position: v.tuple([v.number(), v.number(), v.number()]), fields: v.record(v.string(), v.number()), frozen: v.boolean(), interactive: v.boolean() })), v.length(1));

/** Product JSON sorts input record keys. Retain an equivalent legacy record's
 * order for byte-compatible saves; stage/action arrays and bindings stay exact. */
function restoredStageContract(input: unknown, definition: DirectorStagesData): DirectorStagesData {
  const saved = parseDirectorStages(input);
  if (JSON.stringify({ ...saved, inputs: definition.inputs }) !== JSON.stringify(definition)
    || Object.keys(saved.inputs).length !== Object.keys(definition.inputs).length
    || Object.entries(saved.inputs).some(([key, value]) => definition.inputs[key] !== value)) throw new Error('Incompatible stage director contract');
  return saved;
}

/** Bounded authoritative director lane; full Wasm state, quotas, failure history and pending typed input survive replay. */
export class DirectorLane {
  readonly data: DirectorData;
  readonly host: ScriptHost;
  private currentTick = -1;
  private pending: { type: number; value: number }[] = [];
  constructor(data: DirectorData, bytes: Uint8Array, seed: number, query: ScriptQuery = () => []) {
    this.data = parseDirector(data);
    if (!Number.isSafeInteger(seed)) throw new Error('Invalid director seed');
    this.host = new ScriptHost({ world: new DirectorWorld(this.data), query: (kind, request, self) => {
      if (kind !== SCRIPT_PARAMETER_QUERY) return query(kind, request, self);
      if (self !== this.data.entity || request.length !== 8 || request.some((value) => value !== 0)) throw new Error('Director parameters require trusted self');
      return [...this.data.parameters];
    } });
    this.host.install(this.data.module, bytes, seed | 0, Math.floor(seed / 4294967296) | 0);
  }
  /** Last admitted fixed tick; restored installations resume without maintaining a second clock. */
  get tick(): number { return this.currentTick; }
  /** Queue a subscribed shard event for the next fixed tick; callers cannot choose an entity or invoke an export. */
  enqueue(key: string, value = 0, scope: 'shard' | 'grid' = 'shard'): void {
    if (scope === 'grid') throw new Error('Grid director delivery is reserved');
    const row = this.data.events.find((entry) => entry.key === key && entry.direction === 'input');
    if (row === undefined || !this.data.subscriptions.some((entry) => entry.scope === scope && entry.event === key) || !payload(row, value)) throw new Error('Invalid subscribed director event');
    if (this.pending.length >= this.host.limits.events) throw new Error('Director event allowance');
    this.pending.push({ type: row.id, value });
  }
  /** Stable input ordering and the engine's unchanged fuel, event, query and memory ceilings. */
  step(tick: number, observation: Readonly<Record<string, number>>, dt: number = 1 / 60): readonly DirectorEvent[] {
    const input = this.observation(observation, dt);
    this.host.beginTick(tick);
    this.currentTick = tick;
    return this.call(input, dt);
  }
  /** Deliver an immediate trusted request at zero elapsed time, sharing this tick's remaining allowances. */
  dispatch(observation: Readonly<Record<string, number>>): readonly DirectorEvent[] {
    if (this.currentTick < 0) throw new Error('Director is not initialized');
    return this.call(this.observation(observation, 0), 0);
  }
  private observation(observation: Readonly<Record<string, number>>, dt: number): number[] {
    if (!Number.isFinite(dt) || dt < 0 || dt > 1) throw new Error('Invalid director delta');
    const input = this.data.inputs.map((row) => {
      const value = observation[row.key]; if (value === undefined || !Number.isFinite(value) || value < row.min || value > row.max) throw new Error('Invalid director observation'); return value;
    });
    return input;
  }
  private call(input: readonly number[], dt: number): readonly DirectorEvent[] {
    const tick = this.currentTick;
    const events = this.pending.flatMap((row) => [row.type, this.data.entity, row.value, 0, 0, 0]); this.pending = [];
    const call = this.host.call(this.data.module, this.data.entity, [tick, dt, 0, this.data.entity, 0, 0, ...input], events);
    if (!call.ok) return [];
    return call.events.map((event) => {
      const row = this.data.events.find((entry) => entry.id === event.type); if (row === undefined) throw new Error('Undeclared director output');
      return { director: this.data.id, tick, key: row.key, type: row.type, value: event.value };
    });
  }
  /** Complete same-engine continuation, including queued subscriptions and author memory/globals. */
  snapshot(): string { return JSON.stringify({ contract: this.data, host: this.host.checkpoint(), world: this.host.world.state(), pending: this.pending }); }
  /** Restore a matching installed lane atomically; initialization and output callbacks are never replayed. */
  restore(text: string): void {
    const raw: unknown = JSON.parse(text);
    if (typeof raw !== 'object' || raw === null || !('contract' in raw) || !('host' in raw) || !('world' in raw) || !('pending' in raw)
      || JSON.stringify(raw.contract) !== JSON.stringify(this.data)) throw new Error('Incompatible director snapshot');
    const pending = v.parse(pendingSchema, raw.pending);
    if (pending.length > this.host.limits.events || pending.some((row) => {
      const event = this.data.events.find((entry) => entry.id === row.type && entry.direction === 'input');
      return event === undefined || !payload(event, row.value) || !this.data.subscriptions.some((entry) => entry.scope === 'shard' && entry.event === event.key);
    })) throw new Error('Invalid director pending events');
    const savedWorld = v.parse(worldSchema, raw.world);
    if (savedWorld[0]?.id !== this.data.entity) throw new Error('Invalid director identity');
    // Roll back both participants if host validation rejects a checkpoint after world validation.
    const before = this.host.checkpoint(), world = this.host.world.state();
    try {
      const savedHost = raw.host as ReturnType<ScriptHost['checkpoint']>;
      this.host.world.restore(savedWorld); this.host.restoreState(savedHost); this.pending = pending; this.currentTick = savedHost.tick;
    } catch (error) { this.host.world.restore(world); this.host.restoreState(before); throw error; }
  }
}

/** Admit immutable module bytes once; each invocation installs fresh author state with the unchanged engine ceilings. */
export async function prepareDirectorModule(data: DirectorData, bytes: Uint8Array): Promise<(seed: number, query?: ScriptQuery) => DirectorLane> {
  const checked = parseDirector(data), copy = Uint8Array.from(bytes);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', copy));
  if ([...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('') !== checked.module) throw new Error('Director module hash mismatch');
  return (seed, query) => new DirectorLane(checked, copy, seed, query);
}

/** Copy raw author bytes only when they name the admitted declaration. Encoded payloads refuse before decoding. */
export function embeddedDirectorBytes(data: unknown, module: { readonly module: string; readonly bytes: Uint8Array }): Uint8Array {
  if (module.module !== parseDirector(data).module) throw new Error('Embedded director module is stale');
  if (!(module.bytes instanceof Uint8Array)) throw new Error('Director module requires raw binary bytes');
  return Uint8Array.from(module.bytes);
}
/** Admit an embedded bake once and retain a caller-owned seed for independent lane installations. */
export async function prepareEmbeddedDirector(data: unknown, module: { readonly module: string; readonly bytes: Uint8Array }, seed: number, scope?: { readonly disposed: boolean; readonly disposing?: boolean }): Promise<() => DirectorLane> {
  const create = await prepareDirectorModule(parseDirector(data), embeddedDirectorBytes(data, module));
  if (scope?.disposed === true || scope?.disposing === true) throw new Error('Director owner left during admission');
  return () => create(seed);
}

const embeddedProduct = v.strictObject({ declaration: v.unknown(), module: v.strictObject({ module: v.string(), bytes: v.string(), file: v.exactOptional(v.pipe(v.string(),v.minLength(1),v.maxLength(240))) }),
  stages: v.unknown(), bindings: v.unknown(), seed: v.number() });
/** Read the verified binary file and stage contracts from the admitted product; inline modules refuse. */
export async function readDirectorProduct(product: { file: (name: string) => Promise<Uint8Array> }, scope?: { readonly disposed: boolean; readonly disposing?: boolean }): Promise<{
  readonly create: () => DirectorLane; readonly bytes: Uint8Array; readonly stages: unknown;
}> {
  const data = v.parse(embeddedProduct, JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await product.file('directors/main.json'))));
  if (data.module.file === undefined) throw new Error('Director requires a named binary file');
  if (data.module.bytes !== '' || data.module.module !== parseDirector(data.declaration).module) throw new Error('Raw director module is stale or mixed');
  const module = { ...data.module, bytes: await product.file(data.module.file) };
  const create = await prepareEmbeddedDirector(data.declaration, module, data.seed, scope);
  return { create, bytes: embeddedDirectorBytes(data.declaration, module), stages: data.stages };
}


const stageState = v.strictObject({ tick: v.pipe(v.number(), v.integer(), v.minValue(-1), v.maxValue(Number.MAX_SAFE_INTEGER)), stage: v.pipe(v.number(), v.integer(), v.minValue(-1), v.maxValue(63)) });

/** Version-two row interpreter. Native bindings supply observations; returned actions belong to their real owners.
 * Enter the first stage on the first tick, then at most one successor per tick. An explicit next target permits a cycle.
 * No callback or service is installed, and no stage action is replayed during restore. */
export class DirectorStageLane {
  private readonly definition: DirectorStagesData;
  private readonly conditions: readonly (readonly DirectorWhenInstruction[])[];
  private readonly successors: readonly (readonly { target: number; condition: readonly DirectorWhenInstruction[] }[])[];
  private currentTick = -1;
  private currentStage = -1;
  private inputNames: readonly string[];
  constructor(data: unknown) {
    this.definition = structuredClone(parseDirectorStages(data));
    if (this.definition.script !== null) throw new Error('Scripted stage directors require a typed script installation');
    const names = Object.keys(this.definition.inputs); this.inputNames = names;
    this.conditions = this.definition.stages.map(stage => compileDirectorWhen(stage.when ?? 'true', names));
    this.successors = this.definition.stages.map((stage, index) => {
      const targets = typeof stage.next === 'string' ? [{ target: stage.next, when: 'true' }] : stage.next;
      return targets === undefined ? [{ target: index + 1, condition: compileDirectorWhen('true', names) }]
        : targets.map(target => ({ target: this.definition.stages.findIndex(row => row.id === target.target), condition: compileDirectorWhen(target.when, names) }));
    });
  }
  /** An independent copy of the installed immutable author contract. */
  get data(): DirectorStagesData { return structuredClone(this.definition); }
  /** The last accepted fixed tick, including ticks that did not change stage. */
  get tick(): number { return this.currentTick; }
  /** The active stage identity, or null before the first accepted tick. */
  get stage(): string | null { return this.definition.stages[this.currentStage]?.id ?? null; }
  /** Validate a complete native observation before advancing; commands retain author order and cannot mutate installed rows. */
  step(tick: number, observation: Readonly<Record<string, boolean>>): readonly DirectorAction[] {
    if (!Number.isSafeInteger(tick) || tick < 0 || tick <= this.currentTick) throw new Error('Invalid stage director tick');
    if (observation === null || observation === undefined) throw new Error('Invalid stage director observation');
    const names = this.inputNames;
    let count = 0; for (const name in observation) if (Object.hasOwn(observation, name)) count++;
    if (count !== names.length) throw new Error('Invalid stage director observation');
    for (const name of names) if (!Object.hasOwn(observation, name) || typeof observation[name] !== 'boolean') throw new Error('Invalid stage director observation');
    let target = this.currentStage, entered = false;
    if (target < 0) { target = 0; entered = true; }
    else {
      const stage = this.definition.stages[target];
      if (stage === undefined) throw new Error('Invalid installed director stage');
      for (const successor of this.successors[target] ?? []) {
        const condition = this.conditions[successor.target];
        if (condition !== undefined && evaluateDirectorWhen(successor.condition, observation) && evaluateDirectorWhen(condition, observation)) {
          target = successor.target; entered = true; break;
        }
      }
    }
    const actions = entered ? structuredClone(this.definition.stages[target]?.do ?? []) : [];
    this.currentTick = tick; this.currentStage = target;
    return actions;
  }
  /** Persist the exact author contract and cursor; stage-entry effects are absent from the continuation. */
  snapshot(): string { return JSON.stringify({ version: 2, contract: this.definition, state: { tick: this.currentTick, stage: this.currentStage } }); }
  /** Refuse a foreign contract or malformed cursor before mutation. Restore never evaluates guards or emits effects. */
  restore(text: string): void {
    const saved = v.parse(v.strictObject({ version: v.literal(2), contract: v.unknown(), state: stageState }), JSON.parse(text));
    const contract = restoredStageContract(saved.contract, this.definition);
    if (saved.state.stage >= this.definition.stages.length
      || (saved.state.tick === -1) !== (saved.state.stage === -1)) throw new Error('Incompatible stage director snapshot');
    this.definition.inputs = contract.inputs; this.inputNames = Object.keys(contract.inputs);
    this.currentTick = saved.state.tick; this.currentStage = saved.state.stage;
  }
}

/** A concrete fixed director action bound to its existing native owner. */
export interface DirectorActionBinding { readonly action: DirectorAction; readonly run: () => void }
/** External observations and quiet installation; advancing never owns another clock. */
export interface DirectorActionHostSpec {
  /** Explicit native observations retain precedence over declaration-based lookup. */
  readonly read?: () => Readonly<Record<string, boolean>>;
  /** The actual flags owner supplies declared flag observations and actions. */
  readonly flags?: { readonly has: (key: string) => boolean; readonly set: (key: string, value: boolean) => void };
  /** Actor, zone and event bindings still require their real native observation owner. */
  readonly observe?: (binding: string) => boolean;
  readonly bindings: readonly DirectorActionBinding[];
  readonly initial: readonly Readonly<Record<string, boolean>>[];
}
/** The same stage cursor, with declared ordered native actions and silent restore. */
export interface BoundDirectorActions { advance: () => void; snapshot: () => string; restore: (value: string) => void; validate: (value: string) => void }
function actionIdentity(action: DirectorAction): string {
  if ('spawn' in action) return JSON.stringify(['spawn', action.spawn]);
  if ('despawn' in action) return JSON.stringify(['despawn', action.despawn]);
  if ('flag' in action) return JSON.stringify(['flag', action.flag.key, action.flag.value]);
  if ('score' in action) return JSON.stringify(['score', action.score]);
  if ('weather' in action) return JSON.stringify(['weather', action.weather]);
  if ('toast' in action) return JSON.stringify(['toast', action.toast]);
  if ('reward' in action) return JSON.stringify(['reward', action.reward]);
  return JSON.stringify(['emit', action.emit, action.value]);
}
/**
 * Bind every authored action before advancing or invoking a native callback.
 * Quiet initial observations seed the existing lane without replaying effects;
 * accepted native edges advance its tick and dispatch in the authored order.
 */
export function bindDirectorActions(data: unknown, spec: DirectorActionHostSpec): BoundDirectorActions {
  const lane = new DirectorStageLane(data), hooks = new Map<string, () => void>();
  const definition = lane.data, flags = spec.flags, observe = spec.observe;
  if (spec.read === undefined && Object.values(definition.inputs).some(binding => binding.startsWith('flag:') ? flags === undefined : observe === undefined)) {
    throw new Error('Unbound native director observation');
  }
  const flagTerms = new Map(Object.values(definition.inputs).filter(binding => binding.startsWith('flag:')).map(binding => [binding, [{ name: binding.slice(5), bit: 1 }]]));
  const read = spec.read ?? (() => Object.fromEntries(Object.entries(definition.inputs).map(([name, binding]) => {
    if (binding.startsWith('flag:') && flags !== undefined) {
      const terms = flagTerms.get(binding); if (terms === undefined) throw new Error('Unbound native director flag');
      return [name, flagValue(flags, terms) !== 0];
    }
    if (observe !== undefined) return [name, observe(binding)];
    throw new Error('Unbound native director observation');
  })));
  for (const binding of spec.bindings) {
    const key = actionIdentity(binding.action);
    if (hooks.has(key)) throw new Error('Duplicate director action binding');
    hooks.set(key, binding.run);
  }
  if (flags !== undefined) for (const stage of definition.stages) for (const action of stage.do) {
    const key = actionIdentity(action);
    if ('flag' in action && !hooks.has(key)) hooks.set(key, () => { flags.set(action.flag.key, action.flag.value); });
  }
  if (definition.stages.some(stage => stage.do.some(action => !hooks.has(actionIdentity(action))))) throw new Error('Unbound native director action');
  for (const observation of spec.initial) lane.step(lane.tick + 1, observation);
  return {
    advance: () => {
      for (const action of lane.step(lane.tick + 1, read())) {
        const run = hooks.get(actionIdentity(action));
        if (run === undefined) throw new Error('Unbound native director action');
        run();
      }
    },
    snapshot: () => lane.snapshot(), restore: value => { lane.restore(value); },
    validate: value => { new DirectorStageLane(definition).restore(value); },
  };
}

/** Native observations and one publication policy; named emits consume only admitted numeric payloads. */
export interface DirectorScriptStagePorts {
  readonly observe: () => Readonly<Record<string, number>>;
  /** Disposed native owners neither dispatch requests, advance nor publish. */
  readonly scope?: { readonly disposed: boolean };
  readonly publish?: (action: DirectorAction, source?: Readonly<DirectorEvent>) => void;
  readonly emits?: {
    /** Matching requires a real same-key AS event; optional also permits bootstrap actions. */
    readonly source: 'matching' | 'optional';
    /** Literal mode also requires each same-key AS payload to equal its authored row value. */
    readonly value?: 'literal';
    readonly actions: ReadonlyMap<string, (value: number) => void>;
  };
}

/** External-clock stage installation with an admitted AS escape handler. The native lane owns elapsed time,
 * quotas and typed observations; ordered output events select authored stage actions without a second scheduler.
 * Publication also carries the admitted AS event for bounded native parameters; row actions retain their authored values.
 * initialDt preserves the admitted handler's native initialization ABI; its default is a zero-time observation. */
const nativeStageLanes = new WeakMap<SimHost, Map<string, DirectorScriptStageLane>>();
export function nativeStageLane(host: SimHost, id: string): DirectorScriptStageLane {
  const lane = nativeStageLanes.get(host)?.get(id); if (lane === undefined) throw new Error('Missing native stage lane'); return lane;
}
export class DirectorScriptStageLane {
  private readonly definition: DirectorStagesData;
  private readonly stages: DirectorStageLane;
  private readonly script: DirectorLane;
  private readonly ports: DirectorScriptStagePorts;
  private readonly emits: DirectorScriptStagePorts['emits'];
  /** Publish this existing continuation under a native service identity. */
  registerNative(host: SimHost, id: string): void {
    if (host.scope.disposed || id.length === 0) throw new Error('Native stage lane requires a live declared id');
    const book = nativeStageLanes.get(host) ?? new Map<string, DirectorScriptStageLane>();
    if (book.has(id)) throw new Error('Duplicate native stage lane');
    book.set(id, this); nativeStageLanes.set(host, book); host.scope.onDispose(() => { book.delete(id); });
  }
  constructor(data: unknown, script: DirectorLane, ports: DirectorScriptStagePorts, restoring = false, initialDt = 0) {
    if (!Number.isFinite(initialDt) || initialDt < 0 || initialDt > 1) throw new Error('Invalid director initial delta');
    this.definition = structuredClone(parseDirectorStages(data));
    if (this.definition.script !== script.data.module) throw new Error('Stage escape handler hash mismatch');
    const outputs = script.data.events.filter(event => event.direction === 'output');
    for (const binding of Object.values(this.definition.inputs)) {
      if (!binding.startsWith('event:') || !outputs.some(event => binding === `event:${event.key}`)) throw new Error('Undeclared stage handler output');
    }
    if (outputs.some(event => !Object.values(this.definition.inputs).includes(`event:${event.key}`))) throw new Error('Unbound stage handler output');
    const emits = ports.emits;
    if (emits !== undefined) {
      if (ports.publish !== undefined || !['matching', 'optional'].includes(emits.source) || emits.actions.size > 64) throw new Error('Invalid director emit bindings');
      const actions = new Map(emits.actions);
      if ([...actions.values()].some(run => typeof run !== 'function') || this.definition.stages.some(stage => stage.do.some(action =>
        !('emit' in action) || typeof action.value !== 'number' || !actions.has(action.emit) || (emits.value === 'literal'
          ? !outputs.some(event => event.key === action.emit && typeof action.value === 'number' && payload(event, action.value)) : action.value !== 0)))) throw new Error('Unbound director emit action');
      this.emits = { source: emits.source, actions, ...(emits.value === undefined ? {} : { value: emits.value }) };
    } else if (typeof ports.publish !== 'function') throw new Error('Missing director publication owner');
    this.stages = new DirectorStageLane({ ...this.definition, script: null });
    this.script = script; this.ports = ports;
    if (!restoring) {
      if (script.tick !== -1) throw new Error('Stage escape handler already initialized');
      this.publish(this.stages.step(0, this.observation()));
      this.deliver(script.step(0, ports.observe(), initialDt));
    }
  }
  /** Deliver real flag/request edges at zero dt within the existing native tick's remaining allowance. */
  changed(): void { if (this.ports.scope?.disposed !== true) this.deliver(this.script.dispatch(this.ports.observe())); }
  /** Queue a declared native input and dispatch at zero dt on the existing clock. */
  request(key: string, value = 0): void {
    if (this.ports.scope?.disposed === true) return;
    this.script.enqueue(key, value); this.changed();
  }
  /** Advance once at the owner's existing clock phase, retaining fractional dt and native output order. */
  update(dt: number): void { if (this.ports.scope?.disposed !== true) this.deliver(this.script.step(this.script.tick + 1, this.ports.observe(), dt)); }
  /** Versioned complete continuation: immutable stage rows, cursor and the unchanged AS native checkpoint. */
  snapshot(): string { return JSON.stringify({ version: 3, contract: this.definition, stages: this.stages.snapshot(), script: this.script.snapshot() }); }
  /** Restore both owners quietly and atomically; pre-row snapshots require an explicit migration and are refused. */
  restore(text: string): void {
    const saved = v.parse(v.strictObject({ version: v.literal(3), contract: v.unknown(), stages: v.string(), script: v.string() }), JSON.parse(text));
    const contract = restoredStageContract(saved.contract, this.definition);
    const stages = this.stages.snapshot(), script = this.script.snapshot();
    try { this.stages.restore(saved.stages); this.script.restore(saved.script); }
    catch (error) { this.stages.restore(stages); this.script.restore(script); throw error; }
    this.definition.inputs = contract.inputs;
  }
  private observation(event?: DirectorEvent): Record<string, boolean> {
    return Object.fromEntries(Object.entries(this.definition.inputs).map(([name, binding]) => [name, binding === `event:${event?.key ?? ''}`]));
  }
  private deliver(events: readonly DirectorEvent[]): void {
    for (const event of events) this.publish(this.stages.step(this.stages.tick + 1, this.observation(event)), event);
  }
  private publish(actions: readonly DirectorAction[], source?: Readonly<DirectorEvent>): void {
    for (const action of actions) {
      if (this.ports.scope?.disposed === true) return;
      const emits = this.emits;
      if (emits === undefined) {
        if (this.ports.publish === undefined) throw new Error('Missing director publication owner');
        this.ports.publish(action, source); continue;
      }
      if (!('emit' in action) || typeof action.value !== 'number' || (emits.value === 'literal' ? source !== undefined && (source.key !== action.emit || source.value !== action.value) : action.value !== 0)
        || emits.source === 'matching' && (source === undefined || source.key !== action.emit)) throw new Error('Invalid director emit source');
      const run = emits.actions.get(action.emit);
      if (run === undefined) throw new Error('Unbound director emit action');
      run(emits.value === 'literal' ? action.value : source?.value ?? 0);
    }
  }
}

/** Encounter rows select transitions for native bosses; clocks, body callbacks, rewards and views stay BossBrain's.
 * Sky's held Roc and Signal's respawning Matriarch use the same owner in their page and renderer-free hosts. */
export class DirectorBossBrain extends BossBrain {
  private readonly stages: BoundDirectorActions;
  private selected: string | null = null;
  private readonly observations = { arena: false, intro: false, beat: false, dead: false, phase: false };
  constructor(def: BossDefinition, script: BossScript, ports: BossPorts, presentation: BossPresentation, saved: BossSaved, rows: unknown) {
    super(def, script, ports, presentation, saved);
    const definition = parseDirectorStages(rows);
    const keys = new Set(['boss.intro', 'boss.fight', 'boss.resume', 'boss.won', 'boss.phase']);
    if (definition.stages.some(stage => stage.do.length > 1 || stage.do.some(action => !('emit' in action) || action.value !== 0 || !keys.has(action.emit)))) throw new Error('Invalid authored boss action');
    this.stages = bindDirectorActions(definition, { read: () => this.observations,
      bindings: [...keys].map(emit => ({ action: { emit, value: 0 }, run: () => { this.selected = emit; } })), initial: [this.observations] });
  }
  private select(input: keyof DirectorBossBrain['observations'], eligible: boolean, event: string): boolean {
    this.observations[input] = eligible;
    try {
      this.selected = null; this.stages.advance();
      return this.selectedAction() === event;
    } finally { this.observations[input] = false; }
  }
  private selectedAction(): string | null { return this.selected; }
  protected override introReady(inside: boolean): boolean { return this.select('arena', inside, 'boss.intro'); }
  protected override fightReady(elapsed: number, skip: number, length: number): boolean {
    return this.select('intro', elapsed >= length || skip >= 0.6, 'boss.fight');
  }
  protected override beatReady(elapsed: number): boolean { return this.select('beat', elapsed >= 1.5, 'boss.resume'); }
  protected override winReady(dead: boolean): boolean { return this.select('dead', dead, 'boss.won'); }
  protected override phaseReady(at: number): boolean { return this.select('phase', this.script.hpFrac <= at, 'boss.phase'); }
  /** Preserve native continuation fields and add the exact author contract/cursor, without emitting effects. */
  override snapshot(): BossContinuation { return { ...super.snapshot(), director: this.stages.snapshot() }; }
  /** A pre-row or foreign snapshot refuses; restore both owners quietly and atomically. */
  override restore(value: BossContinuation): void {
    if (value.director === undefined) throw new Error('Authored boss requires its director continuation');
    const before = this.stages.snapshot();
    this.stages.restore(value.director);
    try { super.restore(value); } catch (error) { this.stages.restore(before); throw error; }
  }
}
