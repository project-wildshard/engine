import { Object3D } from 'three';
import { containerResources, sceneResources } from './sceneOwnership';
import { isRebinding } from '../../../shared/engine/app/scope';

/** A memo may outlive a scene: forget its value when any owned resource retires instead of returning freed GPU data.
 * A GPU rebind (`rebindGeometry`) is not a retirement.
 * Promises keep their original result/error contract, including disposal tracking after asynchronous loads finish. */
export function cacheUntilDisposed<T>(value: T, invalidate: () => void): T {
  if (value instanceof Promise) {
    void value.then(resolved => { cacheUntilDisposed(resolved, invalidate); return undefined; }, invalidate);
    return value;
  }
  const resources = value instanceof Object3D ? sceneResources(value) : containerResources(value);
  const detach: (() => void)[] = [];
  let active = true;
  const retired = (event: unknown): void => {
    const target: unknown = typeof event === 'object' && event !== null ? Reflect.get(event, 'target') : undefined;
    if (!active || (typeof target === 'object' && target !== null && isRebinding(target))) return;
    active = false;
    for (const remove of detach) remove();
    invalidate();
  };
  for (const resource of resources) {
    const add: unknown = Reflect.get(resource, 'addEventListener'), remove: unknown = Reflect.get(resource, 'removeEventListener');
    if (typeof add !== 'function' || typeof remove !== 'function') continue;
    Reflect.apply(add, resource, ['dispose', retired]);
    detach.push(() => { Reflect.apply(remove, resource, ['dispose', retired]); });
  }
  return value;
}
