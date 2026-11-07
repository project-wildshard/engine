/**
 * The painterly material family (SHARD-PLATFORM SF10a part 2): Nalati Grasslands' style B as a family. Soft cel bands
 * (the sun through a three-band ramp), the shade painted with a sky tint instead of going black, a warm terminator band,
 * a rim light on the sun's side of the silhouette, a painted floor that keeps dark paint off black, wetness, wind sway,
 * and the look's display grade applied per pixel in the material, so the style needs no full-screen pass (the one-frame
 * rule: a shard's style lives in its materials and a per-pixel grade).
 *
 * It is the light model of `engine/world/painterly.ts` moved per look: the page-wide uniforms there become a
 * `PainterlyLook`'s, the sun is read from three's `directionalLights[0]` (its unshadowed colour recovers the cast shadow
 * as a ratio, as the toon family does) instead of a synced copy, and the grade is Nalati's `v2Grade` with its numbers as
 * parameters. Identifiers carry a `famPaint` prefix.
 *
 * One program per object variant: everything that differs between painterly materials is a per-material uniform (rim,
 * bands, shade, floor, sway); a program changes only with `vertexColours`, `doubleSided`, `alphaCutoff > 0`, a map's
 * presence and whether the look grades. A graded material is not tone mapped by the renderer (its output is display
 * linear already); the renderer's sRGB output encoding still applies.
 */
import * as THREE from 'three';
import { patchShader, PATCH_ORDER } from '../shaderPatches';
import { parsePainterlyLook, type PainterlyLookParams, type PainterlyMaterialParams } from '@wildshard/format/materialFamilies';
import type { TextureResolver } from './pbr';
import { applyPaintedTerrain } from './paintedTerrain';

/** the program-cache key every painterly material shares (`|g` when its look grades) */
export const PAINTERLY_PROGRAM_KEY = 'family.painterly.v1';

const VERT_PARS = /* glsl */`
uniform float famPaintSway;
uniform float famPaintTime;
uniform vec3 famPaintWind;
`;

const VERT_SWAY = /* glsl */`
#include <begin_vertex>
if ( famPaintSway > 0.0 ) {
	mat4 pM = modelMatrix;
	#ifdef USE_INSTANCING
		pM = pM * instanceMatrix;
	#endif
	#ifdef USE_BATCHING
		pM = pM * batchingMatrix;
	#endif
	vec3 pW = pM[ 3 ].xyz;
	float pPh = famPaintTime * 1.6 + pW.x * 0.13 + pW.z * 0.11;
	float pH = max( position.y, 0.0 );
	float pAmt = famPaintSway * famPaintWind.z * pH * pH * ( 0.65 + 0.35 * sin( pPh ) ) + famPaintSway * famPaintWind.z * pH * pH * 0.25 * sin( pPh * 2.3 + 1.7 );
	vec3 pDir = transpose( mat3( pM ) ) * vec3( famPaintWind.x, 0.0, famPaintWind.y );
	pDir /= max( dot( pDir, pDir ), 1e-6 );
	transformed += pDir * pAmt;
}
`;

/** the grade (display-linear out): Nalati's v2Grade with its constants as uniforms */
const GRADE_GLSL = /* glsl */`
uniform vec4 famPaintGradeA;   // x exposure × gain, y 1 / shoulder, z saturation, w contrast
uniform vec3 famPaintShadowTint;
uniform vec3 famPaintLightTint;
uniform vec3 famPaintGradeB;   // x split low, y split high, z the hour's saturation
vec3 famPaintGrade( vec3 x ) {
	const vec3 LUM = vec3( 0.2126, 0.7152, 0.0722 );
	x = max( x, vec3( 0.0 ) ) * famPaintGradeA.x;
	vec3 c = x * ( 1.0 + x * famPaintGradeA.y ) / ( 1.0 + x );
	float l = dot( c, LUM );
	c = mix( vec3( l ), c, famPaintGradeA.z );
	c *= mix( famPaintShadowTint, famPaintLightTint, smoothstep( famPaintGradeB.x, famPaintGradeB.y, l ) );
	c = clamp( c, 0.0, 1.0 );
	c = c * c * ( 3.0 - 2.0 * c ) * famPaintGradeA.w + c * ( 1.0 - famPaintGradeA.w );
	return mix( vec3( dot( c, LUM ) ), c, famPaintGradeB.z );
}
`;

const FRAG_PARS = /* glsl */`
varying vec3 vViewPosition;
uniform vec3 famPaintShade;
uniform vec3 famPaintRimColour;
uniform float famPaintWarm;
uniform float famPaintFloor;
uniform float famPaintWet;
uniform float famPaintRim;
uniform float famPaintBands;
uniform float famPaintShadeAmt;
uniform float famPaintFloorAmt;

struct LambertMaterial {
	vec3 diffuseColor;
	float specularStrength;
};

float famPaintWetAt( vec3 nView ) {
	if ( famPaintWet <= 0.0 ) return 0.0;
	vec3 upV = normalize( ( viewMatrix * vec4( 0.0, 1.0, 0.0, 0.0 ) ).xyz );
	return famPaintWet * ( 0.3 + 0.7 * smoothstep( 0.1, 0.75, dot( nView, upV ) ) );
}

float famPaintCel( float x ) {
	float c = 0.52 * smoothstep( 0.03, 0.13, x ) + 0.48 * smoothstep( 0.34, 0.5, x );
	return mix( x, c, famPaintBands );
}

void RE_Direct_Lambert( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in LambertMaterial material, inout ReflectedLight reflectedLight ) {
	float dotNL = saturate( dot( geometryNormal, directLight.direction ) );
	#if NUM_DIR_LIGHTS > 0
	if ( dot( directLight.direction, directionalLights[ 0 ].direction ) > 0.999 ) {
		vec3 sunRef = directionalLights[ 0 ].color;
		float ref = max( dot( sunRef, vec3( 1.0 ) ), 1e-4 );
		float vis = clamp( dot( directLight.color, vec3( 1.0 ) ) / ref, 0.0, 1.0 );
		vec3 lightCol = directLight.color / max( vis, 1e-3 );
		float l = famPaintCel( dotNL * vis );
		vec3 irradiance = lightCol * l + famPaintShade * ( 1.0 - l ) * famPaintShadeAmt;
		float pTerm = smoothstep( 0.02, 0.2, l ) * ( 1.0 - smoothstep( 0.45, 0.85, l ) );
		float pWarmKey = clamp( ( sunRef.r - sunRef.b ) / max( sunRef.r, 1e-3 ) * 4.0, 0.0, 1.0 );
		irradiance *= mix( vec3( 1.0 ), vec3( 1.16, 0.98, 0.8 ), pTerm * famPaintWarm * pWarmKey );
		float pWet = famPaintWetAt( geometryNormal );
		reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor * ( 1.0 - 0.38 * pWet ) );
		if ( pWet > 0.0 ) {
			vec3 pH = normalize( directLight.direction + geometryViewDir );
			reflectedLight.directDiffuse += lightCol * vis * pow( saturate( dot( geometryNormal, pH ) ), 120.0 ) * pWet * 0.6;
		}
		return;
	}
	#endif
	reflectedLight.directDiffuse += dotNL * directLight.color * BRDF_Lambert( material.diffuseColor );
}

void RE_IndirectDiffuse_Lambert( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in LambertMaterial material, inout ReflectedLight reflectedLight ) {
	float pWet = famPaintWetAt( geometryNormal );
	reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert( material.diffuseColor * ( 1.0 - 0.38 * pWet ) );
	reflectedLight.indirectDiffuse += irradiance * pow( 1.0 - saturate( dot( geometryNormal, geometryViewDir ) ), 5.0 ) * pWet * 0.07;
	reflectedLight.indirectDiffuse += famPaintShade * famPaintFloor * famPaintFloorAmt * BRDF_Lambert( max( vec3( 0.22 ) - material.diffuseColor, vec3( 0.0 ) ) );
}

#define RE_Direct RE_Direct_Lambert
#define RE_IndirectDiffuse RE_IndirectDiffuse_Lambert
`;

const FRAG_RIM = /* glsl */`
#include <aomap_fragment>
#if NUM_DIR_LIGHTS > 0
if ( famPaintRim > 0.0 ) {
	vec3 pN = normalize( normal );
	vec3 pV = normalize( vViewPosition );
	float pFres = pow( 1.0 - saturate( dot( pN, pV ) ), 3.0 );
	vec3 pSunV = directionalLights[ 0 ].direction;
	float pBack = saturate( dot( -pV, pSunV ) );
	float pSide = saturate( dot( pN, pSunV ) * 0.5 + 0.5 );
	float pRim = smoothstep( 0.25, 0.75, pFres ) * ( 0.35 + 0.65 * pBack ) * pSide * famPaintRim;
	totalEmissiveRadiance += famPaintRimColour * mix( diffuseColor.rgb, vec3( 1.0 ), 0.5 ) * pRim;
}
#endif
`;

const FRAG_GRADE = /* glsl */`
gl_FragColor.rgb = famPaintGrade( gl_FragColor.rgb );
#include <tonemapping_fragment>
`;

/** The includes the painterly patch edits (throws if three moved one). */
const NEEDS = ['#include <common>', '#include <begin_vertex>', '#include <lights_lambert_pars_fragment>', '#include <aomap_fragment>', '#include <envmap_fragment>', '#include <tonemapping_fragment>'] as const;

/** The painterly light model (and, with `graded`, the per-pixel grade) injected into a MeshLambert source. */
export function injectPainterly(vertexShader: string, fragmentShader: string, graded: boolean): { vertexShader: string; fragmentShader: string } {
  for (const inc of NEEDS) if (!vertexShader.includes(inc) && !fragmentShader.includes(inc)) throw new Error(`painterly family: the Lambert source has no ${inc}`);
  const vs = vertexShader.replace('#include <common>', `#include <common>\n${VERT_PARS}`).replace('#include <begin_vertex>', VERT_SWAY);
  let fs = fragmentShader
    .replace('#include <common>', `#include <common>\n${graded ? GRADE_GLSL : ''}`)
    .replace('#include <lights_lambert_pars_fragment>', FRAG_PARS)
    .replace('#include <aomap_fragment>', FRAG_RIM)
    .replace('#include <envmap_fragment>', '');
  if (graded) fs = fs.replace('#include <tonemapping_fragment>', FRAG_GRADE);
  return { vertexShader: vs, fragmentShader: fs };
}

/** The uniforms one painterly look shares with every material made under it. */
export interface PainterlyLookUniforms {
  readonly famPaintShade: THREE.IUniform<THREE.Color>;
  readonly famPaintRimColour: THREE.IUniform<THREE.Color>;
  readonly famPaintWarm: THREE.IUniform<number>;
  readonly famPaintFloor: THREE.IUniform<number>;
  readonly famPaintWet: THREE.IUniform<number>;
  readonly famPaintTime: THREE.IUniform<number>;
  readonly famPaintWind: THREE.IUniform<THREE.Vector3>;
  readonly famPaintGradeA: THREE.IUniform<THREE.Vector4>;
  readonly famPaintShadowTint: THREE.IUniform<THREE.Color>;
  readonly famPaintLightTint: THREE.IUniform<THREE.Color>;
  readonly famPaintGradeB: THREE.IUniform<THREE.Vector3>;
}

/**
 * One painterly look: the shared uniforms of every painterly material made under it (one per shard). A runtime adapter
 * (the day keys, the weather) moves it with `set`; whether it grades is fixed when it is made.
 */
export class PainterlyLook {
  readonly uniforms: PainterlyLookUniforms = {
    famPaintShade: { value: new THREE.Color() }, famPaintRimColour: { value: new THREE.Color() },
    famPaintWarm: { value: 0 }, famPaintFloor: { value: 0 }, famPaintWet: { value: 0 }, famPaintTime: { value: 0 },
    famPaintWind: { value: new THREE.Vector3() },
    famPaintGradeA: { value: new THREE.Vector4() }, famPaintShadowTint: { value: new THREE.Color() },
    famPaintLightTint: { value: new THREE.Color() }, famPaintGradeB: { value: new THREE.Vector3() },
  };
  /** whether its materials grade per pixel (fixed: a change would be a program change) */
  readonly graded: boolean;
  private current: PainterlyLookParams;

  constructor(params: unknown = {}) {
    this.current = parsePainterlyLook(params);
    this.graded = this.current.grade !== null;
    this.apply();
  }

  /** the look's parameters as last set (defaults filled) */
  get params(): PainterlyLookParams { return this.current; }

  /** move some of the look's parameters (validated, uniforms only; the grade may change but not appear or vanish) */
  set(params: Partial<PainterlyLookParams>): void {
    const next = parsePainterlyLook({ ...this.current, ...params });
    if ((next.grade !== null) !== this.graded) throw new Error('painterly look: whether it grades is fixed for its life');
    this.current = next;
    this.apply();
  }

  /** advance the sway clock (seconds) */
  tick(dt: number): void { this.uniforms.famPaintTime.value += dt; }

  private apply(): void {
    const p = this.current, u = this.uniforms;
    u.famPaintShade.value.setRGB(...p.shade);
    u.famPaintRimColour.value.setRGB(...p.rim);
    u.famPaintWarm.value = p.warm;
    u.famPaintFloor.value = p.floor;
    u.famPaintWet.value = p.wet;
    const [wx, wz] = p.wind.direction, l = Math.hypot(wx, wz) || 1;
    u.famPaintWind.value.set(wx / l, wz / l, p.wind.strength);
    const g = p.grade;
    if (g === null) return;
    u.famPaintGradeA.value.set(g.gain * g.exposure, 1 / g.shoulder, g.saturation, g.contrast);
    u.famPaintShadowTint.value.setRGB(...g.shadowTint);
    u.famPaintLightTint.value.setRGB(...g.lightTint);
    u.famPaintGradeB.value.set(g.split[0], g.split[1], g.lookSaturation);
  }
}

/** a painterly material's own uniforms (what differs per surface without a program change) */
export interface PainterlyMaterialUniforms {
  readonly famPaintRim: THREE.IUniform<number>;
  readonly famPaintBands: THREE.IUniform<number>;
  readonly famPaintShadeAmt: THREE.IUniform<number>;
  readonly famPaintFloorAmt: THREE.IUniform<number>;
  readonly famPaintSway: THREE.IUniform<number>;
}

const withColour = new WeakSet<THREE.BufferGeometry>();
/** a geometry drawn with vertex colours on must carry `color`: add a white one (as the shard's painterly material does) */
function ensureColour(geo: THREE.BufferGeometry): void {
  if (withColour.has(geo)) return;
  withColour.add(geo);
  if (geo.hasAttribute('color')) return;
  geo.setAttribute('color', new THREE.BufferAttribute(new Uint8Array(geo.getAttribute('position').count * 3).fill(255), 3, true));
}

/** Compile a painterly surface under `look` to a three.js material (WebGL v1 renderer). */
export function compilePainterly(params: PainterlyMaterialParams, look: PainterlyLook, textures: TextureResolver): THREE.MeshLambertMaterial {
  const m = new THREE.MeshLambertMaterial({
    color: new THREE.Color().setRGB(...params.colour, THREE.SRGBColorSpace),
    vertexColors: params.vertexColours,
    emissive: new THREE.Color().setRGB(...params.emissive, THREE.SRGBColorSpace),
    emissiveIntensity: params.emissiveIntensity,
    map: params.map === null ? null : textures(params.map, 'colour'),
    side: params.doubleSided ? THREE.DoubleSide : THREE.FrontSide,
    alphaTest: params.alphaCutoff,
    // a graded surface writes display-linear colour: the renderer must not tone map it again
    toneMapped: !look.graded,
  });
  m.name = 'family:painterly';
  const own: PainterlyMaterialUniforms = {
    famPaintRim: { value: params.rim }, famPaintBands: { value: params.bands }, famPaintShadeAmt: { value: params.shade },
    famPaintFloorAmt: { value: params.floor }, famPaintSway: { value: params.sway },
  };
  m.userData['familyUniforms'] = own;
  patchShader(m, 'engine.family.painterly', PATCH_ORDER.material, (shader) => {
    Object.assign(shader.uniforms, look.uniforms, own);
    const out = injectPainterly(shader.vertexShader, shader.fragmentShader, look.graded);
    shader.vertexShader = out.vertexShader;
    shader.fragmentShader = out.fragmentShader;
  }, { key: look.graded ? `${PAINTERLY_PROGRAM_KEY}|g` : PAINTERLY_PROGRAM_KEY });
  if (params.vertexColours) m.onBeforeRender = (_r, _s, _c, geometry) => { ensureColour(geometry); };
  if (params.terrain !== undefined) applyPaintedTerrain(m, params.terrain, textures);
  return m;
}
