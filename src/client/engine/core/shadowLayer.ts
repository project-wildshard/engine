import type { Layers, Object3D } from 'three';

/**
 * The layer of shadow-only casters: meshes drawn into the sun's shadow map and nowhere else (Cabin.ts's static depth
 * proxies, animalShadow.ts's one-draw animal casters). three.js tests a caster's layers against the VIEW camera in the
 * shadow pass (WebGLShadowMap.renderObject gets the camera being rendered, not the light's shadow camera), so enabling
 * this layer on the shadow cameras did nothing: Game.ts turns it on for the view camera while the shadow maps draw,
 * and only then. PINE-HOLLOW-REMASTER PH-P1 / P2.
 */
export const SHADOW_LAYER = 9;

/**
 * SHARD-SOURCE ss4d: the `userData` mark on a mesh that sits on SHADOW_LAYER only because a merge draws it for the view
 * (`groundMerge.ts` `mergeView`, AP8's merged props). It is still a real surface: a tap in the World Explorer picks it
 * (`explore/pick.ts`), where a true shadow-only caster (a cabin's depth proxy) stays unpickable.
 */
export const MERGED_VIEW = 'mergedView';

/** Whether a raycast hit on `object` is a drawn surface for a raycaster on `view`'s layers: on one of them, or a merged
 *  member its merge draws. */
export function drawnSurface(object: Object3D, view: Layers): boolean {
  return object.layers.test(view) || object.userData[MERGED_VIEW] === true;
}
