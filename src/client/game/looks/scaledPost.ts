import { Color, HalfFloatType, LinearFilter, NearestFilter, type PerspectiveCamera, Texture, UnsignedByteType, Vector2, Vector3, Vector4, WebGLRenderTarget, type Material, type TextureDataType } from 'three';
import { Pass } from 'postprocessing';
import { loadPostGraphCompiler, type PostGraph, type PostGraphCompiler } from '@wildshard/engine/render/graphBackend';
import type { Renderer } from '@wildshard/engine/render/renderer';
import { validateGraph } from '@wildshard/format/materialGraph';
import type { PostPackTerm, PostStorage, ScaledPostRow } from '@wildshard/format/scaledPost';
import { BLEND_ADD_KEEP_ALPHA, type UniformMap } from '../plugin/shaderFamily';
import { buildYield } from '@wildshard/engine/core/workSlice';
import type { Scope } from '@wildshard/engine/app/scope';
import { compileOffscreenPass } from '@wildshard/engine/render/precompile';

const compilers = new WeakMap<Renderer, PostGraphCompiler>();
/** a scaled post program's per-frame feeds, read once from its row (`ScaledPostPass.frame`) */
interface PostFeed {
  readonly name: string;
  /** the linked uniforms the graph declares as params */
  readonly links: readonly string[];
  readonly camera: readonly (readonly [string, string])[];
  /** a packed param's terms, its declared value and the array the frame fills */
  readonly pack: readonly { readonly key: string; readonly terms: readonly PostPackTerm[]; readonly initial: unknown; readonly value: number[] }[];
}
function postFeeds(row: ScaledPostRow, active?: ReadonlySet<string>): readonly PostFeed[] {
  return Object.entries(row.programs).filter(([name]) => active === undefined || active.has(name)).map(([name, p]) => ({
    name,
    links: (p.links ?? []).filter(key => key in (p.graph.params ?? {}) || key in (p.graph.postFog?.graph.params ?? {})),
    camera: Object.entries(p.camera ?? {}),
    pack: Object.entries(p.pack ?? {}).map(([key, terms]) => ({ key, terms, initial: (p.graph.params?.[key] ?? p.graph.postFog?.graph.params?.[key])?.value, value: terms.map(() => 0) })),
  }));
}
/** Both formats are admitted before any material/target is made: an inactive target cannot feed an active draw. */
function validateStorage(row: ScaledPostRow): void {
  for (const item of [...Object.values(row.targets), ...row.draws]) {
    if (item.storage !== undefined && item.storage !== 'float16' && item.storage !== 'unorm8') throw new Error('Invalid post storage');
  }
  for (const storage of ['float16', 'unorm8']) {
    const active = new Set(['input']);
    for (const [name, target] of Object.entries(row.targets)) if (target.storage === undefined || target.storage === storage) {
      if (!active.has(target.of)) throw new Error('Post storage target needs an active size source');
      active.add(name);
    }
    for (const draw of row.draws) if ((draw.storage === undefined || draw.storage === storage)
      && (!active.has(draw.to) || Object.values(draw.textures ?? {}).some(source => !active.has(source)) || draw.texel !== undefined && !active.has(draw.texel.of))) throw new Error('Post storage draw needs active targets');
  }
}
const SCRATCH2 = [0, 0], SCRATCH3 = [0, 0, 0], SCRATCH4 = [0, 0, 0, 0];
const MATRIX_ROWS = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];
/** Prepare the client backend during async world loading, before synchronous composer construction: classic GLSL
 *  programs with no node handler (PF10's default) */
export async function prepareScaledPost(renderer: Renderer): Promise<void> { compilers.set(renderer, await loadPostGraphCompiler(renderer)); }
type CompiledPost = PostGraph;
/** programs compiled ahead (`precompileScaledPost`), by their graph row, each copy taken once */
const ahead = new WeakMap<Renderer, Map<object, CompiledPost[]>>();
function compilePost(compiler: PostGraphCompiler, pass: string, name: string, p: ScaledPostRow['programs'][string]): CompiledPost {
  const checked = validateGraph(p.graph, { trustedBudget: true });
  if (!checked.ok || p.graph.kind !== 'post') throw new Error(`Invalid scaled post graph ${name}`);
  const graph = compiler.compileGraph(p.graph, { trustedBudget: true });
  graph.material.name = `${pass}.${name}`;
  if (p.blend === 'addKeepAlpha') Object.assign(graph.material, { transparent: true, ...BLEND_ADD_KEEP_ALPHA });
  return graph;
}
/** A throwaway pass: its own draw (the full-screen triangle) links a program as a scaled post pass will draw it. */
class LinkPass extends Pass {
  constructor() { super('scaled-post-link'); }
  link(renderer: Renderer, material: Material, target: WebGLRenderTarget, scope: Scope): Promise<void> {
    this.fullscreenMaterial = material;
    return compileOffscreenPass(renderer, { scene: this.scene, camera: this.camera, target }, () => !scope.disposed);
  }
}
/** Compile `rows`' programs ahead, one build step each, during async world loading: a later pass of the same row takes
 *  these copies instead of compiling every program in its synchronous constructor (a cell's composite is built in one
 *  frame), and each is linked on a pass's own draw into a render target first (the driver links it on its workers with
 *  KHR_parallel_shader_compile, not inside the composite's first draw); the copies `scope` leaves untaken are disposed
 *  with it. */
export async function precompileScaledPost(renderer: Renderer, rows: readonly ScaledPostRow[], scope: Scope): Promise<void> {
  const compiler = compilers.get(renderer);
  if (compiler === undefined) throw new Error('Scaled post backend was not prepared during world loading');
  const pool = ahead.get(renderer) ?? new Map<object, CompiledPost[]>(), made: CompiledPost[] = [];
  ahead.set(renderer, pool);
  scope.onDispose(() => {
    for (const graph of made) for (const [key, list] of pool) {
      const at = list.indexOf(graph); if (at === -1) continue;
      list.splice(at, 1); graph.material.dispose(); if (list.length === 0) pool.delete(key);
    }
  });
  const link = new LinkPass(), target = new WebGLRenderTarget(1, 1, { type: HalfFloatType, depthBuffer: false });
  try {
    for (const row of rows) for (const [name, p] of Object.entries(row.programs)) {
      await buildYield(scope);
      const graph = compilePost(compiler, row.name, name, p); made.push(graph);
      pool.set(p.graph, [...(pool.get(p.graph) ?? []), graph]);
      await buildYield(scope);
      await link.link(renderer, graph.material, target, scope);
    }
  } finally { target.dispose(); }
}
/** Generic client-only post executor: all differences between shards are graphs and rows. */
export class ScaledPostPass extends Pass {
  private readonly graphs = new Map<string, CompiledPost>();
  private readonly rts = new Map<string, WebGLRenderTarget>();
  private readonly overrides = new Map<string, string>();
  private readonly outs = new Map<string, Texture | null>();
  private type: TextureDataType = HalfFloatType;
  private readonly selective: boolean;
  private selected: ScaledPostRow['draws'] | null = null;
  private w = 0;
  private plan: readonly PostFeed[] | null = null;
  private h = 0;
  settings: Record<string, number>;
  debugGain = 1;
  constructor(private readonly row: ScaledPostRow, private readonly ctx: { readonly renderer: Renderer; readonly camera: PerspectiveCamera; readonly links?: UniformMap; readonly params?: UniformMap
    /** G924: the output this pass may draw straight to the screen when it is the composer's last pass (its target is
     *  then never drawn: nothing else reads it), instead of into its target for a copy pass to display */
    readonly screen?: string
    /** G4: the output this pass draws into the composer's output buffer (a swap: the next pass reads it as its input), instead
     *  of into its target for a copy pass to display; its target is then never drawn */
    readonly buffer?: string }) {
    super(row.name);
    this.selective = [...Object.values(row.targets), ...row.draws].some(item => item.storage !== undefined);
    if (this.selective) validateStorage(row);
    const compiler = compilers.get(ctx.renderer);
    if (compiler === undefined) throw new Error('Scaled post backend was not prepared during world loading');
    this.settings = { ...row.settings }; this.needsSwap = ctx.buffer !== undefined;
    this.needsDepthTexture = Object.values(row.programs).some(p => p.depth !== undefined);
    const known = new Set(['input']);
    for (const [key, target] of Object.entries(row.targets)) {
      if (key === 'input' || !known.has(target.of) || !Number.isFinite(target.scale) || target.scale <= 0 || target.scale > 1) throw new Error(`Invalid scaled post target ${key}`);
      known.add(key);
    }
    for (const draw of row.draws) {
      if (!(draw.program in row.programs) || !known.has(draw.to) || Object.values(draw.textures ?? {}).some(source => !known.has(source) || source === draw.to)) throw new Error('Invalid scaled post draw');
    }
    for (const target of Object.values(row.outputs)) if (!known.has(target) || target === 'input') throw new Error('Invalid scaled post output');
    for (const [name, p] of Object.entries(row.programs)) {
      const graph = ahead.get(ctx.renderer)?.get(p.graph)?.shift() ?? compilePost(compiler, row.name, name, p);
      this.graphs.set(name, graph);
      Object.defineProperty(this, `material:${name}`, { value: graph.material, enumerable: true });
    }
    const first = row.draws[0];
    const initial = first === undefined ? undefined : this.graphs.get(first.program);
    if (initial !== undefined) this.fullscreenMaterial = initial.material;
  }
  material(name: string): Material | undefined { return this.graphs.get(name)?.material; }
  set(settings: Readonly<Record<string, number>>): void {
    for (const value of Object.values(settings)) if (!Number.isFinite(value)) throw new Error('Post settings must be finite');
    Object.assign(this.settings, settings);
  }
  output(name: string): Texture | null { return this.outs.get(name) ?? null; }
  debugView(output: string, target: string | null): void { if (target === null) this.overrides.delete(output); else this.overrides.set(output, target); }
  private publish(): void { for (const [out, key] of Object.entries(this.row.outputs)) this.outs.set(out, this.rts.get(this.overrides.get(out) ?? key)?.texture ?? null); }
  private active(storage: PostStorage | undefined): boolean { return storage === undefined || storage === (this.type === HalfFloatType ? 'float16' : 'unorm8'); }
  private draws(): ScaledPostRow['draws'] { return (this.selected ??= this.selective ? this.row.draws.filter(draw => this.active(draw.storage)) : this.row.draws); }
  override initialize(renderer: Renderer, _alpha: boolean, frameBufferType: number): void {
    const type = frameBufferType === UnsignedByteType || !(renderer.extensions.has('EXT_color_buffer_float') || renderer.extensions.has('EXT_color_buffer_half_float')) ? UnsignedByteType : HalfFloatType;
    const changed = type !== this.type; this.type = type;
    if (changed && this.selective) {
      this.plan = null; this.selected = null;
      if (this.w > 0 && this.h > 0) { const width = this.w, height = this.h; this.w = 0; this.h = 0; this.setSize(width, height); }
    }
  }
  override setDepthTexture(texture: Texture): void {
    for (const [name, p] of Object.entries(this.row.programs)) if (p.depth !== undefined) this.graphs.get(name)?.setTexture(p.depth, texture);
  }
  override setSize(width: number, height: number): void {
    if (width === this.w && height === this.h) return;
    this.w = width; this.h = height;
    for (const rt of this.rts.values()) rt.dispose(); this.rts.clear();
    const sizes = new Map<string, readonly [number, number]>([['input', [width, height]]]);
    for (const [key, row] of Object.entries(this.row.targets)) {
      const source = sizes.get(row.of); if (source === undefined) throw new Error('Missing post target size');
      const w = Math.max(1, Math.round(source[0] * row.scale)), h = Math.max(1, Math.round(source[1] * row.scale));
      sizes.set(key, [w, h]);
      if (!this.active(row.storage)) continue;
      const rt = new WebGLRenderTarget(w, h, { type: this.type, depthBuffer: false });
      rt.texture.minFilter = rt.texture.magFilter = row.filter === 'nearest' ? NearestFilter : LinearFilter;
      rt.texture.name = row.name; this.rts.set(key, rt);
    }
    this.publish();
  }
  private term(term: PostPackTerm): number | null {
    if (term === null || typeof term === 'number') return term;
    if (typeof term === 'string') return this.settings[term] ?? 0;
    if ('param' in term) { const value: unknown = this.ctx.params?.[term.param]?.value; if (typeof value !== 'number') throw new Error('Missing numeric post parameter'); return value; }
    return (this.settings[term.setting] ?? 0) / (term.div ?? 1) / (term.per === undefined ? 1 : this.rts.get(term.per.target)?.[term.per.axis] ?? 1);
  }
  private frame(): void {
    const camera = this.ctx.camera;
    // NF15: the feeds come from the static row, read once; each frame fills the same scratch arrays (every back-end copies
    // a written value), so a frame allocates nothing
    this.plan ??= postFeeds(this.row, this.selective ? new Set(this.draws().map(draw => draw.program)) : undefined);
    for (const feed of this.plan) {
      const graph = this.graphs.get(feed.name); if (graph === undefined) continue;
      for (const key of feed.links) {
        const value: unknown = this.ctx.links?.[key]?.value;
        if (isTexture(value)) graph.setTexture(key, value);
        else if (typeof value === 'number') graph.setParam(key, value);
        else if (value instanceof Vector2) graph.setParam(key, value.toArray(SCRATCH2));
        else if (value instanceof Vector3 || value instanceof Color) graph.setParam(key, value.toArray(SCRATCH3));
        else if (value instanceof Vector4) graph.setParam(key, value.toArray(SCRATCH4));
        else throw new Error(`Missing post uniform ${key}`);
      }
      for (const [key, term] of feed.camera) {
        if (term === 'near' || term === 'far') graph.setParam(key, camera[term]);
        else if (term === 'nearFar') { SCRATCH2[0] = camera.near; SCRATCH2[1] = camera.far; graph.setParam(key, SCRATCH2); }
        else {
          const matrix = term === 'projection' ? camera.projectionMatrix : term === 'projectionInverse' ? camera.projectionMatrixInverse : term === 'view' ? camera.matrixWorldInverse : camera.matrixWorld;
          for (const [r, cells] of MATRIX_ROWS.entries()) for (let c = 0; c < 4; c++) cells[c] = matrix.elements[r * 4 + c] ?? 0;
          graph.setArrayParam(key, MATRIX_ROWS);
        }
      }
      for (const { key, terms, initial, value } of feed.pack) {
        for (let i = 0; i < terms.length; i++) value[i] = this.term(terms[i] ?? null) ?? (Array.isArray(initial) ? Number(initial[i]) : typeof initial === 'number' ? initial : 0);
        graph.setParam(key, value.length === 1 ? value[0] ?? 0 : value);
      }
    }
  }
  override render(renderer: Renderer, input: WebGLRenderTarget | null, output: WebGLRenderTarget | null = null): void {
    if (this.row.drawnOnly === true) for (const key of Object.keys(this.row.outputs)) this.outs.set(key, null);
    if (input === null || this.rts.size === 0 || this.row.when !== undefined && (this.settings[this.row.when] ?? 0) <= 0) return;
    this.frame();
    const source = (key: string): WebGLRenderTarget => { const target = key === 'input' ? input : this.rts.get(key); if (target === undefined) throw new Error('Missing post target'); return target; };
    for (const draw of this.draws()) {
      const graph = this.graphs.get(draw.program); if (graph === undefined) throw new Error('Missing post program');
      for (const [key, target] of Object.entries(draw.textures ?? {})) graph.setTexture(key, source(target).texture);
      if (draw.texel !== undefined) { const target = source(draw.texel.of); graph.setParam(draw.texel.uniform, [1 / target.width, 1 / target.height]); }
      const toScreen = this.renderToScreen && this.ctx.screen !== undefined && this.row.outputs[this.ctx.screen] === draw.to;
      const toBuffer = !toScreen && output !== null && this.ctx.buffer !== undefined && this.row.outputs[this.ctx.buffer] === draw.to;
      this.fullscreenMaterial = graph.material; renderer.setRenderTarget(toScreen ? null : toBuffer ? output : source(draw.to)); renderer.render(this.scene, this.camera);
    }
    if (this.row.drawnOnly === true) this.publish();
  }
  override dispose(): void { for (const rt of this.rts.values()) rt.dispose(); for (const graph of this.graphs.values()) graph.material.dispose(); super.dispose(); }
}
function isTexture(value: unknown): value is Texture { return value instanceof Texture; }
