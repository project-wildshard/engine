/**
 * A level look's light model and fog scoped to one subtree of the page (SHARD-PLATFORM SF63): a grid region's materials
 * compile with its own level's `LookStrategy.lighting` / `fog` while every other material on the page keeps the page's.
 *
 * Why per-material chunk overrides (and not a frame-level switch or a recompiled page): a look's lighting and fog are
 * whole-chunk writes on three's global `ShaderChunk` (toon bands in `lights_physical_pars_fragment`, a ramp or painted
 * fog in `fog_*`), installed once per page before anything compiles. Rewriting the globals at cell entry would recompile
 * every program on the page (the road, the neighbours, the viewmodel) behind a screen on each crossing, and the next
 * neighbour drawn in the same frame would take the wrong look. Instead:
 *
 * 1. `captureLookChunks` runs the level's installs once in a sandbox: it snapshots `ShaderChunk` and the page's fog
 *    uniform list, runs the installs, keeps every chunk they changed and every fog uniform set they added, and puts the
 *    page's chunks and list back exactly. Cached per level id (a look's installs guard themselves to run once a page).
 * 2. `scopeLookChunks` patches each material under the region's root (a `patchShader` entry, last in the chain, so a
 *    material's own `#include <fog_fragment>` edits still land first): every `#include <chunk>` the overrides reach is
 *    inlined with the region's text, the captured fog uniforms are bound on that shader, and its program key gains
 *    `|look:<id>` (a region-keyed program variant: the same material type under the page look keeps its own program).
 *    A material that reaches no overridden chunk (or only fog chunks with `fog: false`) is left alone: no new program.
 *    Materials the asset cache shares (`isShared`) are left alone too (another region may draw them).
 *
 * 3. **Its own frame** (SF63 part 2): a look's chunks are written in its level's own world frame (a slab-edge haze that
 *    starts some metres from the level's centre, cloud shadows tiled on its xz). A grid region is drawn at its cell's offset,
 *    so inside every inlined region chunk of the fragment stage `cameraPosition` and the engine's fog world position
 *    `vFogWorldPos` read relative to the region's origin (`wsLookOrigin`, the root's world position, kept by `sweep`).
 *    The macros wrap the region's chunk text only: a page chunk left as an include inside it, and every other line of the
 *    material, read the page frame as before.
 * 4. **Its world patch** (G321, `LookStrategy.worldPatch`): the look's own patch on its world's materials (a haze by
 *    heading) runs on every material the sweep reaches, before the chunk patch, as its compose runs it standalone.
 * 5. **Its per-frame parts** (SF63 part 2): the look's sky dressing (`LookStrategy.sky`) builds inside the same sandbox
 *    (its chunk writes become region overrides; its own uniforms, such as a cloud field, stay its own), and its `update`
 *    and the look's `frame` run from `frame(dt, t)`, which the caller runs only while the player is in the cell.
 *
 * The page's programs and chunk text never change, so a page booted as the level itself (SHARD SELECT) is untouched.
 * The patches leave with the region's scope. Generic engine code (E405): no level is named here.
 */
import * as THREE from 'three';
import type { Scope } from '../../../shared/engine/app/scope';
import { captureFogUniforms } from '../world/Atmosphere';
import { PATCH_ORDER, hasShaderPatch, patchShader, type ShaderSource } from './shaderPatches';
import { guardObjectDraw, type DrawGuard } from './drawGuards';
import type { FogModel, LightingRig, SkyDressing } from './look';

/** A level look's chunk text and fog uniforms, as its installs would have left them on the page now. */
export interface LookChunks {
  readonly id: string;
  /** chunk name → the region's text (only the chunks the installs changed) */
  readonly chunks: Readonly<Record<string, string>>;
  /** the uniform sets its installs added to the fog uniforms (`addFogUniforms`) */
  readonly uniforms: readonly Readonly<Record<string, THREE.IUniform>>[];
}

/** The look parts a region scopes: its light model, fog, sky dressing, per-frame hook and world patch (`LookStrategy`'s). */
export interface RegionLookParts {
  readonly lighting?: LightingRig;
  readonly fog?: FogModel;
  readonly sky?: SkyDressing;
  readonly frame?: (dt: number, t: number) => void;
  /** G321: its own patch on each of its world's materials (`LookStrategy.worldPatch`), applied by `sweep` */
  readonly worldPatch?: (material: THREE.Material, scope: Scope) => void;
}
/** What a sky dressing's `build` is handed: the page's sky rig and the engine's cloud fbm. */
export interface DressingHost {
  readonly sky: Parameters<NonNullable<SkyDressing['build']>>[0];
  readonly cloudField: () => THREE.Texture;
}

const captured = new Map<string, LookChunks | null>();
/** three's chunk table, read and written by name (its type lists the shipped names only) */
const readChunk = (name: string): string | undefined => { const text: unknown = Reflect.get(THREE.ShaderChunk, name); return typeof text === 'string' ? text : undefined; };
const chunkNames = (): string[] => Object.keys(THREE.ShaderChunk);

/**
 * Run the look's light model and fog installs in a sandbox and return what they changed (null: they changed nothing,
 * e.g. the page already runs the same look). The page's `ShaderChunk` and fog uniform list are restored exactly.
 */
export function captureLookChunks(id: string, look: RegionLookParts, dressing?: DressingHost): LookChunks | null {
  const known = captured.get(id);
  if (known !== undefined) return known;
  const before = new Map(chunkNames().map((name) => [name, readChunk(name)]));
  let uniforms: Record<string, THREE.IUniform>[] = [];
  const changed: Record<string, string> = {};
  try {
    uniforms = captureFogUniforms(() => {
      look.lighting?.install(); look.fog?.install();
      // the sky dressing's build, as `SkyBackdropView.buildClouds` runs it after the installs (a cloud-shadow hook on the sun loop)
      const build = look.sky?.build;
      if (build !== undefined && dressing !== undefined) build(dressing.sky, dressing.cloudField());
    });
  } finally {
    for (const name of chunkNames()) {
      const now = readChunk(name), was = before.get(name);
      if (now !== undefined && now !== was) changed[name] = now;
      if (was === undefined) Reflect.deleteProperty(THREE.ShaderChunk, name); else Reflect.set(THREE.ShaderChunk, name, was);
    }
  }
  const result = Object.keys(changed).length === 0 && uniforms.length === 0 ? null : { id, chunks: changed, uniforms };
  captured.set(id, result);
  return result;
}

/** three's built-in shader for a material type (`ShaderLib`); ShaderMaterials carry their own source */
const SHADER_LIB: Readonly<Record<string, string>> = {
  MeshBasicMaterial: 'basic', LineBasicMaterial: 'basic', MeshLambertMaterial: 'lambert', MeshPhongMaterial: 'phong',
  MeshStandardMaterial: 'physical', MeshPhysicalMaterial: 'physical', MeshToonMaterial: 'toon', MeshMatcapMaterial: 'matcap',
  PointsMaterial: 'points', LineDashedMaterial: 'dashed', MeshDepthMaterial: 'depth', MeshNormalMaterial: 'normal',
  SpriteMaterial: 'sprite', MeshDistanceMaterial: 'distance', ShadowMaterial: 'shadow',
};
const INCLUDE = /^[ \t]*#include +<([\w\d./]+)>/gm;

/** the overridden chunks a source reaches through its includes (nested ones too) */
function reached(source: string, overrides: Readonly<Record<string, string>>, seen = new Set<string>()): Set<string> {
  const out = new Set<string>();
  for (const match of source.matchAll(INCLUDE)) {
    const name = match[1];
    if (name === undefined || seen.has(name)) continue;
    seen.add(name);
    if (Object.hasOwn(overrides, name)) out.add(name);
    const text = readChunk(name);
    if (text !== undefined) for (const inner of reached(text, overrides, seen)) out.add(inner);
  }
  return out;
}

/** the region origin uniform the fragment stage's region chunks read positions against */
export const ORIGIN_UNIFORM = 'wsLookOrigin';
/** the names a region chunk reads as world positions (three's camera, the engine fog's world position: Atmosphere.ts) */
const FRAME_NAMES = ['cameraPosition', 'vFogWorldPos'] as const;
const DEFINE = FRAME_NAMES.map((name) => `#define ${name} ( ${name} - ${ORIGIN_UNIFORM} )`).join('\n');
const UNDEF = FRAME_NAMES.map((name) => `#undef ${name}`).join('\n');
/** a varying's declaration inside region text: declared under its own name, then shifted again */
const VARYING_DECL = /^[ \t]*((?:flat[ \t]+)?(?:varying|in)[ \t]+(?:(?:lowp|mediump|highp)[ \t]+)?vec3[ \t]+vFogWorldPos[ \t]*;)/gm;

/**
 * Inline every include that reaches an override with the region's text (the rest stay includes for three). `shift`
 * (the fragment stage): the region's own text reads positions in its level's frame (FRAME_NAMES, see the header); a page
 * chunk left as an include inside it is wrapped back to the page frame.
 */
function inline(source: string, overrides: Readonly<Record<string, string>>, shift: boolean, inRegion = false, depth = 0): string {
  if (depth > 16) return source;
  return source.replaceAll(INCLUDE, (whole, name: string) => {
    if (Object.hasOwn(overrides, name)) {
      const body = inline(overrides[name] ?? '', overrides, shift, true, depth + 1);
      if (!shift || inRegion) return body;
      return `\n${DEFINE}\n${body.replaceAll(VARYING_DECL, (_all, decl: string) => `${UNDEF}\n${decl}\n${DEFINE}`)}\n${UNDEF}\n`;
    }
    const text = readChunk(name);
    if (text !== undefined && reached(text, overrides).size > 0) {
      // a page chunk that includes a region one: its own lines stay in the page frame
      const body = inline(text, overrides, shift, false, depth + 1);
      return shift && inRegion ? `\n${UNDEF}\n${body}\n${DEFINE}\n` : body;
    }
    return shift && inRegion ? `\n${UNDEF}\n${whole}\n${DEFINE}\n` : whole;
  });
}
/** declare the origin uniform first in a source (after a `#version` line, which must stay first) */
function declareOrigin(source: string): string {
  const decl = `uniform highp vec3 ${ORIGIN_UNIFORM};\n`;
  const version = /^[ \t]*#version[^\n]*\n/u.exec(source);
  return version === null ? decl + source : version[0] + decl + source.slice(version[0].length);
}

const UNIFORM = /\buniform\s+(?:(?:lowp|mediump|highp)\s+)?\w+\s+(\w+)\s*(?:\[[^\]]*\])?\s*;/g;
/** the uniform names the region's chunks declare */
const declared = (look: LookChunks): Set<string> => new Set(Object.values(look.chunks).flatMap((text) => [...text.matchAll(UNIFORM)].map((m) => m[1] ?? '')));
/**
 * Drop the later declarations of a uniform the region's chunks declare (GLSL refuses a redeclaration): a material that
 * declared a look uniform itself for a page without the look now also receives the region's chunk that
 * declares it. The first declaration stays, so it still precedes every use. Only the chunks' own names are touched, so
 * a three chunk's `#if` / `#else` pair of one uniform is never cut.
 */
function dedupeUniforms(source: string, names: ReadonlySet<string>): string {
  const seen = new Set<string>();
  return source.replaceAll(UNIFORM, (statement, name: string) => {
    if (!names.has(name)) return statement;
    if (seen.has(name)) return '';
    seen.add(name); return statement;
  });
}

/** A look with no chunk overrides (its installs changed nothing on this page), for a region that scopes only its world patch. */
export const noLookChunks = (id: string): LookChunks => ({ id, chunks: {}, uniforms: [] });

/** Which overridden chunks a material's program would read (empty: leave it alone). */
export function lookChunksFor(material: THREE.Material, look: LookChunks): ReadonlySet<string> {
  let vertex: string, fragment: string;
  if (material instanceof THREE.ShaderMaterial) { vertex = material.vertexShader; fragment = material.fragmentShader; } else {
    const lib = SHADER_LIB[material.type], shader = lib === undefined ? undefined : THREE.ShaderLib[lib];
    if (shader === undefined) return new Set();
    vertex = shader.vertexShader; fragment = shader.fragmentShader;
  }
  const hit = reached(`${vertex}\n${fragment}`, look.chunks);
  const fogged: unknown = Reflect.get(material, 'fog');
  return fogged === true ? hit : new Set([...hit].filter((name) => !name.startsWith('fog_')));
}

/**
 * Apply the region's chunks to one shader source (the patch body; exposed for tests). `origin`: the region's origin in
 * the page frame (a `{ value: Vector3 }` uniform); the fragment stage's region chunks read positions against it.
 */
export function applyLookChunks(shader: Pick<ShaderSource, 'vertexShader' | 'fragmentShader' | 'uniforms'>, look: LookChunks, origin?: THREE.IUniform<THREE.Vector3>): void {
  const names = declared(look);
  shader.vertexShader = dedupeUniforms(inline(shader.vertexShader, look.chunks, false), names);
  const fragment = inline(shader.fragmentShader, look.chunks, true);
  shader.fragmentShader = dedupeUniforms(fragment === shader.fragmentShader ? fragment : declareOrigin(fragment), names);
  for (const set of look.uniforms) for (const [name, uniform] of Object.entries(set)) if (!Object.hasOwn(shader.uniforms, name)) shader.uniforms[name] = uniform;
  shader.uniforms[ORIGIN_UNIFORM] = origin ?? { value: new THREE.Vector3() };
}

const isMaterial = (value: unknown): value is THREE.Material => value instanceof THREE.Material;
/** a node with a `material` field (a mesh, points, a line, a sprite: whatever three draws) */
type Drawn = THREE.Object3D & { readonly material: unknown };
const carriesMaterial = (node: THREE.Object3D): node is Drawn => 'material' in node;

/** What `scopeLookChunks` reads of the region. */
export interface LookScopeOptions {
  /** materials another owner shares (the asset cache's): left on the page look */
  readonly isShared?: (material: THREE.Material) => boolean;
}

/** A region's scoped look: its material patches and its per-frame parts. */
export interface ScopedLook {
  /** patch what nodes attached since carry (call it each frame before the region draws, and once right away; a swap is
   *  patched as it is drawn); keeps the origin */
  readonly sweep: () => number;
  readonly patched: () => number;
  /** the look's per-frame parts (its sky dressing's `update`, its `frame`): run only while the player is in the cell */
  readonly frame: (dt: number, t: number) => void;
  /** the region origin the fragment stage reads positions against (page frame) */
  readonly origin: THREE.Vector3;
}

/**
 * Scope the look to `root`'s materials (`sweep`, see `ScopedLook`). A material compiled before its patch is recompiled
 * once. `parts`: the look's per-frame hooks `frame` runs.
 */
export function scopeLookChunks(root: THREE.Object3D, look: LookChunks, scope: Scope, options: LookScopeOptions = {}, parts: Pick<RegionLookParts, 'sky' | 'frame' | 'worldPatch' | 'fog'> = {}): ScopedLook {
  const done = new WeakSet<THREE.Material>();
  const origin: THREE.IUniform<THREE.Vector3> = { value: new THREE.Vector3() };
  let count = 0;
  const visit = (material: THREE.Material): void => {
    if (done.has(material)) return;
    done.add(material);
    if (options.isShared?.(material) === true) return;
    // a patch copy of a material this look already reached (the grid cell clip's variant, copyShaderPatches) carries its
    // look: patching it again re-keyed the variant, so a clipped piece linked a second program after its first draw
    if (hasShaderPatch(material, 'region.look')) return;
    if (parts.worldPatch !== undefined) { parts.worldPatch(material, scope); material.needsUpdate = true; }
    if (lookChunksFor(material, look).size === 0) return;
    // three keys a program by its shader id (or a ShaderMaterial's original source id) and this key, never the patched text
    patchShader(material, 'region.look', PATCH_ORDER.view + 40, (shader) => { applyLookChunks(shader, look, origin); }, { scope, key: (before) => `${before}|look:${look.id}`, pureKey: true, sceneShapeKey: true });
    material.needsUpdate = true; count++;
  };
  const visitValue = (material: unknown): void => {
    if (isMaterial(material)) visit(material);
    else if (Array.isArray(material)) { const list: readonly unknown[] = material; for (const m of list) if (isMaterial(m)) visit(m); }
  };
  // The region's draws are patched as they are submitted: a guard on each node that carries a material (the engine's draw
  // admission port, ahead of the program lookup) visits the material it draws, so a swap or an array edited in place is
  // patched before its first program, with no per-frame read of every node (JavaScriptCore ran that read megamorphic: 120
  // of 4940 samples of a steady Nalati Simulator profile on d587cf1c08). A node attached later is guarded when three's
  // childadded / childremoved (watched on every node of the region) marks the region changed; the next sweep walks it once
  // and patches what it carries now, before any warm-up compiles it. A shadow or override draw (another material than the
  // node's own) and a node no longer under the region are left alone.
  const watched = new WeakSet<THREE.Object3D>(), guarded = new WeakSet<THREE.Object3D>();
  let changed = true;
  const onChange = (): void => { changed = true; };
  const under = (node: THREE.Object3D): boolean => { for (let at: THREE.Object3D | null = node; at !== null; at = at.parent) if (at === root) return true; return false; };
  const ownMaterial = (node: Drawn, material: THREE.Material): boolean => {
    const own = node.material;
    if (own === material) return true;
    if (!Array.isArray(own)) return false;
    const list: readonly unknown[] = own;
    return list.includes(material);
  };
  const admit: DrawGuard = (_camera, _scene, _geometry, material, object) => {
    if (!done.has(material) && carriesMaterial(object) && ownMaterial(object, material) && under(object)) visit(material);
    return true;
  };
  const collect = (node: THREE.Object3D): void => {
    if (!watched.has(node)) { watched.add(node); scope.listenEmitter(node, 'childadded', onChange); scope.listenEmitter(node, 'childremoved', onChange); }
    if (carriesMaterial(node) && node.material !== undefined) {
      visitValue(node.material);
      if (!guarded.has(node)) { guarded.add(node); guardObjectDraw(node, admit, scope); }
    }
    for (const child of node.children) collect(child);
  };
  const sweep = (): number => {
    if (scope.disposed) return count;
    root.updateWorldMatrix(true, false);
    origin.value.setFromMatrixPosition(root.matrixWorld);
    const before = count;
    if (changed) { changed = false; collect(root); }
    return count - before;
  };
  const frame = (dt: number, t: number): void => {
    if (scope.disposed) return;
    parts.sky?.update?.(dt);
    parts.frame?.(dt, t);
  };
  return { sweep, patched: () => count, frame, origin: origin.value };
}
