import * as v from 'valibot';
import { MoverMechanic, type NativeMoverMotion } from '../../../shared/engine/sim/moverMotion';
import { ScriptWorld, SCRIPT_OP, type ScriptEntity, type ScriptEffect, type EffectTransaction } from '../../../shared/engine/script/effects';
import { ScriptHost, type ScriptHostOptions, type ScriptCall } from '../../../shared/engine/script/host';
import type { ScriptModule } from './lane';

/** A trusted role owns its entity handles, effect validation, query provenance and complete world continuation. */
export interface ScriptRole {
  moduleContract?: true;
  id: string; world: ScriptWorld; query: ScriptHostOptions['query']; events: 'deliver' | 'consume';
  snapshot: () => string; restore: (saved: string) => void;
}
/** Per-binding cadence shares the single host's global fixed-tick allowances. */
export interface ScheduledScriptBinding { module: string; entity: number; divisor: number; motion?: NativeMoverMotion }
/** Input is prepared before the tick starts; committed requests are handled only after successful validation. */
export interface ScriptSchedule {
  id: string; role: string; bindings: readonly ScheduledScriptBinding[];
  input: (binding: ScheduledScriptBinding, tick: number) => readonly number[] | undefined;
  committed: (binding: ScheduledScriptBinding, result: ScriptCall) => void;
  /** Rows that come and go with a room's players, run after `bindings`. */
  seated?: () => readonly ScheduledScriptBinding[];
}
/** Exactly one level-wide host installs the union of admitted modules once. */
export interface ScriptCompositionOptions extends Omit<ScriptHostOptions, 'world' | 'query'> {
  modules: readonly ScriptModule[]; roles: readonly ScriptRole[]; schedules: readonly ScriptSchedule[]; maxEntities: number;
  /** Dedicated consuming-role modules restart from admitted initialization on a fresh load; their memory is never saved. */
  transientModules?: readonly string[];
  /** Verified native rows identify obsolete guest continuations without retaining their bytes. */
  nativeMotions?: readonly NativeMoverMotion[];
}
class RoleWorld extends ScriptWorld {
  private readonly roles: readonly ScriptRole[];
  private readonly maximum: number;
  private ownership: ReadonlyMap<number, ScriptRole> = new Map();
  constructor(roles: readonly ScriptRole[], maximum: number) {
    super({ fields: {}, events: [], archetypes: [], maxEntities: maximum }, []);
    this.roles = roles; this.maximum = maximum; this.refresh();
  }
  private owners(): ReadonlyMap<number, ScriptRole> {
    const owners = new Map<number, ScriptRole>();
    for (const role of this.roles) for (const entity of role.world.state()) {
      if (owners.has(entity.id)) throw new Error('Overlapping script roles'); owners.set(entity.id, role);
    }
    if (owners.size > this.maximum + this.seated) throw new Error('Aggregate script entity allowance');
    return owners;
  }
  override get seated(): number { return this.roles.reduce((sum, role) => sum + role.world.seated, 0); }
  refresh(): void { this.ownership = this.owners(); }
  role(entity: number): ScriptRole | undefined { return this.ownership.get(entity); }
  override entity(entity: number): ScriptEntity | undefined { return this.role(entity)?.world.entity(entity); }
  override callable(entity: number): boolean { return this.role(entity)?.world.callable(entity) ?? false; }
  /** Ownership comes only from the entity's declared role, never another role's actor aliases. */
  override actor(entity: number): string | undefined { return this.role(entity)?.world.actor(entity); }
  override contentHandle(entity: number): number { return this.role(entity)?.world.contentHandle(entity) ?? entity; }
  override state(): readonly ScriptEntity[] { return this.roles.flatMap(role => role.world.state()).sort((a, b) => a.id - b.id); }
  override freeze(entity: number, frozen: boolean): void { this.role(entity)?.world.freeze(entity, frozen); }
  override restore(_entities: readonly ScriptEntity[]): void { throw new Error('Restore complete composed role continuations'); }
  override prepare(effects: readonly ScriptEffect[], self: number, spawns: number, events: number): EffectTransaction {
    const owners = this.ownership, role = owners.get(self);
    if (role === undefined) throw new Error('Unknown script role');
    for (const effect of effects) if (effect.op === SCRIPT_OP.event && owners.has(effect.b) && owners.get(effect.b) !== role) throw new Error('Cross-role script event');
    const tx = role.world.prepare(effects, self, spawns, events);
    // ScriptWorld allocates consecutive handles after its greatest retained entity handle.
    let spawned: Set<number> | undefined;
    if (tx.spawns > 0) {
      const next = Math.max(0, ...role.world.state().map(entity => entity.id)) + 1;
      spawned = new Set(Array.from({ length: tx.spawns }, (_unused, i) => next + i));
      if (owners.size + tx.spawns > this.maximum + this.seated || [...spawned].some(id => owners.has(id))) throw new Error('Aggregate script spawn identity/allowance');
    }
    for (const effect of effects) if (effect.op === SCRIPT_OP.event && owners.get(effect.b) !== role && spawned?.has(effect.b) !== true) throw new Error('Cross-role script event');
    return { spawns: tx.spawns, events: tx.events, commit: () => { tx.commit(); if (tx.spawns > 0) this.refresh(); } };
  }
}
const finite = v.pipe(v.number(), v.finite());
const natural = v.pipe(finite, v.integer(), v.minValue(0));
const savedSchema = v.strictObject({ contract: v.string(), roles: v.array(v.strictObject({ id: v.string(), state: v.string() })),
  host: v.strictObject({ tick: v.pipe(finite, v.integer(), v.minValue(-1)), used: v.strictObject({ effects: natural, spawns: natural, events: natural, queries: natural, fuel: natural }),
    pending: v.array(v.strictObject({ type: natural, target: natural, value: finite })), modules: v.array(v.strictObject({ name: v.string(), memory: v.array(natural), globals: v.array(v.strictObject({ name: v.string(), type: v.picklist(['number', 'bigint']), value: v.string() })), failures: natural, disabled: v.boolean() })) }) });

/** Role-specific worlds share module memory, quarantine, fuel, effects, events and queries under one host. */
export class ScriptComposition {
  readonly host: ScriptHost;
  private readonly world: RoleWorld;
  private readonly roles: readonly ScriptRole[];
  private readonly schedules: readonly ScriptSchedule[];
  private readonly contract: string;
  private readonly transientModules: ReadonlySet<string>;
  private readonly mechanics = new Map<string, MoverMechanic>();
  private readonly retiredModules: ReadonlySet<string>;
  constructor(options: ScriptCompositionOptions) {
    if (options.roles.length > 128 || options.schedules.length > 10000 || new Set(options.roles.map(role => role.id)).size !== options.roles.length
      || new Set(options.roles.map(role => role.world)).size !== options.roles.length || options.roles.some(role => role.id.length === 0)) throw new Error('Invalid script role identities');
    this.roles = options.roles.map(role => ({ ...role })).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    this.world = new RoleWorld(this.roles, options.maxEntities);
    const modules = new Set(options.modules.map(module => module.name)), keys = new Set<string>();
    if ((options.nativeMotions?.length ?? 0) > 32) throw new Error('Native mover allowance');
    const nativeModules = new Set((options.nativeMotions ?? []).map(row => new MoverMechanic(row).module));
    if (new Set(options.schedules.map(schedule => schedule.id)).size !== options.schedules.length) throw new Error('Duplicate script scheduler');
    this.schedules = options.schedules.map(schedule => ({ ...schedule, bindings: schedule.bindings.map(binding => ({ ...binding }))
      .sort((a, b) => a.entity - b.entity || (a.module < b.module ? -1 : a.module > b.module ? 1 : 0)) }))
      .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    for (const schedule of this.schedules) for (const binding of schedule.bindings) {
      const key = `${binding.module}:${binding.entity}`;
      if (keys.has(key) || (binding.motion === undefined && !modules.has(binding.module)) || this.world.role(binding.entity)?.id !== schedule.role
        || !Number.isInteger(binding.divisor) || binding.divisor < 1 || 60 % binding.divisor !== 0) throw new Error('Invalid composed script binding');
      keys.add(key);
      if (binding.motion !== undefined) {
        const mechanic = new MoverMechanic(binding.motion);
        if (mechanic.module !== binding.module) throw new Error('Native mover identity drift');
        this.mechanics.set(key, mechanic); nativeModules.add(binding.module);
      }
      if (keys.size > 10000) throw new Error('Script binding count allowance');
    }
    this.retiredModules = new Set([...nativeModules].filter((name): name is string => name !== undefined && !modules.has(name)));
    const transient = options.transientModules ?? [];
    if (new Set(transient).size !== transient.length) throw new Error('Duplicate transient script module');
    this.transientModules = new Set(transient);
    for (const name of transient) {
      const owners = new Set(this.schedules.filter(schedule => schedule.bindings.some(binding => binding.module === name)).map(schedule => schedule.role));
      if (!modules.has(name) || owners.size !== 1 || !this.roles.some(role => owners.has(role.id) && role.events === 'consume')) throw new Error('Transient module requires one consuming role');
    }
    this.host = new ScriptHost({ ...options, world: this.world, query: (kind, input, entity) => {
      const role = this.world.role(entity); if (role === undefined) throw new Error('Unknown query role'); return role.query(kind, input, entity);
    } });
    for (const module of [...options.modules].sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) this.host.install(module.name, module.bytes, module.seedLo, module.seedHi);
    this.contract = JSON.stringify({ roles: this.roles.map(role => ({ id: role.id, events: role.events })),
      schedules: this.schedules.map(schedule => ({ id: schedule.id, role: schedule.role, bindings: schedule.bindings.map(({ motion: _motion, ...binding }) => binding) })),
      modules: options.modules.map(module => ({ ...module, bytes: Array.from(module.bytes) })).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
      maxEntities: options.maxEntities, limits: this.host.limits,
      ...(transient.length === 0 ? {} : { transientModules: [...transient].sort() }) });
  }
  /** One strictly later global fixed tick; independent cadences never reset any per-level allowance. */
  step(tick: number): readonly ScriptCall[] {
    if (!Number.isSafeInteger(tick) || tick < 0 || tick <= this.host.currentTick) throw new Error('Invalid composed script tick');
    const due: { schedule: ScriptSchedule; binding: ScheduledScriptBinding; input: readonly number[] }[] = [];
    const targets = new Set<number>(), consume = new Set<number>();
    for (const role of this.roles) if (role.events === 'consume') for (const entity of role.world.state()) consume.add(entity.id);
    const collect = (schedule: ScriptSchedule, binding: ScheduledScriptBinding): void => {
      if (tick % binding.divisor !== 0) return;
      const input = schedule.input(binding, tick); if (input === undefined) return;
      if (input.length > 32 || input[0] !== tick || !input.every(Number.isFinite)) throw new Error('Invalid composed script input');
      due.push({ schedule, binding, input: [...input] });
      if (!consume.has(binding.entity)) targets.add(binding.entity);
    };
    for (const schedule of this.schedules) {
      for (const binding of schedule.bindings) collect(schedule, binding);
      const seated = schedule.seated?.();
      if (seated !== undefined) for (const binding of seated) collect(schedule, binding);
    }
    const pending = this.host.beginTick(tick, { targets, consume }), calls: ScriptCall[] = [];
    for (const { schedule, binding, input } of due) {
      const events = pending.flatMap(event => event.target === binding.entity ? [event.type, event.target, event.value, 0, 0, 0] : []);
      const mechanic = this.mechanics.get(`${binding.module}:${binding.entity}`);
      let call: ScriptCall;
      if (mechanic === undefined) call = this.host.call(binding.module, binding.entity, input, events);
      else {
        const entity = this.world.entity(binding.entity); if (entity === undefined) throw new Error('Missing native mover entity');
        const next = mechanic.step(entity, { tick, dt: input[1] ?? 0, action: input[2] ?? 0, permission: input[4] ?? 0 });
        this.world.prepare(next.effects, binding.entity, 0, 0).commit();
        call = { ok: true, effects: next.effects, events: [], fuel: 0, reason: undefined, disabled: false };
      }
      calls.push(call); schedule.committed(binding, call);
    }
    return calls;
  }
  /** A role's world seated or lost a player: who owns which handle changed. */
  seatsChanged(left: readonly number[] = []): void { this.world.refresh(); this.host.forget(left); }
  /** Queue through the role validator; retained and newly queued events share the same global ceiling. */
  enqueue(event: Parameters<ScriptHost['enqueue']>[0]): void {
    if (this.world.role(event.target)?.events !== 'deliver') throw new Error('Script role does not accept queued input'); this.host.enqueue(event);
  }
  /** Complete role state and the one authoritative host continuation, including sleeping bindings' pending events. */
  snapshot(): string {
    const host = this.host.checkpoint();
    return JSON.stringify({ contract: this.contract, roles: this.roles.map(role => ({ id: role.id, state: role.snapshot() })),
      host: { ...host, modules: host.modules.filter(module => !this.transientModules.has(module.name)) } });
  }
  /** Remove only module inventories named by verified native rows. Every other contract byte stays fenced. */
  private migratedContract(text: string): string {
    if (this.retiredModules.size === 0) return text;
    const value = v.parse(v.record(v.string(), v.unknown()), JSON.parse(text));
    const modules = v.parse(v.array(v.record(v.string(), v.unknown())), value['modules']);
    value['modules'] = modules.filter(row => !this.retiredModules.has(v.parse(v.string(), row['name'])));
    if (value['transientModules'] !== undefined) {
      const names = v.parse(v.array(v.string()), value['transientModules']).filter(name => !this.retiredModules.has(name));
      if (names.length === 0) delete value['transientModules']; else value['transientModules'] = names;
    }
    return JSON.stringify(value);
  }
  private migratedRole(text: string): string {
    const value = v.parse(v.record(v.string(), v.unknown()), JSON.parse(text));
    value['contract'] = this.migratedContract(v.parse(v.string(), value['contract']));
    return JSON.stringify(value);
  }
  /** Restore all roles atomically; no input, committed request, author initialization or decision is executed. */
  restore(text: string): void {
    const saved = v.parse(savedSchema, JSON.parse(text));
    if (this.migratedContract(saved.contract) !== this.contract || saved.roles.length !== this.roles.length || new Set(saved.roles.map(role => role.id)).size !== saved.roles.length
      || saved.roles.some(role => !this.roles.some(current => current.id === role.id))) throw new Error('Incompatible composed continuation');
    if (this.transientModules.size > 0 && this.host.currentTick !== -1) throw new Error('Transient continuation requires a fresh admitted host');
    const savedModules = saved.host.modules.filter(module => !this.retiredModules.has(module.name));
    const previous = this.roles.map(role => ({ role, state: role.snapshot() })), host = this.host.checkpoint();
    const persistent = host.modules.filter(module => !this.transientModules.has(module.name));
    if (savedModules.length !== persistent.length || new Set(savedModules.map(module => module.name)).size !== persistent.length
      || savedModules.some(module => !persistent.some(current => current.name === module.name))) throw new Error('Incompatible composed module continuation');
    // Use the fresh host's initialized memories transiently, never retain another guest memory pool.
    const continuation = { ...saved.host, modules: [...savedModules, ...host.modules.filter(module => this.transientModules.has(module.name))] };
    try {
      for (const entry of saved.roles) {
        const role = this.roles.find(current => current.id === entry.id);
        role?.restore(role.moduleContract === true && this.retiredModules.size > 0 ? this.migratedRole(entry.state) : entry.state);
      }
      this.world.refresh();
      for (const schedule of this.schedules) for (const binding of schedule.bindings) if (this.world.role(binding.entity)?.id !== schedule.role) throw new Error('Restored script role binding drift');
      for (const event of saved.host.pending) this.world.prepare([{ op: SCRIPT_OP.event, a: event.type, b: event.target, c: event.value, d: 0 }], event.target, 0, 1);
      this.host.restoreState(continuation);
    } catch (error) { for (const entry of previous) entry.role.restore(entry.state); this.world.refresh(); this.host.restoreState(host); throw error; }
  }
}
