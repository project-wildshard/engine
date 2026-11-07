/**
 * The one shader-patch registry (E357 X6, 01-architecture §13.2, decision 22: WebGPU containment).
 *
 * Every `onBeforeCompile` edit and every program-cache key goes through `patchShader`, so a future renderer port
 * has one place to read them (the inventory script lists each patch id) and the order of the edits is explicit.
 *
 * Parity rules (program sources are an exact parity field, `render.programKeys`):
 * - A material's patches run sorted by `order`, ties in the order they were added. The bands in `PATCH_ORDER`
 *   follow today's call order: the material's own look first, decorations after, the shadow cascades last.
 * - `mode: 'replace'` is the old `mat.onBeforeCompile = fn`: it drops whatever the material ran before (the
 *   fog hook every material inherits, or earlier patches). `mode: 'chain'` (the default) is the old
 *   `const prev = mat.onBeforeCompile; mat.onBeforeCompile = (s, r) => { prev(s, r); … }`: what the material ran
 *   before keeps running first.
 * - The program-cache key is three's dedupe key: two materials with the same key share one program. A patch
 *   with no `key` keeps three's default (the source text of the last patch function, as the old outermost
 *   `onBeforeCompile.toString()`), so materials share programs exactly as they did. E397: when a material runs
 *   two or more of the registry's patches, the default joins every patch's source text in its chain. The last patch's
 *   text alone let a scene-wide patch run last over every material collapse them onto one key, so a
 *   material-specific patch added earlier compiled into a shared program without it (a level's island
 *   textures under its scene-wide fog). A material with one patch keeps exactly the key it had.
 */
import * as THREE from 'three';
import type { Scope } from '../../../shared/engine/app/scope';
import { finishShaderText } from './shaderText';

export type ShaderSource = THREE.WebGLProgramParametersWithUniforms;
export type ShaderPatchFn = (shader: ShaderSource, renderer: THREE.WebGLRenderer) => void;
/** a fixed key, or one built on the key the material had before this patch (`(k) => \`${k}|csm\``) */
export type ShaderPatchKey = string | ((before: string) => string);

/** the order bands (lower runs first; ties run in the order they were added) */
export const PATCH_ORDER = {
  /** the hook the material ran before its first chained patch (the inherited fog hook, a foreign addon's hook) */
  inherited: 0,
  /** a material's own look: its vertex / fragment edits (the old `mat.onBeforeCompile = …` sites) */
  material: 100,
  /** a decoration chained onto a finished material (cover tint, an area clip, a flutter, a gallop) */
  decorate: 200,
  /** the shadow cascades' uniforms (Sky.setupMaterial wraps CSM) */
  shadows: 900,
  /** a temporary view-only cut (Explore's diorama) */
  view: 950,
} as const;

export interface ShaderPatchOptions {
  /** 'chain' (default) keeps what the material ran before; 'replace' drops it */
  mode?: 'chain' | 'replace';
  /** the program-cache key after this patch; omitted: the key the material had (three's default if none) */
  key?: ShaderPatchKey;
  /** `key` is a function of its input alone (an append of what the patch captured): a node renderer may keep its result
   *  for the same input, as it asks on every draw. Leave unset for a key that reads changing state. */
  pureKey?: boolean;
  /** The explicit patch key describes every shader-source choice; replacing
   * builtin scene inputs only requires fresh uniform bindings. Opt in only for
   * renderer-independent patches with a pure key. Custom hooks stay strict. */
  sceneShapeKey?: boolean;
  /** Borrowed textures injected through shader uniforms; warm-up uploads them before the first draw. */
  textures?: readonly THREE.Texture[];
  /** removes the patch when the scope is disposed */
  scope?: Scope;
}

interface Entry { readonly id: string; readonly order: number; readonly seq: number; readonly fn: ShaderPatchFn; readonly key?: ShaderPatchKey; readonly pureKey?: boolean; readonly sceneShapeKey?: boolean; readonly textures?: readonly THREE.Texture[] }
interface State {
  entries: Entry[];
  /** Uniform textures observed when these callbacks actually compile. */
  observedTextures: Set<THREE.Texture>;
  /** the key function, or null for three's default (the last patch function's source text) */
  key: (() => string) | null;
  /** whether a site gave this material a key of its own (Sky.fillSlots leaves those alone) */
  explicitKey: boolean;
  readonly runner: ShaderPatchFn;
  readonly keyFn: () => string;
  /** the material's own hook and key before its first patch: an undo that empties the chain puts them back */
  readonly before: { hook: PropertyDescriptor | undefined; key: PropertyDescriptor | undefined };
}

// A patch may borrow samplers without declaring them ahead of compilation. Capture the actual
// compiled uniforms as well, including sampler arrays, before any first draw can upload them.
function observeUniformTextures(shader: ShaderSource, textures: Set<THREE.Texture>): void {
  const isTexture = (value: unknown): value is THREE.Texture => value instanceof THREE.Texture;
  const add = (value: unknown): void => {
    if (isTexture(value)) textures.add(value);
    else if (Array.isArray(value)) for (const item of value) add(item);
  };
  for (const uniform of Object.values(shader.uniforms)) add(uniform.value);
}

const states = new WeakMap<THREE.Material, State>();
let seq = 0;

const ownKey = (mat: THREE.Material): (() => string) | null =>
  Object.hasOwn(mat, 'customProgramCacheKey') ? mat.customProgramCacheKey.bind(mat) : null;

const lastText = (entries: readonly Entry[]): string => entries.at(-1)?.fn.toString() ?? '';
/** three's default key, or every own patch's source text once two or more of the registry's patches run (E397) */
const defaultKey = (entries: readonly Entry[]): string => {
  const own = entries.filter((e) => e.id !== 'inherited');
  // the earlier patches' source text, not their ids: identical patches under two ids still share one program
  return own.length < 2 ? lastText(entries) : own.map((e) => e.fn.toString()).join('\n|\n');
};

/** runners on the stack: a runner called from inside another (a view copy's) leaves the text to the outer one */
let running = 0;
/** A material's patches in order, then (H10) the outermost runner, after every patch, hands three text with nothing left
 *  to rewrite (`shaderText.ts`): the patches find their place by the unresolved `#include` lines, so this runs last. */
function runEntries(state: State, shader: ShaderSource, renderer: THREE.WebGLRenderer): void {
  running++;
  try { for (const e of state.entries) e.fn(shader, renderer); } finally { running--; }
  observeUniformTextures(shader, state.observedTextures);
  if (running === 0) finishShaderText(shader);
}

function stateOf(mat: THREE.Material, mode: 'chain' | 'replace'): State {
  const known = states.get(mat);
  // a known material whose runner is still in place; else (first patch, or a foreign hook replaced the runner)
  // start over from what the material runs now
  if (known !== undefined && mat.onBeforeCompile === known.runner) {
    if (mode === 'replace') { known.entries = []; known.observedTextures.clear(); }
    return known;
  }
  const entries: Entry[] = [];
  if (mode === 'chain') entries.push({ id: 'inherited', order: PATCH_ORDER.inherited, seq: seq++, fn: mat.onBeforeCompile.bind(mat) });
  // the old sites assigned the hook and the key separately: a hook assignment never touched an own key
  const prevKey = known !== undefined && mat.customProgramCacheKey === known.keyFn ? known.key : ownKey(mat);
  const before = { hook: Object.getOwnPropertyDescriptor(mat, 'onBeforeCompile'), key: Object.getOwnPropertyDescriptor(mat, 'customProgramCacheKey') };
  const state: State = {
    entries, observedTextures: new Set(), key: prevKey, explicitKey: prevKey !== null, before,
    runner: (shader, renderer) => { runEntries(state, shader, renderer); },
    keyFn: () => (state.key === null ? defaultKey(state.entries) : state.key()),
  };
  states.set(mat, state);
  mat.onBeforeCompile = state.runner;
  mat.customProgramCacheKey = state.keyFn;
  return state;
}

/**
 * Run `install` (a foreign addon that assigns `onBeforeCompile` itself: three's CSM) and hand back the hook it
 * installed, leaving the material's own hook in place; chain the hook back in with `patchShader`.
 */
export function takeForeignHook(mat: THREE.Material, install: () => void): ShaderPatchFn {
  const before = Object.getOwnPropertyDescriptor(mat, 'onBeforeCompile');
  install();
  const hook = mat.onBeforeCompile.bind(mat);
  if (before) Object.defineProperty(mat, 'onBeforeCompile', before); else Reflect.deleteProperty(mat, 'onBeforeCompile');
  return hook;
}

/**
 * Patch a material's shader source before it compiles. Returns the undo (Explore's diorama cut is temporary);
 * the material needs `needsUpdate = true` after either, as before.
 */
export function patchShader(mat: THREE.Material, id: string, order: number, fn: ShaderPatchFn, opts: ShaderPatchOptions = {}): () => void {
  const mode = opts.mode ?? 'chain';
  const state = stateOf(mat, mode);
  const entry: Entry = { id, order, seq: seq++, fn, ...(opts.key === undefined ? {} : { key: opts.key }), ...(opts.pureKey === true ? { pureKey: true } : {}), ...(opts.sceneShapeKey === true ? { sceneShapeKey: true } : {}), ...(opts.textures === undefined ? {} : { textures: [...opts.textures] }) };
  state.entries = [...state.entries, entry].sort((a, b) => a.order - b.order || a.seq - b.seq);
  const keyBefore = state.key, explicitBefore = state.explicitKey;
  const { key } = opts;
  if (typeof key === 'string') { state.key = () => key; state.explicitKey = true; } else if (key !== undefined) {
    // the old `const k = mat.customProgramCacheKey.bind(mat)` read three's default lazily: the outermost hook's text
    const prior = keyBefore ?? ((): string => defaultKey(state.entries));
    state.key = () => key(prior());
    state.explicitKey = true;
  }
  const undo = (): void => {
    if (!state.entries.includes(entry)) return;
    state.entries = state.entries.filter((e) => e !== entry);
    state.observedTextures.clear();
    state.key = keyBefore; state.explicitKey = explicitBefore;
    if (mat.onBeforeCompile !== state.runner || !state.entries.every((e) => e.id === 'inherited')) return;
    // nothing of the registry's is left: put the material's own hook and key back exactly as they were
    const restore = (name: 'onBeforeCompile' | 'customProgramCacheKey', d: PropertyDescriptor | undefined): void => {
      if (d) Object.defineProperty(mat, name, d); else Reflect.deleteProperty(mat, name);
    };
    restore('onBeforeCompile', state.before.hook); restore('customProgramCacheKey', state.before.key);
    states.delete(mat);
  };
  opts.scope?.onDispose(undo);
  return undo;
}

/** per patched material: its patch suffix and keys, and the finished keys by renderer key (a node material is asked for
 *  its key on every draw, and each answer concatenated anew: ~345 MiB in a 20 s steady Nalati window), kept only when every
 *  patch key is a string or declared `pureKey` */
const nodePatchKeys = new WeakMap<State, { readonly entries: readonly Entry[]; readonly suffix: string; readonly keys: readonly ShaderPatchKey[]; readonly results: Map<string, string> | null;
  /** the last renderer key asked and its result: a node key runs to hundreds of KB, and the warm draw passes the same kept
   *  string each time (`===` is a pointer test then; a Map lookup by it hashed or compared it whole on JavaScriptCore) */
  lastIn: string | null; lastOut: string }>();
/** finished keys a material keeps at once (its key contexts: the screen and the targets a frame draws it into) */
const PATCH_KEY_RESULTS = 16;
/** Retain registered source patches when a node renderer supplies its own context/program key. */
export function shaderPatchProgramKey(material: THREE.Material, rendererKey: string): string {
  const state = states.get(material);
  if (state === undefined || material.onBeforeCompile !== state.runner) return rendererKey;
  let memo = nodePatchKeys.get(state);
  if (memo === undefined || memo.entries !== state.entries) {
    const own = state.entries.filter(entry => entry.id !== 'inherited');
    memo = { entries: state.entries, suffix: own.length === 0 ? '' : `|${defaultKey(state.entries)}|${own.map(entry => entry.id).join('|')}`, lastIn: null, lastOut: '',
      keys: [...own].sort((a, b) => a.seq - b.seq).flatMap(entry => entry.key === undefined ? [] : [entry.key]),
      results: own.every(entry => entry.key === undefined || typeof entry.key === 'string' || entry.pureKey === true) ? new Map() : null };
    nodePatchKeys.set(state, memo);
  }
  const results = memo.results;
  if (results !== null && memo.lastIn === rendererKey) return memo.lastOut;
  const known = results?.get(rendererKey);
  if (known !== undefined) { memo.lastIn = rendererKey; memo.lastOut = known; return known; }
  let key = rendererKey + memo.suffix;
  for (const operation of memo.keys) key = typeof operation === 'string' ? `${key}|${operation}` : operation(key);
  if (results !== null) { if (results.size >= PATCH_KEY_RESULTS) results.clear(); results.set(rendererKey, key); memo.lastIn = rendererKey; memo.lastOut = key; }
  return key;
}

/**
 * Give `to` (a fresh `clone()` of `from`: three's `copy` drops `onBeforeCompile` and `customProgramCacheKey`) the patch
 * chain and program key `from` runs now, so both compile one program source under one key. The patch functions are the
 * same closures, so uniforms a patch hands the shader stay shared. A snapshot: patches added to either material later
 * stay its own. No-op when `from` has no registry patches.
 */
/** `mat`'s patch set as `shaderPatchProgramKey` folds it in: an identity that changes with any patch added, removed or
 *  replaced (the entry list is never edited in place), null while none runs, a fresh object while a key is not pure. A
 *  caller that kept a final key may reuse it while this and its renderer key stay the same objects, with no compare of the
 *  key text. */
export function shaderPatchSet(mat: THREE.Material): object | null {
  const state = states.get(mat);
  if (state === undefined || mat.onBeforeCompile !== state.runner) return null;
  // a key function not marked pure may answer differently each ask: a fresh object, never matched, so it is asked again
  const memo = nodePatchKeys.get(state);
  return memo !== undefined && memo.entries === state.entries && memo.results !== null ? state.entries : {};
}

const sceneShapePatches = new WeakMap<State, { readonly entries: readonly Entry[]; readonly safe: boolean }>();

/** Only explicitly certified patch chains can share equivalent scene shader
 * shapes. An inherited own callback or an unkeyed/custom patch stays strict. */
export function shaderPatchSceneShape(mat: THREE.Material): boolean {
  const state = states.get(mat);
  if (state === undefined || mat.onBeforeCompile !== state.runner) return !Object.hasOwn(mat, 'onBeforeCompile');
  const held = sceneShapePatches.get(state);
  if (held?.entries === state.entries) return held.safe;
  const safe = state.before.hook === undefined && state.entries.every(entry => entry.id === 'inherited'
    || entry.sceneShapeKey === true && entry.pureKey === true && entry.key !== undefined);
  sceneShapePatches.set(state, { entries: state.entries, safe });
  return safe;
}

/** Whether `mat` carries a patch entry `id` (its own, or copied in by `copyShaderPatches`). */
export function hasShaderPatch(mat: THREE.Material, id: string): boolean { return states.get(mat)?.entries.some((e) => e.id === id) ?? false; }

export function copyShaderPatches(from: THREE.Material, to: THREE.Material): void {
  const source = states.get(from);
  if (source === undefined || from.onBeforeCompile !== source.runner) return;
  const before = { hook: Object.getOwnPropertyDescriptor(to, 'onBeforeCompile'), key: Object.getOwnPropertyDescriptor(to, 'customProgramCacheKey') };
  const key = from.customProgramCacheKey === source.keyFn ? source.key : ownKey(from);
  const state: State = {
    entries: [...source.entries], observedTextures: new Set(source.observedTextures), key, explicitKey: source.explicitKey, before,
    runner: (shader, renderer) => { runEntries(state, shader, renderer); },
    keyFn: () => (state.key === null ? defaultKey(state.entries) : state.key()),
  };
  states.set(to, state);
  to.onBeforeCompile = state.runner;
  to.customProgramCacheKey = state.keyFn;
}

/**
 * The hook every material inherits until a `replace` patch drops it (Atmosphere's fog uniforms). It stays on the
 * prototype, as before, so three's default key (its source text) is the one every unpatched material shares.
 * An optional scoped chain restores the previous inherited hook when disposed.
 */
export function setInheritedPatch(fn: (shader: ShaderSource) => void, options: { scope?: Scope; chain?: boolean } = {}): void {
  const before = Object.getOwnPropertyDescriptor(THREE.Material.prototype, 'onBeforeCompile');
  const inherited = THREE.Material.prototype.onBeforeCompile.bind(THREE.Material.prototype);
  const hook: ShaderPatchFn = options.chain === true ? (shader, renderer) => { inherited(shader, renderer); fn(shader); } : fn;
  THREE.Material.prototype.onBeforeCompile = hook;
  options.scope?.onDispose(() => {
    if (THREE.Material.prototype.onBeforeCompile !== hook) return;
    if (before !== undefined) Object.defineProperty(THREE.Material.prototype, 'onBeforeCompile', before);
    else Reflect.deleteProperty(THREE.Material.prototype, 'onBeforeCompile');
  });
}

/** Set a material's program-cache key with no source patch (a ShaderMaterial whose source is its own). */
export function setProgramKey(mat: THREE.Material, key: string): void {
  const fixed = (): string => key;
  mat.customProgramCacheKey = fixed;
}

/** Whether a site gave the material a program key of its own (Sky.fillSlots skips those). */
export function hasProgramKey(mat: THREE.Material): boolean {
  const state = states.get(mat);
  if (state !== undefined && mat.customProgramCacheKey === state.keyFn) return state.explicitKey;
  return Object.hasOwn(mat, 'customProgramCacheKey');
}


/** Borrowed textures declared by active shader patches, deduplicated in patch order.
 * Copy/undo follows the patch chain without running callbacks or disposing content resources. */
export function shaderPatchTextures(mat: THREE.Material): readonly THREE.Texture[] {
  const state = states.get(mat);
  if (state === undefined || mat.onBeforeCompile !== state.runner) return [];
  return [...new Set([...state.entries.flatMap(entry => entry.textures ?? []), ...state.observedTextures])];
}
