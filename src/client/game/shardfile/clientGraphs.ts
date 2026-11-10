import { sceneScalarValue } from './sceneInputs';
/**
 * The shardfile's graph materials on the client (SHARD-PLATFORM SF59 step 5): a `look.materials` (or skin binding) entry
 * `{ family: "graph", graph }` compiles to a classic GLSL program through the engine's lazy graph back-end
 * (`render/graphBackend.ts`'s `loadLookGraphCompiler`).
 *
 * - **Admitted names only:** every graph is validated against the shard's real binding lists (`graphBindingSources`: the
 *   day-key channels its look keys carry and its declared public numeric state fields), never a compiler default that
 *   allows any name. A graph that binds anything else is refused (it throws), whether the Debug row is on or off.
 * - **Params move, programs stay:** each bound param is a uniform the per-frame `tick` moves with `setParam`: a day binding
 *   samples the shard's own look keys at the frame owner's hour (G158: one world clock; the owner's fog and grade then
 *   apply on top through the engine epilogue), a state binding reads the live state source or the field's declared default.
 * - **Textures** resolve to the admitted, charged KTX2 library textures (colour role).
 * - **Budget:** explicit trusted declarations refuse above their ceilings. Legacy graphs past the default budget fall back
 *   to their family preset (a standard graph → the plain
 *   vertex-coloured PBR family, an unlit one → the plain emissive family) instead of compiling. So does every graph while the
 *   default-off Debug row (Look ▸ "Graph materials") is off: the first graph-compiled look waits for a physical-iPhone
 *   reading (RENDERING.md; sf59-tsl-spike.md §5's cost flag).
 * - **Declared fog (O11):** a `kind: 'fog'` entry is the shard's own fog, compiled once (an inert carrier material keeps
 *   its `setParam` / `setTexture` by catalogue id and its bound params on the feeds); a material graph whose
 *   `effectState.fog` names it is fogged by it instead of the engine fog (the engine epilogue runs the fog graph's stage).
 * - **Outlines:** a compiled graph that declares `stages.outline` also has its hull material (`outline(material)`); the
 *   views attach it to every mesh they bind that material to as its second draw (`graphOutlineHook`, the engine's
 *   `attachOutline`: a child mesh over the same buffers, an instanced mesh's own matrices). A fallback preset has none, so a
 *   graph without an outline, or any graph while the row is off, draws exactly as before. The outline's instructions are
 *   already in the graph's admitted cost (`validateGraph` counts the `outlineVertex` / `outline` programs).
 */
import type { ToonLook } from '@wildshard/engine/render/families/toon';
import { Color, Mesh, PointsMaterial, SRGBColorSpace, type Material, type Object3D, type Texture } from 'three';
import { DEFAULT_GRAPH_BUDGET, validateGraph, type GraphBinding, type GraphValidation, type GraphBudget, type GraphIr, type GraphParamType, type GraphLiteral } from '@wildshard/format/materialGraph';
import { DATA_LOOK_DAY, dataLookClock, lookSample, sampleLook, type LookSample } from '@wildshard/engine/render/dataLook';
import { graphMeshMapBase, type LookGraphCompiler, type LookGraphFog } from '@wildshard/engine/render/graphBackend';
import type { Scope } from '@wildshard/engine/app/scope';
import { graphBindingSources, graphFileJson, graphFileTextureRefs, presetLooks } from '@wildshard/format/materials';
import { GRAPH_PRESET_VERSION, parseFamilyMaterial } from '@wildshard/format/materialFamilies';
import { familyPresetGraph, PRESET_CLOCK_PARAMS, PRESET_GRAPH_BUDGET } from '@wildshard/engine/render/graph/presets';
import type { Shardfile } from '@wildshard/format/shardSchema';

/**
 * A graph material entry as the catalogue and a skin binding carry it: inline IR (`graph`), a graph file of the library
 * closure (`file`, a hash) or an engine-owned preset reference (`preset`, a family entry, with its `version`).
 */
export interface GraphMaterialEntry { readonly family: 'graph'; readonly graph?: unknown; readonly file?: unknown; readonly preset?: unknown; readonly version?: unknown }
/** Is this material entry a graph (the family selector only; the graph itself is validated on compile)? */
export function isGraphEntry(entry: unknown): entry is GraphMaterialEntry {
  return typeof entry === 'object' && entry !== null && !Array.isArray(entry) && Reflect.get(entry, 'family') === 'graph';
}

/** Where bound params read their values: the frame owner's hour (0–24) and a declared state field's live value. */
export interface GraphSources {
  readonly hour?: () => number | null;
  readonly state?: (scope: 'shared' | 'player', name: string) => number | undefined;
}
/** What happened to each graph entry (tests, the debug handle). */
export interface GraphReadout { compiled: number; fallback: number; reasons: string[] }

/** A compiled graph's outline stage: its hull material and the attach that adds it to a mesh as the second draw. */
export interface GraphOutline { readonly material: Material; readonly attach: (mesh: Mesh) => Mesh }
/** Attach `material`'s outline (when its graph declares one) to every mesh under `root`; the hulls go with `scope`. */
/** `onlyRoot` binds the named runtime mesh alone, leaving its children in their own materials. */
export type GraphOutlineHook = (root: Object3D, material: Material, scope: Scope, onlyRoot?: boolean) => readonly Mesh[];

function isMesh(object: Object3D): object is Mesh { return object instanceof Mesh; }
/** every live body the hook outlined and every hull it attached (a root walked twice gets no second hull) */
const outlined = new WeakSet<Mesh>();
/**
 * The mesh-level outline hook over `outline` (a material's stage, or null): every mesh under `root` (root included) gets
 * the hull as a child; on `scope`'s disposal each hull leaves its parent and its own geometry (a shallow copy whose
 * attributes the body owns) is disposed. A material without an outline attaches nothing and touches no mesh.
 */
export function graphOutlineHook(outline: (material: Material) => GraphOutline | null): GraphOutlineHook {
  return (root, material, scope, onlyRoot = false) => {
    const stage = outline(material);
    if (stage === null) return [];
    const bodies: Mesh[] = [];
    if (onlyRoot) { if (isMesh(root) && !outlined.has(root)) bodies.push(root); }
    else root.traverse((object) => { if (isMesh(object) && !outlined.has(object)) bodies.push(object); });
    return bodies.map((mesh) => {
      const hull = stage.attach(mesh);
      outlined.add(mesh); outlined.add(hull);
      scope.onDispose(() => { hull.removeFromParent(); hull.geometry.dispose(); outlined.delete(mesh); });
      return hull;
    });
  };
}

/** One bound param's feed, prepared once. */
interface Feed { readonly set: () => void }

/** The bound-param side of a set of compiled graphs: `attach` wires a compiled graph's bindings, `tick` / `bind` move them. */
export interface GraphParamFeeds {
  /** wire every bound param of `compiled` (its declared types in `params`) and set them once now */
  readonly attach: (compiled: { readonly bindings: readonly { readonly param: string; readonly bind: GraphBinding }[]; readonly setParam: (name: string, value: readonly number[] | number) => void }, params: GraphIr['params']) => void;
  /** advance the shard's own clock (when no frame owner's hour is bound) and move every bound param */
  readonly tick: (dt: number) => void;
  /** hand the feeds their live sources (the frame owner's hour, the shard state) and move every bound param */
  readonly bind: (sources: GraphSources) => void;
  /** how many bound params are wired */
  readonly count: () => number;
}

/**
 * The feeds of a shard's bound graph params (SF59): a day binding samples the shard's own look keys at the frame owner's
 * hour (its own day clock until one is bound), a state binding reads the live state source or the field's declared
 * default. Shared by the material graphs and the shard's post stack (`clientPost.ts`), so both read one clock.
 */
export function graphParamFeeds(source: Pick<Shardfile, 'identity' | 'look' | 'state'>): GraphParamFeeds {
  const feeds: Feed[] = [];
  let sources: GraphSources = {}, dayBound = false;
  const ownClock = source.look.keys.length > 0 ? dataLookClock(source.look.day ?? DATA_LOOK_DAY, source.look.dayOverride) : null;
  const sample: LookSample = lookSample();
  const hostFields = new Set(source.state.shared.filter(field => field.privacy === 'host').map(field => field.name));
  const defaults = new Map<string, number>();
  for (const scope of ['shared', 'player'] as const) for (const field of source.state[scope]) if (typeof field.default === 'number') defaults.set(`${scope}.${field.name}`, field.default);
  const srgb = new Color();
  const feed = (setParam: (name: string, value: readonly number[] | number) => void, param: string, type: GraphParamType, bind: GraphBinding): Feed => {
    if ('state' in bind) {
      const key = bind.state, dot = key.indexOf('.'), scope = key.slice(0, dot), name = key.slice(dot + 1);
      const fallback = defaults.get(key) ?? 0, live = scope === 'shared' || scope === 'player' ? scope : null;
      if (live === null) throw new Error(`material graph: state binding ${key} has no scope`);
      return { set: () => { setParam(param, sources.state?.(live, name) ?? (live === 'shared' && hostFields.has(name) ? sceneScalarValue(source.identity.slug, name) : undefined) ?? fallback); } };
    }
    dayBound = true;
    const channel = bind.day, out = [0, 0, 0];
    const colour = (pick: (s: LookSample) => Color): Feed => ({ set: () => {
      const c = pick(sample);
      // key colours are stored linear; a `colour` param is written in sRGB (the compiler holds it linear), a vec3 takes them as they are
      if (type === 'colour') { srgb.copy(c); srgb.getRGB(srgb, SRGBColorSpace); out[0] = srgb.r; out[1] = srgb.g; out[2] = srgb.b; } else { out[0] = c.r; out[1] = c.g; out[2] = c.b; }
      setParam(param, out);
    } });
    const scalar = (pick: (s: LookSample) => number): Feed => ({ set: () => { setParam(param, pick(sample)); } });
    switch (channel) {
      case 'sky.zenith': return colour((s) => s.zenith);
      case 'sky.horizon': return colour((s) => s.horizon);
      case 'fog.colour': return colour((s) => s.fog);
      case 'sun.colour': return colour((s) => s.sun);
      case 'ambient.sky': return colour((s) => s.ambientSky);
      case 'ambient.ground': return colour((s) => s.ambientGround);
      case 'fog.density': return scalar((s) => s.fogDensity);
      case 'fog.near': return scalar((s) => s.fogNear ?? 0);
      case 'fog.far': return scalar((s) => s.fogFar ?? 0);
      case 'sun.intensity': return scalar((s) => s.sunIntensity);
      case 'ambient.intensity': return scalar((s) => s.ambientIntensity);
      default: throw new Error(`material graph: unknown day key ${channel}`);
    }
  };
  const hour = (): number => sources.hour?.() ?? ownClock?.hour ?? 12;
  const refresh = (): void => {
    if (dayBound && source.look.keys.length > 0) sampleLook(source.look.keys, hour() / 24, sample);
    for (const f of feeds) f.set();
  };
  return {
    attach: (compiled, params) => {
      for (const { param, bind } of compiled.bindings) {
        const spec = params?.[param]; if (spec === undefined) throw new Error(`material graph: no param ${param}`);
        feeds.push(feed((name, value) => { compiled.setParam(name, value); }, param, spec.type, bind));
      }
      refresh(); // the first frame already carries the bound values
    },
    tick: (dt) => { if (feeds.length === 0) return; if (sources.hour === undefined) ownClock?.update(dt); refresh(); },
    bind: (next) => { sources = { ...sources, ...next }; if (feeds.length > 0) refresh(); },
    count: () => feeds.length,
  };
}

/** A family entry a graph falls back to: the plain preset of its lighting model. */
export function graphFallbackEntry(graph: Pick<GraphIr, 'model' | 'doubleSided' | 'flatShading'>): Readonly<Record<string, unknown>> {
  // as clientMaterials' implicit family surfaces: plain and vertex-coloured, PBR dielectric
  const doubleSided = graph.doubleSided ?? false;
  if (graph.model === 'toon') return { family: 'toon', vertexColours: true, doubleSided, faceted: graph.flatShading ?? true };
  return graph.model === 'unlit' ? { family: 'emissive', vertexColours: true, doubleSided } : { family: 'pbr', vertexColours: true, metalness: 0, doubleSided };
}

/**
 * The graph side of a shardfile's materials. `compiler` is null while the Debug row is off (every graph falls back);
 * `fallback` compiles a family entry on the family looks; `textures` resolves an admitted texture reference.
 * `trustedGraphs` is host authority from an admitted runtime, never a field read from graph JSON.
 * An explicit budget refuses on admission failure instead of using a family material.
 */
/**
 * NINE-DRAGON-BENCHMAX NB2: graph files' passing validations, by file hash and the admitted lists they passed under. A
 * file's hash names its bytes, so a second compile of that file under the same lists (every material catalogue of a world
 * compiles its own copy: Nine's props compiled each architecture graph three times) skips the parse and the validation,
 * and hands the emitter the same validated IR, whose lowering it keeps too (glslMaterial's `emittedGraph`). Least
 * recently used first out past VALIDATED_FILES_KEPT, so a long session's shards never pile up.
 */
const VALIDATED_FILES_KEPT = 96;
const validatedFiles = new Map<string, Extract<GraphValidation, { ok: true }>>();
const fileTextureRefs = new Map<string, readonly string[]>();
function keepValidatedFile(key: string, checked: Extract<GraphValidation, { ok: true }>): void {
  validatedFiles.set(key, checked);
  for (const oldest of validatedFiles.keys()) { if (validatedFiles.size <= VALIDATED_FILES_KEPT) break; validatedFiles.delete(oldest); }
}
/** Forget every kept graph file validation and texture list (tests). */
export function forgetValidatedGraphFiles(): void { validatedFiles.clear(); fileTextureRefs.clear(); }

/** NB2: each graph file's texture params, by hash (`graphFileTextureRefs` parses every graph file of a catalogue to read
 *  them, and every material catalogue of a world asked again: Nine's ~370 ms of JSON at CPU x8). Same refs, same order. */
export function keptGraphFileTextureRefs(materials: Shardfile['look']['materials'], bytes: (hash: string) => Uint8Array | undefined): string[] {
  const refs: string[] = [];
  for (const [id, material] of Object.entries(materials)) {
    if (material.family !== 'graph' || !('file' in material)) continue;
    const known = fileTextureRefs.get(material.file);
    if (known !== undefined) { fileTextureRefs.delete(material.file); fileTextureRefs.set(material.file, known); refs.push(...known); continue; }
    // a missing file names none and is not kept: its bytes may be admitted later
    if (bytes(material.file) === undefined) continue;
    const read = graphFileTextureRefs({ [id]: material }, bytes);
    fileTextureRefs.set(material.file, read); refs.push(...read);
    for (const oldest of fileTextureRefs.keys()) { if (fileTextureRefs.size <= VALIDATED_FILES_KEPT) break; fileTextureRefs.delete(oldest); }
  }
  return refs;
}

export function clientGraphs(source:Pick<Shardfile, 'identity' | 'look' | 'state'> & Partial<Pick<Shardfile, 'runtime' | 'questHost'>>, options: { compiler: LookGraphCompiler | null; toon?: ToonLook; trustedGraphs?: boolean; fallback: (entry: Readonly<Record<string, unknown>>) => Material; textures: (ref: string, role?: 'colour' | 'data') => Texture; file?: (hash: string) => Uint8Array | undefined }): {
  /** Update a compiled material uniform; unknown/fallback materials and invalid values refuse. */
  setParam: (material: Material, name: string, value: GraphLiteral) => void;
  /** Lend a compiled material's `role: 'lent'` texture param its texture; unknown/fallback materials refuse. */
  setTexture: (material: Material, name: string, texture: Texture) => void;
  compile: (entry: GraphMaterialEntry) => Material; tick: (dt: number) => void; bind: (sources: GraphSources) => void; readout: GraphReadout;
  /** the outline stage of a material this compiled (null: no `stages.outline`, a fallback preset, or not a graph) */
  outline: (material: Material) => GraphOutline | null;
} {
  const lists = graphBindingSources(source), dayKeys = [...lists.day.keys()], stateFields = lists.state;
  const feeds = graphParamFeeds(source), readout: GraphReadout = { compiled: 0, fallback: 0, reasons: [] };
  const outlines = new WeakMap<Material, GraphOutline>();
  const setters = new WeakMap<Material, (name: string, value: GraphLiteral) => void>();
  const lenders = new WeakMap<Material, (name: string, texture: Texture) => void>();
  // the classic back-end behind the look-material contract (null: the Debug row off, every graph falls back)
  const lookCompiler = options.compiler;
  /** the shard's declared fogs (O11): each `kind: 'fog'` entry compiles once (its carrier, by entry) and lends its patch */
  const fogCarriers = new WeakMap<GraphMaterialEntry, Material>();
  const fogPatches = new WeakMap<Material, LookGraphFog>();

  const looks = presetLooks(source.look.familyLooks);
  /** the preset clocks: seconds since the client was made, as each family look's own clock (both tick by dt) */
  let elapsed = 0;
  const clocks: (() => void)[] = [];
  /**
   * an entry → the IR a compiler receives and its budget: a preset through the engine-owned door under the preset budget
   * (`family` is its entry, what it draws while the row is off), a graph file's JSON and inline IR under the author caps
   */
  const resolve = (entry: GraphMaterialEntry): { graph: unknown; budget: GraphBudget; preset: boolean; family: Readonly<Record<string, unknown>> | null } => {
    if (entry.preset !== undefined) {
      if (entry.version !== GRAPH_PRESET_VERSION) throw new Error(`material graph refused: preset version ${String(entry.version)} (${GRAPH_PRESET_VERSION})`);
      const family = parseFamilyMaterial(entry.preset);
      return { graph: familyPresetGraph(family, looks), budget: PRESET_GRAPH_BUDGET, preset: true, family };
    }
    if (typeof entry.file === 'string') return { graph: graphFileJson(entry.file, (hash) => options.file?.(hash)), budget: DEFAULT_GRAPH_BUDGET, preset: false, family: null };
    return { graph: entry.graph, budget: DEFAULT_GRAPH_BUDGET, preset: false, family: null };
  };
  const pointFallback = (): Material => {
    const material = new PointsMaterial({ size: 1, sizeAttenuation: false, vertexColors: true });
    material.userData['graphPrimitive'] = 'points';
    return material;
  };
  // NB2: a graph file's passing validation under these lists, as validateFile keeps it
  const fileLists = JSON.stringify([dayKeys, stateFields, options.trustedGraphs === true]);
  const compile = (entry: GraphMaterialEntry): Material => {
    const carried = fogCarriers.get(entry); if (carried !== undefined) return carried;
    const fileKey = entry.preset === undefined && typeof entry.file === 'string' ? `${entry.file}|${fileLists}` : null;
    const known = fileKey === null ? undefined : validatedFiles.get(fileKey);
    if (known !== undefined && fileKey !== null) { validatedFiles.delete(fileKey); validatedFiles.set(fileKey, known); }
    const resolved = known === undefined ? resolve(entry) : { graph: known.graph, budget: DEFAULT_GRAPH_BUDGET, preset: false, family: null }, graph = resolved.graph, budget = resolved.budget;
    // a preset reference while the row is off draws its own family: the preset is held to parity with it
    if (resolved.family !== null && lookCompiler === null) { readout.fallback++; readout.reasons.push('graph materials row off'); return options.fallback(resolved.family); }
    // validation with the admitted lists first: a refusal (an unknown binding, a bad program) throws, row on or off
    const checked = known ?? validateGraph(graph, { dayKeys, stateFields, budget, trustedBudget: options.trustedGraphs === true });
    if (known === undefined && fileKey !== null && checked.ok) keepValidatedFile(fileKey, checked);
    if (!checked.ok) {
      if (typeof graph === 'object' && graph !== null && Reflect.has(graph, 'budget')) throw new Error(`material graph refused: ${checked.errors.join('; ')}`);
      const refusals = checked.errors.filter((error) => !error.startsWith('budget:'));
      if (refusals.length > 0) throw new Error(`material graph refused:\n  ${refusals.join('\n  ')}`);
      // only the budget refused it: the shape is valid, so its lighting model picks the preset
      if (resolved.family !== null) { readout.fallback++; readout.reasons.push(checked.errors.join('; ')); return options.fallback(resolved.family); }
      const shape: object = typeof graph === 'object' && graph !== null ? graph : {};
      readout.fallback++; readout.reasons.push(checked.errors.join('; '));
      if (Reflect.get(shape, 'primitive') === 'points') return pointFallback();
      return options.fallback(graphFallbackEntry({ model: Reflect.get(shape, 'model') === 'toon' ? 'toon' : Reflect.get(shape, 'model') === 'unlit' ? 'unlit' : 'standard', doubleSided: Reflect.get(shape, 'doubleSided') === true }));
    }
    const ir = checked.graph;
    if (lookCompiler === null) {
      readout.fallback++; readout.reasons.push('graph materials row off');
      return ir.primitive === 'points' ? pointFallback() : options.fallback(graphFallbackEntry(ir));
    }
    // a toon preset leaves the environment's diffuse out, as its family does (the tone-parity harness, scripts/tone-parity)
    const compiler = lookCompiler, compiled = compiler.compileGraph(ir, { ...(options.toon === undefined ? {} : { toon: options.toon }), ...(resolved.family?.['family'] === 'toon' ? { replaceEnvironmentDiffuse: true } : {}), dayKeys, stateFields, budget, trustedBudget: options.trustedGraphs === true, textures: options.textures, fog: fogFor, validated: checked });
    if (compiled.fog !== null) { fogPatches.set(compiled.material, compiled.fog); fogCarriers.set(entry, compiled.material); }
    if (resolved.preset) for (const name of PRESET_CLOCK_PARAMS) if (ir.params?.[name] !== undefined) { compiled.setParam(name, elapsed); clocks.push(() => { compiled.setParam(name, elapsed); }); }
    setters.set(compiled.material, compiled.setParam);
    lenders.set(compiled.material, compiled.setTexture);
    const hull = compiled.outline;
    if (hull !== null) outlines.set(compiled.material, { material: hull, attach: (mesh) => compiler.attachOutline(mesh, hull) });
    feeds.attach(compiled, ir.params);
    readout.compiled++;
    return compiled.material;
  };
  function fogFor(id: string): LookGraphFog {
    const entry: unknown = source.look.materials[id];
    if (!isGraphEntry(entry)) throw new Error(`material graph: fog ${id} is not a graph of this look catalogue`);
    const patch = fogPatches.get(compile(entry));
    if (patch === undefined) throw new Error(`material graph: ${id} is not a compiled fog graph`);
    return patch;
  }
  return {
    setParam: (material, name, value) => {
      const set = setters.get(graphMeshMapBase(material));
      if (set === undefined) throw new Error('Material has no compiled graph parameters');
      set(name, value);
    },
    setTexture: (material, name, texture) => {
      const lend = lenders.get(graphMeshMapBase(material));
      if (lend === undefined) throw new Error('Material has no compiled graph textures');
      lend(name, texture);
    },
    compile, readout, outline: (material) => outlines.get(graphMeshMapBase(material)) ?? null,
    tick: (dt) => { elapsed += dt; for (const clock of clocks) clock(); feeds.tick(dt); },
    bind: feeds.bind,
  };
}
