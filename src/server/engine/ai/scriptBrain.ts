import * as v from 'valibot';
import type { AnimalSim } from '../../../shared/engine/entities/AnimalSim';
import type { ScriptQuery, ScriptCall } from '../../../shared/engine/script/host';
import { SCRIPT_PARAMETER_QUERY } from '@wildshard/format/scriptAbi';
import { ScriptWorld, SCRIPT_OP, type ScriptEffect, type EffectTransaction } from '../../../shared/engine/script/effects';
import type { ScriptModule } from '../script/lane';
import type { ScriptRole, ScriptSchedule, ScheduledScriptBinding } from '../script/composition';

/** Numeric motion intentions; the guest cannot write positions, spawn actors or deal damage. */
export const BRAIN_FIELD: Readonly<{ yaw: 1; speed: 2; strafe: 3; turnRate: 4; }> = Object.freeze({ yaw: 1, speed: 2, strafe: 3, turnRate: 4 });
/** One trusted actor binding, with admitted motion bounds and a finite catalogue of strike requests. */
export interface ScriptBrainBinding {
  module: string; entity: number; actorId: string; maxSpeed: number; maxStrafe: number; maxTurnRate: number;
  parameters: readonly number[]; strikes: readonly { event: number; strike: string }[];
}
/** Read-only observations and authoritative strike execution are supplied by the owning simulation. */
export interface ScriptBrainPorts {
  observe: (actor: AnimalSim) => readonly number[];
  mayAttack: (actor: AnimalSim) => boolean;
  strike: (actor: AnimalSim, strike: string) => void;
}
/** Each lane shares the engine's per-tick module, fuel, query, effect and memory allowances. */
export interface ScriptBrainOptions {
  modules: readonly ScriptModule[]; bindings: readonly ScriptBrainBinding[]; actors: ReadonlyMap<string, AnimalSim>;
  divisor: number; query: ScriptQuery; ports: ScriptBrainPorts;
}
const finite = v.pipe(v.number(), v.finite());
const id = v.pipe(finite, v.integer(), v.minValue(1), v.maxValue(0x7fffffff));
const key = v.pipe(v.string(), v.minLength(1), v.maxLength(128));
const bindingSchema = v.strictObject({ module: key, entity: id, actorId: key,
  maxSpeed: v.pipe(finite, v.minValue(0), v.maxValue(15)), maxStrafe: v.pipe(finite, v.minValue(0), v.maxValue(15)),
  maxTurnRate: v.pipe(finite, v.minValue(0), v.maxValue(30)),
  parameters: v.pipe(v.array(finite), v.maxLength(64)),
  strikes: v.pipe(v.array(v.strictObject({ event: id, strike: key })), v.maxLength(32)),
});
const worldSchema = v.pipe(v.array(v.strictObject({ id, name: key, position: v.tuple([finite, finite, finite]),
  fields: v.record(v.string(), finite), frozen: v.boolean(), interactive: v.boolean() })), v.maxLength(128));

class BrainWorld extends ScriptWorld {
  private readonly bindings: ReadonlyMap<number, ScriptBrainBinding>;
  constructor(bindings: readonly ScriptBrainBinding[]) {
    super({ fields: { 1: [-Math.PI, Math.PI], 2: [-15, 15], 3: [-15, 15], 4: [0, 30] }, archetypes: [],
      events: [...new Set(bindings.flatMap(b => b.strikes.map(s => s.event)))], maxEntities: Math.max(1, bindings.length) },
    bindings.map(b => ({ id: b.entity, name: b.actorId, position: [0, 0, 0], fields: { 1: 0, 2: 0, 3: 0, 4: 0 }, frozen: false, interactive: true })));
    this.bindings = new Map(bindings.map(b => [b.entity, b]));
  }
  override prepare(effects: readonly ScriptEffect[], self: number, spawns: number, events: number): EffectTransaction {
    const binding = this.bindings.get(self);
    if (binding === undefined) throw new Error('Unknown brain actor');
    const seen = new Set<number>(); let strike = false;
    for (const effect of effects) {
      if (effect.op === SCRIPT_OP.field) {
        if (seen.has(effect.a) || (effect.a === BRAIN_FIELD.speed && Math.abs(effect.b) > binding.maxSpeed)
          || (effect.a === BRAIN_FIELD.strafe && Math.abs(effect.b) > binding.maxStrafe)
          || (effect.a === BRAIN_FIELD.turnRate && effect.b > binding.maxTurnRate)) throw new Error('Brain motion outside declared bounds');
        seen.add(effect.a);
      } else if (effect.op === SCRIPT_OP.event) {
        if (strike || effect.b !== self || effect.c !== 0 || !binding.strikes.some(s => s.event === effect.a)) throw new Error('Undeclared brain strike');
        strike = true;
      } else throw new Error('Brains request motion and strikes only');
    }
    return super.prepare(effects, self, spawns, events);
  }
  override restore(entities: Parameters<ScriptWorld['restore']>[0]): void {
    for (const entity of entities) {
      const binding = this.bindings.get(entity.id);
      if (binding === undefined || entity.name !== binding.actorId || entity.position.some(n => n !== 0)
        || Object.keys(entity.fields).length !== 4 || Object.keys(entity.fields).some(k => !['1', '2', '3', '4'].includes(k))
        || Math.abs(entity.fields[2] ?? Infinity) > binding.maxSpeed || Math.abs(entity.fields[3] ?? Infinity) > binding.maxStrafe
        || (entity.fields[4] ?? Infinity) > binding.maxTurnRate) throw new Error('Invalid restored brain intent');
    }
    super.restore(entities);
  }
}

/** Role-specific brain driver; it never installs modules or starts a host tick. */
export class ScriptBrainDriver {
  readonly world: ScriptWorld;
  readonly query: ScriptQuery;
  readonly contract: string;
  private readonly bindings: readonly ScriptBrainBinding[];
  private readonly actors: ReadonlyMap<string, AnimalSim>;
  private readonly ports: ScriptBrainPorts;
  private readonly divisors: ReadonlyMap<number, number>;
  constructor(options: ScriptBrainOptions, cadences: ReadonlyMap<number, number> = new Map()) {
    if (!Number.isInteger(options.divisor) || options.divisor < 1 || 60 % options.divisor !== 0) throw new Error('Brain divisor divides 60');
    this.actors = new Map(options.actors); this.ports = options.ports;
    this.bindings = v.parse(v.pipe(v.array(bindingSchema), v.maxLength(128)), options.bindings).sort((a, b) => a.entity - b.entity);
    if (new Set(this.bindings.map(b => b.entity)).size !== this.bindings.length || new Set(this.bindings.map(b => b.actorId)).size !== this.bindings.length
      || this.bindings.some(b => this.actors.get(b.actorId)?.entityId !== b.actorId || !options.modules.some(m => m.name === b.module)
        || new Set(b.strikes.map(s => s.event)).size !== b.strikes.length)) throw new Error('Invalid trusted brain bindings');
    if ([...cadences].some(([entity, divisor]) => !this.bindings.some(b => b.entity === entity) || !Number.isInteger(divisor) || divisor < 1 || 60 % divisor !== 0)) throw new Error('Invalid brain binding cadence');
    this.divisors = new Map(this.bindings.map(b => [b.entity, cadences.get(b.entity) ?? options.divisor]));
    const bindings = new Map(this.bindings.map(b => [b.entity, b]));
    this.world = new BrainWorld(this.bindings);
    this.query = (kind, input, self) => {
      if (kind !== SCRIPT_PARAMETER_QUERY) return options.query(kind, input, self);
      const binding = bindings.get(self);
      if (binding === undefined || input.length !== 8 || input.some(n => n !== 0)) throw new Error('Brain parameters require trusted self');
      return [...binding.parameters];
    };
    this.contract = JSON.stringify({ divisors: [...this.divisors], bindings: this.bindings,
      modules: options.modules.map(m => ({ ...m, bytes: Array.from(m.bytes) })).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0) });
  }
  /** Trusted entity roles select brain-only effect validation, never a general numeric-state translator. */
  role(roleId: string): ScriptRole { return { id: roleId, moduleContract: true, world: this.world, query: this.query, events: 'consume', snapshot: () => this.snapshot(), restore: saved => { this.restore(saved); } }; }
  /** Independent per-actor decisions submit to a composed host without resetting any allowance. */
  schedule(scheduleId: string, role: string): ScriptSchedule {
    return { id: scheduleId, role, bindings: this.bindings.map(binding => ({ module: binding.module, entity: binding.entity, divisor: this.divisors.get(binding.entity) ?? 1 })),
      input: (binding, tick) => this.input(binding, tick), committed: (binding, result) => { this.committed(binding, result); } };
  }
  private input(scheduled: ScheduledScriptBinding, tick: number): readonly number[] | undefined {
    const binding = this.bindings.find(b => b.entity === scheduled.entity && b.module === scheduled.module);
    const actor = binding === undefined ? undefined : this.actors.get(binding.actorId);
    if (actor === undefined) throw new Error('Missing trusted brain actor');
    if (!actor.alive) return undefined;
    const values = [...this.ports.observe(actor)];
    if (values.length > 16 || !values.every(Number.isFinite)) throw new Error('Invalid brain observations');
    return [tick, scheduled.divisor / 60, 0, scheduled.entity, actor.position.x, actor.position.y, actor.position.z,
      actor.yaw, Number.isFinite(actor.lastHitT) ? actor.lastHitT : -1, actor.attackPhase, ...values];
  }
  private committed(scheduled: ScheduledScriptBinding, call: ScriptCall): void {
    const binding = this.bindings.find(b => b.entity === scheduled.entity && b.module === scheduled.module);
    const actor = binding === undefined ? undefined : this.actors.get(binding.actorId);
    if (binding === undefined || actor === undefined) throw new Error('Missing trusted brain actor');
    const state = this.world.entity(binding.entity);
    if (!call.ok || state === undefined) { actor.setMotion(actor.yaw, 0, 0); actor.setStrafe(0); return; }
    actor.setMotion(state.fields[1] ?? 0, state.fields[2] ?? 0, state.fields[4] ?? 0); actor.setStrafe(state.fields[3] ?? 0);
    for (const event of call.events) {
      const strike = binding.strikes.find(s => s.event === event.type);
      if (strike !== undefined && actor.attackPhase < 0 && this.ports.mayAttack(actor)) this.ports.strike(actor, strike.strike);
    }
  }
  /** Role continuation fences actor identity, cadence and tuning; the owning composition snapshots module state once. */
  checkpoint(): { contract: string; world: ReturnType<ScriptWorld['state']> } { return { contract: this.contract, world: this.world.state() }; }
  /** JSON role snapshot with no duplicate host or module checkpoint. */
  snapshot(): string { return JSON.stringify(this.checkpoint()); }
  /** Validate the complete role before restoring it, without executing decisions, motion or strikes. */
  restore(text: string): void {
    const raw: unknown = JSON.parse(text);
    if (typeof raw !== 'object' || raw === null || !('contract' in raw) || !('world' in raw) || raw.contract !== this.contract) throw new Error('Incompatible brain continuation');
    const world = v.parse(worldSchema, raw.world);
    if (world.length !== this.bindings.length || world.some(e => !this.bindings.some(b => b.entity === e.id && b.actorId === e.name))
      || new Set(world.map(e => e.id)).size !== world.length) throw new Error('Invalid restored brain identity');
    this.world.restore(world);
  }
}
