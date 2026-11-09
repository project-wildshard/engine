import type { Scope } from "@wildshard/engine/app/scope";
import { loadingUnits } from "@wildshard/engine/boot/waits";
import type { SkyBackdropContext } from "@wildshard/engine/render/look";
import type { Shardfile } from "@wildshard/format/shardSchema";
import type { runtimeLookMaterials } from "../shardfile/runtimeProduct";
import { AddEquation, AdditiveBlending, BackSide, Color, CustomBlending, DoubleSide, FrontSide, NoBlending, OneFactor, OneMinusSrcAlphaFactor, ShaderMaterial, SrcAlphaFactor, Vector2, Vector3, Vector4, ZeroFactor, type IUniform, type ShaderMaterialParameters } from "three";

/**
 * A shader look family as declared rows (SHARD-PLATFORM M3, look-family rows): a shard that draws its world with its own
 * hand-written programs (one architecture program, a sky, fog sheets, filaments…) lists them as data — the GLSL
 * fragments, each program's sources and material settings, and the uniforms every program shares — in its own `data/`,
 * and this system builds the materials. Nothing here knows a shard's look; the GLSL is the shard's.
 *
 * - Uniforms are rows (`UniformRow`: a float, a hex colour, a vector, an array of vectors or colours) that
 *   `uniformsFrom` turns into one live `{ value }` object each, typed from the rows, so one write reaches every program.
 *   `setUniforms` writes a preset (a partial row table) into live uniforms in place.
 * - GLSL is composed by splicing: `@{name}` in a program's source (or in a fragment) is replaced by the family's fragment
 *   `name`, recursively. A shard passes the fragments its data cannot hold (another module's GLSL, a number from its
 *   layout) when it makes the family, so the data stays plain text. The spliced source is exactly the text a template
 *   literal would have built: the same program, the same cache key.
 * - A program row names its sources and its settings (vertex colours, side, depth, blending as a `BlendRow` preset) and
 *   which of the shared uniforms it reads (all, or a list); `material` adds the row's own uniforms and the caller's.
 */

type Vec2 = readonly [number, number];
type Vec3 = readonly [number, number, number];
type Vec4 = readonly [number, number, number, number];

/** One uniform as data: a float, a hex colour (`rgb`), a vector (`v2` / `v3` / `v4`, a `v3` optionally normalised), or
 *  an array of `v4`s or hex colours. */
export type UniformRow =
  | number
  | { readonly rgb: number }
  | { readonly v2: Vec2 }
  | { readonly v3: Vec3; readonly normalize?: boolean }
  | { readonly v4: Vec4 }
  | { readonly v4s: readonly Vec4[] }
  | { readonly rgbs: readonly number[] };

/** A table of uniform rows by uniform name. */
export type UniformRows = Readonly<Record<string, UniformRow>>;

/** The live value a uniform row makes. */
export type UniformValueOf<R> = R extends number ? number
  : R extends { readonly rgb: number } ? Color
  : R extends { readonly v2: Vec2 } ? Vector2
  : R extends { readonly v3: Vec3 } ? Vector3
  : R extends { readonly v4: Vec4 } ? Vector4
  : R extends { readonly v4s: readonly Vec4[] } ? Vector4[]
  : R extends { readonly rgbs: readonly number[] } ? Color[]
  : never;

/** The live uniforms a row table makes: one `{ value }` object per row. */
export type UniformsOf<S extends UniformRows> = { [K in keyof S]: { value: UniformValueOf<S[K]> } };

/** A material's uniforms. */
export type UniformMap = Record<string, IUniform>;

function valueOf(row: UniformRow): number | Color | Vector2 | Vector3 | Vector4 | Vector4[] | Color[] {
  if (typeof row === 'number') return row;
  if ('rgb' in row) return new Color(row.rgb);
  if ('v2' in row) return new Vector2(...row.v2);
  if ('v3' in row) { const v = new Vector3(...row.v3); return row.normalize === true ? v.normalize() : v; }
  if ('v4' in row) return new Vector4(...row.v4);
  if ('v4s' in row) return row.v4s.map((v) => new Vector4(...v));
  return row.rgbs.map((hex) => new Color(hex));
}

/** The live uniforms of a row table: a new `{ value }` object per row, typed from the rows. */
export function uniformsFrom<S extends UniformRows>(rows: S): UniformsOf<S> {
  const out: UniformMap = {};
  for (const [name, row] of Object.entries(rows)) out[name] = { value: valueOf(row) };
  // each row made the value its UniformValueOf names (valueOf's branches mirror it)
  return out as UniformsOf<S>;
}

/** Writes a preset into live uniforms in place (a colour by hex, a vector by components, arrays element by element). */
export function setUniforms(live: UniformMap, preset: UniformRows): void {
  for (const [name, row] of Object.entries(preset)) {
    const slot = live[name];
    if (slot === undefined) throw new Error(`setUniforms: no uniform ${name}`);
    const v: unknown = slot.value;
    if (typeof row === 'number') slot.value = row;
    else if ('rgb' in row && v instanceof Color) v.setHex(row.rgb);
    else if ('v2' in row && v instanceof Vector2) v.set(...row.v2);
    else if ('v3' in row && v instanceof Vector3) { v.set(...row.v3); if (row.normalize === true) v.normalize(); }
    else if ('v4' in row && v instanceof Vector4) v.set(...row.v4);
    else if ('v4s' in row && Array.isArray(v)) row.v4s.forEach((x, i) => { const e: unknown = v[i]; if (e instanceof Vector4) e.set(...x); });
    else if ('rgbs' in row && Array.isArray(v)) row.rgbs.forEach((hex, i) => { const e: unknown = v[i]; if (e instanceof Color) e.setHex(hex); });
    else throw new Error(`setUniforms: ${name} does not take that row`);
  }
}

/** Keeps the target's alpha (e.g. a silhouette's inverse depth) under a transparent pass: colour blends over, alpha stays. */
export const BLEND_KEEP_ALPHA: { readonly blending: 5; readonly blendEquation: 100; readonly blendSrc: 204; readonly blendDst: 205; readonly blendEquationAlpha: 100; readonly blendSrcAlpha: 200; readonly blendDstAlpha: 201; } = {
  blending: CustomBlending, blendEquation: AddEquation, blendSrc: SrcAlphaFactor, blendDst: OneMinusSrcAlphaFactor,
  blendEquationAlpha: AddEquation, blendSrcAlpha: ZeroFactor, blendDstAlpha: OneFactor,
} as const;
/** Adds colour and keeps the target's alpha. */
export const BLEND_ADD_KEEP_ALPHA: { readonly blending: 5; readonly blendEquation: 100; readonly blendSrc: 201; readonly blendDst: 201; readonly blendEquationAlpha: 100; readonly blendSrcAlpha: 200; readonly blendDstAlpha: 201; } = {
  blending: CustomBlending, blendEquation: AddEquation, blendSrc: OneFactor, blendDst: OneFactor,
  blendEquationAlpha: AddEquation, blendSrcAlpha: ZeroFactor, blendDstAlpha: OneFactor,
} as const;

/** A program's blending: three's default, none (a pass that writes its target outright), colour over with the target's
 *  alpha kept, added with the alpha kept, or three's additive (a glow, a light shaft). */
export type BlendRow = 'normal' | 'none' | 'keepAlpha' | 'addKeepAlpha' | 'add';
/** A program's faces. */
export type SideRow = 'front' | 'back' | 'double';

/** One program as data. */
export interface ShaderProgramRow {
  /** the material's name (a pass's draw in a capture) */
  readonly name?: string;
  /** the vertex source (`@{name}` splices a fragment) */
  readonly vertex: string;
  /** the fragment source (`@{name}` splices a fragment) */
  readonly fragment: string;
  /** the shared uniforms it reads: all of them (the default), or these */
  readonly shared?: 'all' | readonly string[];
  /** its own uniforms, a new object per material */
  readonly uniforms?: UniformRows;
  readonly vertexColors?: boolean;
  readonly side?: SideRow;
  readonly transparent?: boolean;
  readonly depthWrite?: boolean;
  readonly depthTest?: boolean;
  readonly blend?: BlendRow;
  readonly defines?: Readonly<Record<string, string>>;
}

/** What a caller adds to one material: uniforms over the row's, defines, a side, and splices only it knows (a loop's step
 *  count: each value its own source, so its own program). */
export interface ShaderMaterialOptions {
  readonly uniforms?: UniformMap;
  readonly fragments?: Readonly<Record<string, string>>;
  readonly defines?: Readonly<Record<string, string>>;
  readonly side?: SideRow;
}

const SIDES = { front: FrontSide, back: BackSide, double: DoubleSide } as const;
const SPLICE = /@\{(\w+)\}/gu;

/** A shard's shader look family: its fragments and program rows; builds spliced sources and materials. */
export class ShaderFamily<P extends string = string> {
  private readonly sources = new Map<string, string>();
  private readonly fragments: Readonly<Record<string, string>>;
  private readonly programs: Readonly<Record<P, ShaderProgramRow>>;

  /** `fragments`: what `@{name}` splices; `programs`: the program rows by name. */
  constructor(fragments: Readonly<Record<string, string>>, programs: Readonly<Record<P, ShaderProgramRow>>) {
    this.fragments = fragments;
    this.programs = programs;
  }

  /** A source with every `@{name}` replaced by its fragment, recursively (`extra` first: a caller's own splices). */
  glsl(source: string, extra?: Readonly<Record<string, string>>): string {
    if (extra !== undefined) return this.splice(source, [], extra);
    const cached = this.sources.get(source);
    if (cached !== undefined) return cached;
    const out = this.splice(source, [], {});
    this.sources.set(source, out);
    return out;
  }

  private splice(source: string, stack: readonly string[], extra: Readonly<Record<string, string>>): string {
    return source.replaceAll(SPLICE, (_match, name: string) => {
      const fragment = extra[name] ?? this.fragments[name];
      if (fragment === undefined) throw new Error(`ShaderFamily: no fragment @{${name}}`);
      if (stack.includes(name)) throw new Error(`ShaderFamily: @{${name}} splices itself`);
      return this.splice(fragment, [...stack, name], extra);
    });
  }

  /** A program's row. */
  row(name: P): ShaderProgramRow { return this.programs[name]; }

  /** Whether the family has a program of this name (a row read from JSON names one by a plain string). */
  has(name: string): name is P { return Object.hasOwn(this.programs, name); }

  /** A material for a program: the shared uniforms it reads (one object each), its own, then the caller's. */
  material(name: P, shared: UniformMap, opt: ShaderMaterialOptions = {}): ShaderMaterial {
    const row = this.programs[name];
    const uniforms: UniformMap = {};
    if (row.shared === undefined || row.shared === 'all') Object.assign(uniforms, shared);
    else for (const key of row.shared) {
      const slot = shared[key];
      if (slot === undefined) throw new Error(`ShaderFamily: ${name} reads a missing shared uniform ${key}`);
      uniforms[key] = slot;
    }
    if (row.uniforms !== undefined) Object.assign(uniforms, uniformsFrom(row.uniforms));
    if (opt.uniforms !== undefined) Object.assign(uniforms, opt.uniforms);
    const params: ShaderMaterialParameters = { uniforms, vertexShader: this.glsl(row.vertex, opt.fragments), fragmentShader: this.glsl(row.fragment, opt.fragments) };
    if (row.name !== undefined) params.name = row.name;
    if (row.vertexColors !== undefined) params.vertexColors = row.vertexColors;
    if (row.transparent !== undefined) params.transparent = row.transparent;
    if (row.depthWrite !== undefined) params.depthWrite = row.depthWrite;
    if (row.depthTest !== undefined) params.depthTest = row.depthTest;
    const side = opt.side ?? row.side;
    if (side !== undefined) params.side = SIDES[side];
    const defines = opt.defines ?? row.defines;
    if (defines !== undefined) params.defines = { ...defines };
    if (row.blend === 'none') params.blending = NoBlending;
    else if (row.blend === 'keepAlpha') Object.assign(params, BLEND_KEEP_ALPHA);
    else if (row.blend === 'addKeepAlpha') Object.assign(params, BLEND_ADD_KEEP_ALPHA);
    else if (row.blend === 'add') params.blending = AdditiveBlending;
    return new ShaderMaterial(params);
  }
}

/**
 * A trusted look's successor to its shader family: its own `look.materials` graphs (`ids`) compiled under `scope` before the
 * world stage, for a look built first (a sky backdrop), through the runtime look catalogue (`runtimeLookMaterials`; its
 * compiler and catalogue load lazily here). They compile on the page renderer the engine hands the backdrop
 * (`SkyBackdropContext.renderer`), read here and never by the shard, which passes its whole context. `setParam` writes a
 * compiled graph's uniform by catalogue id after checking its declared shape (no program change); `setTexture` lends a
 * `role: 'lent'` texture param a texture the look made (a decoded sky key); the materials leave with `scope`. The whole
 * compile pass comes back, so a runtime can lend it (game/shardfile/lentLooks). Users: Pine Hollow's forest looks,
 * Nalati's camp smoke and water.
 */
export async function lookGraphMaterials(scope: Scope, backdrop: Pick<SkyBackdropContext, 'renderer'>, source: Shardfile, ids: readonly string[]): ReturnType<typeof runtimeLookMaterials> {
  const { runtimeLookMaterials: compile } = await import('../shardfile/runtimeProduct');
  // LS8 (J204): a backdrop builds these inside the sky step; count them on it
  return compile({ scope, renderer: backdrop.renderer }, source, true, ids, total => loadingUnits('Sky look materials', total));
}
