import type { Scope } from '@wildshard/engine/app/scope';
import { withOwner } from '@wildshard/engine/app/ownership';
import type { Physics } from '@wildshard/engine/physics/Physics';
import { groups } from '@wildshard/engine/physics/groups';

/**
 * SHARD-SOURCE AP5 (J347): a watched part's solid boxes, as the dev hook's `swapColliders` hands them to a physics world.
 * The page's world (the player's prediction) and the in-page server's world (the worker, over the harness port) both take
 * them through `swapDevBoxes`, so the two sets never differ. DEVSERVER-only on both sides: each caller reaches this module
 * behind the `__DEVSERVER__` define, so a production bundle drops it (engine `scripts/check-devserver.mjs`).
 */
export interface DevBox {
  readonly centre: readonly [number, number, number];
  readonly half: readonly [number, number, number];
  /** world rotation quaternion (x, y, z, w) */
  readonly rotation: readonly [number, number, number, number];
}

/** The harness-port message that carries one part's boxes to the in-page server. */
export interface DevCollidersMessage { readonly wildshardDevColliders: string; readonly boxes: readonly DevBox[] }

const triple = (value: unknown): boolean => Array.isArray(value) && value.length === 3 && value.every(n => typeof n === 'number' && Number.isFinite(n));
const isBox = (value: unknown): value is DevBox => typeof value === 'object' && value !== null && 'centre' in value && triple(value.centre)
  && 'half' in value && triple(value.half) && 'rotation' in value && Array.isArray(value.rotation) && value.rotation.length === 4 && value.rotation.every(n => typeof n === 'number' && Number.isFinite(n));

export const isDevColliders = (value: unknown): value is DevCollidersMessage => typeof value === 'object' && value !== null
  && 'wildshardDevColliders' in value && typeof value.wildshardDevColliders === 'string' && 'boxes' in value && Array.isArray(value.boxes) && value.boxes.every(isBox);

/**
 * Replace part `name`'s boxes in `physics`: the new set is made under a fresh child of `owner` first, then the old set's
 * scope is disposed (its colliders leave the world with it). An empty set removes the part's boxes.
 */
export function swapDevBoxes(physics: Physics, owner: Scope, held: Map<string, Scope>, name: string, boxes: readonly DevBox[]): void {
  const old = held.get(name);
  if (boxes.length === 0) held.delete(name);
  else {
    const scope = owner.child(`devColliders.${name}`);
    withOwner(scope, () => {
      for (const box of boxes) physics.world.createCollider(physics.R.ColliderDesc.cuboid(...box.half)
        .setTranslation(...box.centre).setRotation({ x: box.rotation[0], y: box.rotation[1], z: box.rotation[2], w: box.rotation[3] })
        .setCollisionGroups(groups('WORLD')));
    });
    held.set(name, scope);
  }
  old?.dispose();
}
