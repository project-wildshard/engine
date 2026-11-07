import * as v from 'valibot';
import type { SimHost } from '@wildshard/engine/sim';

/** The shipping pack limit when its shard has not authored a different policy. */
export const DEFAULT_PACK_SLOTS = 12;

/** Renderer-free pack state; the page owns persistence, catalogues and change notifications. */
export interface InventoryState<K extends string> {
  counts: Partial<Record<K, number>>;
  order: K[];
}

/** Runtime admission of a kind and the current slot limit, supplied by the owning shard. */
export interface InventoryPolicy<K extends string> {
  has: (id: K) => boolean;
  keeps: (id: K) => boolean;
  slots: () => number;
}

/** Stack a kept kind in first-pickup order. Existing stacks do not consume another slot. */
export function addInventory<K extends string>(state: InventoryState<K>, policy: InventoryPolicy<K>, id: K, n = 1): boolean {
  if (!policy.has(id) || !policy.keeps(id)) return false;
  if (!state.order.includes(id)) {
    if (state.order.length >= policy.slots()) return false;
    state.order.push(id);
  }
  state.counts[id] = (state.counts[id] ?? 0) + n;
  return true;
}

/** Trade all or nothing; nonpositive requests succeed without mutation, as in the saved page pack. */
export function takeInventory<K extends string>(state: InventoryState<K>, id: K, n = 1): boolean {
  const have = state.counts[id] ?? 0;
  if (n <= 0 || have < n) return n <= 0;
  if (have === n) {
    delete state.counts[id];
    state.order = state.order.filter((other) => other !== id);
  } else state.counts[id] = have - n;
  return true;
}

/** Authored native pack policy; persistence and item catalogues remain caller-owned. */
export interface NativeInventoryProfile<K extends string> {
  readonly kinds: readonly K[]; readonly slots: number;
  readonly counts: { readonly min: number; readonly max: number; readonly integer: boolean; readonly complete: boolean };
  readonly quantity: 'unchecked' | 'positive-safe-integer'; readonly snapshot: 'order' | 'roster';
  readonly stackLimit?: number; readonly restoreError: string;
}
const positiveQuantity = v.pipe(v.number(), v.finite(), v.integer(), v.minValue(1), v.maxValue(Number.MAX_SAFE_INTEGER));
/** The original counts/order continuation, with bounded authored membership and count policies. */
export function nativeInventorySchema<K extends string>(profile: NativeInventoryProfile<K>): v.GenericSchema<unknown, InventoryState<K>> {
  if (profile.kinds.length === 0 || profile.kinds.length > 256 || new Set(profile.kinds).size !== profile.kinds.length
    || !Number.isSafeInteger(profile.slots) || profile.slots < 1 || profile.slots > 256
    || !Number.isFinite(profile.counts.min) || !Number.isFinite(profile.counts.max) || profile.counts.min > profile.counts.max)
    throw new Error('Invalid native inventory profile');
  const kind = v.picklist(profile.kinds), count = v.pipe(v.number(), v.finite(), v.minValue(profile.counts.min), v.maxValue(profile.counts.max),
    v.check(value => !profile.counts.integer || Number.isInteger(value)));
  return v.pipe(v.strictObject({ counts: v.record(kind, count), order: v.pipe(v.array(kind), v.maxLength(profile.slots)) }),
    v.check(state => new Set(state.order).size === state.order.length && Object.keys(state.counts).every(id => state.order.some(item => item === id))
      && (!profile.counts.complete || state.order.every(id => state.counts[id] !== undefined)), profile.restoreError));
}
interface NativePackBinding {
  readonly grant: (item: string, count: number) => boolean;
  readonly debit: (item: string, count: number) => boolean;
}
const nativePacks = new WeakMap<SimHost, Map<string, NativePackBinding>>();
/** Credit the existing pack through its authored admission law; full packs return false. */
export function creditNativeInventory(host: SimHost, id: string, row: { readonly item: string; readonly count: number }): boolean {
  const pack = nativePacks.get(host)?.get(id); if (pack === undefined) throw new Error('Missing native inventory');
  return pack.grant(row.item, row.count);
}
/** Apply row grants to an existing native pack, through its own admission law. */
export function grantNativeInventory(host: SimHost, id: string, grants: readonly { readonly item: string; readonly count: number }[]): void {
  if (nativePacks.get(host)?.has(id) !== true) throw new Error('Missing native inventory');
  for (const row of grants) if (!creditNativeInventory(host, id, row)) throw new Error('Boss reward rejected by native inventory');
}
/** Debit the already registered pack by id; insufficient stock leaves its order and counts intact. */
export function debitNativeInventory(host: SimHost, id: string, row: { readonly item: string; readonly count: number }): boolean {
  const pack = nativePacks.get(host)?.get(id); if (pack === undefined) throw new Error('Missing native inventory');
  return pack.debit(row.item, v.parse(positiveQuantity, row.count));
}

/** Native inventory over existing add/trade laws, retaining the saved roster and ordering policy. */
export class NativeInventory<K extends string> {
  private state: InventoryState<K> = { counts: {}, order: [] };
  private readonly saved: v.GenericSchema<unknown, InventoryState<K>>;
  private readonly policy: InventoryPolicy<K>;
  constructor(private readonly profile: NativeInventoryProfile<K>, host?: SimHost, inventoryId = 'pack') {
    this.saved = nativeInventorySchema(profile); const kinds = new Set(profile.kinds);
    this.policy = { has: id => kinds.has(id), keeps: id => kinds.has(id), slots: () => profile.slots };
    if (host !== undefined) {
      const packs = nativePacks.get(host) ?? new Map<string, NativePackBinding>();
      if (packs.has(inventoryId)) throw new Error('Duplicate native inventory');
      const kind = v.picklist(profile.kinds);
      packs.set(inventoryId, {
        grant: (item, count) => this.add(v.parse(kind, item), count),
        debit: (item, count) => this.take(v.parse(kind, item), count),
      });
      nativePacks.set(host, packs);
    }
  }
  /** Stack through the original admission law with only the authored quantity/overflow guards. */
  readonly add = (id: K, n = 1): boolean => {
    if (this.profile.quantity === 'positive-safe-integer') v.parse(positiveQuantity, n);
    if (this.profile.stackLimit !== undefined && (this.state.counts[id] ?? 0) + n > this.profile.stackLimit)
      throw new RangeError('Native pack stack exceeds its exact bound');
    return addInventory(this.state, this.policy, id, n);
  };
  /** Trade through the same all-or-nothing saved-page law. */
  readonly take = (id: K, n = 1): boolean => takeInventory(this.state, id, n);
  /** Read a stack without mutating the pack. */
  readonly count = (id: K): number => this.state.counts[id] ?? 0;
  /** Copy the original snapshot roster policy and first-pickup order. */
  readonly snapshot = (): { counts: Record<string, number>; order: K[] } => {
    const counts: Record<string, number> = {};
    for (const id of this.profile.snapshot === 'order' ? this.state.order : this.profile.kinds) {
      const n = this.state.counts[id]; if (n !== undefined) counts[id] = n;
    }
    return { counts, order: [...this.state.order] };
  };
  /** Restore admitted old state without pickups, facts, RNG draws or persistence writes. */
  readonly restore = (value: unknown): void => { this.state = v.parse(this.saved, value); };
}
