/**
 * The layer of shadow-only casters: meshes drawn into the sun's shadow map and nowhere else (Cabin.ts's static depth
 * proxies, animalShadow.ts's one-draw animal casters). three.js tests a caster's layers against the VIEW camera in the
 * shadow pass (WebGLShadowMap.renderObject gets the camera being rendered, not the light's shadow camera), so enabling
 * this layer on the shadow cameras did nothing: Game.ts turns it on for the view camera while the shadow maps draw,
 * and only then. PINE-HOLLOW-REMASTER PH-P1 / P2.
 */
export const SHADOW_LAYER = 9;
