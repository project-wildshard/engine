import { BufferAttribute, BufferGeometry, Float16BufferAttribute } from 'three';
import { geometryBoundsSteps } from '@wildshard/engine/world/geometryBounds';

// The geometry bake codec alone (GR6): build-time producers read and write bakes without the page's plugin module and
// its product loading; `./geometry` serves the same functions to the page.

// Built geometry as an offline bake stores it (SHARD-PLATFORM M3, the kit system): each attribute's typed array exactly
// as the builder made it (float, half, normalized bytes), so a baked kit draws the same bytes the page's own build would
// have; and `appendGeometry`, which puts what the page adds to a baked builder after its bake.


/** an attribute's element type in the bake ('f16' is a half float held in a Uint16Array, Float16BufferAttribute) */
export type BakedType = 'f32' | 'f16' | 'u16' | 'i8' | 'u8';
/** one baked geometry: its attributes [name, type, item size, normalized], vertex count, index (stored as deltas) */
export interface BakedGeometryRow {
  readonly attrs: readonly (readonly [string, BakedType, number, boolean])[];
  readonly count: number;
  readonly index: 'u16' | 'u32' | null;
  readonly indexCount: number;
  /** whether the builder computed its bounding box (every one computes its sphere) */
  readonly box: boolean;
}

/** bytes per element of each baked type */
export const BAKED_BYTES: Readonly<Record<BakedType, number>> = { f32: 4, f16: 2, u16: 2, i8: 1, u8: 1 };

/** a block's length padded to 4 bytes */
export const pad4 = (n: number): number => Math.ceil(n / 4) * 4;

/** the bytes a row's blocks take in the bake (each attribute, then the index as int32 deltas, 4-byte aligned) */
export function bakedGeometryBytes(row: BakedGeometryRow): number {
  let n = 0;
  for (const [, type, size] of row.attrs) n += pad4(row.count * size * BAKED_BYTES[type]);
  return n + (row.index === null ? 0 : row.indexCount * 4);
}

/** one baked attribute block at `offset`, `count` vertices: a copy the attribute owns (as `readBakedGeometry` reads each) */
export function readBakedAttribute(bytes: Uint8Array, offset: number, count: number, attr: BakedGeometryRow['attrs'][number]): BufferAttribute {
  const [, type, size, normalized] = attr, buffer = bytes.slice(offset, offset + count * size * BAKED_BYTES[type]).buffer;
  if (type === 'f32') return new BufferAttribute(new Float32Array(buffer), size, normalized);
  if (type === 'f16') return new Float16BufferAttribute(new Uint16Array(buffer), size, normalized);
  if (type === 'u16') return new BufferAttribute(new Uint16Array(buffer), size, normalized);
  if (type === 'i8') return new BufferAttribute(new Int8Array(buffer), size, normalized);
  return new BufferAttribute(new Uint8Array(buffer), size, normalized);
}

/** read geometry `row` from `bytes` at `offset` (the arrays are copies the geometry owns) */
export function readBakedGeometry(bytes: Uint8Array, offset: number, row: BakedGeometryRow): BufferGeometry {
  const g = new BufferGeometry();
  let at = offset;
  const copy = (length: number): ArrayBuffer => { const b = bytes.slice(at, at + length).buffer; at += pad4(length); return b; };
  for (const attr of row.attrs) {
    const [name, type, size] = attr;
    g.setAttribute(name, readBakedAttribute(bytes, at, row.count, attr)); at += pad4(row.count * size * BAKED_BYTES[type]);
  }
  if (row.index !== null) {
    const deltas = new Int32Array(copy(row.indexCount * 4));
    const index = row.index === 'u16' ? new Uint16Array(row.indexCount) : new Uint32Array(row.indexCount);
    let last = 0;
    for (let i = 0; i < deltas.length; i++) { last += deltas[i] ?? 0; index[i] = last; }
    g.setIndex(new BufferAttribute(index, 1));
  }
  // The baked read owns plain attributes. Reuse the exact packed scanner instead of scanning
  // through accessors again for the optional box; this public decoder remains synchronous.
  const bounds = geometryBoundsSteps(g, row.box ? 'both' : 'sphere');
  while (!bounds.next().done) { /* exhaust before publishing the owned geometry */ }
  return g;
}

/** a typed array of `a`'s kind holding `a` then `b` */
function joined(a: BufferAttribute['array'], b: BufferAttribute['array']): BufferAttribute['array'] {
  if (a instanceof Float32Array && b instanceof Float32Array) { const o = new Float32Array(a.length + b.length); o.set(a); o.set(b, a.length); return o; }
  if (a instanceof Uint16Array && b instanceof Uint16Array) { const o = new Uint16Array(a.length + b.length); o.set(a); o.set(b, a.length); return o; }
  if (a instanceof Uint32Array && b instanceof Uint32Array) { const o = new Uint32Array(a.length + b.length); o.set(a); o.set(b, a.length); return o; }
  if (a instanceof Int8Array && b instanceof Int8Array) { const o = new Int8Array(a.length + b.length); o.set(a); o.set(b, a.length); return o; }
  if (a instanceof Uint8Array && b instanceof Uint8Array) { const o = new Uint8Array(a.length + b.length); o.set(a); o.set(b, a.length); return o; }
  throw new Error('kit: a baked geometry and its additions differ in an attribute type');
}

/**
 * `a` (a baked builder's geometry) with `b` (what the page added to that builder since, built by it) after it: the same
 * attributes in the same types, `b`'s indices already counting `a`'s vertices (the builder numbers on from the bake).
 * The index widens to 32 bits once the whole passes 65 535 vertices, as the builder's own choice would.
 */
export function appendGeometry(a: BufferGeometry, b: BufferGeometry): BufferGeometry {
  const g = new BufferGeometry();
  for (const [name, attr] of Object.entries(a.attributes)) {
    const tail = b.getAttribute(name);
    if (!(attr instanceof BufferAttribute) || !(tail instanceof BufferAttribute) || tail.itemSize !== attr.itemSize) throw new Error(`kit: '${name}' does not append to its bake`);
    const array = joined(attr.array, tail.array);
    g.setAttribute(name, attr instanceof Float16BufferAttribute ? new Float16BufferAttribute(array, attr.itemSize, attr.normalized) : new BufferAttribute(array, attr.itemSize, attr.normalized));
  }
  const ia = a.index, ib = b.index;
  if (ia !== null && ib !== null) {
    const count = a.getAttribute('position').count + b.getAttribute('position').count;
    const index = ia.array instanceof Uint16Array && count < 65536 ? new Uint16Array(ia.count + ib.count) : new Uint32Array(ia.count + ib.count);
    for (let i = 0; i < ia.count; i++) index[i] = ia.getX(i);
    for (let i = 0; i < ib.count; i++) index[ia.count + i] = ib.getX(i);
    g.setIndex(new BufferAttribute(index, 1));
  }
  g.computeBoundingSphere();
  return g;
}
