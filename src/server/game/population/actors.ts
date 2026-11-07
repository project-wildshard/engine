import * as v from 'valibot';
import { EntityIds } from '@wildshard/engine/entities/ids';
import { NativeActorEnvelopeSchema, type NativeActorEnvelope, type NativeActorIdentity, type NativeActorAuxiliary } from '@wildshard/format/nativeActors';

type Identity = Pick<NativeActorIdentity, 'id' | 'kind' | 'variant'>;
type Ownership = Pick<NativeActorIdentity, 'group' | 'encounter' | 'listed'>;
interface Entry<A> { row: NativeActorIdentity; actor: A | null }

/** Game-native identities above the shared materialize/retire host. Allocation and every ownership operation are RNG-free.
 * A dormant actor owns its identity/recipe but no body; retirement is permanent. A dead actor remains materialized until
 * its corpse is explicitly retired. Groups and encounters own identities rather than positions or array offsets. */
export class NativeActors<A> {
  private readonly allocator: EntityIds;
  private entries = new Map<string, Entry<A>>();
  private auxiliary = new Map<string, NativeActorAuxiliary>();
  constructor(namespace: string, private readonly limit: number) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 16384) throw new Error('Invalid native actor bound');
    this.allocator = new EntityIds(namespace);
  }

  /** Reserve the next identity, without consuming spawn rolls or installing a body. */
  allocate(): string {
    // Authored adoption may precede allocator use. Never issue an already adopted identity.
    for (let i = 0; i <= this.limit; i++) {
      const id = this.allocator.allocate();
      if (!this.entries.has(id)) return id;
    }
    throw new Error('Native actor identity allocation exceeds its bound');
  }
  /** Existing envelopes may embed only the allocator; keep their original wire and insertion order. */
  allocatorState(): { next: number; used: string[] } { return this.allocator.snapshot(); }
  restoreAllocator(value: { next: number; used: readonly string[] }): void { this.allocator.restore(value); }

  /** The bound holds bodies and recipes, not history: a retired row gives way, oldest first. The allocator never reissues its id. */
  private room(): boolean {
    if (this.entries.size < this.limit) return true;
    for (const [id, entry] of this.entries) if (entry.row.state === 'retired') { this.entries.delete(id); return true; }
    return false;
  }

  private admit(identity: Identity): Entry<A> | undefined {
    const found = this.entries.get(identity.id);
    if (identity.id.length === 0 || identity.id.length > 128 || identity.kind.length === 0 || identity.variant.length === 0
      || (found === undefined && !this.room())
      || (found !== undefined && (found.row.kind !== identity.kind || found.row.variant !== identity.variant || found.row.state === 'retired')))
      throw new Error('Incompatible native actor identity');
    return found;
  }

  /** Register an authored/prewarmed identity. Repeating adoption of the same dormant recipe has no effects. */
  dormant(identity: Identity, ownership?: Ownership): void {
    const found = this.admit(identity);
    if (found?.actor !== undefined && found.actor !== null) throw new Error('Native actor already has a body');
    this.entries.set(identity.id, { row: { id: identity.id, kind: identity.kind, variant: identity.variant,
      group: ownership?.group ?? null, encounter: ownership?.encounter ?? null, listed: ownership?.listed ?? false, state: 'dormant' }, actor: null });
  }

  /** Preflight before calling host.spawn: a duplicate body refuses before the native world is changed. */
  preflight(identity: Identity): void {
    const found = this.admit(identity);
    if (found?.row.state === 'materialized') throw new Error('Native actor already materialized');
  }

  /** Adopt the actual host body; body creation and saved adapter order remain the roster host's authority. */
  materialize(identity: Identity, actor: A): void {
    this.preflight(identity);
    const old = this.entries.get(identity.id)?.row;
    this.entries.set(identity.id, { row: { id: identity.id, kind: identity.kind, variant: identity.variant, group: old?.group ?? null, encounter: old?.encounter ?? null,
      listed: old?.listed ?? true, state: 'materialized' }, actor });
  }
  /** Query a live native handle; dormant and retired identities never resolve to a body. */
  actor(id: string): A | null { return this.entries.get(id)?.actor ?? null; }
  /** Snapshot ownership metadata without lending writable registry state. */
  identity(id: string): Readonly<NativeActorIdentity> | null {
    const row = this.entries.get(id)?.row; return row === undefined ? null : { ...row };
  }
  /** Move ownership independently from materialization, without spawning, retiring, drawing RNG or changing AI state. */
  own(id: string, ownership: Ownership): void {
    const entry = this.entries.get(id);
    if (entry === undefined || entry.row.state === 'retired') throw new Error('Missing native actor owner');
    entry.row = { ...entry.row, ...ownership };
  }
  /** A released body keeps its recipe/identity dormant. The caller detaches the native body first. */
  sleep(id: string): void {
    const entry = this.entries.get(id);
    if (entry?.row.state !== 'materialized') throw new Error('Missing materialized native actor');
    if ([...this.auxiliary.values()].some(row => row.actor === id)) throw new Error('Native actor still owns auxiliary handles');
    entry.actor = null; entry.row.state = 'dormant';
  }
  /** Permanent retirement never frees an identity for reallocation. Its auxiliary native bodies must be released first. */
  retire(id: string): void {
    const entry = this.entries.get(id);
    if (entry === undefined || entry.row.state === 'retired') throw new Error('Foreign native actor retirement');
    if ([...this.auxiliary.values()].some(row => row.actor === id)) throw new Error('Native actor still owns auxiliary handles');
    entry.actor = null; entry.row.state = 'retired';
  }
  /** Auxiliary handles are scoped by service. Adoption validates ownership, without allocating a physics body. */
  adoptAuxiliary(row: NativeActorAuxiliary): void {
    if (this.entries.get(row.actor)?.row.state !== 'materialized' || !Number.isFinite(row.handle)
      || this.auxiliary.has(row.id) || [...this.auxiliary.values()].some(known => known.service === row.service && known.handle === row.handle))
      throw new Error('Foreign or aliased native auxiliary handle');
    this.auxiliary.set(row.id, { ...row });
  }
  releaseAuxiliary(id: string): void {
    if (!this.auxiliary.delete(id)) throw new Error('Missing native auxiliary handle');
  }

  /** Encode only plain values; bodies, callbacks and recipes stay outside the identity envelope. */
  snapshot(): NativeActorEnvelope {
    return { version: 1, allocator: this.allocatorState(), actors: [...this.entries.values()].map(({ row }) => ({
      id: row.id, kind: row.kind, variant: row.variant, state: row.state, group: row.group, encounter: row.encounter, listed: row.listed,
    })), auxiliary: [...this.auxiliary.values()].map(row => ({ id: row.id, actor: row.actor, service: row.service, handle: row.handle })) };
  }
  /** Validate all identities/handles before a quiet atomic commit. The already reinstalled identity table resolves bodies; no callback, spawn or draw. */
  prepareRestore(value: unknown): () => void {
    const saved = v.parse(NativeActorEnvelopeSchema, value), entries = new Map<string, Entry<A>>(), auxiliary = new Map<string, NativeActorAuxiliary>();
    const allocator = new EntityIds('validation'); allocator.restore(saved.allocator);
    if (saved.actors.length > this.limit) throw new Error('Native actor save exceeds its bound');
    const actors = new Set<A>();
    for (const row of saved.actors) {
      const actor = row.state === 'materialized' ? this.actor(row.id) : null;
      const installed = this.entries.get(row.id)?.row;
      if (actor !== null && (installed?.kind !== row.kind || installed.variant !== row.variant)) throw new Error('Incompatible reinstalled native actor recipe');
      if (entries.has(row.id) || (row.state === 'materialized' && actor === null) || (actor !== null && actors.has(actor))) throw new Error('Invalid native actor save identity');
      if (actor !== null) actors.add(actor);
      entries.set(row.id, { row, actor });
    }
    const handles = new Map<string, Set<number>>();
    for (const row of saved.auxiliary) {
      const service = handles.get(row.service) ?? new Set<number>();
      if (entries.get(row.actor)?.row.state !== 'materialized' || auxiliary.has(row.id) || service.has(row.handle)) throw new Error('Invalid native auxiliary save');
      service.add(row.handle); handles.set(row.service, service); auxiliary.set(row.id, row);
    }
    return () => { this.restoreAllocator(saved.allocator); this.entries = entries; this.auxiliary = auxiliary; };
  }
}
