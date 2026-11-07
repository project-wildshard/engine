/** Scalar memory diagnostics over the existing resource/upload identities. Allocation capacity is not resident RAM;
 * the native ruler is reported separately. Weak references ensure this readout cannot keep a retired world alive. */
export type MemoryDomain = 'gpu' | 'ram';
export type MemoryPrecision = 'exact' | 'estimate';
export interface MemoryLabel { readonly owner: string; readonly asset: string }
export interface MemoryAllocation extends MemoryLabel {
  readonly id: string; readonly domain: MemoryDomain; readonly kind: string;
  readonly bytes: number; readonly precision: MemoryPrecision;
}
/** Provenance names a native report/revision/settings/PID; never synthesize a footprint from JS heap capacity. */
export interface MemoryMeasurement {
  readonly webContentBytes: number; readonly labelledGpuBytes: number;
  readonly sampledAt: number; readonly source: string;
}
export interface MemorySummary {
  readonly version: 1;
  readonly totals: Readonly<Record<MemoryDomain, number>>;
  /** Unlabeled allocation bytes WITHIN totals, not a subtraction from the physical WebContent footprint. */
  readonly unattributed: Readonly<Record<MemoryDomain, number>>;
  readonly measured: MemoryMeasurement | null;
  readonly accountedBytes: number | null;
}
export interface MemorySnapshot extends MemorySummary { readonly allocations: readonly MemoryAllocation[] }
interface Entry {
  readonly id: string; readonly resource: WeakRef<object>; readonly domain: MemoryDomain;
  readonly kind: string; readonly precision: MemoryPrecision;
  readonly readBytes: (resource: object) => number;
}
function validBytes(bytes: number): number {
  if (!Number.isSafeInteger(bytes) || bytes < 0) throw new RangeError('Invalid memory allocation bytes');
  return bytes;
}
const UNATTRIBUTED = Object.freeze({ owner: 'unattributed', asset: 'unattributed' });

/** One page's scalar projection of live allocations. Identity is per domain; shared backing storage counts once.
 * Relabeling changes attribution, never storage; resizing replaces a row instead of accumulating an old allocation. */
export class MemoryAttribution {
  private readonly identities = new WeakMap<object, Map<MemoryDomain, string>>();
  private readonly labels = new WeakMap<object, MemoryLabel>();
  private readonly sources = new WeakMap<object, WeakRef<object>>();
  private readonly entries = new Map<string, Entry>();
  private readonly collected = new FinalizationRegistry<string>(id => { this.entries.delete(id); });
  private sequence = 0;
  private measured: MemoryMeasurement | null = null;
  private readAccounted: (() => number) | null = null;

  label(resource: object, label: MemoryLabel): void {
    if (label.owner.length === 0 || label.asset.length === 0) throw new Error('Memory labels require owner and asset');
    const current = this.labels.get(resource);
    if (current !== undefined && current.owner === label.owner && current.asset === label.asset) return; // unchanged: no fresh label (SF57)
    this.labels.set(resource, { owner: label.owner, asset: label.asset });
  }
  /** Late Three geometry labels join an already uploaded native buffer without retaining its CPU source. */
  source(resource: object, source: object): void {
    const identity = ArrayBuffer.isView(source) ? source.buffer : source;
    this.sources.set(resource, new WeakRef(identity));
    const label = this.labels.get(identity); if (label !== undefined) this.label(resource, label);
  }
  /** `readBytes` must not capture the resource. It receives the weakly held identity at snapshot time. */
  observe(resource: object, domain: MemoryDomain, kind: string, readBytes: (resource: object) => number,
    precision: MemoryPrecision = 'exact'): string {
    validBytes(readBytes(resource));
    let domains = this.identities.get(resource);
    if (domains === undefined) { domains = new Map(); this.identities.set(resource, domains); }
    let id = domains.get(domain);
    if (id === undefined) { id = `${domain}:${++this.sequence}`; domains.set(domain, id); this.collected.register(resource, id); }
    this.entries.set(id, { id, resource: new WeakRef(resource), domain, kind, precision, readBytes });
    return id;
  }
  /** Accept a native handle's current allocation, including zero-byte handles and reallocations. */
  allocation(resource: object, domain: MemoryDomain, kind: string, bytes: number, precision: MemoryPrecision = 'exact'): string {
    const size = validBytes(bytes);
    return this.observe(resource, domain, kind, () => size, precision);
  }
  /** Typed views share their entire backing buffer; detached or transferred storage reports zero. */
  buffer(view: ArrayBufferView | ArrayBufferLike, label?: MemoryLabel): string {
    const buffer = ArrayBuffer.isView(view) ? view.buffer : view;
    if (label !== undefined) this.label(buffer, label);
    return this.observe(buffer, 'ram', 'array-buffer', value => {
      if (value instanceof ArrayBuffer || (typeof SharedArrayBuffer !== 'undefined' && value instanceof SharedArrayBuffer)) return value.byteLength;
      throw new TypeError('Memory buffer identity changed type');
    });
  }
  release(resource: object, domain: MemoryDomain): void {
    const id = this.identities.get(resource)?.get(domain);
    if (id !== undefined) this.entries.delete(id);
  }
  measurement(value: MemoryMeasurement | null): void {
    if (value !== null) {
      validBytes(value.webContentBytes); validBytes(value.labelledGpuBytes);
      if (!Number.isFinite(value.sampledAt) || value.sampledAt < 0 || value.source.length === 0) throw new Error('Memory measurement requires time and provenance');
    }
    this.measured = value === null ? null : { ...value };
  }
  /** The composition root lends its existing allocator; this ledger never creates or mutates a budget claim. */
  bindAccounting(read: () => number): () => void {
    if (this.readAccounted !== null) throw new Error('Memory accounting reader already installed');
    validBytes(read()); this.readAccounted = read;
    return () => { if (this.readAccounted === read) this.readAccounted = null; };
  }
  snapshot(accountedBytes: number | null = this.readAccounted?.() ?? null): MemorySnapshot {
    const allocations: MemoryAllocation[] = [], summary = this.read(accountedBytes, allocations);
    allocations.sort((a, b) => b.bytes - a.bytes || a.id.localeCompare(b.id));
    return { version: 1, allocations, totals: summary.totals, unattributed: summary.unattributed,
      measured: summary.measured, accountedBytes: summary.accountedBytes };
  }
  /** Current totals from the same live weak identities, without allocating or sorting detail rows. */
  summary(accountedBytes: number | null = this.readAccounted?.() ?? null): MemorySummary {
    return this.read(accountedBytes);
  }
  private read(accountedBytes: number | null, allocations?: MemoryAllocation[]): MemorySummary {
    if (accountedBytes !== null) validBytes(accountedBytes);
    const totals = { gpu: 0, ram: 0 }, unattributed = { gpu: 0, ram: 0 };
    for (const entry of this.entries.values()) {
      const id=entry.id;
      const resource = entry.resource.deref();
      if (resource === undefined) { this.entries.delete(id); continue; }
      const bytes = validBytes(entry.readBytes(resource));
      const source = this.sources.get(resource)?.deref();
      const label = this.labels.get(resource) ?? (source === undefined ? undefined : this.labels.get(source)) ?? UNATTRIBUTED;
      allocations?.push({ id, domain: entry.domain, kind: entry.kind, bytes, precision: entry.precision, ...label });
      totals[entry.domain] += bytes;
      if (label.owner === UNATTRIBUTED.owner) unattributed[entry.domain] += bytes;
    }
    return { version: 1, totals, unattributed, measured: this.measured === null ? null : { ...this.measured }, accountedBytes };
  }
}

/** The installed allocation paths and Developer/report readers share this ledger; importing creates no service. */
export const memoryAttribution: MemoryAttribution = new MemoryAttribution();
let creation: MemoryLabel | null = null;
/** Synchronous allocation labels share the existing labelledCreation path, including renderer initialization. */
export function memoryCreationLabel(): MemoryLabel | null { return creation; }
export function withMemoryLabel<T>(label: MemoryLabel, create: () => T): T {
  const previous = creation; creation = label;
  try { return create(); } finally { creation = previous; }
}
