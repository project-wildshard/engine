/**
 * What a three.js scene says about a surface (meta SHARD-SOURCE AP10 to AP12, `@wildshard/format/scene-render`), drawn on
 * the family's own material after it compiles (`registry.ts`):
 *
 * - **PBR** `blend: 'alpha'` and `opacity`: a see-through surface (a stencil, a sign), drawn after the opaque world with
 *   no depth write (three sorts it back to front); `depthOffset`: a polygon offset (a decal on a wall); `sway`: each vertex
 *   moves by its `wsSway` attribute (the GLB's `_SWAY` channel, metres) along the wind at about `rate` hertz, phased by
 *   where it stands; `uvScroll`: the colour map's uv moves on the look's clock.
 * - **Emissive** `blend: 'alpha'`: an unlit card blended over what is behind it; `card`: every vertex is a camera-facing
 *   card corner, `position` its seat and `wsCorner` (the GLB's `_CORNER` channel) the corner's view-space offset;
 *   `motion`: the card's `pulse`, `drift` or `rise`, phased by its seat.
 *
 * A see-through surface is marked `userData.sceneAlpha`, so a prop's GLB (opaque by default) never turns it opaque
 * (`declaredProps.ts`). Every number is a uniform; the program changes only with which of these a surface uses. The clock is the emissive
 * look's (`famEmitTime`): with no emissive look the surface holds still.
 */
import * as THREE from 'three';
import type { EmissiveMaterialParams, PbrMaterialParams } from '@wildshard/format/materialFamilies';
import { patchShader, PATCH_ORDER } from '../shaderPatches';

/** the attribute a swaying surface reads (GLTFLoader's `_sway`, renamed by its binding's channels) */
export const SWAY_ATTRIBUTE = 'wsSway';
/** the attribute a card reads (GLTFLoader's `_corner`) */
export const CORNER_ATTRIBUTE = 'wsCorner';

/** The vertex channels a surface reads, as `PropSurfaceBinding.channels`; null when it reads none. */
export function sceneSurfaceChannels(entry: unknown): Readonly<Record<string, { readonly attribute: string; readonly itemSize: number }>> | null {
  if (typeof entry !== 'object' || entry === null) return null;
  const row = entry as { readonly family?: unknown; readonly sway?: unknown; readonly card?: unknown };
  if (row.family === 'pbr' && row.sway !== undefined) return { _sway: { attribute: SWAY_ATTRIBUTE, itemSize: 1 } };
  if (row.family === 'emissive' && row.card === true) return { _corner: { attribute: CORNER_ATTRIBUTE, itemSize: 2 } };
  return null;
}

const STILL: THREE.IUniform<number> = { value: 0 };

const SWAY_VERTEX = /* glsl */`
#include <begin_vertex>
{
	mat4 wsSwayM = modelMatrix;
	vec3 wsSwayAt = ( wsSwayM * vec4( transformed, 1.0 ) ).xyz;
	float wsSwayPh = wsSceneTime * wsSwayWind.z * 6.2831853 + wsSwayAt.x * 0.37 + wsSwayAt.z * 0.29;
	float wsSwayAmt = wsSway * ( 0.7 * sin( wsSwayPh ) + 0.3 * sin( wsSwayPh * 2.3 + 1.7 ) );
	vec3 wsSwayDir = transpose( mat3( wsSwayM ) ) * vec3( wsSwayWind.x, 0.0, wsSwayWind.y );
	transformed += wsSwayDir * wsSwayAmt;
}
`;

/** PBR: alpha, depth offset, sway and uv scroll (a no-op for a surface with none of them). */
export function applySceneSurface(m: THREE.MeshStandardMaterial, params: PbrMaterialParams, clock: THREE.IUniform<number> = STILL): void {
  if (params.blend === 'alpha') { m.transparent = true; m.depthWrite = false; m.opacity = params.opacity ?? 1; m.userData['sceneAlpha'] = true; }
  const offset = params.depthOffset ?? 0;
  if (offset !== 0) { m.polygonOffset = true; m.polygonOffsetFactor = offset; m.polygonOffsetUnits = offset; }
  const sway = params.sway, scroll = params.uvScroll;
  if (sway === undefined && scroll === undefined) return;
  const uniforms: Record<string, THREE.IUniform> = {
    wsSceneTime: clock,
    wsSwayWind: { value: new THREE.Vector3(sway?.direction[0] ?? 0, sway?.direction[1] ?? 0, sway?.rate ?? 0) },
    wsUvScroll: { value: new THREE.Vector2(scroll?.[0] ?? 0, scroll?.[1] ?? 0) },
  };
  patchShader(m, 'engine.family.sceneSurface', PATCH_ORDER.material, (shader) => {
    Object.assign(shader.uniforms, uniforms);
    let vs = shader.vertexShader.replace('#include <common>', `#include <common>\nuniform float wsSceneTime;\nuniform vec3 wsSwayWind;\nuniform vec2 wsUvScroll;\n${sway === undefined ? '' : `attribute float ${SWAY_ATTRIBUTE};`}`);
    if (sway !== undefined) vs = vs.replace('#include <begin_vertex>', SWAY_VERTEX);
    if (scroll !== undefined) vs = vs.replace('#include <uv_vertex>', '#include <uv_vertex>\n#ifdef USE_MAP\n\tvMapUv += wsUvScroll * wsSceneTime;\n#endif');
    shader.vertexShader = vs;
  }, { key: (before) => `${before}|scene-surface|${sway === undefined ? '' : 's'}${scroll === undefined ? '' : 'u'}` });
}

const CARD_VERTEX = /* glsl */`
	vec3 wsSeat = transformed;
	float wsPh = fract( sin( dot( wsSeat, vec3( 127.1, 311.7, 74.7 ) ) ) * 43758.5453 );
	vec2 wsC = ${CORNER_ATTRIBUTE};
	float wsT = wsCardTime * wsCardMotion.y;
	wsCardFade = 1.0;
	if ( wsCardMotion.x > 0.5 && wsCardMotion.x < 1.5 ) {
		float s = 0.6 * sin( wsT * 6.2831853 + wsPh * 6.2831853 ) + 0.4 * sin( wsT * 15.1 + wsPh * 12.0 );
		wsC.y *= 1.0 + wsCardMotion.z * s;
		wsC.x *= 1.0 - 0.5 * wsCardMotion.z * s;
	} else if ( wsCardMotion.x > 1.5 && wsCardMotion.x < 2.5 ) {
		wsSeat += vec3( sin( wsT + wsPh * 6.2831853 ), 0.42 * sin( wsT * 2.3 + wsPh * 12.5 ), cos( wsT * 0.83 + wsPh * 6.2831853 ) ) * wsCardMotion.z;
	} else if ( wsCardMotion.x > 2.5 ) {
		float k = fract( wsPh * 7.0 + wsT );
		float a = wsPh * 40.0;
		wsSeat += vec3( cos( a ) * wsCardMotion.w * k, wsCardMotion.z * k, sin( a ) * wsCardMotion.w * k );
		wsCardFade = 1.0 - k;
		wsC *= 1.0 - 0.5 * k;
	}
	vec4 mvPosition = modelViewMatrix * vec4( wsSeat, 1.0 );
	mvPosition.xy += wsC;
	gl_Position = projectionMatrix * mvPosition;
`;

const MOTION_KIND: Readonly<Record<string, number>> = { pulse: 1, drift: 2, rise: 3 };

/** Emissive: alpha blend, cards and their motion (a no-op for a plain surface). `clock` is the emissive look's. */
export function applySceneEmissive(m: THREE.MeshBasicMaterial, params: EmissiveMaterialParams, clock: THREE.IUniform<number>): void {
  if (params.blend === 'alpha') { m.transparent = true; m.depthWrite = false; m.alphaTest = Math.max(m.alphaTest, 0.01); m.userData['sceneAlpha'] = true; }
  if (params.card !== true) return;
  const motion = params.motion;
  const vector = new THREE.Vector4(motion === undefined ? 0 : MOTION_KIND[motion.kind] ?? 0, motion?.rate ?? 0,
    motion === undefined ? 0 : motion.kind === 'pulse' ? motion.amount : motion.kind === 'drift' ? motion.radius : motion.height,
    motion?.kind === 'rise' ? motion.spread : 0);
  const uniforms: Record<string, THREE.IUniform> = { wsCardTime: clock, wsCardMotion: { value: vector } };
  m.userData['sceneCard'] = true;
  patchShader(m, 'engine.family.sceneCard', PATCH_ORDER.material, (shader) => {
    Object.assign(shader.uniforms, uniforms);
    if (!shader.vertexShader.includes('#include <project_vertex>')) throw new Error('scene card: the basic vertex source has no <project_vertex>');
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nuniform float wsCardTime;\nuniform vec4 wsCardMotion;\nattribute vec2 ${CORNER_ATTRIBUTE};\nvarying float wsCardFade;`)
      .replace('#include <project_vertex>', CARD_VERTEX);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float wsCardFade;')
      .replace('#include <opaque_fragment>', 'outgoingLight *= wsCardFade;\ndiffuseColor.a *= wsCardFade;\n#include <opaque_fragment>');
  }, { key: (before) => `${before}|scene-card` });
}
