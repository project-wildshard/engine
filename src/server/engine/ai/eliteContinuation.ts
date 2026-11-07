import * as v from 'valibot';
import { isJsonData } from '@wildshard/format/json';
import { EliteContinuationRowsSchema, EliteCoreContinuationSchema, EliteMemberContinuationSchema, type EliteCoreContinuation } from '@wildshard/format/eliteContinuation';
import type { SimHost, SimValue } from '../sim';
import type { AnimalSim } from '../../../shared/engine/entities/AnimalSim';
import { GrazerBrain } from './grazer';
import { StalkerBrain } from '../../../shared/engine/ai/stalker';
import type { PackBrain } from './pack';
import type { NativeEliteLifecycle } from './eliteLifecycle';
import { NativeEliteKernels, type NativeEliteKernelLoans } from './eliteKernels';

function method<O extends object>(owner: O, key: keyof O): unknown { return owner[key]; }
function nativeController(controller: EliteContinuationMember['controller']): controller is StalkerBrain<AnimalSim> { return controller instanceof StalkerBrain; }

/** Existing controller state, prepared on the same controller without reconstruction. */
export interface EliteContinuationMember {
  animal: AnimalSim | null; phase2: boolean; pack: PackBrain<AnimalSim> | null; adopted: boolean; detached: boolean;
  readonly controller: { readonly snapshot: () => SimValue; readonly prepareRestore: (value: unknown) => () => void };
}
/** The original lifecycle authority supplies its quiet continuation transaction. */
export interface EliteContinuationCore {
  readonly entries: readonly { readonly script: { readonly def: { readonly id: string } }; readonly state: string; readonly phase2: boolean; readonly beatT: number; readonly discovered?: boolean; readonly timer?: number; readonly banners?: number; readonly signatures?: number }[];
  readonly snapshot: () => EliteCoreContinuation; readonly prepareRestore: (value: unknown) => () => void;
}
/** Borrow original group arrays; no game registry, selector callback or copied actor book. */
export interface EliteContinuationGroups {
  readonly packs: readonly PackBrain<AnimalSim>[]; readonly herds: readonly GrazerBrain<AnimalSim>[];
}
/** Native save authority is lent, never recreated by a continuation adapter. */
export interface EliteContinuationLoans {
  readonly host: SimHost; readonly core: EliteContinuationCore; readonly members: readonly EliteContinuationMember[];
  readonly bindings: { readonly brains: NativeEliteKernelLoans['brains']; readonly pinned: Set<AnimalSim> };
  readonly kernels: NativeEliteKernels | null; readonly lifecycle?: NativeEliteLifecycle; readonly groups?: EliteContinuationGroups;
}
/** Row-controlled save envelope over the original native lifecycle, bodies and groups.
 * Whole-bank admission finishes before the first state, Map or Set mutation. */
export class NativeEliteContinuation {
  private readonly rows; private readonly envelope;
  private readonly host; private readonly scope; private readonly core; private readonly members;
  private readonly lifecycle; private readonly bindings; private readonly brains; private readonly pinned; private readonly groups; private readonly kernels;
  private readonly controllers; private readonly methods: readonly unknown[]; private readonly entries; private readonly entryOwner; private readonly memberOwner; private readonly scripts; private readonly packs; private readonly guards; private readonly borrowedGroups;
  private readonly loans: EliteContinuationLoans;
  constructor(input: unknown, loans: EliteContinuationLoans) {
    this.loans = loans;
    if (!isJsonData(input)) throw new Error('Elite continuation requires plain JSON rows');
    this.rows = v.parse(EliteContinuationRowsSchema, input);
    const { host, core, members, bindings, kernels, groups } = loans;
    this.lifecycle = loans.lifecycle; this.host = host; this.scope = host.scope; this.core = core; this.members = [...members]; this.entries = [...core.entries];
    this.bindings = bindings; this.brains = bindings.brains; this.pinned = bindings.pinned; this.groups = groups; this.kernels = kernels;
    this.controllers = members.map(member => member.controller); this.entryOwner = core.entries; this.memberOwner = members; this.scripts = core.entries.map(entry => entry.script); this.packs = groups?.packs; this.guards = groups?.herds; this.borrowedGroups = this.rows.rows.map(row => row.continuation?.borrowed === undefined ? undefined : groups?.herds[row.continuation.borrowed.group]);
    this.methods = this.callables();
    const names = ['version', ...Object.keys(EliteCoreContinuationSchema.entries), ...(this.rows.wire.detached === undefined ? [] : [this.rows.wire.detached]), ...this.rows.rows.map(row => row.snapshot)];
    if (this.methods.some(callable => typeof callable !== 'function') || (kernels !== null && !(kernels instanceof NativeEliteKernels)) || names.some(name => name.length === 0 || ['__proto__', 'constructor', 'prototype'].includes(name)) || new Set(names).size !== names.length
      || this.rows.rows.length !== members.length || members.length !== core.entries.length || new Set(this.controllers).size !== members.length
      || this.rows.rows.some((row, i) => row.def.id !== core.entries[i]?.script.def.id || (row.pack !== undefined && groups === undefined)
        || (row.continuation?.borrowed !== undefined && !(groups?.herds[row.continuation.borrowed.group] instanceof GrazerBrain)))) throw new Error('Invalid elite continuation owners or rows');
    const envelope: v.ObjectEntries = { version: v.literal(this.rows.version), ...EliteCoreContinuationSchema.entries };
    if (this.rows.wire.detached !== undefined) envelope[this.rows.wire.detached] = v.exactOptional(v.literal(true));
    for (const row of this.rows.rows) envelope[row.snapshot] = row.pack === undefined ? v.omit(EliteMemberContinuationSchema, ['pack']) : EliteMemberContinuationSchema;
    this.envelope = v.strictObject(envelope); this.validate();
  }
  private callables(): readonly unknown[] {
    return [method(this.core, 'snapshot'), method(this.core, 'prepareRestore'), method(this.brains, 'clear'), method(this.brains, 'set'), method(this.pinned, 'clear'), method(this.pinned, 'add'), method(this.pinned, 'delete'),
      ...(this.lifecycle === undefined ? [] : [method(this.lifecycle, 'validate')]), ...(this.kernels === null ? [] : [method(this.kernels, 'bind'), method(this.kernels, 'validateController')]), ...this.controllers.flatMap(controller => [method(controller, 'snapshot'), method(controller, 'prepareRestore')])];
  }
  private validate(): void {
    const loans = this.loans; this.kernels?.validate(); this.lifecycle?.validate();
    if (this.scope.disposed || this.scope.disposing || this.host.scope !== this.scope || loans.host !== this.host || loans.core !== this.core
      || loans.bindings !== this.bindings || this.bindings.brains !== this.brains || this.bindings.pinned !== this.pinned || loans.groups !== this.groups || loans.kernels !== this.kernels || loans.lifecycle !== this.lifecycle
      || this.rows.rows.some((row, i) => row.continuation?.borrowed !== undefined && this.guards?.[row.continuation.borrowed.group] !== this.borrowedGroups[i])
      || this.groups?.packs !== this.packs || this.groups?.herds !== this.guards || loans.members !== this.memberOwner || loans.members.length !== this.members.length || this.members.some((member, i) => loans.members[i] !== member || member.controller !== this.controllers[i])
      || this.core.entries !== this.entryOwner || this.core.entries.length !== this.entries.length || this.entries.some((entry, i) => this.core.entries[i] !== entry || entry.script !== this.scripts[i] || entry.script.def.id !== this.rows.rows[i]?.def.id)
      || this.callables().some((callable, i) => callable !== this.methods[i])) throw new Error('Retired or replaced elite continuation owner');
  }
  snapshot(): Record<string, SimValue> {
    this.validate();
    const saved: Record<string, SimValue> = { version: this.rows.version, ...this.core.snapshot() }, detached = this.rows.wire.detached;
    if (detached !== undefined && this.members.some(member => member.detached)) saved[detached] = true;
    this.members.forEach((member, i) => {
      const row = this.rows.rows[i]; if (row === undefined) throw new Error('Missing elite continuation row');
      saved[row.snapshot] = { animal: member.animal?.entityId ?? null, phase2: member.phase2, keeper: member.controller.snapshot(),
        ...(row.pack === undefined ? {} : { pack: member.pack === null ? null : this.groups?.packs.indexOf(member.pack) ?? -1 }) };
    });
    return saved;
  }
  /** Prepare every body, group, controller and lifecycle row before returning a quiet commit. */
  prepareRestore(value: unknown): () => void {
    this.validate();
    const saved = v.parse(this.envelope, value), continuation = v.parse(EliteCoreContinuationSchema, saved), commitCore = this.core.prepareRestore(continuation);
    const rows = this.rows.rows, groups = this.groups, packs = groups?.packs, guards = groups?.herds;
    const originalPacks = packs?.slice(), originalGuards = guards?.slice(), entities = this.host.entities;
    const packViews = originalPacks?.map(pack => ({ owner: pack.members, actors: [...pack.members], ids: pack.members.map(body => body.entityId), kinds: pack.members.map(body => body.kind) }));
    const borrowedActors = rows.map(row => row.continuation?.borrowed === undefined ? undefined : originalGuards?.[row.continuation.borrowed.group]?.stallion);
    const originals = this.members.map(member => [member.animal, member.phase2, member.pack, member.adopted, member.detached] as const);
    if (rows.some(row => continuation.records[row.def.id] === undefined)) throw new Error('Incompatible encounter records'); // more than the roster: a page's lairs, kept
    const bound = this.members.map((member, i) => {
      const row = rows[i]; if (row === undefined) throw new Error('Missing elite continuation row');
      const state = v.parse(row.pack === undefined ? v.omit(EliteMemberContinuationSchema, ['pack']) : EliteMemberContinuationSchema, saved[row.snapshot]);
      const actor = state.animal === null ? null : entities.get(state.animal), alias = this.rows.wire.detached;
      const detached = alias !== undefined && saved[alias] === true && row.continuation?.detachable === true;
      const borrowed = row.continuation?.borrowed, group = borrowed === undefined ? undefined : originalGuards?.[borrowed.group], borrowedActor = borrowedActors[i];
      if (actor === undefined || (actor !== null && (actor.kind !== row.member.kind || actor.variant !== row.member.variant))
        || (borrowed !== undefined && actor !== null && !detached && actor !== borrowedActor)
        || continuation.entries[i]?.phase2 !== state.phase2
        || (detached && (continuation.entries[i].state !== 'retired' || continuation.records[row.def.id]?.retired !== true))) throw new Error('Incompatible encounter member binding');
      const index = 'pack' in state ? state.pack : null, pack = typeof index === 'number' ? packs?.[index] : null, leader = actor;
      const packRow = row.pack;
      if (packRow !== undefined && (pack === undefined || (actor === null) !== (pack === null) || (pack !== null && (pack.members.length !== packRow.variants.length
        || leader === null || pack.members.some((body, n) => body.kind !== packRow.kind || body.entityId !== `${packRow.idPrefix}${String(Number(leader.entityId.slice(packRow.idPrefix.length)) + n + 1)}`))))) throw new Error('Incompatible encounter pack binding');
      if (nativeController(member.controller)) { if (this.kernels === null) throw new Error('Missing native elite kernels'); this.kernels.validateController(row.def.id, member.controller, member); }
      const view = typeof index === 'number' ? packViews?.[index] : undefined;
      const packOwner = view?.owner, packActors = view?.actors, packIds = view?.ids, packKinds = view?.kinds;
      if (packActors?.some(body => entities.get(body.entityId) !== body)) throw new Error('Foreign elite group member');
      const commit = member.controller.prepareRestore(state.keeper);
      return { member, state, actor, detached, pack: pack ?? null, commit, group, borrowedActor, packOwner, packActors, packIds, packKinds };
    });
    const validatePrepared = (): void => {
      this.validate();
      if (this.host.entities !== entities || groups?.packs !== packs || groups?.herds !== guards
        || originalPacks?.length !== packs?.length || originalPacks?.some((pack, i) => packs?.[i] !== pack)
        || originalGuards?.length !== guards?.length || originalGuards?.some((group, i) => guards?.[i] !== group)
        || bound.some(({ member, actor, group, borrowedActor, pack, packOwner, packActors, packIds, packKinds }, i) => pack?.members !== packOwner || packActors?.length !== packOwner?.length
          || (packActors?.some((body, n) => packOwner?.[n] !== body || body.entityId !== packIds?.[n] || body.kind !== packKinds?.[n] || entities.get(body.entityId) !== body) ?? false) || (actor !== null && entities.get(actor.entityId) !== actor) || group?.stallion !== borrowedActor
          || originals[i]?.some((field, n) => field !== [member.animal, member.phase2, member.pack, member.adopted, member.detached][n]))) throw new Error('Changed elite continuation binding');
    };
    validatePrepared();
    return () => {
      validatePrepared();
      commitCore(); this.brains.clear(); this.pinned.clear();
      bound.forEach(({ member, state, actor, detached, pack, commit }, i) => {
        this.validate(); commit(); member.animal = actor; member.phase2 = state.phase2; member.pack = pack; member.adopted = true; member.detached = detached;
        if (actor !== null) {
          if (this.core.entries[i]?.state === 'engaged') this.pinned.add(actor); else this.pinned.delete(actor);
          const controller = member.controller, row = rows[i];
          if (nativeController(controller)) { if (this.kernels === null || row === undefined) throw new Error('Missing native elite kernels'); this.kernels.bind(row.def.id, controller, member, actor); }
        }
      });
    };
  }
  restore(value: unknown): void { this.prepareRestore(value)(); }
}
