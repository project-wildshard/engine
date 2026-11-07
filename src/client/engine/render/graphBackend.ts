/**
 * The lazy door to the material graph back-end: an SF59 graph IR compiles to its classic GLSL program (`graph/glslMaterial.ts`,
 * nine-fix NF14; the TSL node runtime retired in NF18) only when a graph is about to be used, so a shard without a graph
 * material loads none of it. `loadLookGraphCompiler` compiles look materials (their outlines, declared fogs and displaced
 * casters' shadow depth), `loadPostGraphCompiler` scaled post programs and `loadScenePostGraphCompiler` a shard's own post
 * stack; `bindGraphMeshMap` lends a compiled graph a model's maps in scope-owned clones.
 */
import { Texture, Material, Object3D, Vector2, type Camera, type Mesh, type MeshDepthMaterial, type Scene } from 'three';
import type { Pass } from 'postprocessing';
import type { GraphBinding, GraphLiteral, GraphValidation, GraphValidationOptions } from '@wildshard/format/materialGraph';
import type { ToonLook } from './families/toon';
import type { Scope } from '../../../shared/engine/app/scope';
import type { Renderer } from './renderer';
import { installClassicShadowDepth } from './shadowMaterialOwnership';
import { registerShadowDepthResolver, type ShadowDepthResolver } from './shadowDepthVariants';

/** a compiled declared fog (`kind: 'fog'`), opaque outside the back-end that compiled it */
export interface LookGraphFog { readonly backend: 'glsl' }
/** what a look material's compile takes */
export interface LookGraphOptions extends GraphValidationOptions {
  readonly toon?: ToonLook;
  readonly replaceEnvironmentDiffuse?: boolean;
  readonly textures?: (ref: string, role?: 'colour' | 'data') => Texture;
  /** resolves a material's `effectState.fog` catalogue id to that compiled fog graph (this back-end's) */
  readonly fog?: (id: string) => LookGraphFog;
  readonly validated?: Extract<GraphValidation, { ok: true }>;
}
/** a compiled look material */
export interface LookGraph {
  readonly material: Material;
  readonly outline: Material | null;
  readonly fog: LookGraphFog | null;
  readonly bindings: readonly { readonly param: string; readonly bind: GraphBinding }[];
  readonly setParam: (name: string, value: GraphLiteral) => void;
  readonly setTexture: (name: string, texture: Texture) => void;
}
/** A look material's graph compiler: the classic GLSL one (`graph/glslMaterial.ts`, nine-fix NF14). A compile's declared
 *  fogs are its own. */
export interface LookGraphCompiler {
  readonly backend: 'glsl';
  readonly compileGraph: (input: unknown, opts: LookGraphOptions) => LookGraph;
  readonly attachOutline: (mesh: Mesh, outline: Material) => Mesh;
}
/** a compiler's declared fogs behind their tokens */
function fogTokens<P>(): { readonly wrap: (fog: P | null) => LookGraphFog | null; readonly unwrap: (token: LookGraphFog) => P } {
  const own = new WeakMap<LookGraphFog, P>();
  return {
    wrap: (fog) => { if (fog === null) return null; const token: LookGraphFog = { backend: 'glsl' }; own.set(token, fog); return token; },
    unwrap: (token) => { const fog = own.get(token); if (fog === undefined) throw new Error('material graph: a declared fog of another compile'); return fog; },
  };
}
/** a compiled post graph: a scaled post pass lends its inputs as textures and moves its params */
export interface PostGraph {
  readonly material: Material;
  readonly setParam: (name: string, value: GraphLiteral) => void;
  readonly setTexture: (name: string, texture: Texture) => void;
  readonly setArrayParam: (name: string, value: readonly GraphLiteral[]) => void;
}
/** A post graph compiler: the classic GLSL one (nine-fix NF16's seam). */
export interface PostGraphCompiler {
  readonly backend: 'glsl';
  readonly compileGraph: (input: unknown, opts: GraphValidationOptions) => PostGraph;
}
/** The post compiler: the classic GLSL one (the default since PF10, G941). */
export async function loadPostGraphCompiler(renderer: Renderer): Promise<PostGraphCompiler> {
  const [{ compileClassicGraph }, { installGraphShaderHost }] = await Promise.all([import('./graph/glslMaterial'), import('./graph/glslProgram')]);
  installGraphShaderHost(renderer);
  return { backend: 'glsl', compileGraph: (input, opts) => compileClassicGraph(input, opts) };
}
/** a shard post stack's pass: its compiled graph drawn over the composer's input, fading by the stack's owner weight */
export interface ScenePostPass extends Pass {
  /** the owner weight (0 … 1): the graph fades over the scene; 0 skips the pass */
  readonly setWeight: (w: number) => void;
}
/** the normal pre-pass a post stack pays once when a pass reads `sceneNormal`; `texture` is that input */
export interface ScenePostPrepass extends Pass { readonly texture: Texture }
/** what a scene post pass's compile takes: the admitted lists, and the pass's inputs */
export interface ScenePostOptions extends GraphValidationOptions {
  /** the scene camera (its clip range linearises `sceneDepth`) */
  readonly camera: Camera;
  /** the graph reads `sceneDepth`: the pass asks the composer for its depth texture */
  readonly depth: boolean;
  /** the normal pre-pass's target, when the graph reads `sceneNormal` */
  readonly normal: Texture | null;
  readonly validated?: Extract<GraphValidation, { ok: true }>;
}
/** A shard's own post stack's compiler (SF59 step 4): each post graph as a composer pass, on the classic GLSL back-end. */
export interface ScenePostGraphCompiler {
  readonly compilePass: (input: unknown, opts: ScenePostOptions) => { readonly graph: PostGraph & Pick<LookGraph, 'bindings'>; readonly pass: ScenePostPass };
  readonly normalPrepass: (scene: Scene, camera: Camera) => ScenePostPrepass;
}
/** The scene post compiler: classic GLSL passes (nine-fix NF18). */
export async function loadScenePostGraphCompiler(renderer: Renderer): Promise<ScenePostGraphCompiler> {
  const [{ compileClassicGraph }, { installGraphShaderHost }, { ClassicPostPass, GraphNormalPrepass }] = await Promise.all([import('./graph/glslMaterial'), import('./graph/glslProgram'), import('./graph/glslPost')]);
  installGraphShaderHost(renderer);
  return {
    compilePass: (input, { camera, depth, normal, ...opts }) => {
      const graph = compileClassicGraph(input, { ...opts, weighted: true });
      return { graph, pass: new ClassicPostPass(graph.material, camera, depth, normal) };
    },
    normalPrepass: (scene, camera) => new GraphNormalPrepass(scene, camera),
  };
}
/** a renderer's classic depth resolver, made once (registration dedupes by identity); the caster is unknown at compile time,
 *  so its grid decode reads a plain object's (step 1): uniforms only, the program is the same */
const classicDepthResolvers = new WeakMap<object, ShadowDepthResolver>();
const compileCaster = new Object3D();
function classicDepthResolver(depthOf: (source: unknown, stock: MeshDepthMaterial, object: Object3D) => Material | null): ShadowDepthResolver {
  let resolve = classicDepthResolvers.get(depthOf);
  if (resolve === undefined) { resolve = (source, stock) => depthOf(source, stock, compileCaster); classicDepthResolvers.set(depthOf, resolve); }
  return resolve;
}
/** The look-material compiler: the classic GLSL one (the default since PF10, G941). */
export async function loadLookGraphCompiler(renderer: Renderer): Promise<LookGraphCompiler> {
  const [{ compileClassicGraph, attachClassicOutline, classicShadowDepth }, { installGraphShaderHost }] = await Promise.all([import('./graph/glslMaterial'), import('./graph/glslProgram')]);
  installGraphShaderHost(renderer);
  installClassicShadowDepth(classicShadowDepth);
  // precompile's shadow jobs warm each classic caster's own depth program (it links in the loading, not at its first cast)
  registerShadowDepthResolver(renderer, classicDepthResolver(classicShadowDepth));
  const fogs = fogTokens<NonNullable<ReturnType<typeof compileClassicGraph>['fog']>>();
  return {
    backend: 'glsl',
    compileGraph: (input, { fog, ...opts }) => {
      const compiled = compileClassicGraph(input, { ...opts, ...(fog === undefined ? {} : { fog: (id: string) => fogs.unwrap(fog(id)) }) });
      return { material: compiled.material, outline: compiled.outline, fog: fogs.wrap(compiled.fog), bindings: compiled.bindings, setParam: compiled.setParam, setTexture: compiled.setTexture };
    },
    attachOutline: attachClassicOutline,
  };
}

const meshMapBases = new WeakMap<Material, Material>();
const sourceMaps = new WeakMap<Scope, WeakMap<Material, WeakMap<Material, Material>>>();
const meshMaps = new WeakMap<Scope, WeakMap<Material, WeakMap<Texture, Material>>>();

/** Borrow a model's original colour map for an opted-in graph, preserving its sampler and UV transform.
 * Equal graph/map pairs share one scope-owned material; neither the source nor the borrowed texture is disposed. */
export function bindGraphMeshMap(material: Material, map: Texture | Material | null | undefined, scope: Scope): Material {
  if (map instanceof Material) {
    if (scope.disposed) throw new Error('Graph map loan needs a live scope');
    if (material.userData['graphPbrMaps'] !== true && material.userData['graphMeshMap'] !== true) return material;
    let owners = sourceMaps.get(scope);
    if (owners === undefined) { owners = new WeakMap(); sourceMaps.set(scope, owners); }
    let sources = owners.get(material);
    if (sources === undefined) { sources = new WeakMap(); owners.set(material, sources); }
    const known = sources.get(map); if (known !== undefined) return known;
    const variant = graphClone(material, scope);
    for (const slot of ['map', 'bumpMap', 'normalMap', 'roughnessMap', 'aoMap'] as const) {
      const value: unknown = Reflect.get(map, slot);
      if (value instanceof Texture && !Reflect.set(variant, slot, value)) throw new Error(`Graph cannot borrow ${slot}`);
    }
    for (const slot of ['bumpScale', 'aoMapIntensity'] as const) {
      const value: unknown = Reflect.get(map, slot);
      if (typeof value === 'number' && Number.isFinite(value)) Reflect.set(variant, slot, value);
    }
    const scale: unknown = Reflect.get(map, 'normalScale'), target: unknown = Reflect.get(variant, 'normalScale');
    if (scale instanceof Vector2 && target instanceof Vector2) target.copy(scale);
    meshMapBases.set(variant, material); sources.set(map, variant); return variant;
  }
  if (material.userData['graphMeshMap'] !== true || (map === null || map === undefined)) return material;
  let graphs = meshMaps.get(scope);
  if (graphs === undefined) { graphs = new WeakMap(); meshMaps.set(scope, graphs); }
  let textures = graphs.get(material);
  if (textures === undefined) { textures = new WeakMap(); graphs.set(material, textures); }
  const known = textures.get(map); if (known !== undefined) return known;
  const variant = graphClone(material, scope);
  if (!Reflect.set(variant, 'map', map)) throw new Error('Graph colour map could not be bound');
  meshMapBases.set(variant, material);
  textures.set(map, variant);
  return variant;
}

/** A scope-owned clone of a compiled graph material (a classic graph's clone shares its uniforms, `GraphShaderMaterial.copy`). */
function graphClone(material: Material, scope: Scope): Material { return scope.own(material.clone()); }

/** Resolve the compiled graph that owns a borrowed-map variant, including its outline and live parameter feeds. */
export function graphMeshMapBase(material: Material): Material { return meshMapBases.get(material) ?? material; }
