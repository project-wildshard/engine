import { GRID_CELL_COUNT } from '@wildshard/format/contentBounds';
import { serializeSimSnapshot, decodeSimSnapshot, type SimSnapshot } from '@wildshard/engine/sim/snapshot';

/** In-memory exact continuations are separate from the512K durable region limit and its logical fallback. */
export const GRID_CONTINUATION_CACHE_CHARS: number = 8 * 1024 * 1024;
/** UTF16 pool plus an equally large atomic replacement buffer and bounded map metadata (at most one key per grid cell). */
export const GRID_CONTINUATION_CACHE_BYTES: number = GRID_CONTINUATION_CACHE_CHARS * 4 + 16 * 1024;
/** Bounded packed strings only; decoding/capture returns transient arrays to the host's continuation owner. */
export class GridContinuationCache {
  private readonly values = new Map<string, string>();
  private used = 0;
  private readonly limit: number;
  constructor(limit: number = GRID_CONTINUATION_CACHE_CHARS) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > GRID_CONTINUATION_CACHE_CHARS) throw new RangeError('Invalid continuation cache capacity');
    this.limit = limit;
  }
  has(instance: string): boolean { return this.values.has(instance); }
  /** Every read is an independent strict same-engine decode; callers cannot mutate the retained wire. */
  read(instance: string): SimSnapshot | undefined {
    const wire = this.values.get(instance); return wire === undefined ? undefined : decodeSimSnapshot(wire);
  }
  /** Prepare before durable save. Null leaves both the old cache and authoritative world unchanged. */
  pack(instance: string, snapshot: SimSnapshot): string | null {
    const wire = serializeSimSnapshot(snapshot);
    return this.fits(instance, wire) ? wire : null;
  }
  private fits(instance: string, wire: string): boolean {
    const previous = this.values.get(instance);
    return instance.length > 0 && (previous !== undefined || this.values.size < GRID_CELL_COUNT)
      && this.used - (previous === undefined ? 0 : previous.length + instance.length) + wire.length + instance.length <= this.limit;
  }
  /** Install only a prepared wire after the durable owner accepted the corresponding snapshot. */
  store(instance: string, wire: string): void {
    if (!this.fits(instance, wire)) throw new RangeError('Continuation cache capacity exceeded');
    this.drop(instance); this.values.set(instance, wire); this.used += instance.length + wire.length;
  }
  drop(instance: string): void {
    const prior = this.values.get(instance); if (prior === undefined) return;
    this.used -= instance.length + prior.length; this.values.delete(instance);
  }
  state(): { entries: number; storedChars: number; capacityChars: number } { return { entries: this.values.size, storedChars: this.used, capacityChars: this.limit }; }
  clear(): void { this.values.clear(); this.used = 0; }
}
