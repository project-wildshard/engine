import * as THREE from 'three';
import type { Material as SurfaceMaterial } from '../../src/shared/engine/physics/surface';
import type { ColliderDesc } from '../../src/client/engine/world/registry';

// Historical contract oracle; production consumers use the data-driven owners.
/**
 * Project a mesh or convex support points into a placed collider, relative to the matrix's translation.
 * Rotation/scale are baked into fresh Float32 coordinates; source arrays and index order stay untouched.
 * Return the descriptor to the normal world/physics registry; this helper never installs physics itself.
 */
export function placedGeometryCollider(source: { readonly kind: 'trimesh'; readonly geometry: THREE.BufferGeometry } | { readonly kind: 'hull'; readonly points: Float32Array }, matrix: THREE.Matrix4, surface: SurfaceMaterial): ColliderDesc {
  const origin = new THREE.Vector3().setFromMatrixPosition(matrix), vertex = new THREE.Vector3();
  const position = source.kind === 'trimesh' ? source.geometry.getAttribute('position') : new THREE.BufferAttribute(source.points, 3);
  const vertices = new Float32Array(position.count * 3);
  for (let i = 0; i < position.count; i++) {
    vertex.fromBufferAttribute(position, i).applyMatrix4(matrix);
    vertices[i * 3] = vertex.x - origin.x; vertices[i * 3 + 1] = vertex.y - origin.y; vertices[i * 3 + 2] = vertex.z - origin.z;
  }
  const at = { x: origin.x, y: origin.y, z: origin.z, surface };
  if (source.kind === 'hull') return { kind: 'hull', ...at, points: vertices };
  const index = source.geometry.getIndex();
  const indices = index ? Uint32Array.from({ length: index.count }, (_v, i) => index.getX(i)) : Uint32Array.from({ length: position.count }, (_v, i) => i);
  return { kind: 'trimesh', ...at, vertices, indices };
}
