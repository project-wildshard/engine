import type { Object3D, Vector3 } from 'three';
import { newLimbPose } from '../../../shared/game/animation/limbRig';
import { bindLimbQuery, retireLimbQuery } from './limbView';
import type { RigAnimCtx } from '@wildshard/engine/entities/species/registry';
import type { LimbCollisionJoints, LimbCollisionVolumes } from './limbCollision';
import { LimbQueryPose } from './limbQueryPose';

/** The page's existing volume surface. The binding takes no ownership of a model, actor, renderer or scene. */
interface LimbVolumeView {
  readonly mesh: Object3D;
  headWorld: (out: Vector3) => Vector3;
  bodyCapsule: (rear: Vector3, front: Vector3) => void;
  foreCapsule: (left: Vector3, right: Vector3) => boolean;
}

/** Bind a measured limb rig to the same FK queries as native. Visual skinning and all existing matrix propagation
 * remain live. The parent render traversal publishes all joints; forced cage/lantern getters publish only their chain.
 * The platform animator stages this query once; retirement restores the borrowed view methods. */
export function bindLimbQueryView(view: LimbVolumeView & RigAnimCtx['animal'],
  metadata: { joints: LimbCollisionJoints; volumes: LimbCollisionVolumes }): {
    query: LimbQueryPose;
    publishRibs: () => void;
    publishHead: () => void;
    dispose: () => void;
  } {
  const query = new LimbQueryPose(metadata.joints, metadata.volumes), mesh = view.mesh;
  const oldHead = view.headWorld, oldBody = view.bodyCapsule, oldFore = view.foreCapsule;
  // oxlint-disable-next-line typescript/unbound-method -- Preserve the original method identity for retirement; invoke it only with its explicit mesh receiver below.
  const oldRender = mesh.updateMatrixWorld;
  // A freshly built rig still has its measured rest pose before its first custom animation update.
  mesh.updateMatrixWorld(true); query.stage(newLimbPose()); query.publish(mesh.matrixWorld, 'head');
  bindLimbQuery(view, query);
  const head = (out: Vector3): Vector3 => query.head(out);
  const body = (rear: Vector3, front: Vector3): void => { query.body(rear, front); };
  const fore = (left: Vector3, right: Vector3): boolean => { query.fore(left, right); return true; };
  const render = (force?: boolean): void => {
    oldRender.call(mesh, force); query.publish(mesh.matrixWorld, 'head');
  };
  view.headWorld = head; view.bodyCapsule = body; view.foreCapsule = fore; mesh.updateMatrixWorld = render;
  let disposed = false;
  return { query,
    publishRibs: () => { query.publish(mesh.matrixWorld, 'ribs'); },
    publishHead: () => { query.publish(mesh.matrixWorld, 'head'); },
    dispose: () => {
      if (disposed) return;
      disposed = true; retireLimbQuery(view, query);
      if (view.headWorld === head) view.headWorld = oldHead;
      if (view.bodyCapsule === body) view.bodyCapsule = oldBody;
      if (view.foreCapsule === fore) view.foreCapsule = oldFore;
      if (mesh.updateMatrixWorld === render) mesh.updateMatrixWorld = oldRender;
    },
  };
}
