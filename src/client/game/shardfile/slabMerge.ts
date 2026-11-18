import { Box3, BufferAttribute, BufferGeometry, Float16BufferAttribute, Sphere, Vector3 } from 'three';
import { halfAttribute } from '@wildshard/engine/models/nativeGeometry';

/**
 * NINE-DRAGON-BENCHMAX NB8 (mini-nb8e): a slab key's chunks in one bank as one geometry, for the phone. The bake caps a
 * chunk at 4 MB (`sharddev/bake/slabs.ts`), so a big key is many chunks, each its own draw of the same material under
 * the same anchor; with `WEBGL_multi_draw` and the phone's leaf cut (`slabRanges.ts`) a bigger chunk costs no
 * triangles, only its one draw. Nine's plain architecture is 12 chunks of one key: 12 draws become 1.
 *
 * Each channel is copied end to end in chunk order and the index is offset by the vertices before it (32-bit once the
 * key passes 65,535 vertices). Chunks whose channels differ in name, class, width, normalisation or storage, or that
 * carry groups, morphs or no index, are not merged (null). The chunks are left as they are; the caller drops them.
 */
export function mergeSlabChunks(chunks: readonly BufferGeometry[]): BufferGeometry | null {
  const first = chunks[0];
  if (first === undefined || chunks.length < 2) return null;
  const names = Object.keys(first.attributes).sort();
  let vertices = 0, corners = 0;
  for (const chunk of chunks) {
    const index = chunk.index;
    if (index === null || chunk.groups.length > 0 || Object.keys(chunk.morphAttributes).length > 0) return null;
    const own = Object.keys(chunk.attributes).sort();
    if (own.length !== names.length || own.some((name, at) => name !== names[at])) return null;
    for (const name of names) {
      const a = chunk.getAttribute(name), b = first.getAttribute(name);
      if (!(a instanceof BufferAttribute) || !(b instanceof BufferAttribute) || a.constructor !== b.constructor
        || a.itemSize !== b.itemSize || a.normalized !== b.normalized || a.array.constructor !== b.array.constructor
        || a.array.length !== a.count * a.itemSize) return null;
    }
    const count = chunk.getAttribute('position')?.count;
    if (count === undefined || names.some(name => chunk.getAttribute(name).count !== count)) return null;
    vertices += count; corners += index.count;
  }
  const merged = new BufferGeometry();
  for (const name of names) {
    const sample = first.getAttribute(name) as BufferAttribute;
    const Storage = sample.array.constructor as new (length: number) => BufferAttribute['array'];
    const array = new Storage(vertices * sample.itemSize);
    let at = 0;
    for (const chunk of chunks) { const source = (chunk.getAttribute(name) as BufferAttribute).array; array.set(source, at); at += source.length; }
    merged.setAttribute(name, sample instanceof Float16BufferAttribute
      ? halfAttribute(array as Uint16Array, sample.itemSize, sample.normalized)
      : new BufferAttribute(array, sample.itemSize, sample.normalized));
  }
  const index = vertices > 0xffff ? new Uint32Array(corners) : new Uint16Array(corners);
  let at = 0, base = 0;
  for (const chunk of chunks) {
    const source = chunk.index?.array ?? [], count = chunk.getAttribute('position').count;
    for (let i = 0; i < source.length; i++) index[at + i] = (source[i] ?? 0) + base;
    at += source.length; base += count;
  }
  merged.setIndex(new BufferAttribute(index, 1));
  merged.userData = { ...first.userData };
  return merged;
}

/** The merged key's frozen bounds from its chunk rows: their boxes' union, and a sphere about its centre that holds
 *  every row's sphere. */
export function mergedSlabBounds(rows: readonly { readonly box: readonly number[]; readonly sphere: readonly number[] }[]): { box: Box3; sphere: Sphere } {
  const box = new Box3(), point = new Vector3();
  for (const { box: [x0 = 0, y0 = 0, z0 = 0, x1 = 0, y1 = 0, z1 = 0] } of rows) { box.expandByPoint(point.set(x0, y0, z0)); box.expandByPoint(point.set(x1, y1, z1)); }
  const centre = box.getCenter(new Vector3());
  let radius = 0;
  for (const { sphere: [x = 0, y = 0, z = 0, r = 0] } of rows) radius = Math.max(radius, centre.distanceTo(point.set(x, y, z)) + r);
  return { box, sphere: new Sphere(centre, radius) };
}
