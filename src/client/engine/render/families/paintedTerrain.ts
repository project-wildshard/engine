/**
 * The painterly family's painted-terrain layer (SHARD-PLATFORM G227): the per-pixel painted ground a painterly terrain
 * draws on top of its vertex-coloured macro painting, so a terrain baked into tiles keeps the hand-painted look. It only
 * patches the albedo after `color_fragment` (and, where the key light comes from the bake, the key's colour), so the
 * painterly family's light / shade / rim stays the one ramp. Parameters: `PaintedTerrainSchema` in `params.ts`.
 *
 * Per pixel, over the vertex colour:
 *   · an olive / gold pull on green paint and the painter's big soft warm / cool patches
 *   · base     the painted detail, luminance-preserving (two taps, the second at 0.37× turned 30°, blended by a slow
 *              noise; side projections blended in on steep banks), fading a little with distance
 *   · zones    zone A and B tints; the cold ring: scree → granite on the steep → snowfields and snow down the gullies above
 *              the snow line, an optional ice tongue (crevasse bands bowed downstream, moraine along both edges)
 *   · rock     triplanar, its repeat broken by a larger turned tap, value / hue patches, strata, warm sunlit and cool
 *              shaded faces, turf on the ledges
 *   · gravel   darker and greener below the wet margin
 *   · track    laid along the nearest track (uv = across × along), wheel ruts, a grassy crown, a ragged verge kept off
 *              the cut banks
 *   · contact  the baked contact shade round what stands on the ground
 *   · snow
 * The masks are the custom attributes `PAINTED_TERRAIN_ATTRIBUTES` names; the bake inputs are live uniforms a binder
 * shares (`bindPaintedTerrainBake`, before the first draw). Identifiers carry a `famT` prefix; the program key gains
 * `|terrain` (and `|ice` with an ice tongue, `|cheap` on a small-texture tier, `|bake` where the key is shadowed by the bake).
 */
import * as THREE from 'three';
import { TIER, TIER_CONFIG } from '../../core/tier';
import { patchShader, PATCH_ORDER } from '../shaderPatches';
import { PAINTED_TERRAIN_ATTRIBUTES, type PaintedTerrainParams } from '@wildshard/format/materialFamilies';
import type { TextureResolver } from './pbr';

const A = PAINTED_TERRAIN_ATTRIBUTES;

const VERT_PARS = /* glsl */`
attribute vec4 ${A.mask.name};
attribute vec2 ${A.track.name};
attribute vec3 ${A.zone.name};
varying vec3 vFamTZone;
varying vec4 vFamTMask;
varying vec2 vFamTTrack;
varying vec3 vFamTWorld;
varying vec3 vFamTNormal;
`;
const VERT_MAIN = /* glsl */`
#include <worldpos_vertex>
vFamTMask = ${A.mask.name};
vFamTTrack = ${A.track.name};
vFamTZone = ${A.zone.name};
vFamTWorld = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
vFamTNormal = normalize( mat3( modelMatrix ) * objectNormal );
`;

/** the baked key-light visibility and contact shade (live inputs a binder shares) */
const BAKE_GLSL = /* glsl */`
uniform sampler2D famTBakeShadow;
uniform mat4 famTBakeMatrix;
uniform vec3 famTBakeInfo;
uniform sampler2D famTBakeContact;
uniform vec4 famTContactXf;
float famTBakedShadow( vec3 wp ) {
  if ( famTBakeInfo.x < 0.5 ) return 1.0;
  vec4 c = famTBakeMatrix * vec4( wp, 1.0 );
  vec3 p = c.xyz / c.w * 0.5 + 0.5;
  if ( p.x < 0.0 || p.y < 0.0 || p.x > 1.0 || p.y > 1.0 || p.z > 1.0 ) return 1.0;
  float z = p.z - famTBakeInfo.y, t = famTBakeInfo.z * 0.75;
  float s = step( z, texture( famTBakeShadow, p.xy + vec2( -t, -t ) ).r ) + step( z, texture( famTBakeShadow, p.xy + vec2( t, -t ) ).r )
          + step( z, texture( famTBakeShadow, p.xy + vec2( -t, t ) ).r ) + step( z, texture( famTBakeShadow, p.xy + vec2( t, t ) ).r );
  return s * 0.25;
}
float famTBakedContact( vec3 wp ) {
  if ( famTContactXf.w <= 0.0 ) return 1.0;
  vec2 uv = vec2( ( wp.x - famTContactXf.x ) * famTContactXf.z, 1.0 - ( wp.z - famTContactXf.y ) * famTContactXf.z );
  float near = textureLod( famTBakeContact, uv, 2.0 ).r, wide = textureLod( famTBakeContact, uv, 3.5 ).r;
  float occ = smoothstep( 0.05, 1.4, near ) * 0.55 + smoothstep( 0.05, 1.6, wide ) * 0.45;
  return 1.0 - famTContactXf.w * occ;
}
`;

const OLIVE_GLSL = /* glsl */`
vec3 famTOlive( vec3 c ) {
  float gr = smoothstep( 0.02, 0.45, ( c.g - max( c.r, c.b ) ) / max( c.g, 1e-3 ) );
  vec3 olive = vec3( c.r * 1.12, mix( c.g, c.r * 1.2, 0.68 ), c.b * 0.7 ) * 1.3;
  return mix( c, olive, gr );
}
`;

/** the cold ring's granite: two scales (the big tap stretched down the fall line; one turned tap when cheap), fractures, strata */
const cragGlsl = (cheap: boolean): string => /* glsl */`
vec3 famTCragRock( vec3 p, vec3 N, vec3 sunDir ) {
  vec3 w = pow( abs( N ), vec3( 4.0 ) ); w /= ( w.x + w.y + w.z );
  float s = famTScale.w;
  vec3 r = ( texture2D( famTRock, p.zy * s ).rgb * w.x + texture2D( famTRock, p.xz * s ).rgb * w.y + texture2D( famTRock, p.xy * s ).rgb * w.z ) / famTMeanRock;
  ${cheap ? `r = mix( r, famTRockBig( p, N, s ), smoothstep( 0.25, 0.75, famTNoise( p.xz * 0.045 + p.y * 0.03 ) ) );` : `vec2 st = vec2( 1.0, 0.45 ) * s * 0.21;
  vec3 b = texture2D( famTRock, p.zy * st ).rgb * w.x + texture2D( famTRock, p.xz * s * 0.21 ).rgb * w.y + texture2D( famTRock, p.xy * st ).rgb * w.z;
  r *= mix( vec3( 1.0 ), b / famTMeanRock, 0.6 );`}
  float u = mix( p.x, p.z, w.x / max( w.x + w.z, 1e-3 ) );
  float frac = smoothstep( 0.0, 0.07, abs( famTNoise( vec2( u * 0.16, p.y * 0.018 ) ) - 0.5 ) );
  float band = famTNoise( vec2( u * 0.012, p.y * 0.11 + famTNoise( p.xz * 0.02 ) * 2.0 ) );
  r *= mix( 0.5, 1.0, frac ) * mix( 0.78, 1.14, band );
  r *= mix( 0.7, 1.2, famTNoise( p.xz * 0.06 + p.y * 0.045 ) ) * mix( 0.84, 1.12, famTNoise( p.xz * 0.21 - p.y * 0.13 + 7.0 ) );
  vec3 tint = mix( vec3( 0.32, 0.34, 0.39 ), vec3( 0.4, 0.37, 0.34 ), smoothstep( 0.3, 0.8, famTNoise( p.xz * 0.028 - p.y * 0.02 + 3.0 ) ) );
  return r * tint * mix( vec3( 0.92, 0.95, 1.04 ), vec3( 1.06, 1.02, 0.95 ), smoothstep( -0.1, 0.5, dot( N, sunDir ) ) );
}
`;

const fragPars = (cheap: boolean): string => /* glsl */`
varying vec3 vFamTZone;
varying vec4 vFamTMask;
varying vec2 vFamTTrack;
varying vec3 vFamTWorld;
varying vec3 vFamTNormal;
uniform sampler2D famTBase; uniform sampler2D famTTrack; uniform sampler2D famTGravel; uniform sampler2D famTRock; uniform sampler2D famTSnow;
uniform vec3 famTMeanBase; uniform vec3 famTMeanRock;
uniform vec4 famTScale; // 1 / metres: base, track, gravel, rock
uniform float famTSnowScale;
uniform vec3 famTSnowLine; // x line, y / z the high window
uniform vec2 famTWet;
uniform vec4 famTZoneA; uniform vec4 famTZoneB; // rgb tint, a amount
uniform vec4 famTIce; uniform vec3 famTIceInfo; // ice: from xz, (to − from) xz; half, length
float famTHash( vec2 p ) { p = fract( p * vec2( 123.34, 456.21 ) ); p += dot( p, p + 45.32 ); return fract( p.x * p.y ); }
float famTNoise( vec2 p ) {
  vec2 i = floor( p ), f = fract( p ); f = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( famTHash( i ), famTHash( i + vec2( 1.0, 0.0 ) ), f.x ), mix( famTHash( i + vec2( 0.0, 1.0 ) ), famTHash( i + vec2( 1.0, 1.0 ) ), f.x ), f.y );
}
vec3 famTTiled( sampler2D t, vec2 p ) {
  vec3 a = texture2D( t, p ).rgb;
  vec2 q = mat2( 0.866, 0.5, -0.5, 0.866 ) * p * 0.37 + 0.31;
  vec3 b = texture2D( t, q ).rgb;
  return mix( a, b, smoothstep( 0.3, 0.7, famTNoise( p * 0.21 ) ) );
}
${OLIVE_GLSL}${BAKE_GLSL}
vec3 famTTriplanar( sampler2D t, vec3 p, vec3 n, float s ) {
  vec3 w = pow( abs( n ), vec3( 4.0 ) ); w /= ( w.x + w.y + w.z );
  return texture2D( t, p.zy * s ).rgb * w.x + texture2D( t, p.xz * s ).rgb * w.y + texture2D( t, p.xy * s ).rgb * w.z;
}
vec3 famTRockBig( vec3 p, vec3 N, float s ) {
  vec3 a = abs( N );
  vec2 uv = a.y > max( a.x, a.z ) ? p.xz : ( a.x > a.z ? p.zy : p.xy );
  return texture2D( famTRock, mat2( 0.866, 0.5, -0.5, 0.866 ) * uv * s * 0.37 + 0.43 ).rgb / famTMeanRock;
}
${cragGlsl(cheap)}
`;

const ICE_GLSL = /* glsl */`
      {
        vec2 ga = famTIce.xy, gb = famTIce.zw;
        float gt = dot( wp - ga, gb ) / dot( gb, gb );
        float gv = length( wp - ( ga + gb * gt ) ) / famTIceInfo.x + ( famTNoise( wp * 0.09 ) - 0.5 ) * 0.14;
        float gm = smoothstep( 1.02, 0.86, gv ) * smoothstep( -0.1, 0.04, gt ) * smoothstep( 1.03, 0.97, gt );
        if ( gm > 0.001 ) {
          vec3 ice = snow * mix( vec3( 0.93, 0.98, 1.04 ), vec3( 0.72, 0.86, 1.03 ), smoothstep( 0.15, 1.0, gt ) );
          float cs = gt * famTIceInfo.y / 7.0 + ( 1.0 - gv * gv ) * 0.9 + ( famTNoise( wp * 0.13 ) - 0.5 ) * 0.45;
          float crev = smoothstep( 0.84, 0.96, 1.0 - abs( fract( cs ) - 0.5 ) * 2.0 ) * smoothstep( 0.3, 0.55, famTNoise( vec2( cs * 2.3, gv * 5.0 ) ) );
          crev *= 0.35 + 0.65 * min( 1.0, gt * 1.6 );
          ice = mix( ice, vec3( 0.2, 0.36, 0.52 ), crev * 0.85 );
          ice = mix( ice, scree * 0.92, smoothstep( 0.72, 0.97, gv ) * 0.8 );
          g = mix( g, ice, gm );
        }
      }
`;

const zonesGlsl = (ice: boolean): string => /* glsl */`
  {
    vec3 zw = vFamTZone;
    float n = normalize( vFamTNormal ).y;
    diffuseColor.rgb *= mix( vec3( 1.0 ), famTZoneA.rgb, zw.x * famTZoneA.a );
    diffuseColor.rgb *= mix( vec3( 1.0 ), famTZoneB.rgb, zw.y * famTZoneB.a );
    if ( zw.z > 0.01 ) {
      float brk = famTNoise( wp * 0.31 ) - 0.5;
      vec3 N = normalize( vFamTNormal );
      vec3 scree = famTTiled( famTGravel, wp * famTScale.z * 0.6 ) * vec3( 0.84, 0.9, 1.0 );
      vec3 snow = famTTiled( famTSnow, wp * famTSnowScale ) * vec3( 0.97, 1.0, 1.05 );
      snow *= mix( vec3( 0.84, 0.91, 1.08 ), vec3( 1.05, 1.02, 0.97 ), smoothstep( -0.05, 0.45, dot( N, famTSun ) ) );
      vec3 g = mix( diffuseColor.rgb, scree, smoothstep( 0.3, 0.6, vFamTMask.y + brk * 0.4 ) );
      g = mix( g, famTCragRock( vFamTWorld, N, famTSun ), smoothstep( 0.3, 0.6, vFamTMask.w + brk * 0.3 ) );
      float hiS = smoothstep( famTSnowLine.y, famTSnowLine.z, vFamTWorld.y );
      float sn = max( smoothstep( 0.35, 0.6, vFamTMask.z + brk * 0.5 ), smoothstep( 0.8 - 0.3 * hiS, 0.9 - 0.3 * hiS, n ) * smoothstep( famTSnowLine.x - 10.0, famTSnowLine.x + 2.0, vFamTWorld.y + brk * 12.0 ) * 0.9 );
      float fu = mix( vFamTWorld.x, vFamTWorld.z, abs( N.x ) / ( abs( N.x ) + abs( N.z ) + 1e-3 ) );
      sn = max( sn, smoothstep( 0.46, 0.6, famTNoise( vec2( fu * 0.07, vFamTWorld.y * 0.012 ) ) + brk * 0.25 + hiS * 0.12 ) * hiS * 0.94 );
      g = mix( g, snow, sn );
${ice ? ICE_GLSL : ''}
      diffuseColor.rgb = mix( diffuseColor.rgb, g, zw.z );
    }
  }
`;

const fragMain = (ice: boolean): string => /* glsl */`
#include <color_fragment>
{
  #if NUM_DIR_LIGHTS > 0
  vec3 famTSun = normalize( ( vec4( directionalLights[ 0 ].direction, 0.0 ) * viewMatrix ).xyz );
  #else
  vec3 famTSun = vec3( 0.0, 1.0, 0.0 );
  #endif
  vec2 wp = vFamTWorld.xz;
  float ringK = vFamTZone.z;
  float dist = length( vFamTWorld - cameraPosition );
  vec3 ground = diffuseColor.rgb;
  ground = famTOlive( ground );
  ground *= mix( vec3( 0.8, 0.86, 0.92 ), vec3( 1.14, 1.08, 0.86 ), smoothstep( 0.3, 0.72, famTNoise( wp * 0.021 + 3.0 ) * 0.62 + famTNoise( wp * 0.057 - 1.7 ) * 0.38 ) );
  diffuseColor.rgb = ground;

  vec3 tN = normalize( vFamTNormal );
  vec3 base = famTTiled( famTBase, wp * famTScale.x ) / famTMeanBase;
  float steepK = 1.0 - smoothstep( 0.62, 0.86, tN.y );
  if ( steepK > 0.01 ) {
    float sx = abs( tN.x ) / ( abs( tN.x ) + abs( tN.z ) + 1e-4 );
    vec3 side = mix( texture2D( famTBase, vFamTWorld.xy * famTScale.x ).rgb, texture2D( famTBase, vFamTWorld.zy * famTScale.x ).rgb, sx ) / famTMeanBase;
    base = mix( base, side, steepK );
  }
  float detailAmt = 0.9 - 0.45 * smoothstep( 60.0, 260.0, dist );
  diffuseColor.rgb = ground * mix( vec3( 1.0 ), base, detailAmt );
  ground = diffuseColor.rgb;

${zonesGlsl(ice)}

  if ( vFamTMask.w * ( 1.0 - ringK ) > 0.02 ) {
    vec3 rock = famTTriplanar( famTRock, vFamTWorld, tN, famTScale.w ) / famTMeanRock;
    rock = mix( rock, famTRockBig( vFamTWorld, tN, famTScale.w ), smoothstep( 0.25, 0.75, famTNoise( wp * 0.05 + vFamTWorld.y * 0.04 ) ) );
    float rp = famTNoise( wp * 0.035 + vFamTWorld.y * 0.02 ), rq = famTNoise( wp * 0.11 - vFamTWorld.y * 0.07 + 5.0 );
    vec3 tint = mix( vec3( 0.34, 0.33, 0.33 ), vec3( 0.46, 0.37, 0.27 ), smoothstep( 0.25, 0.75, rp ) );
    tint *= mix( 0.8, 1.16, rq ) * mix( 0.86, 1.1, famTNoise( vec2( wp.x * 0.02 + wp.y * 0.02, vFamTWorld.y * 0.35 ) ) );
    tint *= mix( vec3( 0.86, 0.9, 1.06 ), vec3( 1.08, 1.02, 0.92 ), smoothstep( -0.2, 0.5, dot( tN, famTSun ) ) );
    vec3 rc = mix( tint, ground, 0.3 ) * rock;
    float ledge = smoothstep( 0.5, 0.75, tN.y + ( famTNoise( wp * 0.6 ) - 0.5 ) * 0.35 );
    rc = mix( rc, ground * mix( vec3( 0.92, 1.0, 0.8 ), vec3( 1.0 ), rq ), ledge * 0.75 );
    diffuseColor.rgb = mix( diffuseColor.rgb, rc, vFamTMask.w * ( 1.0 - ringK ) );
  }

  if ( vFamTMask.y * ( 1.0 - ringK ) > 0.02 ) {
    vec3 bar = famTTiled( famTGravel, wp * famTScale.z ) * 1.15;
    bar = mix( bar, bar * vec3( 0.62, 0.68, 0.66 ), smoothstep( famTWet.x, famTWet.y, vFamTWorld.y ) );
    diffuseColor.rgb = mix( diffuseColor.rgb, bar, vFamTMask.y * ( 1.0 - ringK ) );
  }

  float across = abs( vFamTMask.x );
  if ( across < 5.5 ) {
    float rag = famTNoise( wp * 0.8 ) * 0.9 + famTNoise( wp * 3.0 ) * 0.35;
    float road = 1.0 - smoothstep( 2.2 + rag, 3.2 + rag, across );
    road *= mix( 1.0, smoothstep( 0.66, 0.86, tN.y + ( rag - 0.6 ) * 0.08 ), smoothstep( 1.3, 2.3, across ) );
    vec2 rd = normalize( vFamTTrack + vec2( 1e-4 ) );
    vec2 ruv = vec2( vFamTMask.x, dot( wp, rd ) ) * famTScale.y;
    ruv = mat2( 0.7071, 0.7071, -0.7071, 0.7071 ) * ruv;
    vec3 dirt = texture2D( famTTrack, ruv ).rgb;
    float rut = smoothstep( 0.45, 0.05, abs( across - 1.05 ) );
    dirt = mix( dirt, dirt * vec3( 0.74, 0.7, 0.66 ), rut * 0.7 );
    float crown = ( 1.0 - smoothstep( 0.25, 0.55, across ) ) * smoothstep( 0.35, 0.7, famTNoise( wp * 1.3 + 2.0 ) );
    dirt = mix( dirt, ground * 1.05, crown * 0.8 );
    diffuseColor.rgb = mix( diffuseColor.rgb, dirt, road );
  }

  diffuseColor.rgb *= famTBakedContact( vFamTWorld );

  if ( vFamTMask.z * ( 1.0 - ringK ) > 0.02 ) {
    vec3 snow = famTTiled( famTSnow, wp * famTSnowScale ) * 1.05;
    diffuseColor.rgb = mix( diffuseColor.rgb, snow, vFamTMask.z * 0.9 * ( 1.0 - ringK ) );
  }
}
`;

/** The live bake inputs a painted terrain reads (shared by reference with whatever renders the bake). */
export interface PaintedTerrainBake {
  /** the key light's depth map of the static casters (null until the first bake) */
  readonly famTBakeShadow: THREE.IUniform<THREE.Texture | null>;
  /** world → the bake camera's clip space */
  readonly famTBakeMatrix: THREE.IUniform<THREE.Matrix4>;
  /** x = on (0 until the first bake), y = depth bias, z = one texel (uv) */
  readonly famTBakeInfo: THREE.IUniform<THREE.Vector3>;
  /** the top-down height of the casters above the ground (mipmapped; image right = +x, up = −z) */
  readonly famTBakeContact: THREE.IUniform<THREE.Texture | null>;
  /** the contact map's xz origin (m), 1 / size (1/m) and strength (0 = off) */
  readonly famTContactXf: THREE.IUniform<THREE.Vector4>;
}

/** The painted terrain's own uniforms (what a runtime adapter may move without a program change). */
export interface PaintedTerrainUniforms {
  readonly famTBase: THREE.IUniform<THREE.Texture>;
  readonly famTTrack: THREE.IUniform<THREE.Texture>;
  readonly famTGravel: THREE.IUniform<THREE.Texture>;
  readonly famTRock: THREE.IUniform<THREE.Texture>;
  readonly famTSnow: THREE.IUniform<THREE.Texture>;
  readonly famTMeanBase: THREE.IUniform<THREE.Vector3>;
  readonly famTMeanRock: THREE.IUniform<THREE.Vector3>;
  readonly famTScale: THREE.IUniform<THREE.Vector4>;
  readonly famTSnowScale: THREE.IUniform<number>;
  readonly famTSnowLine: THREE.IUniform<THREE.Vector3>;
  readonly famTWet: THREE.IUniform<THREE.Vector2>;
  readonly famTZoneA: THREE.IUniform<THREE.Vector4>;
  readonly famTZoneB: THREE.IUniform<THREE.Vector4>;
  readonly famTIce: THREE.IUniform<THREE.Vector4>;
  readonly famTIceInfo: THREE.IUniform<THREE.Vector3>;
}

const filled = new WeakSet<THREE.BufferGeometry>();
interface TerrainState { own: PaintedTerrainUniforms; bake: PaintedTerrainBake; compiled: boolean }
const states = new WeakMap<THREE.Material, TerrainState>();

/** A bake input set that is off (1 = lit, no contact shade) until something binds or fills it. */
export function paintedTerrainBakeOff(): PaintedTerrainBake {
  return {
    famTBakeShadow: { value: null }, famTBakeMatrix: { value: new THREE.Matrix4() }, famTBakeInfo: { value: new THREE.Vector3(0, 0.0004, 1 / 1024) },
    famTBakeContact: { value: null }, famTContactXf: { value: new THREE.Vector4(0, 0, 1, 0) },
  };
}

/** Whether a layer's key light is shadowed by the bake on this tier. */
export function paintedTerrainBakesKey(params: PaintedTerrainParams, tier: string = TIER): boolean {
  return params.bakeKeyLight === 'always' || (params.bakeKeyLight === 'phone' && tier === 'phone');
}

/**
 * Patch a painterly family material with the painted-terrain layer (`compilePainterly` calls it for a surface that
 * declares `terrain`). The five maps resolve as colour, through the resolver or, for a runtime that loaded them itself
 * (data, G454), a table of textures by reference. `cheap` (one turned rock tap instead of the stretched big one) and
 * `bakeKey` default from the tier.
 */
export function applyPaintedTerrain(m: THREE.Material, params: PaintedTerrainParams, source: TextureResolver | Readonly<Record<string, THREE.Texture>>, options: { cheap?: boolean; bakeKey?: boolean } = {}): void {
  const textures: TextureResolver = typeof source === 'function' ? source : (ref) => {
    const texture = source[ref];
    if (texture === undefined) throw new Error(`painted terrain: no texture ${ref}`);
    return texture;
  };
  const cheap = options.cheap ?? TIER_CONFIG.maxTexture <= 1024, bakeKey = options.bakeKey ?? paintedTerrainBakesKey(params);
  const ice = params.ice, z = params.zones;
  const own: PaintedTerrainUniforms = {
    famTBase: { value: textures(params.maps.base, 'colour') }, famTTrack: { value: textures(params.maps.track, 'colour') },
    famTGravel: { value: textures(params.maps.gravel, 'colour') }, famTRock: { value: textures(params.maps.rock, 'colour') },
    famTSnow: { value: textures(params.maps.snow, 'colour') },
    famTMeanBase: { value: new THREE.Vector3(...params.means.base) }, famTMeanRock: { value: new THREE.Vector3(...params.means.rock) },
    famTScale: { value: new THREE.Vector4(1 / params.metres.base, 1 / params.metres.track, 1 / params.metres.gravel, 1 / params.metres.rock) },
    famTSnowScale: { value: 1 / params.metres.snow },
    famTSnowLine: { value: new THREE.Vector3(params.snow.line, params.snow.high[0], params.snow.high[1]) },
    famTWet: { value: new THREE.Vector2(params.wet[0], params.wet[1]) },
    famTZoneA: { value: new THREE.Vector4(...z.a.tint, z.a.amount) }, famTZoneB: { value: new THREE.Vector4(...z.b.tint, z.b.amount) },
    famTIce: { value: ice === null ? new THREE.Vector4() : new THREE.Vector4(ice.from[0], ice.from[1], ice.to[0] - ice.from[0], ice.to[1] - ice.from[1]) },
    famTIceInfo: { value: new THREE.Vector3(ice?.half ?? 1, ice === null ? 0 : Math.hypot(ice.to[0] - ice.from[0], ice.to[1] - ice.from[1]), 0) },
  };
  const state: TerrainState = { own, bake: paintedTerrainBakeOff(), compiled: false };
  states.set(m, state);
  m.userData['paintedTerrain'] = own;
  const suffix = `|terrain${ice === null ? '' : '|ice'}${cheap ? '|cheap' : ''}${bakeKey ? '|bake' : ''}`;
  patchShader(m, 'engine.family.painterly.terrain', PATCH_ORDER.decorate, (shader) => {
    state.compiled = true;
    Object.assign(shader.uniforms, own, state.bake);
    for (const inc of ['#include <worldpos_vertex>', '#include <color_fragment>']) if (!shader.vertexShader.includes(inc) && !shader.fragmentShader.includes(inc)) throw new Error(`painted terrain: the source has no ${inc}`);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERT_PARS}`)
      .replace('#include <worldpos_vertex>', VERT_MAIN);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${fragPars(cheap)}`)
      .replace('#include <color_fragment>', fragMain(ice !== null));
    // the static casters are out of the realtime shadow map here: the key light on the ground is shadowed by the bake
    if (bakeKey) {
      shader.fragmentShader = shader.fragmentShader.replace('#include <lights_fragment_begin>', THREE.ShaderChunk.lights_fragment_begin
        .replaceAll('getDirectionalLightInfo( directionalLight, directLight );', 'getDirectionalLightInfo( directionalLight, directLight );\n\t\t\tdirectLight.color *= famTBakedShadow( vFamTWorld );')
        .replaceAll('getDirectionalLightInfo( directionalLights[0], directLight );', 'getDirectionalLightInfo( directionalLights[0], directLight );\n\t\tdirectLight.color *= famTBakedShadow( vFamTWorld );'));
    }
  }, { key: (prior) => `${prior}${suffix}`, pureKey: true });
  const before = m.onBeforeRender.bind(m);
  m.onBeforeRender = (renderer, scene, camera, geometry, object, group) => {
    if (!filled.has(geometry)) { filled.add(geometry); fillPaintedTerrainAttributes(geometry); }
    before(renderer, scene, camera, geometry, object, group);
  };
}


/**
 * Share a live bake with a painted terrain material: its five inputs become `bake`'s uniform objects (so whatever renders
 * the bake moves them for every receiver). Before the material's first compile only: a compiled program keeps the objects it was given.
 */
export function bindPaintedTerrainBake(m: THREE.Material, bake: PaintedTerrainBake): void {
  const state = states.get(m);
  if (state === undefined) throw new Error('painted terrain: this material has no painted-terrain layer');
  if (state.compiled) throw new Error('painted terrain: bind the bake before the first draw');
  state.bake = bake;
}

/**
 * Give a mesh drawn with a painted terrain the custom attributes it lacks, filled with plain base ground (no track, no
 * gravel / snow / rock, no zone): a missing WebGL attribute reads 0, which would paint a track everywhere.
 */
export function fillPaintedTerrainAttributes(geo: THREE.BufferGeometry): void {
  const count = geo.getAttribute('position').count;
  for (const spec of Object.values(PAINTED_TERRAIN_ATTRIBUTES)) {
    if (geo.hasAttribute(spec.name)) continue;
    const data = new Float32Array(count * spec.size);
    for (let i = 0; i < count; i++) for (let k = 0; k < spec.size; k++) data[i * spec.size + k] = spec.fill[k] ?? 0;
    geo.setAttribute(spec.name, new THREE.BufferAttribute(data, spec.size));
  }
}
