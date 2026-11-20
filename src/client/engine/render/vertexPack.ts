/**
 * MEMORY-STRUCTURE STR16 (mini-memstruct-m2d, 2026-11-19): the phone's static vertex channels go to the GPU packed.
 *
 * Most of a zone's vertex bytes reach the GPU as Float32 even where the file held them compact: the intake widens a
 * quantized model back to plain floats for its CPU readers (welds, tiling, colliders, the rest pools), and generated
 * meshes (terrain splats, creature skins, held items) never were compact. Pine at phone Low held 8.8 MB of Float32
 * normals, 7.5 MB of UVs, 6.1 MB of colours and 4.3 MB of skin weights in GL buffers.
 *
 * `installVertexPack` keeps every CPU reader as it is and changes only what the GPU holds. A static Float32 vertex
 * channel's upload waits until a draw first points at its buffer, when the program names the attribute; then it goes
 * up once, packed: `normal` as Int8x3 normalized and `color` as Uint8 normalized, any other channel whose values all
 * lie in 0..1 (or -1..1) as Uint16 (Int16) normalized. A three-lane byte or 16-bit channel is padded to four lanes, so
 * every packed stride is a multiple of four bytes and Metal reads it in place (STR17: no second ANGLE copy). `position`
 * and every `instance*` channel stay Float32, as does a channel with values out of range, a constant one other than a
 * colour or normal fill (a buffer written later), an interleaved one or one a draw reads at an offset. The program reads the same values to within the
 * format's step (1/127 for a normal, 1/255 for a colour, 1/65535 for the rest).
 *
 * A later write into a packed buffer is packed the same way; a write out of the format's range turns the buffer back to
 * Float32 (read back from the GPU once) and re-points every vertex array that reads it. A read back (`getBufferSubData`,
 * the Memory saver's `restore`) comes back as Float32. A channel never pointed at in the frame it was uploaded goes up
 * unpacked at the end of that task. The device slot `debug.vertexPack` set to false turns it off.
 */
import { ownedArray } from '../../../shared/engine/core/ownedBuffer';
import { diagnosticNow } from '../../../shared/engine/core/clock';

const ARRAY_BUFFER = 0x8892, STATIC_DRAW = 0x88e4;
const BYTE = 0x1400, UNSIGNED_BYTE = 0x1401, SHORT = 0x1402, UNSIGNED_SHORT = 0x1403, FLOAT = 0x1406;
const ACTIVE_ATTRIBUTES = 0x8b89;
/** the smallest channel worth deferring (floats): a quad's worth is left alone */
const MIN_FLOATS = 96;
const STAGING = { owner: 'engine/vertex-pack', kind: 'scratch' } as const;
const PACKED = { owner: 'engine/vertex-pack', asset: 'packed-upload', kind: 'scratch' } as const;

/** A packed layout: the GL component type, its lane count (3 lanes pad to 4) and the stride in bytes. */
export interface PackFormat {
  readonly type: typeof BYTE | typeof UNSIGNED_BYTE | typeof SHORT | typeof UNSIGNED_SHORT;
  readonly size: number;
  readonly lanes: number;
  readonly stride: number;
}
const SCALE: Readonly<Record<PackFormat['type'], number>> = { [BYTE]: 127, [UNSIGNED_BYTE]: 255, [SHORT]: 32767, [UNSIGNED_SHORT]: 65535 };
const BYTES: Readonly<Record<PackFormat['type'], number>> = { [BYTE]: 1, [UNSIGNED_BYTE]: 1, [SHORT]: 2, [UNSIGNED_SHORT]: 2 };
const signed = (type: PackFormat['type']): boolean => type === BYTE || type === SHORT;

function format(type: PackFormat['type'], size: number): PackFormat {
  const lanes = size === 3 ? 4 : size;
  return { type, size, lanes, stride: lanes * BYTES[type] };
}

/** The packed layout for a Float32 channel `name` of `size` components, or null where it stays Float32. */
export function packFormat(name: string, data: Float32Array, size: number): PackFormat | null {
  if (size < 2 || size > 4 || data.length === 0 || data.length % size !== 0 || /position/iu.test(name) || name.startsWith('instance')) return null;
  // DW3 (mini-driftwood13e): an indexed loop, not `for…of`: on the iPhone the array iterator made this scan most of the
  // Driftwood road deck's 250 ms first draw (24.5 MB of channels, packed in one task)
  let min = Infinity, max = -Infinity;
  for (let i = 0, n = data.length; i < n; i++) {
    const value = data[i] ?? Number.NaN;
    if (!Number.isFinite(value)) return null;
    if (value < min) min = value;
    if (value > max) max = value;
  }
  // a constant channel is mostly a buffer something writes later (a reserved batch, a particle pool): its range is
  // unknown. A constant colour or normal is a fill (white vertex colours, a flat face) and packs.
  if (min === max && (min === 0 || (name !== 'color' && name !== 'normal'))) return null;
  if (name === 'normal' && size === 3 && min >= -1.0001 && max <= 1.0001) return format(BYTE, 3);
  if (name === 'color' && min >= 0 && max <= 1) return format(UNSIGNED_BYTE, size);
  if (min >= 0 && max <= 1) return format(UNSIGNED_SHORT, size);
  if (min >= -1 && max <= 1) return format(SHORT, size);
  return null;
}

/** One staging array the packed uploads share (GL copies it at once), let go when the task's uploads end. */
let staging: Uint8Array | null = null;
function stagingBytes(bytes: number): Uint8Array {
  if (staging === null || staging.byteLength < bytes) staging = ownedArray(Uint8Array, Math.max(bytes, 2 * (staging?.byteLength ?? 0)), PACKED);
  const out = staging.subarray(0, bytes); out.fill(0); return out;
}
/** `count` zeroed Int32 words, from one array shared like the staging bytes. */
let wordStaging: Int32Array | null = null;
function stagingWords(count: number): Int32Array {
  if (wordStaging === null || wordStaging.length < count) wordStaging = ownedArray(Int32Array, Math.max(count, 2 * (wordStaging?.length ?? 0)), PACKED);
  const out = wordStaging.subarray(0, count); out.fill(0); return out;
}
/** The shared staging goes (the end of a task's uploads). */
export function releasePackStaging(): void { staging = null; wordStaging = null; }

/** Vertices `[from, to)` in `f`'s layout, in the shared staging array: upload it before the next `encode`. Element `e`
 * (vertex `e / f.size`, component `e % f.size`) is read from `source[e + shift]`; a missing or non-finite one writes 0 and
 * does not fit. DW3 (mini-driftwood13e): one typed-array loop per lane type, no per-element closure, DataView or lookups:
 * this runs inside a first draw (a 470k-vertex road deck on the phone). */
export function encode(f: PackFormat, from: number, to: number, source: ArrayLike<number>, shift = 0): { bytes: Uint8Array; fits: boolean } {
  const vertices = Math.max(0, to - from), out = stagingBytes(vertices * f.stride);
  const scale = SCALE[f.type], isSigned = signed(f.type), lo = isSigned ? -1 : 0, hi = 1 + (f.type === BYTE ? 0.0001 : 0);
  const floor = isSigned ? -hi : 0, size = f.size, lanes = f.lanes, length = source.length;
  // one monomorphic loop into Int32 words, then one native conversion into the lane type (a loop storing into four
  // typed-array kinds stays slow on JavaScriptCore)
  const words = stagingWords(vertices * lanes);
  let ok = true;
  for (let v = 0; v < vertices; v++) {
    const at = v * lanes, base = (from + v) * size + shift;
    for (let c = 0; c < size; c++) {
      const i = base + c, value = i >= 0 && i < length ? source[i] ?? Number.NaN : Number.NaN;
      // DF11: no `continue` or nested ternary here; V8 kept that shape's doubles boxed even when hot (48 B a vertex in
      // node, 0 now). The same words: a non-finite value writes 0, a finite one is clamped to [lo, 1] and scaled.
      if (!(value <= hi && value >= floor)) ok = false;
      words[at + c] = Number.isFinite(value) ? Math.round(Math.min(1, Math.max(lo, value)) * scale) : 0;
    }
  }
  const n = vertices * lanes;
  if (BYTES[f.type] === 2) (isSigned ? new Int16Array(out.buffer, out.byteOffset, n) : new Uint16Array(out.buffer, out.byteOffset, n)).set(words);
  else (isSigned ? new Int8Array(out.buffer, out.byteOffset, n) : out).set(words);
  return { bytes: out, fits: ok };
}

/** `f`'s packed vertices back to floats: vertex `from` onward into `into` (component `e` written at `write(e, value)`). */
export function decode(f: PackFormat, packed: Uint8Array, from: number, write: (element: number, value: number) => void): void {
  const view = new DataView(packed.buffer, packed.byteOffset, packed.byteLength), vertices = Math.floor(packed.byteLength / f.stride);
  const scale = SCALE[f.type], wide = BYTES[f.type] === 2;
  for (let v = 0; v < vertices; v++) for (let c = 0; c < f.size; c++) {
    const at = v * f.stride + c * BYTES[f.type];
    const word = wide ? (signed(f.type) ? view.getInt16(at, true) : view.getUint16(at, true)) : (signed(f.type) ? view.getInt8(at) : view.getUint8(at));
    write((from + v) * f.size + c, Math.max(word / scale, -1));
  }
}

/** The calls `installVertexPack` wraps (a WebGL2 context; any function shape, each is called with GL's own arguments). */
export interface VertexPackContext {
  bindBuffer: (...args: never[]) => unknown;
  deleteBuffer: (...args: never[]) => unknown;
  bufferData: (...args: never[]) => unknown;
  bufferSubData: (...args: never[]) => unknown;
  getBufferSubData: (...args: never[]) => unknown;
  copyBufferSubData: (...args: never[]) => unknown;
  vertexAttribPointer: (...args: never[]) => unknown;
  vertexAttribIPointer: (...args: never[]) => unknown;
  useProgram: (...args: never[]) => unknown;
  bindVertexArray: (...args: never[]) => unknown;
  deleteVertexArray: (...args: never[]) => unknown;
  getProgramParameter: (...args: never[]) => unknown;
  getActiveAttrib: (...args: never[]) => unknown;
  getAttribLocation: (...args: never[]) => unknown;
}

interface Pending { readonly data: Float32Array; readonly usage: number }
interface Packed { readonly format: PackFormat; readonly vertices: number; readonly arrays: Map<unknown, Set<number>> }

/** What the pack did this page (the census and the tests read it). */
export interface VertexPackStats { buffers: number; floatBytes: number; packedBytes: number; reverted: number; unpacked: number;
  /** DW3: ms spent packing (scan and encode) and uploading at first draws, and the slowest single first-draw upload */
  scanMs: number; packMs: number; uploadMs: number; worst: { ms: number; bytes: number; name: string } }
export const vertexPackStats: VertexPackStats = { buffers: 0, floatBytes: 0, packedBytes: 0, reverted: 0, unpacked: 0, scanMs: 0, packMs: 0, uploadMs: 0, worst: { ms: 0, bytes: 0, name: '' } };
if (typeof window !== "undefined") Reflect.set(window, "__vertexPackStats", vertexPackStats);

/** Wrap `gl` so static Float32 vertex channels go up packed. `enabled` is read at each upload. False: not installed. */
export function installVertexPack(gl: VertexPackContext, enabled: () => boolean, schedule: (flush: () => void) => void = queueMicrotask): boolean {
  const call = (name: keyof VertexPackContext): ((...args: readonly unknown[]) => unknown) => { const f: unknown = gl[name]; return (...args) => Reflect.apply(f as (...a: unknown[]) => unknown, gl, args); };
  const wrap = (name: keyof VertexPackContext, value: (...args: readonly unknown[]) => unknown): void => { Object.defineProperty(gl, name, { value, writable: true, configurable: true }); };
  const bindBuffer = call('bindBuffer'), deleteBuffer = call('deleteBuffer'), bufferData = call('bufferData'), bufferSubData = call('bufferSubData');
  const getBufferSubData = call('getBufferSubData'), copyBufferSubData = call('copyBufferSubData'), pointer = call('vertexAttribPointer'), iPointer = call('vertexAttribIPointer');
  const useProgram = call('useProgram'), bindVertexArray = call('bindVertexArray'), deleteVertexArray = call('deleteVertexArray');
  const programParameter = call('getProgramParameter'), activeAttrib = call('getActiveAttrib'), attribLocation = call('getAttribLocation');
  const bound = new Map<number, unknown>(), pending = new Map<unknown, Pending>(), packed = new Map<unknown, Packed>();
  const pointed = new WeakSet(), names = new WeakMap<object, Map<number, string>>(), deadArrays = new WeakSet();
  let program: unknown = null, vao: unknown = null, scheduled = false;
  const live = (buffer: unknown): buffer is object => typeof buffer === 'object' && buffer !== null;

  /** upload `buffer`'s deferred data as it came */
  const flushOne = (buffer: unknown, entry: Pending): void => {
    pending.delete(buffer);
    const previous = bound.get(ARRAY_BUFFER) ?? null;
    if (previous !== buffer) bindBuffer(ARRAY_BUFFER, buffer);
    bufferData(ARRAY_BUFFER, entry.data, entry.usage);
    if (previous !== buffer) bindBuffer(ARRAY_BUFFER, previous);
    vertexPackStats.unpacked++;
  };
  const flushAll = (): void => { scheduled = false; for (const [buffer, entry] of pending) flushOne(buffer, entry); releasePackStaging(); };
  /** the end of this task flushes what is still waiting and lets the staging go */
  const later = (): void => { if (!scheduled) { scheduled = true; schedule(flushAll); } };
  const nameOf = (index: number): string | undefined => {
    if (!live(program)) return undefined;
    let table = names.get(program);
    if (table === undefined) {
      table = new Map();
      const active = programParameter(program, ACTIVE_ATTRIBUTES), count = typeof active === 'number' ? active : 0;
      for (let i = 0; i < count; i++) {
        const info = activeAttrib(program, i), name: unknown = live(info) ? Reflect.get(info, 'name') : undefined;
        if (typeof name !== 'string') continue;
        const location = attribLocation(program, name);
        if (typeof location === 'number' && location >= 0) table.set(location, name);
      }
      names.set(program, table);
    }
    return table.get(index);
  };
  /** a packed buffer back to Float32 (`patch` writes its new floats over the read-back ones), every reader re-pointed */
  const revert = (buffer: unknown, entry: Packed, patch: (floats: Float32Array) => void): void => {
    const { format: f, vertices } = entry, wide = ownedArray(Uint8Array, vertices * f.stride, STAGING), floats = ownedArray(Float32Array, vertices * f.size, STAGING);
    const previous = bound.get(ARRAY_BUFFER) ?? null, previousVao = vao;
    bindBuffer(ARRAY_BUFFER, buffer);
    getBufferSubData(ARRAY_BUFFER, 0, wide);
    decode(f, wide, 0, (e, value) => { floats[e] = value; });
    patch(floats);
    bufferData(ARRAY_BUFFER, floats, STATIC_DRAW);
    packed.delete(buffer);
    for (const [array, indices] of entry.arrays) {
      if (live(array) && deadArrays.has(array)) continue;
      bindVertexArray(array);
      for (const index of indices) pointer(index, f.size, FLOAT, false, f.size * 4, 0);
    }
    bindVertexArray(previousVao);
    bindBuffer(ARRAY_BUFFER, previous);
    vertexPackStats.reverted++;
    console.warn(`[vertex-pack] a write out of a packed channel's range: ${String(vertices)} vertices went back to Float32`);
  };

  wrap('bindBuffer', (...args) => { const [target, buffer] = args; if (typeof target === 'number') bound.set(target, buffer); return bindBuffer(...args); });
  wrap('deleteBuffer', (...args) => {
    const [buffer] = args; pending.delete(buffer); packed.delete(buffer);
    for (const [target, b] of bound) if (b === buffer) bound.set(target, null);
    return deleteBuffer(...args);
  });
  wrap('useProgram', (...args) => { program = args[0] ?? null; return useProgram(...args); });
  wrap('bindVertexArray', (...args) => { vao = args[0] ?? null; return bindVertexArray(...args); });
  wrap('deleteVertexArray', (...args) => { const [array] = args; if (live(array)) deadArrays.add(array); return deleteVertexArray(...args); });
  wrap('bufferData', (...args) => {
    const [target, data, usage] = args, buffer = typeof target === 'number' ? bound.get(target) : undefined;
    if (target === ARRAY_BUFFER && live(buffer)) {
      pending.delete(buffer);
      const was = packed.get(buffer);
      if (was !== undefined && data instanceof Float32Array && data.length === was.vertices * was.format.size) {
        // a whole new copy into a packed buffer: vertex arrays already read it packed
        const out = encode(was.format, 0, was.vertices, data);
        if (out.fits) { later(); return bufferData(target, out.bytes, usage); }
        revert(buffer, was, floats => { floats.set(data); });
        return undefined;
      }
      packed.delete(buffer);
      if (args.length === 3 && usage === STATIC_DRAW && data instanceof Float32Array && Object.getPrototypeOf(data) === Float32Array.prototype
        && data.length >= MIN_FLOATS && !pointed.has(buffer) && enabled()) {
        pending.set(buffer, { data, usage });
        later();
        return undefined;
      }
    }
    return bufferData(...args);
  });
  wrap('vertexAttribPointer', (...args) => {
    const [index, size, type, normalized, stride, offset] = args, buffer = bound.get(ARRAY_BUFFER);
    if (live(buffer)) pointed.add(buffer);
    const waiting = pending.get(buffer);
    if (waiting !== undefined) {
      const name = typeof index === 'number' ? nameOf(index) : undefined;
      const plain = type === FLOAT && normalized === false && offset === 0 && typeof size === 'number' && (stride === 0 || stride === size * 4);
      const started = diagnosticNow();
      const f = plain && name !== undefined && enabled() ? packFormat(name, waiting.data, size) : null;
      pending.delete(buffer);
      const scanned = diagnosticNow();
      let packedAt = started, bytes = waiting.data.byteLength;
      if (f === null) { packedAt = diagnosticNow(); bufferData(ARRAY_BUFFER, waiting.data, waiting.usage); }
      else {
        const vertices = waiting.data.length / f.size, out = encode(f, 0, vertices, waiting.data);
        packedAt = diagnosticNow(); bytes = out.bytes.byteLength;
        bufferData(ARRAY_BUFFER, out.bytes, waiting.usage); later();
        packed.set(buffer, { format: f, vertices, arrays: new Map() });
        vertexPackStats.buffers++; vertexPackStats.floatBytes += waiting.data.byteLength; vertexPackStats.packedBytes += out.bytes.byteLength;
      }
      const ended = diagnosticNow();
      vertexPackStats.scanMs += scanned - started; vertexPackStats.packMs += packedAt - started; vertexPackStats.uploadMs += ended - packedAt;
      if (ended - started > vertexPackStats.worst.ms) vertexPackStats.worst = { ms: ended - started, bytes, name: name ?? '?' };
    }
    const entry = packed.get(buffer);
    if (entry !== undefined && typeof index === 'number') {
      if (type === FLOAT && offset === 0 && size === entry.format.size) {
        const indices = entry.arrays.get(vao) ?? new Set(); indices.add(index); entry.arrays.set(vao, indices);
        return pointer(index, size, entry.format.type, true, entry.format.stride, 0);
      }
      console.warn('[vertex-pack] a packed buffer read with another layout', size, type, offset);
    }
    return pointer(...args);
  });
  wrap('vertexAttribIPointer', (...args) => {
    const buffer = bound.get(ARRAY_BUFFER), waiting = pending.get(buffer);
    if (live(buffer)) pointed.add(buffer);
    if (waiting !== undefined) flushOne(buffer, waiting);
    return iPointer(...args);
  });
  wrap('bufferSubData', (...args) => {
    const [target, offset, data, srcOffset, length] = args, buffer = typeof target === 'number' ? bound.get(target) : undefined;
    const waiting = pending.get(buffer);
    if (waiting !== undefined) flushOne(buffer, waiting);
    const entry = packed.get(buffer);
    if (entry === undefined || typeof offset !== 'number') return bufferSubData(...args);
    if (!(data instanceof Float32Array) || offset % 4 !== 0) throw new Error('vertex-pack: a non-float write into a packed buffer');
    const f = entry.format, first = offset / 4, from = typeof srcOffset === 'number' ? srcOffset : 0;
    const count = typeof length === 'number' && length > 0 ? length : data.length - from;
    // the floats element e holds after the write: the written span, else the caller's own array around it
    const read = (e: number): number => data[from + e - first] ?? Number.NaN;
    const v0 = Math.floor(first / f.size), v1 = Math.min(entry.vertices, Math.ceil((first + count) / f.size));
    const covered = from - (first - v0 * f.size) >= 0 && from + (v1 * f.size - first) <= data.length;
    const out = covered ? encode(f, v0, v1, data, from - first) : { bytes: new Uint8Array(0), fits: false };
    if (out.fits) { later(); return bufferSubData(target, v0 * f.stride, out.bytes); }
    revert(buffer, entry, floats => { for (let e = first; e < first + count; e++) floats[e] = read(e); });
    return undefined;
  });
  wrap('getBufferSubData', (...args) => {
    const [target, offset, data, dstOffset, length] = args, buffer = typeof target === 'number' ? bound.get(target) : undefined;
    const waiting = pending.get(buffer);
    if (waiting !== undefined) flushOne(buffer, waiting);
    const entry = packed.get(buffer);
    if (entry === undefined || typeof offset !== 'number') return getBufferSubData(...args);
    if (!(data instanceof Float32Array) || offset % 4 !== 0) throw new Error('vertex-pack: a non-float read from a packed buffer');
    const f = entry.format, first = offset / 4, at = typeof dstOffset === 'number' ? dstOffset : 0;
    const count = typeof length === 'number' && length > 0 ? length : data.length - at;
    const v0 = Math.floor(first / f.size), v1 = Math.min(entry.vertices, Math.ceil((first + count) / f.size));
    const wide = ownedArray(Uint8Array, (v1 - v0) * f.stride, STAGING);
    getBufferSubData(target, v0 * f.stride, wide);
    decode(f, wide, v0, (e, value) => { if (e >= first && e < first + count) data[at + e - first] = value; });
    return undefined;
  });
  wrap('copyBufferSubData', (...args) => {
    flushAll();
    const [read, write] = args;
    if ((typeof read === 'number' && packed.has(bound.get(read))) || (typeof write === 'number' && packed.has(bound.get(write)))) throw new Error('vertex-pack: a copy from or into a packed buffer');
    return copyBufferSubData(...args);
  });
  return true;
}

/** The page's switch: on for the phone tier unless `?vertexpack=0`. */
/** The device switch: `false` keeps every channel Float32 (the locked pairs' second arm, measure.mjs `--arm2-pin`). */
export const VERTEX_PACK_SLOT = 'debug.vertexPack';
/** Whether the page packs: the phone tier, unless `debug.vertexPack` holds false (or `false`, `off`, 0 as a capture's save). */
export function vertexPackWanted(phone: boolean, slot: unknown): boolean { return phone && slot !== false && slot !== 'false' && slot !== 'off' && slot !== 0; }
