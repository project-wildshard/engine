import { Quaternion, Vector3, type Object3D } from 'three';
import type { BoxSpec } from '../../../shared/engine/physics/box';
import type { Material } from '../../../shared/engine/physics/surface';
import { boxDesc, type ColliderDesc } from '../world/registry';

/** Keep a world box aligned in its following frame; translate-only following uses the world's axes. */
export function boxInFrame(box: BoxSpec, object: Object3D, surface: Material = 'wood', followRotation = true): Extract<ColliderDesc, { kind: 'box' }> {
  object.updateWorldMatrix(true, false);
  const d = boxDesc(box, surface);
  const worldCentre = new Vector3(box.x, (box.yTop + box.yBottom) / 2, box.z);
  const centre = followRotation ? object.worldToLocal(worldCentre) : worldCentre.sub(object.getWorldPosition(new Vector3()));
  const inverse = followRotation ? object.getWorldQuaternion(new Quaternion()).invert() : new Quaternion();
  const rotation = inverse.multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), -box.rot));
  return { ...d, x: centre.x, y: centre.y, z: centre.z, rot: { x: rotation.x, y: rotation.y, z: rotation.z, w: rotation.w } };
}
