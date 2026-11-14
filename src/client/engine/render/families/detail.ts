/**
 * The PBR family's detail layer (meta TEMPLATES-CLEANROOM M4.11, `@wildshard/format/detail-layer`, J338's procedural
 * route): the stone, slab, wood and moss texture a cleanroom paints on canvases, drawn by the shader from world position,
 * so it costs no bytes and needs no UVs. Per pixel:
 * - broad value-noise blotches swing the albedo by `mottle`, a fine speckle by `grain`;
 * - the same pattern, read as a height in metres, tilts the shading normal by `relief` (screen-space bump, Mikkelsen's
 *   surface-gradient method, as three's bump map);
 * - `moss` grows on up-facing faces where a second, coarser noise passes `1 - amount`.
 * Every knob is a uniform over one shader text, so all detailed surfaces share one program. Identifiers carry a `famD`
 * prefix. A surface takes a detail layer alone, not with a ground or measure layer (each owns the albedo).
 */
import * as THREE from 'three';
import { patchShader, PATCH_ORDER } from '../shaderPatches';
import type { PbrMaterialParams } from '@wildshard/format/materialFamilies';

/** a PBR surface's detail layer (`@wildshard/format/detail-layer`'s `DetailLayer`) */
type DetailLayer = NonNullable<PbrMaterialParams['detail']>;

/** the program-cache key of every PBR material with a detail layer */
export const DETAIL_PROGRAM_KEY = 'family.pbr.detail.v1';
/** the speckle's frequency over the blotches' */
const GRAIN_OCTAVE = 9;
/** the relief's height (m) per metre of pattern scale at `relief` 1 */
const RELIEF_HEIGHT = 0.12;

const VERT_PARS = 'varying vec3 vFamDPos;\nvarying vec3 vFamDN;';
const VERT_WORLD = /* glsl */`#include <worldpos_vertex>
vec4 famDW = vec4( transformed, 1.0 );
vec3 famDN = objectNormal;
#ifdef USE_INSTANCING
famDW = instanceMatrix * famDW;
famDN = mat3( instanceMatrix ) * famDN;
#endif
vFamDPos = ( modelMatrix * famDW ).xyz;
vFamDN = normalize( mat3( modelMatrix ) * famDN );`;

const FRAG_PARS = /* glsl */`
varying vec3 vFamDPos;
varying vec3 vFamDN;
uniform vec4 famDK;     // 1 / scale (1/m), mottle, grain, relief height (m)
uniform vec4 famDMoss;  // linear colour, amount (0 = none)
float famDHash( vec3 p ) { p = fract( p * 0.1031 ); p += dot( p, p.zyx + 31.32 ); return fract( ( p.x + p.y ) * p.z ); }
float famDNoise( vec3 p ) {
  vec3 i = floor( p ), f = fract( p );
  f = f * f * ( 3.0 - 2.0 * f );
  float a = mix( famDHash( i ), famDHash( i + vec3( 1.0, 0.0, 0.0 ) ), f.x );
  float b = mix( famDHash( i + vec3( 0.0, 1.0, 0.0 ) ), famDHash( i + vec3( 1.0, 1.0, 0.0 ) ), f.x );
  float c = mix( famDHash( i + vec3( 0.0, 0.0, 1.0 ) ), famDHash( i + vec3( 1.0, 0.0, 1.0 ) ), f.x );
  float d = mix( famDHash( i + vec3( 0.0, 1.0, 1.0 ) ), famDHash( i + vec3( 1.0, 1.0, 1.0 ) ), f.x );
  return mix( mix( a, b, f.y ), mix( c, d, f.y ), f.z );
}
float famDFbm( vec3 p ) { return 0.5 * famDNoise( p ) + 0.3 * famDNoise( p * 2.03 + 11.0 ) + 0.2 * famDNoise( p * 4.01 + 23.0 ); }`;

const FRAG_COLOUR = /* glsl */`#include <color_fragment>
vec3 famDP = vFamDPos * famDK.x;
float famDM = famDFbm( famDP );
float famDG = famDNoise( famDP * ${GRAIN_OCTAVE.toFixed(1)} );
diffuseColor.rgb *= max( 0.0, 1.0 + ( famDM - 0.5 ) * 2.0 * famDK.y + ( famDG - 0.5 ) * famDK.z );
float famDMossK = 0.0;
if ( famDMoss.w > 0.0 ) {
  float famDUp = smoothstep( 0.5, 0.85, normalize( vFamDN ).y );
  famDMossK = famDUp * smoothstep( 1.0 - famDMoss.w, 1.0 - famDMoss.w + 0.2, famDFbm( famDP * 0.6 + 7.0 ) * 0.7 + famDM * 0.3 );
  diffuseColor.rgb = mix( diffuseColor.rgb, famDMoss.rgb * ( 0.8 + 0.4 * famDG ), famDMossK );
}`;

const FRAG_NORMAL = /* glsl */`#include <normal_fragment_maps>
if ( famDK.w > 0.0 ) {
  float famDH = ( famDM + ( famDG - 0.5 ) * 0.3 + famDMossK * 0.4 ) * famDK.w;
  vec3 famDSx = dFdx( -vViewPosition ), famDSy = dFdy( -vViewPosition );
  vec3 famDR1 = cross( famDSy, normal ), famDR2 = cross( normal, famDSx );
  float famDDet = dot( famDSx, famDR1 ) * faceDirection;
  vec3 famDGrad = sign( famDDet ) * ( dFdx( famDH ) * famDR1 + dFdy( famDH ) * famDR2 );
  normal = normalize( abs( famDDet ) * normal - famDGrad );
}`;

/** Draw a detail layer on a PBR material (in place). */
export function applyDetail(m: THREE.MeshStandardMaterial, detail: DetailLayer): void {
  const moss = detail.moss;
  const mossColour = moss === undefined ? new THREE.Color(0, 0, 0) : new THREE.Color().setRGB(moss.colour[0], moss.colour[1], moss.colour[2], THREE.SRGBColorSpace);
  const uniforms: Record<string, { value: unknown }> = {
    famDK: { value: new THREE.Vector4(1 / detail.scale, detail.mottle, detail.grain, detail.relief * detail.scale * RELIEF_HEIGHT) },
    famDMoss: { value: new THREE.Vector4(mossColour.r, mossColour.g, mossColour.b, moss?.amount ?? 0) },
  };
  patchShader(m, 'engine.family.detail', PATCH_ORDER.material, (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>\n${VERT_PARS}`).replace('#include <worldpos_vertex>', VERT_WORLD);
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>\n${FRAG_PARS}`).replace('#include <color_fragment>', FRAG_COLOUR).replace('#include <normal_fragment_maps>', FRAG_NORMAL);
  }, { key: DETAIL_PROGRAM_KEY });
}
