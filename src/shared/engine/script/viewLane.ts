/**
 * WASM-HOST H9: the view frame lane (SCRIPT-ABI v2, lane 3). One admitted view module per owner, in its own fixed memory
 * that persists between frames: the host writes the v2 header, the region directory, each binding's row and its
 * stamped public sample columns, calls `ws_view(dt, alpha, fuel)` once per scheduled frame, then validates the whole
 * candidate frame (every changed transform against its trusted target and translation / scale / shear bounds, the
 * complete channel bank finite) before anything reaches a target; `upload` runs only after the frame validated. A trap,
 * an invalid frame or a fuel refusal uploads nothing and freezes the binding the guest's hint names (else the module);
 * frozen targets never upload again. The rate is host-owned: display rate, halved after three successive scheduled
 * calls over the time target, never below 15 Hz while the display supplies it, one level back after 120 calls each
 * under half the target. Nothing here is saved or reaches the sim.
 */
import { readV2Module } from '@wildshard/format/scriptModuleV2';
import { admitScriptV2 } from '@wildshard/format/scriptAdmissionV2';
import type { Scope } from '../app/scope';
import { FixedMemory } from './fixedMemory';
import { prepareScriptMemory, consumeScriptStorage } from './moduleV2';

/** A native reservation kept opaque until its original view slot binds. */
export interface PreparedViewMemory { readonly pages: number }
/** Admit the exact view pages before reserving its isolated memory. */
export function prepareViewMemory(bytes: Uint8Array, pages: number, scope: Scope): PreparedViewMemory {
  const admitted = admitScriptV2(bytes, { lane: 'view' });
  if (admitted.initialPages !== pages || admitted.maximumPages !== pages) throw new Error('View memory preparation pages differ');
  return prepareScriptMemory(bytes, scope);
}

/** Region kinds and strides (SCRIPT-ABI v2 "Header and region directory"); every kind is present, unused ones empty. */
const STRIDES = [64, 8, 8, 8, 96, 16, 80, 32, 56, 64, 80, 64, 8, 1, 32, 8, 80, 8, 48, 16, 64, 64, 4, 4] as const;
const BINDINGS = 1, SAMPLE_DIRECTORY = 15, SAMPLE_COLUMNS = 16, TRANSFORMS = 17, CHANNELS = 18, ARRAYS = 23, BATCHES = 24;
/** one batch record's header words (total, first changed, changed, pad) before its matrices and attribute values */
const BATCH_HEADER = 4;
const MAGIC = 0x32565357, HEADER = 128, ENTRY = 24, LANE_VIEW = 3;
const align16 = (n: number): number => Math.ceil(n / 16) * 16;
/** one batch record's 32-bit words: its header, `capacity` matrices and `capacity` attribute items */
const batchWords = (row: { readonly capacity: number; readonly itemSize: number }): number => BATCH_HEADER + row.capacity * (16 + row.itemSize);

/** One view binding: its stable handle and the public sim columns it samples (previous and current, stamped). */
export interface ViewBindingRow { readonly handle: number; readonly columns: number }
/** One candidate transform position: the binding that may write it and the target output / element it lands on. */
export interface ViewTransformRow { readonly binding: number; readonly output: number; readonly element: number }
export interface ViewLaneRows {
  readonly bindings: readonly ViewBindingRow[];
  readonly transforms: readonly ViewTransformRow[];
  readonly channels: number;
  /** view arrays (kind 23): each lent array's length, in order; the host writes their current values as f32 */
  readonly arrays?: readonly number[];
  /** view batches (kind 24): per lent instanced draw, its instance count, the copies one frame may write (capacity) and
   *  its per-instance attribute's components (0: none) */
  readonly batches?: readonly ViewBatchRow[];
  /** a changed matrix's translation magnitude, column scale range and normalized column cross-dot must stay inside */
  readonly bounds: { readonly translation: number; readonly scale: readonly [number, number]; readonly shear: number };
  /** total view cost per scheduled call (marshalling, guest, validation, targets) the rate policy holds to, ms */
  readonly targetMs: number;
  /** fuel per call */
  readonly fuel: number;
}
/** One batch: a lent instanced draw of `instances` copies; one frame writes at most `capacity` of them, each a matrix and
 *  `itemSize` attribute values (0-4). */
export interface ViewBatchRow { readonly instances: number; readonly capacity: number; readonly itemSize: number }
/** Where a validated frame lands: the renderer adapter the owner supplies (an InstancedMesh, bones, look channels). */
export interface ViewTargets {
  /** one validated changed matrix (column-major) for its transform position */
  write: (position: number, matrix: Float32Array) => void;
  /** the complete validated channel bank */
  channels: (values: Float64Array) => void;
  /** one validated batch: its drawn count, then `changed` copies from `first` (matrices 16 f32 each, attribute values
   *  `itemSize` each) */
  batch?: (index: number, total: number, first: number, changed: number, matrices: Float32Array, attributes: Float32Array) => void;
  /** the whole frame validated: mark what changed for upload */
  upload: () => void;
}
/** A binding's stamped samples for this frame: its previous / current sim ticks and 2 × columns values. */
export interface ViewSample { readonly previousTick: number; readonly currentTick: number; readonly values: ArrayLike<number> }

export class ViewLane {
  private readonly storage: FixedMemory;
  get memory(): WebAssembly.Memory { if (this.closed) throw new Error('View memory owner has ended'); return this.storage.expose(); }
  private instance: WebAssembly.Instance | undefined;
  private busy = 0;
  private ended = false;
  private get closed(): boolean {
    const owner = this.retirement?.deref(); return this.ended || owner?.disposed === true || owner?.disposing === true;
  }
  private readonly retirement: WeakRef<Scope> | undefined;
  private retire(): void {
    this.ended = true;
    if (this.busy !== 0) return;
    this.instance = undefined;
    const empty = new ArrayBuffer(0);
    this.view = new DataView(empty); this.columns = new Float64Array(empty); this.channels = new Float64Array(empty);
    this.storage.retire(this.retirement);
  }
  private view: DataView;
  private columns: Float64Array;
  private channels: Float64Array;
  private readonly io: number;
  private readonly offsets = new Map<number, number>();
  private readonly frozen = new Set<number>();
  private readonly matrix = new Float32Array(16);
  /** each batch's last landed total (a frame starts from it) */
  private readonly totals: number[] = [];
  private sequence = 0;
  private frames = 0;
  private pendingDt = 0;
  private level = 0;
  private overruns = 0;
  private healthy = 0;
  private disabled = false;
  private readonly rows: ViewLaneRows;
  private readonly targets: ViewTargets;

  constructor(bytes: Uint8Array, pages: number, rows: ViewLaneRows, targets: ViewTargets, seed: readonly [number, number] = [0, 0],
    prepared?: { readonly memory: PreparedViewMemory; readonly scope: Scope },
    /** Only native adapters whose target callbacks copy ALL borrowed views. */
    owner?: Scope) {
    this.rows = rows; this.targets = targets;
    this.retirement = owner === undefined ? undefined : new WeakRef(owner);
    if (owner?.disposed === true || owner?.disposing === true || (owner !== undefined && prepared !== undefined && owner !== prepared.scope)) throw new Error('View memory owner has ended or differs');
    // the v2 structural reader (memory the only import, fixed pages, no start / table / SIMD); H2's fuel and entry
    // admission joins it before any shipped module runs here
    const read = readV2Module(bytes);
    for (const name of ['ws_abi', 'ws_io', 'ws_init', 'ws_view']) if (read.exports.get(name)?.kind !== 0) throw new Error(`View module lacks ${name}`);
    if (read.pages !== pages || pages < 1 || pages > 4) throw new Error('View memory is its declared 1-4 fixed pages');
    const module = new WebAssembly.Module(Uint8Array.from(bytes));
    this.storage = prepared === undefined ? new FixedMemory(pages, owner !== undefined)
      : consumeScriptStorage(prepared.memory, bytes, pages, prepared.scope);
    if (owner === undefined) this.storage.expose();
    try {
      this.instance = new WebAssembly.Instance(module, { env: { memory: this.storage.value } });
      if (this.call('ws_abi') !== 2) throw new Error('View module ABI major mismatch');
      this.io = this.call('ws_io');
      this.view = new DataView(this.storage.value.buffer);
      this.columns = new Float64Array(this.view.buffer);
      const capacity = new Map([[BINDINGS, rows.bindings.length], [SAMPLE_DIRECTORY, rows.bindings.length],
        [SAMPLE_COLUMNS, rows.bindings.reduce((n, row) => n + 2 * row.columns, 0)], [TRANSFORMS, rows.transforms.length], [CHANNELS, rows.channels],
        [ARRAYS, (rows.arrays ?? []).reduce((n, length) => n + length, 0)], [BATCHES, (rows.batches ?? []).reduce((n, row) => n + batchWords(row), 0)]]);
      // a batch's capacity may exceed its draw's instances (one row, several tiers' draws): its total never may
      for (const row of rows.batches ?? []) if (![row.instances, row.capacity, row.itemSize].every(Number.isInteger) || row.instances < 0 || row.capacity < 1 || row.itemSize < 0 || row.itemSize > 4) throw new Error('Invalid view batch');
      let end = align16(HEADER + STRIDES.length * ENTRY);
      if (!Number.isInteger(this.io) || this.io < 0 || this.io % 16 !== 0) throw new Error('View IO base is not aligned');
      const directory = this.io + HEADER;
      for (const [index, stride] of STRIDES.entries()) {
        const kind = index + 1, count = capacity.get(kind) ?? 0, at = directory + index * ENTRY;
        end = align16(end); this.offsets.set(kind, end);
        this.view.setUint32(at, kind, true); this.view.setUint32(at + 4, end, true); this.view.setUint32(at + 8, stride, true);
        this.view.setUint32(at + 12, count, true); this.view.setUint32(at + 16, 0, true); this.view.setUint32(at + 20, 0, true);
        end += stride * count;
      }
      if (this.io + end > this.storage.value.buffer.byteLength) throw new Error('View layout does not fit its fixed memory');
      this.channels = new Float64Array(this.view.buffer, this.region(CHANNELS), rows.channels);
      // minor 1: the view lane's kinds 23 (arrays) and 24 (batches)
      this.view.setUint32(this.io, MAGIC, true); this.view.setUint16(this.io + 4, 2, true); this.view.setUint16(this.io + 6, 1, true);
      this.view.setUint32(this.io + 8, HEADER, true); this.view.setUint32(this.io + 12, end, true); this.view.setUint32(this.io + 20, LANE_VIEW, true);
      this.view.setUint32(this.io + 96, STRIDES.length, true); this.view.setUint32(this.io + 100, HEADER, true);
      for (const [i, row] of rows.bindings.entries()) {
        const at = this.region(BINDINGS) + i * 64;
        this.view.setUint32(at, row.handle, true); this.view.setUint32(at + 12, 3, true); this.view.setUint32(at + 44, 1, true); // enabled | due, divisor 1
      }
      const left = this.call('ws_init', seed[0], seed[1], rows.fuel);
      if (!Number.isInteger(left) || left < 0 || left > rows.fuel) throw new Error('View init fuel refused');
    } catch (error) { this.retire(); throw error; }
    owner?.onDispose(() => { this.retire(); });
  }

  /** frames between scheduled calls at the current level */
  get interval(): number { return 2 ** this.level; }
  get isFrozen(): boolean { return this.disabled || this.closed; }
  frozenBindings(): ReadonlySet<number> { return this.frozen; }

  /**
   * One displayed frame: accumulate `dt` (the paused / clamped presentation delta), and on a scheduled frame write the
   * header and samples, call the guest, validate and land its frame. `displayHz` bounds the halving at 15 Hz; `now`
   * reads the clock for the rate policy (the caller's `performance.now`). Returns whether the guest ran.
   */
  frame(dt: number, alpha: number, tick: number, samples: readonly ViewSample[], displayHz: number, now: () => number, arrays: readonly ArrayLike<number>[] = []): boolean {
    if (this.disabled || this.closed) return false;
    this.busy++;
    try {
      this.pendingDt += dt;
      if (++this.frames % this.interval !== 0) return false;
      const start = now(), ok = this.run(this.pendingDt, alpha, tick, samples, arrays);
      this.pendingDt = 0;
      this.rate(now() - start, ok, displayHz);
      return true;
    } finally { this.busy--; if (this.ended) this.retire(); }
  }

  private run(dt: number, alpha: number, tick: number, samples: readonly ViewSample[], arrays: readonly ArrayLike<number>[]): boolean {
    // Guest growth is forbidden; an explicit host grow(0) can still replace
    // the buffer. Keep borrowed views per instance until that identity changes.
    const buffer = this.storage.value.buffer;
    if (this.view.buffer !== buffer) {
      this.view = new DataView(buffer); this.columns = new Float64Array(buffer);
      this.channels = new Float64Array(buffer, this.region(CHANNELS), this.rows.channels);
    }
    const v = this.view, io = this.io, origin = Math.floor(tick / 2 ** 30) * 2 ** 30;
    v.setUint32(io + 24, ++this.sequence, true); v.setInt32(io + 28, tick - origin, true); v.setFloat64(io + 104, origin, true);
    v.setUint32(io + 32, this.rows.bindings.length - this.frozen.size, true); v.setUint32(io + 64, 0, true);
    v.setUint32(io + 72, 0, true); v.setUint32(io + 76, 0, true); v.setFloat64(io + 80, dt, true); v.setFloat64(io + 88, alpha, true); v.setUint32(io + 112, this.sequence, true);
    v.setUint32(io + HEADER + (TRANSFORMS - 1) * ENTRY + 16, 0, true);
    v.setUint32(io + HEADER + (CHANNELS - 1) * ENTRY + 16, 0, true);
    // arrays: each lent array's current values, f32, in declared order (a short or absent array is zero-filled)
    let word = 0;
    // Region addresses are host-owned and fixed for this lane, including
    // host buffer replacement. Resolve once before each populated loop.
    const lengths = this.rows.arrays, arrayBase = (lengths?.length ?? 0) === 0 ? 0 : this.region(ARRAYS);
    for (let i = 0; i < (lengths?.length ?? 0); i++) {
      const length = lengths?.[i]; if (length === undefined) throw new Error('Missing view array length');
      const values = arrays[i];
      for (let k = 0; k < length; k++) v.setFloat32(arrayBase + (word + k) * 4, values?.[k] ?? 0, true);
      word += length;
    }
    // batches: each record starts as its last landed total and no change (a frame that writes nothing keeps its draw)
    word = 0;
    const batches = this.rows.batches, batchBase = (batches?.length ?? 0) === 0 ? 0 : this.region(BATCHES);
    for (let i = 0; i < (batches?.length ?? 0); i++) {
      const row = batches?.[i]; if (row === undefined) throw new Error('Missing view batch');
      const at = batchBase + word * 4;
      v.setUint32(at, this.totals[i] ?? 0, true); v.setUint32(at + 4, 0, true); v.setUint32(at + 8, 0, true); v.setUint32(at + 12, 0, true);
      word += batchWords(row);
    }
    let column = this.region(SAMPLE_COLUMNS) / 8;
    const columns = this.columns, stamps = this.region(SAMPLE_DIRECTORY);
    const bindings = this.rows.bindings, bindingBase = bindings.length === 0 ? 0 : this.region(BINDINGS);
    for (let i = 0; i < bindings.length; i++) {
      const row = bindings[i]; if (row === undefined) throw new Error('Missing view binding');
      const sample = samples[i], at = stamps + i * 32, n = row.columns;
      const binding = bindingBase + i * 64;
      v.setUint32(binding + 12, this.frozen.has(i) ? 0 : 3, true);
      v.setUint32(at, i, true); v.setUint32(at + 24, n, true);
      if (sample === undefined || sample.values.length !== 2 * n) { v.setUint32(at + 4, 0, true); column += 2 * n; continue; }
      v.setUint32(at + 4, sample.currentTick > sample.previousTick ? 3 : 1, true);
      v.setInt32(at + 8, sample.previousTick - origin, true); v.setInt32(at + 12, sample.currentTick - origin, true);
      v.setUint32(at + 16, (column - io / 8) * 8, true); v.setUint32(at + 20, (column + n - io / 8) * 8, true);
      for (let k = 0; k < 2 * n; k++) columns[column + k] = sample.values[k] ?? 0;
      v.setInt32(binding + 48, sample.previousTick - origin, true); v.setInt32(binding + 52, sample.currentTick - origin, true);
      column += 2 * n;
    }
    let left: number;
    try { left = this.call('ws_view', dt, alpha, this.rows.fuel); } catch { this.freeze(); return false; }
    if (!Number.isInteger(left) || left < 0 || left > this.rows.fuel || !this.validate()) { this.freeze(); return false; }
    this.land(); return true;
  }

  /** The whole candidate frame against the trusted table: counts, identities, finite bounded matrices, finite channels. */
  private validate(): boolean {
    const v = this.view, io = this.io, transforms = this.rows.transforms, base = this.region(TRANSFORMS);
    const count = v.getUint32(io + HEADER + (TRANSFORMS - 1) * ENTRY + 16, true), changed = v.getUint32(io + 72, true);
    if (count !== 0 && count !== transforms.length) return false;
    let seen = 0;
    for (let i = 0; i < count; i++) {
      const at = base + i * 80, row = transforms[i], flag = v.getUint32(at + 12, true);
      if (row === undefined || v.getUint32(at, true) !== row.binding || v.getUint32(at + 4, true) !== row.output || v.getUint32(at + 8, true) !== row.element || flag > 1) return false;
      if (flag === 1 && !this.frozen.has(row.binding)) { if (!this.bounded(at + 16)) return false; seen++; }
      else if (flag === 1) seen++;
    }
    if (seen !== changed) return false;
    const channels = v.getUint32(io + HEADER + (CHANNELS - 1) * ENTRY + 16, true), dirty = v.getUint32(io + 76, true);
    if (channels !== dirty || (channels !== 0 && channels !== this.rows.channels)) return false;
    const channelBase = channels === 0 ? 0 : this.region(CHANNELS);
    for (let i = 0; i < channels; i++) if (!Number.isFinite(v.getFloat64(channelBase + i * 8, true))) return false;
    // each batch: a total inside its instances, a changed range inside the total and the capacity, every written matrix
    // bounded and every written attribute value finite
    let word = 0;
    for (const row of this.rows.batches ?? []) {
      const at = this.region(BATCHES) + word * 4, total = v.getUint32(at, true), first = v.getUint32(at + 4, true), n = v.getUint32(at + 8, true);
      if (total > row.instances || n > row.capacity || first + n > total || v.getUint32(at + 12, true) !== 0) return false;
      const matrices = at + BATCH_HEADER * 4, attributes = matrices + row.capacity * 64;
      for (let k = 0; k < n; k++) if (!this.bounded(matrices + k * 64)) return false;
      for (let k = 0; k < n * row.itemSize; k++) if (!Number.isFinite(v.getFloat32(attributes + k * 4, true))) return false;
      word += batchWords(row);
    }
    return true;
  }

  /** A column-major affine matrix inside the declared translation, scale and shear bounds. */
  private bounded(at: number): boolean {
    const m = this.matrix, { translation, scale, shear } = this.rows.bounds;
    for (let k = 0; k < 16; k++) { const value = this.view.getFloat32(at + k * 4, true); if (!Number.isFinite(value)) return false; m[k] = value; }
    if (m[3] !== 0 || m[7] !== 0 || m[11] !== 0 || m[15] !== 1) return false;
    if (Math.hypot(m[12] ?? 0, m[13] ?? 0, m[14] ?? 0) > translation) return false;
    const len = [0, 4, 8].map(c => Math.hypot(m[c] ?? 0, m[c + 1] ?? 0, m[c + 2] ?? 0));
    if (len.some(l => l < scale[0] || l > scale[1])) return false;
    const dot = (a: number, b: number): number => ((m[a] ?? 0) * (m[b] ?? 0) + (m[a + 1] ?? 0) * (m[b + 1] ?? 0) + (m[a + 2] ?? 0) * (m[b + 2] ?? 0)) / ((len[a / 4] ?? 1) * (len[b / 4] ?? 1));
    return Math.abs(dot(0, 4)) <= shear && Math.abs(dot(0, 8)) <= shear && Math.abs(dot(4, 8)) <= shear;
  }

  private land(): void {
    const v = this.view, base = this.region(TRANSFORMS), count = v.getUint32(this.io + HEADER + (TRANSFORMS - 1) * ENTRY + 16, true);
    for (let i = 0; i < count; i++) {
      const at = base + i * 80, row = this.rows.transforms[i];
      if (row === undefined || v.getUint32(at + 12, true) !== 1 || this.frozen.has(row.binding)) continue;
      for (let k = 0; k < 16; k++) this.matrix[k] = v.getFloat32(at + 16 + k * 4, true);
      this.targets.write(i, this.matrix);
    }
    if (v.getUint32(this.io + HEADER + (CHANNELS - 1) * ENTRY + 16, true) !== 0) this.targets.channels(this.channels);
    let word = 0;
    for (const [i, row] of (this.rows.batches ?? []).entries()) {
      const at = this.region(BATCHES) + word * 4, total = v.getUint32(at, true), first = v.getUint32(at + 4, true), n = v.getUint32(at + 8, true);
      const matrices = at + BATCH_HEADER * 4;
      this.totals[i] = total;
      this.targets.batch?.(i, total, first, n, new Float32Array(this.storage.value.buffer, matrices, n * 16), new Float32Array(this.storage.value.buffer, matrices + row.capacity * 64, n * row.itemSize));
      word += batchWords(row);
    }
    this.targets.upload();
  }

  /** Freeze the binding the guest's running hint names, else the whole module. */
  private freeze(): void {
    const hint = this.view.getUint32(this.io + 64, true);
    if (hint >= 1 && hint <= this.rows.bindings.length && !this.frozen.has(hint - 1)) this.frozen.add(hint - 1); else this.disabled = true;
    if (this.frozen.size === this.rows.bindings.length) this.disabled = true;
  }

  private rate(ms: number, ok: boolean, displayHz: number): void {
    const floor = Math.max(0, Math.floor(Math.log2(Math.max(1, displayHz) / 15)));
    if (this.level > floor) { this.level = floor; this.overruns = 0; this.healthy = 0; return; }
    if (!ok || ms > this.rows.targetMs) {
      this.healthy = 0;
      if (ok && ++this.overruns >= 3 && this.level < floor) { this.level++; this.overruns = 0; }
      return;
    }
    this.overruns = 0;
    if (this.level > 0 && ms < this.rows.targetMs / 2) { if (++this.healthy >= 120) { this.level--; this.healthy = 0; } }
    else this.healthy = 0;
  }

  private region(kind: number): number { const at = this.offsets.get(kind); if (at === undefined) throw new Error(`View region ${String(kind)} missing`); return this.io + at; }
  private call(name: string, ...args: number[]): number {
    const value = this.instance?.exports[name]; if (typeof value !== 'function') throw new Error(`View module lacks ${name}`);
    const result: unknown = (value as (...a: number[]) => unknown)(...args);
    if (typeof result !== 'number' || !Number.isFinite(result)) throw new Error(`View ${name} returned no number`);
    return result;
  }
}
