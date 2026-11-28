import type { OwnedKind } from './ownedBuffer.ts';

/** EM33. Limits in predicted phone bytes. Keep the total equal to G65's playing envelope. */
export const PHONE_MEMORY_BUDGETS = {
  browser: 30e6,
  engine: 310e6,
  workers: 80e6,
  geometry: 150e6,
  textures: 105e6,
  scene: 60e6,
  audio: 35e6,
  loading: 170e6,
  margin: 60e6,
} as const;

export type MemorySubsystem = keyof typeof PHONE_MEMORY_BUDGETS;
export type BudgetDomain = 'gpu' | 'ram' | 'workers';
export type BudgetLedger = Partial<Record<BudgetDomain, Readonly<Record<string, number>>>>;
export type SubsystemLedger = Record<MemorySubsystem, Readonly<{ gpu: number; ram: number }>>;

/** The renderer owns framebuffer and target storage. Worker rows are keyed
 * by isolate owner and kind, so even their wire buffers have a worker budget. */
const MEMORY_BUDGET_KINDS = {
  gpu: { 'drawing-buffer': 'browser', renderbuffer: 'engine', buffer: 'geometry', texture: 'textures' },
  ram: {
    'geometry-cpu': 'scene', physics: 'scene', wasm: 'workers',
    'audio-buffer': 'audio', 'audio-data': 'audio', 'audio-sprite-pcm': 'audio',
    'array-buffer': 'loading', wire: 'loading', decode: 'loading', scratch: 'loading', 'cache-document': 'loading', jsheap: 'loading', canvas: 'loading', image: 'loading', 'image-bitmap': 'loading',
  },
} as const satisfies { gpu: Record<string, MemorySubsystem>; ram: Record<OwnedKind, MemorySubsystem> & Record<string, MemorySubsystem> };

export function memorySubsystem(domain: BudgetDomain, kind: string): MemorySubsystem {
  if (domain === 'workers' && kind.includes('/')) return 'workers';
  const kinds: Readonly<Record<string, MemorySubsystem>> | undefined =
    domain === 'workers' ? undefined : MEMORY_BUDGET_KINDS[domain];
  const subsystem = kinds !== undefined && Object.hasOwn(kinds, kind) ? kinds[kind] : undefined;
  if (subsystem === undefined) throw new Error(`Unbudgeted memory ledger kind: ${domain}/${kind}`);
  return subsystem;
}

/** Same ledger projection for the Developer chip and blocking ratchet. */
export function memorySubsystems(ledger: BudgetLedger): SubsystemLedger {
  const totals = Object.fromEntries(Object.keys(PHONE_MEMORY_BUDGETS).map(key => [key, { gpu: 0, ram: 0 }])) as
    Record<MemorySubsystem, { gpu: number; ram: number }>;
  for (const domain of ['gpu', 'ram', 'workers'] as const) {
    const storage = domain === 'gpu' ? 'gpu' : 'ram';
    for (const [kind, bytes] of Object.entries(ledger[domain] ?? {})) {
      if (!Number.isSafeInteger(bytes) || bytes < 0) throw new RangeError(`Invalid memory ledger bytes: ${domain}/${kind}`);
      totals[memorySubsystem(domain, kind)][storage] += bytes;
    }
  }
  return totals;
}

/** Optional page caches keep only these bytes across cell crossings. Live
 * products, render resources and simulations retain their allocator leases. */
export const CACHE_BYTE_LIMITS = {
  gridSections: { owner: 'grid/section-cache', bytes: 2_097_152 },
  gridIndexes: { owner: 'grid/index-cache', bytes: 12_582_912 },
  gridEdges: { owner: 'grid/edge-cache', bytes: 4_194_304 },
  packedFallback: { owner: 'boot/spawn-quota-cache', bytes: 33_554_432 },
  packedIndexes: { owner: 'boot/spawn-index-cache', bytes: 8_388_608 },
  // QA 11-28 row 2: the cooked parts a page's member reads share (a Pine part is up to 11.4 MB)
  cookedParts: { owner: 'boot/cooked-part-cache', bytes: 16_777_216 },
  bakedImages: { owner: 'engine/baked-image-cache', bytes: 50_331_648 },
  bakedCommon: { owner: 'engine/baked-common-cache', bytes: 8_388_608 },
  gridContinuation: { owner: 'grid/continuations', bytes: 33_570_816 },
  revisit: { owner: 'platform', bytes: 16_777_216 },
} as const;

/** Cache references only. Callers keep their own ownership of live loans.
 * An oversized value is delivered to its reader without entering the cache. */
export class ResidentByteCache<K, V> {
  private readonly entries = new Map<K, { value: V; bytes: number }>();
  private used = 0;
  readonly limit: Readonly<{ owner: string; bytes: number }>;
  constructor(limit: Readonly<{ owner: string; bytes: number }>) { this.limit = limit; }

  get bytes(): number { return this.used; }

  get(key: K): V | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  set(key: K, value: V, bytes: number): boolean {
    if (!Number.isSafeInteger(bytes) || bytes < 1 || bytes > this.limit.bytes) return false;
    const previous = this.entries.get(key);
    if (previous) {
      this.entries.delete(key);
      this.used -= previous.bytes;
    }
    for (const [oldest, entry] of this.entries) {
      if (this.used + bytes <= this.limit.bytes) break;
      this.entries.delete(oldest);
      this.used -= entry.bytes;
    }
    this.entries.set(key, { value, bytes });
    this.used += bytes;
    return true;
  }
}
