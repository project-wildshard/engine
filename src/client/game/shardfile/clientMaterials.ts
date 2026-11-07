import { sceneVectors, sceneScalarValue } from './sceneInputs';
/**
 * The shardfile loader's materials (SHARD-PLATFORM SF15a): the look's material catalogue (`look.materials`, SF10a's
 * family entries) and its family looks compiled on the game's renderer, with every texture an admitted KTX2 file
 * transcoded once (its mips dropped from JS after upload). A family named by the look, the terrain or the props without
 * its own entry gets the family's plain default, vertex-coloured (PBR's dielectric). No URL, no shader source and no callback comes from the shard.
 */
import { MeshStandardMaterial, ClampToEdgeWrapping, CompressedTexture, DataTexture, LinearFilter, LinearMipmapLinearFilter, MirroredRepeatWrapping, NearestFilter, NearestMipmapNearestFilter, RepeatWrapping, SRGBColorSpace, NoColorSpace, type Texture, type Material } from 'three';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { BASIS_PATH, releaseAfterUpload, detectKtx2Support, prepareKtx2Decode } from '@wildshard/engine/core/ktx2';
import { markGpuOnly } from '@wildshard/engine/core/gpuOnly';
import { ToonLook } from '@wildshard/engine/render/families/toon';
import { PainterlyLook } from '@wildshard/engine/render/families/painterly';
import { EmissiveLook } from '@wildshard/engine/render/families/emissive';
import { familyMaterial, moveFamilyMaterial } from '@wildshard/engine/render/families/registry';
import { bindStandardLightmap, setStandardLightmap } from '@wildshard/engine/render/lightmaps';
import { parseFamilyMaterial } from '@wildshard/format/materialFamilies';
import type { Scope } from '@wildshard/engine/app/scope';
import { ownSceneResource } from '@wildshard/engine/app/sceneOwnership';
import type { Renderer } from '@wildshard/engine/render/renderer';
import type { GraphLiteral } from '@wildshard/format/materialGraph';
import type { LookInstance } from './lentLooks';
import type { Shardfile } from '@wildshard/format/shardSchema';
import { buildYield, workSlice } from '@wildshard/engine/core/workSlice';
import { loadLookGraphCompiler, bindGraphMeshMap } from '@wildshard/engine/render/graphBackend';
import { curvedParams, graphFileTextureRefs, materialTextureRefs } from '@wildshard/format/materials';
import { clientGraphs, graphOutlineHook, isGraphEntry, type GraphOutlineHook, type GraphReadout, type GraphSources } from './clientGraphs';
import { parseSkinFile, skinLookParameters } from '@wildshard/format/skinAssets';
import { SKIN_LOOK_RECIPE } from '@wildshard/format/skins';
import type { PropSurfaceBinding } from '@wildshard/engine/world/declaredProps';
import { propMaterialTextureRefs, propMaterialsOf } from '@wildshard/format/propMaterials';
import { ownedGraph, propSurfaces } from './clientPropMaterials';
import { splatDrawTier } from '@wildshard/engine/boot/gpuFiles';
import { splatSurface, withSplatSurface } from './clientSplatTerrain';
import { splatTerrainOf, splatTextureRefs } from '@wildshard/format/splatTerrain';
import { hasDeclaredClientPage } from '@wildshard/format/runtimeBinds';

/** Whether a shard's graphs keep their declared ceilings: admission gives a runtime or a declared page to first-party products alone (product.ts). */
export function admittedGraphAuthority(source: Pick<Shardfile, 'runtime'> & Partial<Pick<Shardfile, 'questHost'>>): boolean { return source.runtime !== null || hasDeclaredClientPage(source); }

/** Defer unused graph catalogue entries until a view actually asks for them. Iteration still resolves every declared ID. */
class MaterialCatalogue implements ReadonlyMap<string, Material> {
  readonly [Symbol.toStringTag] = 'Map';
  private readonly factories = new Map<string, () => Material>();
  private readonly ready = new Map<string, Material>();
  get size(): number { return this.factories.size; }
  set(id: string, material: Material): void { this.factories.set(id, () => material); this.ready.set(id, material); }
  defer(id: string, make: () => Material): void { this.factories.set(id, make); }
  has(id: string): boolean { return this.factories.has(id); }
  /** whether `id` is declared and not yet made */
  pending(id: string): boolean { return this.factories.has(id) && !this.ready.has(id); }
  get(id: string): Material | undefined {
    const found = this.ready.get(id); if (found !== undefined) return found;
    const make = this.factories.get(id); if (make === undefined) return undefined;
    const material = make(); this.ready.set(id, material); return material;
  }
  keys(): MapIterator<string> { return this.factories.keys(); }
  entries(): MapIterator<[string, Material]> {
    const entries = new Map<string, Material>();
    for (const id of this.keys()) { const material = this.get(id); if (material === undefined) throw new Error(`Missing declared material ${id}`); entries.set(id, material); }
    return entries.entries();
  }
  values(): MapIterator<Material> { return new Map(this.entries()).values(); }
  [Symbol.iterator](): MapIterator<[string, Material]> { return this.entries(); }
  forEach(callback: (material: Material, id: string, map: ReadonlyMap<string, Material>) => void, thisArg?: unknown): void {
    for (const [id, material] of this.entries()) callback.call(thisArg, material, id, this);
  }
}

const WRAPS = { repeat: RepeatWrapping, clamp: ClampToEdgeWrapping, mirror: MirroredRepeatWrapping } as const;
/**
 * A look sampler row on a just-transcoded texture, before its first upload: wrap, anisotropy (three caps it at the device's),
 * filter and mips. `mips: 'gpu'` keeps level 0 of a raw KTX2 (a data texture) and lets the GPU build the chain at upload;
 * a transcoded (compressed) texture cannot be mipmapped by the GPU, so the row refuses it.
 */
export function applyTextureSampler(texture: Texture, row: NonNullable<Shardfile['look']['samplers']>[string]): void {
  if (row.wrap !== undefined) { texture.wrapS = WRAPS[row.wrap]; texture.wrapT = WRAPS[row.wrap]; }
  if (row.anisotropy !== undefined) texture.anisotropy = row.anisotropy;
  const gpu = row.mips === 'gpu';
  if (gpu) {
    if (texture instanceof CompressedTexture) throw new Error(`Sampler ${texture.name}: GPU mips need a raw (uncompressed) KTX2`);
    texture.mipmaps = []; texture.generateMipmaps = true;
  }
  const filter = row.filter ?? (gpu ? 'linear' : undefined);
  if (filter === undefined) return;
  const mipped = gpu || texture.mipmaps.length > 1;
  texture.magFilter = filter === 'linear' ? LinearFilter : NearestFilter;
  texture.minFilter = filter === 'linear' ? (mipped ? LinearMipmapLinearFilter : LinearFilter) : (mipped ? NearestMipmapNearestFilter : NearestFilter);
}

/** Does the shard carry a graph material, in its catalogue or in an admitted skin binding? */
function carriesGraph(shard: Shardfile, assets: ReadonlyMap<string, Uint8Array>): boolean {
  if (Object.values(shard.look.materials).some((entry) => entry.family === 'graph')) return true;
  return shard.rows.looks.some((row) => {
    if (row.recipe !== SKIN_LOOK_RECIPE) return false;
    const bytes = assets.get(skinLookParameters(row).skin);
    return bytes !== undefined && isGraphEntry(parseSkinFile(bytes).binding.material);
  });
}

/** A raw-texel file's DataTexture: three's KTX2 loader hands it its level list (`image.data` is level 0) and no update hook.
 *  Both go once it is on the GPU; a lost context reloads the page (gpuOnly.ts). */
function releaseRawAfterUpload(texture: DataTexture): void {
  texture.onUpdate = (): void => {
    texture.onUpdate = null;
    texture.mipmaps = [];
    if (ArrayBuffer.isView(texture.image.data)) texture.image.data = texture.image.data.slice(0, 0);
  };
  markGpuOnly('shardfile raw textures');
}

/**
 * Compile a shardfile's admitted material data on the game's renderer; `compile` adds one more entry (family or graph);
 * `bindMeshMap(id, map)` borrows a mesh map for one already compiled catalogue entry, without recompiling its graph.
 * `tick` advances the family looks' clocks and moves the graph materials' bound params; `graphs.bind` hands the graph
 * params their live sources (the frame owner's hour, the shard state). A `family: "graph"` entry compiles through the
 * lazy graph back-end (`options.graphs: false`, a renderer-free caller's, draws it as its family preset instead:
 * `clientGraphs.ts`). `outline` is the mesh-level hook the views call wherever
 * they bind a catalogue material: a compiled graph that declares `stages.outline` adds its hull as each mesh's second draw
 * (scope-owned with the material); every other material attaches nothing. `surfaces` (SF55) resolves a props GLB material
 * name to its base material and texture slots when the props declare named materials (`clientPropMaterials.ts`); null
 * keeps the one-family path. A family entry with `look.curves` (state-bound curves) compiles at its fields' values and
 * moves in `tick`, uniforms only, whenever a field it reads moved: the live state source `graphs.bind` hands over, else
 * the field's declared default.
 * `trustedGraphs` is supplied only by the admitted runtime host to authorize declared graph ceilings.
 */
export async function clientMaterials(shard: Shardfile, input: ReadonlyMap<string, Uint8Array>, renderer: Renderer, scope: Scope, options: { graphs?: boolean; sources?: GraphSources; trustedGraphs?: boolean } = {}): Promise<{
  /** Live toon family shared by classic and graph materials; a day clock may update it in place. */
  readonly toon: ToonLook;
  /** Set a named graph uniform through its declared type/range; no shader rebuild. */
  setParam: (id: string, name: string, value: GraphLiteral) => void;
  /** lend a compiled graph's `role: 'lent'` texture param its texture, by catalogue id (no program change) */
  setTexture: (id: string, name: string, texture: Texture) => void;
  materials: ReadonlyMap<string, Material>; textures: ReadonlyMap<string, Texture>; compile: (entry: unknown, meshMap?: Texture) => Material; bindMeshMap: (id: string, map: Texture | Material) => Material; tick: (dt: number) => void;
  /** a further compile of graph catalogue entry `id`, scope-owned, with its own param writer */
  instance?: (id: string) => LookInstance;
  /** compile each still-deferred graph look among `ids` in its own build step (in play, one a drawn frame), so its first
   *  lookup finds it made; rejects once the scope has closed */
  prepare?: (ids: readonly string[]) => Promise<void>;
  outline: GraphOutlineHook; graphs: { bind: (sources: GraphSources) => void; readout: GraphReadout }; surfaces: ((name: string) => PropSurfaceBinding | null) | null;
  /** the splat ground's material while its tiles draw (Debug ▸ Ground tiles), which the tile views merge (`groundMerge`) */
  ground?: Material | null;
}> {
  let assets = input;
  // every shard draws its declared graphs on every path: standalone, regional and grid near (G669 DR12)
  const graphsOn = options.graphs ?? true;
  const sampledMaterials = graphsOn ? shard.look.materials : Object.fromEntries(Object.entries(shard.look.materials).filter(([, entry]) => entry.family !== 'graph' || 'preset' in entry));
  const textures = new Map<string, Texture>(), uses = new Map<string, 'colour' | 'data'>();
  const named = shard.props === null ? undefined : propMaterialsOf(shard.props);
  const splat = shard.props === null ? undefined : splatTerrainOf(shard.props);
  const splatRefs = new Set(splat === undefined ? [] : splatTextureRefs(splat, splatDrawTier()));
  const refs = new Set([...materialTextureRefs(sampledMaterials), ...graphFileTextureRefs(sampledMaterials, (hash) => assets.get(hash)), ...(shard.props?.textures.map((entry) => entry.colour) ?? []), ...propMaterialTextureRefs(named), ...splatRefs]);
  if (refs.size > 0) {
    const loader = detectKtx2Support(new KTX2Loader().setTranscoderPath(BASIS_PATH), renderer);
    let retired = false;
    const retire = (): void => { if (retired) return;retired = true;loader.dispose(); };
    const forget = scope.capture('disposers', retire);
    // DL17: the zstd decoder starts here, on the caller's stack (a grid neighbour's admission, the home's boot)
    prepareKtx2Decode([...refs].map(ref => assets.get(ref)));
    try {
    for (const ref of refs) {
      const bytes = assets.get(ref); if (bytes === undefined) throw new Error(`Missing admitted material texture ${ref} (${shard.identity.slug})`);
      const texture = await new Promise<Texture>((resolve, reject) => { loader.parse(Uint8Array.from(bytes).buffer, resolve, reject); });
      if (scope.disposed) { texture.dispose(); throw new Error('Material scope unloaded during transcode'); }
      // a splat layer is copied into its array, never uploaded itself (clientSplatTerrain)
      texture.flipY = false; texture.name = `shardfile:${ref}`;
      const sampler = shard.look.samplers?.[ref]; if (sampler !== undefined) applyTextureSampler(texture, sampler);
      if (texture instanceof CompressedTexture && !splatRefs.has(ref)) releaseAfterUpload(texture);
      // a raw-texel file (uncompressed KTX2) arrives as a DataTexture: its decoded texels go once it is on the GPU too
      else if (texture instanceof DataTexture) releaseRawAfterUpload(texture);
      scope.own(texture); textures.set(ref, texture);
    }
    } finally {
      // Decoded textures own their mips; no later material build uses this decoder.
      forget();retire();
    }
  }
  const resolveTexture = (ref: string, use: 'colour' | 'data'): Texture => {
    const texture = textures.get(ref); if (texture === undefined) throw new Error('Unresolved admitted material texture');
    const previous = uses.get(ref); if (previous !== undefined && previous !== use) throw new Error('One texture hash cannot mix colour and numeric data roles');
    uses.set(ref, use); texture.colorSpace = use === 'colour' ? SRGBColorSpace : NoColorSpace; return texture;
  };
  for (const entry of shard.props?.textures ?? []) resolveTexture(entry.colour, 'colour');
  const toon = new ToonLook(shard.look.familyLooks.toon ?? {}), painterly = new PainterlyLook(shard.look.familyLooks.painterly ?? {}), emissive = new EmissiveLook(shard.look.familyLooks.emissive ?? {});
  // Entered trees borrow these materials; their first capture must not claim them.
  const ownMaterial = (material: Material): Material => { ownSceneResource(material, scope); return material; };
  const context = { toon, painterly, emissive, textures: resolveTexture, scope, emitterPools: (id: string) => sceneVectors(shard.identity.slug, id, 4) }, materials = new MaterialCatalogue();
  const defaults = new Set([...shard.look.families, ...(shard.terrain === null || shard.terrain.form === 'query' ? [] : [shard.terrain.family]), ...(shard.props === null ? [] : [shard.props.family])]);
  // a family's implicit surface is plain and vertex-coloured; PBR's metalness default is a map multiplier, so the plain one is dielectric
  for (const id of defaults) if (!Object.hasOwn(shard.look.materials, id)) materials.set(id, ownMaterial(familyMaterial({ family: id, vertexColours: true, ...(id === 'pbr' ? { metalness: 0 } : {}) }, context)));
  // graph entries: the lazy compiler loads only when the row is on and the shard carries one (a shard without pays nothing)
  // the classic GLSL graph programs (NF14; the TSL node runtime retired in NF18)
  const compiler = graphsOn && carriesGraph(shard, assets) ? await loadLookGraphCompiler(renderer) : null;
  if (scope.disposed) throw new Error('Material scope unloaded during the graph compiler load');
  // Lazy catalogue/skin graph compiles need JSON, never the preparation's GLB,
  // texture or Wasm Map. Grid input leases retain and charge this same subset.
  const graphFiles = new Map(shard.files.filter(file => file.kind === 'json').flatMap(file => {
    const bytes = assets.get(file.hash); return bytes === undefined ? [] : [[file.hash, bytes] as const];
  }));
  assets = graphFiles; // Escaping closures must not keep an outer-context slot containing the full input Map.
  const graphs = clientGraphs(shard, { compiler, toon, trustedGraphs: options.trustedGraphs === true, fallback: (entry) => familyMaterial(entry, context), textures: (ref, role = 'colour') => resolveTexture(ref, role), file: (hash) => graphFiles.get(hash) });
  if (options.sources !== undefined) graphs.bind(options.sources);
  const compile = (entry: unknown, meshMap?: Texture): Material => {
    if (!isGraphEntry(entry)) return ownMaterial(familyMaterial(entry, context));
    const material = graphs.compile(entry), outline = graphs.outline(material);
    if (outline !== null) ownMaterial(outline.material);
    return ownMaterial(bindGraphMeshMap(ownMaterial(material), meshMap, scope));
  };
  // state-bound curves (look.curves): compiled at the fields' values now, moved in `tick` when a field moves
  let stateOf = options.sources?.state;
  const hostFields = new Set(shard.state.shared.filter(field => field.privacy === 'host').map(field => field.name));
  const fieldDefaults = new Map<string, number>();
  for (const part of ['shared', 'player'] as const) for (const field of shard.state[part]) if (typeof field.default === 'number') fieldDefaults.set(`${part}.${field.name}`, field.default);
  const fieldValue = (key: string): number => {
    const dot = key.indexOf('.'), part = key.slice(0, dot) === 'player' ? 'player' : 'shared';
    const name = key.slice(dot + 1), presented = part === 'shared' && hostFields.has(name) ? sceneScalarValue(shard.identity.slug, name) : undefined;
    return stateOf?.(part, name) ?? presented ?? fieldDefaults.get(key) ?? 0;
  };
  const moving: { material: Material; base: ReturnType<typeof parseFamilyMaterial>; rows: NonNullable<Shardfile['look']['curves']>[string]; seen: Map<string, number> }[] = [];
  // G639: a param set on a look nothing has drawn yet waits for its compile instead of forcing it (a per-frame look update
  // compiled every deferred painterly look in Nalati's cell-activation frame)
  const early = new Map<string, Map<string, GraphLiteral>>();
  for (const [id, entry] of Object.entries(shard.look.materials)) {
    const rows = shard.look.curves?.[id];
    if (isGraphEntry(entry)) {
      materials.defer(id, () => {
        const material = ownedGraph(compile(entry), id), held = early.get(id); early.delete(id);
        for (const [name, value] of held ?? []) graphs.setParam(material, name, value);
        return material;
      });
      continue;
    }
    if (rows === undefined) { materials.set(id, compile(entry)); continue; }
    const base = parseFamilyMaterial(entry), seen = new Map(rows.map((row) => [row.state, fieldValue(row.state)]));
    const material = compile(curvedParams(base, rows, (key) => seen.get(key) ?? 0));
    materials.set(id, material); moving.push({ material, base, rows, seen });
  }
  const moveCurves = (): void => {
    for (const row of moving) {
      let moved = false;
      for (const [key, last] of row.seen) { const now = fieldValue(key); if (now !== last) { row.seen.set(key, now); moved = true; } }
      if (moved) moveFamilyMaterial(row.material, curvedParams(row.base, row.rows, (key) => row.seen.get(key) ?? 0));
    }
  };
  const propNamed = named === undefined ? null : await propSurfaces(named, { look: shard.look.materials, catalogue: materials, compile, texture: resolveTexture, file: (hash) => assets.get(hash),
    check: workSlice(undefined, scope).check });
  if (scope.disposed) throw new Error('Material scope unloaded during the prop materials');
  // G227: the splat terrain's tile primitives draw with the live terrain's splat material, every other name as before
  const splatDrawn = splat === undefined ? null : splatSurface(splat, { scope, anisotropy: Math.min(16, renderer.capabilities.getMaxAnisotropy()), texture: (ref) => { const texture = textures.get(ref); if (texture === undefined) throw new Error('Unresolved admitted splat layer'); return texture; } });
  const surfaces = splat === undefined || splatDrawn === null ? propNamed : withSplatSurface({ name: splat.material, binding: splatDrawn.binding }, propNamed);
  // a further entry (an exported skin's binding, SF16) compiles on the same looks, compiler and admitted textures, scope-owned
  const bindMeshMap = (id: string, map: Texture | Material): Material => {
    const material = materials.get(id);
    if (material === undefined) throw new Error(`Unknown catalogue material ${id}`);
    return ownMaterial(bindGraphMeshMap(material, map, scope));
  };
  const instance = (id: string): LookInstance => {
    if (scope.disposed) throw new Error('Material scope unloaded');
    const entry = shard.look.materials[id];
    if (entry === undefined || !isGraphEntry(entry)) throw new Error(`No graph catalogue material ${id} to copy`);
    const material = ownedGraph(compile(entry), id);
    return { material, setParam: (name, value) => { graphs.setParam(material, name, value); } };
  };
  const standardSurface = (id: string, material: Material): material is MeshStandardMaterial => {
    const entry = shard.look.materials[id]; return entry !== undefined && !isGraphEntry(entry) && material instanceof MeshStandardMaterial;
  };
  return { toon, setParam: (id, name, value) => {
    if (scope.disposed) throw new Error('Material scope unloaded');
    if (materials.pending(id)) { const held = early.get(id) ?? new Map<string, GraphLiteral>(); held.set(name, value); early.set(id, held); return; }
    const material = materials.get(id);
    if (material === undefined) throw new Error(`Unknown catalogue material ${id}`);
    // a standard (PBR) surface's params are its baked lightmaps' (engine render/lightmaps)
    if (standardSurface(id, material) && typeof value === 'number') { setStandardLightmap(material, name, value); return; }
    graphs.setParam(material, name, value);
  }, setTexture: (id, name, texture) => {
    if (scope.disposed) throw new Error('Material scope unloaded');
    const material = materials.get(id);
    if (material === undefined) throw new Error(`Unknown catalogue material ${id}`);
    if (standardSurface(id, material)) { bindStandardLightmap(material, name, texture); return; }
    graphs.setTexture(material, name, texture);
  }, prepare: async ids => {
    for (const id of new Set(ids)) { if (!materials.pending(id)) continue; await buildYield(scope); materials.get(id); }
  }, materials, textures, compile, bindMeshMap, instance, outline: graphOutlineHook(graphs.outline), tick: (dt) => { toon.tick(dt); painterly.tick(dt); emissive.tick(dt); graphs.tick(dt); moveCurves(); },
    graphs: { bind: (sources) => { if (sources.state !== undefined) stateOf = sources.state; graphs.bind(sources); moveCurves(); }, readout: graphs.readout }, surfaces,
    ground: splatDrawn !== null && 'material' in splatDrawn ? splatDrawn.material : null };
}
