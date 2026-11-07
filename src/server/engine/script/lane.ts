import * as v from 'valibot';
import type { SimHost } from '../sim';
import type { DeclaredScriptWorld } from '../../../shared/engine/script/state';
import { ScriptHost, type ScriptCall, type ScriptHostOptions } from '../../../shared/engine/script/host';
import type { ScriptEntity, ScriptEvent } from '../../../shared/engine/script/effects';
import type { ScriptRole, ScriptSchedule } from './composition';

/** A content binding; the actor id is supplied by the trusted host, never an effect or script input. */
export interface ScriptBinding { module: string; entity: number; actorId: string | null; kind: 'server' | 'entity' }
/** Admitted bytecode and its stable module identity and initialization seed. */
export interface ScriptModule { name: string; bytes: Uint8Array; seedLo: number; seedHi: number }
/** Explicit dependencies for one local authoritative script lane. */
export interface ScriptLaneOptions extends Omit<ScriptHostOptions, 'world'> {
  world: DeclaredScriptWorld; modules: readonly ScriptModule[]; bindings: readonly ScriptBinding[]; divisor: number;
  /** The actor seats stand in for: what binds to it runs for each seated player too. */
  seatsFor?: string | undefined;
}
/** Numeric-state facade for a standalone lane or a level-wide composed host; no concrete implementation cast is required. */
export interface ScriptLanePort {
  readonly host: ScriptHost; readonly world: DeclaredScriptWorld; readonly divisor: number;
  step: (tick: number, commands?: ReadonlyMap<string, number>) => readonly ScriptCall[];
  /** Same execution without unused results; older facades execute their full step. */
  stepWithoutResults?: (tick: number, commands?: ReadonlyMap<string, number>) => void;
  enqueue: (event: ScriptEvent) => void; snapshot: () => string; restore: (text: string) => void;
  /** Advances when snapshot() may differ other than in its tick; a lane without one is always treated as changed. */
  stateRevision?: () => number;
  /** A player joins or leaves between steps (`DeclaredScriptWorld.seat`), with their entities in `world`; absent, this lane serves its install's actors only. */
  seat?: (world: DeclaredScriptWorld, actorId: string, entities: readonly ScriptEntity[], content: readonly number[]) => void;
  unseat?: (world: DeclaredScriptWorld, actorId: string) => void;
  /** Every world on this lane that can hold a seat. */
  seatWorlds?: () => readonly DeclaredScriptWorld[];
}
const finite = v.pipe(v.number(), v.finite());
const natural = v.pipe(finite, v.integer(), v.minValue(0));
const vec3 = v.tuple([finite, finite, finite]);
const checkpointSchema = v.strictObject({
  version: v.literal(0), contract: v.string(),
  world: v.strictObject({ entities: v.array(v.strictObject({ id: natural, name: v.string(), position: vec3, fields: v.record(v.string(), finite), frozen: v.boolean(), interactive: v.boolean() })), shared: v.array(finite), players: v.array(v.strictObject({ actorId: v.string(), values: v.array(finite) })), seats: v.exactOptional(v.array(v.strictObject({ actorId: v.string(), handles: v.array(natural), content: v.array(natural) }))) }),
  host: v.strictObject({ tick: v.pipe(finite, v.integer(), v.minValue(-1)), used: v.strictObject({ effects: natural, spawns: natural, events: natural, queries: natural, fuel: natural }),
    pending: v.array(v.strictObject({ type: natural, target: natural, value: finite })), modules: v.array(v.strictObject({ name: v.string(), memory: v.array(natural), globals: v.array(v.strictObject({ name: v.string(), type: v.picklist(['number', 'bigint']), value: v.string() })), failures: natural, disabled: v.boolean() })) }),
});
/** A binding run again for a seated player, on their own body. */
interface SeatedBinding extends ScriptBinding { readonly divisor: number }
const NO_COMMANDS: ReadonlyMap<string, number> = new Map(), NO_EVENT_ROWS: readonly number[] = Object.freeze([]);
/** Numeric-state scheduler dependencies; construction never installs a module or starts a host tick. */
export type ScriptDriverOptions = Pick<ScriptLaneOptions, 'world' | 'modules' | 'bindings' | 'divisor' | 'query' | 'seatsFor'>;
/** Declared numeric state is validated in its own trusted role, separate from creature motion intentions. */
export class ScriptDriver {
  readonly world: DeclaredScriptWorld;
  readonly divisor: number;
  readonly contract: string;
  private readonly bindings: readonly ScriptBinding[];
  private readonly actors: readonly string[];
  private readonly query: ScriptHostOptions['query'];
  private readonly seatsFor: string | undefined;
  private seatMark = -1;
  private seatRows: readonly SeatedBinding[] = [];
  constructor(options: ScriptDriverOptions) {
    if (!Number.isInteger(options.divisor) || options.divisor < 1 || 60 % options.divisor !== 0) throw new Error('Script divisor divides 60');
    this.divisor = options.divisor; this.world = options.world; this.query = options.query; this.seatsFor = options.seatsFor;
    const keys = new Set<string>();
    for (const binding of options.bindings) {
      const key = `${binding.module}:${binding.entity}`;
      if (keys.has(key) || !options.modules.some(m => m.name === binding.module) || !this.world.entity(binding.entity)
        || (this.world.actor(binding.entity) ?? null) !== binding.actorId) throw new Error('Invalid script binding');
      keys.add(key);
    }
    this.bindings = options.bindings.map(b => ({ ...b })).sort((a, b) => a.module < b.module ? -1 : a.module > b.module ? 1 : a.entity - b.entity);
    this.actors = [...new Set(this.bindings.flatMap(b => b.actorId === null ? [] : [b.actorId]))].sort();
    this.contract = JSON.stringify({ divisor: this.divisor, bindings: this.bindings, state: this.world.declaration, modules: options.modules.map(m => ({ name: m.name, bytes: Array.from(m.bytes), seedLo: m.seedLo, seedHi: m.seedHi })).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0) });
  }
  /** Only this role may publish its declared shared/player fields; actor provenance stays host-bound. */
  role(id: string): ScriptRole { return { id, moduleContract: true, world: this.world, query: this.query, events: 'deliver', snapshot: () => this.snapshot(), restore: text => { this.restore(text); } }; }
  /** What binds to `seatsFor`, once more for each seated player on their own body. Alone, none. */
  private seated(): readonly SeatedBinding[] {
    const mark = this.world.seated;
    if (mark === 0 && this.seatRows.length === 0) return this.seatRows;
    const rows = this.bindings.filter(binding => binding.actorId !== null && binding.actorId === this.seatsFor);
    if (rows.length === 0) return this.seatRows;
    if (mark !== this.seatMark || this.seatRows.some(row => row.actorId === null || this.world.seatOf(row.actorId)?.[0] !== row.entity))
      this.seatRows = this.world.seatedActors().flatMap(actorId => rows.flatMap(row => { const entity = this.world.seatOf(actorId)?.[0]; return entity === undefined ? [] : [{ ...row, entity, actorId, divisor: this.divisor }]; }));
    this.seatMark = mark;
    return this.seatRows;
  }
  /** Prepare numeric inputs for due bindings; the owning composition starts the one global fixed tick. */
  schedule(id: string, role: string, commands: () => ReadonlyMap<string, number> = () => NO_COMMANDS): ScriptSchedule {
    const byEntity = new Map<number, ScriptBinding[]>(), inputRows = new WeakMap<ScriptBinding, number[]>();
    for (const binding of this.bindings) { const rows = byEntity.get(binding.entity); if (rows === undefined) byEntity.set(binding.entity, [binding]); else rows.push(binding); }
    return { id, role, bindings: this.bindings.map(binding => ({ module: binding.module, entity: binding.entity, divisor: this.divisor })),
      seated: () => this.seated(),
      input: (scheduled, tick) => {
        let binding: ScriptBinding | undefined;
        for (const row of byEntity.get(scheduled.entity) ?? []) if (row.module === scheduled.module) { binding = row; break; }
        binding ??= this.seated().find(row => row.entity === scheduled.entity && row.module === scheduled.module);
        if (binding === undefined) throw new Error('Missing numeric script binding');
        const actor = binding.actorId, command = actor === null ? 0 : commands().get(actor) ?? 0;
        // One row per binding, refilled each tick: its readers (the lane's call, the composition's copy) use it at once.
        let input = inputRows.get(binding); if (input === undefined) { input = []; inputRows.set(binding, input); }
        // Past every install actor's token, a seated player's is its place among the seats.
        const token = actor === null ? 0 : this.actors.includes(actor) ? this.actors.indexOf(actor) + 1 : this.actors.length + 1 + this.world.seatedActors().indexOf(actor);
        input.length = 0; input.push(tick, this.divisor / 60, command, binding.entity, token, binding.kind === 'server' ? 0 : 1);
        this.world.appendInput(binding.entity, input); return input;
      }, committed: () => undefined };
  }
  /** Role state only; the composed host snapshots module memory, events and quotas exactly once. */
  snapshot(): string { return JSON.stringify({ contract: this.contract, world: this.world.checkpoint() }); }
  /** Restore typed shared/player data without invoking scripts or resetting their host. */
  restore(text: string): void {
    const saved = v.parse(v.strictObject({ contract: v.string(), world: checkpointSchema.entries.world }), JSON.parse(text));
    if (saved.contract !== this.contract) throw new Error('Incompatible script lane snapshot'); this.world.restoreState(saved.world);
  }
}
/** Standalone numeric lane; composed levels use ScriptDriver under their single ScriptComposition host. */
export class ScriptLane {
  readonly host: ScriptHost;
  readonly world: DeclaredScriptWorld;
  readonly divisor: number;
  private readonly driver: ScriptDriver;
  private readonly schedule: ScriptSchedule;
  private commands: ReadonlyMap<string, number> = NO_COMMANDS;
  private readonly marks = { host: -1, world: -1, revision: 0 };
  constructor(options: ScriptLaneOptions) {
    this.driver = new ScriptDriver(options); this.world = this.driver.world; this.divisor = this.driver.divisor;
    this.schedule = this.driver.schedule('numeric', 'numeric', () => this.commands); this.host = new ScriptHost(options);
    for (const module of options.modules) this.host.install(module.name, module.bytes, module.seedLo, module.seedHi);
  }
  /** Stable fixed-tick input: tick, dt, actor command, entity, actor token, role, state counts, state values. */
  step(tick: number, commands: ReadonlyMap<string, number> = NO_COMMANDS): readonly ScriptCall[] {
    return this.advance(tick, commands, true);
  }
  /** Execute every due authoritative binding without constructing unused call
   * results. State, events, failure handling and all host limits are unchanged. */
  stepWithoutResults(tick: number, commands: ReadonlyMap<string, number> = NO_COMMANDS): void {
    this.advance(tick, commands, false);
  }
  private advance(tick: number, commands: ReadonlyMap<string, number>, retain: true): readonly ScriptCall[];
  private advance(tick: number, commands: ReadonlyMap<string, number>, retain: false): void;
  private advance(tick: number, commands: ReadonlyMap<string, number>, retain: boolean): readonly ScriptCall[] | void {
    if (!Number.isSafeInteger(tick) || tick < 0) throw new Error('Invalid script lane tick');
    if (tick % this.divisor !== 0) return retain ? [] : undefined;
    this.commands = commands;
    const pending = this.host.beginTick(tick), calls: ScriptCall[] | undefined = retain ? [] : undefined;
    const run = (binding: ScriptSchedule['bindings'][number]): void => {
      const input = this.schedule.input(binding, tick); if (input === undefined) throw new Error('Missing numeric script input');
      const events = pending.length === 0 ? NO_EVENT_ROWS : pending.flatMap(event => event.target === binding.entity ? [event.type, event.target, event.value, 0, 0, 0] : []);
      if (calls === undefined) this.host.callWithoutResult(binding.module, binding.entity, input, events);
      else calls.push(this.host.call(binding.module, binding.entity, input, events));
    };
    for (const binding of this.schedule.bindings) run(binding);
    const seated = this.schedule.seated?.();
    if (seated !== undefined) for (const binding of seated) run(binding);
    return calls;
  }
  /** Schedule a declared scene/gameplay event for the next tick; conditions read the resulting declared fields. */
  enqueue(event: ScriptEvent): void { this.host.enqueue(event); }
  seat(world: DeclaredScriptWorld, actorId: string, entities: readonly ScriptEntity[], content: readonly number[]): void { world.seat(actorId, entities, content); }
  unseat(world: DeclaredScriptWorld, actorId: string): void { this.host.forget(world.unseat(actorId)); }
  seatWorlds(): readonly DeclaredScriptWorld[] { return [this.world]; }
  /** Advances when the snapshot's world, module state, budgets, pending events or failure history changed since the
   * previous call; the tick alone never advances it. */
  stateRevision(): number {
    const host = this.host.stateRevision(), world = this.world.contentRevision, marks = this.marks;
    if (host !== marks.host || world !== marks.world) { marks.host = host; marks.world = world; marks.revision++; }
    return marks.revision;
  }
  /** JSON snapshot includes all world state, complete module state, budgets, pending events and failure history. */
  snapshot(): string { return `{"version":0,"contract":${JSON.stringify(this.driver.contract)},"world":${JSON.stringify(this.world.checkpoint())},"host":${this.host.checkpointText()}}`; }
  /** Restores a matching installed lane, without invoking author initialization. */
  restore(text: string): void {
    const raw: unknown = JSON.parse(text), saved = v.parse(checkpointSchema, raw), previousWorld = this.world.checkpoint();
    if (saved.contract !== this.driver.contract) throw new Error('Incompatible script lane snapshot');
    this.world.restoreState(saved.world);
    try { this.host.restoreState(saved.host); } catch (error) { this.world.restoreState(previousWorld); throw error; }
  }
}
/** Install fixed-step work and a same-engine continuation adapter, scoped to the real headless/client sim host. */
export function installScriptLane(sim: Pick<SimHost, 'onStep' | 'state'>, id: string, lane: ScriptLanePort, commands: () => ReadonlyMap<string, number> = () => NO_COMMANDS): () => void {
  return sim.onStep(id, () => {
    const step = lane.stepWithoutResults;
    if (step === undefined) lane.step(sim.state.tick, commands());
    else step.call(lane, sim.state.tick, commands());
  }, { snapshot: () => lane.snapshot(), restore: (value) => {
    if (typeof value !== 'string') throw new Error('Invalid script adapter snapshot'); lane.restore(value);
  } });
}
