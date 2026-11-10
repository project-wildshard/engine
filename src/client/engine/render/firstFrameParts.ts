import * as THREE from 'three';
import { opaqueMaterialOrder } from './gltfMaterialOrder';

/**
 * LS11 (J204): the orders a slow GPU's first full draws are split along. On SwiftShader the first full view after the
 * world's slices, and the first full shadow map, each held one GPU unit of 1.3-3.3 s that the bar could not cross; drawn
 * first as growing prefixes of the order the renderer meets them in, each prefix a fenced unit, the one-time work lands
 * a part at a time (`Game.firstViewParts`, `Game.fencedDraw`).
 */

function materials(object: THREE.Object3D): THREE.Material[] {
  const material: unknown = Reflect.get(object, 'material');
  const list: readonly unknown[] = Array.isArray(material) ? material : [material];
  return list.filter((m): m is THREE.Material => m instanceof THREE.Material);
}

/** The shown drawables of `root` on `layers` in the view's draw order: the opaque by render order and material (as
 *  `gltfOpaqueSort` sorts them: file batch, then declaration index), then the transparent; `opaque` counts the first. */
export function firstViewOrder(root: THREE.Object3D, layers: THREE.Layers): { order: THREE.Object3D[]; opaque: number } {
  const shown: THREE.Object3D[] = [];
  root.traverseVisible(object => {
    if ((object instanceof THREE.Mesh || object instanceof THREE.Line || object instanceof THREE.Points || object instanceof THREE.Sprite)
      && object.layers.test(layers) && materials(object).length > 0) shown.push(object);
  });
  const transparent = (object: THREE.Object3D): boolean => materials(object).some(material => material.transparent);
  const key = (object: THREE.Object3D): readonly [number, number] => {
    const first = materials(object)[0];
    return first === undefined ? [0, 0] : opaqueMaterialOrder(first);
  };
  const opaque = shown.filter(object => !transparent(object)).sort((a, b) => {
    const ka = key(a), kb = key(b);
    return a.renderOrder - b.renderOrder || ka[0] - kb[0] || ka[1] - kb[1];
  });
  return { order: [...opaque, ...shown.filter(transparent)], opaque: opaque.length };
}

/** How many of a first-view order part `k` (1-based) draws: `parts.opaque` growing parts of the opaque, then
 *  `parts.transparent` of the transparent; the last part draws the whole order. */
export function firstViewCut(k: number, opaque: number, total: number, parts: { readonly opaque: number; readonly transparent: number }): number {
  return k <= parts.opaque ? Math.round(opaque * k / parts.opaque) : opaque + Math.round((total - opaque) * (k - parts.opaque) / parts.transparent);
}

/** The shown shadow casters of `root` in the order the shadow pass meets them (scene order, depth first). */
export function casterOrder(root: THREE.Object3D): THREE.Object3D[] {
  const casters: THREE.Object3D[] = [];
  root.traverseVisible(object => {
    if (object.castShadow && (object instanceof THREE.Mesh || object instanceof THREE.Line || object instanceof THREE.Points)) casters.push(object);
  });
  return casters;
}
