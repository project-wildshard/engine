import { BufferAttribute, BufferGeometry, Group, InstancedBufferAttribute, InstancedBufferGeometry, InstancedInterleavedBuffer, InterleavedBuffer, InterleavedBufferAttribute, LOD, Mesh, Object3D, Points, Sphere, Vector3, type Material } from 'three';
import { TIER } from '@wildshard/engine/core/tier';
import type { Scope } from '@wildshard/engine/app/scope';
import { withOwner } from '@wildshard/engine/app/ownership';
import type { App } from '@wildshard/engine/app/app';
import { forgetWhenDisposed } from '@wildshard/engine/app/cachedAssets';
import { parseSceneBuffers, type SceneBuffers } from '@wildshard/format/sceneBuffers';
import type { PlumbingData } from '@wildshard/format/plumbing';
import { plumbingKnob } from '../shard/declaredPlumbing';

type Storage = Float32Array | Uint16Array | Uint8Array;
/** Empty effect markers carry no encoded content and need no phantom file. */
function namedSceneBuffers(input:unknown):SceneBuffers {
  const row=parseSceneBuffers(input);
  if(row.buffers.some(buffer=>buffer.bytes!==undefined&&buffer.bytes!==''))throw new Error('Scene buffers require named binary files');
  return row;
}
/** Decode every bounded source before scene allocation. Raw byte words retain signed zero and original storage. */
function decode(row: SceneBuffers, files?: ReadonlyMap<string, Uint8Array>, validationOnly = false): ReadonlyMap<string, Storage> {
  const result = new Map<string, Storage>();
  for (const buffer of row.buffers) {
    let bytes: Uint8Array;
    if (buffer.bytes !== undefined) {
      bytes = new Uint8Array(0);
    } else {
      const source = buffer.file === undefined ? undefined : files?.get(buffer.file);
      if (source === undefined) throw new Error('Missing scene buffer binary file');
      const offset = buffer.byteOffset ?? 0, length = buffer.byteLength;
      if (length === undefined || (buffer.byteOffset === undefined ? source.byteLength !== length : offset + length > source.byteLength))
        throw new Error('Scene buffer binary length differs');
      const width = buffer.storage === 'f32' ? 4 : buffer.storage === 'u16' ? 2 : 1;
      if (offset % width !== 0) throw new Error('Misaligned scene buffer binary offset');
      const selected = source.subarray(offset, offset + length);
      // A synchronous validation scan need not copy aligned ordinary backing.
      // Shared/unaligned sources retain their snapshot copy; construction always
      // detaches its own words and rechecks them before any geometry is made.
      bytes = validationOnly && source.buffer instanceof ArrayBuffer && selected.byteOffset % width === 0
        ? selected : new Uint8Array(selected);
    }
    const width = buffer.storage === 'f32' ? 4 : buffer.storage === 'u16' ? 2 : 1;
    if (bytes.byteLength % width !== 0) throw new Error('Misaligned scene buffer storage');
    const storage = buffer.storage === 'f32' ? new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4)
      : buffer.storage === 'u16' ? new Uint16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2) : bytes;
    if (storage instanceof Float32Array) {
      for (let i = 0; i < storage.length; i++) if (!Number.isFinite(storage[i])) throw new Error('Nonfinite scene buffer');
    }
    if (buffer.stride !== undefined && storage.length % buffer.stride !== 0) throw new Error('Misaligned scene interleave');
    result.set(buffer.id, storage);
  }
  for (const attribute of row.attributes) {
    const buffer = row.buffers.find(value => value.id === attribute.buffer), storage = result.get(attribute.buffer);
    if (buffer === undefined || storage === undefined || storage.length % (buffer.stride ?? attribute.size) !== 0) throw new Error('Misaligned scene attribute');
  }
  return result;
}
/** Client-only typed field admission, performed before allocating materials or geometry.
 * Named sources require exact whole files or explicit bounded, aligned byte ranges. */
export function admitSceneBuffers(input: unknown, files?: ReadonlyMap<string, Uint8Array>): SceneBuffers {
  const row = namedSceneBuffers(input); decode(row, files, true); return row;
}
/** An admitted content URL and its authoritative resource owner, never an entered root or material. */
export interface SceneBufferReuse {
  readonly content: string;
  /** Fixed world storage may remain charged and idle between region visits. */
  readonly revisit?: boolean;
  readonly assets: Pick<App['assets'], 'register' | 'acquireResource' | 'evictCached'>;
}
const builds = new WeakMap<SceneBufferReuse['assets'], Map<string, ReadonlyMap<string, BufferGeometry>>>();
function instanceCounts(row: SceneBuffers, plumbing: PlumbingData | null | undefined): readonly (number | undefined)[] {
  return row.geometries.map(definition => {
    const count = definition.instances;
    return typeof count === 'object' ? plumbingKnob(plumbing, TIER, count.knob, 'number') >= count.threshold ? count.above : count.below : count;
  });
}
function buildGeometries(row: SceneBuffers, counts: readonly (number | undefined)[], own: (geometry: BufferGeometry) => void, files?: ReadonlyMap<string, Uint8Array>): ReadonlyMap<string, BufferGeometry> {
  const storage = decode(row, files);
  const buffers = new Map<string, InterleavedBuffer>();
  for (const buffer of row.buffers) {
    if (buffer.stride === undefined) continue;
    const values = storage.get(buffer.id); if (values === undefined) throw new Error('Missing admitted scene storage');
    buffers.set(buffer.id, buffer.instanced ? new InstancedInterleavedBuffer(values, buffer.stride) : new InterleavedBuffer(values, buffer.stride));
  }
  const attributes = new Map<string, BufferAttribute | InterleavedBufferAttribute>();
  for (const attribute of row.attributes) {
    const source = row.buffers.find(value => value.id === attribute.buffer), values = storage.get(attribute.buffer);
    if (source === undefined || values === undefined) throw new Error('Missing admitted scene attribute');
    const interleaved = buffers.get(attribute.buffer);
    attributes.set(attribute.id, interleaved === undefined
      ? source.instanced ? new InstancedBufferAttribute(values, attribute.size, attribute.normalized) : new BufferAttribute(values, attribute.size, attribute.normalized)
      : new InterleavedBufferAttribute(interleaved, attribute.size, attribute.offset, attribute.normalized));
  }
  const geometries = new Map<string, BufferGeometry>();
  for (const [geometryIndex, definition] of row.geometries.entries()) {
    const geometry = definition.instances === undefined ? new BufferGeometry() : new InstancedBufferGeometry();
    try {
      for (const [name, id] of Object.entries(definition.attributes)) {
        const attribute = attributes.get(id); if (attribute === undefined) throw new Error('Missing admitted scene channel');
        geometry.setAttribute(name, attribute);
      }
      if (definition.index !== undefined) {
        const index = attributes.get(definition.index);
        if (!(index instanceof BufferAttribute) || index.normalized || !(index.array instanceof Uint16Array || index.array instanceof Uint8Array)) throw new Error('Invalid scene triangle index');
        if (!geometry.hasAttribute('position')) throw new Error('Scene index needs position vertices');
        const vertices = geometry.getAttribute('position').count;
        if (index.count % 3 !== 0) throw new Error('Scene index exceeds its vertices');
        for (let i = 0; i < index.array.length; i++) if ((index.array[i] ?? vertices) >= vertices) throw new Error('Scene index exceeds its vertices');
        geometry.setIndex(index);
      }
      if (geometry instanceof InstancedBufferGeometry && definition.instances !== undefined) {
        const count = counts[geometryIndex];
        if (count === undefined) throw new Error('Missing admitted instance count');
        geometry.instanceCount = count;
        for (const attribute of Object.values(geometry.attributes)) {
          const instanced = attribute instanceof InstancedBufferAttribute || attribute instanceof InterleavedBufferAttribute && attribute.data instanceof InstancedInterleavedBuffer;
          if (instanced && geometry.instanceCount > attribute.count) throw new Error('Scene instance count exceeds its channel');
        }
      }
      if (definition.sphere !== undefined) geometry.boundingSphere = new Sphere(new Vector3(definition.sphere[0], definition.sphere[1], definition.sphere[2]), definition.sphere[3]);
      own(geometry); geometries.set(definition.id, geometry);
    } catch (error) { geometry.dispose(); throw error; }
  }
  return geometries;
}
/** Fresh draw objects can borrow fixed storage through charged, pressure-evictable assets.
 * Content identity, tier and every resolved instance count isolate reusable builds.
 * Binary files are verified product reads; decoded geometry never mutates their storage. */
export interface SceneBufferDrawer {
  (material: Material): Group;
  readonly cache: 'private' | 'hit' | 'miss';
}

function prepareBufferDraws(input: unknown, scope: Scope, plumbing?: PlumbingData | null, reuse?: SceneBufferReuse, files?: ReadonlyMap<string, Uint8Array>): SceneBufferDrawer {
  if (scope.disposed || scope.disposing) throw new Error('Scene buffer scope is disposed or retiring');
  const row = namedSceneBuffers(input), counts = instanceCounts(row, plumbing), owner = scope.child('buffered-draws');
  try {
    let geometries: ReadonlyMap<string, BufferGeometry>, cache: SceneBufferDrawer['cache'] = 'private';
    if (reuse === undefined) geometries = buildGeometries(row, counts, geometry => { owner.own(geometry); }, files);
    else {
      if (reuse.content.length === 0) throw new Error('Reusable scene buffers need admitted content identity');
      let memo = builds.get(reuse.assets);
      if (memo === undefined) { memo = new Map(); builds.set(reuse.assets, memo); }
      const key = JSON.stringify([reuse.content, TIER, counts, reuse.revisit === true]), known = memo.get(key);
      if (known !== undefined) {
        cache = 'hit'; geometries = known;
        for (const geometry of geometries.values()) {
          const release = reuse.assets.acquireResource(geometry);
          if (release === null) throw new Error('Reusable scene geometry has retired');
          owner.onDispose(release);
        }
      } else {
        cache = 'miss'; const registered: string[] = [];
        try {
          geometries = buildGeometries(row, counts, geometry => {
            const asset = `scene:${geometry.uuid}`;
            withOwner(owner, () => reuse.assets.register(asset, geometry, { retain: true, cache: true, reusable: true, revisit: reuse.revisit === true }));
            registered.push(asset);
            const release = reuse.assets.acquireResource(geometry);
            if (release === null) throw new Error('New scene geometry has no owner');
            owner.onDispose(release);
          }, files);
        } catch (error) {
          owner.dispose();
          for (const asset of registered) reuse.assets.evictCached(asset);
          throw error;
        }
        memo.set(key, geometries);
        forgetWhenDisposed(geometries, memo, key, geometries); // its listener holds no owner of this build
      }
    }
    return Object.assign(bufferDrawer(row, geometries, owner), { cache });
  } catch (error) { owner.dispose(); throw error; }
}

/** A fixed build: prepare channels once, then make independent draw objects and materials.
 * Reuse is explicit and keeps exact content/tier/instance counts under the supplied asset budget.
 * The factory owns no transport reader and cannot draw after its construction scope retires. */
export function prepareSceneBufferDraws(input: unknown, scope: Scope, plumbing?: PlumbingData | null, files?: ReadonlyMap<string, Uint8Array>, reuse?: SceneBufferReuse): SceneBufferDrawer {
  return prepareBufferDraws(input, scope, plumbing, reuse, files);
}

/** Construct one buffered scene; explicit reusable callers retain their existing charged-cache contract. */
export function createSceneBuffers(input: unknown, material: Material, scope: Scope, plumbing?: PlumbingData | null, reuse?: SceneBufferReuse, files?: ReadonlyMap<string, Uint8Array>): Group {
  return prepareBufferDraws(input, scope, plumbing, reuse, files)(material);
}

function bufferDrawer(row: SceneBuffers, geometries: ReadonlyMap<string, BufferGeometry>, owner: Scope): (material: Material) => Group {
  return material => {
    if (owner.disposed || owner.disposing) throw new Error('Scene buffer draw owner is retired');
    try {
    const group = new Group(); group.name = row.name;
    const make = (draw: NonNullable<SceneBuffers['draws'][number]['draw']> | undefined): Object3D => {
      if (draw === undefined) return new Object3D();
      const geometry = geometries.get(draw.geometry); if (geometry === undefined) throw new Error('Missing admitted scene geometry');
      const object = draw.kind === 'points' ? new Points(geometry, material) : new Mesh(geometry, material);
      object.position.set(...draw.at); object.frustumCulled = draw.frustum; return object;
    };
    for (const draw of row.draws) {
      let object: Object3D;
      if (draw.levels === undefined) object = make(draw.draw);
      else { const lod = new LOD(); for (const level of draw.levels) lod.addLevel(make(level.draw), level.from); object = lod; }
      object.name = draw.name; object.position.add(new Vector3(...draw.at)); group.add(object);
    }
    owner.onDispose(() => { group.removeFromParent(); });
    return group;
    } catch (error) { owner.dispose(); throw error; }
  };
}
