/**
 * A lowered material graph (`glsl.ts`) as a classic three program (nine-fix NF13): `graphShaders(glsl)` wraps the graph's
 * statements in three's own chunks (instancing, batching, skinning, morphs, clipping, log depth, shadow coordinates, fog
 * and, for a lit graph, the physical light model) and returns the vertex and fragment source with their uniforms, so
 * `graphShaderMaterial(glsl)` is a plain `ShaderMaterial` that `WebGLRenderer` compiles and draws with no node runtime.
 *
 * - **Instances, as the node path:** `wsPositionLocal` / `wsNormalLocal` already carry the instance (or batch) transform,
 *   as an instanced node mesh's `positionLocal` does, so the graph's offset is added after it and the projection does not
 *   apply it again.
 * - **The lighting stage** runs inside three's physical light loops: `RE_Direct` becomes `wsGraphDirect`, which hands a
 *   directional light (the sky rig's cascades are one sun) to `wsGraphSun` with its unshadowed colour and shadow ratio
 *   and keeps the physical term for every other light; `RE_IndirectDiffuse` becomes the graph's ambient; the grade runs on
 *   the lit colour before the output transform (a graded material is not tone mapped).
 * - **Output:** an unlit graph writes raw colour (no tone mapping, no colour-space step), as the GLSL programs it stands
 *   for did; `effectState.output: 'colour'` applies the target's encoding. Fog is the engine's chunk after it, scaled by
 *   `vertex.scale.fog`, or a declared fog graph's `wsGraphFog` in its place.
 *
 * Every uniform name a graph reads is in the returned `uniforms`; a host feeds the `from: 'host'` ones (`glsl.uniforms`).
 */
import * as THREE from 'three';
import { parseFamilyMaterial } from '@wildshard/format/materialFamilies';
import type { GraphLiteral } from '@wildshard/format/materialGraph';
import { emitGraphGlsl, graphGlslLibraries, type EmitGraphGlslOptions, type GraphGlsl, type GraphGlslProgram, type GraphGlslUniform } from './glsl';
import { toonGraph } from './presets';
import type { ToonLook } from '../families/toon';
import { windUniforms } from '../../world/wind';
import { fogUniforms } from '../../world/Atmosphere';
import { worldTime } from '../../../../shared/engine/core/time';

/** the toon preset's params, read from the family's own uniforms (`ToonLook.uniforms`) */
const TOON_PARAMS: NonNullable<EmitGraphGlslOptions['toon']>['params'] = {
  face: { uniform: 'famToonFace', type: 'vec2' }, shadowEdge: { uniform: 'famToonShadow', type: 'vec2' }, grade: { uniform: 'famToonGrade', type: 'vec2' },
  lift: { uniform: 'famToonLift', type: 'vec3' }, rim: { uniform: 'famToonRim', type: 'vec3' }, terminator: { uniform: 'famToonTerm', type: 'vec3' },
  gloss: { uniform: 'famToonGloss', type: 'float' }, cloud: { uniform: 'famToonCloud', type: 'vec4' }, cloudTime: { uniform: 'famToonTime', type: 'float' },
  water: { uniform: 'famToonWater', type: 'vec2' },
};
/** the `toon` option for a `model: 'toon'` graph: the family's preset for this look (without caustics when the graph says so) */
export function glslToon(look: ToonLook, caustics = true): NonNullable<EmitGraphGlslOptions['toon']> {
  const row = parseFamilyMaterial({ family: 'toon' });
  if (row.family !== 'toon') throw new Error('material graph: the toon family row is missing');
  const params = caustics ? look.params : { ...look.params, caustics: { ...look.params.caustics, level: null } };
  return { preset: toonGraph(row, params), params: TOON_PARAMS };
}
/** lower a graph for the classic back-end, a toon graph with the family's preset */
export function emitClassicGraph(input: unknown, opts: Omit<EmitGraphGlslOptions, 'toon'> & { readonly toonLook?: ToonLook } = {}): GraphGlsl {
  const model: unknown = typeof input === 'object' && input !== null ? Reflect.get(input, 'model') : undefined;
  const caustics: unknown = typeof input === 'object' && input !== null ? Reflect.get(input, 'toonCaustics') : undefined;
  const { toonLook, ...rest } = opts;
  if (model !== 'toon') return emitGraphGlsl(input, rest);
  if (toonLook === undefined) throw new Error('material graph: a toon graph needs its ToonLook');
  return emitGraphGlsl(input, { ...rest, toon: glslToon(toonLook, caustics !== false), replaceEnvironmentDiffuse: true });
}

/** a classic program's sources and uniforms */
export interface GraphShaders {
  readonly vertexShader: string;
  readonly fragmentShader: string;
  readonly uniforms: Record<string, THREE.IUniform>;
  /** the program reads the scene's lights (a lit graph): a ShaderMaterial with `lights: true` */
  readonly lights: boolean;
  /** the program applies the engine's fog chunk (`fog: true`) */
  readonly fog: boolean;
}
/** a compiled fog graph a material selects: its lowering and the uniform objects its own `setParam` moves */
export interface ClassicFog { readonly glsl: GraphGlsl; readonly uniforms: ReadonlyMap<string, THREE.IUniform> }
/** what wrapping a graph needs beyond its lowering */
export interface GraphShaderOptions {
  /** the outline's hull program instead of the main draw */
  readonly outline?: boolean;
  /** a declared fog graph (`effectState.fog: '<id>'`): its `wsGraphFog` replaces the engine fog, reading its compile's uniforms */
  readonly fog?: ClassicFog;
  /** the graph's own uniform objects, kept between its draw and its outline (filled on first use) */
  readonly shared?: Map<string, THREE.IUniform>;
  /** the shadow depth of a displaced caster: the graph's vertex stage and surface mask, writing depth only */
  readonly depth?: boolean;
  /** the toon family's uniforms (a toon graph reads them) */
  readonly toonLook?: ToonLook;
  /** resolve an admitted texture param's file (a lent param starts on a 1×1 stand-in) */
  readonly textures?: (ref: string, role?: 'colour' | 'data') => THREE.Texture;
  /** a scene post pass (a shard's own post stack, `glslPost.ts`): its colour fades over the scene input (`wsScene`) by the
   *  owner weight `wsWeight` (0 … 1; 1 is the graph's own colour exactly) */
  readonly weighted?: boolean;
}

const isUniform = (v: unknown): v is THREE.IUniform => typeof v === 'object' && v !== null && 'value' in v;
const decl = (u: GraphGlslUniform): string => (u.from === 'array' ? `uniform ${u.type} ${u.name}[${String(u.length)}];` : `uniform ${u.type} ${u.name};`);
/** the host helpers both stages read (instance transform, instance and vertex colour, skin direction, the frame camera) */
const VERTEX_HELPERS = `vec4 wsInstanceTransform( vec4 v ) {
#ifdef USE_BATCHING
  v = getBatchingMatrix( getIndirectIndex( gl_DrawID ) ) * v;
#endif
#ifdef USE_INSTANCING
  v = instanceMatrix * v;
#endif
  return v;
}
vec3 wsInstanceColour() {
#if defined( USE_INSTANCING_COLOR )
  return instanceColor;
#elif defined( USE_BATCHING_COLOR )
  return getBatchingColor( getIndirectIndex( gl_DrawID ) ).rgb;
#else
  return vec3( 1.0 );
#endif
}
// the graph reads the geometry's colour whether or not the material multiplies by it (\`vertexColors\`, three's
// USE_COLOR), as TSL's vertexColor() does: white (three's default attribute value) where the geometry has none
#if !defined( USE_COLOR ) && !defined( USE_COLOR_ALPHA )
attribute vec4 color;
#endif
vec4 wsVertexColour() {
#if defined( USE_COLOR_ALPHA )
  return color;
#elif defined( USE_COLOR )
  return vec4( color, 1.0 );
#else
  return color;
#endif
}
#ifdef USE_SKINNING
#define wsSkinDirection( d ) ( mat3( skinMatrix ) * ( d ) )
#else
#define wsSkinDirection( d ) ( d )
#endif`;
/** the drawing camera's near plane from its projection (three's perspective or orthographic matrix), and the scene fog's
 *  colour (three's own fog uniform; black unfogged): both stages, no uniform of their own */
const CAMERA_HELPERS = `float wsCameraNear() {
  return isOrthographic ? ( projectionMatrix[ 3 ][ 2 ] + 1.0 ) / projectionMatrix[ 2 ][ 2 ] : projectionMatrix[ 3 ][ 2 ] / ( projectionMatrix[ 2 ][ 2 ] - 1.0 );
}
vec3 wsFogColour() {
#ifdef USE_FOG
  return fogColor;
#else
  return vec3( 0.0 );
#endif
}`;
/** three's \`color_vertex\` without the instance and batch tints: a graph that tints by the instance colour itself
 *  (\`instanceColour\`) must not be multiplied by it twice (NR15). \`vColor\` is still written wherever the fragment prefix
 *  expects it (three's fragment stage defines USE_COLOR for an instance tint too) */
const OWN_INSTANCE_COLOUR = `#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA ) || defined( USE_INSTANCING_COLOR ) || defined( USE_BATCHING_COLOR )
  vColor = vec4( 1.0 );
#endif
#ifdef USE_COLOR_ALPHA
  vColor *= color;
#elif defined( USE_COLOR )
  vColor.rgb *= color;
#endif`;
/** the camera the graph reads: a layered backdrop's frame (G321) defines its own before this */
const FRAME = `#ifndef wsFrameCamera
#define wsFrameCamera cameraPosition
#endif
#ifndef wsFrameView
#define wsFrameView viewMatrix
#endif`;

/** what the lighting functions read beside their arguments: the light model sets the globals before it lights */
const LIGHT_GLOBALS = `vec3 wsNormalView;
vec3 wsViewDirection;
vec3 wsAlbedo;
float wsRoughness;
vec3 wsEnvironmentIrradianceAt( vec3 direction ) {
#if defined( USE_ENVMAP ) && defined( ENVMAP_TYPE_CUBE_UV )
  return PI * textureCubeUV( envMap, envMapRotation * direction, 1.0 ).rgb * envMapIntensity;
#else
  return vec3( 0.0 );
#endif
}`;
/** the fragment stage's own declarations of what the camera helpers read (three's fragment prefix has no projection) */
const FRAGMENT_CAMERA = `uniform highp mat4 projectionMatrix;\n${CAMERA_HELPERS}`;
/** the vertex colour step: three's own, or without the instance tint for a graph that applies it itself */
const colourVertex = (program: GraphGlslProgram): string => (program.vertex.body.includes('wsInstanceColour()') ? OWN_INSTANCE_COLOUR : '#include <color_vertex>');

/** the vertex stage: three's deformations, the graph's own, then the projection without the instance transform again */
function vertexShader(glsl: GraphGlsl, program: GraphGlslProgram, uniforms: string, lit: boolean, fogged: boolean, outline: boolean): string {
  const o = program.outputs;
  const attributes = glsl.attributes.map(a => `attribute ${a.type} ${a.name};`).join('\n');
  const position = o.position !== null ? `transformed = ${o.position};`
    : o.offset !== null ? `transformed = wsPositionLocal + ${o.offset} / wsCodecStep;` : 'transformed = wsPositionLocal;';
  return `#define WS_GRAPH
#include <common>
#include <batching_pars_vertex>
#include <fog_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
${lit ? '#include <uv_pars_vertex>\n#define WS_THREE_UV\n#include <normal_pars_vertex>\n#include <shadowmap_pars_vertex>\nvarying vec3 vViewPosition;' : ''}
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
uniform float wsCodecStep;
${uniforms}
${attributes}
${VERTEX_HELPERS}
${FRAME}
#ifdef USE_FOG
uniform vec3 fogColor;
#endif
${CAMERA_HELPERS}
#include <color_pars_vertex>
${fogged ? 'varying vec3 wsVFogWorld;' : ''}
${program.vertex.head}
void main() {
${lit ? '#include <uv_vertex>' : ''}
#include <morphinstance_vertex>
#include <batching_vertex>
${colourVertex(program)}
#include <beginnormal_vertex>
#include <morphnormal_vertex>
#include <skinbase_vertex>
#include <skinnormal_vertex>
#include <begin_vertex>
#include <morphtarget_vertex>
#include <skinning_vertex>
  vec3 wsPositionLocal = wsInstanceTransform( vec4( transformed, 1.0 ) ).xyz;
  vec3 wsNormalLocal = objectNormal;
#ifdef USE_BATCHING
  mat3 wsBm = mat3( batchingMatrix );
  wsNormalLocal = wsBm * ( wsNormalLocal / vec3( dot( wsBm[ 0 ], wsBm[ 0 ] ), dot( wsBm[ 1 ], wsBm[ 1 ] ), dot( wsBm[ 2 ], wsBm[ 2 ] ) ) );
#endif
#ifdef USE_INSTANCING
  mat3 wsIm = mat3( instanceMatrix );
  wsNormalLocal = wsIm * ( wsNormalLocal / vec3( dot( wsIm[ 0 ], wsIm[ 0 ] ), dot( wsIm[ 1 ], wsIm[ 1 ] ), dot( wsIm[ 2 ], wsIm[ 2 ] ) ) );
#endif
${program.vertex.body}
  ${position}
${o.normal !== null && !outline ? `  wsNormalLocal = wsInstanceTransform( vec4( ${o.normal}, 0.0 ) ).xyz;` : ''}
  objectNormal = wsNormalLocal;
  // transformed and objectNormal carry the instance (or batch) transform already, as an instanced node mesh's
  // positionLocal does: the stock chunks below (and the engine's classic patches anchored on them: the coarse tile mask
  // before project_vertex, a layer frame's view defines) project them without applying it again
#undef USE_INSTANCING
#undef USE_BATCHING
${lit ? '#include <defaultnormal_vertex>\n#include <normal_vertex>' : ''}
#include <project_vertex>
${o.clip !== null ? `  gl_Position = ${o.clip};` : ''}
${o.pointSize !== null ? `  gl_PointSize = clamp( ${o.pointSize}, 1.0, 2048.0 );` : ''}
#include <logdepthbuf_vertex>
#include <clipping_planes_vertex>
${lit ? '  vViewPosition = - mvPosition.xyz;' : ''}
#include <worldpos_vertex>
  vec4 wsWorldPosition = modelMatrix * vec4( transformed, 1.0 );
${lit ? shadowCoords(program.outputs.shadowOffset) : ''}
#include <fog_vertex>
${fogged ? '  wsVFogWorld = wsWorldPosition.xyz;' : ''}
${program.vertex.end}
}`;
}

/** three's shadow chunk with each shadow lookup moved by `wsShadowOffset` and nothing else: the directional, point and sun
 *  shadow positions, and a spot light's only where it casts a shadow (its projected-map coordinates stay at the vertex) */
const SHADOW_SHIFTS: readonly (readonly [string, string])[] = [
  ['vSunShadowWorldPosition = vec4( worldPosition.xyz,', 'vSunShadowWorldPosition = vec4( worldPosition.xyz + wsShadowOffset,'],
  ['shadowWorldPosition = worldPosition + vec4( shadowWorldNormal * directionalLightShadows[ i ].shadowNormalBias, 0 );',
    'shadowWorldPosition = worldPosition + vec4( shadowWorldNormal * directionalLightShadows[ i ].shadowNormalBias + wsShadowOffset, 0 );'],
  ['shadowWorldPosition = worldPosition + vec4( shadowWorldNormal * pointLightShadows[ i ].shadowNormalBias, 0 );',
    'shadowWorldPosition = worldPosition + vec4( shadowWorldNormal * pointLightShadows[ i ].shadowNormalBias + wsShadowOffset, 0 );'],
  ['shadowWorldPosition.xyz += shadowWorldNormal * spotLightShadows[ i ].shadowNormalBias;',
    'shadowWorldPosition.xyz += shadowWorldNormal * spotLightShadows[ i ].shadowNormalBias + wsShadowOffset;'],
];
/**
 * three's per-vertex shadow coordinates, looked up at the world position moved by the graph's `shadow.offset` (as TSL's
 * receivedShadowPositionNode moves the received shadow only): the vertex, its normal-bias and a map-only SpotLight's
 * projected coordinates are unchanged. Known gap: a SpotLight that both casts a shadow and carries a map shares one
 * coordinate (three's vSpotLightCoord) for both, so its map moves with the shadow, as three's normal-bias already moves it;
 * no light in the game carries a map. The offset is a vertex expression (the format admits it in vertex context only)
 * built in the graph's vertex body, before its `vertex.position` / `vertex.offset` displacement: an offset reading the
 * world position sees the undisplaced vertex. A three whose chunk no longer has these lines refuses the program.
 */
function shadowCoords(offset: string | null): string {
  if (offset === null) return '#include <shadowmap_vertex>';
  let chunk = THREE.ShaderChunk.shadowmap_vertex;
  for (const [from, to] of SHADOW_SHIFTS) {
    if (chunk.split(from).length !== 2) throw new Error('material graph: three\'s shadowmap_vertex changed; shadow.offset cannot be applied');
    chunk = chunk.replace(from, to);
  }
  return `  vec3 wsShadowOffset = ${offset};\n${chunk}`;
}

/** the fog epilogue: the engine's chunk (scaled by the graph's fog share), or a declared fog graph in its place */
function fogEpilogue(program: GraphGlslProgram, fog: GraphGlsl | undefined): string {
  const scale = program.outputs.fogScale ?? '1.0';
  if (fog !== undefined) return `  vec3 wsBeforeFog = gl_FragColor.rgb;
#include <fog_fragment>
  gl_FragColor.rgb = wsGraphFog( wsBeforeFog, gl_FragColor.rgb, wsVFogWorld, cameraPosition, ${scale} );`;
  if (program.outputs.fogScale === null) return '#include <fog_fragment>';
  return `  vec3 wsBeforeFog = gl_FragColor.rgb;
#include <fog_fragment>
  gl_FragColor.rgb = mix( wsBeforeFog, gl_FragColor.rgb, ${scale} );`;
}

/** an unlit graph's fragment stage (or, `depth`, a displaced caster's shadow depth: three's BasicDepthPacking) */
function unlitFragment(glsl: GraphGlsl, program: GraphGlslProgram, uniforms: string, fogged: boolean, fog: GraphGlsl | undefined, depth = false): string {
  const o = program.outputs, ir = glsl.ir, s = ir.stages.surface;
  // the cutoff is the material's own `alphaTest` (the uniform it feeds): a caster's depth takes its caster's
  const cutoff = s?.alphaCutoff === undefined ? '' : '  if ( diffuseColor.a < wsAlphaCutoff ) discard;';
  // a node material's output is clamped at 0 (three's \`max( output, 0 )\`); a written target alpha is not
  const alpha = o.targetAlpha ?? (ir.effectState?.output === 'colour' ? '1.0' : 'max( diffuseColor.a, 0.0 )');
  const output = depth ? '  gl_FragColor = vec4( vec3( 1.0 - gl_FragCoord.z ), 1.0 );' : `  gl_FragColor = vec4( max( diffuseColor.rgb, 0.0 ), ${alpha} );
${ir.effectState?.output === 'colour' ? '#include <colorspace_fragment>' : ''}
${fogged ? fogEpilogue(program, fog) : ''}
#include <premultiplied_alpha_fragment>`;
  return `#define WS_GRAPH
#include <common>
#include <packing>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
${uniforms}
${FRAME}
${FRAGMENT_CAMERA}
#include <color_pars_fragment>
${fogged ? 'varying vec3 wsVFogWorld;' : ''}
${fog?.fog ?? ''}
${program.lighting === null ? '' : LIGHT_GLOBALS}
${program.fragment.head}
void main() {
#include <clipping_planes_fragment>
#include <logdepthbuf_fragment>
${program.fragment.body}
${o.discard !== null ? `  if ( ${o.discard} ) discard;` : ''}
  vec4 diffuseColor = vec4( ${o.colour ?? 'wsMaterialColour'}, ${o.alpha ?? '1.0'} );
#include <color_fragment>
${cutoff}
${output}
}`;
}

/** a borrowed tangent-space normal map (`normalMap`), as three's `normal_fragment_maps` without its bump branch (three
 *  defines USE_BUMPMAP for a borrowed bump map, which the graph samples itself) */
const NORMAL_MAP = `#ifdef USE_NORMALMAP_TANGENTSPACE
  vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;
  mapN.xy *= normalScale;
  normal = normalize( tbn * mapN );
#endif`;

/** A lit program's sky light (`skyLightDirection` / `skyLightColour`) is three's first directional light, as the node path
 *  reads its first shadow caster (three sorts its casters first), the direction turned back to world space; every other
 *  program keeps the neutral host uniform. */
/** A graph's fog zenith (`fogZenithColour`) in a fogged fragment: the level's colour-ramp fog's zenith where its fog chunk
 *  declares one (Atmosphere's `ColourRampFog`), else the fog's colour, as the node path reads its fog patch's ramp, else the
 *  scene's fog; unfogged, the neutral host uniform. */
const FOG_ZENITH = `#if defined( USE_FOG ) && defined( WS_FOG_RAMP_ZENITH )
#define wsFogZenithColour fogRampZenith
#elif defined( USE_FOG )
#define wsFogZenithColour fogColor
#else
uniform vec3 wsFogZenithColour;
#endif`;

function skyLightFromLights(text: string): string {
  return text.replaceAll(/^uniform vec3 wsSkyLight(Direction|Colour);$/gm, (_, which: string) => `#if NUM_DIR_LIGHTS > 0
#define wsSkyLight${which} ${which === 'Direction' ? 'normalize( ( vec4( directionalLights[ 0 ].direction, 0.0 ) * viewMatrix ).xyz )' : 'directionalLights[ 0 ].color'}
#else
#define wsSkyLight${which} vec3( 0.0 )
#endif`);
}

/** a lit graph's fragment stage: three's physical model, its light equations the graph's where it has a lighting stage */
function litFragment(glsl: GraphGlsl, program: GraphGlslProgram, uniforms: string, fogged: boolean, fog: GraphGlsl | undefined, replaceEnvironmentDiffuse: boolean): string {
  const o = program.outputs, ir = glsl.ir, s = ir.stages.surface, l = program.lighting;
  const cutoff = s?.alphaCutoff === undefined ? '' : '  if ( diffuseColor.a < wsAlphaCutoff ) discard;';
  const sunScale = o.sunScale;
  const direct = l === null && sunScale === null ? '' : `bool wsDirectional = false;
vec3 wsDirectionalBase = vec3( 0.0 );
#if NUM_DIR_LIGHTS > 0
void wsGetDirectionalLightInfo( const in DirectionalLight directionalLight, out IncidentLight light ) {
  getDirectionalLightInfo( directionalLight, light ); wsDirectional = true; wsDirectionalBase = light.color;
}
#define getDirectionalLightInfo wsGetDirectionalLightInfo
#endif
#if NUM_SUN_LIGHTS > 0
void wsGetSunLightInfo( const in SunLight sunLight, out IncidentLight light ) {
  getSunLightInfo( sunLight, light ); wsDirectional = true; wsDirectionalBase = light.color;
}
#define getSunLightInfo wsGetSunLightInfo
#endif
#if NUM_POINT_LIGHTS > 0
void wsGetPointLightInfo( const in PointLight pointLight, const in vec3 geometryPosition, out IncidentLight light ) {
  getPointLightInfo( pointLight, geometryPosition, light ); wsDirectional = false;
}
#define getPointLightInfo wsGetPointLightInfo
#endif
#if NUM_SPOT_LIGHTS > 0
void wsGetSpotLightInfo( const in SpotLight spotLight, const in vec3 geometryPosition, out IncidentLight light ) {
  getSpotLightInfo( spotLight, geometryPosition, light ); wsDirectional = false;
}
#define getSpotLightInfo wsGetSpotLightInfo
#endif
/** three's physical direct term, its diffuse and / or its specular */
void wsDirectPhysical( const in IncidentLight directLight, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in PhysicalMaterial material, inout ReflectedLight reflectedLight, const in bool diffuse, const in bool specular ) {
  float dotNL = saturate( dot( geometryNormal, directLight.direction ) );
  vec3 irradiance = dotNL * directLight.color;
  if ( specular ) reflectedLight.directSpecular += irradiance * BRDF_GGX( directLight.direction, geometryViewDir, geometryNormal, material ) * material.multiScatteringCompensation;
  if ( diffuse ) {
    vec3 halfDir = normalize( directLight.direction + geometryViewDir );
    vec3 F = F_Schlick( material.specularColor, material.specularF90, saturate( dot( geometryViewDir, halfDir ) ) );
    reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseContribution ) * ( 1.0 - F );
  }
}
void wsGraphDirect( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
  float scale = ${sunScale ?? '1.0'};
  if ( ! wsDirectional ) { wsDirectPhysical( directLight, geometryNormal, geometryViewDir, material, reflectedLight, true, ${l === null || l.specular ? 'true' : 'false'} ); return; }
${l === null ? `  IncidentLight scaled = directLight; scaled.color *= scale;
  wsDirectPhysical( scaled, geometryNormal, geometryViewDir, material, reflectedLight, true, true );` : `  vec3 base = wsDirectionalBase;
  float shadow = clamp( dot( directLight.color, vec3( 1.0 ) ) / max( dot( base, vec3( 1.0 ) ), 1e-5 ), 0.0, 1.0 );
  vec4 sun = wsGraphSun( directLight.direction, base, shadow );
  reflectedLight.directDiffuse += sun.xyz * scale;
${l.specular ? `  IncidentLight specular = directLight; specular.color = base * sun.w * scale;
  wsDirectPhysical( specular, geometryNormal, geometryViewDir, material, reflectedLight, false, true );` : ''}`}
}
#undef RE_Direct
#define RE_Direct wsGraphDirect`;
  const ambient = l?.ambient === true
    ? `#undef RE_IndirectDiffuse
#define RE_IndirectDiffuse( irr, gp, gn, gv, gc, mat, rl ) rl.indirectDiffuse += wsGraphAmbient( irr, ${l.ownsEnvironment ? 'radiance, iblIrradiance' : 'vec3( 0.0 ), vec3( 0.0 )'} )` : '';
  // the environment's specular runs only for a material that keeps a specular and does not own the environment itself
  const indirectSpecular = l === null ? '' : !l.specular || l.ownsEnvironment
    ? '#undef RE_IndirectSpecular\n#define RE_IndirectSpecular( r, i, c, gp, gn, gv, gc, mat, rl )'
    : replaceEnvironmentDiffuse && l.ambient
      ? '#undef RE_IndirectSpecular\n#define RE_IndirectSpecular( r, i, c, gp, gn, gv, gc, mat, rl ) RE_IndirectSpecular_Physical( r, vec3( 0.0 ), c, gp, gn, gv, gc, mat, rl )'
      : '';
  // the graph's occlusion times a borrowed ao map's, as the node path's mapped factor (once: the specular occlusion reads both)
  const occlusion = `${o.occlusion === null ? '#ifdef USE_AOMAP\n' : ''}  float ambientOcclusion = ${o.occlusion ?? '1.0'};
#ifdef USE_AOMAP
  ambientOcclusion *= ( texture2D( aoMap, vAoMapUv ).r - 1.0 ) * aoMapIntensity + 1.0;
#endif
  reflectedLight.indirectDiffuse *= ambientOcclusion;
#if defined( USE_ENVMAP ) && defined( STANDARD )
  reflectedLight.indirectSpecular *= computeSpecularOcclusion( saturate( dot( geometryNormal, geometryViewDir ) ), ambientOcclusion, material.roughness );
#endif${o.occlusion === null ? '\n#endif' : ''}`;
  return `#define WS_GRAPH
#define STANDARD
varying vec3 vViewPosition;
#include <common>
#include <packing>
#include <dithering_pars_fragment>
#include <cube_uv_reflection_fragment>
#include <envmap_common_pars_fragment>
#include <envmap_physical_pars_fragment>
#include <fog_pars_fragment>
#include <lights_pars_begin>
#include <uv_pars_fragment>
#define WS_THREE_UV
#include <normal_pars_fragment>
#include <normalmap_pars_fragment>
#include <roughnessmap_pars_fragment>
#include <aomap_pars_fragment>
#include <lights_physical_pars_fragment>
#include <shadowmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
${uniforms}
${FRAME}
${FRAGMENT_CAMERA}
#include <color_pars_fragment>
${fogged ? 'varying vec3 wsVFogWorld;' : ''}
${fog?.fog ?? ''}
${LIGHT_GLOBALS}
${program.fragment.head}
${direct}
${ambient}
${indirectSpecular}
void main() {
#include <clipping_planes_fragment>
#include <logdepthbuf_fragment>
${program.fragment.body}
${o.discard !== null ? `  if ( ${o.discard} ) discard;` : ''}
  vec4 diffuseColor = vec4( ${o.colour ?? 'wsMaterialColour'}, ${o.alpha ?? '1.0'} );
#include <color_fragment>
${cutoff}
  ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
  vec3 totalEmissiveRadiance = ${o.emissive ?? 'vec3( 0.0 )'};
  float roughnessFactor = ${o.roughness ?? 'wsMaterialRoughness'};
#ifdef USE_ROUGHNESSMAP
  roughnessFactor *= texture2D( roughnessMap, vRoughnessMapUv ).g;
#endif
  float metalnessFactor = ${o.metalness ?? '0.0'};
#include <normal_fragment_begin>
${ir.flipBackfaceNormals === false ? '#ifdef DOUBLE_SIDED\n  normal *= faceDirection;\n#endif' : ''}
${o.shadingNormal !== null ? `  normal = normalize( ( viewMatrix * vec4( ${o.shadingNormal}, 0.0 ) ).xyz );` : NORMAL_MAP}
#include <lights_physical_fragment>
  wsNormalView = normal;
  wsViewDirection = ( isOrthographic ) ? vec3( 0.0, 0.0, 1.0 ) : normalize( vViewPosition );
  wsAlbedo = material.diffuseContribution;
  wsRoughness = material.roughness;
#include <lights_fragment_begin>
#include <lights_fragment_maps>
#include <lights_fragment_end>
${occlusion}
  vec3 totalDiffuse = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse;
  vec3 totalSpecular = reflectedLight.directSpecular + reflectedLight.indirectSpecular;
  vec3 outgoingLight = totalDiffuse + totalSpecular + totalEmissiveRadiance;
${l?.grade === true ? '  outgoingLight = wsGraphGrade( outgoingLight );' : ''}
#include <opaque_fragment>
  // a node material's output is clamped at 0 (three's \`max( output, 0 )\`), before the output transform
  gl_FragColor = max( gl_FragColor, 0.0 );
${o.targetAlpha !== null ? `  gl_FragColor.a = ${o.targetAlpha};` : ''}
${l?.grade === true ? '' : '#include <tonemapping_fragment>'}
#include <colorspace_fragment>
${fogged ? fogEpilogue(program, fog) : ''}
#include <premultiplied_alpha_fragment>
#include <dithering_fragment>
}`;
}

/** a post graph's pass: a fullscreen triangle writing the graph's colour, as the TSL compile does with no scene bound (a
 *  scaled post lends its inputs as textures; a graph that reads the scene samples `wsScene` itself). Its colour goes out
 *  through the target's encoding, as a node material's does: none into a linear target, sRGB to the screen (QD11: a
 *  grade drawn straight to the canvas, G924, wrote linear values there and Nalati went dark and saturated) */
function postShaders(program: GraphGlslProgram, uniforms: string, fogFunction?: string, weighted = false): { vertexShader: string; fragmentShader: string } {
  const own = program.outputs.colour;
  // a weighted pass fades over the scene by its owner weight (the engine's blend: one more tap of the colour input)
  const colour = own === null ? 'vec3( 0.0 )' : weighted ? `mix( texture( wsScene, wsVUv ).rgb, ${own}, wsWeight )` : own;
  const varyingUv = program.vertex.body.includes('wsVUv') ? '' : 'varying vec2 wsVUv;';
  return {
    vertexShader: `#define WS_GRAPH
${uniforms}
${varyingUv}
${CAMERA_HELPERS}
${program.vertex.head}
void main() {
${program.vertex.body}
${varyingUv === '' ? '' : '  wsVUv = uv;'}
  gl_Position = vec4( position.xy, 0.0, 1.0 );
}`,
    fragmentShader: `#define WS_GRAPH
#include <common>
#include <packing>
${uniforms}
${varyingUv}
${FRAGMENT_CAMERA}
${fogFunction === undefined ? '' : `${fogFunction}\n`}${program.fragment.head}
void main() {
${program.fragment.body}
  gl_FragColor = vec4( ${colour}, ${program.outputs.alpha ?? '1.0'} );
#include <colorspace_fragment>
}`,
  };
}

const environmentRotation = new THREE.Matrix4();
/**
 * A lit graph's image-based light follows the drawn scene, as a node material's does (three hands `scene.environment`
 * only to its stock lit materials): the scene's environment, its intensity and rotation. A prefiltered (cube-UV)
 * environment only, as the node path's PMREM; a change of environment rebuilds the program (its envmap defines), as on a
 * stock material. Call it before the draw (the material's `onBeforeRender`).
 */
export function syncGraphEnvironment(material: { envMap: THREE.Texture | null; readonly uniforms: Record<string, THREE.IUniform> }, scene: THREE.Scene): void {
  const environment = scene.environment?.mapping === THREE.CubeUVReflectionMapping ? scene.environment : null;
  if (material.envMap !== environment) material.envMap = environment;
  if (environment === null) return;
  const map = material.uniforms['envMap'], intensity = material.uniforms['envMapIntensity'], rotation: unknown = material.uniforms['envMapRotation']?.value;
  if (map !== undefined) map.value = environment;
  if (intensity !== undefined) intensity.value = scene.environmentIntensity;
  // as three's stock refresh: the rotation's transpose (its inverse: the matrix is orthonormal)
  if (rotation instanceof THREE.Matrix3) rotation.setFromMatrix4(environmentRotation.makeRotationFromEuler(scene.environmentRotation)).transpose();
}

/** the renderer the host inputs read (the bound target's size): set once by the back-end's loader, never by an import */
let hostRenderer: THREE.WebGLRenderer | null = null;
/** Give the classic graph programs their renderer (the screen size `fragCoord` flips by). */
export function installGraphShaderHost(renderer: THREE.WebGLRenderer): void { hostRenderer = renderer; }
const screenSize = new THREE.Vector2(1, 1);
/** the engine inputs every graph program shares by reference, read by three as it uploads (no per-draw hook): the game's
 *  frame time (`worldTime.t`, the node path's clock; 0 before the game loop runs) and the bound target's size (else the
 *  drawing buffer's), as TSL's */
const HOST_TIME: THREE.IUniform<number> = { get value(): number { return worldTime.t ?? 0; }, set value(_: number) { /* the game's clock owns it */ } };
const HOST_SCREEN: THREE.IUniform<THREE.Vector2> = {
  get value(): THREE.Vector2 {
    const target = hostRenderer?.getRenderTarget() ?? null;
    if (target !== null) return screenSize.set(target.width, target.height);
    return hostRenderer === null ? screenSize : hostRenderer.getDrawingBufferSize(screenSize);
  },
  set value(_: THREE.Vector2) { /* the renderer owns it */ },
};

/** what a lent texture samples until its runtime lends one, as the node path's stand-ins: black and opaque (a volume half
 *  opaque), one of each kind, shared and never freed */
const standIns = new Map<string, THREE.Texture>();
function lentStandIn(type: 'sampler2D' | 'sampler2DArray' | 'sampler3D'): THREE.Texture {
  const known = standIns.get(type);
  if (known !== undefined) return known;
  const texture = type === 'sampler3D' ? new THREE.Data3DTexture(new Uint8Array([0, 0, 0, 128]), 1, 1, 1)
    : type === 'sampler2DArray' ? new THREE.DataArrayTexture(new Uint8Array([0, 0, 0, 255]), 1, 1, 1) : new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
  texture.needsUpdate = true; standIns.set(type, texture);
  return texture;
}

/** a uniform's starting value: a param's own (a colour held linear, as the families hold theirs), an engine clock or light
 *  shared by reference, a texture its resolver admits, else a neutral value the host moves */
function uniformValue(glsl: GraphGlsl, u: GraphGlslUniform, opts: GraphShaderOptions): THREE.IUniform {
  const vector = (type: 'float' | 'vec2' | 'vec3' | 'vec4', v: GraphLiteral): number | THREE.Vector2 | THREE.Vector3 | THREE.Vector4 => {
    const a = typeof v === 'number' ? [v] : v;
    return type === 'float' ? a[0] ?? 0 : type === 'vec2' ? new THREE.Vector2().fromArray(a) : type === 'vec3' ? new THREE.Vector3().fromArray(a) : new THREE.Vector4().fromArray(a);
  };
  switch (u.from) {
    case 'param': {
      const p = glsl.ir.params?.[u.param];
      if (p === undefined || typeof p.value === 'string') return { value: 0 };
      if (p.type === 'colour') { const [r = 0, g = 0, b = 0] = typeof p.value === 'number' ? [p.value] : p.value; return { value: new THREE.Color().setRGB(r, g, b, THREE.SRGBColorSpace) }; }
      return { value: vector(u.type, p.value) };
    }
    // one flat Float32Array, as three uploads it: a list of vectors was flattened again on every upload (NF15 P4: 0.3 ms
    // a frame and its garbage)
    case 'array': return { value: Float32Array.from((glsl.ir.arrays?.[u.param]?.value ?? []).flatMap(v => (typeof v === 'number' ? [v] : v))) };
    case 'texture': {
      const p = glsl.ir.params?.[u.param];
      if (p?.role === 'lent') return { value: lentStandIn(u.type) };
      if (p === undefined || typeof p.value !== 'string' || opts.textures === undefined) return { value: null };
      return { value: p.role === undefined ? opts.textures(p.value) : opts.textures(p.value, p.role) };
    }
    case 'toon': {
      // the family's own uniform object, shared by reference: the look's day clock moves every toon program at once
      const own: unknown = opts.toonLook === undefined ? undefined : Reflect.get(opts.toonLook.uniforms, u.toon);
      if (isUniform(own)) return own;
      return { value: u.type === 'float' ? 0 : vector(u.type, Array.from({ length: u.type === 'vec2' ? 2 : u.type === 'vec3' ? 3 : 4 }, () => 0)) };
    }
    case 'host':
      switch (u.host) {
        case 'windTime': return windUniforms.uWindTime;
        case 'windGust': return windUniforms.uGust;
        case 'atmosphereSunDirection': return fogUniforms.fogSunDir;
        case 'atmosphereSunColour': return fogUniforms.fogSunColor;
        case 'time': return HOST_TIME;
        case 'screenSize': return HOST_SCREEN;
        case 'codecStep': case 'weight': case 'materialEmissiveIntensity': return { value: 1 };
        case 'depthNear': return { value: 0.1 };
        case 'depthFar': return { value: 1000 };
        case 'materialColour': return { value: new THREE.Color(1, 1, 1) };
        case 'materialEmissive': return { value: new THREE.Color(0, 0, 0) };
        case 'scene': case 'depth': case 'normal': case 'meshMap': case 'bumpMap': return { value: null };
        case 'codecOrigin': case 'fogZenithColour': case 'skyLightColour': case 'skyLightDirection': case 'viewRight': case 'viewUp': return { value: new THREE.Vector3() };
        case 'viewForward': return { value: new THREE.Vector3(0, 0, -1) };
        default: throw new Error('material graph: an unknown host uniform');
      }
    default: throw new Error('material graph: an unknown uniform source');
  }
}

/** the uniform objects a lowered graph reads, made once (a fog graph's, lent to every program that selects it) */
export function graphUniformValues(glsl: GraphGlsl, opts: GraphShaderOptions = {}): Map<string, THREE.IUniform> {
  return new Map(glsl.uniforms.map(u => [u.name, uniformValue(glsl, u, opts)]));
}

/** Wrap a lowered graph in a classic program: the main draw (a material or a post pass), or its outline hull. */
export function graphShaders(glsl: GraphGlsl, opts: GraphShaderOptions = {}): GraphShaders {
  const program = opts.outline === true ? glsl.outline : glsl.program;
  if (program === null) throw new Error(opts.outline === true ? 'material graph: no outline stage' : 'material graph: a fog graph has no program of its own');
  const fog = opts.fog ?? (glsl.postFog === undefined ? undefined : { glsl: glsl.postFog, uniforms: graphUniformValues(glsl.postFog, opts) });
  const seen = new Set<string>(), own: GraphGlslUniform[] = [], from = new Map<string, 'graph' | 'fog'>();
  for (const [source, list] of [['graph', glsl.uniforms], ['fog', fog?.glsl.uniforms ?? []]] as const) {
    for (const u of list) if (!seen.has(u.name)) { seen.add(u.name); own.push(u); from.set(u.name, source); }
  }
  // the codec step and material colour every mesh program reads, declared once whether or not the graph names them
  for (const u of [{ name: 'wsMaterialColour', type: 'vec3', from: 'host', host: 'materialColour' }, { name: 'wsCodecStep', type: 'float', from: 'host', host: 'codecStep' }] as const) {
    if (!seen.has(u.name)) { seen.add(u.name); own.push(u); from.set(u.name, 'graph'); }
  }
  const uniforms: Record<string, THREE.IUniform> = {}, shared = opts.shared;
  for (const u of own) {
    // a declared fog's uniforms are its compile's own objects (its setParam moves every selecting program); the graph's
    // are shared between its draw and its outline
    const lent = from.get(u.name) === 'fog' ? fog?.uniforms.get(u.name) : shared?.get(u.name);
    const value = lent ?? uniformValue(from.get(u.name) === 'fog' && fog !== undefined ? fog.glsl : glsl, u, opts);
    if (lent === undefined && from.get(u.name) === 'graph') shared?.set(u.name, value);
    uniforms[u.name] = value;
  }
  const libraries = graphGlslLibraries([...glsl.libraries, ...(fog?.glsl.libraries ?? [])]);
  const text = [...own.filter(u => u.name !== 'wsCodecStep').map(decl), libraries].join('\n'), ir = glsl.ir;
  if (ir.kind === 'post') {
    const sample = glsl.postFog === undefined ? undefined : fog?.glsl.fogSample;
    if (glsl.postFog !== undefined && sample === undefined) throw new Error('material graph: post fog needs explicit transmission');
    let postText = text;
    if (opts.weighted === true) for (const [name, type, value] of [['wsScene', 'sampler2D', null], ['wsWeight', 'float', 1]] as const) {
      if (seen.has(name)) continue;
      uniforms[name] = { value }; postText += `\nuniform ${type} ${name};`;
    }
    return { ...postShaders(program, postText, sample, opts.weighted === true), uniforms, lights: false, fog: false };
  }
  const outline = opts.outline === true, depth = opts.depth === true, lit = !outline && !depth && ir.model !== 'unlit';
  const fogged = !depth && (outline || ir.effectState?.fog !== false);
  // the material's own ports a node material reads from its properties: `alphaTest` (the graph's cutoff until a row sets
  // it) and, for a lit graph without a roughness output, `roughness`
  const ports: string[] = [];
  if (ir.stages.surface?.alphaCutoff !== undefined) { uniforms['wsAlphaCutoff'] = { value: ir.stages.surface.alphaCutoff }; ports.push('uniform float wsAlphaCutoff;'); }
  if (lit && program.outputs.roughness === null) { uniforms['wsMaterialRoughness'] = { value: 1 }; ports.push('uniform float wsMaterialRoughness;'); }
  const fragmentText = (ports.length === 0 ? text : [text, ...ports].join('\n')).replaceAll('uniform vec3 wsFogZenithColour;', FOG_ZENITH);
  const declaredFog = fogged && fog !== undefined ? fog.glsl : undefined;
  // the environment's own uniforms (`syncGraphEnvironment` fills them from the drawn scene), three's DFG table and the
  // borrowed PBR maps' slots (`GraphShaderMaterial`'s normal, roughness and ao maps)
  if (lit) Object.assign(uniforms, THREE.UniformsUtils.merge([THREE.UniformsLib.lights, THREE.UniformsLib.envmap, THREE.UniformsLib.normalmap,
    THREE.UniformsLib.roughnessmap, THREE.UniformsLib.aomap]), { envMapIntensity: { value: 1 } }, { ...uniforms });
  // three refreshes fogColor only for a fogged material: one that reads it unfogged keeps the uniforms (fog_fragment stays out)
  if (fogged || program.fragment.body.includes('wsFogColour()') || program.vertex.body.includes('wsFogColour()')) Object.assign(uniforms, THREE.UniformsUtils.clone(THREE.UniformsLib.fog), { ...uniforms });
  return {
    vertexShader: vertexShader(glsl, program, text, lit, declaredFog !== undefined, outline),
    fragmentShader: lit ? litFragment(glsl, program, skyLightFromLights(fragmentText), fogged, declaredFog, glsl.ir.model === 'toon')
      : unlitFragment(glsl, program, fragmentText, fogged, declaredFog, depth),
    uniforms, lights: lit, fog: fogged || program.fragment.body.includes('wsFogColour()') || program.vertex.body.includes('wsFogColour()'),
  };
}
