import { readWholePartition } from '../shardfile/wholeGeometryPieces';
import { materialColourGraph } from '@wildshard/engine/render/graph/colourFunction';
import { isJsonData } from '@wildshard/format/json';
import { clientPreparationBatch } from '../shardfile/preparationTiming';
import { unzlibSync } from 'fflate';
import { type NativeAttributeSchema as WholeAttribute, admitNativeWholeGeometry } from '@wildshard/engine/models/nativeGeometry';
import { fetchDeflatedBytes, fetchLaneBytes, unshuffleLanes as restoreLanes } from '@wildshard/engine/core/deflate';
import { geometryBoundsSteps } from '@wildshard/engine/world/geometryBounds';
import { BAKED_BYTES as codecBakedBytes, appendGeometry as codecAppendGeometry, bakedGeometryBytes as codecBakedGeometryBytes, pad4 as codecPad4, readBakedAttribute, readBakedGeometry as codecReadBakedGeometry, type BakedGeometryRow as CodecBakedGeometryRow, type BakedType as CodecBakedType } from './bakedGeometry';
import { workSlice } from '@wildshard/engine/core/workSlice';
import { presenting } from '@wildshard/engine/core/framePacing';
import { constructionCheckpoint } from '../shardfile/constructionCheckpoint';
import { PreparationReads } from '../shardfile/preparationReads';
import { wholeGeometryInputs } from '../../../shared/game/shardfile/wholeInputs';
import { TIER } from '@wildshard/engine/core/tier';
import { readHomeBuildGeometry, saveHomeBuildGeometry } from '../shardfile/homeBuildCache';
import { defineSceneModels, type BakedModelMetadata } from '@wildshard/engine/models/model';
import { identitySpaceGeometry } from '@wildshard/engine/models/ownedGeometry';
import * as wholeV from 'valibot';
import type { Scope as ResourceScope } from '@wildshard/engine/app/scope';
import { resourceScope } from '@wildshard/engine/app/resources';
import type { Shardfile } from '@wildshard/format/shardSchema';
import { prepareRigLoader, loadRigFile, type ClipName, type SocketName } from "@wildshard/engine/anim/rig";
import { retainCachedResources } from "@wildshard/engine/app/cachedAssets";
import { cacheUntilDisposed } from "@wildshard/engine/app/disposalCache";
import { releaseOnUpload } from "@wildshard/engine/render/memorySaver";
import { ktx2File, prepareCompressedTexture } from "@wildshard/engine/core/ktx2";
import { RepeatWrapping, Matrix4, Bone, FileLoader, SkinnedMesh, Texture, type AnimationClip, type Wrapping, type MinificationTextureFilter, type MagnificationTextureFilter, Box3, Sphere, BufferGeometry, Float32BufferAttribute, Group, Mesh, MeshStandardMaterial, Uint16BufferAttribute, Vector3, BufferAttribute, InterleavedBufferAttribute, type Object3D, CanvasTexture, LinearMipmapLinearFilter, SRGBColorSpace, Float16BufferAttribute, BoxGeometry, CylinderGeometry, ConeGeometry, SphereGeometry, TorusGeometry, IcosahedronGeometry, CapsuleGeometry, Shape, ExtrudeGeometry, Color, type MeshStandardMaterialParameters, type Material, InstancedMesh } from "three";
import { applySurfaceLooks, type SurfaceInputs } from "../systems/looks/surfaceLooks";
import type { SurfaceLook } from "@wildshard/format/surfaceLooks";
import { Rng } from "@wildshard/engine/core/rng";
import type { SpeciesLook } from "@wildshard/engine/entities/species/look";
import { NO_FUR } from "@wildshard/engine/entities/species/rigs";
import { clipAnimate, stepCreatureLift, type SpeciesClips } from "../../../shared/game/plugin/animation";
import { numericCreaturePoseFromBook } from '../../../shared/game/plugin/channelPrograms';
import { parsePackedCreatureLooks } from '@wildshard/format/speciesLooks';
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { NpcMotion, NpcRow } from "../../../shared/game/plugin/quests";

type AnimalSpecies = ReturnType<SpeciesLook['build']>;

/**
 * A model library (SHARD-PLATFORM M3; ex a dune shard's generated models): the GLBs a level loads once behind its loading
 * screen and then copies synchronously while it builds, each list driven by rows. Nothing here knows a shard.
 *
 * - facet models: every mesh of the file flattened into one non-indexed geometry in world space: position, the facet
 *   colour (rgb × the baked AO in COLOR_0's alpha, kept down to the row's `aoFloor`) and flat normals;
 * - hero models: the scene as loaded (its own maps on its own UVs), matte and smooth, each material then dressed by the
 *   model's `HdLookRow` (tint, roughness, fog, user flags, surface-look rows);
 *
 * A file that fails to load is a page fault (`console.error`; the boot smoke and the tests fail on it), never a silent
 * stand-in: the caller's copy is null and the thing it would draw stands undrawn. The helpers below (`fitGeometry`,
 * `undrawnRig`) shape the copies; generators bind rigid bodies with `bindRigid` (`@wildshard/sharddev/bake/skinned`).
 *
 * Creature bodies (`creatureBodies`, over `skinnedModel`): standard skinned GLBs a generator baked (bones with their bind
 * positions, parts, clips and the shard's extras), copied per spawn, each with its stand-in skeleton when it did not load.
 *
 * A transitional bridge (Jake, a44511f05: "quests and geometry stay as bridges"): this module is deleted once the geometry
 * lives in the shards' generators.
 */





/** How a hero model's materials are dressed after the matte base: each field optional, applied in this order. */
export interface HdLookRow {
  /** the material colour, linear RGB */
  readonly color?: readonly [number, number, number];
  readonly roughness?: number;
  readonly fog?: boolean;
  /** flags the caller's own passes read off the material's userData */
  readonly userData?: Readonly<Record<string, boolean>>;
  /** surface-look rows installed over the library's surface inputs */
  readonly surface?: readonly SurfaceLook[];
}

/** A model library's files and looks, as data. */
export interface ModelLibraryRows<M extends string, H extends string> {
  /** Plain mapped material before a compiled look is borrowed (for model viewers). */
  readonly mappedFallback?: { readonly roughness: number; readonly metalness: number };
  /** Named rest geometry paired with existing painted atlases; never fitted at runtime. */
  readonly paintedModels?: readonly PaintedModelRow[];
  /** the facet models preloaded, and every facet model's file */
  readonly meshes: readonly M[];
  /** One identity-space, non-indexed rest mesh with final float32 position/normal/colour channels; never refit or renormalize. */
  readonly preparedMeshes?: readonly M[];
  /** Named ordinary rest primitives, with exact authored channels/index/groups; materials remain caller-owned ports. */
  readonly geometryPools?: readonly ModelGeometryPool[];
  readonly meshUrls: Readonly<Record<M, string>>;
  /** the hero models preloaded, and every hero model's file */
  readonly hd: readonly H[];
  readonly hdUrls: Readonly<Record<H, string>>;
  /** a facet in full occlusion keeps this share of its colour */
  readonly aoFloor: number;
  /** the hero models' dressing, by name */
  readonly hdLooks: Readonly<Partial<Record<H, HdLookRow>>>;
  /** Optional baked rigs and look rows; absent retains the original model preload. */
  readonly rigs?: RigLibraryRows;
  /** Manual rig preload preserves a caller's existing preparation phase. */
  readonly rigLoad?: 'manual';
}

/** How a copy is framed: turned `yaw` about +Y, centred on x / z, its lowest point at `floor`, `size` metres by span or height. */
/** How `fitGeometry` frames a model; `centre: 'base'` centres x / z on its footing (the lowest tenth), not its whole box. */
export interface ModelFit { readonly size: number; readonly by: 'span' | 'height'; readonly floor?: number; readonly yaw?: number; readonly centre?: 'base' }

/** Original rigid GLB streams, decoded through attribute accessors before their world transform.
 * Absent retains strict identity-space rest-pool admission. first selects one mesh into one declared slot.
 * white creates the same immutable vertex-colour channel formerly initialized by held callers.
 */
export interface NativeModelPartPolicy { readonly first?: boolean; readonly requireIndex: boolean; readonly white?: boolean; readonly disposeSource?: boolean }
export interface ModelPbrAtlas { readonly map: Texture; readonly normalMap: Texture; readonly armMap: Texture }
export interface ModelGeometryPool {
  readonly url: string; readonly parts: readonly string[]; readonly native?: NativeModelPartPolicy;
  /** Explicit Float32 application channels; a part subset requires that channel on exactly those meshes. */
  readonly channels?: readonly { readonly name: string; readonly source: string; readonly width: number; readonly parts?: readonly string[] }[];
  readonly atlases?: readonly { readonly id: string; readonly part: string; readonly anisotropy: number; readonly refresh?: boolean }[];
}

/** A loaded model library: preload once, then take copies. */
export interface ModelLibrary<M extends string, H extends string> {
  /** Borrow the caller's compiled look book until its scope ends; no material is copied. */
  readonly bindLooks: (scope: ResourceScope, ports: { readonly materials: ReadonlyMap<string, Material>; readonly bindMeshMap: (id: string, map: Texture | Material) => Material }) => void;
  readonly look: (id: string) => Material | undefined;
  readonly material: (id: string) => Material;
  readonly mappedLook: (id: string, map: Texture | Material) => Material;
  /** Load every listed model once (a failed one is skipped and faulted). */
  preload: (pause?: () => Promise<void>) => Promise<void>;
  /** Owned prepared geometry copies sharing their declared original atlas. */
  painted: (name: string) => PaintedModel | null;
  /** A copy of a loaded facet model's geometry, or null (not loaded: the caller's code model stands in). */
  mesh: (name: M) => BufferGeometry | null;
  /** An owned copy by default. borrow:true lends the immutable cached primitive: never transform, recolour, change attributes or dispose it. */
  geometry: (name: string, options?: { readonly borrow?: boolean }) => BufferGeometry | null;
  /** Borrow immutable original PBR textures; no texture clone, retint or new upload is introduced. */
  readonly atlas: (id: string) => ModelPbrAtlas | null;
  /** A hero model fitted as `fit`, as a group sharing the loaded geometry and maps; null when it did not load. */
  hd: (name: H, fit: ModelFit) => Group | null;
  /** A recipe's named hero, validated against this library before copying its existing fit. */
  model: (name: string, fit: ModelFit) => Group | null;
  readonly rig: (name: string) => AnimalSpecies;
  readonly bakedRig: (name: string) => AnimalSpecies | null;
  readonly looks: readonly SpeciesLook[];
  readonly preloadRigs: () => Promise<void>;
  /** Ordered Explorer models on this library's actual rig copies. */
  readonly models: (rows: readonly ModelSpecimenRow[]) => ReturnType<typeof defineSceneModels>;
}

const isMesh = (o: Object3D): o is Mesh => o instanceof Mesh;

/** One mesh's triangles in world space, de-indexed, as plain float32 (meshopt quantizes the attributes). */
function flatten(mesh: Mesh, aoFloor: number): { pos: number[]; col: number[] } {
  const g = mesh.geometry, p = g.getAttribute('position'), c = g.hasAttribute('color') ? g.getAttribute('color') : null;
  const index = g.getIndex(), n = index ? index.count : p.count, pos: number[] = [], col: number[] = [], v = new Vector3();
  for (let k = 0; k < n; k++) {
    const i = index ? index.getX(k) : k;
    v.fromBufferAttribute(p, i).applyMatrix4(mesh.matrixWorld); pos.push(v.x, v.y, v.z);
    const ao = c?.itemSize === 4 ? aoFloor + (1 - aoFloor) * c.getW(i) : 1;
    col.push((c ? c.getX(i) : 1) * ao, (c ? c.getY(i) : 1) * ao, (c ? c.getZ(i) : 1) * ao);
  }
  return { pos, col };
}

/** A hero material's matte base, then its look row. */
function dressHd(m: MeshStandardMaterial, look: HdLookRow | undefined, inputs: SurfaceInputs): void {
  m.metalness = 0; m.roughness = 0.85; m.flatShading = false;
  if (look !== undefined) {
    if (look.color !== undefined) m.color.setRGB(look.color[0], look.color[1], look.color[2]);
    if (look.roughness !== undefined) m.roughness = look.roughness;
    if (look.fog !== undefined) m.fog = look.fog;
    if (look.userData !== undefined) for (const [key, value] of Object.entries(look.userData)) m.userData[key] = value;
    if (look.surface !== undefined) applySurfaceLooks(m, look.surface, inputs);
  }
  m.needsUpdate = true;
}

/**
 * A model library over `rows`. `fault` opens every page fault a failed file logs (e.g. the shard's name in brackets);
 * `surfaceInputs` are the live uniforms the hero models' surface rows read.
 */
/** A rest primitive paired with a painted GLB and optional body/head/arm/fore slots; null explicitly declares an empty slot. */
export interface PaintedModelRow { readonly name: string; readonly url: string; readonly geometry: string; readonly pivots?: readonly (string | null)[]; readonly releaseImage?: boolean }
/** Geometry stays in the authored frame; the map is shared, and reads clone every geometry. */
export interface PaintedModel { readonly geometry: BufferGeometry; readonly map: Texture; readonly pivots?: { readonly body: BufferGeometry; readonly head: BufferGeometry; readonly arm: BufferGeometry; readonly fore: BufferGeometry } }

const nativeFloat32Some: unknown = Reflect.get(Float32Array.prototype, 'some');
function hasNonfiniteFloat32(values: Float32Array): boolean {
  const some: unknown = Reflect.get(values, 'some');
  // Native validation still refuses detached/out-of-bounds empty views. Custom
  // methods and length/prototype overrides retain their original scan, too.
  if (some !== nativeFloat32Some || Object.getPrototypeOf(values) !== Float32Array.prototype || Object.hasOwn(values, 'length') || values.length === 0) {
    if (typeof some !== 'function') throw new TypeError('Rest channel scan is not callable');
    return Boolean(Reflect.apply(some, values, [(value: number) => !Number.isFinite(value)]));
  }
  const count = values.length;
  for (let index = 0; index < count; index++) if (!Number.isFinite(values[index])) return true;
  return false;
}

interface ModelLoadState { loading: Promise<void> | null }

// Resource listeners outlive the library that loaded them. Build them outside
// its lexical scope so a live mesh cannot retain the reader's product context.
function cacheModelEntry<K, V extends object>(memo: Map<K, V>, key: K, value: V, state: ModelLoadState): void {
  retainCachedResources(value); memo.set(key, value);
  cacheUntilDisposed(value, () => {
    if (memo.get(key) === value) { memo.delete(key); state.loading = null; }
  });
}

/** Load named resources once; each owner takes independent geometry over shared painted textures. */
export function createModelLibrary<M extends string, H extends string>(rows: ModelLibraryRows<M, H>, fault: string, surfaceInputs: SurfaceInputs = {}, readModel: (url: string) => Promise<{ readonly scene: Object3D }> = loadRigFile, readAtlas?: (url: string) => Promise<Texture | null>): ModelLibrary<M, H> {
  let lookPorts: Parameters<ModelLibrary<M, H>['bindLooks']>[1] | null = null;
  const fallback = rows.mappedFallback;
  if (fallback !== undefined && [fallback.roughness, fallback.metalness].some(value => !Number.isFinite(value) || value < 0 || value > 1)) throw new Error('Invalid mapped look fallback');
  const ready = new Map<M, BufferGeometry>(), hd = new Map<H, Object3D>();
  const painted = new Map<string, PaintedModel>(), paintedRows = rows.paintedModels ?? [];
  const rest = new Map<string, BufferGeometry>(), atlases = new Map<string, ModelPbrAtlas>();
  const rigs = rows.rigs === undefined ? null : rigLibrary(rows.rigs);
  const state: ModelLoadState = { loading: null };
  const pools = rows.geometryPools ?? [], parts = pools.flatMap(pool => pool.parts), atlasRows = pools.flatMap(pool => pool.atlases ?? []);
  if (pools.length > 16 || parts.length > 128 || new Set(parts).size !== parts.length) throw new Error('Model library requires unique bounded rest geometry parts');
  if (atlasRows.length > 128 || new Set(atlasRows.map(row => row.id)).size !== atlasRows.length
    || pools.some(pool => pool.native?.first === true && pool.parts.length !== 1
      || (pool.atlases ?? []).some(row => !pool.parts.includes(row.part) || !Number.isFinite(row.anisotropy) || row.anisotropy < 1 || row.anisotropy > 32))) throw new Error('Invalid declared native pool/atlas slots');
  for (const pool of pools) {
    const channels = pool.channels ?? [];
    if (channels.length > 16 || pool.native !== undefined && channels.length > 0
      || new Set(channels.map(row => row.name)).size !== channels.length || new Set(channels.map(row => row.source)).size !== channels.length
      || channels.some(row => !/^[A-Za-z][A-Za-z0-9_]{0,63}$/u.test(row.name) || ['position','normal','color','uv','uv1','tangent','constructor','prototype','__proto__'].includes(row.name)
        || (!/^_[a-z0-9_]{1,63}$/u.test(row.source) || row.source === '__proto__') || ![1,2,3,4].includes(row.width)
        || row.parts !== undefined && (row.parts.length === 0 || row.parts.length > pool.parts.length || new Set(row.parts).size !== row.parts.length || row.parts.some(part => !pool.parts.includes(part))))) throw new Error('Invalid declared rest channels');
  }
  if (paintedRows.length > 128 || new Set(paintedRows.map(row => row.name)).size !== paintedRows.length
    || paintedRows.some(row => !parts.includes(row.geometry) || row.pivots !== undefined && (row.pivots.length !== 4 || row.pivots.some(part => part !== null && !parts.includes(part))))) throw new Error('Painted models require declared rest primitives and four pivot slots');

  async function loadPainted(row: PaintedModelRow, geometryReady: Promise<void>): Promise<void> {
    try {
      const maps: Texture[] = [];
      if (readAtlas !== undefined) { const atlas = await readAtlas(row.url); if (atlas !== null) maps.push(atlas); }
      else { const source = await readModel(row.url); source.scene.traverse(node => {
        if (maps.length > 0 || !isMesh(node)) return;
        const material = Array.isArray(node.material) ? node.material[0] : node.material;
        if (material instanceof MeshStandardMaterial && material.map !== null && node.geometry.hasAttribute('uv') && node.geometry.index !== null) maps.push(material.map);
      }); }
      // Atlas transport can overlap rest geometry, but publication cannot.
      await geometryReady;
      const map = maps[0], geometry = rest.get(row.geometry);
      if (map === undefined || geometry === undefined) throw new Error('Prepared painted resources unavailable');
      const part = (index: number): BufferGeometry => {
        const name = row.pivots?.[index];
        if (name === undefined) throw new Error('Missing declared pivot slot');
        if (name !== null) { const found = rest.get(name); if (found === undefined) throw new Error('Missing declared pivot geometry'); return found; }
        const empty = new BufferGeometry();
        for (const [channel, size] of [['position', 3], ['normal', 3], ['uv', 2]] as const) empty.setAttribute(channel, new Float32BufferAttribute([], size));
        empty.computeBoundingBox(); empty.computeBoundingSphere(); return empty;
      };
      const made: PaintedModel = { geometry, map, ...(row.pivots === undefined ? {} : { pivots: { body: part(0), head: part(1), arm: part(2), fore: part(3) } }) };
      const image: unknown = map.image;
      if (row.releaseImage === true && typeof ImageBitmap !== 'undefined' && image instanceof ImageBitmap) releaseOnUpload(map.source, () => { image.close(); });
      cacheModelEntry(painted, row.name, made, state);
    } catch (error: unknown) {
      // Keep the geometry failure ahead of a later atlas fault.
      await geometryReady;
      console.error(`${fault} the painted model ${row.name} did not load:`, error);
    }
  }

  // Overlap a bounded set of immutable model reads with the default parser's
  // serial, shared-budget decode slot. Keep the caller's original pause order.
  async function loadPaintedAhead(missing: readonly PaintedModelRow[], pause: () => Promise<void>, geometryReady: Promise<void>): Promise<void> {
    const pending = new Map<number, Promise<void>>();
    let next = 0;
    const fill = (): void => {
      while (pending.size < 4 && next < missing.length) {
        const row = missing[next];
        if (row === undefined) throw new Error('Missing painted model row');
        const loading = loadPainted(row, geometryReady); void loading.catch(() => undefined);
        pending.set(next++, loading);
      }
    };
    try {
      fill();
      for (let index = 0; index < missing.length; index++) {
        const loading = pending.get(index);
        if (loading === undefined) throw new Error('Missing painted model read');
        await loading; pending.delete(index);
        await pause(); fill();
      }
    } finally {
      // A retired caller stops admitting rows, but releases its input lease only
      // after every read/parse already started has settled.
      await Promise.allSettled(pending.values());
    }
  }

  async function loadPool(pool: ModelGeometryPool): Promise<void> {
    try {
      const gltf = await readModel(pool.url), nodes: Mesh[] = [];
      gltf.scene.updateMatrixWorld(true); gltf.scene.traverse(node => { if (isMesh(node)) nodes.push(node); });
      if (nodes.length > 128 || new Set(nodes.map(node => node.name)).size !== nodes.length) throw new Error('Rest pool has repeated or excessive meshes');
      const prepared = new Map<string, BufferGeometry>(), borrowed = new Map<string, ModelPbrAtlas>();
      const selected = (name: string): Mesh => {
        const node = pool.native?.first === true ? nodes[0] : nodes.find(candidate => candidate.name === name);
        if (node?.type !== 'Mesh') throw new Error('Rest pool is missing an ordinary declared mesh'); return node;
      };
      for (const row of pool.atlases ?? []) {
        const material = selected(row.part).material;
        if (Array.isArray(material) || !(material instanceof MeshStandardMaterial)) throw new Error('Declared native atlas requires one PBR material');
        const {map, normalMap, roughnessMap} = material;
        if (map === null || normalMap === null || roughnessMap === null) throw new Error('Declared native PBR atlas map is missing');
        for (const texture of [map, normalMap, roughnessMap]) { texture.anisotropy = row.anisotropy; if (row.refresh === true) texture.needsUpdate = true; }
        borrowed.set(row.id, {map, normalMap, armMap: roughnessMap});
      }
      if (pool.native !== undefined) {
        for (const name of pool.parts) {
          const node = selected(name), source = node.geometry, position = source.attributes['position'], geometry = new BufferGeometry();
          if (position === undefined || position.count < 1 || position.count > 400_000 || Object.keys(source.morphAttributes).length > 0) throw new Error('Native pool requires bounded rigid positions');
          for (const [channel, width] of [['position',3],['normal',3],['uv',2]] as const) {
            const input = source.attributes[channel]; if (input === undefined || input.count !== position.count || input.itemSize !== width) throw new Error('Native pool is missing its original vertex channels');
            const values = new Float32Array(input.count * width);
            for (let i = 0; i < input.count; i++) { values[i * width] = input.getX(i); values[i * width + 1] = input.getY(i); if (width > 2) values[i * width + 2] = input.getZ(i); }
            if (values.some(value => !Number.isFinite(value))) throw new Error('Native pool has nonfinite vertices');
            geometry.setAttribute(channel, new BufferAttribute(values, width));
          }
          const index = source.getIndex();
          if (index === null && pool.native.requireIndex) throw new Error('Native pool requires the original index');
          if (index !== null) { if (index.array.some(value => !Number.isInteger(value) || value < 0 || value >= position.count)) throw new Error('Native index is outside its vertex roster'); geometry.setIndex(new BufferAttribute(Uint32Array.from(index.array),1)); }
          node.updateWorldMatrix(true, false); geometry.applyMatrix4(node.matrixWorld); geometry.computeBoundingSphere();
          if (pool.native.white === true) geometry.setAttribute('color', new BufferAttribute(new Float32Array(position.count * 3).fill(1), 3));
          if (pool.native.disposeSource === true) source.dispose(); prepared.set(name, geometry);
        }
      } else {
      if (nodes.length !== pool.parts.length || new Set(nodes.map(node => node.name)).size !== nodes.length) throw new Error('Rest pool part roster differs');
      for (const name of pool.parts) {
        const node = nodes.find(candidate => candidate.name === name);
        // I3: a grid-quantized cast (compactPhoneGlb: grid node, normalized channels) reads back as its identity-space Float32 mesh
        const decoded = node?.type === 'Mesh' && !node.matrixWorld.equals(new Matrix4()) ? identitySpaceGeometry(node) : null;
        if (node?.type !== 'Mesh' || (decoded === null && !node.matrixWorld.equals(new Matrix4()))) throw new Error('Rest pool requires named identity-space ordinary meshes');
        if (decoded !== null) node.geometry.dispose();
        const geometry = decoded ?? node.geometry, position = geometry.getAttribute('position');
        if (!(position instanceof BufferAttribute) || position.count === 0 || position.count > 400_000 || Object.keys(geometry.morphAttributes).length > 0) throw new Error('Rest pool requires bounded rigid positions');
        const channels = (pool.channels ?? []).filter(row => row.parts === undefined || row.parts.includes(name));
        for (const [channel, attribute] of Object.entries(geometry.attributes)) {
          const width = ['uv','uv1'].includes(channel) ? 2 : channel === 'tangent' ? 4 : ['position', 'normal', 'color'].includes(channel) ? 3 : channels.find(row => row.source === channel)?.width;
          if (width === undefined || !(attribute instanceof BufferAttribute) || !(attribute.array instanceof Float32Array)
            || attribute.normalized || attribute.itemSize !== width || attribute.count !== position.count || hasNonfiniteFloat32(attribute.array)) throw new Error('Rest pool has incompatible Float32 channels');
        }
        for (const row of channels) {
          const attribute: unknown = geometry.attributes[row.source];
          if (!(attribute instanceof BufferAttribute) || geometry.hasAttribute(row.name)) throw new Error('Missing or colliding declared rest channel');
          geometry.deleteAttribute(row.source); geometry.setAttribute(row.name, attribute);
        }
        const index = geometry.index;
        if (index !== null && (!(index.array instanceof Uint16Array) && !(index.array instanceof Uint32Array)
          || index.normalized || index.itemSize !== 1 || index.array.some(value => value >= position.count))) throw new Error('Rest pool has incompatible index words');
        const groups: unknown = node.userData['restGroups'], sphere: unknown = node.userData['restSphere'], box: unknown = node.userData['restBox'];
        if (!Array.isArray(groups) || groups.length > 32) throw new Error('Rest pool has no bounded original groups');
        geometry.clearGroups();
        for (const group of groups) {
          if (!Array.isArray(group) || group.length !== 3) throw new Error('Rest pool group differs');
          const start: unknown = group[0], count: unknown = group[1], material: unknown = group[2];
          if (typeof start !== 'number' || !Number.isSafeInteger(start) || start < 0 || typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0
            || start + count > (index?.count ?? position.count) || typeof material !== 'number' || !Number.isSafeInteger(material) || material < 0 || material > 31) throw new Error('Rest pool group extent differs');
          geometry.addGroup(start, count, material);
        }
        geometry.boundingBox = null;
        if (box !== null) {
          if (!Array.isArray(box) || box.length !== 6) throw new Error('Rest pool box differs');
          const x: unknown = box[0], y: unknown = box[1], z: unknown = box[2], maxX: unknown = box[3], maxY: unknown = box[4], maxZ: unknown = box[5];
          if (typeof x !== 'number' || !Number.isFinite(x) || typeof y !== 'number' || !Number.isFinite(y) || typeof z !== 'number' || !Number.isFinite(z)
            || typeof maxX !== 'number' || !Number.isFinite(maxX) || typeof maxY !== 'number' || !Number.isFinite(maxY) || typeof maxZ !== 'number' || !Number.isFinite(maxZ)
            || x > maxX || y > maxY || z > maxZ) throw new Error('Rest pool box differs');
          geometry.boundingBox = new Box3(new Vector3(x,y,z),new Vector3(maxX,maxY,maxZ));
        }
        geometry.boundingSphere = null;
        if (sphere !== null) {
          if (!Array.isArray(sphere) || sphere.length !== 4) throw new Error('Rest pool sphere differs');
          const x: unknown = sphere[0], y: unknown = sphere[1], z: unknown = sphere[2], radius: unknown = sphere[3];
          if (typeof x !== 'number' || !Number.isFinite(x) || typeof y !== 'number' || !Number.isFinite(y) || typeof z !== 'number' || !Number.isFinite(z)
            || typeof radius !== 'number' || !Number.isFinite(radius) || radius < 0) throw new Error('Rest pool sphere differs');
          geometry.boundingSphere = new Sphere(new Vector3(x, y, z), radius);
        }
        prepared.set(name, geometry);
      }
      }
      for (const [id, atlas] of borrowed) {
        cacheModelEntry(atlases, id, atlas, state);
      }
      for (const [name, geometry] of prepared) {
        cacheModelEntry(rest, name, geometry, state);
      }
    } catch (error: unknown) { console.error(`${fault} the rest geometry pool did not load:`, error); }
  }

  async function load(name: M): Promise<void> {
    try {
      const gltf = await readModel(rows.meshUrls[name]);
      gltf.scene.updateMatrixWorld(true);
      let g: BufferGeometry;
      if (rows.preparedMeshes?.includes(name) === true) {
        const meshes: Mesh[] = []; gltf.scene.traverse(node => { if (isMesh(node)) meshes.push(node); });
        const mesh = meshes[0], identity = new Matrix4();
        if (meshes.length !== 1 || mesh === undefined || !mesh.matrixWorld.equals(identity) || mesh.geometry.index !== null
          || ['position', 'normal', 'color'].some(channel => { const a = mesh.geometry.getAttribute(channel); return !(a instanceof Float32BufferAttribute || a instanceof BufferAttribute) || !(a.array instanceof Float32Array) || a.normalized || a.itemSize !== 3 || a.count !== mesh.geometry.getAttribute('position').count; })) throw new Error(`${name}: incompatible prepared facet channels`);
        g = mesh.geometry.clone(); g.boundingSphere = null;
      } else {
      const pos: number[] = [], col: number[] = [];
      gltf.scene.traverse((o) => { if (isMesh(o)) { const f = flatten(o, rows.aoFloor); pos.push(...f.pos); col.push(...f.col); } });
      if (pos.length === 0) throw new Error(`${name}: no mesh`);
        g = new BufferGeometry();
      g.setAttribute('position', new Float32BufferAttribute(pos, 3)); g.setAttribute('color', new Float32BufferAttribute(col, 3));
      g.computeVertexNormals();
      }
      g.computeBoundingBox(); cacheModelEntry(ready, name, g, state);
    } catch (e: unknown) { console.error(`${fault} the generated model ${name} did not load:`, e); }
  }

  async function loadHd(name: H): Promise<void> {
    try {
      const { scene } = await readModel(rows.hdUrls[name]), look = rows.hdLooks[name];
      scene.traverse((o) => {
        if (!isMesh(o)) return;
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) if (m instanceof MeshStandardMaterial) dressHd(m, look, surfaceInputs);
      });
      // Only the reusable scene belongs to the memo. Its disposal observer
      // must not retain the consumed GLTF parser and transport dependencies.
      cacheModelEntry(hd, name, scene, state);
    } catch (e: unknown) { console.error(`${fault} the generated model ${name} did not load:`, e); }
  }

  const heroCopy = (name: H, o: ModelFit): Group | null => {
      const src = hd.get(name); if (!src) return null;
      const inner = src.clone(true), holder = new Group(), turn = new Group();
      turn.rotation.y = o.yaw ?? 0; turn.add(inner); holder.add(turn); holder.updateMatrixWorld(true);
      const b = new Box3().setFromObject(holder);
      const span = o.by === 'height' ? b.max.y - b.min.y : Math.max(b.max.x - b.min.x, b.max.z - b.min.z), k = o.size / Math.max(1e-6, span);
      turn.position.set(-(b.min.x + b.max.x) / 2, -b.min.y, -(b.min.z + b.max.z) / 2);
      const out = new Group(); out.add(holder); holder.scale.setScalar(k); holder.position.y = o.floor ?? 0;
      return out;
  };

  return {
    bindLooks: (scope, ports) => {
      if (scope.disposed) throw new Error('Cannot borrow looks from a disposed scope');
      lookPorts = ports; scope.onDispose(() => { if (lookPorts === ports) lookPorts = null; });
    },
    look: id => lookPorts?.materials.get(id),
    material: id => { const material = lookPorts?.materials.get(id); if (material === undefined) throw new Error(`Missing borrowed model material ${id}`); return material; },
    mappedLook: (id, map) => {
      if (lookPorts?.materials.has(id) === true) return lookPorts.bindMeshMap(id, map);
      if (fallback === undefined) throw new Error('Model library has no declared mapped fallback');
      if (!(map instanceof Texture)) { const copied = map.clone(); Object.assign(copied, fallback); return copied; }
      return new MeshStandardMaterial({ map, ...fallback });
    },
    preload: (pause) => {
      state.loading ??= (async () => {
        try {
        const geometryReady = Promise.all([...rows.meshes.filter(name => !ready.has(name)).map(load), ...rows.hd.filter(name => !hd.has(name)).map(loadHd),
          ...pools.filter(pool => pool.parts.some(name => !rest.has(name)) || (pool.atlases ?? []).some(row => !atlases.has(row.id))).map(loadPool)]).then(() => undefined);
        const missing = paintedRows.filter(row => !painted.has(row.name));
        // Start at most the existing four atlas reads during geometry intake.
        // Publish state.loading before an atlas reader can re-enter preload.
        // Every model publication and caller pause still waits for geometry.
        const painting = pause === undefined ? geometryReady.then(() => Promise.all(missing.map(row => loadPainted(row, geometryReady))))
          : Promise.resolve().then(() => loadPaintedAhead(missing, pause, geometryReady));
        const [geometryResult, paintedResult] = await Promise.allSettled([geometryReady, painting]);
        if (geometryResult.status === 'rejected') throw geometryResult.reason;
        if (paintedResult.status === 'rejected') throw paintedResult.reason;
        } catch (error: unknown) { state.loading = null; throw error; }
      })();
      return rigs === null || rows.rigLoad === 'manual' ? state.loading : Promise.all([state.loading, rigs.bodies.preload()]).then(() => undefined);
    },
    rig: name => { if (rigs === null) throw new Error('Model library has no declared rigs'); return rigs.bodies.bodyOrStandIn(name); },
    bakedRig: name => rigs?.bodies.body(name) ?? null,
    looks: rigs?.looks ?? [],
    preloadRigs: () => rigs?.bodies.preload() ?? Promise.resolve(),
    models: specimens => modelCatalogue(specimens, { rig: name => { if (rigs === null) throw new Error('Model library has no declared rigs'); return rigs.bodies.bodyOrStandIn(name); } }),
    mesh: name => ready.get(name)?.clone() ?? null,
    geometry: (name, options) => { const value=rest.get(name); return value===undefined?null:options?.borrow===true?value:value.clone(); },
    atlas: id => atlases.get(id) ?? null,
    painted: name => {
      const model = painted.get(name); if (model === undefined) return null;
      return { geometry: model.geometry.clone(), map: model.map, ...(model.pivots === undefined ? {} : { pivots: { body: model.pivots.body.clone(), head: model.pivots.head.clone(), arm: model.pivots.arm.clone(), fore: model.pivots.fore.clone() } }) };
    },
    hd: heroCopy,
    model: (name, fit) => { const key = rows.hd.find(candidate => candidate === name); if (key === undefined) throw new Error('Unknown declared hero model'); return heroCopy(key, fit); },
  };
}

/** How a painted image samples (each field optional: three's texture default otherwise) and whether it frees its decode. */
export interface PaintedSampler {
  readonly wrapS?: Wrapping;
  readonly wrapT?: Wrapping;
  readonly mips?: boolean;
  readonly minFilter?: MinificationTextureFilter;
  readonly magFilter?: MagnificationTextureFilter;
  readonly anisotropy?: number;
  /** Memory saver: the decoded image goes at its upload (nothing reads it on the CPU) or when the texture retires */
  readonly release?: boolean;
}

/**
 * A painted image as an sRGB texture named `name`, fetched and decoded off the main thread (an ImageBitmap, flipped at
 * decode as the engine's own loader does, so its v runs up like a TextureLoader image's), sampled as `sampler`; null when
 * it cannot be had (offline, a test page), with `console.warn(warn, error)`: the caller keeps its stand-in. A plain fetch
 * fails fast where an <img> would hang a headless test. Already flipped, it is unflagged (`flipY` false, as the engine's
 * loader leaves a bitmap): a graph's node sampler flips a flagged ImageBitmap again, so a flagged one sampled upside down
 * until the Memory saver dropped its bitmap; a classic upload ignores the flag on a bitmap either way.
 */
export async function loadPaintedTexture(url: string, name: string, warn: string, sampler: PaintedSampler = {}): Promise<Texture | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${String(response.status)} ${url}`);
    const bitmap = await createImageBitmap(await response.blob(), { imageOrientation: 'flipY' });
    const tex = new Texture(bitmap); tex.colorSpace = SRGBColorSpace; tex.name = name; tex.flipY = false;
    if (sampler.release === true) { cacheUntilDisposed(tex, () => { bitmap.close(); }); releaseOnUpload(tex.source, () => { bitmap.close(); }); }
    if (sampler.wrapS !== undefined) tex.wrapS = sampler.wrapS;
    if (sampler.wrapT !== undefined) tex.wrapT = sampler.wrapT;
    if (sampler.mips !== undefined) tex.generateMipmaps = sampler.mips;
    if (sampler.minFilter !== undefined) tex.minFilter = sampler.minFilter;
    if (sampler.magFilter !== undefined) tex.magFilter = sampler.magFilter;
    if (sampler.anisotropy !== undefined) tex.anisotropy = sampler.anisotropy;
    tex.needsUpdate = true;
    return tex;
  } catch (error: unknown) {
    console.warn(warn, error);
    return null;
  }
}

/** A creature that did not load stands undrawn: one zero-area triangle on bone 0 (a species needs a geometry part). */
export function undrawnRig(): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(new Float32Array(9), 3)); g.setAttribute('color', new Float32BufferAttribute(new Float32Array(9), 3));
  g.setAttribute('normal', new Float32BufferAttribute(new Float32Array(9), 3));
  g.setAttribute('skinIndex', new Uint16BufferAttribute(new Uint16Array(12), 4)); g.setAttribute('skinWeight', new Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 4));
  return g;
}

/** A baked joint: its name, its parent's name (null for a root) and its exact bind position (BoneDef's shape). */
export interface SkinnedJoint { readonly name: string; readonly parent: string | null; readonly pos: [number, number, number] }
/** One skinned part: an independent geometry copy (skinIndex / skinWeight over `bones`) and its shared base-colour map. */
export interface SkinnedAssetPart { readonly name: string; readonly geometry: BufferGeometry; readonly map: Texture | null }
export interface SkinnedAsset {
  readonly bones: readonly SkinnedJoint[];
  readonly parts: readonly SkinnedAssetPart[];
  /** The baked animations (shared, never mutated). */
  readonly clips: readonly AnimationClip[];
  /** The shard's own JSON the generator wrote beside the model. */
  readonly extras: unknown;
}
/**
 * An offline skinned model (`@wildshard/sharddev/bake/skinned` writes it): load once behind the loading screen, then take
 * copies. Each `copy()` hands out independent geometry (safe to merge, scale or dispose) bit-exact to what the generator
 * baked: every channel as written, the weights never renormalized, an authored triangle soup restored, the joints' exact
 * bind positions. The maps, clips and extras are shared. No services are installed on import.
 */
export interface SkinnedModel {
  /** Load the GLB through three's loading manager (the engine's tier / KTX2 / version URL policy applies, as to any
   * three loader); explicit bytes let a Node baker or test use the identical intake. */
  load: (bytes?: Uint8Array) => Promise<void>;
  loaded: () => boolean;
  copy: () => SkinnedAsset;
  /** The shared maps every copy draws with (for the owner's cache and upload policy). */
  textures: () => readonly Texture[];
  /** The loaded parts every copy clones (kept once, for the owner's cache policy). */
  geometries: () => readonly BufferGeometry[];
}

const isSkinnedMesh = (node: Object3D): node is SkinnedMesh => node instanceof SkinnedMesh;
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
/** The meshopt decoder's glTF entry (three's bundled decoder). */
interface MeshoptGltf { decodeGltfBuffer: (target: Uint8Array, count: number, size: number, source: Uint8Array, mode: string, filter?: string) => void }
const numbers = (value: unknown): number[] | null => Array.isArray(value) && value.every((n: unknown) => typeof n === 'number') ? value : null;

/** Each primitive's raw WEIGHTS_0 floats, read from the GLB's bytes before three's loader renormalizes them in place (a
 *  meshopt view decoded here, once at load, losslessly). */
function rawWeights(bytes: Uint8Array, decoder: MeshoptGltf): Map<string, Float32Array> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), length = view.getUint32(12, true);
  const doc: unknown = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + length)));
  const out = new Map<string, Float32Array>();
  if (!isRecord(doc) || !Array.isArray(doc['meshes']) || !Array.isArray(doc['accessors']) || !Array.isArray(doc['bufferViews'])) return out;
  const accessors: unknown[] = doc['accessors'], views: unknown[] = doc['bufferViews'], bin = bytes.subarray(28 + length);
  const int = (record: Record<string, unknown>, key: string): number => typeof record[key] === 'number' ? record[key] : 0;
  doc['meshes'].forEach((mesh: unknown, m) => {
    if (!isRecord(mesh) || !Array.isArray(mesh['primitives'])) return;
    mesh['primitives'].forEach((row: unknown, p) => {
      const attributes = isRecord(row) && isRecord(row['attributes']) ? row['attributes'] : {}, id = attributes['WEIGHTS_0'];
      const accessor = typeof id === 'number' ? accessors[id] : undefined, bufferView = isRecord(accessor) && typeof accessor['bufferView'] === 'number' ? views[accessor['bufferView']] : undefined;
      if (!isRecord(accessor) || !isRecord(bufferView) || accessor['componentType'] !== 5126 || typeof accessor['count'] !== 'number') return;
      const ext = isRecord(bufferView['extensions']) ? bufferView['extensions']['EXT_meshopt_compression'] : undefined;
      let source = bin.subarray(int(bufferView, 'byteOffset'), int(bufferView, 'byteOffset') + int(bufferView, 'byteLength'));
      if (isRecord(ext)) {
        const count = int(ext, 'count'), stride = int(ext, 'byteStride'), at = int(ext, 'byteOffset'), decoded = new Uint8Array(count * stride);
        decoder.decodeGltfBuffer(decoded, count, stride, bin.subarray(at, at + int(ext, 'byteLength')), String(ext['mode']), typeof ext['filter'] === 'string' ? ext['filter'] : 'NONE');
        source = decoded;
      }
      const floats = new DataView(source.buffer, source.byteOffset, source.byteLength), start = int(accessor, 'byteOffset'), weights = new Float32Array(accessor['count'] * 4);
      for (let i = 0; i < weights.length; i++) weights[i] = floats.getFloat32(start + i * 4, true);
      out.set(`${String(m)}/${String(p)}`, weights);
    });
  });
  return out;
}

/** A skinned model over one baked GLB (`url`); nothing loads until `load()`. */
export function skinnedModel(url: string): SkinnedModel {
  let template: SkinnedAsset | undefined, pending: Promise<void> | undefined;
  const load = async (bytes?: Uint8Array): Promise<void> => {
    const { MeshoptDecoder } = await import('three/examples/jsm/libs/meshopt_decoder.module.js');
    let input = bytes;
    if (input === undefined) {
      const response: unknown = await new FileLoader().setResponseType('arraybuffer').loadAsync(url);
      if (!(response instanceof ArrayBuffer)) throw new Error(`Skinned model load failed: ${url}`);
      input = new Uint8Array(response);
    }
    await MeshoptDecoder.ready;
    const weights = rawWeights(input, MeshoptDecoder);
    const gltf = await (await prepareRigLoader()).createRigLoader().parseBytesAsync(input, '');
    const meshes: SkinnedMesh[] = [];
    gltf.scene.traverse((node: Object3D) => { if (isSkinnedMesh(node)) meshes.push(node); });
    const first = meshes[0];
    if (first === undefined) throw new Error(`Skinned model has no skinned mesh: ${url}`);
    const joints = first.skeleton.bones;
    const bones: SkinnedJoint[] = joints.map((bone) => {
      const extras: unknown = bone.userData['wildshard'], bind = isRecord(extras) ? numbers(extras['bind']) : null;
      if (bind?.length !== 3) throw new Error(`Skinned joint ${bone.name} has no bind position: ${url}`);
      return { name: bone.name, parent: bone.parent instanceof Bone ? bone.parent.name : null, pos: [bind[0] ?? 0, bind[1] ?? 0, bind[2] ?? 0] };
    });
    const parts = meshes.map((mesh) => {
      if (mesh.skeleton.bones.length !== joints.length || mesh.skeleton.bones.some((bone, i) => bone.name !== joints[i]?.name)) throw new Error(`Skinned parts must share one skeleton: ${url}`);
      const association = gltf.parser.associations.get(mesh), exact = weights.get(`${String(association?.meshes ?? -1)}/${String(association?.primitives ?? 0)}`);
      let geometry = mesh.geometry.clone();
      const extras: unknown = geometry.userData['wildshard'];
      geometry.userData = {};
      if (exact === undefined || exact.length !== geometry.getAttribute('skinWeight').count * 4) throw new Error(`Skinned part has no float weights: ${url}`);
      geometry.setAttribute('skinWeight', new Float32BufferAttribute(exact, 4));
      if (isRecord(extras) && isRecord(extras['attributes'])) for (const [from, to] of Object.entries(extras['attributes'])) {
        const channel = from.toLowerCase();
        if (typeof to !== 'string' || !geometry.hasAttribute(channel)) throw new Error(`Skinned part is missing ${from}: ${url}`);
        geometry.setAttribute(to, geometry.getAttribute(channel)); geometry.deleteAttribute(channel);
      }
      if (isRecord(extras) && extras['soup'] === true) { const soup = geometry.toNonIndexed(); geometry.dispose(); geometry = soup; }
      geometry.computeBoundingBox(); geometry.computeBoundingSphere();
      const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material, map = material !== undefined && 'map' in material && material.map !== null && typeof material.map === 'object' ? material.map as Texture : null;
      return { name: mesh.name, geometry, map };
    });
    for (const mesh of meshes) {
      mesh.geometry.dispose();
      for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) material.dispose();
    }
    const extras: unknown = isRecord(gltf.asset.extras) ? gltf.asset.extras['wildshard'] : null;
    template = { bones, parts, clips: gltf.animations, extras };
  };
  const start = async (bytes?: Uint8Array): Promise<void> => {
    try { await load(bytes); } catch (error: unknown) { pending = undefined; throw error; }
  };
  return {
    load: (bytes) => { pending ??= start(bytes); return pending; },
    loaded: () => template !== undefined,
    textures: () => template === undefined ? [] : [...new Set(template.parts.flatMap((part) => part.map === null ? [] : [part.map]))],
    geometries: () => template === undefined ? [] : template.parts.map((part) => part.geometry),
    copy: () => {
      if (template === undefined) throw new Error(`Skinned model was not loaded: ${url}`);
      return { clips: template.clips, extras: template.extras, bones: template.bones.map((bone) => ({ name: bone.name, parent: bone.parent, pos: [bone.pos[0], bone.pos[1], bone.pos[2]] })),
        parts: template.parts.map((part) => ({ name: part.name, map: part.map, geometry: part.geometry.clone() })) };
    },
  };
}

/** A creature body's size (AnimalDims without its feet), as a baked body's extras and a stand-in row carry it. */
export interface CreatureDims { readonly bodyY: number; readonly bodyHalfLen: number; readonly bodyRadius: number; readonly headRadius: number; readonly legLen: number; readonly halfWidth: number }
/** What a creature stands as when its baked body did not load: its authored skeleton and size, drawn as `undrawnRig`. */
export interface CreatureStandIn { readonly bones: readonly { readonly name: string; readonly parent: string | null; readonly pos: readonly [number, number, number] }[]; readonly dims: CreatureDims }
/** A shard's baked creature bodies, as data: which load, from where, and each one's stand-in. */
export interface CreatureBodyRows<C extends string> {
  readonly creatures: readonly C[];
  readonly urls: Readonly<Record<C, string>>;
  readonly standIns: Readonly<Record<C, CreatureStandIn>>;
  /** opens every page fault (e.g. the shard's name in brackets) */
  readonly fault: string;
  /** the owner's upload policy for each shared map, once loaded (before it is retained) */
  readonly onMap?: (map: Texture) => void;
  /** Release an ImageBitmap decode at the original texture upload; no CPU consumer may retain it. */
  readonly releaseDecoded?: boolean;
}
/** A shard's loaded creature bodies: preload once, then each spawn takes a copy. */
export interface CreatureBodies<C extends string> {
  /** Load every body once (a failed one is a page fault). */
  preload: () => Promise<void>;
  /** A copy of a baked body, as a species look's `build()` returns it, or null (not loaded). */
  body: (creature: C) => AnimalSpecies | null;
  /** The baked copy, else its undrawn stand-in on its authored skeleton. */
  bodyOrStandIn: (creature: C) => AnimalSpecies;
}

/** A part baked without normals (a smaller file) gets its flat normals from its own positions, per copy. */
const flatNormals = (g: BufferGeometry): BufferGeometry => { if (!g.hasAttribute('normal')) g.computeVertexNormals(); return g; };
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
/** A baked body's extras as its look numbers (`dims`, optional `facetJitter` / `selfLight`), or null. */
function bodyExtras(value: unknown): { dims: CreatureDims; facetJitter?: number; selfLight?: number } | null {
  if (!isRecord(value) || !isRecord(value['dims'])) return null;
  const d = value['dims'], jitter = value['facetJitter'], light = value['selfLight'];
  const { bodyY, bodyHalfLen, bodyRadius, headRadius, legLen, halfWidth } = d;
  if (!finite(bodyY) || !finite(bodyHalfLen) || !finite(bodyRadius) || !finite(headRadius) || !finite(legLen) || !finite(halfWidth)) return null;
  return { dims: { bodyY, bodyHalfLen, bodyRadius, headRadius, legLen, halfWidth }, ...(finite(jitter) ? { facetJitter: jitter } : {}), ...(finite(light) ? { selfLight: light } : {}) };
}

/**
 * A shard's creature bodies baked offline as skinned GLBs (`skinnedModel`), each loaded once behind the loading screen;
 * every spawn takes a copy: its bones, skin, dims and painted map exactly as the generator baked them. A body that fails
 * to load is a `console.error` page fault and its species stands undrawn on its stand-in skeleton.
 */
export function creatureBodies<C extends string>(rows: CreatureBodyRows<C>): CreatureBodies<C> {
  const models = new Map<C, SkinnedModel>();
  let loading: Promise<void> | null = null;
  async function load(creature: C): Promise<void> {
    const model = skinnedModel(rows.urls[creature]);
    try {
      await model.load();
      for (const map of model.textures()) {
        rows.onMap?.(map);
        const image: unknown = map.image;
        if (rows.releaseDecoded === true && typeof ImageBitmap !== 'undefined' && image instanceof ImageBitmap) releaseOnUpload(map.source, () => { image.close(); });
      }
      // the maps and the loaded parts are kept once, like the model library's models; a retired one reloads on the next preload
      for (const kept of [...model.textures(), ...model.geometries()]) {
        retainCachedResources(kept);
        cacheUntilDisposed(kept, () => { if (models.get(creature) === model) { models.delete(creature); loading = null; } });
      }
      models.set(creature, model);
    } catch (e: unknown) { console.error(`${rows.fault} the baked creature ${creature} did not load:`, e); }
  }
  const body = (creature: C): AnimalSpecies | null => {
    const model = models.get(creature);
    if (model === undefined) return null;
    const asset = model.copy(), extras = bodyExtras(asset.extras), map = asset.parts[0]?.map ?? null;
    if (extras === null) throw new Error(`${rows.fault} the baked creature ${creature} has no dims`);
    return { bones: asset.bones.map((bone) => ({ name: bone.name, parent: bone.parent, pos: bone.pos })), furParts: [], eyeParts: [], hardParts: asset.parts.map((part) => flatNormals(part.geometry)),
      dims: { ...extras.dims, feet: [] }, ...(map === null ? {} : { map }), ...(extras.facetJitter === undefined ? {} : { facetJitter: extras.facetJitter }),
      ...(extras.selfLight === undefined ? {} : { selfLight: extras.selfLight }) };
  };
  return {
    preload: () => { loading ??= Promise.all(rows.creatures.filter((creature) => !models.has(creature)).map(load)).then(() => undefined); return loading; },
    body,
    bodyOrStandIn: (creature) => {
      const stand = rows.standIns[creature];
      return body(creature) ?? { bones: stand.bones.map((bone) => ({ name: bone.name, parent: bone.parent, pos: [bone.pos[0], bone.pos[1], bone.pos[2]] })), furParts: [], eyeParts: [],
        hardParts: [undrawnRig()], dims: { ...stand.dims, feet: [] } };
    },
  };
}

/** A baked body's species look as rows: its ids and rig contract (its dims ride in the baked body). */
export interface BakedLookRow {
  /** An admitted pure colour graph decorates the original material; lighting, maps and hit flash stay owned by the factory. */
  readonly colourTransform?: { readonly id: string; readonly row: unknown };
  readonly id: string; readonly species: string; readonly kind: string;
  readonly skeleton: string; readonly sockets: readonly SocketName[]; readonly clipNames: readonly ClipName[];
}
/** A species look on a baked creature body (`build`: a fresh copy each time, `creatureBodies(...).bodyOrStandIn`), animated
 *  by its clip rows. Signal Dunes' and Sky Reach's creatures declare their looks this way. */
export function bakedLook(row: BakedLookRow, build: () => AnimalSpecies, clips: SpeciesClips): SpeciesLook {
  const transform = row.colourTransform, decorated = new WeakSet<Material>();
  if (transform !== undefined && !/^[a-zA-Z][a-zA-Z0-9.:-]{0,127}$/u.test(transform.id)) throw new Error('Invalid baked look colour id');
  return { id: row.id, species: row.species, kind: row.kind, rig: 'custom', fur: NO_FUR,
    ...(transform === undefined ? {} : { decorateMaterials: (materials: readonly Material[]): void => {
      if (materials.length > 64) throw new Error('Baked look material roster exceeds its bound');
      for (const material of materials) {
        if (decorated.has(material)) continue; decorated.add(material);
        materialColourGraph(material, transform.id, transform.row);
      }
    } }),
    rigContract: { skeleton: row.skeleton, sockets: [...row.sockets], clips: [...row.clipNames] }, build, animate: clipAnimate(clips) };
}

/** One authored look on an existing baked body, with its original clip rows. */
export interface CreatureLookRow<C extends string> { readonly body: C; readonly look: BakedLookRow; readonly clips: SpeciesClips }
/** Build an ordered look catalogue on the existing body loader; every spawn keeps its own body copy and clip state. */
export function creatureLooks<C extends string>(bodies: Pick<CreatureBodies<C>, 'bodyOrStandIn'>, rows: readonly CreatureLookRow<C>[]): readonly SpeciesLook[] {
  return rows.map(row => bakedLook(row.look, () => bodies.bodyOrStandIn(row.body), row.clips));
}

/** A specimen's authored hard-part selection and unchanged standard material. */
export interface CreatureSpecimenRow {
  readonly parts: 'all' | 'first'; readonly material: MeshStandardMaterialParameters; readonly scale?: number;
}
/** Build an Explorer specimen from an actual body copy without posing or fitting
 * its geometry. All parts retain their order in a Group; first-part specimens
 * retain the original Mesh and zero-area fallback for absent geometry. */
export function creatureSpecimen(body: AnimalSpecies, row: CreatureSpecimenRow): Group | Mesh {
  const scale = row.scale ?? 1;
  if (!Number.isFinite(scale) || scale <= 0) throw new Error('Creature specimen scale must be finite and positive');
  if (row.parts === 'first') {
    const mesh = new Mesh(body.hardParts[0] ?? undrawnRig(), new MeshStandardMaterial(row.material));
    mesh.scale.setScalar(scale); return mesh;
  }
  const group = new Group();
  for (const part of body.hardParts) group.add(new Mesh(part, new MeshStandardMaterial(row.material)));
  group.scale.setScalar(scale); return group;
}

/** Fit a geometry into a frame (turned `yaw` radians about +Y first): centred on x / z, its lowest point at `floor`, scaled to `size`. */
export function fitGeometry(g: BufferGeometry, o: ModelFit): BufferGeometry {
  if (o.yaw !== undefined) g.rotateY(o.yaw);
  const p = g.getAttribute('position'), b = new Box3().setFromBufferAttribute(p as BufferAttribute);
  if (o.centre === 'base') {
    let x = 0, z = 0, n = 0; const top = b.min.y + (b.max.y - b.min.y) * 0.1;
    for (let i = 0; i < p.count; i++) if (p.getY(i) <= top) { x += p.getX(i); z += p.getZ(i); n++; }
    if (n > 0) { const cx = x / n, cz = z / n, hx = Math.max(b.max.x - cx, cx - b.min.x), hz = Math.max(b.max.z - cz, cz - b.min.z); b.min.x = cx - hx; b.max.x = cx + hx; b.min.z = cz - hz; b.max.z = cz + hz; }
  }
  const span = o.by === 'height' ? b.max.y - b.min.y : Math.max(b.max.x - b.min.x, b.max.z - b.min.z), k = o.size / Math.max(1e-6, span);
  g.translate(-(b.min.x + b.max.x) / 2, -b.min.y, -(b.min.z + b.max.z) / 2);
  g.scale(k, k, k); g.translate(0, o.floor ?? 0, 0); g.computeBoundingBox(); g.computeBoundingSphere();
  return g;
}

// The canvas atlas (SHARD-PLATFORM M3): a 2D-canvas texture painted from draw steps that are data. A shard lists its
// decals (an engraved strip, a paper talisman, a label sheet) as rows; `paintCanvasAtlas` replays them on one canvas, in
// order, and returns it as a mipmapped sRGB texture. Each step is one canvas call or a small deterministic loop:
//  - `set`: any of fill / stroke style, line width / cap / join, font, text align / baseline, global alpha;
//  - `fillRect` / `strokeRect`; `save` / `restore` / `translate` / `scale` / `rotate` (angles in half turns, × π);
//  - `path`: one beginPath, its segments (M / L / A: arcs with angles × π) and a stroke or fill; with a scale `s` every
//    coordinate and radius is `s × value`, offset by `at` when given;
//  - `text`: fillText at a point;
//  - `radial`: a radial gradient (its stops) filling a rectangle;
//  - `speckle`: n seeded random marks (a Park–Miller sequence) in two styles over a rectangle (paper fibre);
//  - `grain`: n marks on a fixed stride pattern over a rectangle (a quieter fibre).
// Drawn at `scale` (the canvas `scale` times the authored size, every coordinate kept): a phone tier halves an atlas.
//
// Procedural painters (a fern frond, a pebble scatter, an end-grain disc) are the same rows with expressions: a value is
// a number or an expression string (`'128 + sin(t * 2.2) * 6'`), evaluated with JavaScript's operators, precedence and
// left-to-right order, so every double is the one the hand-written painter computed. A style string holding `{expr}`
// parts is a template (`'rgb({52 + hue * 6},{82 + hue * 8},34)'`, each part as JavaScript's `${}` prints it).
//  - `rng`: the painter's random stream, the engine's `Rng` from a seed (`next()` and `range(a, b)` in expressions);
//  - `let` / `assign` / `fn` / `list` / `push`: block-scoped values, expression functions and lists of tuples;
//  - `loop` (n times) / `for` (from, while, next) / `each` (over numbers or a list) / `if`: control, each body a scope (`if` runs `yes` or `no`);
//  - `call`: one path or rect call with expression arguments; `gradient`: a linear or radial gradient as the fill or
//    stroke style; `valueNoise`: an octave value-noise ImageData from the stream (grey, opaque) put at the origin.
// Expression built-ins: PI, sin, cos, tan, atan2, sqrt, abs, floor, ceil, round, min, max, next, range, and the vars
// the caller passes (a level's seed).



/** one path segment: move, line, or arc (centre, radius, start and end angle in half turns, and when given whether it
 *  runs counter-clockwise) */
export type CanvasSegment = readonly ['M', number, number] | readonly ['L', number, number] | readonly ['A', number, number, number, number, number] | readonly ['A', number, number, number, number, number, boolean];

/** a number, or an expression string evaluated in the painter's scope */
export type CanvasExpr = number | string;

/** the canvas calls a `call` step makes, its arguments expressions */
export type CanvasCall = 'beginPath' | 'closePath' | 'fill' | 'stroke' | 'moveTo' | 'lineTo' | 'arc' | 'ellipse' | 'quadraticCurveTo' | 'bezierCurveTo' | 'fillRect' | 'strokeRect' | 'translate' | 'scale' | 'rotate' | 'save' | 'restore';

/** a draw step as data */
export type CanvasStep =
  | { readonly op: 'set'; readonly fill?: string; readonly stroke?: string; readonly width?: CanvasExpr; readonly cap?: CanvasLineCap; readonly join?: CanvasLineJoin; readonly font?: string; readonly align?: CanvasTextAlign; readonly baseline?: CanvasTextBaseline; readonly alpha?: CanvasExpr }
  | { readonly op: 'fillRect' | 'strokeRect'; readonly x: number; readonly y: number; readonly w: number; readonly h: number }
  | { readonly op: 'save' | 'restore' }
  | { readonly op: 'translate' | 'scale'; readonly x: number; readonly y: number }
  | { readonly op: 'rotate'; readonly turns: number }
  | { readonly op: 'path'; readonly segs: readonly CanvasSegment[]; readonly s?: number; readonly at?: readonly [number, number]; readonly fill?: boolean }
  | { readonly op: 'text'; readonly text: string; readonly x: number; readonly y: number }
  | { readonly op: 'radial'; readonly from: readonly [number, number, number]; readonly to: readonly [number, number, number]; readonly stops: readonly (readonly [number, string])[]; readonly x: number; readonly y: number; readonly w: number; readonly h: number }
  | { readonly op: 'speckle'; readonly n: number; readonly seed: number; readonly split: number; readonly styles: readonly [string, string]; readonly x: number; readonly y: number; readonly w: number; readonly h: number; readonly mark: readonly [number, number, number, number] }
  | { readonly op: 'grain'; readonly n: number; readonly stride: readonly [number, number]; readonly mark: readonly [number, number, number, number]; readonly x: number; readonly y: number; readonly w: number; readonly h: number }
  | { readonly op: 'rng'; readonly seed: CanvasExpr }
  | { readonly op: 'let' | 'assign'; readonly vars: readonly (readonly [string, CanvasExpr])[] }
  | { readonly op: 'fn'; readonly name: string; readonly params: readonly string[]; readonly body: string }
  | { readonly op: 'list'; readonly name: string }
  | { readonly op: 'push'; readonly list: string; readonly vals: readonly CanvasExpr[] }
  | { readonly op: 'loop'; readonly v: string; readonly n: CanvasExpr; readonly body: readonly CanvasStep[] }
  | { readonly op: 'for'; readonly v: string; readonly from: CanvasExpr; readonly while: string; readonly next: string; readonly body: readonly CanvasStep[] }
  | { readonly op: 'each'; readonly v: string | readonly string[]; readonly of: string | readonly number[]; readonly body: readonly CanvasStep[] }
  | { readonly op: 'if'; readonly cond: string; readonly yes: readonly CanvasStep[]; readonly no?: readonly CanvasStep[] }
  | { readonly op: 'call'; readonly fn: CanvasCall; readonly args?: readonly CanvasExpr[] }
  | { readonly op: 'gradient'; readonly kind: 'linear' | 'radial'; readonly args: readonly CanvasExpr[]; readonly stops: readonly (readonly [CanvasExpr, string])[]; readonly to?: 'fill' | 'stroke' }
  | { readonly op: 'valueNoise'; readonly size: number; readonly octaves: readonly number[]; readonly amp: number; readonly gain: number };

/** an atlas as data: its authored size, the draw scale (undefined: no scale call) and its steps */
export interface CanvasAtlasRow { readonly w: number; readonly h: number; readonly steps: readonly CanvasStep[] }

// ───────────────────────────── expressions ─────────────────────────────

type Value = number | string | boolean;
type Compiled = (s: Scope) => Value;
interface PaintState { readonly g: CanvasRenderingContext2D; rng: Rng | null }
interface ExprFn { readonly params: readonly string[]; readonly body: Compiled; readonly scope: Scope }

class Scope {
  readonly vars = new Map<string, Value>();
  readonly lists = new Map<string, Value[][]>();
  readonly fns = new Map<string, ExprFn>();
  readonly parent: Scope | null;
  readonly paint: PaintState;
  constructor(parent: Scope | null, paint: PaintState) { this.parent = parent; this.paint = paint; }
  child(): Scope { return new Scope(this, this.paint); }
  owner<K>(pick: (s: Scope) => Map<string, K>, name: string): Map<string, K> {
    if (pick(this).has(name)) return pick(this);
    if (this.parent === null) throw new Error(`canvas painter: unknown name ${name}`);
    return this.parent.owner(pick, name);
  }
  get(name: string): Value { const v = this.owner((s) => s.vars, name).get(name); if (v === undefined) throw new Error(name); return v; }
  list(name: string): Value[][] { const l = this.owner((s) => s.lists, name).get(name); if (l === undefined) throw new Error(name); return l; }
  fn(name: string): ExprFn | undefined { return this.fns.get(name) ?? this.parent?.fn(name); }
}

const truthy = (v: Value): boolean => (typeof v === 'number' ? v !== 0 && !Number.isNaN(v) : typeof v === 'string' ? v !== '' : v);
function num(v: Value): number {
  if (typeof v !== 'number') throw new Error(`canvas painter: ${String(v)} is not a number`);
  return v;
}
function stream(s: Scope): Rng {
  const r = s.paint.rng;
  if (r === null) throw new Error('canvas painter: no rng step before next() / range()');
  return r;
}
const MATH: Readonly<Record<string, (a: readonly number[]) => number>> = {
  sin: (a) => Math.sin(canvasArgument(a, 0)), cos: (a) => Math.cos(canvasArgument(a, 0)), tan: (a) => Math.tan(canvasArgument(a, 0)), atan2: (a) => Math.atan2(canvasArgument(a, 0), canvasArgument(a, 1)),
  sqrt: (a) => Math.sqrt(canvasArgument(a, 0)), abs: (a) => Math.abs(canvasArgument(a, 0)), floor: (a) => Math.floor(canvasArgument(a, 0)), ceil: (a) => Math.ceil(canvasArgument(a, 0)),
  round: (a) => Math.round(canvasArgument(a, 0)), min: (a) => Math.min(...a), max: (a) => Math.max(...a),
};
function canvasArgument(a: readonly number[], i: number): number {
  const v = a[i];
  if (v === undefined) throw new Error('canvas painter: missing argument');
  return v;
}

const TOKEN = /\s*(?:(\d+(?:\.\d*)?(?:[eE][-+]?\d+)?|\.\d+(?:[eE][-+]?\d+)?)|([A-Za-z_]\w*)|'([^']*)'|(\*\*|===|!==|<=|>=|&&|\|\||[-+*/%<>()?:,!]))/yu;
const BINARY: Readonly<Record<string, (a: number, b: number) => Value>> = {
  '+': (a, b) => a + b, '-': (a, b) => a - b, '*': (a, b) => a * b, '/': (a, b) => a / b, '%': (a, b) => a % b, '**': (a, b) => a ** b,
  '<': (a, b) => a < b, '<=': (a, b) => a <= b, '>': (a, b) => a > b, '>=': (a, b) => a >= b,
};
const LEVELS: readonly (readonly string[])[] = [['===', '!=='], ['<', '<=', '>', '>='], ['+', '-'], ['*', '/', '%']];

interface Token { readonly k: 'n' | 'id' | 's' | 'op'; readonly t: string }
function tokens(src: string): Token[] {
  const toks: Token[] = [];
  TOKEN.lastIndex = 0;
  while (TOKEN.lastIndex < src.length) {
    if (/^\s*$/u.test(src.slice(TOKEN.lastIndex))) break;
    const m = TOKEN.exec(src);
    if (m === null) throw new Error(`canvas painter: cannot read "${src}" at ${TOKEN.lastIndex}`);
    if (m[1] !== undefined) toks.push({ k: 'n', t: m[1] });
    else if (m[2] !== undefined) toks.push({ k: 'id', t: m[2] });
    else if (m[3] !== undefined) toks.push({ k: 's', t: m[3] });
    else toks.push({ k: 'op', t: m[4] ?? '' });
  }
  return toks;
}

/** a recursive-descent parse of one expression into a closure (JavaScript's precedence, associativity and order) */
class Parser {
  private p = 0;
  private readonly toks: readonly Token[];
  private readonly src: string;
  constructor(src: string) { this.src = src; this.toks = tokens(src); }
  parse(): Compiled {
    const out = this.ternary();
    if (this.p !== this.toks.length) throw new Error(`canvas painter: trailing input in "${this.src}"`);
    return out;
  }
  private peek(t: string): boolean { const k = this.toks[this.p]; return k?.k === 'op' && k.t === t; }
  private eat(t: string): void { if (!this.peek(t)) throw new Error(`canvas painter: expected ${t} in "${this.src}"`); this.p++; }
  private ternary(): Compiled {
    const c = this.or();
    if (!this.peek('?')) return c;
    this.p++;
    const a = this.ternary(); this.eat(':'); const b = this.ternary();
    return (s) => (truthy(c(s)) ? a(s) : b(s));
  }
  private or(): Compiled {
    let l = this.and();
    while (this.peek('||')) { this.p++; const a = l, b = this.and(); l = (s) => { const v = a(s); return truthy(v) ? v : b(s); }; }
    return l;
  }
  private and(): Compiled {
    let l = this.level(0);
    while (this.peek('&&')) { this.p++; const a = l, b = this.level(0); l = (s) => { const v = a(s); return truthy(v) ? b(s) : v; }; }
    return l;
  }
  private level(i: number): Compiled {
    const ops = LEVELS[i];
    if (ops === undefined) return this.unary();
    let l = this.level(i + 1);
    for (let t = this.toks[this.p]; t?.k === 'op' && ops.includes(t.t); t = this.toks[this.p]) {
      this.p++;
      const a = l, b = this.level(i + 1), op = t.t;
      if (op === '===') l = (s) => a(s) === b(s);
      else if (op === '!==') l = (s) => a(s) !== b(s);
      else { const f = BINARY[op]; if (f === undefined) throw new Error(op); l = (s) => f(num(a(s)), num(b(s))); }
    }
    return l;
  }
  private unary(): Compiled {
    if (this.peek('-')) { this.p++; const a = this.unary(); return (s) => -num(a(s)); }
    if (this.peek('!')) { this.p++; const a = this.unary(); return (s) => !truthy(a(s)); }
    const base = this.primary();
    if (!this.peek('**')) return base;
    this.p++;
    const e = this.unary();
    return (s) => num(base(s)) ** num(e(s));
  }
  private primary(): Compiled {
    const t = this.toks[this.p++];
    if (t === undefined) throw new Error(`canvas painter: "${this.src}" ends early`);
    if (t.k === 'n') { const v = Number(t.t); return () => v; }
    if (t.k === 's') { const v = t.t; return () => v; }
    if (t.k === 'op') { if (t.t !== '(') throw new Error(`canvas painter: unexpected ${t.t} in "${this.src}"`); const e = this.ternary(); this.eat(')'); return e; }
    const name = t.t;
    if (!this.peek('(')) return name === 'PI' ? () => Math.PI : (s) => s.get(name);
    this.p++;
    const args: Compiled[] = [];
    while (!this.peek(')')) { args.push(this.ternary()); if (!this.peek(')')) this.eat(','); }
    this.p++;
    return callOf(name, args);
  }
}

function callOf(name: string, args: readonly Compiled[]): Compiled {
  if (name === 'next') return (s) => stream(s).next();
  if (name === 'range') return (s) => { const a = num(argOf(args, 0)(s)), b = num(argOf(args, 1)(s)); return stream(s).range(a, b); };
  const m = MATH[name];
  if (m !== undefined) return (s) => m(args.map((a) => num(a(s))));
  return (s) => {
    const f = s.fn(name);
    if (f === undefined) throw new Error(`canvas painter: unknown function ${name}`);
    const vals = args.map((a) => a(s)), inner = f.scope.child();
    for (const [i, n] of f.params.entries()) inner.vars.set(n, vals[i] ?? 0);
    return f.body(inner);
  };
}
function argOf(args: readonly Compiled[], i: number): Compiled {
  const a = args[i];
  if (a === undefined) throw new Error('canvas painter: missing argument');
  return a;
}

const compiled = new Map<string, Compiled>();
function compile(src: string): Compiled {
  let c = compiled.get(src);
  if (c === undefined) { c = new Parser(src).parse(); compiled.set(src, c); }
  return c;
}
const value = (e: CanvasExpr, s: Scope): Value => (typeof e === 'number' ? e : compile(e)(s));
const number = (e: CanvasExpr, s: Scope): number => (typeof e === 'number' ? e : num(compile(e)(s)));

const templates = new Map<string, readonly (string | Compiled)[]>();
/** a style string: literal, or a template whose `{expr}` parts print as JavaScript's `${}` does */
function style(t: string, s: Scope): string {
  if (!t.includes('{')) return t;
  let parts = templates.get(t);
  if (parts === undefined) {
    const out: (string | Compiled)[] = [];
    for (const piece of t.split(/(\{[^}]*\})/u)) if (piece !== '') out.push(piece.startsWith('{') ? compile(piece.slice(1, -1)) : piece);
    parts = out;
    templates.set(t, parts);
  }
  let r = '';
  for (const part of parts) r += typeof part === 'string' ? part : String(part(s));
  return r;
}

// ───────────────────────────── steps ─────────────────────────────

function set(g: CanvasRenderingContext2D, st: Extract<CanvasStep, { op: 'set' }>, s: Scope): void {
  if (st.fill !== undefined) g.fillStyle = style(st.fill, s);
  if (st.stroke !== undefined) g.strokeStyle = style(st.stroke, s);
  if (st.width !== undefined) g.lineWidth = number(st.width, s);
  if (st.cap !== undefined) g.lineCap = st.cap;
  if (st.join !== undefined) g.lineJoin = st.join;
  if (st.font !== undefined) g.font = st.font;
  if (st.align !== undefined) g.textAlign = st.align;
  if (st.baseline !== undefined) g.textBaseline = st.baseline;
  if (st.alpha !== undefined) g.globalAlpha = number(st.alpha, s);
}

function path(g: CanvasRenderingContext2D, p: Extract<CanvasStep, { op: 'path' }>): void {
  const k = p.s, at0 = p.at;
  // a coordinate: the scaled value, offset by `at` (the same arithmetic an authored `x + s * k` performs)
  const cx = (v: number): number => (k === undefined ? v : at0 === undefined ? k * v : at0[0] + k * v);
  const cy = (v: number): number => (k === undefined ? v : at0 === undefined ? k * v : at0[1] + k * v);
  const r = (v: number): number => (k === undefined ? v : k * v);
  g.beginPath();
  for (const seg of p.segs) {
    if (seg[0] === 'M') g.moveTo(cx(seg[1]), cy(seg[2]));
    else if (seg[0] === 'L') g.lineTo(cx(seg[1]), cy(seg[2]));
    else if (seg.length === 7) g.arc(cx(seg[1]), cy(seg[2]), r(seg[3]), Math.PI * seg[4], Math.PI * seg[5], seg[6]);
    else g.arc(cx(seg[1]), cy(seg[2]), r(seg[3]), Math.PI * seg[4], Math.PI * seg[5]);
  }
  if (p.fill === true) g.fill(); else g.stroke();
}

function call(g: CanvasRenderingContext2D, fn: CanvasCall, a: readonly number[]): void {
  switch (fn) {
    case 'beginPath': g.beginPath(); break;
    case 'closePath': g.closePath(); break;
    case 'fill': g.fill(); break;
    case 'stroke': g.stroke(); break;
    case 'save': g.save(); break;
    case 'restore': g.restore(); break;
    case 'moveTo': g.moveTo(canvasArgument(a, 0), canvasArgument(a, 1)); break;
    case 'lineTo': g.lineTo(canvasArgument(a, 0), canvasArgument(a, 1)); break;
    case 'translate': g.translate(canvasArgument(a, 0), canvasArgument(a, 1)); break;
    case 'scale': g.scale(canvasArgument(a, 0), canvasArgument(a, 1)); break;
    case 'rotate': g.rotate(canvasArgument(a, 0)); break;
    case 'arc': g.arc(canvasArgument(a, 0), canvasArgument(a, 1), canvasArgument(a, 2), canvasArgument(a, 3), canvasArgument(a, 4)); break;
    case 'ellipse': g.ellipse(canvasArgument(a, 0), canvasArgument(a, 1), canvasArgument(a, 2), canvasArgument(a, 3), canvasArgument(a, 4), canvasArgument(a, 5), canvasArgument(a, 6)); break;
    case 'quadraticCurveTo': g.quadraticCurveTo(canvasArgument(a, 0), canvasArgument(a, 1), canvasArgument(a, 2), canvasArgument(a, 3)); break;
    case 'bezierCurveTo': g.bezierCurveTo(canvasArgument(a, 0), canvasArgument(a, 1), canvasArgument(a, 2), canvasArgument(a, 3), canvasArgument(a, 4), canvasArgument(a, 5)); break;
    case 'fillRect': g.fillRect(canvasArgument(a, 0), canvasArgument(a, 1), canvasArgument(a, 2), canvasArgument(a, 3)); break;
    case 'strokeRect': g.strokeRect(canvasArgument(a, 0), canvasArgument(a, 1), canvasArgument(a, 2), canvasArgument(a, 3)); break;
    default: { const unknown: never = fn; throw new Error(`unknown canvas call ${String(unknown)}`); }
  }
}

/** octave value noise from the stream: one n × n lattice of `next()` per octave, smoothstep-blended, amplitudes from
 *  `amp` falling by `gain`, written grey and opaque to a size × size ImageData put at the origin */
function valueNoise(g: CanvasRenderingContext2D, st: Extract<CanvasStep, { op: 'valueNoise' }>, rng: Rng): void {
  const sz = st.size, img = g.createImageData(sz, sz);
  const oct = st.octaves.map((n) => { const a = new Float32Array(n * n); for (let i = 0; i < a.length; i++) a[i] = rng.next(); return { n, a }; });
  const sm = (t: number): number => t * t * (3 - 2 * t);
  for (let y = 0; y < sz; y++) for (let x = 0; x < sz; x++) {
    let v = 0, amp = st.amp, sum = 0;
    for (const { n, a } of oct) {
      const fx = (x / sz) * n, fy = (y / sz) * n, x0 = Math.floor(fx), y0 = Math.floor(fy), tx = sm(fx - x0), ty = sm(fy - y0);
      const q = (i: number, j: number): number => a[((j + n) % n) * n + ((i + n) % n)] ?? 0;
      const vv = (q(x0, y0) * (1 - tx) + q(x0 + 1, y0) * tx) * (1 - ty) + (q(x0, y0 + 1) * (1 - tx) + q(x0 + 1, y0 + 1) * tx) * ty;
      v += vv * amp; sum += amp; amp *= st.gain;
    }
    const b = Math.floor((v / sum) * 255), i = (y * sz + x) * 4;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = b; img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
}

function run(g: CanvasRenderingContext2D, steps: readonly CanvasStep[], sc: Scope): void {
  for (const s of steps) {
    switch (s.op) {
      case 'set': set(g, s, sc); break;
      case 'fillRect': g.fillRect(s.x, s.y, s.w, s.h); break;
      case 'strokeRect': g.strokeRect(s.x, s.y, s.w, s.h); break;
      case 'save': g.save(); break;
      case 'restore': g.restore(); break;
      case 'translate': g.translate(s.x, s.y); break;
      case 'scale': g.scale(s.x, s.y); break;
      case 'rotate': g.rotate(Math.PI * s.turns); break;
      case 'path': path(g, s); break;
      case 'text': g.fillText(s.text, s.x, s.y); break;
      case 'radial': {
        const grd = g.createRadialGradient(s.from[0], s.from[1], s.from[2], s.to[0], s.to[1], s.to[2]);
        for (const [stop, colour] of s.stops) grd.addColorStop(stop, colour);
        g.fillStyle = grd;
        g.fillRect(s.x, s.y, s.w, s.h);
        break;
      }
      case 'speckle': {
        let q = s.seed;
        const rnd = (): number => { q = (q * 16807) % 2147483647; return q / 2147483647; };
        const [w0, w1, h0, h1] = s.mark;
        for (let i = 0; i < s.n; i++) {
          g.fillStyle = rnd() < s.split ? s.styles[0] : s.styles[1];
          g.fillRect(s.x + rnd() * s.w, s.y + rnd() * s.h, w0 + rnd() * w1, h0 + rnd() * h1);
        }
        break;
      }
      case 'grain': {
        const [w0, wm, h0, hm] = s.mark;
        for (let i = 0; i < s.n; i++) g.fillRect(s.x + ((i * s.stride[0]) % s.w), s.y + ((i * s.stride[1]) % s.h), w0 + (i % wm), h0 + (i % hm));
        break;
      }
      case 'rng': sc.paint.rng = new Rng(number(s.seed, sc)); break;
      case 'let': for (const [n, e] of s.vars) sc.vars.set(n, value(e, sc)); break;
      case 'assign': for (const [n, e] of s.vars) { const v = value(e, sc); sc.owner((x) => x.vars, n).set(n, v); } break;
      case 'fn': sc.fns.set(s.name, { params: s.params, body: compile(s.body), scope: sc }); break;
      case 'list': sc.lists.set(s.name, []); break;
      case 'push': { const l = sc.list(s.list); l.push(s.vals.map((e) => value(e, sc))); break; }
      case 'loop': { const n = number(s.n, sc); for (let i = 0; i < n; i++) { const it = sc.child(); it.vars.set(s.v, i); run(g, s.body, it); } break; }
      case 'for': {
        for (let cur = number(s.from, sc); ;) {
          const it = sc.child(); it.vars.set(s.v, cur);
          if (!truthy(compile(s.while)(it))) break;
          run(g, s.body, it);
          cur = num(compile(s.next)(it));
        }
        break;
      }
      case 'each': {
        if (typeof s.of === 'string') {
          const names = typeof s.v === 'string' ? [s.v] : s.v;
          for (const row of sc.list(s.of)) { const it = sc.child(); for (const [i, n] of names.entries()) it.vars.set(n, row[i] ?? 0); run(g, s.body, it); }
        } else for (const v of s.of) { const it = sc.child(); it.vars.set(typeof s.v === 'string' ? s.v : (s.v[0] ?? ''), v); run(g, s.body, it); }
        break;
      }
      case 'if': {
        if (truthy(compile(s.cond)(sc))) run(g, s.yes, sc.child());
        else if (s.no !== undefined) run(g, s.no, sc.child());
        break;
      }
      case 'call': call(g, s.fn, (s.args ?? []).map((e) => number(e, sc))); break;
      case 'gradient': {
        const a = s.args.map((e) => number(e, sc));
        const grd = s.kind === 'linear' ? g.createLinearGradient(canvasArgument(a, 0), canvasArgument(a, 1), canvasArgument(a, 2), canvasArgument(a, 3)) : g.createRadialGradient(canvasArgument(a, 0), canvasArgument(a, 1), canvasArgument(a, 2), canvasArgument(a, 3), canvasArgument(a, 4), canvasArgument(a, 5));
        for (const [stop, colour] of s.stops) grd.addColorStop(number(stop, sc), style(colour, sc));
        if (s.to === 'stroke') g.strokeStyle = grd; else g.fillStyle = grd;
        break;
      }
      case 'valueNoise': valueNoise(g, s, stream(sc)); break;
      default: {
        const unknown: never = s;
        throw new Error(`unknown canvas step ${JSON.stringify(unknown)}`);
      }
    }
  }
}

/** replay an atlas's steps on a 2D context (already sized and scaled); `vars` seeds the expressions' scope (a level seed) */
export function paintSteps(g: CanvasRenderingContext2D, steps: readonly CanvasStep[], vars: Readonly<Record<string, number>> = {}): void {
  const root = new Scope(null, { g, rng: null });
  for (const [k, v] of Object.entries(vars)) root.vars.set(k, v);
  run(g, steps, root);
}

/** paint an atlas row on a new canvas at `scale` (undefined: no scale call) and return it as a mipmapped sRGB texture */
export function paintCanvasAtlas(row: CanvasAtlasRow, scale?: number): CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = row.w * (scale ?? 1);
  cv.height = row.h * (scale ?? 1);
  const g = cv.getContext('2d');
  if (g === null) throw new Error('2d canvas unavailable');
  if (scale !== undefined) g.scale(scale, scale); // preserve all authored UVs and drawing coordinates at any resolution
  paintSteps(g, row.steps);
  const tex = new CanvasTexture(cv);
  tex.colorSpace = SRGBColorSpace;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.anisotropy = 8;
  return tex;
}

/** Fetch a zlib-deflated bake and inflate it (a failed fetch throws). */
export function fetchDeflated(url: string): Promise<Uint8Array> {
  return fetchDeflatedBytes(url);
}

/**
 * Fetch a trusted runtime's own build file (its generator's output, imported with Vite's `?url`) as its bytes, for a runtime
 * that decodes it in its own slices rather than evaluating it as module data (Nine Dragon's 6.8 MB layout). A failed fetch
 * throws.
 */
export async function fetchBuildFile(url: string): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${String(response.status)} ${url}`);
  return new Uint8Array(await response.arrayBuffer());
}

// Lane-shuffled bakes (SHARD-PLATFORM M3; Pine Hollow's crags, streams, timbers, lookout and wildlife): a binary of 4-byte
// words whose bytes are split into four lanes (every word's first bytes, then its second …: floats compress ~30 % better
// so), deflated. A shard's generator writes them; the page reads them here.

/** Restore byte lanes, optionally filling a word range in a distinct complete output. */
export function unshuffleLanes(lanes: Uint8Array, out: Uint8Array<ArrayBuffer> = new Uint8Array(lanes.length), wordStart = 0, wordEnd: number = lanes.length / 4): Uint8Array {
  return restoreLanes(lanes, out, wordStart, wordEnd);
}

/** Fetch a lane-shuffled bake and restore its bytes within the live construction budget. */
export function fetchLaneBake(url: string): Promise<Uint8Array> {
  return fetchLaneBytes(url);
}

// Built geometry as an offline bake stores it: the codec lives in `./bakedGeometry` (build-time producers import it
// alone); the page's names stay here.
/** an attribute's element type in the bake ('f16' is a half float held in a Uint16Array, Float16BufferAttribute) */
export type BakedType = CodecBakedType;
/** one baked geometry: its attributes [name, type, item size, normalized], vertex count, index (stored as deltas) */
export type BakedGeometryRow = CodecBakedGeometryRow;
/** bytes per element of each baked type */
export const BAKED_BYTES: typeof codecBakedBytes = codecBakedBytes;
/** a block's length padded to 4 bytes */
export const pad4: typeof codecPad4 = codecPad4;
/** the bytes a row's blocks take in the bake */
export const bakedGeometryBytes: typeof codecBakedGeometryBytes = codecBakedGeometryBytes;
/** read geometry `row` from `bytes` at `offset` (the arrays are copies the geometry owns) */
export const readBakedGeometry: typeof codecReadBakedGeometry = codecReadBakedGeometry;

/** A baked read expanded to one vertex per corner (a row's `expand`): the same positions, so the read's bounds carry over
 *  (G639: recomputing them over the expanded copy cost ~0.2 s of single Nalati entry frames). The read is disposed. */
export function expandBakedGeometry(geometry: BufferGeometry): BufferGeometry {
  return carryBounds(geometry, geometry.toNonIndexed());
}
function carryBounds(geometry: BufferGeometry, flat: BufferGeometry): BufferGeometry {
  if (geometry.boundingBox === null) geometry.computeBoundingBox();
  flat.boundingBox = geometry.boundingBox; flat.boundingSphere = geometry.boundingSphere;
  geometry.dispose();
  return flat;
}
/** How long a packed body bake stays inflated after its last copy (ms): one entry's spawn bursts share one inflate. At
 *  2 s a cold Nalati crossing's boss spawn (2.4 s after the herd's) inflated the 8.7 MB bake again in script (fflate,
 *  ~100 ms of one play frame at phone 4× CPU); the held bytes are the burst's own, so the peak does not rise. */
const DECODED_HOLD_MS = 10000;
/** A packed body catalogue: load its compressed source once, then lend fresh owned parts per spawn. */
export interface PackedCreatureBodies {
  preload: () => Promise<void>;
  copy: (kind: string, variant: string) => AnimalSpecies;
  /** Bind inert look rows; a missing body family or numeric pose refuses admission. */
  looks: (input: unknown) => { all: readonly SpeciesLook[]; get: (kind: string) => SpeciesLook };
}

/** zlib bytes inflated by the platform's stream decoder (off the script's own work), or in script where it has none. */
async function inflateStream(bytes: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') return unzlibSync(bytes);
  const inflating = new Blob([bytes.slice()]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(inflating).arrayBuffer());
}

/**
 * Admit offset-addressed typed geometry blocks, bones and dimensions without changing their packed representation.
 * The compressed bytes are retained once; each copy inflates and copies its parts, never sharing mutable geometry.
 * Missing keys, early copies, unsafe paths, truncated blocks and incompatible metadata refuse before handing out a body.
 */
export function packedCreatureBodies(input: unknown, decode: (bytes: Uint8Array) => Uint8Array = unzlibSync,
  read?: (name: string) => Promise<Uint8Array>): PackedCreatureBodies {
  const PackedBodyNumber = wholeV.pipe(wholeV.number(), wholeV.finite());
  const PackedBodyWhole = wholeV.pipe(PackedBodyNumber, wholeV.integer(), wholeV.minValue(0), wholeV.maxValue(268435456));
  const PackedBodyPart = wholeV.strictObject({ indexEncoding: wholeV.optional(wholeV.picklist(['delta', 'raw'])),
    groups: wholeV.optional(wholeV.pipe(wholeV.array(wholeV.tuple([PackedBodyWhole, PackedBodyWhole, PackedBodyWhole])), wholeV.maxLength(1024))),
    offsets: wholeV.pipe(wholeV.array(PackedBodyWhole), wholeV.maxLength(33)), row: wholeV.strictObject({
    attrs: wholeV.pipe(wholeV.array(wholeV.tuple([wholeV.string(), wholeV.picklist(['f32', 'f16', 'u16', 'i8', 'u8']), wholeV.pipe(PackedBodyWhole, wholeV.minValue(1), wholeV.maxValue(16)), wholeV.boolean()])), wholeV.maxLength(32)),
  count: PackedBodyWhole, index: wholeV.nullable(wholeV.picklist(['u16', 'u32'])), indexCount: PackedBodyWhole, box: wholeV.boolean() }) });
  const PackedBodyParts = wholeV.union([wholeV.null(), PackedBodyPart, wholeV.pipe(wholeV.array(PackedBodyPart), wholeV.maxLength(64))]);
  const PackedBody = wholeV.strictObject({ kind: wholeV.string(), variant: wholeV.string(),
    bones: wholeV.pipe(wholeV.array(wholeV.strictObject({ name: wholeV.string(), parent: wholeV.nullable(wholeV.string()), pos: wholeV.tuple([PackedBodyNumber, PackedBodyNumber, PackedBodyNumber]) })), wholeV.maxLength(512)),
    dims: wholeV.strictObject({ bodyY: PackedBodyNumber, bodyHalfLen: PackedBodyNumber, bodyRadius: PackedBodyNumber, headRadius: PackedBodyNumber, legLen: PackedBodyNumber,
      feet: wholeV.pipe(wholeV.array(wholeV.tuple([PackedBodyNumber, PackedBodyNumber])), wholeV.maxLength(512)), halfWidth: PackedBodyNumber, capsuleAxis: wholeV.optional(wholeV.picklist(['y', 'z'])) }),
    fur: PackedBodyParts, hard: PackedBodyParts, eye: PackedBodyParts });
  const publicBodyFile = wholeV.pipe(wholeV.string(), wholeV.regex(/^\/assets\/[a-zA-Z0-9/_-]+-[0-9a-f]{64}\.bin$/u));
  const namedBodyFile = wholeV.pipe(wholeV.string(), wholeV.maxLength(256),
    wholeV.regex(/^(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-][a-zA-Z0-9_.-]*\.bin$/u));
  const bake = wholeV.parse(wholeV.strictObject({ file: wholeV.union([publicBodyFile, namedBodyFile]),
    bytes: PackedBodyWhole, bodies: wholeV.pipe(wholeV.array(PackedBody), wholeV.maxLength(1024)) }), input);
  const load = bake.file.startsWith('/') ? fetchBuildFile : read;
  if (load === undefined) throw new Error('Named packed creature body requires its product reader');
  const keys = new Set<string>();
  for (const body of bake.bodies) {
    const key = JSON.stringify([body.kind, body.variant]);
    if (keys.has(key)) throw new Error('Duplicate packed creature body');
    keys.add(key);
    for (const part of [body.fur, body.hard, body.eye].flatMap(parts => parts === null ? [] : Array.isArray(parts) ? parts : [parts])) {
      const row = part.row;
      if (row.attrs[0]?.[0] !== 'position' || new Set(row.attrs.map(attr => attr[0])).size !== row.attrs.length
        || part.offsets.length !== row.attrs.length + (row.index === null ? 0 : 1) || (row.index === null && row.indexCount !== 0)) throw new Error('Invalid packed creature part');
      const sizes = row.attrs.map(([, type, width]) => row.count * width * BAKED_BYTES[type]);
      if (row.index !== null) sizes.push(row.indexCount * (part.indexEncoding === 'raw' && row.index === 'u16' ? 2 : 4));
      if (part.offsets.some((offset, i) => offset % 4 !== 0 || offset + (sizes[i] ?? bake.bytes + 1) > bake.bytes)) throw new Error('Packed creature block exceeds its bake');
    }
  }
  let compressed: Uint8Array | null = null, loading: Promise<void> | null = null, decoded: Uint8Array | null = null, hold: ReturnType<ResourceScope['timeout']> = 0;
  // The bake inflates once per spawn burst, not once per copy (Nalati's is 8.7 MB for 27 bodies: a herd inflated it per
  // animal, ~70 ms each on the Simulator). Copies slice their own arrays out, so the inflated bytes go a moment after the last.
  const inflated = (packed: Uint8Array): Uint8Array => {
    decoded ??= decode(packed);
    const scope = resourceScope(); scope.cancelTimer(hold); hold = scope.timeout(DECODED_HOLD_MS, () => { decoded = null; });
    return decoded;
  };
  const catalogue: PackedCreatureBodies = {
    // G639: the bake is inflated as it loads, by the platform's stream decoder where it can (a Nalati entry spent ~0.13 s of
    // one frame inflating 8.7 MB in script at its first spawn); it is held until the first burst's copies are done
    preload: () => {
      loading ??= load(bake.file).then(async bytes => { compressed = bytes; if (decode === unzlibSync) decoded ??= await inflateStream(bytes); return undefined; });
      return loading;
    },
    looks: lookInput => {
      const book = parsePackedCreatureLooks(lookInput);
      if (new Set(book.rows.map(row => row.id)).size !== book.rows.length || new Set(book.rows.map(row => row.kind)).size !== book.rows.length) throw new Error('Duplicate packed creature look');
      const all = book.rows.map((row): SpeciesLook => {
        const family = row.family ?? row.kind;
        const bodyKey = (source: NonNullable<typeof row.variants>[string]): string => typeof source === 'string' ? source : source.body;
        if (!bake.bodies.some(body => body.kind === family) || Object.values(row.variants ?? {}).some(variant => !keys.has(JSON.stringify([family, bodyKey(variant)])))) throw new Error('Missing packed creature look body');
        const poseRows = row.pose === undefined ? undefined : book.poses[row.pose];
        if (row.pose !== undefined && poseRows === undefined) throw new Error('Missing packed creature joint pose');
        const pose = row.pose === undefined ? undefined : numericCreaturePoseFromBook(book, row.pose);
        const look: SpeciesLook = { id: row.id, species: row.species, kind: row.kind, fur: NO_FUR,
          rigContract: { skeleton: row.skeleton, sockets: row.sockets, clips: row.clips },
          build: variant => {
            const source = row.variants?.[variant.id], key = row.variants === undefined ? variant.id : source === undefined ? undefined : bodyKey(source);
            if (key === undefined) throw new Error('Unknown packed creature look variant');
            const body = catalogue.copy(family, key); return row.facetJitter === undefined ? body : { ...body, facetJitter: row.facetJitter };
          },
        };
        if (row.rig !== undefined) look.rig = row.rig;
        if (row.standMem !== undefined) look.standMem = row.standMem;
        if (row.eyeGlow !== undefined) look.eyeGlow = row.eyeGlow;
        if (row.eyeGlowIntensity !== undefined) look.eyeGlowIntensity = row.eyeGlowIntensity;
        if (row.hitArc !== undefined) {
          // the blow travels against the heading when it lands from the front
          const front = Math.cos(row.hitArc.arc * Math.PI / 180), scale = row.hitArc.scale;
          look.damageMul = (a, _hit, dir) => Math.sin(a.yaw) * dir.x + Math.cos(a.yaw) * dir.z < -front ? scale : 1;
        }
        if (pose !== undefined || row.lift !== undefined) look.animate = context => {
            if (row.lift !== undefined) stepCreatureLift(context.animal, context.dt, ...row.lift);
            pose?.(context);
        };
        return look;
      });
      return { all, get: kind => { const look = all.find(row => row.kind === kind); if (look === undefined) throw new Error('Unknown packed creature look'); return look; } };
    },
    copy: (kind, variant) => {
      const body = bake.bodies.find(row => row.kind === kind && row.variant === variant);
      if (body === undefined) throw new Error(`no baked creature body ${kind}.${variant}`);
      if (compressed === null) throw new Error(`Packed creature bodies are not loaded (${kind}.${variant})`);
      const bytes = inflated(compressed);
      if (bytes.length !== bake.bytes) throw new Error('Packed creature bake does not match its rows');
      const part = (sources: wholeV.InferOutput<typeof PackedBodyParts>): BufferGeometry[] => (sources === null ? [] : Array.isArray(sources) ? sources : [sources]).map(source => {
        const at = (i: number): number => { const offset = source.offsets[i]; if (offset === undefined) throw new Error('Packed creature block is missing'); return offset; };
        const one = { ...source.row, index: null, indexCount: 0 }, [first, ...rest] = source.row.attrs;
        if (first === undefined) throw new Error('Packed creature part has no attributes');
        const g = readBakedGeometry(bytes, at(0), { ...one, attrs: [first] });
        // each further attribute is its own block: read straight into its attribute (a geometry and a bounds pass per block
        // were half of a Nalati entry's creature body copies at phone 4x, T10)
        rest.forEach((attr, i) => { g.setAttribute(attr[0], readBakedAttribute(bytes, at(i + 1), one.count, attr)); });
        if (source.row.index !== null) {
          const start = at(source.row.attrs.length), size = source.row.index === 'u16' ? 2 : 4;
          if (source.indexEncoding === 'raw') {
            const buffer = bytes.slice(start, start + source.row.indexCount * size).buffer;
            g.setIndex(new BufferAttribute(source.row.index === 'u16' ? new Uint16Array(buffer) : new Uint32Array(buffer), 1));
          } else g.setIndex(readBakedGeometry(bytes, start, { ...source.row, attrs: [] }).index);
        }
        for (const [start, count, material] of source.groups ?? []) g.addGroup(start, count, material);
        return g;
      });
      const { capsuleAxis, ...dims } = body.dims;
      return { bones: body.bones.map(bone => ({ name: bone.name, parent: bone.parent, pos: [bone.pos[0], bone.pos[1], bone.pos[2]] })),
        furParts: part(body.fur), hardParts: part(body.hard), eyeParts: part(body.eye),
        dims: { ...dims, feet: dims.feet.map((foot): [number, number] => [foot[0], foot[1]]), ...(capsuleAxis === undefined ? {} : { capsuleAxis }) } };
    },
  };
  return catalogue;
}

/** `a` (a baked builder's geometry) with `b` (what the page added to that builder since) after it */
export const appendGeometry: typeof codecAppendGeometry = codecAppendGeometry;

/**
 * Primitives as rows (SHARD-PLATFORM M3): a three.js primitive, the transforms applied to it in order (translate,
 * rotate about an axis, scale: the geometry's own methods, so every vertex is the one hand-written code computed), and
 * whether it is made non-indexed; a list of them merged in order into one geometry that keeps every part's attributes
 * (position, normal, uv). A lantern's iron frame, a ribcage's hoops or a skull plate is data; `standardMaterial` makes a
 * MeshStandardMaterial from a row (hex or working-space colours). Unlike `primitiveParts` (one colour per part, normals
 * recomputed) the parts keep their own normals and uvs.
 *
 *   const frame = mergePrimitives(rows);           // every row non-indexed, merged
 *   const glass = buildPrimitive(row);             // one part as it stands
 */

/** A primitive's kind; `args` are its three.js constructor's, in order (a cylinder's sixth, open-ended, is 1 for true); an
 *  `extrude` is its row's `shape` extruded by its `extrude` options. */
export type PrimitiveKind = 'box' | 'cylinder' | 'cone' | 'sphere' | 'torus' | 'icosahedron' | 'capsule' | 'extrude';

/** One transform, applied by the geometry's own method (`rotateX` … angles in radians). */
export type PrimitiveOp = readonly ['translate' | 'scale', number, number, number] | readonly ['rotateX' | 'rotateY' | 'rotateZ', number];

/** One step of a 2D outline (three's Shape path methods, in order). */
export type ShapeStep = readonly ['moveTo' | 'lineTo', number, number] | readonly ['quadraticCurveTo', number, number, number, number];
/** An outline's extrusion (three's ExtrudeGeometry options). */
export interface ExtrudeRow {
  readonly depth: number; readonly bevelEnabled: boolean; readonly bevelThickness: number; readonly bevelSize: number;
  readonly bevelSegments: number; readonly curveSegments: number;
}
/** One primitive as data. */
export interface PrimitiveRow {
  readonly kind: PrimitiveKind;
  readonly args: readonly number[];
  /** an `extrude`'s outline and options */
  readonly shape?: readonly ShapeStep[];
  readonly extrude?: ExtrudeRow;
  /** applied in order */
  readonly ops?: readonly PrimitiveOp[];
}
/** A primitive painted one colour (a CSS colour string) into a `color` vertex attribute. */
export interface PaintedPrimitiveRow extends PrimitiveRow {
  readonly paint: string;
}

/** A MeshStandardMaterial as data: colours a hex number or working-space (r, g, b). */
export interface StandardMaterialRow {
  readonly color: number | readonly [number, number, number];
  readonly emissive?: number | readonly [number, number, number];
  readonly emissiveIntensity?: number;
  readonly roughness: number;
  readonly metalness: number;
  readonly fog?: boolean;
}

const arg = (a: readonly number[], i: number): number | undefined => a[i];

function primitive(p: PrimitiveRow): BufferGeometry {
  const a = p.args;
  switch (p.kind) {
    case 'box': return new BoxGeometry(arg(a, 0), arg(a, 1), arg(a, 2));
    case 'cylinder': return new CylinderGeometry(arg(a, 0), arg(a, 1), arg(a, 2), arg(a, 3), arg(a, 4), arg(a, 5) === 1);
    case 'cone': return new ConeGeometry(arg(a, 0), arg(a, 1), arg(a, 2));
    case 'sphere': return new SphereGeometry(arg(a, 0), arg(a, 1), arg(a, 2));
    case 'torus': return new TorusGeometry(arg(a, 0), arg(a, 1), arg(a, 2), arg(a, 3), arg(a, 4));
    case 'icosahedron': return new IcosahedronGeometry(arg(a, 0), arg(a, 1));
    case 'capsule': return new CapsuleGeometry(arg(a, 0), arg(a, 1), arg(a, 2), arg(a, 3));
    case 'extrude': return extruded(p);
    default: {
      const unknown: never = p.kind;
      throw new Error(`unknown primitive ${String(unknown)}`);
    }
  }
}

/** an `extrude` row's outline, extruded */
function extruded(p: PrimitiveRow): BufferGeometry {
  if (p.shape === undefined || p.extrude === undefined) throw new Error('an extrude primitive needs a shape and its options');
  const s = new Shape();
  for (const step of p.shape) {
    if (step[0] === 'quadraticCurveTo') s.quadraticCurveTo(step[1], step[2], step[3], step[4]);
    else if (step[0] === 'moveTo') s.moveTo(step[1], step[2]);
    else s.lineTo(step[1], step[2]);
  }
  const e = p.extrude;
  return new ExtrudeGeometry(s, { depth: e.depth, bevelEnabled: e.bevelEnabled, bevelThickness: e.bevelThickness, bevelSize: e.bevelSize, bevelSegments: e.bevelSegments, curveSegments: e.curveSegments });
}
/** One primitive with its transforms applied in order (indexed as three.js builds it). */
export function buildPrimitive(row: PrimitiveRow): BufferGeometry {
  const g = primitive(row);
  for (const op of row.ops ?? []) {
    if (op[0] === 'translate') g.translate(op[1], op[2], op[3]);
    else if (op[0] === 'scale') g.scale(op[1], op[2], op[3]);
    else if (op[0] === 'rotateX') g.rotateX(op[1]);
    else if (op[0] === 'rotateY') g.rotateY(op[1]);
    else g.rotateZ(op[1]);
  }
  return g;
}

const merged = (parts: BufferGeometry[]): BufferGeometry => mergeGeometries(parts, false);
/** The rows built (`buildPrimitive`), each made non-indexed, merged in order into one geometry (no groups). */
export function mergePrimitives(rows: readonly PrimitiveRow[]): BufferGeometry {
  return merged(rows.map((r) => buildPrimitive(r).toNonIndexed()));
}
/**
 * The rows built (`buildPrimitive`), each non-indexed (an indexed one copied so), painted its colour into a `color`
 * attribute and stripped to position, normal, uv and color, merged in order into one geometry (no groups): a
 * vertex-coloured stand-in in one draw.
 */
export function paintedPrimitives(rows: readonly PaintedPrimitiveRow[]): BufferGeometry {
  return merged(rows.map((r) => {
    const g = buildPrimitive(r), out = g.index ? g.toNonIndexed() : g;
    const c = new Color(r.paint), n = out.getAttribute('position').count, col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
    out.setAttribute('color', new BufferAttribute(col, 3));
    for (const k of Object.keys(out.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv' && k !== 'color') out.deleteAttribute(k);
    return out;
  }));
}

const colour = (c: number | readonly [number, number, number]): Color => (typeof c === 'number' ? new Color(c) : new Color(c[0], c[1], c[2]));

/** A MeshStandardMaterial from its row (fog left at three's default unless the row says). */
export function standardMaterial(row: StandardMaterialRow): MeshStandardMaterial {
  const p: MeshStandardMaterialParameters = { color: colour(row.color), roughness: row.roughness, metalness: row.metalness };
  if (row.emissive !== undefined) p.emissive = colour(row.emissive);
  if (row.emissiveIntensity !== undefined) p.emissiveIntensity = row.emissiveIntensity;
  if (row.fog !== undefined) p.fog = row.fog;
  return new MeshStandardMaterial(p);
}

/** Split a geometry by triangle centroid into `parts` (de-indexed, every attribute kept; flat normals recomputed when `flat`); disposes the input. */
function partition(source: BufferGeometry, parts: number, of: (x: number, y: number, z: number) => number, flat: boolean): BufferGeometry[] {
  const p = source.getAttribute('position'), index = source.index, triangles = Math.floor((index?.count ?? p.count) / 3);
  const side = new Uint8Array(triangles), counts = new Uint32Array(parts);
  const vertex = (i: number): number => index === null ? i : index.getX(i);
  // Match toNonIndexed's base-attribute interpretation, including normalized and half storage.
  const attributes = Object.entries(source.attributes).map(([name, attribute]) => {
    const interleaved = 'isInterleavedBufferAttribute' in attribute;
    const reader = index === null ? attribute : new BufferAttribute(interleaved ? attribute.data.array : attribute.array,
      interleaved ? attribute.data.stride : attribute.itemSize, attribute.normalized);
    return { name, attribute, reader, offset: index !== null && interleaved ? attribute.offset : 0 };
  });
  const position = attributes.find(attribute => attribute.name === 'position');
  if (position === undefined) throw new Error('Missing pivot positions');
  const coordinate = (at: number, component: number): number => position.reader.getComponent(at, position.offset + component);
  for (let t = 0; t < triangles; t++) {
    const a = vertex(t * 3), b = vertex(t * 3 + 1), c = vertex(t * 3 + 2);
    const part = of((coordinate(a, 0) + coordinate(b, 0) + coordinate(c, 0)) / 3, (coordinate(a, 1) + coordinate(b, 1) + coordinate(c, 1)) / 3, (coordinate(a, 2) + coordinate(b, 2) + coordinate(c, 2)) / 3);
    side[t] = part; counts[part] = (counts[part] ?? 0) + 3;
  }
  const offsets = new Uint32Array(parts);
  const out = Array.from({ length: parts }, (_, part) => {
    const geometry = new BufferGeometry();
    for (const { name, attribute } of attributes) geometry.setAttribute(name, new Float32BufferAttribute((counts[part] ?? 0) * attribute.itemSize, attribute.itemSize));
    return geometry;
  });
  // Read indexed source components once, directly into each exactly sized part.
  const targets = out.map(geometry => attributes.map(({ name }) => geometry.getAttribute(name)));
  for (let t = 0; t < triangles; t++) {
    const part = side[t], target = part === undefined ? undefined : targets[part];
    if (part === undefined || target === undefined) throw new Error('Missing pivot partition');
    const offset = offsets[part] ?? 0;
    for (let local = 0; local < 3; local++) {
      const at = vertex(t * 3 + local);
      for (let i = 0; i < attributes.length; i++) {
        const entry = attributes[i], destination = target[i];
        if (entry === undefined || destination === undefined) throw new Error('Missing pivot attribute');
        for (let c = 0; c < entry.attribute.itemSize; c++) destination.array[(offset + local) * entry.attribute.itemSize + c] = entry.reader.getComponent(at, entry.offset + c);
      }
    }
    offsets[part] = offset + 3;
  }
  for (const geometry of out) {
    if (flat) geometry.computeVertexNormals();
    geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  }
  source.dispose(); return out;
}

/** A baked pivot figure's body/head/upper-arm/forearm geometries, each already in its own pivot's local frame. */
export interface PivotNpcGeometry { readonly body: BufferGeometry; readonly head: BufferGeometry; readonly arm: BufferGeometry; readonly fore: BufferGeometry }

/** A pivot NPC's figure on its pivots: the body under `root`, the head at the neck, the arm at the shoulder and its forearm at the elbow. */
export interface PivotNpcParts { readonly root: Group; readonly head: Group; readonly arm: Group; readonly elbow: Group }
/**
 * A pivot NPC's figure (SF27): the row's model (`source`) fitted to its height and cut onto pivots by its figure row
 * (`NpcRowSchema`): the body, the head at the neck, the arm at the shoulder and its forearm at the elbow, in `material`
 * (else one vertex-coloured standard material). Feet on y 0, facing +Z, at its own origin (the Model Explorer shows it so).
 */
export function pivotNpcParts(row: NpcRow, source: BufferGeometry | PivotNpcGeometry, material?: Material): PivotNpcParts {
  const fig = row.figure, neck = fig.neck, [sx, sy, sz] = fig.shoulder, top = fig.armTopY ?? (neck === undefined ? Infinity : neck[1] + 0.02);
  const slope = fig.armSlope ?? 0, cut = fig.elbow, [ex, ey, ez] = cut?.at ?? fig.shoulder;
  const prepared = !(source instanceof BufferGeometry);
  let parts: readonly BufferGeometry[];
  if (source instanceof BufferGeometry) {
    const whole = fitGeometry(source, { size: fig.height, by: 'height', ...(fig.centre === undefined ? {} : { centre: fig.centre }) });
    parts = partition(whole, 4, (x, y) => neck !== undefined && y >= neck[1] ? 1
      : x < fig.armBelowX + slope * y && y > fig.armAboveY && y < top ? (cut !== undefined && (x - ex) * cut.axis[0] + (y - ey) * cut.axis[1] > 0 ? 3 : 2) : 0, fig.flat);
  } else parts = [source.body, source.head, source.arm, source.fore];
  const [body, head, arm, fore] = parts;
  const paint = material ?? new MeshStandardMaterial({ vertexColors: true, roughness: fig.roughness, metalness: 0, flatShading: fig.flat });
  const root = new Group(), headPivot = new Group(), armPivot = new Group(), elbow = new Group();
  if (neck !== undefined) { headPivot.position.set(neck[0], neck[1], neck[2]); if (!prepared) head?.translate(-neck[0], -neck[1], -neck[2]); }
  armPivot.position.set(sx, sy, sz); elbow.position.set(ex - sx, ey - sy, ez - sz);
  for (const [g, pivot] of [[body, root], [head, headPivot], [prepared ? arm : arm?.translate(-sx, -sy, -sz), armPivot], [prepared ? fore : fore?.translate(-ex, -ey, -ez), elbow]] as const) {
    if (g === undefined) continue;
    if (g.getAttribute('position').count > 0) pivot.add(new Mesh(g, paint)); else g.dispose();
  }
  armPivot.add(elbow); root.add(headPivot, armPivot);
  return { root, head: headPivot, arm: armPivot, elbow };
}

/** The SF27 quest-giver's motion: it faces you, waves overhead until met, gestures at the chest as it talks and breathes. */
export const PIVOT_NPC_MOTION: NpcMotion = { turns: true, waveUntilMet: true, ease: 8, breathe: { yaw: [0, 0], scale: [0.008, 1.3] },
  rest: { lift: [0, 0, 0], forward: [0, 0, 0], bend: [0, 0, 0] },
  wave: { lift: [-2.5, 0.3, 7], forward: [0, 0, 0], bend: [0, 0, 0] },
  talk: { lift: [-0.9, 0.2, 2.3], forward: [-0.5, -0.3, 1.7, 'half'], bend: [0, 0, 0] } };
/** A pivot NPC in the world: its group, its head (the talk prompt's anchor), its speaker and its per-frame motion. */
export interface PivotNpc { readonly group: Group; readonly head: Vector3; readonly speaker: { talking: boolean }; update: (dt: number, t: number, player: Vector3, met: boolean) => void }

const wrapAngle = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));
const swingAt = (s: NpcMotion['rest']['lift'], t: number): number => s[0] + s[1] * (s.length === 4 ? Math.max(0, Math.sin(t * s[2])) : Math.sin(t * s[2]));
/**
 * The row's NPC standing on the ground, moving by its motion row (`NpcMotionSchema`, else `PIVOT_NPC_MOTION`): it turns
 * to face the player within `faceRange` or while it talks (else back to `faceHome`), its head follows within ±0.7 rad,
 * its arm takes the talk pose while it talks, the wave pose within `waveRange` (until met, when the row says so), else
 * the rest pose, and it breathes. No source (its model did not load): no figure, the talk anchor and speaker still stand.
 */
export function pivotNpc(row: NpcRow, source: BufferGeometry | PivotNpcGeometry | null, groundAt: (x: number, z: number) => number, material?: Material): PivotNpc {
  const { x: ax, z: az } = row.at, y = groundAt(ax, az), m = row.motion ?? PIVOT_NPC_MOTION, group = new Group(), speaker = { talking: false };
  const head = new Vector3(ax, y + row.talkHeight, az), home = Math.atan2(row.faceHome.x - ax, row.faceHome.z - az);
  group.position.set(ax, y, az); group.rotation.y = home;
  if (source === null) return { group, head, speaker, update: () => undefined };
  const parts = pivotNpcParts(row, source, material); group.add(parts.root);
  let facing = home;
  return { group, head, speaker, update: (dt, t, player, met) => {
    const dx = player.x - ax, dz = player.z - az, d = Math.hypot(dx, dz), toYou = Math.atan2(dx, dz), k = 1 - Math.exp(-3 * dt);
    if (m.turns) facing += wrapAngle((d < row.faceRange || speaker.talking ? toYou : home) - facing) * k;
    group.rotation.y = facing + m.breathe.yaw[0] * Math.sin(t * m.breathe.yaw[1]);
    parts.head.rotation.y += (Math.max(-0.7, Math.min(0.7, wrapAngle(toYou - group.rotation.y))) * (d < row.faceRange ? 1 : 0) - parts.head.rotation.y) * k;
    parts.head.rotation.x = speaker.talking ? Math.sin(t * 5.2) * 0.05 : Math.sin(t * 0.7) * 0.02;
    const pose = speaker.talking ? m.talk : d < row.waveRange && !(m.waveUntilMet && met) ? m.wave : m.rest, e = Math.min(1, dt * m.ease);
    parts.arm.rotation.z += (swingAt(pose.lift, t) - parts.arm.rotation.z) * e; parts.arm.rotation.x += (swingAt(pose.forward, t) - parts.arm.rotation.x) * e;
    parts.elbow.rotation.z += (swingAt(pose.bend, t) - parts.elbow.rotation.z) * e;
    parts.root.scale.y = 1 + m.breathe.scale[0] * Math.sin(t * m.breathe.scale[1]);
  } };
}

/** What `installPivotNpc` is lent: the model (null: not loaded), its material, the ground, the player, its met flag's reader, the piece's source file and the shard's dressing of the figure. */
export interface PivotNpcPorts {
  readonly source: BufferGeometry | PivotNpcGeometry | null;
  /** the figure's material (a textured model's own); else one vertex-coloured standard material */
  readonly material?: Material;
  readonly groundAt: (x: number, z: number) => number;
  readonly player: Vector3;
  readonly met: () => boolean;
  /** the authored file the piece names (the Model Explorer and the physics bake list it) */
  readonly file: string;
  /** the shard's look on the figure (its light rim, resource ownership) */
  readonly dress?: (group: Group) => void;
}
type NpcSurface = NonNullable<NpcRow['collider']>['surface'];
/** The level a pivot NPC is installed in (a LevelContext fits): its root, its piece registry and its systems. */
export interface PivotNpcLevel {
  readonly root: Group;
  piece: (piece: { id: string; name: string; category: 'props'; file: string; object: Group; surface: NpcSurface;
    colliders: { kind: 'box'; x: number; y: number; z: number; hx: number; hy: number; hz: number; yaw: number; surface: NpcSurface }[] }) => void;
  system: (spec: { id: string; phase: 'update'; run: (dt: number, t: number) => void }) => void;
}
/**
 * Installs the row's NPC in a level: the figure under the level root, a solid column piece round it when the row has a
 * collider (it turns in place, so the box stays square), and its motion each frame.
 */
export function installPivotNpc(ctx: PivotNpcLevel, row: NpcRow, ports: PivotNpcPorts): PivotNpc {
  const npc = pivotNpc(row, ports.source, ports.groundAt, ports.material), c = row.collider, y = npc.group.position.y;
  ctx.root.add(npc.group); ports.dress?.(npc.group);
  if (c !== undefined) ctx.piece({ id: row.id, name: row.name, category: 'props', file: ports.file, object: npc.group,
    colliders: [{ kind: 'box', x: row.at.x, y: y + (c.above - c.below) / 2, z: row.at.z, hx: c.half, hy: Math.max(0.005, (c.above + c.below) / 2), hz: c.half, yaw: -0, surface: c.surface }], surface: c.surface });
  if (ports.source !== null) ctx.system({ id: row.id, phase: 'update', run: (dt, t) => { npc.update(dt, t, ports.player, ports.met()); } });
  return npc;
}

const WHOLE_TIMING_PHASES = ['read-wait', 'decode', 'assemble', 'yield', 'release', 'finalize'] as const;
const wholeArrayTag = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), Symbol.toStringTag);
function wholeUnsignedIndex(index: unknown): boolean {
  if (index === null) return true;
  if (!ArrayBuffer.isView(index)) return false;
  const tag: unknown = wholeArrayTag?.get?.call(index);
  return tag === 'Uint16Array' || tag === 'Uint32Array';
}
function isWholeMesh(node: Object3D): node is Mesh { return node instanceof Mesh; }
function wholeStorage(row: wholeV.InferOutput<typeof WholeAttribute>, count: number): BufferAttribute {
  const n = row.itemSize * count;
  if (row.storage === 'Float16Array') return new Float16BufferAttribute(new Uint16Array(n), row.itemSize, row.normalized);
  const array = row.storage === 'Float32Array' ? new Float32Array(n) : row.storage === 'Uint16Array' ? new Uint16Array(n)
    : row.storage === 'Uint32Array' ? new Uint32Array(n) : row.storage === 'Int16Array' ? new Int16Array(n)
    : row.storage === 'Int8Array' ? new Int8Array(n) : new Uint8Array(n);
  return new BufferAttribute(array, row.itemSize, row.normalized);
}
/** One original source draw reconstructed from exact subsets, at its original double-precision matrix. */
export interface WholeGeometryView {
  readonly geometry: BufferGeometry; readonly matrix: Matrix4;
  /** Forget decoded-source ownership after adopting or copying it into a scope-owned render object. */
  readonly release?: () => void;
}
/** A verified subset of one original draw. Ordinals identify its exact source
 * vertices and triangles; completeness belongs to the full-model reader. */
export interface WholeGeometryPiece extends WholeGeometryView {
  readonly part: string; readonly vertices: readonly number[]; readonly triangles: readonly number[];
  readonly vertexCount: number; readonly indexCount: number; readonly layout: string;
}
class WholeGeometryAssembler {
  private readonly groups = new Map<string, { output: BufferGeometry; matrix: Matrix4; seen: Uint8Array; triangles: Uint8Array; layout: string }>();
  add(node: Mesh, ownership: 'borrow' | 'take' = 'borrow'): void {
    const metadata: unknown = node.userData['wholePartition'], instances: unknown = node.userData['instances64'];
    const pose: unknown = node.userData['matrix64'] ?? (node instanceof InstancedMesh && node.count === 1 && Array.isArray(instances) && instances.length === 1 ? instances[0] : undefined);
    const row = readWholePartition(metadata);
    const values = wholeV.parse(wholeV.pipe(wholeV.array(wholeV.pipe(wholeV.number(), wholeV.finite())), wholeV.length(16)), pose);
    const { geometry: input, channels } = admitNativeWholeGeometry(node, ownership, true);
    try {
      const signature = JSON.stringify(channels);
      if (row.grid !== undefined) {
        const position = input.getAttribute('position');
        const source = position instanceof InterleavedBufferAttribute ? position.data.array : position.array;
        if (!(source instanceof Int16Array) || position.normalized || position.itemSize !== 3) throw new Error('Whole grid needs Int16 positions');
      }
      let group = this.groups.get(row.id);
      const denseVertexLength = row.denseVertices ? row.vertexLength : 0;
      const completeFreshVertices = group === undefined && row.denseVertices && denseVertexLength === row.vertexCount;
      if (group === undefined) {
        const output = new BufferGeometry();
        for (const [name, channel] of Object.entries(channels)) output.setAttribute(name, wholeStorage(row.grid !== undefined && name === 'position' ? { ...channel, storage: 'Float32Array', normalized: false } : channel, row.vertexCount));
        if (row.index !== 'none') output.setIndex(new BufferAttribute(row.index === 'u16' ? new Uint16Array(row.indexCount) : new Uint32Array(row.indexCount), 1));
        group = { output, matrix: new Matrix4().fromArray(values), seen: new Uint8Array(row.vertexCount), triangles: new Uint8Array((row.index === 'none' ? row.vertexCount : row.indexCount) / 3), layout: signature };
        this.groups.set(row.id, group);
      }
      if (signature !== group.layout || !group.matrix.equals(new Matrix4().fromArray(values)) || row.vertexCount !== group.seen.length || row.indexCount !== (group.output.index?.count ?? 0)) throw new Error('Whole source layout or transform differs');
      // The channels are resolved once per node and copied in plain index loops: the per-vertex entries / getAttribute /
      // subarray walk was one ~600 ms desktop (~1.5 s iOS Simulator) task for a Nine Dragon tile when a grid cell builds it
      // on the road (sp-o112). The bytes written, the shared-vertex check and every refusal are unchanged.
      const vertices = row.denseVertices ? undefined : row.vertices;
      const copies = (vertices?.length ?? denseVertexLength) === 0 ? [] : Object.entries(group.output.attributes).map(([name, destination]) => {
        const source = input.getAttribute(name);
        if (!(source instanceof BufferAttribute || source instanceof InterleavedBufferAttribute) || !(destination instanceof BufferAttribute)) throw new Error('Whole channel layout differs');
        return { from: source instanceof InterleavedBufferAttribute ? source.data.array : source.array, fromSize: source.itemSize,
          stride: source instanceof InterleavedBufferAttribute ? source.data.stride : source.itemSize, offset: source instanceof InterleavedBufferAttribute ? source.offset : 0,
          count: source.count, to: destination.array, toSize: destination.itemSize, grid: name === 'position' ? row.grid : undefined };
      });
      const seen = group.seen;
      // Which listed vertices an earlier node (or an earlier entry of this list) already wrote, then one channel at a
      // time: the per-vertex channel walk was ~0.4 s of a phone-4x Nine preparation. Writes and refusals are unchanged.
      const shared = new Uint8Array(completeFreshVertices ? 0 : (vertices?.length ?? denseVertexLength));
      if (completeFreshVertices) seen.fill(1);
      else for (let local = 0; local < (vertices?.length ?? denseVertexLength); local++) {
        const vertex = vertices === undefined ? local : vertices[local] ?? Number.NaN;
        if (!(vertex < seen.length)) throw new Error('Whole vertex ordinal outside source');
        shared[local] = seen[vertex] ?? 0; seen[vertex] = 1;
      }
      for (const { from, fromSize, stride, offset, count, to, toSize, grid } of copies) {
        if ((vertices?.length ?? denseVertexLength) > count) throw new Error('Whole channel layout differs');
        if (grid !== undefined) {
          // Restore directly into the final ordinal array. The original
          // temporary Float32 attribute rounded before shared-byte comparison;
          // keep that exact boundary without allocating/copying it first.
          const [originX, originY, originZ] = grid.origin, step = grid.step;
          if (completeFreshVertices) {
            for (let read = offset, write = 0; write < to.length; read += stride, write += 3) {
              to[write] = Math.fround((from[read] ?? 0) * step + originX);
              to[write + 1] = Math.fround((from[read + 1] ?? 0) * step + originY);
              to[write + 2] = Math.fround((from[read + 2] ?? 0) * step + originZ);
            }
            continue;
          }
          for (let local = 0; local < (vertices?.length ?? denseVertexLength); local++) {
            const read = offset + local * stride, write = (vertices === undefined ? local : vertices[local] ?? 0) * toSize;
            if (write + fromSize > to.length) throw new RangeError('Whole channel write outside source');
            const x = Math.fround((from[read] ?? 0) * step + originX);
            const y = Math.fround((from[read + 1] ?? 0) * step + originY);
            const z = Math.fround((from[read + 2] ?? 0) * step + originZ);
            if (shared[local] === 1 && (!Object.is(x, to[write]) || !Object.is(y, to[write + 1]) || !Object.is(z, to[write + 2]))) throw new Error('Whole shared vertex differs');
            to[write] = x; to[write + 1] = y; to[write + 2] = z;
          }
          continue;
        }
        // Ordinals arrive as start/length runs: a run of new vertices in the same element type is one block copy.
        const block = fromSize === toSize && stride === fromSize && offset === 0 && from.constructor === to.constructor;
        if (completeFreshVertices && fromSize === toSize) {
          if (block && (vertices?.length ?? denseVertexLength) * fromSize <= from.length) to.set(from.subarray(0, (vertices?.length ?? denseVertexLength) * fromSize));
          else for (let read = offset, write = 0; write < to.length; read += stride, write += toSize) {
            to[write] = from[read] ?? 0;
            if (fromSize > 1) to[write + 1] = from[read + 1] ?? 0;
            if (fromSize > 2) to[write + 2] = from[read + 2] ?? 0;
            if (fromSize > 3) to[write + 3] = from[read + 3] ?? 0;
          }
          continue;
        }
        for (let local = 0; local < (vertices?.length ?? denseVertexLength); local++) {
          const start = vertices === undefined ? local : vertices[local] ?? 0;
          if (block && shared[local] === 0) {
            let end = local + 1;
            while (end < (vertices?.length ?? denseVertexLength) && shared[end] === 0 && (vertices === undefined ? end : vertices[end]) === start + end - local) end++;
            if (end - local > 1 && end * fromSize <= from.length) {
              if ((start + end - local) * toSize > to.length) throw new RangeError('Whole channel write outside source');
              to.set(from.subarray(local * fromSize, end * fromSize), start * toSize);
              local = end - 1; continue;
            }
          }
          const read = offset + local * stride, write = start * toSize;
          if (write + fromSize > to.length) throw new RangeError('Whole channel write outside source');
          if (shared[local] === 1) for (let i = 0; i < fromSize; i++) if (!Object.is(from[read + i], to[write + i])) throw new Error('Whole shared vertex differs');
          if (fromSize >= 1 && fromSize <= 4 && Number.isInteger(fromSize)) {
            to[write] = from[read] ?? 0;
            if (fromSize > 1) to[write + 1] = from[read + 1] ?? 0;
            if (fromSize > 2) to[write + 2] = from[read + 2] ?? 0;
            if (fromSize > 3) to[write + 3] = from[read + 3] ?? 0;
          } else for (let i = 0; i < fromSize; i++) to[write + i] = from[read + i] ?? 0;
        }
      }
      const index = input.getIndex()?.array ?? null, output = group.output.index?.array ?? null, done = group.triangles;
      const triangles = row.denseTriangles ? undefined : row.triangles, triangleLength = row.denseTriangles ? row.triangleLength : 0;
      const integerIndex = wholeUnsignedIndex(index);
      for (let local = 0; local < (triangles?.length ?? triangleLength); local++) {
        const triangle = triangles === undefined ? local : triangles[local] ?? Number.NaN;
        if (!(triangle < done.length) || done[triangle] === 1) throw new Error('Whole duplicate or invalid triangle');
        for (let corner = 0; corner < 3; corner++) {
          const at = index === null ? local * 3 + corner : index[local * 3 + corner] ?? local * 3 + corner;
          let vertex: number | undefined;
          if (vertices !== undefined) vertex = vertices[at];
          else if (integerIndex ? at < denseVertexLength : Number.isInteger(at) && at >= 0 && at < denseVertexLength) vertex = at;
          if (vertex === undefined) throw new Error('Whole missing triangle vertex');
          if (output !== null) output[triangle * 3 + corner] = vertex;
          else if (vertex !== triangle * 3 + corner) throw new Error('Whole non-indexed topology differs');
        }
        done[triangle] = 1;
      }
    } finally { input.dispose(); }
  }
  *finishSteps(): Generator<void, Map<string, WholeGeometryView>> {
    const result = new Map<string, WholeGeometryView>();
    for (const [id, group] of this.groups) {
      for (const flags of [group.seen, group.triangles]) {
        for (let i = 0; i < flags.length; i++) {
          if (flags[i] === 0) throw new Error(`Whole source ${id} is incomplete`);
          if ((i & 32767) === 32767) yield;
        }
      }
      yield* geometryBoundsSteps(group.output, 'sphere');
      result.set(id, { geometry: group.output, matrix: group.matrix });
      yield;
    }
    return result;
  }
  finish(): Map<string, WholeGeometryView> {
    const steps = this.finishSteps();
    for (;;) { const step = steps.next(); if (step.done) return step.value; }
  }
  dispose(): void { for (const group of this.groups.values()) group.output.dispose(); }
}
/** Reconstruct source draws from parsed subsets; duplicate/missing triangles and conflicting shared bytes refuse. */
export function assembleWholeGeometryViews(nodes: readonly Mesh[], ownership: 'borrow' | 'take' = 'borrow'): Map<string, WholeGeometryView> {
  const assembler = new WholeGeometryAssembler();
  try { for (const node of nodes) assembler.add(node, ownership); return assembler.finish(); }
  catch (error) { assembler.dispose(); throw error; }
}
/**
 * Read verified tile/library GLBs and assemble original draws; temporary decodes are freed after each bounded file.
 * Completeness checks and exact bounds scan in bounded steps on the shared frame budget.
 * `pause` (optional) runs after each assembled mesh and finalization step; otherwise the engine's work slice yields.
 * A slug reads its admitted/declared product's L0 tiles and whole library by default; unknown slugs refuse.
 * Source-object callers default to L0 tiles only. Explicit refs are unchanged; L1 proxies cannot rebuild exact originals.
 */
export async function readWholeGeometry(scope: ResourceScope, source: Shardfile | string, refs?: readonly string[], pause?: () => Promise<void>): Promise<Map<string, WholeGeometryView>> {
  const { runtimeFolder, slugRuntimeFolder } = await import('../shardfile/runtimeFolder');
  const product = typeof source === 'string' ? slugRuntimeFolder(source) : runtimeFolder(source);
  if (product === null) throw new Error('Whole geometry needs an admitted or declared product');
  const timing = clientPreparationBatch(product.source.identity.slug, 'whole', WHOLE_TIMING_PHASES);
  const props = typeof source === 'string' ? product.source.props : source.props;
  const hashes = refs ?? wholeGeometryInputs(props, typeof source === 'string');
  const homeKey = `whole:${JSON.stringify([hashes, TIER])}`;
  const restored = await readHomeBuildGeometry(product.source, homeKey);
  if (restored !== null) {
    try {
      if (scope.disposed || scope.disposing) throw new Error('Whole geometry unloaded while restoring');
      await product.releaseTransport(hashes);
      if (scope.disposed || scope.disposing) throw new Error('Whole geometry unloaded while restoring');
      const result = new Map<string, WholeGeometryView>();
      for (const [id, view] of restored) result.set(id, { ...view, release: scope.capture('geometries', () => view.geometry.dispose()) });
      product.assets.releaseTiles(); return result;
    } catch (error) { for (const view of restored.values()) view.geometry.dispose(); throw error; }
    finally { timing?.finish(); }
  }
  const assembler = new WholeGeometryAssembler();
  const slice = workSlice(undefined, scope);
  const assertLive = (): void => { if (scope.disposed) throw new Error('Whole geometry unloaded while reading'); };
  const check = (): Promise<void> | undefined => {
    assertLive();
    let wait = pause;
    if (wait === undefined) {
      if (presenting() || typeof document !== 'undefined') {
        // Transport, parsing and drawn frames can outlive this local slice's
        // clock. A completion uses the current shared budget, not that wait.
        const checkpoint = constructionCheckpoint(scope);
        if (checkpoint !== undefined) wait = () => checkpoint;
      } else if (slice.due()) wait = slice.yield;
    }
    if (wait === undefined) { assertLive(); return undefined; }
    // Keep real pauses and their retirement race; cheap default completions
    // need neither a pending promise nor a microtask handoff.
    const suspend = async (): Promise<void> => {
      let release = (): void => undefined;
      const stopped = new Promise<void>(resolve => { release = scope.capture('disposers', resolve); });
      try { await Promise.race([wait(), stopped]); } finally { release(); }
      assertLive();
    };
    return suspend();
  };
  // Transport refills on completion, independently of ordered parsing and
  // assembly. A slow decoder no longer holds back later phase files.
  const reads = new PreparationReads(hashes, hash => product.assets.read(hash), () => !scope.disposed && !scope.disposing);
  try {
    for (const [index, hash] of hashes.entries()) {
      assertLive();
      const pending = reads.take(index);
      const bytes = timing === undefined ? await pending : await timing.run('read-wait', () => pending);
      const gltf = timing === undefined ? await (await prepareRigLoader()).createRigLoader().parseBytesAsync(bytes, '')
        : await timing.run('decode', async () => (await prepareRigLoader()).createRigLoader().parseBytesAsync(bytes, ''));
      const cleanup: (() => void)[] = [];
      try {
        const meshes: Mesh[] = [];
        gltf.scene.traverse(object => {
          if (!isWholeMesh(object)) return;
          const original: unknown = object.geometry;
          if (!(original instanceof BufferGeometry)) throw new Error('Whole shape needs geometry');
          cleanup.push(() => { original.dispose(); for (const material of Array.isArray(object.material) ? object.material : [object.material]) material.dispose(); });
          meshes.push(object);
        });
        for (const mesh of meshes) {
          // This reader owns the temporary GLB. Reuse its plain channels
          // until cleanup; the assembler still writes independent final arrays.
          if (timing === undefined) assembler.add(mesh, 'take');
          else timing.sync('assemble', () => { assembler.add(mesh, 'take'); });
          const checkpoint = timing === undefined ? check() : timing.checkpoint('yield', check);
          if (checkpoint !== undefined) await checkpoint;
        }
        if (scope.disposed) throw new Error('Whole geometry unloaded while reading');
      } finally { for (const dispose of cleanup) dispose(); }
      await (timing === undefined ? product.releaseTransport([hash]) : timing.run('release', () => product.releaseTransport([hash])));
    }
    const steps = assembler.finishSteps();
    let finished = timing === undefined ? steps.next() : timing.sync('finalize', () => steps.next());
    while (!finished.done) {
      const checkpoint = timing === undefined ? check() : timing.checkpoint('yield', check);
      if (checkpoint !== undefined) await checkpoint;
      finished = timing === undefined ? steps.next() : timing.sync('finalize', () => steps.next());
    }
    const result = finished.value;
    void saveHomeBuildGeometry(product.source, homeKey, result);
    for (const [id, view] of result) {
      const release = scope.capture('geometries', () => view.geometry.dispose());
      result.set(id, { ...view, release });
    }
    product.assets.releaseTiles(); return result;
  } catch (error) { assembler.dispose(); throw error; }
  finally { await reads.close(); timing?.finish(); }
}

/** Authored skinned assets and their ordered look declarations. */
export interface RigLibraryRows { readonly bodies: CreatureBodyRows<string>; readonly looks: readonly CreatureLookRow<string>[] }
const rigLibraries = new WeakMap<RigLibraryRows, { bodies: CreatureBodies<string>; looks: readonly SpeciesLook[] }>();
const declaredRigLibraries = new Map<string, { bodies: CreatureBodies<string>; looks: readonly SpeciesLook[] }>();
/** Resolve one loader per actual descriptor across model, page and Explorer consumers. */
export function rigLibrary(rows: RigLibraryRows): { bodies: CreatureBodies<string>; looks: readonly SpeciesLook[] } {
  // Named source JSON and native rows may deserialize the same descriptor twice.
  // Equal data must retain one actual body cache for live looks and specimens.
  const identity = isJsonData(rows) ? JSON.stringify(rows, (_key, jsonValue: unknown): unknown => jsonValue !== null && typeof jsonValue === 'object' && !Array.isArray(jsonValue)
    ? Object.fromEntries(Object.entries(jsonValue as Readonly<Record<string, unknown>>).sort(([a], [b]) => a.localeCompare(b))) : jsonValue) : undefined;
  const prior = rigLibraries.get(rows) ?? (identity === undefined ? undefined : declaredRigLibraries.get(identity));
  if (prior !== undefined) { rigLibraries.set(rows, prior); return prior; }
  if (rows.bodies.creatures.length > 1024 || new Set(rows.bodies.creatures).size !== rows.bodies.creatures.length
    || rows.looks.some(row => !rows.bodies.creatures.includes(row.body))) throw new Error('Rig library references an undeclared body');
  const bodies = creatureBodies(rows.bodies), catalogue = { bodies, looks: creatureLooks(bodies, rows.looks) };
  rigLibraries.set(rows, catalogue); if (identity !== undefined) declaredRigLibraries.set(identity, catalogue); return catalogue;
}
/** A model specimen is metadata and an existing library rig, with no private builder. */
export interface ModelSpecimenRow { readonly model: BakedModelMetadata; readonly body: string; readonly specimen: CreatureSpecimenRow }
/** Resolve the ordered native rig catalogue without private scene owners. */
export function modelCatalogue(rows: readonly ModelSpecimenRow[], library: Pick<ModelLibrary<string, string>, 'rig'>): ReturnType<typeof defineSceneModels> {
  return defineSceneModels(rows.map((row, index) => ({ model: row.model, builder: `body${String(index)}` })),
    rows.map((row, index) => [`body${String(index)}`, () => creatureSpecimen(library.rig(row.body), row.specimen)] as const));
}

/** One authored index range in a shared posed draw; instances still own all clocks. */
export interface PosedAssetRange { readonly kind: number; readonly start: number; readonly count: number; readonly box: readonly [number, number, number, number, number, number] }
export interface PosedAssetSet { readonly geometry: BufferGeometry; readonly ranges: readonly PosedAssetRange[]; readonly atlas: Texture | null }
/**
 * A posed draw's atlas as its own KTX2 file (a built product's named blob), sampled as the glTF atlas it replaces:
 * flipY false, repeat wrap, mipmapped linear, anisotropy 4, sRGB; fenced before the set publishes it.
 */
async function posedAtlas(url: string): Promise<Texture> {
  const atlas = await ktx2File(url);
  atlas.wrapS = RepeatWrapping; atlas.wrapT = RepeatWrapping; atlas.anisotropy = 4; atlas.colorSpace = SRGBColorSpace;
  atlas.name = 'posed-atlas'; atlas.needsUpdate = true;
  return prepareCompressedTexture(atlas);
}
/**
 * Read packed channels and original image bytes without vertex packing or attribute copies. The atlas is either
 * `atlasModel` (a GLB whose material carries it, through the tier / GPU path) or `atlas` (its own KTX2 file: a product's
 * named blob); at most one of the two (a vertex-coloured draw has none).
 */
export async function posedAssets(input: unknown): Promise<PosedAssetSet> {
  const poseNumber = wholeV.pipe(wholeV.number(), wholeV.finite());
  const integer = wholeV.pipe(poseNumber, wholeV.integer(), wholeV.minValue(0), wholeV.maxValue(2_000_000));
  const text = wholeV.pipe(wholeV.string(), wholeV.minLength(1), wholeV.maxLength(256));
  const rows = wholeV.parse(wholeV.strictObject({geometry: text, atlasModel: wholeV.optional(text), atlas: wholeV.optional(text), name: text,
    channels: wholeV.pipe(wholeV.array(wholeV.strictObject({name: text, source: text, width: wholeV.picklist([1, 2, 3, 4])})), wholeV.minLength(1), wholeV.maxLength(16)),
    ranges: wholeV.pipe(wholeV.array(wholeV.strictObject({kind: integer, start: integer, count: integer,
      box: wholeV.tuple([poseNumber, poseNumber, poseNumber, poseNumber, poseNumber, poseNumber])})), wholeV.minLength(1), wholeV.maxLength(32))}), input);
  if (rows.atlasModel !== undefined && rows.atlas !== undefined) throw new Error('A posed draw names at most one atlas source');
  if (new Set(rows.channels.map(row => row.name)).size !== rows.channels.length || new Set(rows.ranges.map(row => row.kind)).size !== rows.ranges.length) throw new Error('Repeated posed channel or kind');
  const source = await loadRigFile(rows.geometry), node = source.scene.getObjectByName(rows.name);
  if (!(node instanceof Mesh) || node.type !== 'Mesh' || !node.matrix.equals(new Matrix4())) throw new Error('Missing identity-space posed draw');
  const original: unknown = node.geometry;
  if (!(original instanceof BufferGeometry)) throw new Error('Invalid posed geometry');
  const geometry = new BufferGeometry(), position: unknown = original.getAttribute('position'), index = original.getIndex();
  if (!(position instanceof BufferAttribute) || position.count < 1 || position.count > 400_000 || index === null || index.array.some(word => word >= position.count)) throw new Error('Invalid posed draw size');
  for (const row of rows.channels) {
    const channel: unknown = original.getAttribute(row.source);
    if (!(channel instanceof BufferAttribute) || !(channel.array instanceof Float32Array) || channel.normalized || channel.itemSize !== row.width
      || channel.count !== position.count || channel.array.some(word => !Number.isFinite(word))) throw new Error(`Invalid posed channel ${row.name}`);
    geometry.setAttribute(row.name, channel);
  }
  geometry.setIndex(index);
  let end = 0;
  for (const range of rows.ranges) { if (range.start !== end || range.count === 0 || range.count % 3 !== 0) throw new Error('Invalid posed range'); end += range.count; }
  if (end !== index.count) throw new Error('Posed ranges do not cover the draw');
  if (rows.atlas !== undefined) return {geometry, ranges: rows.ranges, atlas: await posedAtlas(rows.atlas)};
  if (rows.atlasModel === undefined) return {geometry, ranges: rows.ranges, atlas: null};
  const atlasSource = await loadRigFile(rows.atlasModel), textures: Texture[] = [];
  atlasSource.scene.traverse(object => { if (isMesh(object) && !Array.isArray(object.material) && object.material instanceof MeshStandardMaterial && object.material.map !== null) textures.push(object.material.map); });
  const atlas = textures[0]; if (atlas === undefined) throw new Error('Missing posed asset atlas'); atlas.anisotropy = 4;
  return {geometry, ranges: rows.ranges, atlas};
}
