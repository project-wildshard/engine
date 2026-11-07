/**
 * The material graph's GLSL back-end (nine-fix NF13; engine-performance EP4, G935): `emitGraphGlsl(ir)` lowers a validated
 * graph IR (`@wildshard/format/materialGraph`) to classic GLSL ES 3.00 statements, the vocabulary the retired TSL
 * compiler (NF18) mapped to nodes, with its safety rules, so a graph draws as a plain `ShaderMaterial` with no node
 * runtime. Pure strings: no `three/webgpu` or `three/tsl` and no renderer; `glslProgram.ts` wraps the output in a
 * classic program.
 *
 * - **Validation first**, as the retired `compileGraph` did: an unknown op, a type mismatch, a cycle or an over-budget
 *   graph throws.
 * - **One temporary per node**, emitted lazily into the block that first needs it. A block's values are visible only
 *   inside it (GLSL scoping), so a node first built in one arm of a branch is built again where the other arm or a later
 *   read needs it, never read unassigned (D204 / NR16 by construction); the operands both arms share are hoisted above
 *   the branch as `compile.ts` hoists them. A loop body reads its outer nodes from the block the loop sits in.
 * - **Branch-light `select`** as `compile.ts`: `mix(else, then, float(cond))` unless a side costs more than
 *   `BRANCH_LIGHT_COST` and nothing else reads it, then a real `if / else` (a select whose both sides sample stays
 *   branch-free, so implicit derivatives stay coherent).
 * - **Safe maths:** a divisor that is not a non-zero literal is kept off zero; `pow`'s base is clamped at 0.
 * - **Constant-count loops** are a `for` with a literal bound.
 * - **The lighting stage** lowers to three functions the program's light model calls: `wsGraphSun(direction, colour,
 *   shadow)` (radiance in xyz, the specular factor in w), `wsGraphAmbient(irradiance, radiance, environmentIrradiance)`
 *   and `wsGraphGrade(litColour)`. Nodes that read none of the light inputs are built once in `main` and reach the
 *   functions as globals, so the light-free part of the sun term is shared between cascades, as in `compile.ts`.
 * - **A fog graph** lowers to `vec3 wsGraphFog(fogInput, engineFogged, positionWorld, cameraPosition, fogScale)`.
 * - **Host inputs** are fixed names the program provides (`glslProgram.ts`): the vertex prologue's `wsPositionLocal`,
 *   `wsNormalLocal`, `wsInstanceTransform()`, `wsInstanceColour()`, `wsVertexColour()`, `wsSkinDirection()`, `wsCameraNear()`,
 *   `wsFogColour()`, the frame camera `wsFrameCamera` / `wsFrameView`, the lighting globals `wsNormalView`, `wsViewDirection`, `wsAlbedo`,
 *   `wsRoughness`, and the vertex epilogue's `transformed`, `wsWorldPosition`, `mvPosition`. Every uniform it reads is
 *   listed in `uniforms` with what feeds it.
 *
 * Output is byte-stable: names follow the order the graph is walked, which follows the IR's own key order.
 */
import {
  GRAPH_OPS, MAX_GRAPH_BUDGET, SUN_OPS, validateGraph, type GraphCost, type GraphIr, type GraphLiteral, type GraphNode, type GraphRef, type GraphValidation,
  type GraphValidationOptions, type GraphValueType, type GraphBinding,
} from '@wildshard/format/materialGraph';
import { FRONT_LEN, FRONT_SPEED, FRONT2_LEN, WIND_DIR } from '../../world/wind';
import { sampleWindField, type WindFieldMath } from '../../../../shared/engine/world/windField';
import { GERSTNER_TERMS } from '../../../../shared/engine/world/waves';

/** a select side costing at most this many estimated instructions is evaluated unconditionally (as `compile.ts`) */
export const GLSL_BRANCH_LIGHT_COST = 16;
const DIV_EPSILON = '1e-6';

/** a uniform the emitted code reads, and what feeds it */
export type GraphGlslUniform =
  | { readonly name: string; readonly type: 'float' | 'vec2' | 'vec3' | 'vec4'; readonly from: 'param'; readonly param: string }
  | { readonly name: string; readonly type: 'float' | 'vec2' | 'vec3' | 'vec4'; readonly from: 'array'; readonly param: string; readonly length: number }
  | { readonly name: string; readonly type: 'sampler2D' | 'sampler2DArray' | 'sampler3D'; readonly from: 'texture'; readonly param: string }
  | { readonly name: string; readonly type: 'float' | 'vec2' | 'vec3' | 'vec4' | 'sampler2D'; readonly from: 'host'; readonly host: GraphGlslHostUniform }
  | { readonly name: string; readonly type: 'float' | 'vec2' | 'vec3' | 'vec4'; readonly from: 'toon'; readonly toon: string };
/** the uniforms a host program feeds (the engine's own clocks, lights and targets) */
export type GraphGlslHostUniform =
  | 'time' | 'windTime' | 'windGust' | 'fogZenithColour' | 'atmosphereSunDirection' | 'atmosphereSunColour'
  | 'skyLightDirection' | 'skyLightColour' | 'materialColour' | 'materialEmissive' | 'materialEmissiveIntensity' | 'screenSize' | 'codecStep' | 'codecOrigin'
  | 'scene' | 'depth' | 'normal' | 'depthNear' | 'depthFar' | 'weight' | 'meshMap' | 'bumpMap';

/** one stage's code: declarations at file scope, and statements inside `main` (the vertex stage's `end` runs after the transform) */
export interface GraphGlslStage { readonly head: string; readonly body: string; readonly end: string }
/** a lowered program's stage outputs: GLSL expressions valid after the stage's body, null when the graph leaves one out */
export interface GraphGlslOutputs {
  readonly offset: string | null; readonly position: string | null; readonly clip: string | null; readonly normal: string | null;
  readonly sunScale: string | null; readonly fogScale: string | null; readonly pointSize: string | null;
  readonly colour: string | null; readonly alpha: string | null; readonly targetAlpha: string | null; readonly emissive: string | null;
  readonly roughness: string | null; readonly metalness: string | null; readonly occlusion: string | null; readonly discard: string | null;
  readonly shadingNormal: string | null; readonly shadowOffset: string | null;
}
/** a lowered program (the material's main draw, or its outline hull) */
export interface GraphGlslProgram {
  readonly vertex: GraphGlslStage;
  readonly fragment: GraphGlslStage;
  readonly outputs: GraphGlslOutputs;
  /** which lighting functions the fragment head defines (null: none) */
  readonly lighting: { readonly sun: boolean; readonly specular: boolean; readonly ambient: boolean; readonly ownsEnvironment: boolean; readonly grade: boolean } | null;
  readonly selects: { readonly light: number; readonly branch: number };
}
/** Estimated graph-op work at its actual emitted location, per invocation.
 * Fixed-count loop bodies are multiplied. Conditional is the sum of all
 * emitted arms, not a measured branch frequency or a hardware instruction count.
 * Vertex work is per vertex; sun/ambient/grade/fog work is per function call. */
export interface GraphGlslExecutionWork {
  readonly unconditional: number;
  readonly conditional: number;
  readonly unconditionalLoops: number;
  readonly conditionalLoops: number;
}
export type GraphGlslExecutionCost = Readonly<Record<'vertex' | 'fragment' | 'sun' | 'ambient' | 'grade' | 'fog', GraphGlslExecutionWork>>;
/** a graph lowered to GLSL */
export interface GraphGlsl {
  readonly ir: GraphIr;
  readonly cost: GraphCost;
  /** Optional offline report. Reporting never changes shader text or admission. */
  readonly executionCost?: { readonly main: GraphGlslExecutionCost | null; readonly outline: GraphGlslExecutionCost | null; readonly fog: GraphGlslExecutionCost | null; readonly fogSample?: GraphGlslExecutionCost };
  readonly bindings: readonly { readonly param: string; readonly bind: GraphBinding }[];
  /** the material's draw, or a post graph's pass; null for a fog graph */
  readonly program: GraphGlslProgram | null;
  /** the outline stage's second draw */
  readonly outline: GraphGlslProgram | null;
  /** a fog graph's function (file scope: `vec3 wsGraphFog(...)`; its libraries are in `libraries`) */
  readonly fog: string | null;
  /** Optional colour/transmission function. Its w reads the admitted scalar directly, never two subtracted fog calls. */
  readonly fogSample?: string;
  /** One admitted post dependency, lowered once and called by fogSample nodes. */
  readonly postFog?: GraphGlsl;
  /** the shared GLSL libraries the code calls (MaterialX noise, three's hash), for the program to define once a stage */
  readonly libraries: readonly string[];
  readonly uniforms: readonly GraphGlslUniform[];
  /** the declared geometry attributes (`aSeed`), with the value a mesh without one reads */
  readonly attributes: readonly { readonly name: string; readonly type: Exclude<GraphValueType, 'bool'>; readonly default: readonly number[] | null }[];
}

/** what the emitter needs beyond the graph */
export interface EmitGraphGlslOptions extends GraphValidationOptions {
  /** the toon family's preset (`toonGraph`, a lit standard graph) for a `model: 'toon'` graph: its lighting stage lowers
   *  in place of the graph's own, its params read the family's uniforms (`famToon*`, by `toonParams`) */
  readonly toon?: { readonly preset: GraphIr; readonly params: Readonly<Record<string, { readonly uniform: string; readonly type: 'float' | 'vec2' | 'vec3' | 'vec4' }>> };
  /** the toon family's preset drops the environment's diffuse (families/toon.ts) */
  readonly replaceEnvironmentDiffuse?: boolean;
  /** the caller's own passing `validateGraph` of this very graph under these options */
  readonly validated?: Extract<GraphValidation, { ok: true }>;
  /** Offline compiler census only; no per-node report work on normal compilation. */
  readonly reportExecutionCost?: boolean;
}

/** one value: its IR type and a GLSL expression (an identifier, a literal or a parenthesised term) */
interface V { readonly t: GraphValueType; readonly e: string }
/** a block of statements; its values are visible to it and its children only */
interface Block { readonly lines: string[]; readonly memo: Map<string, V>; readonly parent: Block | null; readonly depth: number; readonly conditional: boolean; readonly iterations: number }
/** a scope of graph nodes: the graph's own, a loop body's, or the toon preset's */
interface Scope {
  readonly path: string;
  readonly nodes: Readonly<Record<string, GraphNode>>;
  readonly parent: Scope | null;
  /** a loop body: the block its loop sits in (the outer scope's nodes are built there) */
  readonly home: Block | null;
  readonly acc: V | null;
  readonly index: V | null;
  readonly types: ReadonlyMap<string, GraphValueType>;
  /** the toon preset's params, read from the family's uniforms */
  readonly params?: EmitGraphGlslOptions['toon'];
  /** values a scope's node takes without building it (the toon preset's roughness: the material's) */
  readonly seeds?: ReadonlyMap<string, V>;
}
/** where code runs: a stage's `main`, a lighting function, the fog function or a post pass */
type Ctx = 'vertex' | 'fragment' | 'sun' | 'ambient' | 'grade' | 'fog';
const LIGHT_CTX: ReadonlySet<Ctx> = new Set(['sun', 'ambient', 'grade']);

/** the ops a lighting function reads from its call (or the lighting globals): a node reading one is built inside it */
const LATE_OPS: ReadonlySet<string> = new Set([...SUN_OPS, 'irradiance', 'radiance', 'environmentIrradiance', 'environmentIrradianceAt', 'litColour', 'normalView', 'viewDirection', 'albedo']);
const SAMPLE_OPS: ReadonlySet<string> = new Set(['texture', 'texture3D', 'textureArray', 'textureLod', 'textureGrad', 'meshMap', 'sceneColour', 'sceneColourAt', 'sceneDepth', 'sceneNormal']);
/** the ops whose value reads the neighbouring pixels of its quad (a branch they move into may leave a neighbour out) */
const DERIVATIVE_OPS: ReadonlySet<string> = new Set(['dFdx', 'dFdy', 'fwidth']);
const LEN: Readonly<Record<GraphValueType, number>> = { float: 1, vec2: 2, vec3: 3, vec4: 4, bool: 1 };
const vecOf = (n: number): GraphValueType => (n <= 1 ? 'float' : n === 2 ? 'vec2' : n === 3 ? 'vec3' : 'vec4');
const widest = (vals: readonly V[]): GraphValueType => vals.reduce<GraphValueType>((t, v) => (LEN[v.t] > LEN[t] ? v.t : t), 'float');
/** a float literal GLSL reads as a float (always a point or an exponent; negatives parenthesised) */
export function glslFloat(n: number): string {
  const s = Number.isInteger(n) && Math.abs(n) < 1e21 ? `${String(n)}.0` : String(n);
  return n < 0 || Object.is(n, -0) ? `(${s === '-0.0' ? '0.0' : s})` : s;
}
const literal = (v: GraphLiteral): V => {
  if (typeof v === 'number') return { t: 'float', e: glslFloat(v) };
  const t = vecOf(v.length);
  return { t, e: `${t}(${v.map(glslFloat).join(', ')})` };
};
/** a value widened to `t` (a float broadcasts; a value of type t is itself) */
const widen = (v: V, t: GraphValueType): string => (v.t === t || t === 'float' || t === 'bool' ? v.e : `${t}(${v.e})`);
const asFloat = (v: V): string => (v.t === 'float' ? v.e : v.t === 'bool' ? `float(${v.e})` : `(${v.e}).x`);
/** an identifier fragment from an authored name: kept when plain (no double underscore), else dropped */
const plain = (name: string): string => (/^[A-Za-z][A-Za-z0-9]*(?:_[A-Za-z0-9]+)*$/.test(name) ? name : '');

/** the GLSL library a graph may call (MaterialX's perlin noise exactly as three's `mx_noise_float`; three's `hash`) */
const NOISE_GLSL = `float mx_select( bool b, float t, float f ) { return b ? t : f; }
float mx_negate_if( float val, bool b ) { return b ? - val : val; }
float mx_floorfrac( float x, out int i ) { i = int( floor( x ) ); return x - float( i ); }
float mx_bilerp( float v0, float v1, float v2, float v3, float s, float t ) { float s1 = 1.0 - s; return ( 1.0 - t ) * ( v0 * s1 + v1 * s ) + t * ( v2 * s1 + v3 * s ); }
float mx_trilerp( float v0, float v1, float v2, float v3, float v4, float v5, float v6, float v7, float s, float t, float r ) {
  float s1 = 1.0 - s; float t1 = 1.0 - t; float r1 = 1.0 - r;
  return r1 * ( t1 * ( v0 * s1 + v1 * s ) + t * ( v2 * s1 + v3 * s ) ) + r * ( t1 * ( v4 * s1 + v5 * s ) + t * ( v6 * s1 + v7 * s ) );
}
float mx_gradient_float( uint hash, float x, float y ) {
  uint h = hash & 7u; float u = mx_select( h < 4u, x, y ); float v = 2.0 * mx_select( h < 4u, y, x );
  return mx_negate_if( u, bool( h & 1u ) ) + mx_negate_if( v, bool( h & 2u ) );
}
float mx_gradient_float( uint hash, float x, float y, float z ) {
  uint h = hash & 15u; float u = mx_select( h < 8u, x, y ); float v = mx_select( h < 4u, y, mx_select( ( h == 12u ) || ( h == 14u ), x, z ) );
  return mx_negate_if( u, bool( h & 1u ) ) + mx_negate_if( v, bool( h & 2u ) );
}
uint mx_rotl32( uint x, int k ) { return ( x << k ) | ( x >> ( 32 - k ) ); }
uint mx_bjfinal( uint a, uint b, uint c ) {
  c ^= b; c -= mx_rotl32( b, 14 ); a ^= c; a -= mx_rotl32( c, 11 ); b ^= a; b -= mx_rotl32( a, 25 ); c ^= b; c -= mx_rotl32( b, 16 );
  a ^= c; a -= mx_rotl32( c, 4 ); b ^= a; b -= mx_rotl32( a, 14 ); c ^= b; c -= mx_rotl32( b, 24 ); return c;
}
uint mx_hash_int( int x, int y ) { uint a = 0xdeadbeefu + ( 2u << 2u ) + 13u; uint b = a; uint c = a; a += uint( x ); b += uint( y ); return mx_bjfinal( a, b, c ); }
uint mx_hash_int( int x, int y, int z ) { uint a = 0xdeadbeefu + ( 3u << 2u ) + 13u; uint b = a; uint c = a; a += uint( x ); b += uint( y ); c += uint( z ); return mx_bjfinal( a, b, c ); }
float mx_fade( float t ) { return t * t * t * ( t * ( t * 6.0 - 15.0 ) + 10.0 ); }
float mx_perlin_noise_float( vec2 p ) {
  int X; int Y; float fx = mx_floorfrac( p.x, X ); float fy = mx_floorfrac( p.y, Y ); float u = mx_fade( fx ); float v = mx_fade( fy );
  float result = mx_bilerp( mx_gradient_float( mx_hash_int( X, Y ), fx, fy ), mx_gradient_float( mx_hash_int( X + 1, Y ), fx - 1.0, fy ),
    mx_gradient_float( mx_hash_int( X, Y + 1 ), fx, fy - 1.0 ), mx_gradient_float( mx_hash_int( X + 1, Y + 1 ), fx - 1.0, fy - 1.0 ), u, v );
  return 0.6616 * result;
}
float mx_perlin_noise_float( vec3 p ) {
  int X; int Y; int Z; float fx = mx_floorfrac( p.x, X ); float fy = mx_floorfrac( p.y, Y ); float fz = mx_floorfrac( p.z, Z );
  float u = mx_fade( fx ); float v = mx_fade( fy ); float w = mx_fade( fz );
  float result = mx_trilerp( mx_gradient_float( mx_hash_int( X, Y, Z ), fx, fy, fz ), mx_gradient_float( mx_hash_int( X + 1, Y, Z ), fx - 1.0, fy, fz ),
    mx_gradient_float( mx_hash_int( X, Y + 1, Z ), fx, fy - 1.0, fz ), mx_gradient_float( mx_hash_int( X + 1, Y + 1, Z ), fx - 1.0, fy - 1.0, fz ),
    mx_gradient_float( mx_hash_int( X, Y, Z + 1 ), fx, fy, fz - 1.0 ), mx_gradient_float( mx_hash_int( X + 1, Y, Z + 1 ), fx - 1.0, fy, fz - 1.0 ),
    mx_gradient_float( mx_hash_int( X, Y + 1, Z + 1 ), fx, fy - 1.0, fz - 1.0 ), mx_gradient_float( mx_hash_int( X + 1, Y + 1, Z + 1 ), fx - 1.0, fy - 1.0, fz - 1.0 ), u, v, w );
  return 0.9820 * result;
}`;
const HASH_GLSL = `float wsHash( uint seed ) {
  uint state = seed * 747796405u + 2891336453u;
  uint word = ( ( state >> ( ( state >> 28u ) + 4u ) ) ^ state ) * 277803737u;
  return float( ( word >> 22u ) ^ word ) * ${glslFloat(1 / 2 ** 32)};
}`;

/** the wind field's maths over GLSL expressions (`windField.ts`, the same terms the CPU and TSL samplers run) */
const windGlsl: WindFieldMath<string> = {
  constant: glslFloat, add: (a, b) => `(${a} + ${b})`, sub: (a, b) => `(${a} - ${b})`, mul: (a, b) => `(${a} * ${b})`, div: (a, b) => `(${a} / ${b})`,
  sin: x => `sin(${x})`, cos: x => `cos(${x})`, fract: x => `fract(${x})`,
};

/**
 * Lower a graph to GLSL. Throws (with every reason) when validation refuses it, and on a graph the classic back-end
 * cannot carry (a varying inside a loop body).
 */
export function emitGraphGlsl(input: unknown, opts: EmitGraphGlslOptions = {}): GraphGlsl {
  if (opts.validated !== undefined && opts.validated.graph !== input) throw new Error('material graph: a validation of another graph');
  const checked = opts.validated ?? validateGraph(input, opts);
  if (!checked.ok) throw new Error(`material graph refused:\n  ${checked.errors.join('\n  ')}`);
  const ir = checked.graph, rootTypes = checked.types, cost = checked.cost;
  const { validated: _validated, ...dependencyOpts } = opts; void _validated;
  const postFog = ir.postFog === undefined ? undefined : emitGraphGlsl(ir.postFog.graph, dependencyOpts);
  if (postFog !== undefined && postFog.fogSample === undefined) throw new Error('material graph: post fog needs explicit transmission');
  if (ir.model === 'toon' && opts.toon === undefined) throw new Error('material graph: a toon graph needs the family preset ({ toon })');
  const uniforms = new Map<string, GraphGlslUniform>();
  const uniform = (u: GraphGlslUniform): string => { if (!uniforms.has(u.name)) uniforms.set(u.name, u); return u.name; };
  const host = (h: GraphGlslHostUniform, type: Extract<GraphGlslUniform, { from: 'host' }>['type']): string => uniform({ name: `ws${h[0]?.toUpperCase() ?? ''}${h.slice(1)}`, type, from: 'host', host: h });
  const paramUniforms = new Map<string, string>(), paramIndex = new Map(Object.keys(ir.params ?? {}).map((name, i) => [name, i]));
  // a fog graph's own uniforms are namespaced (`wsFogP_…`): every material selecting it declares them beside its own
  const space = ir.kind === 'fog' ? 'Fog' : '';
  const paramName = (prefix: string, name: string): string => `ws${space}${prefix.slice(2)}${plain(name) === '' ? String(paramIndex.get(name) ?? 0) : `_${name}`}`;
  for (const [name, p] of Object.entries(ir.params ?? {})) if (p.type !== 'texture') paramUniforms.set(name, paramName('wsP', name));
  const bindings = Object.entries(ir.params ?? {}).flatMap(([param, p]) => (p.bind === undefined ? [] : [{ param, bind: p.bind }]));
  const attributes = new Map<string, { name: string; type: Exclude<GraphValueType, 'bool'>; default: readonly number[] | null }>();
  const libraries = new Set<'noise' | 'hash'>();
  let serial = 0;
  const temp = (id: string): string => `t${String(serial++)}${plain(id) === '' ? '' : `_${id}`}`;

  const lateMemo = new WeakMap<Readonly<Record<string, GraphNode>>, Map<string, boolean>>();
  /** the scopes' seeded nodes (the toon preset's roughness: the material's, set just before lighting), late as they are */
  const lateSeeds = new WeakMap<Readonly<Record<string, GraphNode>>, ReadonlySet<string>>();
  /** whether a root node of `nodes` reads a late (lighting-call) input, through its inputs or a loop body */
  function late(nodes: Readonly<Record<string, GraphNode>>, id: string): boolean {
    let memo = lateMemo.get(nodes);
    if (memo === undefined) { memo = new Map(); lateMemo.set(nodes, memo); }
    if (lateSeeds.get(nodes)?.has(id) === true) return true;
    const known = memo.get(id);
    if (known !== undefined) return known;
    memo.set(id, false);
    type Chain = readonly Readonly<Record<string, GraphNode>>[];
    function reads(chain: Chain, n: GraphNode): boolean {
      if (LATE_OPS.has(n.op) || (n.in ?? []).some(r => refReads(chain, r))) return true;
      const body = n.body;
      if (body === undefined) return false;
      const inner = [...chain, body.nodes];
      return Object.values(body.nodes).some(b => reads(inner, b)) || refReads(inner, body.out);
    }
    function refReads(chain: Chain, r: GraphRef | undefined): boolean {
      if (typeof r !== 'string') return false;
      for (let i = chain.length - 1; i >= 0; i--) {
        const hit = chain[i]?.[r];
        if (hit !== undefined) return i === 0 ? late(nodes, r) : reads(chain.slice(0, i + 1), hit);
      }
      return false;
    }
    const n = nodes[id];
    const v = n !== undefined && reads([nodes], n);
    memo.set(id, v);
    return v;
  }

  /** one program's emission (the main draw or the outline), sharing the graph's uniforms and attributes */
  function emitProgram(which: 'main' | 'outline' | 'fog' | 'fogSample'): { program: GraphGlslProgram; fogFunction: string | null; fogSample: string | null; execution: GraphGlslExecutionCost | null } {
    const work = (): { -readonly [K in keyof GraphGlslExecutionWork]: GraphGlslExecutionWork[K] } => ({ unconditional: 0, conditional: 0, unconditionalLoops: 0, conditionalLoops: 0 });
    const execution = opts.reportExecutionCost === true ? { vertex: work(), fragment: work(), sun: work(), ambient: work(), grade: work(), fog: work() } : null;
    const block = (parent: Block | null, conditional = parent?.conditional ?? false, iterations = parent?.iterations ?? 1): Block => ({ lines: [], memo: new Map(), parent, depth: parent === null ? 1 : parent.depth + 1, conditional, iterations });
    const vertexRoot = block(null), fragmentRoot = block(null);
    const vertexStart: string[] = [], vertexEnd: string[] = [];
    const varyings: string[] = [];
    const autoVaryings = new Map<string, V>();
    const globals: string[] = [], exports = new Map<string, V>();
    const functions: string[] = [];
    const selects = { light: 0, branch: 0 };
    /** the toon preset's scope (its own types), or null */
    const toonScope = ((): Scope | null => {
      const toon = opts.toon;
      if (ir.model !== 'toon' || toon === undefined) return null;
      const presetCheck = validateGraph(toon.preset, { budget: MAX_GRAPH_BUDGET });
      if (!presetCheck.ok) throw new Error(`material graph: the toon preset is refused:\n  ${presetCheck.errors.join('\n  ')}`);
      // the preset's gloss gate (`rough` < `gloss`) reads 0 on the node path, where `rough` inside the sun hook's layout
      // function is not the material's: every toon surface takes the sun's specular there, and the shipped look is that.
      // The classic program follows it (with the material's roughness, Driftwood's rough decks and sea lost their glint)
      const types = presetCheck.types, seeds = new Map<string, V>([['rough', { t: 'float', e: '0.0' }]]);
      lateSeeds.set(toon.preset.nodes, new Set(seeds.keys()));
      return { path: 'toon:nodes', nodes: toon.preset.nodes, parent: null, home: null, acc: null, index: null, types, params: toon,
        seeds };
    })();
    const root: Scope = { path: 'nodes', nodes: ir.nodes, parent: null, home: null, acc: null, index: null, types: rootTypes };

    const emit = (b: Block, line: string): void => { b.lines.push(`${'  '.repeat(b.depth)}${line}`); };
    const bind = (b: Block, id: string, t: GraphValueType, e: string): V => { const name = temp(id); emit(b, `${t} ${name} = ${e};`); return { t, e: name }; };
    const find = (memoKey: string, b: Block): V | undefined => { for (let at: Block | null = b; at !== null; at = at.parent) { const hit = at.memo.get(memoKey); if (hit !== undefined) return hit; } return undefined; };
    /** a vertex value carried to the fragment: assigned at the top of the vertex body (`start`) or after the transform (`end`) */
    const fromVertex = (key: string, t: GraphValueType, expr: () => string, phase: 'start' | 'end', flat = false): V => {
      const known = autoVaryings.get(key);
      if (known !== undefined) return known;
      const name = `wsV${key}`;
      varyings.push(`${flat ? 'flat ' : ''}varying ${t} ${name};`);
      (phase === 'start' ? vertexStart : vertexEnd).push(`  ${name} = ${expr()};`);
      const v = { t, e: name };
      autoVaryings.set(key, v);
      return v;
    };
    // a value's type without building it (a select decides its form before either side is built): validation's own for a
    // root node, the validator's rules for a loop body's
    const bodyTypes = new Map<string, GraphValueType>();
    function typeOfRef(r: GraphRef, scope: Scope): GraphValueType {
      if (typeof r !== 'string') return literal(r).t;
      let s: Scope | null = scope;
      while (s !== null && !Object.hasOwn(s.nodes, r)) s = s.parent;
      const n = s?.nodes[r];
      if (s === null || n === undefined) throw new Error(`material graph: unknown node ${r}`);
      if (s.parent === null) { const t = s.types.get(r); if (t !== undefined) return t; }
      const key = `${s.path}/${r}`, known = bodyTypes.get(key);
      if (known !== undefined) return known;
      const t = inferType(n, s);
      bodyTypes.set(key, t);
      return t;
    }
    function inferType(n: GraphNode, scope: Scope): GraphValueType {
      const spec = GRAPH_OPS[n.op];
      if (spec === undefined) throw new Error(`material graph: unknown op ${n.op}`);
      const ins = (): GraphValueType[] => (n.in ?? []).map(r => typeOfRef(r, scope));
      const first = (): GraphValueType => ins()[0] ?? 'float';
      switch (spec.rule) {
        case 'const': return literal(n.value ?? 0).t;
        case 'param': {
          const own = n.param === undefined ? undefined : scope.params?.params[n.param];
          if (own !== undefined) return own.type;
          const p = n.param === undefined ? undefined : ir.params?.[n.param];
          return p === undefined || p.type === 'texture' ? 'float' : p.type === 'colour' ? 'vec3' : p.type;
        }
        case 'arrayElement': return (n.param === undefined ? undefined : ir.arrays?.[n.param]?.type) ?? 'float';
        case 'same': case 'mix': return vecOf(Math.max(...ins().slice(0, n.op === 'mix' ? 2 : undefined).map(t => LEN[t])));
        case 'unary': case 'vecUnary': case 'varying': return first();
        case 'length': case 'dot': case 'windField': case 'noise': case 'index': return 'float';
        case 'compare': case 'logic': case 'not': return 'bool';
        case 'cross': case 'gerstner': case 'dir3': return 'vec3';
        case 'select': { const [, x = 'float', y = 'float'] = ins(); return x === 'bool' && y === 'bool' ? 'bool' : vecOf(Math.max(LEN[x], LEN[y])); }
        case 'swizzle': return vecOf((n.mask ?? 'x').length);
        case 'combine': return vecOf(ins().reduce((sum, t) => sum + LEN[t], 0));
        case 'texture': case 'fogSample': return 'vec4';
        case 'loop': return typeOfRef(n.in?.[0] ?? 0, scope);
        case 'acc': return scope.acc?.t ?? 'float';
        case 'attribute': return n.type ?? 'float';
        case 'input': case 'cameraBillboard': case 'instanceTransform': case 'point3': case 'pointPair': case 'sceneTap': return spec.type ?? 'float';
        default: throw new Error(`material graph: no type rule for ${n.op}`);
      }
    }

    // how many places read each node of a scope (a select side read elsewhere costs a branch nothing)
    const readersOf = new WeakMap<Readonly<Record<string, GraphNode>>, ReadonlyMap<string, number>>();
    const readers = (scope: Scope): ReadonlyMap<string, number> => {
      let known = readersOf.get(scope.nodes);
      if (known !== undefined) return known;
      const counts = new Map<string, number>();
      const count = (r: GraphRef | undefined): void => { if (typeof r === 'string') counts.set(r, (counts.get(r) ?? 0) + 1); };
      for (const n of Object.values(scope.nodes)) for (const r of n.in ?? []) count(r);
      if (scope.nodes === ir.nodes) {
        const st = ir.stages;
        for (const r of [st['vertex.offset']?.offset, st['vertex.position']?.position, st.points?.size, st.post?.colour, st.post?.alpha, st.fog?.colour,
          st.surface?.colour, st.surface?.alpha, st.surface?.targetAlpha, st.surface?.emissive, st.surface?.roughness, st.surface?.metalness,
          st.surface?.occlusion, st.surface?.normal, st.lighting?.sun, st.lighting?.sunSpecular, st.lighting?.ambient, st.lighting?.grade]) count(r);
      }
      known = counts; readersOf.set(scope.nodes, known);
      return known;
    };
    // A named call can feed multiple fields inside one select arm. Retain its
    // full cost through that private DAG; branchShared still hoists a genuine
    // outside reader. Existing graphs keep their original branch policy.
    const callReach = postFog === undefined ? undefined : new WeakMap<Scope, Map<string, boolean>>();
    function callsPostFog(r: GraphRef, scope: Scope): boolean {
      if (typeof r !== 'string' || callReach === undefined) return false;
      let found: Scope | null = scope;
      while (found !== null && !Object.hasOwn(found.nodes, r)) found = found.parent;
      if (found === null) return false;
      const own = found, node = own.nodes[r]; if (node === undefined) return false;
      let memo = callReach.get(own);
      if (memo === undefined) { memo = new Map(); callReach.set(own, memo); }
      const known = memo.get(r); if (known !== undefined) return known;
      memo.set(r, false);
      const body = node.body;
      const result = node.op === 'fogSample' || (node.in ?? []).some(argument => callsPostFog(argument, own))
        || (body !== undefined && callsPostFog(body.out, { ...own, path: `${own.path}.${r}.body`, nodes: body.nodes, parent: own, home: null }));
      memo.set(r, result); return result;
    }
    /** the instructions only this side of a select would run (`compile.ts`'s ownCost) */
    const ownCost = (r: GraphRef | undefined, scope: Scope, seen = new Set<string>()): number => {
      if (typeof r !== 'string' || seen.has(r) || ((readers(scope).get(r) ?? 0) > 1 && (postFog === undefined || !callsPostFog(r, scope)))) return 0;
      seen.add(r);
      const n = scope.nodes[r];
      if (n === undefined) return 0;
      const spec = GRAPH_OPS[n.op];
      let body = n.op === 'loop' && n.body !== undefined ? Object.keys(n.body.nodes).length * (n.count ?? 1) * 2 : 0;
      if (postFog !== undefined && n.op === 'loop' && n.body !== undefined
        && callsPostFog(n.body.out, { ...scope, path: `${scope.path}.${r}.body`, nodes: n.body.nodes, parent: scope, home: null })) {
        body += postFog.cost.instructions * (n.count ?? 1);
      }
      return (spec?.cost ?? 0) + (n.op === 'fogSample' ? postFog?.cost.instructions ?? 0 : 0) + body + (n.in ?? []).reduce<number>((sum, x) => sum + ownCost(x, scope, seen), 0);
    };
    /** whether a reference samples a texture (implicit derivatives), through its inputs and a loop's output */
    const samples = (r: GraphRef | undefined, scope: Scope, seen = new Set<GraphNode>()): boolean => {
      if (typeof r !== 'string') return false;
      for (let s: Scope | null = scope; s !== null; s = s.parent) {
        const node = s.nodes[r];
        if (node === undefined) continue;
        if (seen.has(node)) return false;
        seen.add(node);
        if (SAMPLE_OPS.has(node.op) || (node.op === 'fogSample' && (postFog?.cost.samplers ?? 0) > 0)) return true;
        const inner = s;
        if ((node.in ?? []).some(argument => samples(argument, inner, seen))) return true;
        if (node.body !== undefined) return samples(node.body.out, { ...inner, path: `${inner.path}.${r}.body`, nodes: node.body.nodes, parent: inner, home: null }, seen);
        return false;
      }
      return false;
    };
    /** every node `from` reads in `scope`, itself included (a varying ends the walk: its input is the vertex stage's) */
    const reach = (scope: Scope, from: readonly (GraphRef | undefined)[]): Set<string> => {
      const out = new Set<string>(), stack = [...from];
      while (stack.length > 0) {
        const r = stack.pop();
        if (typeof r !== 'string' || out.has(r)) continue;
        const node = scope.nodes[r]; if (node === undefined) continue;
        out.add(r); if (node.op !== 'varying') stack.push(...(node.in ?? []));
      }
      return out;
    };
    /** the operands a branched select's arms (and its group's: `sameCondition`) share, or that something outside them
     *  reads: built before the branch. A derivative or a sample two members read stays before it, as one select's did */
    const branchShared = (members: readonly (readonly [string, GraphNode])[], scope: Scope): string[] => {
      const back = new Map<string, string[]>();
      for (const [id, node] of Object.entries(scope.nodes)) for (const r of node.in ?? []) if (typeof r === 'string') back.set(r, [...(back.get(r) ?? []), id]);
      const own = members.map(([, m]) => reach(scope, [m.in?.[1], m.in?.[2]])), ids = new Set(members.map(([id]) => id));
      const x = reach(scope, members.map(([, m]) => m.in?.[1])), y = reach(scope, members.map(([, m]) => m.in?.[2])), arms = new Set([...x, ...y]), uses = readers(scope);
      const frontier = [...arms].filter(k => {
        const node = scope.nodes[k]; if (node === undefined || node.op === 'varying' || (node.in ?? []).length === 0) return false;
        if (x.has(k) && y.has(k)) return true;
        if (members.length > 1 && (DERIVATIVE_OPS.has(node.op) || (SAMPLE_OPS.has(node.op) && own.filter(set => set.has(k)).length > 1))) return true;
        const inside = (back.get(k) ?? []).filter(reader => ids.has(reader) || arms.has(reader)).length;
        return (uses.get(k) ?? 0) > inside;
      });
      const below = reach(scope, frontier.flatMap(k => scope.nodes[k]?.in ?? []));
      return frontier.filter(k => !below.has(k));
    };
    /** the estimated instructions a group's branch would hold: its arms' nodes that nothing outside the group reads */
    const groupCost = (members: readonly (readonly [string, GraphNode])[], scope: Scope): number => {
      const arms = reach(scope, members.flatMap(([, m]) => [m.in?.[1], m.in?.[2]])), hoisted = reach(scope, branchShared(members, scope));
      let inside = 0;
      for (const k of arms) {
        const node = scope.nodes[k]; if (node === undefined || hoisted.has(k)) continue;
        inside += (GRAPH_OPS[node.op]?.cost ?? 0) + (node.op === 'loop' && node.body !== undefined ? Object.keys(node.body.nodes).length * (node.count ?? 1) * 2 : 0);
      }
      return inside;
    };
    /** G5: the other selects of the fragment root on the same condition node, emitted in one branch with `n` so a cone only
     *  they read stays inside it (a kit kind's cell read by its colour, emit and glass selects hoisted over every pixel). Not
     *  one already built, one whose sides both sample, or one with a path to or from another member (it is built first) */
    const sameCondition = (n: GraphNode, self: string, scope: Scope, b: Block): (readonly [string, GraphNode])[] => {
      const cond = n.in?.[0];
      if (typeof cond !== 'string') return [];
      // a late select (it reads the lighting calls' results) never groups: building a lighting call inside a branch writes
      // its exported globals into the root while the branch is open, so pixels outside it would read them unassigned
      if (late(scope.nodes, self)) return [];
      const candidates = Object.entries(scope.nodes).filter(([id, m]) => id !== self && m.op === 'select' && m.in?.[0] === cond
        && !late(scope.nodes, id)
        && find(`${scope.path}/${id}`, b) === undefined && !(samples(m.in?.[1], scope) && samples(m.in?.[2], scope))
        && typeOfRef(m.in?.[1] ?? 0, scope) !== 'bool' && typeOfRef(m.in?.[2] ?? 0, scope) !== 'bool');
      const reaches = new Map<string, Set<string>>([[self, reach(scope, [n.in?.[1], n.in?.[2]])], ...candidates.map(([id, m]) => [id, reach(scope, [m.in?.[1], m.in?.[2]])] as const)]);
      let members: (readonly [string, GraphNode])[] = candidates;
      for (;;) {
        const all = [self, ...members.map(([id]) => id)];
        const next = members.filter(([id]) => all.every(other => other === id || (!(reaches.get(id)?.has(other) ?? false) && !(reaches.get(other)?.has(id) ?? false))));
        if (next.length === members.length) break;
        members = next;
      }
      // only a select that shares an operand with the group joins it (one with nothing in common keeps its own policy)
      const shared = new Set(reaches.get(self)), joined: (readonly [string, GraphNode])[] = [];
      for (let grew = true; grew;) {
        grew = false;
        for (const member of members) {
          const own = reaches.get(member[0]);
          if (joined.includes(member) || own === undefined || ![...own].some(k => shared.has(k))) continue;
          joined.push(member); for (const k of own) shared.add(k); grew = true;
        }
      }
      return joined;
    };

    function ref(r: GraphRef, scope: Scope, b: Block, ctx: Ctx): V {
      if (typeof r !== 'string') return literal(r);
      let s: Scope | null = scope, child: Scope | null = null;
      while (s !== null && !Object.hasOwn(s.nodes, r)) { child = s; s = s.parent; }
      if (s === null) throw new Error(`material graph: unknown node ${r}`);
      const seeded = LIGHT_CTX.has(ctx) ? s.seeds?.get(r) : undefined;
      if (seeded !== undefined) return seeded;
      const key = `${s.path}/${r}`;
      // a light-free root node read by a lighting function: built once in main, read through a global
      if (LIGHT_CTX.has(ctx) && s.parent === null && !late(s.nodes, r)) {
        const known = exports.get(key);
        if (known !== undefined) return known;
        const v = ref(r, s, fragmentRoot, 'fragment');
        const name = `wsG${String(exports.size)}`;
        globals.push(`${v.t} ${name};`);
        emit(fragmentRoot, `${name} = ${v.e};`);
        const g = { t: v.t, e: name };
        exports.set(key, g);
        return g;
      }
      const target = child === null ? b : child.home ?? b;
      const hit = find(key, target);
      if (hit !== undefined) return hit;
      const node = s.nodes[r];
      if (node === undefined) throw new Error(`material graph: unknown node ${r}`);
      const v = build(node, r, s, target, ctx);
      if (execution !== null) {
        const spec = GRAPH_OPS[node.op], tally = execution[ctx];
        const lanes = spec?.rule === 'same' || spec?.rule === 'unary' ? LEN[v.t] : 1;
        tally[target.conditional ? 'conditional' : 'unconditional'] += (spec?.cost ?? 0) * lanes * target.iterations;
        if (node.op === 'loop') tally[target.conditional ? 'conditionalLoops' : 'unconditionalLoops']++;
        if (node.op === 'fogSample') {
          const called = postFog?.executionCost?.fogSample?.fog;
          if (called === undefined) throw new Error('material graph: missing post fog execution report');
          tally[target.conditional ? 'conditional' : 'unconditional'] += called.unconditional * target.iterations;
          tally.conditional += called.conditional * target.iterations;
          tally[target.conditional ? 'conditionalLoops' : 'unconditionalLoops'] += called.unconditionalLoops;
          tally.conditionalLoops += called.conditionalLoops;
        }
      }
      target.memo.set(key, v);
      return v;
    }

    /** a node's value, its statements emitted into `b` */
    function build(n: GraphNode, id: string, scope: Scope, b: Block, ctx: Ctx): V {
      if (n.op === 'select') return select(n, id, scope, b, ctx);
      if (n.op === 'loop') return loop(n, id, scope, b, ctx);
      if (n.op === 'varying') {
        if (ctx === 'vertex') throw new Error('material graph: a varying read in the vertex stage');
        if (scope.parent !== null) throw new Error('material graph: a varying inside a loop body (the classic back-end carries root varyings only)');
        const v = ref(n.in?.[0] ?? 0, scope, vertexRoot, 'vertex');
        const name = `wsV${String(varyings.length)}${plain(id) === '' ? '' : `_${id}`}`;
        varyings.push(`${n.interpolation === 'flat' ? 'flat ' : ''}varying ${v.t} ${name};`);
        emit(vertexRoot, `${name} = ${v.e};`);
        return { t: v.t, e: name };
      }
      const ins = (n.in ?? []).map(r => ref(r, scope, b, ctx));
      const [a, c1, c2] = ins;
      const one = (): V => { if (a === undefined) throw new Error(`material graph: ${n.op} lacks an input`); return a; };
      const two = (): [V, V] => { if (a === undefined || c1 === undefined) throw new Error(`material graph: ${n.op} lacks inputs`); return [a, c1]; };
      const three = (): [V, V, V] => { if (a === undefined || c1 === undefined || c2 === undefined) throw new Error(`material graph: ${n.op} lacks inputs`); return [a, c1, c2]; };
      const out = (t: GraphValueType, e: string): V => bind(b, id, t, e);
      if (n.op === 'fogSample') {
        if (postFog === undefined || n.name !== ir.postFog?.name) throw new Error('material graph: missing named post fog');
        return out('vec4', `wsGraphFogSample(${ins.map((value, index) => index === 4 ? asFloat(value) : widen(value, 'vec3')).join(', ')})`);
      }
      const same = (f: (...xs: string[]) => string, vals: readonly V[]): V => { const t = widest(vals); return out(t, f(...vals.map(v => widen(v, t)))); };
      /** a divisor kept off zero unless a non-zero literal: y + step(|y|, ε)·ε */
      const divisor = (y: V, t: GraphValueType, raw: GraphRef | undefined): string => {
        const nonZero = typeof raw === 'number' ? raw !== 0 : Array.isArray(raw) && raw.every(x => x !== 0);
        const w = widen(y, t);
        return nonZero ? w : `(${w} + step(abs(${w}), ${t === 'float' ? DIV_EPSILON : `${t}(${DIV_EPSILON})`}) * ${DIV_EPSILON})`;
      };
      const vertexOnly = ctx === 'vertex';
      const fragmentUv = (): V => fromVertex('Uv', 'vec2', () => 'uv', 'start');
      const sample = (sampler: string, at: string): string => (vertexOnly ? `textureLod(${sampler}, ${at}, 0.0)` : `texture(${sampler}, ${at})`);
      const textureUniform = (param: string | undefined, type: 'sampler2D' | 'sampler2DArray' | 'sampler3D'): string => {
        if (param === undefined) throw new Error(`material graph: ${n.op} names no texture param`);
        return uniform({ name: paramName(type === 'sampler2D' ? 'wsT' : type === 'sampler2DArray' ? 'wsTA' : 'wsT3', param), type, from: 'texture', param });
      };
      switch (n.op) {
        // inputs
        case 'windTime': return { t: 'float', e: host('windTime', 'float') };
        case 'windGust': return { t: 'float', e: host('windGust', 'float') };
        case 'windDirection': return literal([WIND_DIR.x, WIND_DIR.z]);
        case 'windGustAt': {
          const p = one(), at = p.t === 'vec2' && /^[A-Za-z_]\w*$/.test(p.e) ? p : bind(b, id, 'vec2', p.e);
          return out('float', sampleWindField(windGlsl, `${at.e}.x`, `${at.e}.y`, host('windTime', 'float'), host('windGust', 'float'),
            { x: WIND_DIR.x, z: WIND_DIR.z, frontLength: FRONT_LEN, frontSpeed: FRONT_SPEED, secondaryLength: FRONT2_LEN }));
        }
        case 'frontFacing': return { t: 'bool', e: 'gl_FrontFacing' };
        case 'uv': return vertexOnly ? { t: 'vec2', e: 'uv' } : fragmentUv();
        case 'positionLocal': {
          const step = host('codecStep', 'float'), origin = host('codecOrigin', 'vec3');
          return vertexOnly ? { t: 'vec3', e: `(wsPositionLocal * ${step} + ${origin})` }
            : fromVertex('PositionLocal', 'vec3', () => `transformed * ${step} + ${origin}`, 'end');
        }
        case 'positionGeometry': return { t: 'vec3', e: `(position * ${host('codecStep', 'float')} + ${host('codecOrigin', 'vec3')})` };
        case 'instanceTransform': return out('vec4', `wsInstanceTransform(${widen(one(), 'vec4')})`);
        case 'objectOrigin': return out('vec3', '(modelMatrix * wsInstanceTransform(vec4(0.0, 0.0, 0.0, 1.0))).xyz');
        case 'positionWorld':
          if (ctx === 'fog') return { t: 'vec3', e: 'wsFogPosition' };
          return vertexOnly ? out('vec3', '(modelMatrix * vec4(wsPositionLocal, 1.0)).xyz') : fromVertex('PositionWorld', 'vec3', () => 'wsWorldPosition.xyz', 'end');
        case 'fogInput': if (ctx === 'fog') return { t: 'vec3', e: 'wsFogInput' }; break;
        case 'engineFogged': if (ctx === 'fog') return { t: 'vec3', e: 'wsEngineFogged' }; break;
        case 'fogScale': if (ctx === 'fog') return { t: 'float', e: 'wsFogScaleIn' }; break;
        case 'positionView': return vertexOnly ? out('vec3', '(modelViewMatrix * vec4(wsPositionLocal, 1.0)).xyz') : fromVertex('PositionView', 'vec3', () => 'mvPosition.xyz', 'end');
        case 'normalLocal': return vertexOnly ? { t: 'vec3', e: 'wsNormalLocal' } : fromVertex('NormalLocal', 'vec3', () => 'wsNormalLocal', 'end');
        case 'normalWorld': {
          const world = 'normalize((vec4(normalize(normalMatrix * wsNormalLocal), 0.0) * viewMatrix).xyz)';
          if (vertexOnly) return out('vec3', world);
          const varied = fromVertex('NormalWorld', 'vec3', () => world, 'end'), view = fromVertex('PositionView', 'vec3', () => 'mvPosition.xyz', 'end');
          // under flat shading three's normalWorldGeometry is the face's (from the view position's derivatives)
          const name = temp(id);
          emit(b, `#ifdef FLAT_SHADED`);
          emit(b, `vec3 ${name} = normalize((vec4(normalize(cross(dFdx(${view.e}), dFdy(${view.e}))), 0.0) * viewMatrix).xyz);`);
          emit(b, `#else`);
          emit(b, `vec3 ${name} = normalize(${varied.e});`);
          emit(b, `#endif`);
          return { t: 'vec3', e: name };
        }
        case 'cameraPosition': return { t: 'vec3', e: ctx === 'fog' ? 'wsFogCamera' : 'wsFrameCamera' };
        case 'cameraNear': return { t: 'float', e: 'wsCameraNear()' };
        case 'time': return { t: 'float', e: host('time', 'float') };
        case 'fogZenithColour': return { t: 'vec3', e: host('fogZenithColour', 'vec3') };
        case 'fogColour': return { t: 'vec3', e: 'wsFogColour()' };
        case 'atmosphereSunDirection': return { t: 'vec3', e: host('atmosphereSunDirection', 'vec3') };
        case 'atmosphereSunColour': return { t: 'vec3', e: host('atmosphereSunColour', 'vec3') };
        case 'skyLightDirection': return { t: 'vec3', e: host('skyLightDirection', 'vec3') };
        case 'skyLightColour': return { t: 'vec3', e: host('skyLightColour', 'vec3') };
        case 'instanceHash': {
          libraries.add('hash');
          return vertexOnly ? out('float', 'wsHash(uint(gl_InstanceID))') : fromVertex('InstanceHash', 'float', () => 'wsHash(uint(gl_InstanceID))', 'start', true);
        }
        case 'vertexColour': return vertexOnly ? { t: 'vec3', e: 'wsVertexColour().rgb' } : { t: 'vec3', e: `${fromVertex('Colour', 'vec4', () => 'wsVertexColour()', 'start').e}.rgb` };
        case 'vertexColourAlpha': return vertexOnly ? { t: 'float', e: 'wsVertexColour().a' } : { t: 'float', e: `${fromVertex('Colour', 'vec4', () => 'wsVertexColour()', 'start').e}.a` };
        case 'materialColour': return { t: 'vec3', e: host('materialColour', 'vec3') };
        case 'materialEmissive': return { t: 'vec3', e: `(${host('materialEmissive', 'vec3')} * ${host('materialEmissiveIntensity', 'float')})` };
        case 'screenUV': return fragmentUv();
        case 'pointCoord': return { t: 'vec2', e: 'vec2(gl_PointCoord.x, 1.0 - gl_PointCoord.y)' };
        case 'fragCoord': return out('vec2', `vec2(gl_FragCoord.x, ${host('screenSize', 'vec2')}.y - gl_FragCoord.y)`);
        case 'viewBillboard': {
          const origin = bind(b, id, 'vec3', '(modelMatrix * wsInstanceTransform(vec4(0.0, 0.0, 0.0, 1.0))).xyz');
          return out('vec3', `(inverse(modelMatrix) * vec4(${origin.e} + (inverse(viewMatrix) * vec4(position, 0.0)).xyz, 1.0)).xyz`);
        }
        case 'modelScale': return out('vec3', 'vec3(length(modelMatrix[0].xyz), length(modelMatrix[1].xyz), length(modelMatrix[2].xyz))');
        case 'cylindricalBillboard': {
          const origin = bind(b, id, 'vec3', '(modelMatrix * wsInstanceTransform(vec4(0.0, 0.0, 0.0, 1.0))).xyz');
          const toward = bind(b, id, 'vec3', `wsFrameCamera - ${origin.e}`);
          const right = bind(b, id, 'vec3', `normalize(vec3(${toward.e}.z, 0.0, - ${toward.e}.x) + vec3(0.0001, 0.0, 0.0))`);
          return out('vec3', `(inverse(modelMatrix) * vec4(${origin.e} + ${right.e} * position.x * length(modelMatrix[0].xyz) + vec3(0.0, position.y * length(modelMatrix[1].xyz), 0.0), 1.0)).xyz`);
        }
        case 'cameraRelativeBillboard': {
          const [direction, distance, local] = three();
          const d = bind(b, id, 'vec3', widen(direction, 'vec3'));
          const toward = bind(b, id, 'vec3', `dot(${d.e}, ${d.e}) > 1e-8 ? - normalize(${d.e}) : vec3(0.0, 0.0, 1.0)`);
          // world up keeps cards upright; a pole-safe alternate axis avoids a zero cross product
          const right = bind(b, id, 'vec3', `normalize(cross(abs(${toward.e}.y) > 0.999 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0), ${toward.e}))`);
          const up = bind(b, id, 'vec3', `cross(${toward.e}, ${right.e})`), xy = bind(b, id, 'vec2', widen(local, 'vec2'));
          return out('vec3', `(inverse(modelMatrix) * vec4(wsFrameCamera + ${d.e} * ${asFloat(distance)} + ${right.e} * ${xy.e}.x + ${up.e} * ${xy.e}.y, 1.0)).xyz`);
        }
        case 'viewDepth': return out('float', `- (wsFrameView * vec4(${widen(one(), 'vec3')}, 1.0)).z`);
        case 'screenDirection': {
          const [from, to] = two();
          const start = bind(b, id, 'vec4', `projectionMatrix * (wsFrameView * vec4(${from.e}, 1.0))`), end = bind(b, id, 'vec4', `projectionMatrix * (wsFrameView * vec4(${to.e}, 1.0))`);
          return out('vec2', `normalize(${end.e}.xy / ${end.e}.w - ${start.e}.xy / ${start.e}.w + vec2(0.00001, 0.0))`);
        }
        case 'attribute': {
          const t = n.type;
          if (n.name === undefined || t === undefined || t === 'bool') break;
          const name = n.name;
          const fallback = n.default === undefined ? null : typeof n.default === 'number' ? [n.default] : [...n.default];
          const known = attributes.get(name);
          if (known !== undefined && JSON.stringify(known.default) !== JSON.stringify(fallback) && fallback !== null && known.default !== null) throw new Error(`material graph: conflicting defaults for ${name}`);
          if (known === undefined || known.default === null) attributes.set(name, { name, type: t, default: fallback });
          return vertexOnly ? { t, e: name } : fromVertex(`A_${name}`, t, () => name, 'start');
        }
        // the lighting stage's inputs: the call's arguments, or the globals the light model sets before it calls
        case 'normalView': if (LIGHT_CTX.has(ctx)) return { t: 'vec3', e: 'wsNormalView' }; break;
        case 'viewDirection': if (LIGHT_CTX.has(ctx)) return { t: 'vec3', e: 'wsViewDirection' }; break;
        case 'albedo': if (LIGHT_CTX.has(ctx)) return { t: 'vec3', e: 'wsAlbedo' }; break;
        case 'sunDirection': if (ctx === 'sun') return { t: 'vec3', e: 'wsSunDirection' }; break;
        case 'sunColour': if (ctx === 'sun') return { t: 'vec3', e: 'wsSunColour' }; break;
        case 'sunShadow': if (ctx === 'sun') return { t: 'float', e: 'wsSunShadow' }; break;
        case 'irradiance': if (ctx === 'ambient') return { t: 'vec3', e: 'wsIrradiance' }; break;
        case 'radiance': if (ctx === 'ambient') return { t: 'vec3', e: 'wsRadiance' }; break;
        case 'environmentIrradiance': if (ctx === 'ambient') return { t: 'vec3', e: 'wsEnvironmentIrradiance' }; break;
        case 'environmentIrradianceAt': if (ctx === 'ambient') return out('vec3', `wsEnvironmentIrradianceAt(normalize(${widen(one(), 'vec3')}))`); break;
        case 'litColour': if (ctx === 'grade') return { t: 'vec3', e: 'wsLitColour' }; break;
        // post inputs
        case 'sceneColour': return out('vec4', `texture(${host('scene', 'sampler2D')}, ${fragmentUv().e})`);
        case 'sceneColourAt': return out('vec4', `texture(${host('scene', 'sampler2D')}, ${widen(one(), 'vec2')})`);
        case 'sceneDepth': {
          const at = a === undefined ? fragmentUv().e : widen(a, 'vec2');
          return out('float', `- perspectiveDepthToViewZ(texture(${host('depth', 'sampler2D')}, ${at}).x, ${host('depthNear', 'float')}, ${host('depthFar', 'float')})`);
        }
        case 'sceneNormal': {
          const at = a === undefined ? fragmentUv().e : widen(a, 'vec2');
          return out('vec3', `normalize(texture(${host('normal', 'sampler2D')}, ${at}).xyz * 2.0 - 1.0)`);
        }
        case 'const': return literal(n.value ?? 0);
        case 'param': {
          const name = n.param;
          if (name === undefined) break;
          const own = scope.params?.params[name];
          if (own !== undefined) return { t: own.type, e: uniform({ name: own.uniform, type: own.type, from: 'toon', toon: own.uniform }) };
          const p = ir.params?.[name], glsl = paramUniforms.get(name);
          if (p === undefined || glsl === undefined || p.type === 'texture') throw new Error(`material graph: unknown param ${name}`);
          const t = p.type === 'colour' ? 'vec3' : p.type;
          return { t, e: uniform({ name: glsl, type: t, from: 'param', param: name }) };
        }
        case 'arrayElement': {
          const row = n.param === undefined ? undefined : ir.arrays?.[n.param];
          if (row === undefined || n.param === undefined) throw new Error('material graph: unknown uniform list');
          const name = uniform({ name: paramName('wsA', n.param), type: row.type, from: 'array', param: n.param, length: row.value.length });
          return out(row.type, `${name}[int(floor(clamp(${asFloat(one())}, 0.0, ${glslFloat(row.value.length - 1)})))]`);
        }
        // arithmetic
        case 'add': return same((x, y) => `${x} + ${y}`, two());
        case 'sub': return same((x, y) => `${x} - ${y}`, two());
        case 'mul': return same((x, y) => `${x} * ${y}`, two());
        case 'div': { const [x, y] = two(), t = widest([x, y]); return out(t, `${widen(x, t)} / ${divisor(y, t, n.in?.[1])}`); }
        case 'min': return same((x, y) => `min(${x}, ${y})`, two());
        case 'max': return same((x, y) => `max(${x}, ${y})`, two());
        case 'atan': return same((y, x) => `atan(${y}, ${x})`, two());
        case 'mod': {
          const [x, y] = two(), t = widest([x, y]), d = bind(b, id, t, divisor(y, t, n.in?.[1]));
          return out(t, `${widen(x, t)} - ${d.e} * floor(${widen(x, t)} / ${d.e})`);
        }
        case 'pow': { const [x, y] = two(), t = widest([x, y]); return out(t, `pow(max(${widen(x, t)}, ${t === 'float' ? '0.0' : `${t}(0.0)`}), ${widen(y, t)})`); }
        case 'step': return same((x, y) => `step(${x}, ${y})`, two());
        case 'clamp': return same((x, lo, hi) => `clamp(${x}, ${lo}, ${hi})`, three());
        case 'smoothstep': return same((e0, e1, x) => `smoothstep(${e0}, ${e1}, ${x})`, three());
        case 'abs': case 'floor': case 'fract': case 'sin': case 'cos': case 'exp': case 'fwidth': case 'dFdx': case 'dFdy': case 'normalize': {
          const v = one(); return out(v.t, `${n.op}(${v.e})`);
        }
        case 'float16': {
          const v = one(), half = (e: string): string => `unpackHalf2x16(packHalf2x16(${e}))`;
          if (v.t === 'float') return out(v.t, `${half(`vec2(${v.e}, 0.0)`)}.x`);
          if (v.t === 'vec2') return out(v.t, half(v.e));
          if (v.t === 'vec3') return out(v.t, `vec3(${half(`${v.e}.xy`)}, ${half(`vec2(${v.e}.z, 0.0)`)}.x)`);
          return out(v.t, `vec4(${half(`${v.e}.xy`)}, ${half(`${v.e}.zw`)})`);
        }
        case 'negate': { const v = one(); return out(v.t, `- ${v.e}`); }
        case 'oneMinus': { const v = one(); return out(v.t, `1.0 - ${v.e}`); }
        case 'saturate': { const v = one(); return out(v.t, `clamp(${v.e}, 0.0, 1.0)`); }
        case 'gerstner': {
          const [point, clock, damping] = three(), p = bind(b, id, 'vec2', widen(point, 'vec2')), t = asFloat(clock);
          const terms = GERSTNER_TERMS.map(w => {
            const phase = `((${p.e}.x * ${glslFloat(w.x)} + ${p.e}.y * ${glslFloat(w.z)} - ${t} * ${glslFloat(w.speed)}) * ${glslFloat(w.k)})`;
            return `vec3(cos(${phase}) * ${glslFloat(w.horizontalX)}, sin(${phase}) * ${glslFloat(w.amplitude)}, cos(${phase}) * ${glslFloat(w.horizontalZ)})`;
          });
          return out('vec3', `(vec3(0.0) + ${terms.join(' + ')}) * ${asFloat(damping)}`);
        }
        case 'gerstnerNormal': {
          const [point, clock, damping] = three(), p = bind(b, id, 'vec2', widen(point, 'vec2')), t = asFloat(clock), damp = asFloat(damping);
          const phase = (w: (typeof GERSTNER_TERMS)[number]): string => `((${p.e}.x * ${glslFloat(w.x)} + ${p.e}.y * ${glslFloat(w.z)} - ${t} * ${glslFloat(w.speed)}) * ${glslFloat(w.k)})`;
          const tangent = (axis: 'x' | 'z'): string => GERSTNER_TERMS.map(w => {
            const f = w[axis], ph = phase(w);
            return `vec3(sin(${ph}) * ${glslFloat(-f * w.horizontalX * w.k)}, cos(${ph}) * ${glslFloat(f * w.amplitude * w.k)}, sin(${ph}) * ${glslFloat(-f * w.horizontalZ * w.k)})`;
          }).join(' + ');
          const tx = bind(b, id, 'vec3', `vec3(0.0) + ${tangent('x')}`), tz = bind(b, id, 'vec3', `vec3(0.0) + ${tangent('z')}`);
          return out('vec3', `normalize(cross(vec3(0.0, 0.0, 1.0) + ${tz.e} * ${damp}, vec3(1.0, 0.0, 0.0) + ${tx.e} * ${damp}))`);
        }
        case 'length': return out('float', `length(${one().e})`);
        case 'viewToWorld': return out('vec3', `normalize((vec4(${widen(one(), 'vec3')}, 0.0) * viewMatrix).xyz)`);
        case 'instanceOrigin': return out('vec3', 'wsInstanceTransform(vec4(0.0, 0.0, 0.0, 1.0)).xyz');
        case 'instanceColour': return out('vec3', 'wsInstanceColour()');
        case 'skinDirection': return out('vec3', `wsSkinDirection(${widen(one(), 'vec3')})`);
        case 'localToWorldVector': return out('vec3', `(modelMatrix * wsInstanceTransform(vec4(${widen(one(), 'vec3')}, 0.0))).xyz`);
        case 'worldToLocal': return out('vec3', `(vec4(${widen(one(), 'vec3')}, 0.0) * modelMatrix).xyz`);
        case 'cross': { const [x, y] = two(); return out('vec3', `cross(${x.e}, ${y.e})`); }
        case 'dot': { const [x, y] = two(); return out('float', `dot(${x.e}, ${y.e})`); }
        case 'mix': { const [x, y, f] = three(), t = widest([x, y]); return out(t, `mix(${widen(x, t)}, ${widen(y, t)}, ${f.t === 'float' ? f.e : widen(f, t)})`); }
        case 'lt': case 'lte': case 'gt': case 'gte': case 'eq': {
          const [x, y] = two();
          const op = n.op === 'lt' ? '<' : n.op === 'lte' ? '<=' : n.op === 'gt' ? '>' : n.op === 'gte' ? '>=' : '==';
          return out('bool', `${asFloat(x)} ${op} ${asFloat(y)}`);
        }
        case 'and': { const [x, y] = two(); return out('bool', `${x.e} && ${y.e}`); }
        case 'or': { const [x, y] = two(); return out('bool', `${x.e} || ${y.e}`); }
        case 'not': return out('bool', `!${one().e}`);
        case 'swizzle': {
          const v = one(), mask = n.mask ?? 'x', t = vecOf(mask.length);
          // GLSL ES swizzles no scalar: a float's only component is itself
          if (v.t === 'float') return t === 'float' ? v : out(t, `${t}(${v.e})`);
          return out(t, `${v.e}.${mask}`);
        }
        case 'combine': {
          const k = ins.reduce((s, v) => s + LEN[v.t], 0), t = vecOf(k);
          return out(t, `${t}(${ins.map(v => v.e).join(', ')})`);
        }
        case 'noise': { libraries.add('noise'); const p = one(); return out('float', `mx_perlin_noise_float(${p.e})`); }
        case 'meshMap': {
          const name = temp(id), at = fragmentUv().e;
          const bump = n.name === 'bump', sampler = host(bump ? 'bumpMap' : 'meshMap', 'sampler2D');
          const fallback = n.name === 'colourOrVertex' ? `vec4(${fromVertex('Colour', 'vec4', () => 'wsVertexColour()', 'start').e}.rgb, 1.0)` : 'vec4(1.0)';
          // a lit program samples at three's own uv for the lent slot (its transform and uv channel, as the node path's
          // texture reads it: Sky Reach's mill bump is on uv1); WS_THREE_UV marks a program that carries those varyings
          const slotUv = bump ? 'vBumpMapUv' : 'vMapUv', slotDefine = bump ? 'USE_BUMPMAP' : 'USE_MAP';
          emit(b, `#ifdef ${bump ? 'WS_BUMP_MAP' : 'WS_MESH_MAP'}`);
          emit(b, `#if defined( WS_THREE_UV ) && defined( ${slotDefine} )`);
          emit(b, `vec4 ${name} = texture(${sampler}, ${slotUv});`);
          emit(b, '#else');
          emit(b, `vec4 ${name} = texture(${sampler}, ${at});`);
          emit(b, '#endif');
          emit(b, '#else');
          emit(b, `vec4 ${name} = ${fallback};`);
          emit(b, '#endif');
          return { t: 'vec4', e: name };
        }
        case 'texture': return out('vec4', sample(textureUniform(n.param, 'sampler2D'), widen(one(), 'vec2')));
        case 'textureArray': {
          const [at, layer] = two();
          return out('vec4', sample(textureUniform(n.param, 'sampler2DArray'), `vec3(${widen(at, 'vec2')}, floor(${asFloat(layer)} + 0.5))`));
        }
        case 'texture3D': return out('vec4', sample(textureUniform(n.param, 'sampler3D'), widen(one(), 'vec3')));
        case 'textureLod': { const [at, lod] = two(); return out('vec4', `textureLod(${textureUniform(n.param, 'sampler2D')}, ${widen(at, 'vec2')}, ${asFloat(lod)})`); }
        case 'textureGrad': {
          const [at, dx, dy] = three();
          return out('vec4', `textureGrad(${textureUniform(n.param, 'sampler2D')}, ${widen(at, 'vec2')}, ${widen(dx, 'vec2')}, ${widen(dy, 'vec2')})`);
        }
        case 'acc': if (scope.acc !== null) return scope.acc; break;
        case 'index': if (scope.index !== null) return scope.index; break;
        default: break;
      }
      throw new Error(`material graph: op ${n.op} has no GLSL lowering in the ${ctx} stage`);
    }

    function select(n: GraphNode, id: string, scope: Scope, b: Block, ctx: Ctx): V {
      const [rc, rx, ry] = [n.in?.[0] ?? 0, n.in?.[1] ?? 0, n.in?.[2] ?? 0];
      const tx = typeOfRef(rx, scope), ty = typeOfRef(ry, scope);
      const sampleX = samples(rx, scope), sampleY = samples(ry, scope), bothSample = sampleX && sampleY;
      const bool = tx === 'bool' && ty === 'bool';
      const pureLoop = scope.parent !== null && !sampleX && !sampleY && !Object.values(scope.nodes).some(node => node.op === 'fwidth' || node.op === 'dFdx' || node.op === 'dFdy');
      // G5: the fragment root's other selects on this condition that share an operand with it branch with it (their memo
      // is this block's); together they branch when the work only they read is heavy, though each alone reads light
      const group = !bool && !bothSample && ctx === 'fragment' && b === fragmentRoot && scope.parent === null ? sameCondition(n, id, scope, b) : [];
      const branch = bool ? !bothSample
        : (scope.parent === null || pureLoop) && !bothSample && (Math.max(ownCost(rx, scope), ownCost(ry, scope)) > GLSL_BRANCH_LIGHT_COST
          || (group.length > 0 && groupCost([[id, n], ...group], scope) > GLSL_BRANCH_LIGHT_COST));
      const t: GraphValueType = bool ? 'bool' : vecOf(Math.max(LEN[tx], LEN[ty]));
      if (!branch) {
        const cond = ref(rc, scope, b, ctx), x = ref(rx, scope, b, ctx), y = ref(ry, scope, b, ctx);
        selects.light++;
        return bind(b, id, t, bool ? `bool(mix(float(${y.e}), float(${x.e}), float(${cond.e})))` : `mix(${widen(y, t)}, ${widen(x, t)}, float(${cond.e}))`);
      }
      const members = [[id, n] as const, ...group].map(([mid, m]) => {
        const mt: GraphValueType = mid === id ? t : vecOf(Math.max(LEN[typeOfRef(m.in?.[1] ?? 0, scope)], LEN[typeOfRef(m.in?.[2] ?? 0, scope)]));
        return { mid, m, t: mt, name: temp(mid) };
      });
      selects.branch += members.length;
      for (const k of branchShared(members.map(({ mid, m }) => [mid, m] as const), scope)) ref(k, scope, b, ctx);
      const cond = ref(rc, scope, b, ctx);
      for (const member of members) emit(b, `${member.t} ${member.name};`);
      emit(b, `if (${cond.e}) {`);
      const yes = block(b, true);
      for (const member of members) { const x = ref(member.m.in?.[1] ?? 0, scope, yes, ctx); emit(yes, `${member.name} = ${bool ? x.e : widen(x, member.t)};`); }
      b.lines.push(...yes.lines);
      emit(b, '} else {');
      const no = block(b, true);
      for (const member of members) { const y = ref(member.m.in?.[2] ?? 0, scope, no, ctx); emit(no, `${member.name} = ${bool ? y.e : widen(y, member.t)};`); }
      b.lines.push(...no.lines);
      emit(b, '}');
      for (const member of members) if (member.mid !== id) b.memo.set(`${scope.path}/${member.mid}`, { t: member.t, e: member.name });
      const leader = members[0];
      return { t, e: leader?.name ?? temp(id) };
    }

    function loop(n: GraphNode, id: string, scope: Scope, b: Block, ctx: Ctx): V {
      const body = n.body, count = n.count ?? 1;
      if (body === undefined) throw new Error('material graph: a loop without a body');
      const init = ref(n.in?.[0] ?? 0, scope, b, ctx);
      const acc = temp(id), i = `i${String(serial++)}`, index = `x${String(serial++)}`;
      const inner = block(b, b.conditional, b.iterations * count);
      const bodyScope: Scope = { path: `${scope.path}.${id}.body`, nodes: body.nodes, parent: scope, home: b, acc: { t: init.t, e: acc }, index: { t: 'float', e: index }, types: scope.types,
        ...(scope.params === undefined ? {} : { params: scope.params }), ...(scope.seeds === undefined ? {} : { seeds: scope.seeds }) };
      emit(inner, `float ${index} = float(${i});`);
      const next = ref(body.out, bodyScope, inner, ctx);
      emit(inner, `${acc} = ${widen(next, init.t)};`);
      emit(b, `${init.t} ${acc} = ${init.e};`);
      emit(b, `for (int ${i} = 0; ${i} < ${String(count)}; ${i}++) {`);
      b.lines.push(...inner.lines);
      emit(b, '}');
      return { t: init.t, e: acc };
    }

    /** a stage output, built in `main` of its stage */
    const output = (r: GraphRef | undefined, b: Block, ctx: Ctx, want?: GraphValueType): string | null => {
      if (r === undefined) return null;
      const v = ref(r, root, b, ctx);
      return want === undefined ? v.e : want === 'float' ? asFloat(v) : widen(v, want);
    };
    /** a lighting function: its statements built in their own root, the light-free nodes it reads from `main` */
    const lightFunction = (signature: string, result: (b: Block) => string): void => {
      const own = block(null);
      const value = result(own);
      functions.push(`${signature} {\n${own.lines.join('\n')}\n  return ${value};\n}`);
    };

    const st = ir.stages;
    const outputs: { -readonly [K in keyof GraphGlslOutputs]: GraphGlslOutputs[K] } = {
      offset: null, position: null, clip: null, normal: null, sunScale: null, fogScale: null, pointSize: null, colour: null, alpha: null,
      targetAlpha: null, emissive: null, roughness: null, metalness: null, occlusion: null, discard: null, shadingNormal: null, shadowOffset: null,
    };
    let lighting: GraphGlslProgram['lighting'] = null;
    let fogFunction: string | null = null, fogSample: string | null = null;
    if (which === 'fog' || which === 'fogSample') {
      const fog = st.fog;
      if (fog === undefined) throw new Error('material graph: a fog graph without a fog stage');
      const own = block(null), colour = ref(fog.colour, root, own, 'fog');
      if (which === 'fog') fogFunction = `vec3 wsGraphFog(vec3 wsFogInput, vec3 wsEngineFogged, vec3 wsFogPosition, vec3 wsFogCamera, float wsFogScaleIn) {\n${own.lines.join('\n')}\n  return ${widen(colour, 'vec3')};\n}`;
      if (which === 'fogSample') {
        if (fog.transmission === undefined) throw new Error('material graph: a fog sample needs admitted transmission');
        const transmission = ref(fog.transmission, root, own, 'fog');
        fogSample = `vec4 wsGraphFogSample(vec3 wsFogInput, vec3 wsEngineFogged, vec3 wsFogPosition, vec3 wsFogCamera, float wsFogScaleIn) {\n${own.lines.join('\n')}\n  return vec4(${widen(colour, 'vec3')}, ${asFloat(transmission)});\n}`;
      }
    } else if (which === 'outline') {
      const o = st.outline;
      if (o === undefined) throw new Error('material graph: no outline stage');
      outputs.offset = output(o.offset, vertexRoot, 'vertex', 'vec3');
      outputs.colour = output(o.colour, fragmentRoot, 'fragment', 'vec3');
    } else if (ir.kind === 'post') {
      outputs.colour = output(st.post?.colour, fragmentRoot, 'fragment', 'vec3');
      outputs.alpha = output(st.post?.alpha, fragmentRoot, 'fragment', 'float');
    } else {
      outputs.offset = output(st['vertex.offset']?.offset, vertexRoot, 'vertex', 'vec3');
      outputs.position = output(st['vertex.position']?.position, vertexRoot, 'vertex', 'vec3');
      outputs.clip = output(st['vertex.clip']?.position, vertexRoot, 'vertex', 'vec4');
      outputs.normal = output(st['vertex.normal']?.normal, vertexRoot, 'vertex', 'vec3');
      outputs.pointSize = output(st.points?.size, vertexRoot, 'vertex', 'float');
      const scale = st['vertex.scale'];
      if (scale?.sun !== undefined) {
        const v = output(scale.sun, vertexRoot, 'vertex', 'float');
        if (v !== null) { varyings.push('varying float wsVSunScale;'); emit(vertexRoot, `wsVSunScale = clamp(${v}, 0.0, 1.0);`); outputs.sunScale = 'wsVSunScale'; }
      }
      if (scale?.fog !== undefined) {
        const v = output(scale.fog, vertexRoot, 'vertex', 'float');
        if (v !== null) { varyings.push('varying float wsVFogScale;'); emit(vertexRoot, `wsVFogScale = clamp(${v}, 0.0, 1.0);`); outputs.fogScale = 'wsVFogScale'; }
      }
      const s = st.surface ?? {};
      outputs.discard = output(s.discard, fragmentRoot, 'fragment');
      outputs.colour = output(s.colour, fragmentRoot, 'fragment', 'vec3');
      outputs.alpha = output(s.alpha, fragmentRoot, 'fragment', 'float');
      outputs.targetAlpha = output(s.targetAlpha, fragmentRoot, 'fragment', 'float');
      outputs.emissive = output(s.emissive, fragmentRoot, 'fragment', 'vec3');
      outputs.roughness = output(s.roughness, fragmentRoot, 'fragment', 'float');
      outputs.metalness = output(s.metalness, fragmentRoot, 'fragment', 'float');
      outputs.occlusion = output(s.occlusion, fragmentRoot, 'fragment', 'float');
      outputs.shadingNormal = output(s.normal, fragmentRoot, 'fragment', 'vec3');
      // the received-shadow offset moves where the shadow is looked up (TSL: receivedShadowPositionNode = positionWorld +
      // offset); three's classic shadow coordinates are made per vertex (shadowmap_vertex), so it is built there
      outputs.shadowOffset = output(st['shadow.offset']?.offset, vertexRoot, 'vertex', 'vec3');
      const lit = ir.model === 'toon' ? opts.toon?.preset.stages.lighting : st.lighting;
      const litScope = ir.model === 'toon' && toonScope !== null ? toonScope : root;
      if (lit !== undefined && ir.model !== 'unlit') {
        const environment = (nodes: Readonly<Record<string, GraphNode>>): boolean => Object.values(nodes).some(n => n.op === 'radiance' || n.op === 'environmentIrradiance' || n.op === 'environmentIrradianceAt' || (n.body !== undefined && environment(n.body.nodes)));
        lightFunction('vec4 wsGraphSun(vec3 wsSunDirection, vec3 wsSunColour, float wsSunShadow)', b => {
          const radiance = widen(ref(lit.sun, litScope, b, 'sun'), 'vec3');
          const specular = lit.sunSpecular === undefined ? '0.0' : asFloat(ref(lit.sunSpecular, litScope, b, 'sun'));
          return `vec4(${radiance}, ${specular})`;
        });
        const ambient = lit.ambient, grade = lit.grade;
        if (ambient !== undefined) lightFunction('vec3 wsGraphAmbient(vec3 wsIrradiance, vec3 wsRadiance, vec3 wsEnvironmentIrradiance)', b => widen(ref(ambient, litScope, b, 'ambient'), 'vec3'));
        if (grade !== undefined) lightFunction('vec3 wsGraphGrade(vec3 wsLitColour)', b => widen(ref(grade, litScope, b, 'grade'), 'vec3'));
        lighting = { sun: true, specular: lit.sunSpecular !== undefined, ambient: ambient !== undefined, ownsEnvironment: ambient !== undefined && environment(litScope.nodes), grade: grade !== undefined };
      }
    }

    const vertexHead = varyings.join('\n');
    const fragmentHead = [...varyings, ...globals, ...functions].join('\n');
    const program: GraphGlslProgram = {
      vertex: { head: vertexHead, body: [...vertexStart, ...vertexRoot.lines].join('\n'), end: vertexEnd.join('\n') },
      fragment: { head: fragmentHead, body: fragmentRoot.lines.join('\n'), end: '' },
      outputs, lighting, selects,
    };
    return { program, fogFunction, fogSample, execution };
  }

  const main = ir.kind === 'fog' ? null : emitProgram('main');
  const outlined = ir.kind === 'material' && ir.stages.outline !== undefined ? emitProgram('outline') : null;
  const fogged = ir.kind === 'fog' ? emitProgram('fog') : null;
  const sampledFog = ir.kind === 'fog' && ir.stages.fog?.transmission !== undefined ? emitProgram('fogSample') : null;
  return {
    ir, cost, bindings, ...(postFog === undefined ? {} : { postFog }), program: main?.program ?? null, outline: outlined?.program ?? null, fog: fogged?.fogFunction ?? null,
    ...(sampledFog?.fogSample === null || sampledFog?.fogSample === undefined ? {} : { fogSample: sampledFog.fogSample }),
    ...(opts.reportExecutionCost === true ? { executionCost: { main: main?.execution ?? null, outline: outlined?.execution ?? null, fog: fogged?.execution ?? null, ...(sampledFog?.execution === null || sampledFog?.execution === undefined ? {} : { fogSample: sampledFog.execution }) } } : {}),
    libraries: (['hash', 'noise'] as const).filter(name => libraries.has(name)),
    uniforms: [...uniforms.values()], attributes: [...attributes.values()],
  };
}

/** the code of the libraries lowered graphs call (`GraphGlsl.libraries`), each once, in a fixed order */
export function graphGlslLibraries(names: Iterable<string>): string {
  const wanted = new Set(names);
  return [...(wanted.has('hash') ? [HASH_GLSL] : []), ...(wanted.has('noise') ? [NOISE_GLSL] : [])].join('\n');
}
