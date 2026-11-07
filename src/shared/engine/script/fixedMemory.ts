/** Native storage only: no instance, export, guest state or strong owner enters
 * this bank. Weak fences keep storage unavailable until teardown finishes. */
import { observeWasmMemory } from '../core/memoryResources';
import type { Scope } from '../app/scope';

const PAGE = 65536, LIMIT = 45, BYTE_LIMIT = 10 * 1024 * 1024;
const bank: { readonly pages: number; readonly maximum: number; readonly memory: WebAssembly.Memory; readonly fence: WeakRef<Scope> | undefined; readonly virgin: boolean }[] = [];
let hits = 0, misses = 0, returned = 0, bytes = 0, virginHits = 0, recycledHits = 0;
function ready(row: typeof bank[number]): boolean {
  const owner = row.fence?.deref(); return owner === undefined || (owner.disposed && !owner.disposing);
}
/** Detached logical bank capacity, not physical residency. Blocked rows still await their original scope teardown. */
export function fixedMemoryCensus(): { hits: number; misses: number; returned: number; retained: number; available: number; availableBytes: number; blocked: number; blockedBytes: number; bytes: number; virginHits: number; recycledHits: number } {
  let available = 0, availableBytes = 0;
  for (const row of bank) if (ready(row)) { available++; availableBytes += row.pages * PAGE; }
  return { hits, misses, returned, virginHits, recycledHits, retained: bank.length,
    available, availableBytes, blocked: bank.length - available, blockedBytes: bytes - availableBytes, bytes };
}
function retain(memory: WebAssembly.Memory, pages: number, fence?: WeakRef<Scope>, virgin = false, maximum = pages): void {
  if (bank.length >= LIMIT || bytes + pages * PAGE > BYTE_LIMIT) return;
  observeWasmMemory(memory, { owner: 'engine/script', asset: 'script/reserve' });
  bank.push({ pages, maximum, memory, fence, virgin }); bytes += pages * PAGE; returned++;
}
function take(pages: number, maximum: number, freshOnly: boolean): WebAssembly.Memory | undefined {
  for (let at = bank.length - 1; at >= 0; at--) {
    const row = bank[at];
    if (row === undefined || row.pages !== pages || row.maximum !== maximum || !ready(row) || freshOnly && !row.virgin) continue;
    bank.splice(at, 1); hits++; if (row.virgin) virginHits++; else recycledHits++; bytes -= pages * PAGE;
    new Uint8Array(row.memory.buffer).fill(0); return row.memory;
  }
  return undefined;
}
/** Fill fixed-page and virgin growable demand while loading is still up.
 * Each allocation yields; this is explicitly invoked by boot, never on import. */
export async function prewarmFixedMemories(counts: readonly number[], yieldTask: () => Promise<void>,
  virgin: readonly { readonly initial: number; readonly maximum: number; readonly count: number }[] = []): Promise<void> {
  if (counts.length !== 4 || Array.from(counts).some(n => !Number.isInteger(n) || n < 0) || counts.reduce((n, x) => n + x, 0) > LIMIT) throw new Error('Invalid fixed memory warmup');
  const fixedBytes = counts.reduce((n, count, index) => n + count * (index + 1) * PAGE, 0);
  if (fixedBytes > BYTE_LIMIT) throw new Error('Invalid fixed memory warmup');
  const demands = Array.from(virgin, ({ initial, maximum, count }) => ({ initial, maximum, count }));
  if (demands.some(row => !Number.isInteger(row.initial) || row.initial < 1 || row.initial > 4 || !Number.isInteger(row.maximum)
    || row.maximum <= row.initial || row.maximum > 65536 || !Number.isInteger(row.count) || row.count < 0)
    || new Set(demands.map(row => `${row.initial}/${row.maximum}`)).size !== demands.length
    || counts.reduce((n, x) => n + x, 0) + demands.reduce((n, row) => n + row.count, 0) > LIMIT
    || fixedBytes + demands.reduce((n, row) => n + row.initial * row.count * PAGE, 0) > BYTE_LIMIT) throw new Error('Invalid virgin memory warmup');
  for (const [index, count] of counts.entries()) {
    const pages = index + 1, missing = count - bank.filter(row => row.pages === pages && row.maximum === pages && ready(row)).length;
    for (let n = 0; n < missing && bank.length < LIMIT && bytes + pages * PAGE <= BYTE_LIMIT; n++) {
      const memory = new WebAssembly.Memory({ initial: pages, maximum: pages });
      retain(memory, pages, undefined, true); await yieldTask();
    }
  }
  for (const { initial, maximum, count } of demands) {
    const missing = count - bank.filter(row => row.virgin && row.pages === initial && row.maximum === maximum && ready(row)).length;
    for (let n = 0; n < missing && bank.length < LIMIT && bytes + initial * PAGE <= BYTE_LIMIT; n++) {
      retain(new WebAssembly.Memory({ initial, maximum }), initial, undefined, true, maximum); await yieldTask();
    }
  }
}
/** Only audited native adapters may retain borrowed views during a call; none
 * may escape it. Public memory access permanently excludes this lease. */
export class FixedMemory {
  private memory: WebAssembly.Memory | undefined;
  private escaped = false;
  private readonly pages: number;
  private readonly recyclable: boolean;
  constructor(pages: number, recyclable: boolean, freshOnly = false) {
    this.pages = pages; this.recyclable = recyclable;
    if (!Number.isInteger(pages) || pages < 1 || pages > 4) throw new Error('Invalid fixed memory pages');
    const prior = recyclable || freshOnly ? take(pages, pages, freshOnly) : undefined;
    if (prior === undefined) { if (recyclable || freshOnly) misses++; this.memory = new WebAssembly.Memory({ initial: pages, maximum: pages }); }
    else this.memory = prior;
  }
  get value(): WebAssembly.Memory { if (this.memory === undefined) throw new Error('Script memory owner has ended'); return this.memory; }
  expose(): WebAssembly.Memory { this.escaped = true; return this.value; }
  /** Call only after the last active invocation and ALL native view/export
   * references have been cleared. The closed wrapper itself may remain held. */
  retire(fence?: WeakRef<Scope>): void {
    const memory = this.memory; this.memory = undefined;
    if (memory !== undefined && this.recyclable && !this.escaped && memory.buffer.byteLength === this.pages * PAGE) {
      new Uint8Array(memory.buffer).fill(0); retain(memory, this.pages, fence);
    }
  }
}

/** Legacy memories consume only never-instantiated exact-descriptor boot stock.
 * They are exposed once and NEVER returned, including growable memories. */
export function freshScriptMemory(initial: number, maximum: number): WebAssembly.Memory {
  if (initial === maximum && Number.isInteger(initial) && initial >= 1 && initial <= 4) return new FixedMemory(initial, false, true).expose();
  const memory = take(initial, maximum, true); if (memory !== undefined) return memory;
  misses++; return new WebAssembly.Memory({ initial, maximum });
}
