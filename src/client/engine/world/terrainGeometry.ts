/** Native ground channels built as the page enters a cell. */
import * as THREE from 'three';
import { CHUNK_SIZE, CHUNK_HALF, TERRAIN_RES } from '../../../shared/engine/core/config';
import type { TerrainField } from '../../../shared/engine/level/data';

/** vertices / triangles between two yields of the chunk's build */
const CHUNK_STEP = 8192;
/**
 * Build the drawn ground in short stretches (SF63: the chunk's ground was 30 ms of one task on the
 * desktop as a grid cell entered in play, several times that on the Simulator): the same float operations in the same
 * order, so the same bytes; the normals are three's `computeVertexNormals`, step by step (`vertexNormalSteps`).
 */
export function* terrainChunkSteps(field: Pick<TerrainField, 'heightAt' | 'splatAt'>): Generator<void, THREE.BufferGeometry, undefined> {
  const res = TERRAIN_RES;
  const geo = new THREE.PlaneGeometry(CHUNK_SIZE, CHUNK_SIZE, res - 1, res - 1);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.getAttribute('position');
  const splat = new Float32Array(pos.count * 4);
  for (let i = 0; i < pos.count; i++) {
    if (i > 0 && i % CHUNK_STEP === 0) yield;
    const x = pos.getX(i), z = pos.getZ(i);
    pos.setY(i, field.heightAt(x, z));
    const s = field.splatAt(x, z);
    splat.set(s, i * 4);
  }
  geo.setAttribute('splat', new THREE.BufferAttribute(splat, 4));
  yield* vertexNormalSteps(geo);
  geo.computeBoundingSphere();
  return geo;
}

/** Ordinary data-backed float attributes; re-check after each yield before keeping array references. */
function normalArrays(index: THREE.BufferAttribute, position: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, normal: THREE.BufferAttribute): { p: Float32Array; n: Float32Array } | null {
  if (!(position instanceof THREE.BufferAttribute) || position.normalized || normal.normalized || position.itemSize !== 3 || normal.itemSize !== 3
    || index.getX !== THREE.BufferAttribute.prototype.getX || position.getX !== THREE.BufferAttribute.prototype.getX || position.getY !== THREE.BufferAttribute.prototype.getY
    || position.getZ !== THREE.BufferAttribute.prototype.getZ || normal.getX !== THREE.BufferAttribute.prototype.getX || normal.getY !== THREE.BufferAttribute.prototype.getY
    || normal.getZ !== THREE.BufferAttribute.prototype.getZ || normal.setXYZ !== THREE.BufferAttribute.prototype.setXYZ) return null;
  for (const attribute of [index, position, normal]) {
    const own = Object.getOwnPropertyDescriptor(attribute, 'array');
    if (own === undefined || !('value' in own)) return null;
  }
  return position.array instanceof Float32Array && normal.array instanceof Float32Array ? { p: position.array, n: normal.array } : null;
}

/**
 * three's `BufferGeometry.computeVertexNormals` for an indexed geometry that has its normal attribute, as steps: its own
 * numerical operations in the same order (zero, accumulate each face's cross product, normalise), so the same bytes.
 * Ordinary float attributes use direct array arithmetic; custom readers and writers keep vector dispatch.
 * Unsupported geometry takes three's call whole.
 */
export function* vertexNormalSteps(geo: THREE.BufferGeometry): Generator<void, void, undefined> {
  const index = geo.getIndex(), position = geo.getAttribute('position'), normal = geo.getAttribute('normal');
  if (index === null || !(normal instanceof THREE.BufferAttribute) || normal.count !== position.count) { geo.computeVertexNormals(); return; }
  for (let i = 0; i < normal.count; i++) { if (i > 0 && i % (CHUNK_STEP * 4) === 0) yield; normal.setXYZ(i, 0, 0, 0); }
  const pA = new THREE.Vector3(), pB = new THREE.Vector3(), pC = new THREE.Vector3();
  const nA = new THREE.Vector3(), nB = new THREE.Vector3(), nC = new THREE.Vector3();
  const cb = new THREE.Vector3(), ab = new THREE.Vector3();
  let arrays = normalArrays(index, position, normal);
  for (let i = 0; i < index.count; i += 3) {
    if (i > 0 && i % (CHUNK_STEP * 3) === 0) { yield; arrays = normalArrays(index, position, normal); }
    const vA = index.getX(i), vB = index.getX(i + 1), vC = index.getX(i + 2);
    if (arrays !== null) {
      const { p, n } = arrays, a = vA * 3, b = vB * 3, c = vC * 3;
      const bx = p[b] ?? Number.NaN, by = p[b + 1] ?? Number.NaN, bz = p[b + 2] ?? Number.NaN;
      const cx = (p[c] ?? Number.NaN) - bx, cy = (p[c + 1] ?? Number.NaN) - by, cz = (p[c + 2] ?? Number.NaN) - bz;
      const ax = (p[a] ?? Number.NaN) - bx, ay = (p[a + 1] ?? Number.NaN) - by, az = (p[a + 2] ?? Number.NaN) - bz;
      const nx = cy * az - cz * ay, ny = cz * ax - cx * az, nz = cx * ay - cy * ax;
      // Read all corners before any write, including a triangle with repeated indices.
      const nax = n[a] ?? Number.NaN, nay = n[a + 1] ?? Number.NaN, naz = n[a + 2] ?? Number.NaN;
      const nbx = n[b] ?? Number.NaN, nby = n[b + 1] ?? Number.NaN, nbz = n[b + 2] ?? Number.NaN;
      const ncx = n[c] ?? Number.NaN, ncy = n[c + 1] ?? Number.NaN, ncz = n[c + 2] ?? Number.NaN;
      n[a] = nax + nx; n[a + 1] = nay + ny; n[a + 2] = naz + nz;
      n[b] = nbx + nx; n[b + 1] = nby + ny; n[b + 2] = nbz + nz;
      n[c] = ncx + nx; n[c + 1] = ncy + ny; n[c + 2] = ncz + nz;
    } else {
      pA.fromBufferAttribute(position, vA); pB.fromBufferAttribute(position, vB); pC.fromBufferAttribute(position, vC);
      cb.subVectors(pC, pB); ab.subVectors(pA, pB); cb.cross(ab);
      nA.fromBufferAttribute(normal, vA); nB.fromBufferAttribute(normal, vB); nC.fromBufferAttribute(normal, vC);
      nA.add(cb); nB.add(cb); nC.add(cb);
      normal.setXYZ(vA, nA.x, nA.y, nA.z); normal.setXYZ(vB, nB.x, nB.y, nB.z); normal.setXYZ(vC, nC.x, nC.y, nC.z);
    }
  }
  yield;
  const v = new THREE.Vector3();
  for (let i = 0; i < normal.count; i++) {
    if (i > 0 && i % (CHUNK_STEP * 2) === 0) yield;
    v.fromBufferAttribute(normal, i); v.normalize(); normal.setXYZ(i, v.x, v.y, v.z);
  }
  normal.needsUpdate = true;
}

/**
 * The per-vertex canopy density the chunk draws with (`Terrain.applyCanopy`): the forest's N² canopy map (`Forest.canopyMap`,
 * row-major over the chunk) read at each vertex's nearest cell. Pure: a tile bake computes its `_CANOPY` channel with it.
 */
export function canopyChannel(positions: { readonly count: number; readonly getX: (i: number) => number; readonly getZ: (i: number) => number }, data: ArrayLike<number>, N: number): Float32Array {
  const canopy = new Float32Array(positions.count);
  for (let i = 0; i < positions.count; i++) {
    const u = (positions.getX(i) + CHUNK_HALF) / CHUNK_SIZE, v = (positions.getZ(i) + CHUNK_HALF) / CHUNK_SIZE;
    const x = Math.min(N - 1, Math.max(0, Math.round(u * N))), z = Math.min(N - 1, Math.max(0, Math.round(v * N)));
    canopy[i] = data[z * N + x] ?? 0;
  }
  return canopy;
}
