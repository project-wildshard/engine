/**
 * The emissive material family (SHARD-PLATFORM SF10a part 2): unlit light. Three shapes on three's MeshBasicMaterial:
 * - a **surface**: tint × intensity (HDR) × the vertex colours × a colour map, opaque or additive; lit windows, light
 *   boxes, lamps;
 * - a **tube** (Nine Dragon's neon calligraphy): a glyph drawn from a distance field with a whitened core, a darker
 *   glass rim, an optional seam and a short halo, added over what is behind it;
 * - a **sky** (Signal Dunes' painted dusk): a dome at infinity from one or two seamless panorama strips, blended by the
 *   look's `blend` (a runtime adapter feeds it: the dusk), with a held horizon, a soft top and crisp stars.
 * Every shape flickers by a seed (0 = steady) on the look's clock and takes a share of the fog: transmittance ^ `fog`
 * (an additive emitter only dims; an opaque one also takes that share of the fog's colour). The share is measured from
 * whatever fog chunk the page installed, so it works under the engine's fog as under three's.
 *
 * Program changes come only from the shape, `blend`, `vertexColours`, `doubleSided` and a map's presence; colour,
 * intensity, flicker, fog and every tube or sky number are uniforms. Identifiers carry a `famEmit` prefix.
 */
import * as THREE from 'three';
import { patchShader, PATCH_ORDER } from '../shaderPatches';
import { parseEmissiveLook, type EmissiveLookParams, type EmissiveMaterialParams } from '@wildshard/format/materialFamilies';
import type { TextureResolver } from './pbr';

/** the program-cache key prefix every emissive material shares (the shape follows it) */
export const EMISSIVE_PROGRAM_KEY = 'family.emissive.v1';

/** The uniforms one emissive look shares with every material made under it. */
export interface EmissiveLookUniforms {
  readonly famEmitGain: THREE.IUniform<number>;
  readonly famEmitBlend: THREE.IUniform<number>;
  readonly famEmitTime: THREE.IUniform<number>;
}

/** One emissive look: the gain, the sky blend and the flicker clock of every emissive material made under it. */
export class EmissiveLook {
  readonly uniforms: EmissiveLookUniforms = { famEmitGain: { value: 1 }, famEmitBlend: { value: 0 }, famEmitTime: { value: 0 } };
  private current: EmissiveLookParams;

  constructor(params: unknown = {}) {
    this.current = parseEmissiveLook(params);
    this.apply();
  }

  /** the look's parameters as last set (defaults filled) */
  get params(): EmissiveLookParams { return this.current; }

  /** move some of the look's parameters (a runtime adapter: the hour, the dusk); validated, uniforms only */
  set(params: Partial<EmissiveLookParams>): void {
    this.current = parseEmissiveLook({ ...this.current, ...params });
    this.apply();
  }

  /** advance the flicker clock (seconds) */
  tick(dt: number): void { this.uniforms.famEmitTime.value += dt; }

  private apply(): void {
    this.uniforms.famEmitGain.value = this.current.gain;
    this.uniforms.famEmitBlend.value = this.current.blend;
  }
}

const COMMON_FRAG = /* glsl */`
uniform float famEmitGain;
uniform float famEmitBlend;
uniform float famEmitTime;
uniform float famEmitIntensity;
uniform float famEmitFlicker;
uniform float famEmitFog;
float famEmitH11( float p ) { p = fract( p * 0.1031 ); p *= p + 33.33; p *= p + p; return fract( p ); }
float famEmitHash3( vec3 p ) { return fract( sin( dot( p, vec3( 127.1, 311.7, 74.7 ) ) ) * 43758.5453 ); }
/** 1, or a stutter: a few beats a cycle drop to 8 % */
float famEmitFlick( float seed ) {
	if ( seed <= 0.0 ) return 1.0;
	float t = famEmitTime * ( 0.9 + seed * 2.0 ) + seed * 57.0;
	float n = famEmitH11( floor( t ) + seed * 13.0 );
	float m = famEmitH11( floor( t * 14.0 ) + seed * 7.0 );
	return n < 0.3 ? ( m < 0.5 ? 0.08 : 1.0 ) : 1.0;
}
`;

const TUBE_FRAG = /* glsl */`
varying vec2 vFamEmitUv;
uniform sampler2D famEmitField;
uniform vec4 famEmitTubeA;   // x fill spread (em per unit of R from 0.5, ×2), y skeleton spread, z mono, w radius
uniform vec4 famEmitTubeB;   // x rim, y thicken, z seam, w seam width
uniform vec4 famEmitTubeC;   // x halo reach, y halo gain, z core whitening, w rim shade
uniform vec2 famEmitTubeCell; // the uv size of one field cell (0 = no border fade)
vec3 famEmitTube( vec3 tint ) {
	vec2 s = texture2D( famEmitField, vFamEmitUv ).rg;
	float dFill = ( s.r - 0.5 ) * 2.0 * famEmitTubeA.x + famEmitTubeB.y;
	float dSk = s.g * famEmitTubeA.y;
	float d = mix( dFill, famEmitTubeA.w - dSk, famEmitTubeA.z );
	float w = max( fwidth( d ), 1e-4 ) * 0.75;
	float fill = smoothstep( -w, w, d );
	float rim = fill * ( 1.0 - smoothstep( famEmitTubeB.x - w, famEmitTubeB.x + w, d ) );
	vec3 core = mix( tint, vec3( 1.0 ), famEmitTubeC.z );
	vec3 tube = mix( core, tint * famEmitTubeC.w, rim );
	float seam = ( 1.0 - smoothstep( famEmitTubeB.w - w, famEmitTubeB.w + w, dSk ) ) * fill * ( 1.0 - rim );
	tube *= 1.0 - seam * famEmitTubeB.z;
	float outside = max( -d, 0.0 );
	float reach = min( famEmitTubeC.x, famEmitTubeA.x * 0.9 );
	float halo = exp( -outside / ( reach * 0.35 ) ) * ( 1.0 - smoothstep( reach * 0.5, reach, outside ) ) * ( 1.0 - fill );
	if ( famEmitTubeCell.x > 0.0 ) {
		vec2 q = abs( fract( vFamEmitUv / famEmitTubeCell ) * 2.0 - 1.0 );
		halo *= 1.0 - smoothstep( 0.82, 1.0, max( q.x, q.y ) );
	}
	return tube * fill + tint * halo * famEmitTubeC.y;
}
`;

const SKY_FRAG = /* glsl */`
varying vec3 vFamEmitDir;
uniform sampler2D famEmitSkyA;
uniform sampler2D famEmitSkyB;
uniform vec4 famEmitSkyA4;   // x elevation bottom, y elevation top, z hold (deg), w dither
uniform vec4 famEmitSkyB4;   // x window low, y window high, z first gain low, w first gain high
uniform vec4 famEmitStars;   // x density, y gain, z elevation from, w elevation to
uniform vec2 famEmitStarsAppear;
vec3 famEmitStrip( sampler2D t, vec2 uv ) { return texture2D( t, uv ).rgb; }
vec3 famEmitSky() {
	vec3 d = normalize( vFamEmitDir );
	float heading = fract( atan( d.x, -d.z ) / 6.2831853 + 1.0 );
	float elev = degrees( asin( clamp( d.y, -1.0, 1.0 ) ) );
	float span = famEmitSkyA4.y - famEmitSkyA4.x, hold = famEmitSkyA4.z;
	float v = clamp( ( max( elev, hold ) - famEmitSkyA4.x ) / span, 0.002, 0.998 );
	vec2 uv = vec2( heading, v );
	float wL = smoothstep( famEmitSkyB4.x, famEmitSkyB4.y, famEmitBlend );
	float eGain = mix( famEmitSkyB4.z, famEmitSkyB4.w, smoothstep( 10.0, 30.0, elev ) );
	vec3 c = mix( famEmitStrip( famEmitSkyA, uv ) * eGain, famEmitStrip( famEmitSkyB, uv ), wL );
	vec3 low = vec3( 0.0 );
	float v3 = ( max( elev, hold * 0.32 ) - famEmitSkyA4.x ) / span;
	for ( int k = -4; k <= 4; k++ ) { vec2 q = vec2( heading + float( k ) / 720.0, v3 ); low += mix( famEmitStrip( famEmitSkyA, q ) * famEmitSkyB4.z, famEmitStrip( famEmitSkyB, q ), wL ); }
	c = mix( low / 9.0, c, smoothstep( hold * 0.8, hold * 1.6, elev ) );
	vec3 top = vec3( 0.0 );
	for ( int k = 0; k < 8; k++ ) { vec2 q = vec2( heading + float( k ) / 8.0, 0.96 ); top += mix( famEmitStrip( famEmitSkyA, q ), famEmitStrip( famEmitSkyB, q ), wL ); }
	top /= 8.0;
	c = mix( c, top, smoothstep( famEmitSkyA4.y - 7.0, famEmitSkyA4.y, elev ) ) * ( 1.0 - 0.3 * smoothstep( famEmitSkyA4.y, 90.0, elev ) );
	vec3 cellP = d * 300.0, cell = floor( cellP );
	vec3 spot = cell + 0.5 + ( vec3( famEmitHash3( cell + 1.7 ), famEmitHash3( cell + 5.3 ), famEmitHash3( cell + 9.1 ) ) - 0.5 ) * 0.5;
	float starDot = 1.0 - smoothstep( 0.08, 0.4, length( cellP - spot ) );
	float dark = 1.0 - smoothstep( 0.02, 0.08, dot( c, vec3( 0.2126, 0.7152, 0.0722 ) ) );
	float star = step( 1.0 - famEmitStars.x, famEmitHash3( cell ) ) * starDot * dark * smoothstep( famEmitStars.z, famEmitStars.w, elev ) * smoothstep( famEmitStarsAppear.x, famEmitStarsAppear.y, famEmitBlend );
	c += vec3( 0.75, 0.78, 0.85 ) * star * famEmitStars.y * ( 1.0 + 1.2 * famEmitHash3( cell + 3.1 ) );
	c += ( famEmitHash3( vec3( gl_FragCoord.xy, 7.0 ) ) - 0.5 ) * famEmitSkyA4.w;
	return max( c, vec3( 0.0 ) );
}
`;

/** the fog share: the page's fog chunk run on white and on black gives transmittance and inscatter, then ^ famEmitFog */
const FOG_WRAP = (additive: boolean): string => /* glsl */`
#ifdef USE_FOG
{
	vec3 famEmitC = gl_FragColor.rgb, famEmitOne, famEmitZero;
	{ gl_FragColor.rgb = vec3( 1.0 );
	#include <fog_fragment>
	famEmitOne = gl_FragColor.rgb; }
	{ gl_FragColor.rgb = vec3( 0.0 );
	#include <fog_fragment>
	famEmitZero = gl_FragColor.rgb; }
	vec3 famEmitT = clamp( famEmitOne - famEmitZero, 0.0, 1.0 );
	vec3 famEmitTk = pow( max( famEmitT, vec3( 1e-4 ) ), vec3( famEmitFog ) );
	gl_FragColor.rgb = famEmitC * famEmitTk${additive ? '' : ' + famEmitZero * ( 1.0 - famEmitTk ) / max( 1.0 - famEmitT, vec3( 1e-4 ) )'};
}
#endif
`;

type Shape = 'surface' | 'tube' | 'sky';
const shapeOf = (p: EmissiveMaterialParams): Shape => (p.tube !== null ? 'tube' : p.sky !== null ? 'sky' : 'surface');

/** The emissive shading for one shape injected into a MeshBasic source (throws if three moved an include it edits). */
export function injectEmissive(vertexShader: string, fragmentShader: string, shape: Shape, additive: boolean): { vertexShader: string; fragmentShader: string } {
  for (const inc of ['#include <common>', '#include <begin_vertex>']) if (!vertexShader.includes(inc)) throw new Error(`emissive family: the basic vertex source has no ${inc}`);
  for (const inc of ['#include <common>', '#include <opaque_fragment>', '#include <fog_fragment>']) if (!fragmentShader.includes(inc)) throw new Error(`emissive family: the basic fragment source has no ${inc}`);
  const varying = shape === 'tube' ? 'varying vec2 vFamEmitUv;' : shape === 'sky' ? 'varying vec3 vFamEmitDir;' : '';
  const assign = shape === 'tube' ? 'vFamEmitUv = uv;' : shape === 'sky' ? 'vFamEmitDir = position;' : '';
  const vs = vertexShader.replace('#include <common>', `#include <common>\n${varying}`).replace('#include <begin_vertex>', `#include <begin_vertex>\n${assign}`);
  const light = shape === 'tube' ? 'famEmitTube( outgoingLight )' : shape === 'sky' ? 'famEmitSky() * outgoingLight' : 'outgoingLight';
  const fs = fragmentShader
    .replace('#include <common>', `#include <common>\n${COMMON_FRAG}${shape === 'tube' ? TUBE_FRAG : shape === 'sky' ? SKY_FRAG : ''}`)
    .replace('#include <opaque_fragment>', `outgoingLight = ${light} * famEmitIntensity * famEmitGain * famEmitFlick( famEmitFlicker );\n#include <opaque_fragment>`)
    .replace('#include <fog_fragment>', FOG_WRAP(additive));
  return { vertexShader: vs, fragmentShader: fs };
}

/** Compile an emissive surface under `look` to a three.js material (WebGL v1 renderer). */
export function compileEmissive(params: EmissiveMaterialParams, look: EmissiveLook, textures: TextureResolver): THREE.MeshBasicMaterial {
  const shape = shapeOf(params);
  const additive = params.blend === 'additive';
  const m = new THREE.MeshBasicMaterial({
    color: new THREE.Color().setRGB(...params.colour, THREE.SRGBColorSpace),
    vertexColors: params.vertexColours,
    map: params.map === null ? null : textures(params.map, 'colour'),
    side: shape === 'sky' ? THREE.BackSide : params.doubleSided ? THREE.DoubleSide : THREE.FrontSide,
  });
  if (additive) { m.blending = THREE.AdditiveBlending; m.transparent = true; m.depthWrite = false; }
  // a sky is at infinity: drawn first, never occluding, never fogged
  if (shape === 'sky') { m.depthWrite = false; m.depthTest = false; m.fog = false; }
  m.name = `family:emissive:${shape}`;
  const own: Record<string, THREE.IUniform> = {
    famEmitIntensity: { value: params.intensity }, famEmitFlicker: { value: params.flicker }, famEmitFog: { value: params.fog },
  };
  const t = params.tube, s = params.sky;
  if (t !== null) {
    own['famEmitField'] = { value: textures(t.field, 'data') };
    own['famEmitTubeA'] = { value: new THREE.Vector4(t.fillSpread, t.skeletonSpread, t.mono, t.radius) };
    own['famEmitTubeB'] = { value: new THREE.Vector4(t.rim, t.thicken, t.seam, t.seamWidth) };
    own['famEmitTubeC'] = { value: new THREE.Vector4(t.haloReach, t.haloGain, t.core, t.rimShade) };
    own['famEmitTubeCell'] = { value: t.cell === null ? new THREE.Vector2() : new THREE.Vector2(t.cell[0], t.cell[1]) };
  }
  if (s !== null) {
    const first = textures(s.maps[0], 'colour');
    own['famEmitSkyA'] = { value: first };
    own['famEmitSkyB'] = { value: s.maps[1] === null ? first : textures(s.maps[1], 'colour') };
    own['famEmitSkyA4'] = { value: new THREE.Vector4(s.elevation[0], s.elevation[1], s.hold, s.dither) };
    own['famEmitSkyB4'] = { value: new THREE.Vector4(s.window[0], s.window[1], s.firstGain[0], s.firstGain[1]) };
    own['famEmitStars'] = { value: new THREE.Vector4(s.stars.density, s.stars.gain, s.stars.elevation[0], s.stars.elevation[1]) };
    own['famEmitStarsAppear'] = { value: new THREE.Vector2(s.stars.appear[0], s.stars.appear[1]) };
  }
  m.userData['familyUniforms'] = own;
  patchShader(m, 'engine.family.emissive', PATCH_ORDER.material, (shader) => {
    Object.assign(shader.uniforms, look.uniforms, own);
    const out = injectEmissive(shader.vertexShader, shader.fragmentShader, shape, additive);
    shader.vertexShader = out.vertexShader;
    shader.fragmentShader = out.fragmentShader;
  }, { key: `${EMISSIVE_PROGRAM_KEY}|${shape}${additive ? '|add' : ''}` });
  return m;
}
