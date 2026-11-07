import * as THREE from 'three';
import type { RngPort, RngState } from '../../../shared/engine/core/rng';

/**
 * Baked builder geometry (SF67 fix 3 part 4, E461): a code-built model's geometry, built once at `wildshard build` time and
 * read back at load instead of being built again on the main thread.
 *
 *   geometry: bakedGeometry('driftwood-isle/rock', [r, squash, moss], rng, () => rockGeometry(r, rng, { … })),
 *
 * A builder whose output is a pure function of a few numbers and an rng stream wraps that work in `bakedGeometry`. The call
 * is keyed by a 64-bit hash of its id, its inputs (quantised to 2^-30, so a last-bit difference between Node's and a
 * browser's Math never makes a miss) and the rng's state before it; the record holds the geometry's attributes, its index
 * and groups, and the rng's state after it. A native bake (scripts/bake-geometry.mjs) builds the shard's world in Node per
 * tier while `recordGeometryBake` records every call, and writes one table to the shard's own asset folder; at load the
 * shard adds the table (`withGeometryBake`) around its world build, and a hit hands back a copy of the recorded geometry
 * and moves the rng on to where the build would have left it. A miss (a different input, a missing or stale table) runs
 * `build` as before, so a miss costs time, never correctness; a stale table is caught by the bake's `--check`.
 *
 * What the wrapped `build` may do: read its inputs and draw from `rng`. Every other value it depends on (a tier knob, a
 * palette) must be in `id` or `inputs`, and it must not write anything outside the geometry it returns. On a hit it does
 * not run, so the page shows what Node built (bit for bit what V8 builds; on an engine whose Math differs in a last bit,
 * the bake's values: the one answer every platform shows, as with the voxel AO table).
 *
 * The table is indexed when it is added (a walk over the entry headers) and each entry is parsed only when it is hit, so
 * no single task parses the whole file.
 *
 * Format (little-endian): 'WSGB' · u32 version · u32 entries · per entry, 4-byte aligned: u32 hashA · u32 hashB ·
 * u32 byteLength (the entry after this word) · u8 hasRng · u8 scrambledFork · u16 attributes · u32 rngState · u32 rngInitial ·
 * u32 indexType (0 none · 1 u16 · 2 u32) · u32 indexCount · u32 groups · per group u32 start · u32 count · u32 material ·
 * per attribute: u8 nameLength · u8 itemSize · u8 normalized · u8 type (1 f32 · 2 u8 · 3 u16 · 4 u32 · 5 i8 · 6 i16 ·
 * 7 i32) · u32 count (items) · name bytes padded to 4 · data padded to 4 · then the index data padded to 4.
 */

interface BakedAttribute { readonly name: string; readonly itemSize: number; readonly normalized: boolean; readonly array: AttributeArray }
type AttributeArray = Float32Array | Uint8Array | Uint16Array | Uint32Array | Int8Array | Int16Array | Int32Array;
export interface BakedGeometry {
  readonly attributes: readonly BakedAttribute[];
  readonly index: Uint16Array | Uint32Array | null;
  readonly groups: readonly { readonly start: number; readonly count: number; readonly materialIndex: number }[];
  readonly rng: RngState | null;
}

const MAGIC = 0x42475357, VERSION = 1;
/** key → where its entry starts in the table it came from (parsed on a hit) */
const baked = new Map<string, { readonly view: DataView; readonly at: number }>();
const stats = { hits: 0, misses: 0 };
/** Build-only replacement for a recorded builder; null delegates to its original callback. */
export type GeometryBakeProducer = (id: string, inputs: readonly number[], rng: RngPort | null) => THREE.BufferGeometry | null;
let recording: Map<string, BakedGeometry> | null = null;
let recordingProducer: GeometryBakeProducer | null = null;
const _f64 = new Float64Array(1), _u32 = new Uint32Array(_f64.buffer);
const Q = 2 ** 30;

/** two FNV-1a lanes over 32-bit words (voxelAO's input hash) */
class KeyHash {
  a = 0x811c9dc5; b = 0x01000193 ^ 0x9e3779b9;
  word(w: number): void { this.a = Math.imul(this.a ^ w, 0x01000193); this.b = Math.imul(this.b ^ w, 0x5bd1e995) ^ (this.b >>> 15); }
  num(v: number): void { _f64[0] = v; this.word(_u32[0] ?? 0); this.word(_u32[1] ?? 0); }
  text(s: string): void { this.word(s.length); for (let i = 0; i < s.length; i++) this.word(s.codePointAt(i) ?? 0); }
  key(): string { return `${(this.a >>> 0).toString(16)}:${(this.b >>> 0).toString(16)}`; }
}

function keyOf(id: string, inputs: readonly number[], rng: RngState | null): string {
  const h = new KeyHash();
  h.text(id);
  h.word(inputs.length);
  for (const v of inputs) h.num(Number.isFinite(v) ? Math.round(v * Q) / Q : v);
  if (rng === null) h.word(0);
  else { h.word(1); h.word(rng.state); h.word(rng.initial); h.word(rng.scrambledFork ? 1 : 0); }
  return h.key();
}

const TYPES = [null, Float32Array, Uint8Array, Uint16Array, Uint32Array, Int8Array, Int16Array, Int32Array] as const;
function typeOf(a: AttributeArray): number {
  if (a instanceof Float32Array) return 1;
  if (a instanceof Uint8Array) return 2;
  if (a instanceof Uint16Array) return 3;
  if (a instanceof Uint32Array) return 4;
  if (a instanceof Int8Array) return 5;
  if (a instanceof Int16Array) return 6;
  return 7;
}
function arrayOf(type: number, buffer: ArrayBuffer, at: number, length: number): AttributeArray | null {
  switch (type) {
    case 1: return new Float32Array(buffer, at, length).slice();
    case 2: return new Uint8Array(buffer, at, length).slice();
    case 3: return new Uint16Array(buffer, at, length).slice();
    case 4: return new Uint32Array(buffer, at, length).slice();
    case 5: return new Int8Array(buffer, at, length).slice();
    case 6: return new Int16Array(buffer, at, length).slice();
    case 7: return new Int32Array(buffer, at, length).slice();
    default: return null;
  }
}
const pad4 = (n: number): number => (n + 3) & ~3;

/** The geometry `build` returns, or the bake's copy of it (see the module comment). */
export function bakedGeometry(id: string, inputs: readonly number[], rng: RngPort | null, build: () => THREE.BufferGeometry): THREE.BufferGeometry {
  if (baked.size === 0 && recording === null) return build();
  const key = keyOf(id, inputs, rng === null ? null : rng.snapshot());
  if (recording === null) {
    const at = baked.get(key);
    const hit = at === undefined ? null : parseEntry(at.view, at.at);
    if (hit !== null && (hit.rng === null) === (rng === null)) {
      stats.hits++;
      if (rng !== null && hit.rng !== null) rng.restore(hit.rng);
      return toGeometry(hit);
    }
    stats.misses++;
    return build();
  }
  const g = recordingProducer?.(id, inputs, rng) ?? build();
  const rec = fromGeometry(g, rng === null ? null : rng.snapshot());
  if (rec !== null && !recording.has(key)) recording.set(key, rec);
  return g;
}

function toGeometry(b: BakedGeometry): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  for (const a of b.attributes) g.setAttribute(a.name, new THREE.BufferAttribute(a.array, a.itemSize, a.normalized));
  if (b.index !== null) g.setIndex(new THREE.BufferAttribute(b.index, 1));
  for (const gr of b.groups) g.addGroup(gr.start, gr.count, gr.materialIndex);
  return g;
}

/** a geometry as a record, or null when it carries what the table cannot hold (interleaved or morph attributes) */
function fromGeometry(g: THREE.BufferGeometry, rng: RngState | null): BakedGeometry | null {
  if (Object.keys(g.morphAttributes).length > 0) return null;
  const attributes: BakedAttribute[] = [];
  for (const [name, a] of Object.entries(g.attributes)) {
    if (!(a instanceof THREE.BufferAttribute) || name.length > 255) return null;
    const arr: unknown = a.array;
    if (!(arr instanceof Float32Array || arr instanceof Uint8Array || arr instanceof Uint16Array || arr instanceof Uint32Array || arr instanceof Int8Array || arr instanceof Int16Array || arr instanceof Int32Array)) return null;
    attributes.push({ name, itemSize: a.itemSize, normalized: a.normalized, array: arr.slice(0, a.count * a.itemSize) });
  }
  const ix = g.getIndex();
  let index: Uint16Array | Uint32Array | null = null;
  if (ix !== null) {
    const arr: unknown = ix.array;
    if (arr instanceof Uint16Array || arr instanceof Uint32Array) index = arr.slice(0, ix.count);
    else return null;
  }
  return { attributes, index, groups: g.groups.map((gr) => ({ start: gr.start, count: gr.count, materialIndex: gr.materialIndex ?? 0 })), rng };
}

function parseEntry(v: DataView, at: number): BakedGeometry | null {
  try {
    const hasRng = v.getUint8(at + 12) === 1, scrambledFork = v.getUint8(at + 13) === 1, nAttr = v.getUint16(at + 14, true);
    const rng: RngState | null = hasRng ? { version: 1, state: v.getUint32(at + 16, true), initial: v.getUint32(at + 20, true), scrambledFork } : null;
    const indexType = v.getUint32(at + 24, true), indexCount = v.getUint32(at + 28, true), nGroups = v.getUint32(at + 32, true);
    let o = at + 36;
    const groups: { start: number; count: number; materialIndex: number }[] = [];
    for (let i = 0; i < nGroups; i++, o += 12) groups.push({ start: v.getUint32(o, true), count: v.getUint32(o + 4, true), materialIndex: v.getUint32(o + 8, true) });
    const attributes: BakedAttribute[] = [];
    const buffer = v.buffer instanceof ArrayBuffer ? v.buffer : null;
    if (buffer === null) return null;
    for (let i = 0; i < nAttr; i++) {
      const nameLength = v.getUint8(o), itemSize = v.getUint8(o + 1), normalized = v.getUint8(o + 2) === 1, type = v.getUint8(o + 3), count = v.getUint32(o + 4, true);
      o += 8;
      let name = '';
      for (let c = 0; c < nameLength; c++) name += String.fromCodePoint(v.getUint8(o + c));
      o += pad4(nameLength);
      const T = TYPES[type];
      if (T === undefined || T === null) return null;
      const array = arrayOf(type, buffer, v.byteOffset + o, count * itemSize);
      if (array === null) return null;
      o += pad4(count * itemSize * T.BYTES_PER_ELEMENT);
      attributes.push({ name, itemSize, normalized, array });
    }
    let index: Uint16Array | Uint32Array | null = null;
    if (indexType === 1) index = new Uint16Array(buffer, v.byteOffset + o, indexCount).slice();
    else if (indexType === 2) index = new Uint32Array(buffer, v.byteOffset + o, indexCount).slice();
    return { attributes, index, groups, rng };
  } catch {
    return null;
  }
}

/** Index a baked table (scripts/bake-geometry.mjs's bytes) for the builds that follow; the returned function drops it again.
 *  Bytes that do not parse add nothing (every call then builds, as it would with no bake). */
export function addGeometryBake(bytes: ArrayBuffer | null): () => void {
  if (bytes === null || bytes.byteLength < 12) return () => undefined;
  const v = new DataView(bytes);
  if (v.getUint32(0, true) !== MAGIC || v.getUint32(4, true) !== VERSION) return () => undefined;
  const added: string[] = [];
  let o = 12;
  for (let e = v.getUint32(8, true); e > 0 && o + 12 <= bytes.byteLength; e--) {
    const key = `${v.getUint32(o, true).toString(16)}:${v.getUint32(o + 4, true).toString(16)}`, length = v.getUint32(o + 8, true);
    if (o + 12 + length > bytes.byteLength) break;
    if (!baked.has(key)) { baked.set(key, { view: v, at: o }); added.push(key); }
    o += 12 + length;
  }
  return () => { for (const key of added) baked.delete(key); };
}

/** Run a world build with the baked table at `url` added (fetched first; a missing or unreadable file adds nothing, so every
 *  call builds as before), and drop the table once the build is done. */
export async function withGeometryBake<T>(url: string, build: () => Promise<T>): Promise<T> {
  const bytes = await fetch(url).then((r) => (r.ok ? r.arrayBuffer() : null), () => null);
  const drop = addGeometryBake(bytes);
  try { return await build(); } finally { drop(); }
}

/** A baked table's entries, or null when the bytes are not one (the bake's tier merge reads it). */
export function decodeGeometryBake(bytes: ArrayBuffer): Map<string, BakedGeometry> | null {
  if (bytes.byteLength < 12) return null;
  const v = new DataView(bytes);
  if (v.getUint32(0, true) !== MAGIC || v.getUint32(4, true) !== VERSION) return null;
  const out = new Map<string, BakedGeometry>();
  let o = 12;
  for (let e = v.getUint32(8, true); e > 0; e--) {
    if (o + 12 > bytes.byteLength) return null;
    const key = `${v.getUint32(o, true).toString(16)}:${v.getUint32(o + 4, true).toString(16)}`, length = v.getUint32(o + 8, true);
    const entry = parseEntry(v, o);
    if (entry === null) return null;
    out.set(key, entry);
    o += 12 + length;
  }
  return out;
}

/** The native bake's recorder: every `bakedGeometry` result from now until `stop()`, keyed by its inputs' hash (a recorder
 *  always builds: the bake is the code's own output, never a copy of an older table). An optional build-only producer
 *  supplies raw geometry after a runtime builder has retired its procedural fallback; inputs and RNG still form the key. */
export function recordGeometryBake(producer?: GeometryBakeProducer): { readonly entries: ReadonlyMap<string, BakedGeometry>; stop: () => void } {
  const entries = new Map<string, BakedGeometry>();
  recording = entries;
  recordingProducer = producer ?? null;
  return { entries, stop: () => { if (recording === entries) { recording = null; recordingProducer = null; } } };
}

/** The table's bytes, entries in key order (a byte-stable bake). */
export function encodeGeometryBake(entries: ReadonlyMap<string, BakedGeometry>): Uint8Array {
  const parts: Uint8Array[] = [];
  for (const key of [...entries.keys()].sort()) {
    const g = entries.get(key);
    if (g === undefined) continue;
    let size = 36 + g.groups.length * 12;
    for (const a of g.attributes) size += 8 + pad4(a.name.length) + pad4(a.array.byteLength);
    if (g.index !== null) size += pad4(g.index.byteLength);
    const b = new Uint8Array(size), v = new DataView(b.buffer);
    const [ha = '0', hb = '0'] = key.split(':');
    v.setUint32(0, Number.parseInt(ha, 16), true); v.setUint32(4, Number.parseInt(hb, 16), true); v.setUint32(8, size - 12, true);
    v.setUint8(12, g.rng === null ? 0 : 1); v.setUint8(13, g.rng?.scrambledFork === true ? 1 : 0); v.setUint16(14, g.attributes.length, true);
    v.setUint32(16, g.rng?.state ?? 0, true); v.setUint32(20, g.rng?.initial ?? 0, true);
    v.setUint32(24, g.index === null ? 0 : g.index instanceof Uint16Array ? 1 : 2, true); v.setUint32(28, g.index?.length ?? 0, true);
    v.setUint32(32, g.groups.length, true);
    let o = 36;
    for (const gr of g.groups) { v.setUint32(o, gr.start, true); v.setUint32(o + 4, gr.count, true); v.setUint32(o + 8, gr.materialIndex, true); o += 12; }
    for (const a of g.attributes) {
      v.setUint8(o, a.name.length); v.setUint8(o + 1, a.itemSize); v.setUint8(o + 2, a.normalized ? 1 : 0); v.setUint8(o + 3, typeOf(a.array));
      v.setUint32(o + 4, a.array.length / a.itemSize, true);
      o += 8;
      for (let c = 0; c < a.name.length; c++) v.setUint8(o + c, a.name.codePointAt(c) ?? 0);
      o += pad4(a.name.length);
      b.set(new Uint8Array(a.array.buffer, a.array.byteOffset, a.array.byteLength), o);
      o += pad4(a.array.byteLength);
    }
    if (g.index !== null) b.set(new Uint8Array(g.index.buffer, g.index.byteOffset, g.index.byteLength), o);
    parts.push(b);
  }
  const out = new Uint8Array(parts.reduce((n, b) => n + b.length, 12)), hv = new DataView(out.buffer);
  hv.setUint32(0, MAGIC, true); hv.setUint32(4, VERSION, true); hv.setUint32(8, parts.length, true);
  let o = 12;
  for (const b of parts) { out.set(b, o); o += b.length; }
  return out;
}

/** how many `bakedGeometry` calls the bake answered and how many built since the page loaded (the load benchmark reads it) */
export function geometryBakeStats(): { readonly hits: number; readonly misses: number; readonly entries: number } {
  return { hits: stats.hits, misses: stats.misses, entries: baked.size };
}
