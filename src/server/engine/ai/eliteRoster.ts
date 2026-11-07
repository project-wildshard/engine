import * as v from 'valibot';
import { isJsonData } from '@wildshard/format/json';
import { HandleIdSchema } from '@wildshard/format/sceneRefs';
import { EliteContinuationRowsSchema, EliteCoreContinuationSchema } from '@wildshard/format/eliteContinuation';
import type { Scope } from '../../../shared/engine/app/scope';
import type { AnimalSim } from '../../../shared/engine/entities/AnimalSim';
import type { SimHost } from '../sim';
import { NativeEliteKernels, type NativeEliteKernelLoans } from './eliteKernels';
import { NativeEliteLifecycle, type NativeElitePopulation } from './eliteLifecycle';
import { GrazerBrain } from './grazer';
import { NativeEliteContinuation, type EliteContinuationCore, type EliteContinuationGroups, type EliteContinuationMember } from './eliteContinuation';
import { nearestOnGround } from '../../../shared/engine/sim/nearPlayer';
import { eliteNetView, publishEncounter } from '../../../shared/engine/sim/encounterRows';
import { eliteLaneWord, sayFightView } from '../../../shared/engine/sim/shardRows';

const finite = v.pipe(v.number(), v.finite());
const projectionRows = v.strictObject({ signal: v.pipe(v.string(), v.minLength(1), v.maxLength(128)),
  states: v.pipe(v.record(v.string(), finite), v.maxEntries(16)),
  bondedState: v.string(), brokenState: v.exactOptional(v.string()),
  adoption: v.exactOptional(v.strictObject({ variant: v.string(), scale: v.pipe(finite, v.minValue(.000001)) })) });
const point = v.tuple([finite, finite, finite]);
const projectionSaved: v.GenericSchema<BoundedEliteProjectionInput, BoundedEliteProjection> = v.strictObject({ laneT: finite, runT: finite, lastState: v.string(), elapsed: v.optional(finite, 0), laneFrom: point, laneTo: point });
/** The original admitted numeric programme, lent without an alternate module or clock. */
export interface NativeEliteProgram {
  readonly project: (signal: string, fields: Readonly<Record<string, number>>) => Readonly<Record<string, number>>;
}
/** Original bond authority, bound after native services have been constructed. */
export interface NativeEliteBond { readonly scope: Scope; readonly phase: string; readonly companion: AnimalSim | null }
/** Concrete observations at the existing controller's sampling slot. */
export interface NativeEliteFrame {
  state: string; phase2: boolean; engaged: boolean; bonded: boolean; same: boolean; health: number;
  at: readonly [number, number, number]; player: readonly [number, number, number];
}
/** The borrowed controller keeps its historical raw state string and ten-Hz
 * continuation. Every decision still comes from its original admitted guest. */
export class NativeEliteProjection {
  private readonly rows; private readonly project; private readonly program: NativeEliteProgram; private readonly scope: Scope; private state: v.InferOutput<typeof projectionSaved> = { laneT: 0, runT: 0, lastState: '', elapsed: 0, laneFrom: [0,0,0], laneTo: [0,0,0] };
  private readonly effects = { signature: false, lead: false, adopt: false };
  constructor(input: unknown, program: NativeEliteProgram, scope: Scope) {
    this.program = program; this.scope = scope;
    if (!isJsonData(input)) throw new Error('Elite projection requires plain JSON');
    this.rows = v.parse(projectionRows, input); this.project = program.project; this.live();
  }
  private live(): void {
    if (this.scope.disposed || this.scope.disposing || typeof this.project !== 'function' || this.program.project !== this.project) throw new Error('Retired or replaced elite projection');
  }
  advance(dt: number, frame: NativeEliteFrame): Readonly<{ signature: boolean; lead: boolean; adopt: boolean }> {
    this.live(); const state = this.state, effects = this.effects; effects.signature = false; effects.lead = false; effects.adopt = false;
    state.elapsed += dt; if (state.elapsed + 1e-9 < .1) return effects;
    const result = this.program.project(this.rows.signal, { dt: state.elapsed, state: this.rows.states[frame.state] ?? 0, previousState: this.rows.states[state.lastState] ?? 0,
      laneT: state.laneT, runT: state.runT, phase2: Number(frame.phase2), engaged: Number(frame.engaged), bonded: Number(frame.bonded), same: Number(frame.same), health: frame.health });
    this.live(); state.elapsed = 0; state.lastState = frame.state; state.laneT = result['laneT'] ?? state.laneT; state.runT = result['runT'] ?? state.runT;
    if (result['capture'] === 1) { state.laneFrom = [...frame.at]; state.laneTo = [...frame.player]; }
    effects.signature = result['signature'] === 1; effects.lead = result['lead'] === 1; effects.adopt = result['adopt'] === 1; return effects;
  }
  /** The charge lane a page draws, as `behaviour/eliteViews.as` does: from its start to 3 m short of its target, 3 m wide, fading in over half a second. */
  lane(): readonly [number, number, number, number, number, number] | null {
    const { laneT, laneFrom: [x, , z], laneTo: [toX, , toZ] } = this.state;
    if (laneT <= 0) return null;
    const dx = toX - x, dz = toZ - z, distance = Math.hypot(dx, dz) || 1, k = Math.max(0, distance - 3) / distance;
    return [x, z, x + dx * k, z + dz * k, 3, 0.55 * Math.min(1, laneT * 2)];
  }
  snapshot(): v.InferOutput<typeof projectionSaved> { this.live(); return structuredClone(this.state); }
  prepareRestore(input: unknown): () => void { this.live(); const state = v.parse(projectionSaved, input); return () => { this.live(); this.state = state; }; }
  restore(input: unknown): void { this.prepareRestore(input)(); }
}
const definition: v.GenericSchema<BoundedEliteDefinitionInput, BoundedEliteDefinition> = v.object({ id: HandleIdSchema, lair: v.object({ x: finite, z: finite, r: finite }),
  awareR: finite, engageR: finite, leashR: finite, rule: v.picklist(['always', 'dusk', 'night', 'storm']), respawnMin: finite, drop: v.optional(v.object({ skin: v.nullable(v.string()) })) });
const rowSchema = v.object({ ...EliteContinuationRowsSchema.entries.rows.item.entries, def: definition });
const rowsSchema: v.GenericSchema<BoundedEliteRosterInput, BoundedEliteRoster> = v.strictObject({ step: HandleIdSchema, version: finite, wire: EliteContinuationRowsSchema.entries.wire,
  rows: v.pipe(v.array(rowSchema), v.minLength(1), v.maxLength(64)), roles: v.array(v.picklist(['native', 'borrowed'])), kernels: v.unknown(), projections: v.exactOptional(v.record(HandleIdSchema, projectionRows)) });
type Definition = v.InferOutput<typeof definition>;
type ReadonlyRows<T> = T extends object ? { readonly [K in keyof T]: ReadonlyRows<T[K]> } : T;
/** Canonical admitted native roster declaration; reused by compiled lenders. */
export type NativeEliteRosterRows = ReadonlyRows<v.InferOutput<typeof rowsSchema>>;
/** The original Core consumes the same scripts and member objects. */
export interface NativeEliteScript {
  readonly def: Definition; readonly animal: AnimalSim | null;
  readonly spawn: () => void; readonly despawn: () => void; readonly reset: () => void; readonly enterPhase2: () => void;
  readonly trophy: () => void; readonly tick: (dt: number, t: number, engaged: boolean, leashing: boolean) => void;
  readonly broken?: () => boolean; readonly retired?: () => boolean; readonly canSpawn?: () => boolean;
}
export interface NativeEliteRosterCore extends EliteContinuationCore {
  readonly players: ReadonlyMap<string, unknown> | undefined;
  readonly add: (script: NativeEliteScript) => unknown; readonly update: (dt: number, time: number) => void;
  readonly initialize: () => void; readonly signature: (id: string) => void;
}
/** Original mutable state, including the raw declared row used by its lender. */
export interface NativeEliteMember extends EliteContinuationMember { readonly row: { readonly def: Definition } }
/** Original concrete loans for compiled roster construction. */
export interface NativeEliteRosterLoans {
  readonly host: SimHost; readonly core: NativeEliteRosterCore;
  readonly bindings: { readonly brains: NativeEliteKernelLoans['brains']; readonly pinned: Set<AnimalSim> };
  readonly kernel?: Omit<NativeEliteKernelLoans, 'scope' | 'host' | 'lifecycle' | 'brains'>;
  readonly groups?: EliteContinuationGroups;
}
/** One per-simulation identity/decision book lent to the original body manager. */
export type NativeEliteBindings = NativeEliteRosterLoans['bindings'] & { readonly absent: Set<AnimalSim> };
/** Allocate the same mutable collections at the declared native assembly slot. */
export function nativeEliteBindings(): NativeEliteBindings { return { pinned: new Set(), absent: new Set(), brains: new Map() }; }
function method<O extends object>(owner: O, key: keyof O): unknown { return owner[key]; }
function readers(owner: object, keys: readonly string[] = ['phase', 'companion']): readonly unknown[] {
  return keys.flatMap(key => {
    let current: unknown = owner;
    while (typeof current === 'object' && current !== null) {
      const descriptor = Object.getOwnPropertyDescriptor(current, key);
      if (descriptor !== undefined) return [current, method(descriptor, 'get'), method(descriptor, 'set')];
      current = Object.getPrototypeOf(current);
    }
    return [undefined];
  });
}
function scriptMethods(script: NativeEliteScript): readonly unknown[] {
  const descriptor = Object.getOwnPropertyDescriptor(script, 'animal');
  return [script.spawn, script.despawn, script.reset, script.enterPhase2, script.trophy, script.tick, script.broken, script.retired, script.canSpawn,
    descriptor === undefined ? undefined : method(descriptor, 'get')];
}
/** Ordered native construction and registration on the original Core and host.
 * Borrowed controllers are lent at their original row position, never made by
 * an authored factory. They retain all decisions and continuation authority. */
export class NativeEliteRoster {
  private readonly projections;
  private readonly input: NativeEliteRosterRows; private readonly rows: NativeEliteRosterRows['rows']; private readonly roles: NativeEliteRosterRows['roles']; private readonly rowOwner: NativeEliteRosterRows['rows']; private readonly roleOwner: NativeEliteRosterRows['roles'];
  private readonly host: SimHost; private readonly scope: SimHost['scope']; private readonly clock: SimHost['clock']; private readonly core: NativeEliteRosterCore; private readonly entries: NativeEliteRosterCore['entries']; private readonly bindings: NativeEliteRosterLoans['bindings'];
  private readonly kernelOwner: NativeEliteRosterLoans['kernel']; private readonly groups: NativeEliteRosterLoans['groups']; private readonly kernels: NativeEliteKernels | null; private readonly lifecycle: NativeEliteLifecycle | null;
  private readonly brains: NativeEliteRosterLoans['bindings']['brains']; private readonly pinned: Set<AnimalSim>; private readonly packs: EliteContinuationGroups['packs'] | undefined; private readonly guards: EliteContinuationGroups['herds'] | undefined;
  private readonly borrowedGroups: readonly (EliteContinuationGroups['herds'][number] | undefined)[]; private readonly kernelLoans: readonly unknown[];
  private readonly calls: readonly unknown[]; private readonly loans: NativeEliteRosterLoans;
  private readonly members: NativeEliteMember[] = []; private readonly prepared: NativeEliteScript[] = [];
  private readonly borrowed: { member: NativeEliteMember; script: NativeEliteScript; controller: EliteContinuationMember['controller']; calls: readonly unknown[]; continuation: readonly unknown[] }[] = [];
  private installed = false; private bond: NativeEliteBond | null = null; private bondScope: Scope | null = null; private bondReaders: readonly unknown[] = [];
  private readonly projected: { group: GrazerBrain<AnimalSim>; lead: unknown; readers: readonly unknown[]; program: NativeEliteProgram; project: unknown; won: unknown; core: NativeEliteRosterCore & { readonly won: (id: string) => void } }[] = [];
  constructor(input: unknown, loans: NativeEliteRosterLoans) {
    if (!isJsonData(input)) throw new Error('Elite roster requires plain JSON rows');
    if (!v.is(rowsSchema, input)) throw new Error('Invalid elite roster rows');
    this.projections = v.parse(v.record(HandleIdSchema, projectionRows), input.projections ?? {});
    this.input = input; this.rows = [...input.rows]; this.roles = [...input.roles]; this.rowOwner = input.rows; this.roleOwner = input.roles; this.loans = loans;
    this.host = loans.host; this.scope = loans.host.scope; this.clock = loans.host.clock; this.core = loans.core; this.entries = loans.core.entries;
    this.bindings = loans.bindings; this.kernelOwner = loans.kernel; this.groups = loans.groups;
    this.brains = this.bindings.brains; this.pinned = this.bindings.pinned; this.packs = this.groups?.packs; this.guards = this.groups?.herds;
    this.borrowedGroups = this.rows.map(row => row.continuation?.borrowed === undefined ? undefined : this.guards?.[row.continuation.borrowed.group]); this.kernelLoans = this.kernelMembers();
    const ids = this.rows.map(row => row.def.id), keys = ['version', ...Object.keys(EliteCoreContinuationSchema.entries), ...(input.wire.detached === undefined ? [] : [input.wire.detached]), ...this.rows.map(row => row.snapshot)];
    if (new Set(ids).size !== ids.length || input.roles.length !== ids.length || this.entries.length > 0 || this.core.players !== this.host.players
      || new Set(keys).size !== keys.length || keys.some(key => key.length === 0 || ['__proto__', 'constructor', 'prototype'].includes(key))
      || this.rows.some(row => (row.pack !== undefined && this.groups === undefined)
        || (row.continuation?.borrowed !== undefined && !(this.groups?.herds[row.continuation.borrowed.group] instanceof GrazerBrain)))
      || Object.keys(input.projections ?? {}).some(id => { const i = this.rows.findIndex(row => row.def.id === id), row = this.rows[i]; return row === undefined || this.roles[i] !== 'borrowed' || row.continuation?.borrowed === undefined || (input.projections?.[id]?.adoption !== undefined && (row.continuation.detachable !== true || input.wire.detached === undefined)); })
      || this.host.hasStep(input.step)) throw new Error('Invalid elite roster owners or identities');
    this.calls = this.callables(); if (this.calls.some(callable => typeof callable !== 'function')) throw new Error('Missing elite roster operation');
    this.kernels = loans.kernel === undefined ? null : new NativeEliteKernels(input.kernels, { ...loans.kernel, host: this.host, scope: this.scope, lifecycle: this.core, brains: this.bindings.brains });
    const nativeIds = this.rows.flatMap((row, i) => this.roles[i] === 'native' ? [row.def.id] : []);
    if (nativeIds.length !== (this.kernels?.declaredRows.length ?? 0) || nativeIds.some(id => !this.kernels?.declaredRows.some(row => row.id === id))) throw new Error('Incomplete native elite kernels');
    this.lifecycle = this.kernels === null ? null : new NativeEliteLifecycle(this.rows.filter((_row, i) => this.roles[i] === 'native'), { host: this.host, kernels: this.kernels, bindings: this.bindings });
    this.validate(); this.advanceConstruction();
  }
  private callables(): readonly unknown[] {
    return [method(this.host, 'onStep'), method(this.host, 'hasStep'), method(this.core, 'add'), method(this.core, 'update'), method(this.core, 'initialize'), method(this.core, 'signature'), method(this.core, 'snapshot'), method(this.core, 'prepareRestore'),
      method(this.brains, 'clear'), method(this.brains, 'set'), method(this.pinned, 'clear'), method(this.pinned, 'add'), method(this.pinned, 'delete')];
  }
  private kernelMembers(): readonly unknown[] { const owner = this.kernelOwner; return owner === undefined ? [] : [owner.contacts, owner.strikes, owner.terrain, owner.environment, owner.ledges]; }
  private validate(): void {
    const loans = this.loans; this.lifecycle?.validate();
    if (this.scope.disposed || this.scope.disposing || this.host.scope !== this.scope || this.host.clock !== this.clock || loans.host !== this.host || loans.core !== this.core || this.core.players !== this.host.players
      || loans.bindings !== this.bindings || loans.kernel !== this.kernelOwner || loans.groups !== this.groups || this.core.entries !== this.entries
      || this.projected.some(loan => loan.group.leadAway !== loan.lead || loan.program.project !== loan.project || loan.core.won !== loan.won || readers(loan.group, ['leaderState','leader']).some((reader, i) => reader !== loan.readers[i]))
      || (this.bond !== null && (this.bond.scope !== this.bondScope || this.bondScope !== this.scope || this.bondScope.disposed || this.bondScope.disposing || readers(this.bond).some((reader, i) => reader !== this.bondReaders[i])))
      || this.prepared.length !== this.members.length
      || this.bindings.brains !== this.brains || this.bindings.pinned !== this.pinned || this.groups?.packs !== this.packs || this.groups?.herds !== this.guards || this.kernelMembers().some((owner, i) => owner !== this.kernelLoans[i])
      || this.rows.some((row, i) => row.continuation?.borrowed !== undefined && this.guards?.[row.continuation.borrowed.group] !== this.borrowedGroups[i])
      || this.entries.length !== (this.installed ? this.prepared.length : 0) || (this.installed && this.entries.some((entry, i) => entry.script !== this.prepared[i]))
      || this.input.rows !== this.rowOwner || this.input.roles !== this.roleOwner || this.rowOwner.length !== this.rows.length || this.roleOwner.length !== this.roles.length
      || this.rows.some((row, i) => this.rowOwner[i] !== row || this.roleOwner[i] !== this.roles[i]) || this.callables().some((callable, i) => callable !== this.calls[i])
      || this.borrowed.some(loan => loan.member.controller !== loan.controller || loan.member.row.def !== loan.script.def || scriptMethods(loan.script).some((callable, i) => callable !== loan.calls[i])
        || [method(loan.controller, 'snapshot'), method(loan.controller, 'prepareRestore')].some((callable, i) => callable !== loan.continuation[i]))) throw new Error('Retired or replaced elite roster owner');
  }
  private advanceConstruction(): void {
    while (this.members.length < this.rows.length && this.roles[this.members.length] === 'native') {
      this.validate(); const row = this.rows[this.members.length]; if (row === undefined || this.lifecycle === null) throw new Error('Missing native elite lifecycle');
      const state = { animal: null, phase2: false, pack: null, adopted: false, detached: false }, { controller, script } = this.lifecycle.create(row.def, state);
      this.members.push(Object.assign(state, { row, controller })); this.prepared.push(script);
    }
  }
  /** The next concrete borrowed owner is constructed by its original lender here. */
  get borrowedIndex(): number | null { this.validate(); return this.members.length === this.rows.length ? null : this.members.length; }
  bindBorrowed(index: number, member: NativeEliteMember, script: NativeEliteScript): void {
    this.validate(); const row = this.rows[index];
    if (this.installed || index !== this.members.length || this.roles[index] !== 'borrowed' || row === undefined || member.row !== row || script.def !== row.def
      || member.animal !== null || member.pack !== null || member.phase2 || member.adopted || member.detached || script.animal !== member.animal
      || this.members.some(prior => prior === member || prior.controller === member.controller) || this.prepared.includes(script)
      || [member.controller.snapshot, member.controller.prepareRestore, ...scriptMethods(script).slice(0, 6)].some(callable => typeof callable !== 'function')) throw new Error('Foreign or duplicate borrowed elite owner');
    this.borrowed.push({ member, script, controller: member.controller, calls: scriptMethods(script), continuation: [method(member.controller, 'snapshot'), method(member.controller, 'prepareRestore')] });
    this.members.push(member); this.prepared.push(script); this.validate(); this.advanceConstruction();
  }
  /** Construct a declared borrowed controller at its original interleaved row.
   * Native group and bond services retain their bodies, adoption and save authority. */
  bindProjected(index: number, program: NativeEliteProgram, core: NativeEliteRosterCore & { readonly won: (id: string) => void }): void {
    this.validate(); const row = this.rows[index], profile = row === undefined ? undefined : this.projections[row.def.id];
    const binding = row?.continuation?.borrowed, group = binding === undefined ? undefined : this.guards?.[binding.group];
    if (row === undefined || binding === undefined || profile === undefined || !(group instanceof GrazerBrain) || core !== this.core || typeof core.won !== 'function'
      || index !== this.borrowedIndex || typeof group.leadAway !== 'function') throw new Error('Missing projected elite owners');
    const controller = new NativeEliteProjection(profile, program, this.scope);
    const member: NativeEliteMember = { row, controller, animal: null, phase2: false, pack: null, adopted: false, detached: false };
    this.projected.push({ group, lead: method(group, 'leadAway'), readers: readers(group, ['leaderState','leader']), program, project: method(program, 'project'), core, won: method(core, 'won') });
    const live = (): void => { this.validate(); if (this.guards?.[binding.group] !== group) throw new Error('Replaced projected elite group'); };
    let telling = false;
    const script: NativeEliteScript = {
      def: row.def, get animal() { return member.animal; },
      spawn: () => { live(); const actor = group.leader; if (actor === null || !actor.alive || member.animal !== null) throw new Error('Encounter group respawn is not hosted'); member.animal = actor; },
      despawn: () => { live(); if (member.animal !== null) this.pinned.delete(member.animal); },
      reset: () => { live(); member.phase2 = false; }, enterPhase2: () => { live(); member.phase2 = true; }, trophy: () => undefined,
      ...(profile.brokenState === undefined ? {} : { broken: () => { live(); return group.leaderState === profile.brokenState; } }),
      tick: (dt, _t, engaged, _leashing) => {
        live(); const bond = this.bond; if (bond === null) throw new Error('Missing elite bond owner'); const animal = member.animal; if (animal !== null) { if (engaged) this.pinned.add(animal); else this.pinned.delete(animal); }
        if (animal === null || member.detached) return;
        // Capture the original bond facade before signature/lead can reenter its owner.
        const phase = bond.phase, adopted = bond.companion, at = animal.position, player = nearestOnGround(this.host.players, at.x, at.z).position;
        const effects = controller.advance(dt, { state: group.leaderState, phase2: member.phase2, engaged, bonded: phase === profile.bondedState,
          same: group.leader === animal, health: animal.hp / animal.maxHp, at: [at.x, at.y, at.z], player: [player.x, player.y, player.z] });
        const lane = controller.lane();
        if (lane !== null) { telling = true; sayFightView(this.host, eliteLaneWord(row.def.id), [...lane, this.clock.now]); } else if (telling) { telling = false; sayFightView(this.host, eliteLaneWord(row.def.id), []); }
        if (effects.signature) { live(); core.signature(row.def.id); } if (effects.lead) { live(); group.leadAway(player.x, player.z); }
        if (effects.adopt && adopted !== null) {
          live(); const action = profile.adoption;
          if (action === undefined || method(member, 'detached') === true || this.host.entities.get(adopted.entityId) !== adopted || adopted.variant !== action.variant) throw new Error('Adopted encounter reward has no native owner');
          adopted.scale = action.scale; core.won(row.def.id); member.detached = true;
        }
      },
    };
    this.bindBorrowed(index, member, script);
  }
  /** Lend the original service after construction, before fresh or restored initialization. */
  bindBond(owner: NativeEliteBond): void {
    this.validate(); if (!this.installed || this.bond !== null || owner.scope !== this.scope || !['wild','breaking','bonded'].includes(owner.phase)) throw new Error('Foreign or duplicate elite bond owner');
    this.bond = owner; this.bondScope = owner.scope; this.bondReaders = readers(owner);
  }
  /** Register the complete ordered bank only after every controller is present. */
  install(): void {
    this.validate(); if (this.installed || this.members.length !== this.rows.length || this.host.hasStep(this.input.step)) throw new Error('Incomplete or duplicate elite roster installation');
    Object.freeze(this.prepared); for (const script of this.prepared) this.core.add(script);
    this.prepared.forEach((script, i) => { publishEncounter(this.host, script.def.id, () => { const entry = this.entries[i]; if (entry === undefined) throw new Error('Missing elite entry'); return eliteNetView({ ...entry, script }); }); });
    this.installed = true;
    const continuation = new NativeEliteContinuation({ version: this.input.version, wire: this.input.wire, rows: this.rows }, {
      host: this.host, core: this.core, members: this.members, bindings: this.bindings, kernels: this.kernels,
      ...(this.lifecycle === null ? {} : { lifecycle: this.lifecycle }), ...(this.groups === undefined ? {} : { groups: this.groups }),
    });
    this.host.onStep(this.input.step, dt => { if (this.scope.disposed || this.scope.disposing) return; this.validate(); this.core.update(dt, this.clock.now); }, continuation);
  }
  get scripts(): readonly NativeEliteScript[] { this.validate(); if (this.members.length !== this.rows.length) throw new Error('Incomplete elite roster'); return Object.freeze(this.prepared); }
  initialize(): void { this.validate(); if (!this.installed) throw new Error('Uninstalled elite roster'); if (this.projected.length > 0 && this.bond === null) throw new Error('Missing elite bond owner'); this.core.initialize(); }
  bindPopulation(population: NativeElitePopulation): void { this.validate(); if (!this.installed) throw new Error('Uninstalled elite roster'); this.lifecycle?.bindPopulation(population); }
}

/** Complete admitted data, independent of validator implementation metadata. */
interface BoundedEliteProjectionInputFields {
    laneT: number;
    runT: number;
    lastState: string;
    elapsed?: number | undefined;
    laneFrom: [
        number,
        number,
        number
    ];
    laneTo: [
        number,
        number,
        number
    ];
}
type BoundedEliteProjectionInput = { [Key in keyof BoundedEliteProjectionInputFields]: BoundedEliteProjectionInputFields[Key] };
interface BoundedEliteProjectionFields {
    laneT: number;
    runT: number;
    lastState: string;
    elapsed: number;
    laneFrom: [
        number,
        number,
        number
    ];
    laneTo: [
        number,
        number,
        number
    ];
}
type BoundedEliteProjection = { [Key in keyof BoundedEliteProjectionFields]: BoundedEliteProjectionFields[Key] };
type BoundedEliteDefinitionInput = BoundedEliteDefinition;
interface BoundedEliteDefinitionFields {
    id: string;
    lair: {
        x: number;
        z: number;
        r: number;
    };
    awareR: number;
    engageR: number;
    leashR: number;
    rule: "always" | "dusk" | "night" | "storm";
    respawnMin: number;
    drop?: { skin: string | null } | undefined;
}
type BoundedEliteDefinition = { [Key in keyof BoundedEliteDefinitionFields]: BoundedEliteDefinitionFields[Key] };
type BoundedEliteRosterInput = BoundedEliteRoster;
interface BoundedEliteRosterFields {
    step: string;
    version: number;
    wire: {
        detached?: string;
    };
    rows: {
        def: {
            id: string;
            lair: {
                x: number;
                z: number;
                r: number;
            };
            awareR: number;
            engageR: number;
            leashR: number;
            rule: "always" | "dusk" | "night" | "storm";
            respawnMin: number;
            drop?: { skin: string | null } | undefined;
        };
        snapshot: string;
        member: {
            kind: string;
            variant: string;
        };
        pack?: {
            variants: (string)[];
            kind: string;
            idPrefix: string;
        };
        continuation?: {
            detachable?: true;
            borrowed?: {
                group: number;
                role: "guard";
            };
        };
    }[];
    roles: ("native" | "borrowed")[];
    kernels: unknown;
    projections?: Record<string, {
            signal: string;
            states: Record<string, number>;
            bondedState: string;
            brokenState?: string;
            adoption?: {
                variant: string;
                scale: number;
            };
        }>;
}
type BoundedEliteRoster = { [Key in keyof BoundedEliteRosterFields]: BoundedEliteRosterFields[Key] };
