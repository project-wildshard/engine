import { Box3, BufferAttribute, BufferGeometry, Float16BufferAttribute, Matrix4, Sphere, Vector3, type TypedArray } from 'three';
import * as v from 'valibot';

interface Attribute { name: string; label: string; words: TypedArray; size: number; normalized: boolean; half: boolean; usage: number; gpuType: number }
interface Shape {
  name: string; attributes: Attribute[]; index: Attribute | null;
  groups: { start: number; count: number; materialIndex?: number | undefined }[];
  draw: [number, number]; box: [number, number, number, number, number, number] | null;
  sphere: [number, number, number, number] | null;
}
export type HomeGeometrySnapshot = { id: string; shape: Shape; matrix: number[] }[];
const words: v.GenericSchema<TypedArray> = v.union([v.instance(Float32Array), v.instance(Float64Array), v.instance(Uint32Array), v.instance(Int32Array),
  v.instance(Uint16Array), v.instance(Int16Array), v.instance(Uint8Array), v.instance(Uint8ClampedArray), v.instance(Int8Array)]);
const attribute: v.GenericSchema<Attribute> = v.strictObject({ name: v.pipe(v.string(), v.maxLength(128)), label: v.pipe(v.string(), v.maxLength(1024)), words, size: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(16)),
  normalized: v.boolean(), half: v.boolean(), usage: v.number(), gpuType: v.number() });
const shape: v.GenericSchema<Shape> = v.strictObject({ name: v.string(), attributes: v.pipe(v.array(attribute), v.maxLength(32)), index: v.nullable(attribute),
  groups: v.pipe(v.array(v.strictObject({ start: v.number(), count: v.number(), materialIndex: v.optional(v.number()) })), v.maxLength(512)),
  draw: v.tuple([v.number(), v.number()]), box: v.nullable(v.tuple([v.number(), v.number(), v.number(), v.number(), v.number(), v.number()])),
  sphere: v.nullable(v.tuple([v.number(), v.number(), v.number(), v.number()])) });
/** Exact completed static channels and transforms, without owners, native handles or programs. */
export const HomeGeometrySnapshotSchema: v.GenericSchema<HomeGeometrySnapshot> = v.pipe(v.array(v.strictObject({ id: v.pipe(v.string(), v.maxLength(1024)), shape,
  matrix: v.pipe(v.array(v.number()), v.length(16)) })), v.maxLength(2048));
export interface HomeGeometryView { readonly geometry: BufferGeometry; readonly matrix: Matrix4 }

function snapshotAttribute(name: string, input: BufferAttribute): Attribute | null {
  if (input.constructor !== BufferAttribute && input.constructor !== Float16BufferAttribute) return null;
  return { name, label: input.name, words: input.array, size: input.itemSize, normalized: input.normalized, half: input instanceof Float16BufferAttribute,
    usage: input.usage, gpuType: input.gpuType };
}

/** Unsupported mutable/custom geometry stays on its original decoder path. Typed words are not converted to numbers. */
export function snapshotHomeGeometry(views: ReadonlyMap<string, HomeGeometryView>): HomeGeometrySnapshot | null {
  const result: HomeGeometrySnapshot = [];
  for (const [id, { geometry, matrix }] of views) {
    if (geometry.constructor !== BufferGeometry || Object.keys(geometry.morphAttributes).length > 0 || Object.keys(geometry.userData).length > 0) return null;
    const attributes: Attribute[] = [];
    for (const [name, input] of Object.entries(geometry.attributes)) {
      if (!(input instanceof BufferAttribute)) return null;
      const row = snapshotAttribute(name, input); if (row === null) return null;
      attributes.push(row);
    }
    const input = geometry.getIndex(), index = input === null ? null : snapshotAttribute('', input);
    if (input !== null && index === null) return null;
    const box = geometry.boundingBox, sphere = geometry.boundingSphere;
    result.push({ id, matrix: matrix.elements.slice(), shape: { name: geometry.name, attributes, index,
      groups: geometry.groups.map(group => ({ ...group })), draw: [geometry.drawRange.start, geometry.drawRange.count],
      box: box === null ? null : [box.min.x, box.min.y, box.min.z, box.max.x, box.max.y, box.max.z],
      sphere: sphere === null ? null : [sphere.center.x, sphere.center.y, sphere.center.z, sphere.radius] } });
  }
  return v.is(HomeGeometrySnapshotSchema, result) ? result : null;
}

function restoreAttribute(row: Attribute): BufferAttribute {
  if (row.half && !(row.words instanceof Uint16Array)) throw new Error('Home half channel needs original uint16 bits');
  const result = row.half ? new Float16BufferAttribute(row.words, row.size, row.normalized) : new BufferAttribute(row.words, row.size, row.normalized);
  result.name = row.label;
  // These fields are Three enums; refuse future unsupported values rather than changing their meaning.
  if (row.usage !== result.usage || row.gpuType !== result.gpuType) throw new Error('Home channel profile differs');
  return result;
}

/** Restore independent owned geometry with original half bits, bounds, groups, draw range and double matrix words. */
export function restoreHomeGeometry(snapshot: HomeGeometrySnapshot): Map<string, HomeGeometryView> {
  const result = new Map<string, HomeGeometryView>();
  try {
    for (const { id, shape: row, matrix } of snapshot) {
      if (result.has(id)) throw new Error('Duplicate home geometry');
      const geometry = new BufferGeometry(); result.set(id, { geometry, matrix: new Matrix4().fromArray(matrix) });
      geometry.name = row.name;
      for (const input of row.attributes) geometry.setAttribute(input.name, restoreAttribute(input));
      if (row.index !== null) geometry.setIndex(restoreAttribute(row.index));
      for (const group of row.groups) geometry.addGroup(group.start, group.count, group.materialIndex);
      geometry.setDrawRange(...row.draw);
      if (row.box !== null) geometry.boundingBox = new Box3(new Vector3(...row.box.slice(0, 3)), new Vector3(...row.box.slice(3, 6)));
      if (row.sphere !== null) geometry.boundingSphere = new Sphere(new Vector3(row.sphere[0], row.sphere[1], row.sphere[2]), row.sphere[3]);
    }
    return result;
  } catch (error) { for (const view of result.values()) view.geometry.dispose(); throw error; }
}

/** Payload bound counts whole backing buffers once, plus bounded metadata. */
export function homeGeometryBytes(snapshot: HomeGeometrySnapshot): number {
  const buffers = new Set<ArrayBufferLike>(); let bytes = 0;
  for (const row of snapshot) {
    bytes += 512 + row.id.length * 2 + row.shape.name.length * 2 + row.shape.groups.length * 32;
    for (const attr of [...row.shape.attributes, ...row.shape.index === null ? [] : [row.shape.index]]) {
      bytes += 128 + (attr.name.length + attr.label.length) * 2;
      if (!buffers.has(attr.words.buffer)) { buffers.add(attr.words.buffer); bytes += attr.words.buffer.byteLength; }
    }
  }
  return bytes;
}
