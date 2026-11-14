import type { Scope } from '@wildshard/engine/app/scope';
import type { ShardFolder } from '../../../shared/game/shardfile/shardFolder';
import type { SceneHandles } from './sceneHandles';

const scenes = new WeakMap<Scope, WeakMap<ShardFolder, SceneHandles>>();
/** Internal publication of the actual resident construction result. */
export function publishClientSceneHandles(product: ShardFolder, resident: Scope, value: SceneHandles): void {
  let products = scenes.get(resident);
  if (products === undefined) { products = new WeakMap(); scenes.set(resident, products); }
  const previous = products.get(product);
  if (previous === value) return;
  if (previous !== undefined) throw new Error('Resident scene is already published');
  products.set(product, value);
  resident.onDispose(() => { products.delete(product); });
}
/** Named scene results for compiled resource features. */
export function clientSceneHandles(product: ShardFolder, resident: Scope): SceneHandles {
  const value = scenes.get(resident)?.get(product); if (value === undefined) throw new Error('Client plan has not built world.scenes'); return value;
}
