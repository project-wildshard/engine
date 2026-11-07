import { Box3, BufferAttribute, BufferGeometry, Float16BufferAttribute, InterleavedBufferAttribute, type TypedArray, Material, Mesh, Matrix3, type Matrix4, Vector3, type Object3D } from 'three';
import { nativeWholeGeometry } from './nativeGeometry';

function isGeometryMesh(node: Object3D): node is Mesh {
  if (!(node instanceof Mesh)) return false;
  const geometry: unknown = node.geometry, material: unknown = node.material;
  return geometry instanceof BufferGeometry && (material instanceof Material || (Array.isArray(material) && material.every((item: unknown) => item instanceof Material)));
}

/** iPhone downloads I3: a phone-tier model whose positions are 16-bit integers on its own grid (KHR_mesh_quantization):
 *  its node carries only the grid's uniform scale and translation (compactPhoneGlb), no rotation. */
function gridQuantized(mesh: Mesh): boolean {
  const position = mesh.geometry.getAttribute('position'), e = mesh.matrixWorld.elements;
  // a padded 8-byte stride reads back interleaved; either way the storage is normalized Int16
  const array: unknown = 'isInterleavedBufferAttribute' in position ? position.data.array : position.array;
  if (!(array instanceof Int16Array) || !position.normalized) return false;
  const scale = e[0];
  return scale !== undefined && scale > 0 && e[5] === scale && e[10] === scale && e[15] === 1
    && [1, 2, 3, 4, 6, 7, 8, 9, 11].every(i => e[i] === 0);
}
/** Float positions back in the model's own space: the grid scale and translation baked in, the node left out (every
 *  intake reader draws a baked model in identity space). Normals and colours keep their compact normalized storage. */
function getters(prototype: object): readonly unknown[] { return ['getX', 'getY', 'getZ'].map((name): unknown => Reflect.get(prototype, name)); }
const positionGetters = getters(BufferAttribute.prototype), interleavedGetters = getters(InterleavedBufferAttribute.prototype);
const computeBox: unknown = Reflect.get(BufferGeometry.prototype, 'computeBoundingBox'), computeSphere: unknown = Reflect.get(BufferGeometry.prototype, 'computeBoundingSphere');
const geometryTransform: unknown = Reflect.get(BufferGeometry.prototype, 'applyMatrix4'), plainTransform: unknown = Reflect.get(BufferAttribute.prototype, 'applyMatrix4');
const geometryRead: unknown = Reflect.get(BufferGeometry.prototype, 'getAttribute'), geometryWrite: unknown = Reflect.get(BufferGeometry.prototype, 'setAttribute');
const normalTransforms: readonly unknown[] = [Reflect.get(BufferAttribute.prototype, 'applyNormalMatrix'), Reflect.get(InterleavedBufferAttribute.prototype, 'applyNormalMatrix')];
const normalWrites: readonly unknown[] = [Reflect.get(BufferAttribute.prototype, 'setXYZ'), Reflect.get(InterleavedBufferAttribute.prototype, 'setXYZ')];
const plainVersionSetter: unknown = Reflect.get(Object.getOwnPropertyDescriptor(BufferAttribute.prototype, 'needsUpdate') ?? {}, 'set');
const vectorMethods = ['fromBufferAttribute', 'applyNormalMatrix', 'applyMatrix3', 'normalize', 'divideScalar', 'multiplyScalar', 'length'] as const;
const vectorFunctions = vectorMethods.map((name): unknown => Reflect.get(Vector3.prototype, name));
const matrixMethods = ['getNormalMatrix', 'setFromMatrix4', 'invert', 'transpose'] as const;
const matrixFunctions = matrixMethods.map((name): unknown => Reflect.get(Matrix3.prototype, name));
const normalMath = [Math.max, Math.round, Math.sqrt];
interface CompactNormal {
  readonly attribute: BufferAttribute | InterleavedBufferAttribute;
  readonly array: Int8Array; readonly count: number; readonly stride: number; readonly offset: number;
}
/** Only native compact storage takes raw reads/writes; custom transforms,
 * accessors, tangents and other channel formats keep Three's original pass. */
function compactNormal(geometry: BufferGeometry): CompactNormal | undefined {
  if (geometry.getAttribute !== geometryRead || geometry.setAttribute !== geometryWrite) return undefined;
  const attribute = geometry.getAttribute('normal');
  if (!(attribute instanceof BufferAttribute || attribute instanceof InterleavedBufferAttribute)
    || geometry.getAttribute('tangent') !== undefined || geometry.applyMatrix4 !== geometryTransform
    || BufferAttribute.prototype.applyMatrix4 !== plainTransform || BufferAttribute.prototype.applyNormalMatrix !== normalTransforms[0]
    || Object.getOwnPropertyDescriptor(BufferAttribute.prototype, 'needsUpdate')?.set !== plainVersionSetter
    || vectorMethods.some((name, index) => Vector3.prototype[name] !== vectorFunctions[index])
    || matrixMethods.some((name, index) => Matrix3.prototype[name] !== matrixFunctions[index])
    || Math.max !== normalMath[0] || Math.round !== normalMath[1] || Math.sqrt !== normalMath[2]) return undefined;
  const interleaved = attribute instanceof InterleavedBufferAttribute, storage = interleaved ? attribute.data : attribute;
  const array = storage.array, count = attribute.count, stride = interleaved ? attribute.data.stride : attribute.itemSize, offset = interleaved ? attribute.offset : 0;
  const readers = interleaved ? interleavedGetters : positionGetters, kind = interleaved ? 1 : 0;
  if (Object.getPrototypeOf(attribute) !== (interleaved ? InterleavedBufferAttribute.prototype : BufferAttribute.prototype)
    || !ArrayBuffer.isView(array) || !(array instanceof Int8Array) || Object.getPrototypeOf(array) !== Int8Array.prototype
    || Object.hasOwn(array, 'constructor') || Object.getOwnPropertyDescriptor(Int8Array.prototype, 'constructor')?.value !== Int8Array
    || !Number.isInteger(count) || count < 0 || !Number.isInteger(stride) || stride < attribute.itemSize
    || (attribute.itemSize !== 3 && attribute.itemSize !== 4) || !Number.isInteger(offset) || offset < 0 || offset + attribute.itemSize > stride
    || attribute.applyNormalMatrix !== normalTransforms[kind] || attribute.setXYZ !== normalWrites[kind]
    || attribute.getX !== readers[0] || attribute.getY !== readers[1] || attribute.getZ !== readers[2]
    || Object.getOwnPropertyDescriptor(attribute, 'normalized')?.value !== true
    || Object.getOwnPropertyDescriptor(attribute, 'itemSize')?.value !== attribute.itemSize
    || Object.getOwnPropertyDescriptor(storage, 'array')?.value !== array
    || Object.getOwnPropertyDescriptor(storage, 'count')?.value !== count
    || (interleaved && (Object.hasOwn(attribute, 'count') || Object.getOwnPropertyDescriptor(attribute, 'data')?.value !== storage
      || Object.getOwnPropertyDescriptor(storage, 'stride')?.value !== stride || Object.getOwnPropertyDescriptor(attribute, 'offset')?.value !== offset))) return undefined;
  return { attribute, array, count, stride, offset };
}
function restoreCompactNormal(normal: CompactNormal, matrix: Matrix4): void {
  const transform = new Matrix3().getNormalMatrix(matrix), point = new Vector3();
  const { array, count, stride, offset } = normal;
  for (let i = 0, at = offset; i < count; i++, at += stride) {
    point.x = Math.max((array[at] ?? Number.NaN) / 127, -1);
    point.y = Math.max((array[at + 1] ?? Number.NaN) / 127, -1);
    point.z = Math.max((array[at + 2] ?? Number.NaN) / 127, -1);
    // Keep Three's exact matrix/normalization arithmetic and Int8 stores.
    point.applyNormalMatrix(transform);
    array[at] = Math.round(point.x * 127); array[at + 1] = Math.round(point.y * 127); array[at + 2] = Math.round(point.z * 127);
  }
}
function dequantizeIntoSpace(geometry: BufferGeometry, mesh: Mesh): void {
  const position = geometry.getAttribute('position'), out = new Float32Array(position.count * 3), point = new Vector3();
  const box = geometry.boundingBox, sphere = geometry.boundingSphere;
  const nativeGetters = position instanceof InterleavedBufferAttribute ? interleavedGetters : positionGetters;
  const plainReads = position.getX === nativeGetters[0] && position.getY === nativeGetters[1] && position.getZ === nativeGetters[2];
  const source = position instanceof InterleavedBufferAttribute ? position.data.array : position.array;
  const stride = position instanceof InterleavedBufferAttribute ? position.data.stride : position.itemSize;
  const offset = position instanceof InterleavedBufferAttribute ? position.offset : 0;
  const positionStorage = position instanceof InterleavedBufferAttribute ? position.data : position;
  const numericReads = plainReads && source instanceof Int16Array && Object.getPrototypeOf(source) === Int16Array.prototype
    && !Object.hasOwn(source, 'constructor') && Object.getOwnPropertyDescriptor(Int16Array.prototype, 'constructor')?.value === Int16Array
    && Object.getOwnPropertyDescriptor(positionStorage, 'array')?.value === source
    && Object.getOwnPropertyDescriptor(positionStorage, position instanceof InterleavedBufferAttribute ? 'stride' : 'itemSize')?.value === stride
    && Object.getOwnPropertyDescriptor(position, 'normalized')?.value === true
    && (!(position instanceof InterleavedBufferAttribute) || Object.getOwnPropertyDescriptor(position, 'offset')?.value === offset);
  // The restored plain Float32 positions have no morph contribution in the
  // ordinary static case. Keep custom getter/bounds and morph semantics below.
  const scanBounds = (box !== null || sphere !== null) && geometry.morphAttributes.position === undefined
    && geometry.computeBoundingBox === computeBox && geometry.computeBoundingSphere === computeSphere
    && BufferAttribute.prototype.getX === positionGetters[0] && BufferAttribute.prototype.getY === positionGetters[1] && BufferAttribute.prototype.getZ === positionGetters[2];
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  // Preserve the old normalized -> Float32 -> matrix -> Float32 rounding,
  // without writing and rereading a temporary position for every vertex.
  for (let i = 0; i < position.count; i++) {
    const at = offset + i * stride, x = numericReads ? source[at] : undefined;
    const y = numericReads ? source[at + 1] : undefined, z = numericReads ? source[at + 2] : undefined;
    if (x === undefined || y === undefined || z === undefined) point.set(Math.fround(position.getX(i)), Math.fround(position.getY(i)), Math.fround(position.getZ(i)));
    else point.set(Math.fround(Math.max(x / 32767, -1)), Math.fround(Math.max(y / 32767, -1)), Math.fround(Math.max(z / 32767, -1)));
    point.applyMatrix4(mesh.matrixWorld);
    out[i * 3] = point.x; out[i * 3 + 1] = point.y; out[i * 3 + 2] = point.z;
    if (scanBounds) {
      const px = Math.fround(point.x), py = Math.fround(point.y), pz = Math.fround(point.z);
      minX = Math.min(minX, px); minY = Math.min(minY, py); minZ = Math.min(minZ, pz);
      maxX = Math.max(maxX, px); maxY = Math.max(maxY, py); maxZ = Math.max(maxZ, pz);
    }
  }
  const restored = new BufferAttribute(out, 3);
  // Three still owns all other channel transforms. Bounds must see the final
  // positions, once, after that pass; their original objects remain borrowed.
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(0), 3)); geometry.boundingBox = null; geometry.boundingSphere = null;
  const normal = compactNormal(geometry);
  // Overwrite rather than delete: application-channel insertion order is part
  // of the retained geometry contract. No tangent/custom path is moved here.
  if (normal !== undefined) geometry.setAttribute('normal', new BufferAttribute(new Float32Array(0), 3));
  try {
    geometry.applyMatrix4(mesh.matrixWorld);
    if (normal !== undefined) {
      restoreCompactNormal(normal, mesh.matrixWorld);
      geometry.setAttribute('normal', normal.attribute); normal.attribute.needsUpdate = true;
    }
  } finally {
    geometry.setAttribute('position', restored); geometry.boundingBox = box; geometry.boundingSphere = sphere;
    if (normal !== undefined) geometry.setAttribute('normal', normal.attribute);
  }
  restored.needsUpdate = true;
  if (scanBounds && [minX, minY, minZ, maxX, maxY, maxZ].every(Number.isFinite)) {
    const bounds = box ?? new Box3();
    bounds.min.set(minX, minY, minZ); bounds.max.set(maxX, maxY, maxZ);
    if (sphere !== null) {
      bounds.getCenter(sphere.center);
      let radiusSq = 0;
      for (let i = 0; i < out.length; i += 3) {
        const dx = (out[i] ?? Number.NaN) - sphere.center.x, dy = (out[i + 1] ?? Number.NaN) - sphere.center.y, dz = (out[i + 2] ?? Number.NaN) - sphere.center.z;
        radiusSq = Math.max(radiusSq, dx * dx + dy * dy + dz * dz);
      }
      sphere.radius = Math.sqrt(radiusSq);
    }
  } else {
    if (box !== null) geometry.computeBoundingBox();
    if (sphere !== null) geometry.computeBoundingSphere();
  }
}
/** A grid-quantized mesh (`gridQuantized`) as a plain identity-space copy: positions baked into the model's own space and
 *  every other channel (normalized Int8 normals and Uint8 colours, and the interleaved views its writer shares) copied
 *  to its own plain Float32 attribute, for readers that take only ordinary Float32 meshes (the rest geometry pools); null
 *  for any other mesh, which those readers keep as it is. */
export function identitySpaceGeometry(mesh: Mesh): BufferGeometry | null {
  if (!gridQuantized(mesh)) return null;
  const geometry = mesh.geometry.clone();
  dequantizeIntoSpace(geometry, mesh);
  for (const [name, attribute] of Object.entries(geometry.attributes)) {
    if (name === 'position' || (attribute instanceof BufferAttribute && attribute.array instanceof Float32Array && !attribute.normalized)) continue;
    const out = new Float32Array(attribute.count * attribute.itemSize);
    for (let i = 0; i < attribute.count; i++) for (let c = 0; c < attribute.itemSize; c++) out[i * attribute.itemSize + c] = attribute.getComponent(i, c);
    geometry.setAttribute(name, new BufferAttribute(out, attribute.itemSize));
  }
  return geometry;
}

const raw = (attribute: BufferAttribute): Uint8Array => new Uint8Array(attribute.array.buffer, attribute.array.byteOffset, attribute.array.byteLength);
const storage = (value: unknown): value is (new(buffer: ArrayBuffer) => TypedArray) => [Float32Array, Float64Array, Uint32Array, Int32Array, Uint16Array, Int16Array, Uint8Array, Int8Array, Uint8ClampedArray].some(type => type === value);
function appendAttributes(parts: readonly BufferAttribute[]): BufferAttribute {
  const first = parts[0]; if (first === undefined) throw new Error('Missing geometry channel segment');
  const Constructor = first.array.constructor;
  if (!storage(Constructor) || parts.some(part => part.itemSize !== first.itemSize || part.normalized !== first.normalized || part.array.constructor !== Constructor || (part instanceof Float16BufferAttribute) !== (first instanceof Float16BufferAttribute))) throw new Error('Geometry segment channel storage differs');
  const bytes = new Uint8Array(parts.reduce((sum, part) => sum + part.array.byteLength, 0));
  let at = 0; for (const part of parts) { bytes.set(raw(part), at); at += part.array.byteLength; }
  const array = new Constructor(bytes.buffer);
  const result = first instanceof Float16BufferAttribute && array instanceof Uint16Array ? new Float16BufferAttribute(array, first.itemSize, first.normalized) : new BufferAttribute(array, first.itemSize, first.normalized);
  result.name = first.name; result.gpuType = first.gpuType; result.setUsage(first.usage); return result;
}
/** Restore physical storage segments into one native draw, without welding or changing index words. */
function restoreSegments(parts: readonly BufferGeometry[]): BufferGeometry {
  const first = parts[0]; if (first === undefined) throw new Error('Missing geometry segment');
  const names = Object.keys(first.attributes).sort(), indexed = first.index !== null;
  const attributes = new Map<string, BufferAttribute[]>();
  for (const part of parts) {
    if (JSON.stringify(Object.keys(part.attributes).sort()) !== JSON.stringify(names) || (part.index !== null) !== indexed) throw new Error('Geometry segment topology differs');
    for (const name of names) {
      const attribute = part.getAttribute(name); if (!(attribute instanceof BufferAttribute)) throw new Error('Geometry segments need plain channels');
      const channels = attributes.get(name) ?? [], original = channels[0];
      if (original !== undefined && (attribute.itemSize !== original.itemSize || attribute.normalized !== original.normalized || attribute.array.constructor !== original.array.constructor || (attribute instanceof Float16BufferAttribute) !== (original instanceof Float16BufferAttribute))) throw new Error('Geometry segment channel storage differs');
      if (indexed && original !== undefined) { const a = raw(original), b = raw(attribute); if (a.length !== b.length || a.some((word, i) => word !== b[i])) throw new Error('Indexed geometry segment vertices differ'); }
      channels.push(attribute); attributes.set(name, channels);
    }
  }
  const indices = parts.flatMap(part => part.index === null ? [] : [part.index]);
  const bytes = [...attributes.values()].reduce((sum, channels) => sum + channels.slice(0, indexed ? 1 : channels.length).reduce((total, channel) => total + channel.array.byteLength, 0), 0) + indices.reduce((sum, index) => sum + index.array.byteLength, 0);
  if (bytes > 25_000_000) throw new Error('Restored geometry byte cap');
  if (indices.some(index => index.itemSize !== 1 || index.normalized || index.count % 3 !== 0)) throw new Error('Geometry segment index storage differs');
  const result = new BufferGeometry();
  for (const [name, channels] of attributes) {
    const firstChannel = channels[0]; if (firstChannel === undefined) throw new Error('Missing geometry channel segment');
    result.setAttribute(name, indexed ? firstChannel.clone() : appendAttributes(channels));
  }
  if (indexed) result.setIndex(appendAttributes(indices));
  return result;
}

/** Offline model geometry intake. Load once before synchronous model placement, then take independent mutable copies.
 * Materials, animation and colliders stay with their existing runtime owners. No services are installed on import. */
export interface OwnedGeometry {
  /** Load immutable GLB storage. Optional ordered segments restore one native geometry;
   * indexed segments repeat identical vertex bytes and carry consecutive original index slices. */
  load: (bytes?: Uint8Array | BufferGeometry, segments?: readonly Uint8Array[]) => Promise<void>;
  /** Adopt an already owned geometry without copying; only an unloaded intake accepts it. */
  adopt: (geometry: BufferGeometry) => void;
  /** A deep attribute copy, safe to scale, merge, change collectible slots or release after GPU upload. */
  copy: () => BufferGeometry;
  /** Transfer a template into one owner; neither loader nor cache retains its attributes afterwards. */
  take: () => BufferGeometry;
}

/** A single identity-space, unquantized baked triangle mesh. Custom GLB channels map back to authored shader names. */
export function createOwnedGeometry(url: string, channels: Readonly<Record<string, string>> = {}): OwnedGeometry {
  let template: BufferGeometry | undefined, pending: Promise<void> | undefined;
  const load = async (bytes?: Uint8Array): Promise<void> => {
    const { prepareRigLoader } = await import('../anim/rig');
    let input = bytes;
    if (input === undefined) {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Baked model load failed: ${url} (${response.status})`);
      input = new Uint8Array(await response.arrayBuffer());
    }
    const gltf = await (await prepareRigLoader()).createRigLoader().parseBytesAsync(input, '');
    const meshes: Mesh[] = [];
    gltf.scene.traverse(node => { if (isGeometryMesh(node)) meshes.push(node); });
    try {
      const [mesh] = meshes;
      if (mesh === undefined || meshes.length !== 1) throw new Error(`Baked model needs one mesh: ${url}`);
      gltf.scene.updateMatrixWorld(true);
      const quantized = gridQuantized(mesh);
      if (!quantized && mesh.matrixWorld.elements.some((value, i) => value !== (i % 5 === 0 ? 1 : 0))) throw new Error(`Baked model needs identity space: ${url}`);
      // The parser and this intake are the only owners of this single mesh.
      // Borrowed BufferGeometry input still copies in load(); private GLB
      // attributes can pass directly into the intake instead of doubling them.
      const geometry = mesh.userData['nativeAttributes'] === undefined ? mesh.geometry : nativeWholeGeometry(mesh, 'take');
      if (quantized) dequantizeIntoSpace(geometry, mesh);
      const index = geometry.getIndex();
      // The deterministic GLB writer emits identity indices for an authored triangle soup; restore its original draw.
      if (mesh.userData['nativeAttributes'] === undefined && index !== null && index.count === geometry.getAttribute('position').count && index.array.every((value, i) => value === i)) geometry.setIndex(null);
      for (const [from, to] of Object.entries(channels)) {
        if (!geometry.hasAttribute(from)) { geometry.dispose(); throw new Error(`Baked model is missing ${from}: ${url}`); }
        geometry.setAttribute(to, geometry.getAttribute(from)); geometry.deleteAttribute(from);
      }
      template = geometry;
    } finally {
      for (const mesh of meshes) {
        if (mesh.geometry !== template) mesh.geometry.dispose();
        for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) material.dispose();
      }
    }
  };
  const start = async (bytes?: Uint8Array): Promise<void> => {
    try { await load(bytes); } catch (error: unknown) { pending = undefined; throw error; }
  };
  const segmented = async (bytes: readonly Uint8Array[]): Promise<void> => {
    const parts: BufferGeometry[] = [];
    try {
      for (const part of bytes) { const intake = createOwnedGeometry(url, channels); await intake.load(part); parts.push(intake.take()); }
      template = restoreSegments(parts);
    } catch (error) { pending = undefined; throw error; }
    finally { for (const part of parts) part.dispose(); }
  };
  return {
    load: (bytes, segments) => {
      if (segments !== undefined) {
        if (!(bytes instanceof Uint8Array)) return Promise.reject(new Error('Geometry segments require original GLB bytes'));
        if (segments.length === 0 || segments.length > 15 || bytes.byteLength + segments.reduce((sum, part) => sum + part.byteLength, 0) > 100_000_000) return Promise.reject(new Error('Geometry storage segment cap'));
        pending ??= segmented([bytes, ...segments]); return pending;
      }
      if (bytes instanceof BufferGeometry) { template?.dispose(); template = bytes.clone(); pending = Promise.resolve(); return pending; }
      pending ??= start(bytes);
      return pending;
    },
    adopt: (geometry) => {
      if (template !== undefined || pending !== undefined) throw new Error(`Baked model is already loaded: ${url}`);
      template = geometry; pending = Promise.resolve();
    },
    take: () => { if (template === undefined) throw new Error(`Baked model was not loaded: ${url}`); const geometry = template; template = undefined; pending = undefined; return geometry; },
    copy: () => { if (template === undefined) throw new Error(`Baked model was not loaded: ${url}`); return template.clone(); },
  };
}
