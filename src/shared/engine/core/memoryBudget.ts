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
    'array-buffer': 'loading', wire: 'loading', decode: 'loading', scratch: 'loading', canvas: 'loading', image: 'loading', 'image-bitmap': 'loading',
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
