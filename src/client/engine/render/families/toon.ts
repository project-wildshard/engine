/**
 * The toon material family (SHARD-PLATFORM SF10a): a two-band ramp with coloured shade, a terminator band, a banded rim,
 * drifting cloud shade and caustics under a water level, on three's MeshStandardMaterial. The light model is the one
 * the faceted toon shard installs page-wide today, moved per material: it is injected after three's
 * `lights_physical_pars_fragment` and redefines `RE_Direct` / `RE_IndirectDiffuse` / `RE_IndirectSpecular`, so it wins
 * over any page-wide patch of that chunk and needs no global state. Its identifiers carry a `famToon` prefix so both
 * can sit in one program.
 *
 * Every toon material shares one program per object variant (the look's numbers are uniforms of a `ToonLook`, shared
 * by every material made under it; a runtime adapter moves them with `set`). Program changes come only from the
 * material's `vertexColours`, `faceted` and `doubleSided`.
 *
 * The sun is the first directional light (three's `directionalLights[0]`); its unshadowed colour recovers the cast
 * shadow as a ratio. Point and spot lights keep three's physical path. The image-based diffuse is dropped (the sky is
 * the environment; its diffuse would wash the two bands into a gradient); its specular stays for metals.
 */
import * as THREE from 'three';
import { patchShader, PATCH_ORDER } from '../shaderPatches';
import { parseToonLook, type ToonLookParams, type ToonMaterialParams } from '@wildshard/format/materialFamilies';

/** the program-cache key every toon material shares (the source is the same for all of them) */
export const TOON_PROGRAM_KEY = 'family.toon.v1';

const TOON_GLSL = /* glsl */`
uniform vec2 famToonFace;
uniform vec2 famToonShadow;
uniform vec2 famToonGrade;
uniform vec3 famToonLift;
uniform vec3 famToonRim;
uniform vec3 famToonTerm;
uniform float famToonGloss;
uniform vec4 famToonCloud;
uniform float famToonTime;
uniform vec2 famToonWater;

float famToonHash( vec2 p ) { p = fract( p * vec2( 123.34, 456.21 ) ); p += dot( p, p + 45.32 ); return fract( p.x * p.y ); }
float famToonNoise( vec2 p ) {
	vec2 i = floor( p ), f = fract( p );
	vec2 u = f * f * ( 3.0 - 2.0 * f );
	return mix( mix( famToonHash( i ), famToonHash( i + vec2( 1.0, 0.0 ) ), u.x ), mix( famToonHash( i + vec2( 0.0, 1.0 ) ), famToonHash( i + vec2( 1.0, 1.0 ) ), u.x ), u.y );
}
vec3 famToonWorld( vec3 viewPos ) { return cameraPosition + ( vec4( viewPos, 0.0 ) * viewMatrix ).xyz; }
/** 1 = open sky, lower = under a cloud's shade (two octaves of value noise scrolled by the wind) */
float famToonCloudShade( vec3 viewPos ) {
	if ( famToonCloud.x <= 0.0 ) return 1.0;
	vec3 w = famToonWorld( viewPos );
	vec2 p = ( w.xz + famToonCloud.zw * famToonTime ) / famToonCloud.y;
	float n = famToonNoise( p ) * 0.65 + famToonNoise( p * 2.3 + 7.1 ) * 0.35;
	return 1.0 - famToonCloud.x * smoothstep( 0.46, 0.68, n );
}
/** sunlight focused onto what lies under the water level: filaments where two drifting noise fields cross */
float famToonCaustics( vec3 viewPos ) {
	vec3 w = famToonWorld( viewPos );
	float d = famToonWater.x - w.y;
	if ( d <= 0.0 ) return 0.0;
	vec2 p = w.xz * 0.42; float t = famToonTime * 0.55;
	float a = famToonNoise( p + vec2( t * 0.31, t * 0.17 ) ), b = famToonNoise( p * 1.63 - vec2( t * 0.21, -t * 0.29 ) + 3.7 );
	float c = pow( 1.0 - abs( a - b ), 9.0 );
	return c * famToonWater.y * smoothstep( 0.7, 1.8, d ) * exp( -d * 0.18 );
}

void RE_Direct_FamToon( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
	#if NUM_DIR_LIGHTS > 0
	if ( dot( directLight.direction, directionalLights[ 0 ].direction ) > 0.9999 ) {
		vec3 sunCol = directionalLights[ 0 ].color;
		float shadow = clamp( dot( directLight.color, vec3( 1.0 ) ) / max( dot( sunCol, vec3( 1.0 ) ), 1e-5 ), 0.0, 1.0 );
		float NdL = dot( geometryNormal, directLight.direction );
		float faceLit = smoothstep( famToonFace.x, famToonFace.y, NdL ), inSun = smoothstep( famToonShadow.x, famToonShadow.y, shadow );
		float band = faceLit * inSun;
		float grade = 1.0 - famToonGrade.x + famToonGrade.x * saturate( NdL );
		vec3 alb = material.diffuseContribution;
		float cloud = famToonCloudShade( geometryPosition );
		vec3 irr = sunCol * ( band * grade * cloud + ( 1.0 - band ) * famToonGrade.y * saturate( NdL ) * 0.5 )
			+ sunCol * vec3( 0.7, 1.0, 1.05 ) * band * cloud * famToonCaustics( geometryPosition );
		float term = faceLit * ( 1.0 - faceLit ) * inSun * 4.0;
		vec3 satAlb = alb * alb / max( max( alb.r, max( alb.g, alb.b ) ), 1e-3 );
		reflectedLight.directDiffuse += RECIPROCAL_PI * ( alb * irr + satAlb * famToonTerm * term * sunCol );
		vec3 nW = inverseTransformDirection( geometryNormal, viewMatrix );
		float fres = smoothstep( 0.55, 0.8, 1.0 - saturate( dot( geometryNormal, geometryViewDir ) ) );
		float rim = fres * smoothstep( -0.3, 0.2, NdL ) * shadow * cloud * smoothstep( 0.85, 0.4, abs( nW.y ) );
		reflectedLight.directDiffuse += famToonRim * rim * sunCol * RECIPROCAL_PI * ( 0.35 + alb );
		if ( material.roughness < famToonGloss ) {
			IncidentLight lit = directLight;
			lit.color = sunCol * band;
			ReflectedLight spec = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
			RE_Direct_Physical( lit, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, spec );
			reflectedLight.directSpecular += spec.directSpecular;
		}
		return;
	}
	#endif
	RE_Direct_Physical( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
}

void RE_IndirectDiffuse_FamToon( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
	reflectedLight.indirectDiffuse += ( irradiance + famToonLift ) * BRDF_Lambert( material.diffuseContribution );
}

void RE_IndirectSpecular_FamToon( const in vec3 radiance, const in vec3 irradiance, const in vec3 clearcoatRadiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
	RE_IndirectSpecular_Physical( radiance, vec3( 0.0 ), clearcoatRadiance, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
}

#undef RE_Direct
#undef RE_IndirectDiffuse
#undef RE_IndirectSpecular
#define RE_Direct				RE_Direct_FamToon
#define RE_IndirectDiffuse		RE_IndirectDiffuse_FamToon
#define RE_IndirectSpecular		RE_IndirectSpecular_FamToon
`;

const INCLUDE = '#include <lights_physical_pars_fragment>';

/** The toon light model injected into a MeshStandard / MeshPhysical fragment source (throws if three's chunk moved). */
export function injectToon(fragmentShader: string): string {
  if (!fragmentShader.includes(INCLUDE)) throw new Error('toon family: the fragment shader has no lights_physical_pars_fragment include');
  return fragmentShader.replace(INCLUDE, `${INCLUDE}\n${TOON_GLSL}`);
}

/** The uniforms one toon look shares with every material made under it. */
export interface ToonLookUniforms {
  readonly famToonFace: THREE.IUniform<THREE.Vector2>;
  readonly famToonShadow: THREE.IUniform<THREE.Vector2>;
  readonly famToonGrade: THREE.IUniform<THREE.Vector2>;
  readonly famToonLift: THREE.IUniform<THREE.Color>;
  readonly famToonRim: THREE.IUniform<THREE.Color>;
  readonly famToonTerm: THREE.IUniform<THREE.Color>;
  readonly famToonGloss: THREE.IUniform<number>;
  readonly famToonCloud: THREE.IUniform<THREE.Vector4>;
  readonly famToonTime: THREE.IUniform<number>;
  readonly famToonWater: THREE.IUniform<THREE.Vector2>;
}

/** no water: a level far below anything drawn */
const NO_WATER = -1e4;

/**
 * One toon look: the shared uniforms of every toon material made under it. Several looks can be live in one frame
 * (one per shard on the grid); each material reads its own look's uniforms.
 */
export class ToonLook {
  readonly uniforms: ToonLookUniforms = {
    famToonFace: { value: new THREE.Vector2() }, famToonShadow: { value: new THREE.Vector2() }, famToonGrade: { value: new THREE.Vector2() },
    famToonLift: { value: new THREE.Color() }, famToonRim: { value: new THREE.Color() }, famToonTerm: { value: new THREE.Color() },
    famToonGloss: { value: 0 }, famToonCloud: { value: new THREE.Vector4() }, famToonTime: { value: 0 }, famToonWater: { value: new THREE.Vector2() },
  };
  private current: ToonLookParams;

  constructor(params: unknown = {}) {
    this.current = parseToonLook(params);
    this.apply();
  }

  /** the look's parameters as last set (defaults filled) */
  get params(): ToonLookParams { return this.current; }

  /** move some of the look's parameters (a runtime adapter: the day clock); validated, uniforms only */
  set(params: Partial<ToonLookParams>): void {
    this.current = parseToonLook({ ...this.current, ...params });
    this.apply();
  }

  /** advance the cloud and caustic scroll (seconds) */
  tick(dt: number): void { this.uniforms.famToonTime.value += dt; }

  private apply(): void {
    const p = this.current, u = this.uniforms;
    u.famToonFace.value.set(p.faceEdge[0], p.faceEdge[1]);
    u.famToonShadow.value.set(p.shadowEdge[0], p.shadowEdge[1]);
    u.famToonGrade.value.set(p.litGrade, p.shadeGrade);
    u.famToonLift.value.setRGB(...p.lift);
    u.famToonRim.value.setRGB(...p.rim);
    u.famToonTerm.value.setRGB(...p.terminator);
    u.famToonGloss.value = p.glossBelow;
    u.famToonCloud.value.set(p.cloudShade.strength, p.cloudShade.scale, p.cloudShade.wind[0], p.cloudShade.wind[1]);
    u.famToonWater.value.set(p.caustics.level ?? NO_WATER, p.caustics.strength);
  }
}

/** Compile a toon surface under `look` to a three.js material (WebGL v1 renderer). */
export function compileToon(params: ToonMaterialParams, look: ToonLook): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({
    color: new THREE.Color().setRGB(...params.colour, THREE.SRGBColorSpace),
    vertexColors: params.vertexColours, flatShading: params.faceted,
    roughness: params.roughness, metalness: params.metalness,
    side: params.doubleSided ? THREE.DoubleSide : THREE.FrontSide,
  });
  m.name = 'family:toon';
  patchShader(m, 'engine.family.toon', PATCH_ORDER.material, (shader) => {
    Object.assign(shader.uniforms, look.uniforms);
    shader.fragmentShader = injectToon(shader.fragmentShader);
  }, { key: TOON_PROGRAM_KEY });
  return m;
}
