import { Vector3, type Mesh, type Object3D } from 'three';
import type { Terrain } from '@wildshard/engine/world/Terrain';

/** Replacement draws keep only the removed ground's scalar flags, never its geometry. */
export function paintedGroundMerge(terrain: Pick<Terrain, 'mesh'>, parent: Object3D,
  source: Pick<Mesh, 'castShadow' | 'receiveShadow' | 'renderOrder'>, follower: { at: (x: number, z: number) => void }): (mesh: Mesh) => void {
  const at = new Vector3(), { castShadow, receiveShadow, renderOrder } = source;
  return mesh => {
    mesh.castShadow = castShadow; mesh.receiveShadow = receiveShadow; mesh.renderOrder = renderOrder; terrain.mesh = mesh;
    mesh.onBeforeRender = (_renderer, _scene, camera) => { camera.getWorldPosition(at); parent.worldToLocal(at); follower.at(at.x, at.z); };
  };
}
