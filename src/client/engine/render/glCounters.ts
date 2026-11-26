import { installAllocationJournal, type JournalSink } from './allocationJournal';
import { memoryAttribution, type MemoryDomain, type MemoryLabel } from '../../../shared/engine/core/memoryAttribution';
import { workerMemory } from '../../../shared/engine/core/workerMemory';

/** ENGINE-MEMORY EM5: the WebGL ledger is always on. Developer's journal keeps one row per resource for the memory card;
 * this one keeps only counters (bytes by kind, by format and by owner), on every page, from the renderer's first call.
 * Capacity the page asked WebGL for, never the driver's residency: the kernel footprint [K] is measured outside the page. */
interface Row { kind: string; format: string; owner: string; bytes: number }
interface DrawingBuffer { readonly drawingBufferWidth: number; readonly drawingBufferHeight: number }
const UNATTRIBUTED = 'unattributed';

export class GlCounters implements JournalSink {
  private readonly rows = new WeakMap<object, Row>();
  private readonly owners = new WeakMap<object, string>();
  private readonly formats = new WeakMap<object, string>();
  private readonly byKind = new Map<string, number>();
  private readonly byFormat = new Map<string, number>();
  private readonly byOwner = new Map<string, number>();
  private readonly buffers = new Set<WeakRef<DrawingBuffer>>();

  private add(row: Row, sign: 1 | -1): void {
    for (const [map, key] of [[this.byKind, row.kind], [this.byFormat, row.format], [this.byOwner, row.owner]] as const) {
      const next = (map.get(key) ?? 0) + sign * row.bytes;
      if (next === 0) map.delete(key); else map.set(key, next);
    }
  }
  allocation(resource: object, domain: MemoryDomain, kind: string, bytes: number): string {
    if (domain !== 'gpu') return '';
    if (!Number.isSafeInteger(bytes) || bytes < 0) throw new RangeError('Invalid memory allocation bytes');
    const previous = this.rows.get(resource);
    if (previous !== undefined) this.add(previous, -1);
    const row = { kind, format: this.formats.get(resource) ?? (kind === 'buffer' ? 'buffer' : 'unknown'), owner: this.owners.get(resource) ?? UNATTRIBUTED, bytes };
    this.rows.set(resource, row); this.add(row, 1);
    return '';
  }
  release(resource: object, domain: MemoryDomain): void {
    if (domain !== 'gpu') return;
    const row = this.rows.get(resource); if (row === undefined) return;
    this.add(row, -1); this.rows.delete(resource);
  }
  label(resource: object, label: MemoryLabel): void {
    this.owners.set(resource, label.owner);
    const row = this.rows.get(resource);
    if (row !== undefined && row.owner !== label.owner) { this.add(row, -1); row.owner = label.owner; this.add(row, 1); }
  }
  /** The storage format of the resource's next allocation (a GL internal format, as hex). */
  format(resource: object, format: number): void {
    const name = `0x${format.toString(16)}`;
    this.formats.set(resource, name);
    const row = this.rows.get(resource);
    if (row !== undefined && row.format !== name) { this.add(row, -1); row.format = name; this.add(row, 1); }
  }
  source(): void { /* counters keep no CPU source identities */ }
  buffer(): string { return ''; }
  /** The canvas's default framebuffer: RGBA8 color plus a 32-bit depth buffer, at its current drawing-buffer size. */
  drawingBuffer(context: DrawingBuffer): () => void {
    const entry = new WeakRef(context);
    this.buffers.add(entry);
    return () => { this.buffers.delete(entry); };
  }
  private drawingBufferBytes(): number {
    let bytes = 0;
    for (const weak of this.buffers) {
      const context = weak.deref();
      if (context === undefined) { this.buffers.delete(weak); continue; }
      bytes += context.drawingBufferWidth * context.drawingBufferHeight * 8;
    }
    return bytes;
  }
  /** GPU bytes by kind, the drawing buffer included. */
  kinds(): Record<string, number> {
    const out: Record<string, number> = Object.fromEntries(this.byKind);
    const drawing = this.drawingBufferBytes();
    if (drawing > 0) out['drawing-buffer'] = drawing;
    return out;
  }
  detail(): { kinds: Record<string, number>; formats: Record<string, number>; owners: Record<string, number> } {
    return { kinds: this.kinds(), formats: Object.fromEntries(this.byFormat), owners: Object.fromEntries(this.byOwner) };
  }
  total(): number { return Object.values(this.kinds()).reduce((sum, bytes) => sum + bytes, 0); }
}

/** The page's counters. */
export const glCounters: GlCounters = new GlCounters();

/** The ledger's read-out for harnesses (src/scripts/memory/measure.mjs reads it at each boot checkpoint): GPU counters, the
 * RAM kinds the page's attribution ledger observes, and each worker isolate's RAM kinds as `<worker>/<kind>` (EM7), all
 * in bytes. No Developer mode needed. */
export function memoryCounters(): Record<MemoryDomain | 'workers', Record<string, number>> {
  return { gpu: glCounters.kinds(), ram: memoryAttribution.kinds('ram'), workers: workerMemory.kinds() };
}
/** Publish `globalThis.__wildshardMemory` once. */
export function publishMemoryCounters(): void {
  if (Reflect.get(globalThis, '__wildshardMemory') !== undefined) return;
  workerMemory.listen();
  Reflect.set(globalThis, '__wildshardMemory', Object.freeze({ counters: memoryCounters, gpu: () => glCounters.detail(), owner: (buffer: object) => memoryAttribution.ownerOf(buffer, 'ram') }));
}

/** Counters on this context, from before its first storage call until the renderer is disposed. */
export function installMemoryCounters(context: Parameters<typeof installAllocationJournal>[0] & DrawingBuffer, counters: GlCounters = glCounters): () => void {
  const forgetBuffer = counters.drawingBuffer(context);
  publishMemoryCounters();
  const stopJournal = installAllocationJournal(context, counters);
  return () => { forgetBuffer(); stopJournal(); };
}
