import { Box3, BufferAttribute, InterleavedBufferAttribute, Sphere, Vector3, type BufferGeometry } from 'three';

// Keep typed-array scans separate from the generator's yield state.
function packedBox(array: Float32Array, start: number, end: number, box: Box3): void {
  let { x: minX, y: minY, z: minZ } = box.min, { x: maxX, y: maxY, z: maxZ } = box.max;
  for (let i = start; i < end; i += 3) {
    const x = array[i] ?? Number.NaN, y = array[i + 1] ?? Number.NaN, z = array[i + 2] ?? Number.NaN;
    minX = Math.min(minX, x); minY = Math.min(minY, y); minZ = Math.min(minZ, z);
    maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); maxZ = Math.max(maxZ, z);
  }
  box.min.set(minX, minY, minZ); box.max.set(maxX, maxY, maxZ);
}

function packedRadius(array: Float32Array, start: number, end: number, center: Vector3, radiusSq: number): number {
  const { x, y, z } = center;
  let largest = radiusSq;
  for (let i = start; i < end; i += 3) {
    const dx = x - (array[i] ?? Number.NaN), dy = y - (array[i + 1] ?? Number.NaN), dz = z - (array[i + 2] ?? Number.NaN);
    largest = Math.max(largest, dx * dx + dy * dy + dz * dz);
  }
  return largest;
}

/** Compute ordinary geometry bounds in 32,768-vertex steps, with three.js's vertex order and arithmetic.
 * Exhausting the generator is synchronous; a sliced builder may pause between steps. Geometry must remain
 * unmodified until completion. Existing bound objects retain their identity and are published only at completion.
 * Morph targets, GPU-only attributes and invalid coordinates keep three.js's original implementation. */
export function* geometryBoundsSteps(geometry: BufferGeometry, bounds: 'box' | 'sphere' | 'both' = 'both'): Generator<void, void> {
  const position: unknown = geometry.getAttribute('position');
  const original = (): void => {
    if (bounds !== 'box') geometry.computeBoundingSphere();
    if (bounds !== 'sphere') geometry.computeBoundingBox();
  };
  if (!(position instanceof BufferAttribute || position instanceof InterleavedBufferAttribute) || geometry.morphAttributes.position !== undefined) {
    original(); return;
  }
  const box = new Box3(), point = new Vector3();
  // Merged/static meshes use packed, unnormalized Float32 positions. Scan those
  // bytes directly; accessor calls dominate large bounds scans on WebKit.
  const packed = position instanceof BufferAttribute && position.array instanceof Float32Array
    && position.itemSize === 3 && !position.normalized && position.count * 3 === position.array.length
    && position.array.length % 3 === 0 ? position.array : null;
  if (packed === null) {
    for (let i = 0; i < position.count; i++) {
      point.fromBufferAttribute(position, i); box.expandByPoint(point);
      if ((i & 32767) === 32767) yield;
    }
  } else {
    for (let i = 0; i < packed.length; i += 32768 * 3) {
      const end = Math.min(packed.length, i + 32768 * 3);
      packedBox(packed, i, end, box);
      if (end - i === 32768 * 3) yield;
    }
  }
  if (Number.isNaN(box.min.x) || Number.isNaN(box.min.y) || Number.isNaN(box.min.z)) { original(); return; }
  if (bounds !== 'box') {
    const sphere = new Sphere(); box.getCenter(sphere.center);
    let radiusSq = 0;
    if (packed === null) {
      for (let i = 0; i < position.count; i++) {
        point.fromBufferAttribute(position, i);
        radiusSq = Math.max(radiusSq, sphere.center.distanceToSquared(point));
        if ((i & 32767) === 32767) yield;
      }
    } else {
      for (let i = 0; i < packed.length; i += 32768 * 3) {
        const end = Math.min(packed.length, i + 32768 * 3);
        radiusSq = packedRadius(packed, i, end, sphere.center, radiusSq);
        if (end - i === 32768 * 3) yield;
      }
    }
    sphere.radius = Math.sqrt(radiusSq);
    if (Number.isNaN(sphere.radius)) { original(); return; }
    (geometry.boundingSphere ??= new Sphere()).copy(sphere);
  }
  if (bounds !== 'sphere') (geometry.boundingBox ??= new Box3()).copy(box);
}
