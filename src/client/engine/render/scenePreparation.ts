import { Vector3, type Camera, type Object3D } from 'three';
import type { Scope } from '../../../shared/engine/app/scope';
import { withOwner } from '../../../shared/engine/app/ownership';

interface Preparation { readonly scope: Scope; readonly prepare: (localEye: Vector3, current: () => boolean) => Promise<void> }
const preparations = new WeakMap<Object3D, Preparation>();

/** Register render-only CPU preparation on a scene root; its owner removes it before resource retirement. */
export function registerScenePreparation(root: Object3D, scope: Scope, prepare: Preparation['prepare']): void {
  if (scope.disposed || preparations.has(root)) throw new Error('Scene preparation needs one live owner');
  const entry = { scope, prepare }; preparations.set(root, entry);
  scope.onDispose(() => { if (preparations.get(root) === entry) preparations.delete(root); });
}

/** Fill renderer data before compilation, in each root's local camera frame, without advancing gameplay or visibility. */
export async function prepareSceneResources(roots: readonly Object3D[], camera: Camera, current: () => boolean): Promise<void> {
  const pending = new Map<Object3D, Preparation>();
  for (const root of roots) root.traverse(object => { const entry = preparations.get(object); if (entry !== undefined) pending.set(object, entry); });
  const eye = camera.getWorldPosition(new Vector3());
  for (const [root, entry] of pending) {
    const live = (): boolean => current() && !entry.scope.disposed && preparations.get(root) === entry;
    if (!live()) throw new Error('Scene CPU preparation left its owner');
    root.updateWorldMatrix(true, false);
    await withOwner(entry.scope, () => entry.prepare(root.worldToLocal(eye.clone()), live));
    if (!live()) throw new Error('Scene CPU preparation left its owner');
  }
}
