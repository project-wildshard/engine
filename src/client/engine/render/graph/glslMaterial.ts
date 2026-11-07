/**
 * The classic graph material (nine-fix NF14): a graph lowered by `glsl.ts` and wrapped by `glslProgram.ts`, drawn as a
 * plain `ShaderMaterial` with no node runtime and no per-draw hook. `compileClassicGraph` compiles look materials (it
 * was the GLSL twin of the retired TSL `compileGraph`, NF18): params, lent textures, uniform lists, outline and declared
 * fog, behind the `LookGraph` contract (`graphBackend.ts`).
 *
 * - **Clones share the graph's uniforms** (`GraphShaderMaterial.copy`), as a node material's clone shares its uniform
 *   nodes: a param, a lent texture or an engine clock moves every variant (a coarse tile's mask, a borrowed mesh map, a
 *   viewmodel's transparent copy). A variant's own colour, emissive and mesh maps stay its own.
 * - **The engine's classic patches apply as they do to a family material**: the program is built on three's stock chunks,
 *   so the coarse tile mask (anchored on `project_vertex` / `clipping_planes_fragment`), a layered backdrop's frame (its
 *   view and camera defines), the engine and level fog chunks and the sky rig's shadow cascades reach it unchanged.
 * - **A displaced caster** (`vertex.offset` / `vertex.position` with `shadow: true`) gets a depth material from the same
 *   vertex stage (`ClassicGraph.depth`), attached per mesh as three's `customDepthMaterial`.
 */
import * as THREE from 'three';
import { graphUsesMeshMap, type GraphBinding, type GraphCost, type GraphLiteral, type GraphNode } from '@wildshard/format/materialGraph';
import type { ToonLook } from '../families/toon';
import { emitClassicGraph, graphShaders, graphUniformValues, syncGraphEnvironment, type ClassicFog, type GraphShaderOptions } from './glslProgram';
import type { EmitGraphGlslOptions, GraphGlsl } from './glsl';
import { drawNeutral } from '../drawNeutral';
import { ClassicCodec } from './glslCodec';
import { latestCascades } from '../../world/cascadeLights';
import { hasShaderPatch } from '../shaderPatches';

/** the uniforms a variant keeps its own (a creature's tint, a borrowed map); every other one is shared with its source */
const OWN_UNIFORMS: ReadonlySet<string> = new Set(['wsMaterialColour', 'wsMaterialEmissive', 'wsMaterialEmissiveIntensity', 'wsMeshMap', 'wsBumpMap',
  'wsMaterialRoughness', 'wsAlphaCutoff', 'wsCodecStep', 'wsCodecOrigin', 'normalMap', 'normalMapTransform', 'normalScale', 'roughnessMap',
  'roughnessMapTransform', 'aoMap', 'aoMapTransform', 'aoMapIntensity']);

/** a variant's copy of an own uniform's value: a colour, vector or matrix its own, a texture (or a number) as it is */
function ownValue(value: unknown): unknown {
  return value instanceof THREE.Color || value instanceof THREE.Vector2 || value instanceof THREE.Vector3 || value instanceof THREE.Vector4
    || value instanceof THREE.Matrix3 ? value.clone() : value;
}

/** the white instance colours `GraphShaderMaterial.onBeforeRender` made (remade when their mesh outgrows them) */
const whiteColours = new WeakSet<THREE.BufferAttribute>();
const pendingWhite = new WeakSet<THREE.Object3D>();
/** no colours yet, or white ones a later, larger instanceMatrix outgrew (worldScenes' target rows swap one in) */
function needsWhite(object: THREE.Object3D): boolean {
  if (!(object instanceof THREE.InstancedMesh)) return false;
  const colours = object.instanceColor;
  return colours === null || (whiteColours.has(colours) && colours.count < object.instanceMatrix.count);
}
/**
 * White instance colours for `mesh`, given once this frame has drawn: three creates an instanced attribute's buffer in
 * its object update, before the draw hooks run, so colours set inside the hook were bound to no buffer, and the vertex
 * array three caches for the geometry and program kept them unbound (read as 0: Nine's mahjong diners drew black). This
 * frame draws the mesh as it was; the next uploads the colours before it binds them.
 */
function giveWhiteColours(object: THREE.Object3D): void {
  if (pendingWhite.has(object)) return;
  pendingWhite.add(object);
  queueMicrotask(() => {
    pendingWhite.delete(object);
    if (needsWhite(object)) makeWhite(object);
  });
}
/** white colours at an instanced `object`'s size */
function makeWhite(object: THREE.Object3D): void {
  if (!(object instanceof THREE.InstancedMesh)) return;
  const white = new THREE.InstancedBufferAttribute(new Float32Array(object.instanceMatrix.count * 3).fill(1), 3);
  whiteColours.add(white); object.instanceColor = white;
}

/** whether a graph (or a loop body in it) reads the instance colour */
function readsInstanceColour(nodes: Readonly<Record<string, GraphNode>>): boolean {
  return Object.values(nodes).some(node => node.op === 'instanceColour' || (node.body !== undefined && readsInstanceColour(node.body.nodes)));
}

/** the compiled materials that own their graph's shadow depth (their clones share it) */
const depthOwners = new WeakSet<THREE.Material>();

/** A lowered graph's `ShaderMaterial`: its clones share the graph's uniforms; its colour, emissive and mesh maps are ports. */
export class GraphShaderMaterial extends THREE.ShaderMaterial {
  readonly isGraphShaderMaterial = true;
  /** the tile grid codec this program decodes positions with (null: it reads no model-space position): its own step and
   *  origin follow the drawn object, re-uploaded only when they change (RM8.1e) */
  codec: ClassicCodec | null = null;
  /** a vertex-moving caster's shadow depth from the graph's own vertex stage (null: the stock depth), shared by its clones;
   *  each variant casts with its own copy (`classicShadowDepth`) */
  shadowDepth: GraphShaderMaterial | null = null;
  /** this variant's own copy of `shadowDepth` (its map and cutoff), made at its first cast and freed with it */
  castDepth: GraphShaderMaterial | null = null;
  /** EP7: the graph reads `instanceColour`. An instanced mesh drawn with no colours gets white ones at its first draw (the
   *  same pixels: `wsInstanceColour()` is white without them), so it shares the coloured instances' program instead of
   *  compiling its own (Nine's architecture drew instanced sets and sitters apart from its walkers and plants) */
  instanceColour = false;
  /** a lit graph's image-based light: the drawn scene's prefiltered environment (`syncGraphEnvironment`), as a node
   *  material reads `scene.environment` */
  envMap: THREE.Texture | null = null;
  /** the material's own colour (`materialColour`), as a node material's `color` */
  get color(): THREE.Color { return this.colourUniform('wsMaterialColour', 1).value; }
  /** the material's own emissive colour (`materialEmissive` is this times `emissiveIntensity`) */
  get emissive(): THREE.Color { return this.colourUniform('wsMaterialEmissive', 0).value; }
  get emissiveIntensity(): number { const u = this.uniforms['wsMaterialEmissiveIntensity']; return typeof u?.value === 'number' ? u.value : 1; }
  set emissiveIntensity(value: number) { this.own('wsMaterialEmissiveIntensity', value); }
  /** the material's own roughness (`roughness`), read where the graph writes none, as a node material's */
  get roughness(): number { const u = this.uniforms['wsMaterialRoughness']; return typeof u?.value === 'number' ? u.value : 1; }
  set roughness(value: number) { this.own('wsMaterialRoughness', value); }
  /** a graph with a cutoff discards below the material's own `alphaTest` (three refreshes no alphaTest for a shader
   *  material): a row's value replaces the graph's, as on a node material */
  override get alphaTest(): number { return super.alphaTest; }
  override set alphaTest(value: number) {
    super.alphaTest = value;
    // three's copy sets it before the uniforms arrive (they come with the source's value)
    const cutoff = this.uniforms['wsAlphaCutoff'];
    if (cutoff !== undefined) cutoff.value = value;
  }
  /** a borrowed colour map (`meshMap`): sampled where the graph reads it, else its fallback */
  get map(): THREE.Texture | null { return this.texture('wsMeshMap'); }
  set map(texture: THREE.Texture | null) { this.lend('wsMeshMap', 'WS_MESH_MAP', texture, 'mapTransform'); }
  /** a borrowed bump map (`meshMap` named `bump`) */
  get bumpMap(): THREE.Texture | null { return this.texture('wsBumpMap'); }
  set bumpMap(texture: THREE.Texture | null) { this.lend('wsBumpMap', 'WS_BUMP_MAP', texture, 'bumpMapTransform'); }
  /** a lit graph's borrowed PBR maps (`bindGraphMeshMap`'s `graphPbrMaps` loan), as a node material's slots: three switches
   *  their defines from these properties, the lit program samples them with its stock chunks */
  readonly normalMapType: THREE.NormalMapTypes = THREE.TangentSpaceNormalMap;
  get normalMap(): THREE.Texture | null { return this.texture('normalMap'); }
  set normalMap(texture: THREE.Texture | null) { this.slot('normalMap', 'normalMapTransform', texture); }
  get roughnessMap(): THREE.Texture | null { return this.texture('roughnessMap'); }
  set roughnessMap(texture: THREE.Texture | null) { this.slot('roughnessMap', 'roughnessMapTransform', texture); }
  get aoMap(): THREE.Texture | null { return this.texture('aoMap'); }
  set aoMap(texture: THREE.Texture | null) { this.slot('aoMap', 'aoMapTransform', texture); }
  get aoMapIntensity(): number { const u = this.uniforms['aoMapIntensity']; return typeof u?.value === 'number' ? u.value : 1; }
  set aoMapIntensity(value: number) { this.own('aoMapIntensity', value); }
  /** the normal map's scale, the uniform's own vector (a loan copies into it) */
  get normalScale(): THREE.Vector2 {
    const known: unknown = this.uniforms['normalScale']?.value;
    if (known instanceof THREE.Vector2) return known;
    const value = new THREE.Vector2(1, 1); this.uniforms['normalScale'] = { value };
    return value;
  }

  /** A lit program gates its sun by the sky's cascades (the CSM chunk's setup: one cascade per depth slice, the shadow
   *  fade's ghosts), as the retired node back-end gated the registered cascade lights; without it every cascade lit it at
   *  full strength. A clone that copied the patch (a coarse tile's variant) keeps it. */
  gateCascades(): void {
    if (!this.lights || hasShaderPatch(this, 'engine.csm')) return;
    latestCascades()?.setup?.(this);
  }

  /** NF15: the shader warm-up's white instance colours for the live `object`, before it copies its stand-in. No draw is
   *  under way (the next object update uploads them), so the warm-up links the coloured program the draws bind, not a
   *  colourless one only the first frame (before `giveWhiteColours`) drew */
  prepareInstances(object: THREE.Object3D): void {
    if (this.instanceColour && needsWhite(object)) makeWhite(object);
  }

  override onBeforeRender(_renderer: THREE.WebGLRenderer, scene: THREE.Scene, _camera: THREE.Camera, _geometry: THREE.BufferGeometry, object: THREE.Object3D): void {
    // a material built before its sky registered its cascades takes them at its first draw (precompile runs this hook)
    this.gateCascades();
    this.codec?.draw(this, object);
    if (this.instanceColour && needsWhite(object)) giveWhiteColours(object);
    // the environment uniforms are shared with clones: every lit draw writes its own scene's before it uploads
    if (this.lights) syncGraphEnvironment(this, scene);
  }


  override dispose(): void {
    this.castDepth?.dispose(); this.castDepth = null;
    if (depthOwners.has(this)) this.shadowDepth?.dispose();
    super.dispose();
  }

  override copy(source: THREE.ShaderMaterial): this {
    // three's copy deep-clones every uniform value, a texture too, and a texture's clone bumps the version of the source it
    // shares (Texture.copy sets needsUpdate): a compressed texture whose mips retired then reads as changed and its next
    // draw throws. Three is handed no uniforms to clone; the graph's are shared, a variant's own values copied, its
    // textures the same textures
    const uniforms = source.uniforms;
    source.uniforms = {};
    try { super.copy(source); } finally { source.uniforms = uniforms; }
    this.codec = source instanceof GraphShaderMaterial && source.codec !== null ? new ClassicCodec() : null;
    this.shadowDepth = source instanceof GraphShaderMaterial ? source.shadowDepth : null;
    this.instanceColour = source instanceof GraphShaderMaterial && source.instanceColour;
    for (const [name, uniform] of Object.entries(uniforms)) this.uniforms[name] = OWN_UNIFORMS.has(name) ? { value: ownValue(uniform.value) } : uniform;
    return this;
  }

  private colourUniform(name: string, initial: number): THREE.IUniform<THREE.Color> {
    const known = this.uniforms[name];
    if (known !== undefined && known.value instanceof THREE.Color) return { value: known.value };
    const value = new THREE.Color(initial, initial, initial);
    this.uniforms[name] = { value };
    return { value };
  }
  private texture(name: string): THREE.Texture | null { const value: unknown = this.uniforms[name]?.value; return value instanceof THREE.Texture ? value : null; }
  /** set an own uniform's value in place (its program already reads that object) */
  private own(name: string, value: unknown): void { const known = this.uniforms[name]; if (known === undefined) this.uniforms[name] = { value }; else known.value = value; }
  /** a borrowed map and its uv transform: a lit program reads it at three's slot uv (`WS_THREE_UV`), whose transform three
   *  never uploads for a shader material */
  private lend(name: string, define: string, texture: THREE.Texture | null, transform: string): void {
    const had = this.texture(name) !== null;
    this.own(name, texture);
    if (texture !== null) this.transform(transform, texture);
    if (had === (texture !== null)) return;
    const defines: Record<string, unknown> = { ...this.defines };
    if (texture === null) Reflect.deleteProperty(defines, define); else defines[define] = '';
    this.defines = defines; this.needsUpdate = true;
  }
  /** a PBR map slot and its uv transform (three refreshes neither for a shader material); its presence is a program variant */
  private slot(name: string, transform: string, texture: THREE.Texture | null): void {
    const had = this.texture(name) !== null;
    this.own(name, texture);
    if (texture !== null) this.transform(transform, texture);
    if (had !== (texture !== null)) this.needsUpdate = true;
  }
  /** `texture`'s uv transform into the program's own uniform (its matrix, refreshed when it updates itself) */
  private transform(name: string, texture: THREE.Texture): void {
    if (texture.matrixAutoUpdate) texture.updateMatrix();
    const known: unknown = this.uniforms[name]?.value;
    if (known instanceof THREE.Matrix3) known.copy(texture.matrix); else this.uniforms[name] = { value: texture.matrix.clone() };
  }
}

/** a compiled classic graph: the look-material contract (`LookGraph`) and what draws it */
export interface ClassicGraph {
  readonly material: GraphShaderMaterial;
  readonly glsl: GraphGlsl;
  readonly cost: GraphCost;
  readonly bindings: readonly { readonly param: string; readonly bind: GraphBinding }[];
  readonly selects: { readonly light: number; readonly branch: number };
  /** the outline stage's hull (null without one): attach it with `attachClassicOutline` */
  readonly outline: GraphShaderMaterial | null;
  /** a displaced caster's shadow depth (null unless a vertex stage says `shadow: true`): attach it with `attachClassicDepth` */
  readonly depth: GraphShaderMaterial | null;
  /** a fog graph's lowering and its uniform objects, for the materials that select it (null for any other kind) */
  readonly fog: ClassicFog | null;
  readonly setParam: (name: string, value: GraphLiteral) => void;
  readonly setTexture: (name: string, texture: THREE.Texture) => void;
  readonly setArrayParam: (name: string, value: readonly GraphLiteral[]) => void;
}
/** what compiling a classic graph needs beyond the graph */
export interface ClassicGraphOptions extends Omit<EmitGraphGlslOptions, 'toon'> {
  readonly toon?: ToonLook;
  readonly textures?: GraphShaderOptions['textures'];
  /** resolves a material's `effectState.fog` catalogue id to that compiled fog graph */
  readonly fog?: (id: string) => ClassicFog;
  /** a scene post pass's graph: it fades over the scene input by its owner weight (`GraphShaderOptions.weighted`) */
  readonly weighted?: boolean;
}

/** a program that reads a model-space position or offsets one decodes a tile primitive's grid (RM8.1e) */
const readsCodec = (vertexShader: string): boolean => /\bwsCodec(Step|Origin)\b/.test(vertexShader.slice(vertexShader.indexOf('void main()')));
/** a mesh without a declared attribute reads its default, else TSL's attribute() constant (three's generateConst: zeros,
 *  a vec4 as a new Vector4, 0, 0, 0, 1), never the generic value the last draw left at that location */
function attributeDefaults(glsl: GraphGlsl, m: THREE.ShaderMaterial): THREE.ShaderMaterial['defaultAttributeValues'] {
  const missing = (type: string): number[] => (type === 'float' ? [0] : type === 'vec2' ? [0, 0] : type === 'vec3' ? [0, 0, 0] : [0, 0, 0, 1]);
  return { ...m.defaultAttributeValues, ...Object.fromEntries(glsl.attributes.map(a => [a.name, a.default === null ? missing(a.type) : [...a.default]])) };
}
/** a displaced caster's shadow depth: the graph's vertex stage and surface mask, writing depth (three's BasicDepthPacking) */
function depthMaterial(glsl: GraphGlsl, opts: GraphShaderOptions): GraphShaderMaterial {
  const shaders = graphShaders(glsl, { ...opts, depth: true });
  const m = new GraphShaderMaterial({ vertexShader: shaders.vertexShader, fragmentShader: shaders.fragmentShader, uniforms: shaders.uniforms });
  m.name = 'graph:depth'; m.userData['graphDepthVariant'] = true;
  if (readsCodec(shaders.vertexShader)) m.codec = new ClassicCodec();
  m.defaultAttributeValues = attributeDefaults(glsl, m);
  return m;
}

/**
 * The depth a shadow cast of `object` with the classic graph material `source` draws with in place of three's stock depth
 * material `stock` (its configured copy of the caster's depth facts), or null where the stock draws: a vertex-moving
 * graph (`shadow: true`) casts from its own vertex stage, as the node path's depth variant does. Installed by the classic
 * back-end's loader (`installClassicShadowDepth`).
 */
export function classicShadowDepth(source: unknown, stock: THREE.MeshDepthMaterial, object: THREE.Object3D): THREE.Material | null {
  if (!(source instanceof GraphShaderMaterial) || source.shadowDepth === null) return null;
  const depth = source.castDepth ??= source.shadowDepth.clone();
  depth.side = stock.side; depth.map = stock.map; depth.alphaTest = stock.alphaTest;
  // three's shadow pass calls no material hook: the caster's grid decode is fed here
  depth.codec?.draw(depth, object);
  return depth;
}

/** A lowered graph as its classic material, with the graph's render state (sides, blend, depth, flat shading, points). */
function shaderMaterial(glsl: GraphGlsl, opts: GraphShaderOptions): GraphShaderMaterial {
  const shaders = graphShaders(glsl, opts), ir = glsl.ir, effect = ir.effectState, outline = opts.outline === true;
  const m = new GraphShaderMaterial({ vertexShader: shaders.vertexShader, fragmentShader: shaders.fragmentShader, uniforms: shaders.uniforms, lights: shaders.lights, fog: shaders.fog });
  m.gateCascades();
  m.name = outline ? 'graph:outline' : `graph:${ir.kind}`;
  if (readsCodec(shaders.vertexShader)) m.codec = new ClassicCodec();
  m.instanceColour = readsInstanceColour(ir.nodes);
  m.defaultAttributeValues = attributeDefaults(glsl, m);
  if (ir.kind === 'post') { m.depthTest = false; m.depthWrite = false; return m; }
  if (outline) { m.side = THREE.BackSide; return m; }
  m.side = ir.doubleSided === true ? THREE.DoubleSide : THREE.FrontSide;
  // three reads FLAT_SHADED from the material's own flag, which ShaderMaterial does not declare: the define carries it
  if (ir.model !== 'unlit' && (ir.flatShading ?? ir.model === 'toon')) m.defines = { ...m.defines, FLAT_SHADED: '' };
  if (ir.stages.surface?.alpha !== undefined) m.transparent = ir.stages.surface.alphaCutoff === undefined;
  if (ir.stages.surface?.alphaCutoff !== undefined) m.alphaTest = ir.stages.surface.alphaCutoff;
  if (effect?.blend !== undefined) {
    m.transparent = true;
    m.blending = effect.blend === 'additive' ? THREE.AdditiveBlending : effect.blend === 'premultiplied' ? THREE.CustomBlending : THREE.NormalBlending;
    if (effect.blend === 'premultiplied') { m.blendSrc = THREE.OneFactor; m.blendDst = THREE.OneMinusSrcAlphaFactor; m.blendSrcAlpha = THREE.OneFactor; m.blendDstAlpha = THREE.OneMinusSrcAlphaFactor; }
  }
  if (effect?.depthWrite !== undefined) m.depthWrite = effect.depthWrite;
  // O14: an additive double-sided blend that writes no depth reads the same in one pass (the sum is order-free)
  if (effect?.singlePass === true || (m.transparent && m.side === THREE.DoubleSide && m.blending === THREE.AdditiveBlending && !m.depthWrite)) m.forceSinglePass = true;
  if (effect?.depthBias !== undefined) { m.polygonOffset = true; m.polygonOffsetFactor = effect.depthBias.factor; m.polygonOffsetUnits = effect.depthBias.units; }
  // an unlit graph writes raw colour (no output transform), as the GLSL program it stands for did; a graded one is display linear
  if (ir.stages.lighting?.grade !== undefined || (ir.model === 'unlit' && effect?.output !== 'colour')) m.toneMapped = false;
  // the flags the client reads off a compiled graph, as compile.ts sets them: a borrowed mesh map, raw unlit output, points
  if (graphUsesMeshMap(ir)) m.userData['graphMeshMap'] = true;
  if (ir.kind === 'material' && ir.model !== 'unlit') m.userData['graphPbrMaps'] = true;
  if (ir.kind === 'material' && ir.model === 'unlit' && effect?.output !== 'colour') m.userData['graphRawOutput'] = true;
  if (ir.primitive === 'points') m.userData['graphPrimitive'] = 'points';
  return m;
}

/**
 * Compile a graph to its classic material. Throws (with every reason) when validation refuses it. A `model: 'toon'`
 * graph needs the family look (`toon`); a material selecting a declared fog needs `fog`.
 */
export function compileClassicGraph(input: unknown, opts: ClassicGraphOptions = {}): ClassicGraph {
  const { toon, textures, fog: fogFor, weighted, ...emit } = opts;
  const glsl = emitClassicGraph(input, { ...emit, ...(toon === undefined ? {} : { toonLook: toon }) }), ir = glsl.ir;
  const selected = ir.effectState?.fog;
  const fog = typeof selected === 'string' ? fogFor?.(selected) : undefined;
  if (typeof selected === 'string' && fog === undefined) throw new Error(`material graph: fog ${selected} needs a fog resolver`);
  const shared = new Map<string, THREE.IUniform>();
  const shaderOpts: GraphShaderOptions = { shared, ...(toon === undefined ? {} : { toonLook: toon }), ...(textures === undefined ? {} : { textures }), ...(fog === undefined ? {} : { fog }), ...(weighted === true && ir.kind === 'post' ? { weighted } : {}) };
  const postFog = glsl.postFog === undefined ? undefined : { glsl: glsl.postFog, uniforms: graphUniformValues(glsl.postFog, shaderOpts) };
  const drawOpts = postFog === undefined ? shaderOpts : { ...shaderOpts, fog: postFog };
  // a fog graph draws nothing itself: its uniforms are made once here and lent to every program selecting it
  const fogOwn = ir.kind === 'fog' ? graphUniformValues(glsl, shaderOpts) : null;
  const material = ir.kind === 'fog' ? carrier() : shaderMaterial(glsl, drawOpts);
  const outline = glsl.outline === null ? null : shaderMaterial(glsl, { ...shaderOpts, outline: true });
  const casts = ir.stages['vertex.offset']?.shadow === true || ir.stages['vertex.position']?.shadow === true;
  const depth = casts ? depthMaterial(glsl, shaderOpts) : null;
  if (depth !== null) {
    material.shadowDepth = depth; material.userData['graphShadowDepth'] = true; depthOwners.add(material);
  }
  const uniformsOf = (name: string): THREE.IUniform | undefined => fogOwn?.get(name) ?? shared.get(name) ?? postFog?.uniforms.get(name);
  // the runtime feeds write params every frame (NF15 P4: a scan per write cost 0.18 ms a frame): by name, once
  const ownUniforms = postFog === undefined ? glsl.uniforms : [...glsl.uniforms, ...postFog.glsl.uniforms];
  const paramNames = new Map(ownUniforms.flatMap(u => (u.from === 'param' || u.from === 'texture' || u.from === 'array' ? [[u.param, u.name] as const] : [])));
  const param = (name: string): string | undefined => paramNames.get(name);
  const inRange = (name: string, n: number, min: number | undefined, max: number | undefined): void => {
    if (!Number.isFinite(n)) throw new Error(`material graph: param ${name} must be finite`);
    if ((min !== undefined && n < min) || (max !== undefined && n > max)) throw new Error(`material graph: param ${name} outside declared range`);
  };
  // NF15: a param's checked writer, resolved on its first write. Most feed writes repeat the value the uniform holds
  // (a held value was checked when written), so those return before the range check.
  const setters = new Map<string, (value: GraphLiteral) => void>();
  const setterOf = (name: string): ((value: GraphLiteral) => void) => {
    const p = ir.params?.[name] ?? postFog?.glsl.ir.params?.[name];
    if (p === undefined || p.type === 'texture') throw new Error(`material graph: no param ${name}`);
    const length = p.type === 'vec2' ? 2 : p.type === 'vec4' ? 4 : 3;
    const mismatch = (): Error => new Error(`material graph: param ${name} type mismatch`);
    // a param no stage reads has no uniform: nothing draws it
    const uniform = uniformsOf(param(name) ?? '');
    const target: unknown = uniform?.value;
    let set: (value: GraphLiteral) => void;
    if (p.type === 'float') set = (value) => {
      if (typeof value !== 'number') throw mismatch();
      if (uniform !== undefined && uniform.value === value) return;
      inRange(name, value, p.min, p.max);
      if (uniform !== undefined) uniform.value = value;
    };
    else if (target instanceof THREE.Vector2 || target instanceof THREE.Vector3 || target instanceof THREE.Vector4) set = (value) => {
      if (typeof value === 'number' || value.length !== length) throw mismatch();
      let same = true;
      for (let i = 0; i < length; i++) if (target.getComponent(i) !== value[i]) { same = false; break; }
      if (same) return;
      for (const n of value) inRange(name, n, p.min, p.max);
      target.fromArray(value);
    };
    else set = (value) => {
      if (typeof value === 'number' || value.length !== length) throw mismatch();
      for (const n of value) inRange(name, n, p.min, p.max);
      if (target instanceof THREE.Color) target.setRGB(value[0] ?? 0, value[1] ?? 0, value[2] ?? 0, THREE.SRGBColorSpace);
    };
    setters.set(name, set);
    return set;
  };
  return {
    material, glsl, cost: glsl.cost, bindings: postFog === undefined ? glsl.bindings : [...glsl.bindings, ...postFog.glsl.bindings], selects: glsl.program?.selects ?? { light: 0, branch: 0 }, outline, depth,
    fog: fogOwn === null ? null : { glsl, uniforms: fogOwn },
    setParam(name, value) {
      const set = setters.get(name) ?? setterOf(name);
      set(value);
    },
    setTexture(name, texture) {
      if ((ir.params?.[name] ?? postFog?.glsl.ir.params?.[name])?.role !== 'lent') throw new Error(`material graph: no sampled lent texture ${name}`);
      const sampler = ownUniforms.find(u => u.from === 'texture' && u.param === name);
      if (sampler?.type === 'sampler2DArray' && !(texture instanceof THREE.DataArrayTexture) && !(texture instanceof THREE.CompressedArrayTexture)) throw new Error(`material graph: ${name} requires a 2D texture array`);
      if (sampler?.type === 'sampler3D' && !(texture instanceof THREE.Data3DTexture)) throw new Error(`material graph: ${name} requires a 3D texture`);
      const uniform = sampler === undefined ? undefined : uniformsOf(sampler.name);
      if (uniform !== undefined) uniform.value = texture;
    },
    setArrayParam(name, value) {
      const row = ir.arrays?.[name] ?? postFog?.glsl.ir.arrays?.[name], uniform = uniformsOf(param(name) ?? '');
      if (row === undefined || value.length !== row.value.length) throw new Error(`material graph: uniform list ${name} has fixed capacity`);
      const width = row.type === 'float' ? 1 : row.type === 'vec2' ? 2 : row.type === 'vec3' ? 3 : 4;
      for (const v of value) if ((typeof v === 'number' ? width !== 1 : v.length !== width) || !(typeof v === 'number' ? [v] : v).every(Number.isFinite)) throw new Error(`material graph: array element must be a finite ${row.type}`);
      if (uniform === undefined) return;
      const flat: unknown = uniform.value;
      if (!(flat instanceof Float32Array)) return;
      value.forEach((v, i) => { if (typeof v === 'number') flat[i] = v; else flat.set(v, i * width); });
    },
  };
}
/** a fog graph's carrier: never drawn, it keeps `setParam` by catalogue id */
function carrier(): GraphShaderMaterial {
  const m = new GraphShaderMaterial(); m.visible = false; m.userData['graphFog'] = true; m.name = 'graph:fog';
  return m;
}

/**
 * Add a compiled classic graph's outline (`ClassicGraph.outline`) to `mesh` as its second draw: a child mesh over a
 * shallow copy of its geometry (the same buffers), sharing an instanced mesh's matrices and following its count. The hull
 * casts and receives no shadow. Returns the child.
 */
export function attachClassicOutline(mesh: THREE.Mesh, outline: THREE.Material): THREE.Mesh {
  const source = mesh.geometry, geometry = new THREE.BufferGeometry();
  for (const [k, a] of Object.entries(source.attributes)) geometry.setAttribute(k, a);
  geometry.setIndex(source.index);
  for (const g of source.groups) geometry.addGroup(g.start, g.count, g.materialIndex);
  geometry.setDrawRange(source.drawRange.start, source.drawRange.count);
  let hull: THREE.Mesh;
  if (mesh instanceof THREE.InstancedMesh) {
    const instanced = new THREE.InstancedMesh(geometry, outline, 0);
    instanced.instanceMatrix = mesh.instanceMatrix; instanced.instanceColor = mesh.instanceColor; instanced.count = mesh.count;
    instanced.onBeforeRender = drawNeutral(() => { instanced.count = mesh.count; });
    hull = instanced;
  } else hull = new THREE.Mesh(geometry, outline);
  hull.name = `${mesh.name}:outline`; hull.castShadow = false; hull.receiveShadow = false;
  mesh.add(hull);
  return hull;
}
/** a displaced caster's shadow depth on `mesh` (`ClassicGraph.depth`): three draws its shadow with it */
export function attachClassicDepth(mesh: THREE.Mesh, depth: THREE.Material): void { mesh.customDepthMaterial = depth; }
