import * as THREE from 'three';
import * as v from 'valibot';
import { BuildingCloudSchema, type BuildingCloudRow } from '@wildshard/format/buildings';
import type { SceneHandles } from './sceneHandles';

/** Client-only hearth/camp presentation. A baked quad cloud and a seed cloud
 * share the same bounds, pose and material-id contract. No CPU particle loop. */
export function createBuildingCloud(resources: SceneHandles, row: BuildingCloudRow): THREE.Mesh {
  const admitted = v.parse(BuildingCloudSchema, row);
  const at = Array.isArray(admitted.at) ? new THREE.Vector3(...admitted.at) : resources.point(admitted.at, new THREE.Vector3());
  if (admitted.parent !== undefined) resources.object(admitted.parent).worldToLocal(at);
  const source = resources.geometry(row.geometry);
  let geometry: THREE.BufferGeometry;
  if (row.seeds) {
    if (!source.hasAttribute('seed')) throw new Error('Missing building cloud seeds');
    const seed = source.getAttribute('seed');
    if (seed.itemSize !== 4 || seed.count > 32768) throw new Error('Invalid building cloud seeds');
    const quad = new THREE.PlaneGeometry(1, 1), instanced = new THREE.InstancedBufferGeometry();
    instanced.index = quad.index; instanced.setAttribute('position', quad.getAttribute('position')); instanced.setAttribute('uv', quad.getAttribute('uv'));
    instanced.setAttribute('aSeed', new THREE.InstancedBufferAttribute(Float32Array.from({ length: seed.count * 4 }, (_, i) => seed.getComponent(Math.floor(i / 4), i % 4)), 4));
    instanced.instanceCount = seed.count; geometry = instanced;
  } else geometry = source.clone();
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(...row.center), row.radius);
  const mesh = new THREE.Mesh(geometry, row.material === null ? undefined : resources.material(row.material));
  mesh.name = row.name; mesh.position.copy(at); mesh.renderOrder = row.order; mesh.visible = row.visible;
  return mesh;
}
