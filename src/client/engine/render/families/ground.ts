/**
 * The PBR family's ground layer (SHARD-PLATFORM SF10a part 2): a procedural surface for a stylised ground, first made for
 * Signal Dunes' sand. On top of the PBR surface (vertex colours carry the crest / hollow split) it adds, per pixel:
 * - **wind ripples** in two octaves across the wind, bent by slow warps and a coarse mottle, in patches, gone on slip
 *   faces and past a fade distance, each octave kept only while a pixel resolves it (no aliasing, no fixed fade), as
 *   albedo and as a tilt of the normal;
 * - **grain**: a tile (R albedo, G / B bump) at several scales and crisp procedural clumps near the camera, every
 *   distance-faded term zero-mean, so detail never changes the ground's brightness with distance;
 * - broad albedo drifts, pale wind streaks and an optional trail mask;
 * - **terrain light shaping** for the key (the scene's first directional light): a baked visibility map, a crisp
 *   terminator on the ground's own normal, a brighter grazing band, a sheen, a coloured shade fill, a light-saturation
 *   split and an "away from the glow" darkening an adapter raises as the light goes;
 * - up to four **light pools** (campfires, lanterns) warming the ground round them, read from the owning emitter uniform.
 * It is Signal Dunes' sand shader with its numbers as parameters (GroundLayerSchema); a runtime adapter moves them with
 * `updateGround` (uniforms only). Identifiers carry a `famG` prefix.
 */
import * as THREE from 'three';
import { patchShader, PATCH_ORDER } from '../shaderPatches';
import { parseGroundLayer, type GroundLayerParams } from '@wildshard/format/materialFamilies';
import type { TextureResolver } from './pbr';

/** the program-cache key of every PBR material with a ground layer */
export const GROUND_PROGRAM_KEY = 'family.pbr.ground.v1';

const VERT_PARS = 'varying vec3 vFamGPos;\nvarying vec3 vFamGN;';
const VERT_WORLD = '#include <worldpos_vertex>\nvFamGPos = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;\nvFamGN = normalize( mat3( modelMatrix ) * objectNormal );';

const FRAG_PARS = /* glsl */`
varying vec3 vFamGPos;
varying vec3 vFamGN;
uniform vec2 famGWind;
uniform vec3 famGK;          // x, y: ripple wavenumbers (rad / m), z: lump
uniform vec2 famGDepth;
uniform vec3 famGRelief;
uniform vec4 famGContrast;   // near, far, window from, window to
uniform float famGContrastK;
uniform vec2 famGFade;
uniform vec2 famGSlip;
uniform vec2 famGFlat;
uniform vec4 famGPatch;      // floor, near, window from, window to
uniform sampler2D famGGrain;
uniform vec4 famGGrainK;     // mean, glint mean, clump strength, has a map
uniform vec3 famGMacroLo;
uniform vec3 famGMacroHi;
uniform float famGAlbedo;
uniform vec4 famGStreak;     // tint, amount
uniform sampler2D famGTrail;
uniform vec4 famGTrailRect;
uniform vec4 famGTrailK;     // ripples kept, amount, has a map
uniform vec3 famGTrailTint;
uniform sampler2D famGShadow;
uniform vec4 famGShadowRect;
uniform vec4 famGShadowK;    // edge low, edge high, floor, has a map
uniform float famGTerm;
uniform vec3 famGCrest;      // band low, band high, gain
uniform float famGSheen;
uniform vec3 famGShadeTint;
uniform vec3 famGShadeLift;
uniform vec3 famGShadeFloor;
uniform vec3 famGShadeK;     // gain, amount, edge
uniform vec2 famGSat;        // flat, facing
uniform vec4 famGCool;       // cool tint, keep
uniform vec3 famGAway;       // from (x, z), amount
uniform vec4 famGPools[ 4 ]; // xyz the pool, w its strength (0 = out)
uniform vec3 famGPoolLow;
uniform vec3 famGPoolHigh;
uniform vec3 famGPoolK;      // split, radius, gain
float famGAA( float phase ) { return 1.0 - smoothstep( 0.5, 1.8, fwidth( phase ) ); }
float famGH( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
float famGN( vec2 p ) { vec2 i = floor( p ), f = fract( p ); f = f * f * ( 3.0 - 2.0 * f );
	return mix( mix( famGH( i ), famGH( i + vec2( 1.0, 0.0 ) ), f.x ), mix( famGH( i + vec2( 0.0, 1.0 ) ), famGH( i + vec2( 1.0, 1.0 ) ), f.x ), f.y ); }
vec2 famGRectUv( vec3 p, vec4 r ) { return ( p.xz - r.xy ) / ( r.zw - r.xy ); }
vec4 famGGrainAt( vec2 uv ) { return famGGrainK.w > 0.5 ? texture2D( famGGrain, uv ) : vec4( famGGrainK.x, 0.5, 0.5, 1.0 ); }
`;

const FRAG_COLOUR = /* glsl */`
#include <color_fragment>
	float famGFar = length( vFamGPos - cameraPosition );
	vec2 famGW = famGWind;
	float famGU = dot( vFamGPos.xz, famGW ), famGV = dot( vFamGPos.xz, vec2( -famGW.y, famGW.x ) );
	float famGWarp = sin( famGV * 0.21 ) * 1.3 + sin( famGV * 0.053 + famGU * 0.04 ) * 3.5 + sin( famGU * 0.017 + famGV * 0.11 ) * 2.2;
	float famGLump = famGN( vec2( famGU * 0.9, famGV * 0.35 ) ) + 0.5 * famGN( vec2( famGU * 2.1, famGV * 0.9 ) + 7.3 );
	float famGPhase = ( famGU + famGWarp ) * famGK.x + famGLump * famGK.z;
	float famGPhase2 = ( famGU * 0.97 + famGWarp * 1.6 + sin( famGV * 0.6 ) * 0.35 + sin( famGV * 0.13 + famGU * 0.09 ) * 1.1 ) * famGK.y;
	float famGFlatK = smoothstep( famGFlat.x, famGFlat.y, normalize( vFamGN ).y );
	float famGPatchK = clamp( 0.5 + 0.6 * sin( famGV * 0.31 + sin( famGU * 0.19 ) * 1.7 ) * sin( famGU * 0.27 + famGV * 0.07 + 1.3 ), famGPatch.x, 1.0 );
	famGPatchK = max( famGPatchK, famGPatch.y * ( 1.0 - smoothstep( famGPatch.z, famGPatch.w, famGFar ) ) );
	float famGSlipK = 1.0 - smoothstep( famGSlip.x, famGSlip.y, normalize( vFamGN ).y );
	float famGFadeK = ( 1.0 - 0.9 * famGSlipK ) * ( 1.0 - smoothstep( famGFade.x, famGFade.y, famGFar ) );
	float famGRip1 = famGAA( famGPhase ) * ( 0.65 + 0.35 * famGFlatK ) * famGPatchK * famGFadeK;
	float famGRip2 = famGAA( famGPhase2 ) * famGFlatK * ( 0.4 + 0.6 * famGPatchK ) * famGFadeK;
	vec4 famGTex = famGGrainAt( vFamGPos.xz * 0.55 );
	float famGTrod = famGTrailK.z > 0.5 ? texture2D( famGTrail, famGRectUv( vFamGPos, famGTrailRect ) ).r : 0.0;
	famGRip1 *= 1.0 - ( 1.0 - famGTrailK.x ) * famGTrod; famGRip2 *= 1.0 - ( 1.0 - famGTrailK.x ) * famGTrod;
	float famGNear = mix( famGContrast.x, famGContrast.y, smoothstep( famGContrast.z, famGContrast.w, famGFar ) ) * famGContrastK;
	famGRip1 *= famGNear; famGRip2 *= famGNear;
	float famGMean = famGGrainK.x;
	diffuseColor.rgb *= 1.0 + famGDepth.x * ( sin( famGPhase ) - 0.35 * max( 0.0, -sin( famGPhase ) ) * 2.0 + 0.2228 ) * famGRip1 + famGDepth.y * sin( famGPhase2 ) * famGRip2 + ( famGTex.r - famGMean ) * 0.3
		+ ( smoothstep( 0.82, 0.95, famGTex.r ) - smoothstep( 0.82, 0.95, 1.0 - famGTex.r ) - famGGrainK.y ) * 0.9 * ( 1.0 - smoothstep( 3.0, 18.0, famGFar ) )
		+ ( famGGrainAt( vFamGPos.xz * 2.3 + 0.37 ).r - famGMean ) * 1.8 * ( 1.0 - smoothstep( 4.0, 22.0, famGFar ) )
		+ ( famGGrainAt( vFamGPos.xz * 0.9 + 0.71 ).r - famGMean ) * 1.3 * ( 1.0 - smoothstep( 6.0, 30.0, famGFar ) )
		+ ( famGGrainAt( vFamGPos.xz * 0.28 + 0.13 ).r - famGMean ) * 1.6 * ( 1.0 - smoothstep( 8.0, 40.0, famGFar ) );
	{
		vec2 gc = vFamGPos.xz * 95.0, gc2 = vFamGPos.xz * 48.0 + 17.0;
		float gA = ( 1.0 - smoothstep( 0.8, 1.6, length( fwidth( gc ) ) ) ) * famGGrainK.z, gB = ( 1.0 - smoothstep( 0.8, 1.6, length( fwidth( gc2 ) ) ) ) * famGGrainK.z;
		float grains = ( famGN( gc ) - 0.5 ) * 0.75 * gA + ( famGN( gc2 ) - 0.5 ) * 0.7 * gB;
		float glint = ( step( 0.985, famGH( floor( gc2 ) ) ) - 0.015 ) * gB * 0.9;
		diffuseColor.rgb *= max( 0.2, 1.0 + grains + glint );
	}
	float famGDrift = sin( famGU * 0.045 + sin( famGV * 0.031 ) * 2.0 ) * sin( famGV * 0.052 + 1.7 ) + 0.5 * sin( famGU * 0.11 + famGV * 0.07 );
	float famGStreakK = smoothstep( 0.55, 0.95, sin( famGV * 1.9 + sin( famGU * 0.07 ) * 3.0 ) * sin( famGV * 0.37 + 0.6 ) ) * ( 0.4 + 0.6 * famGFlatK );
	float famGMacro = famGN( vFamGPos.xz * 0.018 + 3.7 ) * 0.6 + famGN( vFamGPos.xz * 0.045 + 9.1 ) * 0.4;
	diffuseColor.rgb *= mix( famGMacroLo, famGMacroHi, famGMacro );
	diffuseColor.rgb *= ( 1.0 + 0.08 * famGDrift ) * famGAlbedo;
	diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * famGTrailTint, famGTrod * famGTrailK.y );
	diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * famGStreak.rgb, famGStreakK * famGStreak.a );
`;

const FRAG_NORMAL = /* glsl */`
#include <normal_fragment_maps>
	{
		float s1 = ( cos( famGPhase ) + 0.4 * cos( 2.0 * famGPhase ) ) * mix( famGRelief.x, famGRelief.y, smoothstep( 4.0, 20.0, famGFar ) ) * famGRip1;
		float s2 = cos( famGPhase2 ) * famGRelief.z * famGRip2;
		vec2 bump = ( famGTex.gb - 0.5 ) * 0.5 * ( 1.0 - smoothstep( 8.0, 40.0, famGFar ) );
		vec2 gq = vFamGPos.xz * 95.0, gq2 = vFamGPos.xz * 48.0 + 17.0;
		float gqA = ( 1.0 - smoothstep( 0.8, 1.6, length( fwidth( gq ) ) ) ) * famGGrainK.z, gqB = ( 1.0 - smoothstep( 0.8, 1.6, length( fwidth( gq2 ) ) ) ) * famGGrainK.z;
		vec2 grainSlope = vec2( famGN( gq + vec2( 0.3, 0.0 ) ) - famGN( gq - vec2( 0.3, 0.0 ) ), famGN( gq + vec2( 0.0, 0.3 ) ) - famGN( gq - vec2( 0.0, 0.3 ) ) ) * 0.85 * gqA
			+ vec2( famGN( gq2 + vec2( 0.3, 0.0 ) ) - famGN( gq2 - vec2( 0.3, 0.0 ) ), famGN( gq2 + vec2( 0.0, 0.3 ) ) - famGN( gq2 - vec2( 0.0, 0.3 ) ) ) * 0.7 * gqB;
		vec3 tilt = vec3( famGW.x, 0.0, famGW.y ) * ( s1 + s2 ) + vec3( bump.x, 0.0, bump.y ) + vec3( grainSlope.x, 0.0, grainSlope.y );
		normal = normalize( normal - ( viewMatrix * vec4( tilt, 0.0 ) ).xyz );
	}
`;

const FRAG_LIGHT = /* glsl */`
#include <lights_fragment_end>
	{
		#if NUM_DIR_LIGHTS > 0
		vec3 famGKey = normalize( inverseTransformDirection( directionalLights[ 0 ].direction, viewMatrix ) );
		#else
		vec3 famGKey = vec3( 0.0, 1.0, 0.0 );
		#endif
		vec3 famGNrm = normalize( vFamGN );
		float famGVis = 1.0;
		if ( famGShadowK.w > 0.5 ) {
			famGVis = smoothstep( famGShadowK.x, famGShadowK.y, texture2D( famGShadow, famGRectUv( vFamGPos, famGShadowRect ) ).r );
			vec4 r = famGShadowRect;
			float edgeDist = min( min( vFamGPos.x - r.x, r.z - vFamGPos.x ), min( vFamGPos.z - r.y, r.w - vFamGPos.z ) );
			famGVis = max( famGVis, 1.0 - smoothstep( 0.0, 8.0, edgeDist ) );
			reflectedLight.directDiffuse *= mix( famGShadowK.z, 1.0, famGVis );
		}
		float tN = max( dot( famGNrm, famGKey ), 0.0 );
		reflectedLight.directDiffuse *= smoothstep( 0.0, famGTerm, tN ) * mix( ( 0.12 + 0.88 * tN ) * 0.63, 0.27 * pow( tN / 0.35, 1.6 ), smoothstep( 0.3, 0.5, length( famGNrm.xz ) ) ) / max( tN, 0.02 );
		float graze = dot( famGNrm, famGKey );
		reflectedLight.directDiffuse *= 1.0 + famGCrest.z * smoothstep( 0.0, famGCrest.x, graze ) * ( 1.0 - smoothstep( famGCrest.x + 0.02, famGCrest.y, graze ) ) * famGVis;
		reflectedLight.directSpecular *= famGVis;
		vec3 toCam = normalize( cameraPosition - vFamGPos );
		float sheenV = 1.0 - saturate( dot( famGNrm, toCam ) );
		float sheenSide = smoothstep( -0.2, 0.4, dot( normalize( famGKey.xz + vec2( 1e-4 ) ), normalize( toCam.xz + vec2( 1e-4 ) ) ) );
		reflectedLight.directDiffuse *= 1.0 + famGSheen * pow( sheenV, 4.0 ) * famGVis * sheenSide;
		float keyN = dot( famGNrm, famGKey );
		float shadeK = 1.0 - smoothstep( 0.0, famGShadeK.z, keyN ) * famGVis;
		vec3 fill = reflectedLight.indirectDiffuse;
		reflectedLight.indirectDiffuse = mix( reflectedLight.indirectDiffuse, fill * famGShadeTint * famGShadeK.x + famGShadeLift * shadeK, shadeK * famGShadeK.y );
		reflectedLight.indirectDiffuse += famGShadeFloor;
		for ( int i = 0; i < 4; i ++ ) {
			float poolD = length( vFamGPos - famGPools[ i ].xyz );
			reflectedLight.indirectDiffuse += diffuseColor.rgb * mix( famGPoolLow, famGPoolHigh, step( famGPoolK.x, famGPools[ i ].w ) ) * famGPools[ i ].w * pow( max( 0.0, 1.0 - poolD / famGPoolK.y ), 3.0 ) * famGPoolK.z;
		}
		vec2 glowXZ = normalize( famGAway.xy + vec2( 1e-6 ) );
		float away = famGAway.z * ( 1.0 - smoothstep( -0.45, -0.05, dot( famGNrm.xz, glowXZ ) ) ) * smoothstep( 0.08, 0.3, length( famGNrm.xz ) );
		reflectedLight.indirectDiffuse *= 1.0 - away; reflectedLight.directDiffuse *= 1.0 - away;
		const vec3 W3 = vec3( 0.2126, 0.7152, 0.0722 );
		float dL = dot( reflectedLight.directDiffuse, W3 ), iL = dot( reflectedLight.indirectDiffuse, W3 );
		reflectedLight.directDiffuse = max( mix( vec3( dL ), reflectedLight.directDiffuse, famGSat.x + ( famGSat.y - famGSat.x ) * smoothstep( 0.2, 0.45, keyN ) ), vec3( 0.0 ) );
		reflectedLight.indirectDiffuse = mix( vec3( iL ) * famGCool.rgb, reflectedLight.indirectDiffuse, famGCool.a );
		reflectedLight.indirectDiffuse *= 1.0 + ( 0.5 * sin( famGPhase ) * famGRip1 + 0.07 * sin( famGPhase2 ) * famGRip2 ) * shadeK + ( famGTex.r - 0.5 ) * 0.18;
	}
`;

/** The ground layer injected into a MeshStandard / MeshPhysical source (throws if three moved an include it edits). */
export function injectGround(vertexShader: string, fragmentShader: string): { vertexShader: string; fragmentShader: string } {
  for (const inc of ['#include <common>', '#include <worldpos_vertex>']) if (!vertexShader.includes(inc)) throw new Error(`ground layer: the vertex source has no ${inc}`);
  for (const inc of ['#include <common>', '#include <color_fragment>', '#include <normal_fragment_maps>', '#include <lights_fragment_end>']) if (!fragmentShader.includes(inc)) throw new Error(`ground layer: the fragment source has no ${inc}`);
  return {
    vertexShader: vertexShader.replace('#include <common>', `#include <common>\n${VERT_PARS}`).replace('#include <worldpos_vertex>', VERT_WORLD),
    fragmentShader: fragmentShader.replace('#include <common>', `#include <common>\n${FRAG_PARS}`)
      .replace('#include <color_fragment>', FRAG_COLOUR).replace('#include <normal_fragment_maps>', FRAG_NORMAL)
      .replace('#include <lights_fragment_end>', FRAG_LIGHT),
  };
}

let grey: THREE.DataTexture | null = null;
/** the 1×1 filler a missing grain / trail / shadow map samples (never read: its `has` flag is off) */
function filler(): THREE.DataTexture {
  if (grey) return grey;
  grey = new THREE.DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1);
  grey.name = 'family:ground-filler';
  grey.needsUpdate = true;
  return grey;
}

type Uniforms = Record<string, THREE.IUniform>;
interface GroundState { params: GroundLayerParams; readonly uniforms: Uniforms; readonly textures: TextureResolver }
/** how many light pools a ground layer draws */
export const GROUND_POOLS = 4;
const states = new WeakMap<THREE.Material, GroundState>();

const v2 = (a: number, b: number): THREE.Vector2 => new THREE.Vector2(a, b);
const v3 = (a: number, b: number, c: number): THREE.Vector3 => new THREE.Vector3(a, b, c);
const v4 = (a: number, b: number, c: number, d: number): THREE.Vector4 => new THREE.Vector4(a, b, c, d);

/** the uniforms for a ground layer's parameters (fresh objects; `write` copies them into the live ones) */
function uniformsOf(p: GroundLayerParams, textures: TextureResolver): Uniforms {
  const wl = Math.hypot(p.wind[0], p.wind[1]) || 1;
  const k = (lambda: number): number => (2 * Math.PI) / lambda;
  return {
    famGWind: { value: v2(p.wind[0] / wl, p.wind[1] / wl) },
    famGK: { value: v3(k(p.wavelength[0]), k(p.wavelength[1]), p.lump) },
    famGDepth: { value: v2(...p.depth) },
    famGRelief: { value: v3(...p.relief) },
    famGContrast: { value: v4(p.contrast.near, p.contrast.far, p.contrast.window[0], p.contrast.window[1]) },
    famGContrastK: { value: p.contrast.strength },
    famGFade: { value: v2(...p.fade) },
    famGSlip: { value: v2(...p.slip) },
    famGFlat: { value: v2(...p.flat) },
    famGPatch: { value: v4(p.patches.floor, p.patches.near, p.patches.window[0], p.patches.window[1]) },
    famGGrain: { value: p.grain.map === null ? filler() : textures(p.grain.map, 'data') },
    famGGrainK: { value: v4(p.grain.mean, p.grain.glintMean, p.grain.strength, p.grain.map === null ? 0 : 1) },
    famGMacroLo: { value: v3(...p.macro[0]) },
    famGMacroHi: { value: v3(...p.macro[1]) },
    famGAlbedo: { value: p.albedo },
    famGStreak: { value: v4(...p.streaks.tint, p.streaks.amount) },
    famGTrail: { value: p.trail === null ? filler() : textures(p.trail.map, 'data') },
    famGTrailRect: { value: p.trail === null ? v4(0, 0, 1, 1) : v4(...p.trail.rect) },
    famGTrailK: { value: p.trail === null ? v4(1, 0, 0, 0) : v4(p.trail.ripples, p.trail.amount, 1, 0) },
    famGTrailTint: { value: p.trail === null ? v3(1, 1, 1) : v3(...p.trail.tint) },
    famGShadow: { value: p.keyShadow === null ? filler() : textures(p.keyShadow.map, 'data') },
    famGShadowRect: { value: p.keyShadow === null ? v4(0, 0, 1, 1) : v4(...p.keyShadow.rect) },
    famGShadowK: { value: p.keyShadow === null ? v4(0, 1, 1, 0) : v4(p.keyShadow.edge[0], p.keyShadow.edge[1], p.keyShadow.floor, 1) },
    famGTerm: { value: Math.max(p.terminator, 1e-4) },
    famGCrest: { value: v3(p.crest.band[0], p.crest.band[1], p.crest.gain) },
    famGSheen: { value: p.sheen },
    famGShadeTint: { value: v3(...p.shade.tint) },
    famGShadeLift: { value: v3(...p.shade.lift) },
    famGShadeFloor: { value: v3(...p.shade.floor) },
    famGShadeK: { value: v3(p.shade.gain, p.shade.amount, Math.max(p.shade.edge, 1e-4)) },
    famGSat: { value: v2(p.saturation.flat, p.saturation.facing) },
    famGCool: { value: v4(...p.saturation.coolTint, p.saturation.keep) },
    famGAway: { value: v3(p.away.from[0], p.away.from[1], p.away.amount) },
    famGPoolLow: { value: p.pools === null ? v3(0, 0, 0) : v3(...p.pools.low) },
    famGPoolHigh: { value: p.pools === null ? v3(0, 0, 0) : v3(...p.pools.high) },
    famGPoolK: { value: p.pools === null ? v3(0.5, 1, 0) : v3(p.pools.split, p.pools.radius, p.pools.gain) },
  };
}

/** Add a ground layer to a PBR family material (the PBR compiler calls it; the program becomes the ground program). */
export function applyGround(m: THREE.MeshStandardMaterial, params: GroundLayerParams, textures: TextureResolver, emitterPools?: (id: string) => { readonly value: readonly THREE.Vector4[] }): void {
  const source = params.pools?.source;
  if (source !== undefined && emitterPools === undefined) throw new Error('Ground pools require their emitter input');
  const uniform = source === undefined ? { value: Array.from({ length: GROUND_POOLS }, () => new THREE.Vector4()) } : emitterPools?.(source);
  if (uniform === undefined || uniform.value.length !== GROUND_POOLS) throw new Error('Ground emitter pool size differs');
  const uniforms: Uniforms = { ...uniformsOf(params, textures), famGPools: uniform };
  states.set(m, { params, uniforms, textures });
  m.userData['familyUniforms'] = uniforms;
  patchShader(m, 'engine.family.ground', PATCH_ORDER.material, (shader) => {
    Object.assign(shader.uniforms, uniforms);
    const out = injectGround(shader.vertexShader, shader.fragmentShader);
    shader.vertexShader = out.vertexShader;
    shader.fragmentShader = out.fragmentShader;
  }, { key: GROUND_PROGRAM_KEY });
}

/**
 * Move some of a ground layer's parameters on a live material (a runtime adapter: Signal Dunes' dusk). Validated;
 * uniforms only. A map that appears or vanishes is still a uniform (a filler stands in), never a recompile.
 */
export function updateGround(m: THREE.Material, params: Partial<GroundLayerParams>): void {
  const state = states.get(m);
  if (state === undefined) throw new Error('updateGround: not a PBR family material with a ground layer');
  state.params = parseGroundLayer({ ...state.params, ...params });
  const next = uniformsOf(state.params, state.textures);
  for (const [name, u] of Object.entries(next)) {
    const live = state.uniforms[name];
    if (live === undefined) continue;
    const cur: unknown = live.value, val: unknown = u.value;
    if (cur instanceof THREE.Vector4 && val instanceof THREE.Vector4) cur.copy(val);
    else if (cur instanceof THREE.Vector3 && val instanceof THREE.Vector3) cur.copy(val);
    else if (cur instanceof THREE.Vector2 && val instanceof THREE.Vector2) cur.copy(val);
    else live.value = val;
  }
}
