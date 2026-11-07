import { readPickupCatalogue } from './pickupRows';
import { prepareBinarySources,binarySourceBytes,type BinaryFileReader } from './binarySource';
import { decodeLaneBytes } from '@wildshard/engine/core/deflate';
import type { Scope } from '@wildshard/engine/app/scope';
import { SpecimenCatalogueSchema, SpecimenAssetSchema, PackedSpecimenSchema, SpecimenMaterialSchema, assertSpecimenJson as jsonData, type SpecimenLocationRows, type SpecimenAtlasRows } from '@wildshard/format/specimenCatalogue';
import { parseKtx2 } from '@wildshard/format/ktx2Cost';
import { parseKtx2Bytes } from '@wildshard/engine/core/ktx2';
import { gpuOnlyTexture } from '@wildshard/engine/core/gpuOnly';
import * as THREE from 'three';
import * as v from 'valibot';
import type { RigLoader } from '@wildshard/engine/anim/rigParser';
import { prepareRigLoader } from '@wildshard/engine/anim/rig';
import { forgetWhenDisposed } from '@wildshard/engine/app/cachedAssets';
import { loadTexture } from '@wildshard/engine/core/assets';
import { TIER, TIER_CONFIG } from '@wildshard/engine/core/tier';
import { defineModel, announceModelReady, type ModelContext, type ModelBuild, type ModelDef } from '@wildshard/engine/models/model';
import { loadingSpecimen } from '@wildshard/engine/models/gear';
import { createOwnedGeometry } from '@wildshard/engine/models/ownedGeometry';
import { lowPolyLookMaterial } from '@wildshard/engine/world/lowpolyKit';
import { painterlyMaterial, painterlyKnobs } from '@wildshard/engine/world/painterly';
import type { SkyRig } from '@wildshard/engine/world/skyRig';
import { expandBakedGeometry, bakedGeometryBytes, readBakedGeometry, fetchLaneBake, type BakedGeometryRow } from '../plugin/geometry';
import { pickup } from '@wildshard/engine/models/interact';
import { interactParts } from '@wildshard/engine/world/interact/kit';
import { registerPickupLook, type PickupPart } from '@wildshard/engine/world/interact/types';
import { installCoinModel } from '../loot/coinModel';

/** Prepare the shared pickup catalogue's raw files before registering any look or coin factory. */
export function preparePickupCatalogue(product:BinaryFileReader,input:unknown,scope?:Scope):Promise<ReadonlyMap<string,Uint8Array>> {
  const rows=readPickupCatalogue(input);
  return prepareBinarySources(product,rows.geometries.flatMap(row=>'file'in row?[{source:{file:row.file},bytes:bakedGeometryBytes(row.geometry)}]:[]),scope,rows.banks);
}
/** Each request owns fresh geometry; preparation retains only the original raw storage, never decoded templates. */
export function installPickupCatalogue(input: unknown,files:ReadonlyMap<string,Uint8Array>=new Map()): void {
  const rows=readPickupCatalogue(input);
  for(const row of rows.geometries)if('file'in row&&files.get(row.file)?.byteLength!==bakedGeometryBytes(row.geometry))throw new Error('Pickup source was not prepared');
  const geometry = (key: string, seed: number): THREE.BufferGeometry => {
    const row = rows.geometries.find(candidate => candidate.key === key && candidate.seed === seed);
    if (row === undefined) throw new Error(`No prepared pickup geometry: ${key}:${seed}`);
    const bytes = binarySourceBytes('data'in row?{data:row.data}:{file:row.file},files);
    if (bytes.length !== bakedGeometryBytes(row.geometry)) throw new Error(`Invalid prepared pickup bytes: ${key}:${seed}`);
    return readBakedGeometry(bytes, 0, row.geometry);
  };
  for (const row of rows.looks) {
    const model = pickup(row.model, row.name, row.lift, ctx => row.parts.map(part =>
      interactParts[part.batch](ctx, geometry(part.key, rows.seed))), rows.file);
    registerPickupLook(row.id, { model, batch: row.batch, lift: row.lift,
      parts: row.parts.map(part => {
        const bound: PickupPart = { key: part.key, batch: part.batch, geometry: seed => geometry(part.key, seed) };
        if (part.bob !== undefined) bound.bob = part.bob;
        if (part.pulse !== undefined) bound.pulse = part.pulse;
        return bound;
      }),
    });
  }
  installCoinModel(seed => geometry(rows.coin, seed));
}

/** Data-only material binding. Cache identities are shared with live world users. */
export interface SpecimenMaterialRow {
  readonly id: string;
  readonly family: 'lowpoly' | 'painterly';
  readonly variant?: string | undefined;
  readonly rim?: number | undefined;
  readonly bands?: number | undefined;
  readonly sway?: number | undefined;
  readonly color?: string | number | readonly [number, number, number] | undefined;
  readonly floor?: number | undefined;
  readonly transparent?: boolean | undefined; readonly depthWrite?: boolean | undefined; readonly side?: 'front' | 'double' | undefined;
  readonly polygonOffset?: readonly [number,number] | undefined; readonly textureFallback?:readonly [number,number,number,number] | undefined;
  readonly texture?: { readonly url: string; readonly phoneUrl: string; readonly name: string } | undefined;
}

const materials = new WeakMap<SkyRig, Map<string, THREE.Material>>();
const textures = new Map<string, Promise<THREE.Texture>>();
const atlasTextures = new WeakSet<THREE.Texture>();
const atlasMaterials = new WeakMap<THREE.Texture, WeakMap<SkyRig, Map<string, THREE.Material>>>();

/** A declared tile and its phone counterpart share their original cached texture with every surface. */
export function loadSpecimenTexture(row: NonNullable<SpecimenMaterialRow['texture']>): Promise<THREE.Texture> {
  const url = TIER_CONFIG.maxTexture <= 1024 ? row.phoneUrl : row.url;
  let pending = textures.get(url);
  if (pending === undefined) {
    pending = loadTexture(url, true).then(loaded => { loaded.name = row.name; return loaded; });
    textures.set(url, pending);
    forgetWhenDisposed(pending, textures, url, pending);
  }
  return pending;
}

/** a specimen material's declared texture, settled (loaded or refused: the fallback colour stays) */
const textureLoads = new WeakMap<THREE.Material, Promise<void>>();
/** DL17: settles once `material`'s declared texture is on it (or refused, keeping its fallback); at once for a material
 *  without one. A level's dressing awaits it, so its surfaces are complete at control. */
export function specimenMaterialReady(material: THREE.Material): Promise<void> {
  return textureLoads.get(material) ?? Promise.resolve();
}

/** Bind the same declared surface for a world draw and its catalogue specimen. */
export function specimenMaterial(sky: SkyRig, input: unknown, map?: THREE.Texture | null): THREE.Material {
  jsonData(input);
  const row = v.parse(SpecimenMaterialSchema, input);
  if (row.family === 'lowpoly') return lowPolyLookMaterial(sky, row.variant ?? 'default');
  let owners = materials;
  if (map !== undefined && map !== null && atlasTextures.has(map)) {
    const known = atlasMaterials.get(map);
    if (known === undefined) { owners = new WeakMap(); atlasMaterials.set(map, owners); } else owners = known;
  }
  let bySky = owners.get(sky);
  if (bySky === undefined) { bySky = new Map(); owners.set(sky, bySky); }
  const cached = bySky.get(row.id);
  if (cached !== undefined) return cached;
  const color = typeof row.color === 'object' ? new THREE.Color().setRGB(...row.color) : row.color ?? 0xffffff;
  const material = painterlyMaterial(sky, { vertexColors: true, rim: row.rim ?? 0.35, bands: row.bands ?? 0.8,
    sway: row.sway ?? 0, transparent:row.transparent??false,depthWrite:row.depthWrite??true,side:row.side==='double'?THREE.DoubleSide:THREE.FrontSide,color, ...(map === undefined ? {} : { map }) });
  if(row.polygonOffset!==undefined){material.polygonOffset=true;material.polygonOffsetFactor=row.polygonOffset[0];material.polygonOffsetUnits=row.polygonOffset[1];}
  if (row.floor !== undefined) { const knobs = painterlyKnobs(material); if (knobs !== undefined) knobs.uPFloorAmt.value = row.floor; }
  if (row.texture !== undefined) {
    const white = new THREE.DataTexture(Uint8Array.from(row.textureFallback??[255,255,255,255]), 1, 1);
    white.colorSpace = THREE.SRGBColorSpace; white.wrapS = white.wrapT = THREE.RepeatWrapping; white.needsUpdate = true;
    material.map = white;
    // G872: a texture that fails keeps the declared fallback colour and is reported, never a refused level
    const texture = row.texture, apply = async (): Promise<void> => {
      try { material.map = await loadSpecimenTexture(texture); }
      catch (error: unknown) { console.warn(`[dressing] ${row.id}: texture failed, its fallback colour stays`, error); }
    };
    textureLoads.set(material, apply());
  }
  bySky.set(row.id, material);
  forgetWhenDisposed(material, bySky, row.id, material);
  return material;
}

/** Prepared GLB policy: the authored direct-child geometry slot and mapped material slot (both default to zero). */
export interface SpecimenAssetRow {
  readonly url: SpecimenLocationRows;
  readonly phoneUrl?: SpecimenLocationRows | undefined;
  readonly atlas?: SpecimenAtlasRows | undefined;
  readonly phoneAtlas?: SpecimenAtlasRows | undefined;
  readonly geometrySlot?: number | undefined;
  readonly materialSlot?: number | undefined;
  readonly material: SpecimenMaterialRow;
  readonly retainedAttribute?: string | undefined;
  readonly transform?: { readonly yaw:number; readonly scale:number } | undefined;
  /** Inert identity for an existing placement owner; never a procedural builder. */
  readonly instance?: { readonly name: string; readonly lod: 'near' | 'far' } | undefined;
}
export interface SpecimenAsset {
  readonly geometry: THREE.BufferGeometry;
  readonly map: THREE.Texture | null;
  readonly box: THREE.Box3;
  readonly retainedAttribute?: THREE.BufferAttribute;
}
const raw = new Map<string, Promise<SpecimenAsset>>();
const bound = new WeakMap<SkyRig, Map<string, Promise<SpecimenAsset & { readonly material: THREE.Material }>>>();
const ownedRaw = new WeakMap<Uint8Array, Map<string, Promise<SpecimenAsset>>>();
const ownedBound = new WeakMap<Uint8Array, WeakMap<SkyRig, Map<string, Promise<SpecimenAsset & { readonly material: THREE.Material }>>>>();
const ownedLoading = new Set<Promise<unknown>>();
let loader: RigLoader | undefined;
const assetLocation = (row: Pick<SpecimenAssetRow, 'url' | 'phoneUrl'>): SpecimenLocationRows => TIER === 'phone' ? row.phoneUrl ?? row.url : row.url;
const assetUrl = (row: Pick<SpecimenAssetRow, 'url' | 'phoneUrl'>): string => {const location=assetLocation(row);return typeof location==='string'?location:location.file;};
function assetBytes(row:Pick<SpecimenAssetRow,'url'|'phoneUrl'>,input?:Uint8Array|ReadonlyMap<string,Uint8Array>):Uint8Array|undefined{
  const location=assetLocation(row),bytes=input instanceof Uint8Array?input:typeof location==='string'?undefined:input?.get(location.file);
  if(typeof location!=='string'&&(bytes===undefined||bytes.byteLength!==location.bytes))throw new Error('Specimen GLB source was not prepared');
  return bytes;
}

const selectedAtlas = (row: Pick<SpecimenAssetRow, 'atlas' | 'phoneAtlas'>): SpecimenAtlasRows | undefined => TIER === 'phone' ? row.phoneAtlas ?? row.atlas : row.atlas;
function boundAtlas(row: SpecimenAssetRow): SpecimenAtlasRows | undefined {
  const atlas = selectedAtlas(row);
  if (atlas !== undefined && (row.material.texture !== undefined || row.material.family !== 'painterly')) throw new Error('Conflicting specimen atlas material');
  if (atlas !== undefined && typeof assetLocation(row) === 'string') throw new Error('Specimen atlas requires an owned GLB');
  return atlas;
}
function atlasBytes(row: SpecimenAtlasRows, input?: Uint8Array | ReadonlyMap<string, Uint8Array>): Uint8Array {
  const bytes = input instanceof Uint8Array ? undefined : input?.get(row.file);
  if (bytes === undefined || bytes.byteLength !== row.bytes) throw new Error('Specimen atlas source was not prepared');
  return bytes;
}
const ownedAtlases = new WeakMap<Uint8Array, Map<string, Promise<THREE.Texture>>>();
const atlasIdentities = new WeakMap<Uint8Array, number>();
let atlasSequence = 0;
function atlasKey(row: SpecimenAtlasRows, bytes: Uint8Array): string {
  let identity = atlasIdentities.get(bytes);
  if (identity === undefined) { identity = ++atlasSequence; atlasIdentities.set(bytes, identity); }
  return `${String(identity)}|${JSON.stringify(row)}`;
}
const atlasWraps = { 33071: THREE.ClampToEdgeWrapping, 33648: THREE.MirroredRepeatWrapping, 10497: THREE.RepeatWrapping } as const;
const atlasFilters = { 9728: THREE.NearestFilter, 9729: THREE.LinearFilter, 9984: THREE.NearestMipmapNearestFilter, 9985: THREE.LinearMipmapNearestFilter, 9986: THREE.NearestMipmapLinearFilter, 9987: THREE.LinearMipmapLinearFilter } as const;
function loadAtlas(row: SpecimenAtlasRows, bytes: Uint8Array): Promise<THREE.Texture> {
  let memo = ownedAtlases.get(bytes);
  if (memo === undefined) { memo = new Map(); ownedAtlases.set(bytes, memo); }
  const key = JSON.stringify(row), known = memo.get(key);
  if (known !== undefined) return known;
  const pending = parseKtx2Bytes(bytes).then(texture => {
    try {
      const gpuMips = row.minFilter >= 9984 && texture.mipmaps.length <= 1;
      if (gpuMips && texture instanceof THREE.CompressedTexture) throw new Error('Specimen atlas requires its declared mip chain');
      texture.wrapS = atlasWraps[row.wrapS]; texture.wrapT = atlasWraps[row.wrapT];
      texture.magFilter = atlasFilters[row.magFilter]; texture.minFilter = atlasFilters[row.minFilter];
      texture.anisotropy = row.anisotropy; texture.colorSpace = row.colourSpace === 'srgb' ? THREE.SRGBColorSpace : THREE.LinearSRGBColorSpace;
      texture.flipY = false; texture.generateMipmaps = gpuMips;
      if (gpuMips) texture.mipmaps = [];
      texture.needsUpdate = true; gpuOnlyTexture(texture, 'models/specimen-atlas'); atlasTextures.add(texture);
      return texture;
    } catch (error) { texture.dispose(); throw error; }
  });
  memo.set(key, pending); void trackOwned(pending); forgetWhenDisposed(pending, memo, key, pending);
  return pending;
}

function selfContainedSpecimen(bytes: Uint8Array): void {
  if(bytes.byteLength<28||bytes.byteLength>25_000_000)throw new Error('Owned specimen GLB outside byte cap');
  const header=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),length=header.getUint32(12,true);
  if(header.getUint32(0,true)!==0x46546c67||header.getUint32(4,true)!==2||header.getUint32(8,true)!==bytes.byteLength||header.getUint32(16,true)!==0x4e4f534a||length%4!==0||20+length>bytes.byteLength)throw new Error('Invalid owned specimen GLB');
  const document:unknown=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(20,20+length)));
  const resources=v.parse(v.object({buffers:v.optional(v.array(v.object({uri:v.optional(v.unknown())})),[]),images:v.optional(v.array(v.object({uri:v.optional(v.unknown())})),[])}),document);
  if([...resources.buffers,...resources.images].some(resource=>resource.uri!==undefined))throw new Error('Owned specimen GLB requires embedded resources');
}
function trackOwned<T>(pending:Promise<T>):Promise<T>{
  ownedLoading.add(pending);
  void pending.then(()=>{ownedLoading.delete(pending);return undefined;},()=>{ownedLoading.delete(pending);return undefined;});
  return pending;
}

/** Borrow a prepared primitive once. Explicit owned bytes use the same parser, with no URL read.
 * Owned caches are keyed by byte identity; all sources retain slot and disposal policy. */
function loadPrimitive(row: Pick<SpecimenAssetRow, 'url' | 'phoneUrl' | 'geometrySlot' | 'materialSlot' | 'retainedAttribute'>, input?:Uint8Array|ReadonlyMap<string,Uint8Array>): Promise<SpecimenAsset> {
  const bytes=assetBytes(row,input),url = assetUrl(row), key = `${url}|${row.geometrySlot ?? 0}|${row.materialSlot ?? 0}|${row.retainedAttribute ?? ''}`;
  let memo=raw;
  if(bytes!==undefined){const known=ownedRaw.get(bytes);if(known===undefined){memo=new Map();ownedRaw.set(bytes,memo);}else memo=known;}
  let pending = memo.get(key);
  if (pending === undefined) {
    if(bytes!==undefined)selfContainedSpecimen(bytes);
    pending = prepareRigLoader().then(({ createRigLoader }) => {
      loader??=createRigLoader();return bytes===undefined?loader.loadAsync(url):loader.parseBytesAsync(bytes,'');
    }).then(({ scene }) => {
      const found = scene.children.filter((child): child is THREE.Mesh => child instanceof THREE.Mesh)[row.geometrySlot ?? 0];
      if (found === undefined) throw new Error(`Prepared specimen has no mesh: ${url}`);
      const geometry = found.geometry, retained = row.retainedAttribute === undefined ? undefined : geometry.getAttribute(row.retainedAttribute);
      if (row.retainedAttribute !== undefined && retained instanceof THREE.BufferAttribute) geometry.deleteAttribute(row.retainedAttribute);
      geometry.computeBoundingBox(); geometry.computeBoundingSphere();
      const material = Array.isArray(found.material) ? found.material[row.materialSlot ?? 0] : (row.materialSlot ?? 0) === 0 ? found.material : undefined;
      if (material === undefined) throw new Error(`Prepared specimen has no material slot: ${url}`);
      const map = material instanceof THREE.MeshStandardMaterial ? material.map : null;
      if (map !== null) { map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = 4; }
      const out: SpecimenAsset = { geometry, map, box: geometry.boundingBox?.clone() ?? new THREE.Box3(),
        ...(retained instanceof THREE.BufferAttribute ? { retainedAttribute: retained } : {}) };
      return out;
    });
    if(bytes!==undefined)void trackOwned(pending);
    memo.set(key, pending);
    // A live cached geometry must not own the consumed loader declaration.
    forgetWhenDisposed(pending, memo, key, pending);
  }
  return pending;
}

/** Load the original primitive plus its optional separately admitted tier atlas. */
export function loadSpecimenAsset(row: Pick<SpecimenAssetRow, 'url' | 'phoneUrl' | 'geometrySlot' | 'materialSlot' | 'retainedAttribute' | 'atlas' | 'phoneAtlas'>, input?: Uint8Array | ReadonlyMap<string, Uint8Array>): Promise<SpecimenAsset> {
  const atlas = selectedAtlas(row);
  if (atlas === undefined) return loadPrimitive(row, input);
  const bytes = atlasBytes(atlas, input);
  if (assetBytes(row, input) === undefined) throw new Error('Specimen atlas requires an owned GLB');
  return Promise.all([loadPrimitive(row, input), loadAtlas(atlas, bytes)]).then(([asset, map]) => ({ ...asset, map }));
}

/** A prepared asset and its per-world material have one lifetime and one shared promise. */
export function loadBoundSpecimen(sky: SkyRig, row: SpecimenAssetRow, input?:Uint8Array|ReadonlyMap<string,Uint8Array>): Promise<SpecimenAsset & { readonly material: THREE.Material }> {
  const bytes=assetBytes(row,input);
  const atlas = boundAtlas(row), atlasSource = atlas === undefined ? undefined : atlasBytes(atlas, input);
  let owners=bound;
  if(bytes!==undefined){const known=ownedBound.get(bytes);if(known===undefined){owners=new WeakMap();ownedBound.set(bytes,owners);}else owners=known;}
  let bySky = owners.get(sky);
  if (bySky === undefined) { bySky = new Map(); owners.set(sky, bySky); }
  const key = `${assetUrl(row)}|${row.geometrySlot ?? 0}|${row.materialSlot ?? 0}|${row.material.id}|${JSON.stringify(row.transform??null)}${atlas === undefined || atlasSource === undefined ? '' : `|atlas:${atlasKey(atlas, atlasSource)}`}`;
  let pending = bySky.get(key);
  if (pending === undefined) {
    pending = loadSpecimenAsset(row,atlas === undefined ? bytes : input).then(asset => {
      const transform=row.transform,geometry=transform===undefined?asset.geometry:asset.geometry.clone().rotateY(transform.yaw).scale(transform.scale,transform.scale,transform.scale);
      const out = { ...asset,geometry, material: specimenMaterial(sky, row.material, asset.map) };
      return out;
    });
    if(bytes!==undefined)void trackOwned(pending);
    bySky.set(key, pending);
    forgetWhenDisposed(pending, bySky, key, pending);
  }
  return pending;
}

/** Client-only replacement of native instance drawings by a declared prepared asset. */
export function replaceSpecimenInstances(sky:SkyRig,row:SpecimenAssetRow,meshes:readonly THREE.InstancedMesh[],files?:ReadonlyMap<string,Uint8Array>):void{
  const replace=async():Promise<void>=>{
    try{
      const asset=await loadBoundSpecimen(sky,row,files);
      for(const mesh of meshes){if(mesh.count===0)continue;mesh.geometry=asset.geometry;mesh.material=asset.material;mesh.computeBoundingSphere();}
    }catch(error:unknown){console.warn('Prepared instance asset failed',error);}
  };void replace();
}

/** Await only loads already requested; does not start a load or impose a timed delay. */
export async function awaitSpecimenAssets(sky: SkyRig): Promise<void> {
  const observed = new Set<Promise<unknown>>();
  for (;;) {
    const pending = [...raw.values(), ...bound.get(sky)?.values() ?? [],...ownedLoading].filter(promise => !observed.has(promise));
    if (pending.length === 0) return;
    for (const promise of pending) observed.add(promise);
    await Promise.all(pending);
  }
}

/** Binary geometry rows retain exact channel types, offsets and optional expansion. */
export interface PackedSpecimenGeometry extends BakedGeometryRow { readonly expand: boolean }
export interface PackedSpecimenRow {
  readonly key: string;
  readonly parts: readonly { readonly material: string; readonly geometry: PackedSpecimenGeometry }[];
}
export interface PackedSpecimenBake {
  readonly bin: string | { readonly file:string; readonly bytes:number }; readonly bytes: number; readonly rows: readonly PackedSpecimenRow[];
}
/** Stable wire key: model identity and the authored parameter property order. */
export function specimenKey(id: string, params: object): string { return `${id} ${JSON.stringify(params)}`; }
// Product JSON sorts object members, while the immutable bank retains the
// author's wire key. Match the same parameter values without rewriting either.
function packedLookupKey(key: string): string {
  const split=key.indexOf(' ');if(split===-1||key[split+1]!=='{')return key;
  const params:unknown=JSON.parse(key.slice(split+1));jsonData(params);
  return `${key.slice(0,split)} ${JSON.stringify(params,(_name,value:unknown)=>
    value!==null&&typeof value==='object'&&!Array.isArray(value)
      ?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a<b?-1:a>b?1:0)):value)}`;
}
interface PackedBakeState { readonly bytes: Uint8Array; readonly offsets: readonly number[] }

/** A packed specimen binary is immutable; builds decode fresh attributes just as the bake declares. */
export function createPackedSpecimens(input: unknown,files:ReadonlyMap<string,Uint8Array>=new Map()): {
  readonly use: (raw: Uint8Array) => void;
  readonly load: () => Promise<void>;
  readonly parts: (key: string, ctx: ModelContext, materials: Readonly<Record<string, SpecimenMaterialRow>>) => readonly { readonly geometry: THREE.BufferGeometry; readonly material: THREE.Material }[] | null;
} {
  jsonData(input);
  const bake = v.parse(PackedSpecimenSchema, input);
  const location=typeof bake.bin==='string'?bake.bin:bake.bin.file;
  let state: PackedBakeState | undefined, pending: Promise<void> | undefined;
  let lookup:ReadonlyMap<string,number>|undefined;
  const use = (bytes: Uint8Array): void => {
    if (bytes.length !== bake.bytes) throw new Error(`Specimen byte count differs: ${location}`);
    let offset = 0;
    const offsets: number[] = [];
    for (const row of bake.rows) for (const part of row.parts) { offsets.push(offset); offset += bakedGeometryBytes(part.geometry); }
    if (offset !== bytes.length) throw new Error(`Specimen rows do not cover binary: ${location}`);
    state = { bytes, offsets }; pending = Promise.resolve();
  };
  return { use,
    load: () => {
      pending ??= (async (): Promise<void> => {
        if(typeof bake.bin==='string')use(await fetchLaneBake(bake.bin));
        else use(binarySourceBytes({file:bake.bin.file},files));
      })();
      return pending;
    },
    parts: (key, ctx, materialRows) => {
      let index=bake.rows.findIndex(row=>row.key===key);
      if(index<0){
        if(lookup===undefined){const entries=new Map<string,number>();for(const [at,row]of bake.rows.entries()){const identity=packedLookupKey(row.key);if(!entries.has(identity))entries.set(identity,at);}lookup=entries;}
        index=lookup.get(packedLookupKey(key))??-1;
      }
      const row=bake.rows[index];
      if (state === undefined || row === undefined) return null;
      const loaded = state;
      let first = 0;
      for (let i = 0; i < index; i++) first += bake.rows[i]?.parts.length ?? 0;
      return row.parts.map((part, i) => {
        let geometry = readBakedGeometry(loaded.bytes, loaded.offsets[first + i] ?? 0, part.geometry);
        if (part.geometry.expand) geometry = expandBakedGeometry(geometry);
        const material = Object.hasOwn(materialRows, part.material) ? materialRows[part.material] : undefined;
        if (material === undefined) throw new Error(`Missing specimen material: ${part.material}`);
        return { geometry, material: specimenMaterial(ctx.sky, material) };
      });
    },
  };
}

/** Prepare declared raw files and compressed packed banks before publishing definitions.
 * Each bank is decoded once per preparation; catalogue builds still own fresh geometry arrays. */
export function prepareSpecimenCatalogue(product:BinaryFileReader,input:unknown,scope?:Scope,packedInputs:readonly unknown[]=[],assetInputs:readonly unknown[]=[]):Promise<ReadonlyMap<string,Uint8Array>> {
  return specimenPreparation(product,input,scope,packedInputs,assetInputs).read();
}

/** Admit named sources now, then read once on specimen demand or after control. */
export function planSpecimenCatalogue(product:BinaryFileReader,input:unknown,scope?:Scope,packedInputs:readonly unknown[]=[],assetInputs:readonly unknown[]=[]):()=>Promise<ReadonlyMap<string,Uint8Array>> {
  const plan=specimenPreparation(product,input,scope,packedInputs,assetInputs);plan.check();return plan.read;
}

function specimenPreparation(product:BinaryFileReader,input:unknown,scope:Scope|undefined,packedInputs:readonly unknown[],assetInputs:readonly unknown[]):{
  check:()=>void;read:()=>Promise<ReadonlyMap<string,Uint8Array>>;
} {
  jsonData(input);const rows=v.parse(SpecimenCatalogueSchema,input);
  jsonData(packedInputs);const packs=packedInputs.map(value=>v.parse(PackedSpecimenSchema,value));
  jsonData(assetInputs);const declaredAssets=assetInputs.map(value=>v.parse(SpecimenAssetSchema,value));
  const declarations=rows.flatMap(row=>row.source.kind==='selection'?row.source.variants.map(variant=>variant.source):[row.source]);
  const assets=[...declaredAssets,...declarations.flatMap(source=>source.kind==='asset'?[source.asset]:[])];
  const sources=[...declarations.flatMap(source=>source.kind==='file'?[{source:{file:source.file},bytes:bakedGeometryBytes(source.geometry)}]:[]),
    ...declarations.flatMap(source=>source.kind==='owned'?source.variants.flatMap(variant=>typeof variant.url==='string'?[]:[{source:{file:variant.url.file},bytes:variant.url.bytes}]):[]),
    ...assets.flatMap(row=>{const location=assetLocation(row);return typeof location==='string'?[]:[{source:{file:location.file},bytes:location.bytes}];})];
  const rawNames=new Set(sources.map(source=>source.source.file));
  const atlases = assets.flatMap(asset => {
    const atlas = boundAtlas(asset);
    if (atlas === undefined) return [];
    if (rawNames.has(atlas.file)) throw new Error('Conflicting specimen source encodings');
    return [atlas];
  });
  for (const atlas of atlases) { sources.push({ source: { file: atlas.file }, bytes: atlas.bytes }); rawNames.add(atlas.file); }
  for(const pack of packs)if(typeof pack.bin!=='string'&&rawNames.has(pack.bin.file))throw new Error('Conflicting specimen source encodings');
  const read=product.file,has=product.hasFile;
  const live=():void=>{if(scope?.disposed===true||scope?.disposing===true||product.file!==read||product.hasFile!==has)throw new Error('Specimen source owner retired or changed');};
  const check=():void=>{
    live();if(read===undefined&&(rawNames.size>0||packs.some(pack=>typeof pack.bin!=='string')))throw new Error('Specimen source requires its product reader');
    if(has!==undefined)for(const name of [...rawNames,...packs.flatMap(pack=>typeof pack.bin==='string'?[]:[pack.bin.file])]){
      if(!has.call(product,name))throw new Error(`Missing binary source ${name}`);
    }
  };
  let pending:Promise<ReadonlyMap<string,Uint8Array>>|undefined;
  const load=async():Promise<ReadonlyMap<string,Uint8Array>>=>{
    check();
    live();const files=new Map(await prepareBinarySources(product,[...sources,...packs.flatMap(pack=>typeof pack.bin==='string'?[]:[{source:{file:pack.bin.file},bytes:pack.bin.bytes}])],scope));live();
    const checked=new Set<Uint8Array>();
    for(const asset of assets){const bytes=assetBytes(asset,files);if(bytes!==undefined&&!checked.has(bytes)){selfContainedSpecimen(bytes);checked.add(bytes);}}
    const checkedAtlases = new Set<Uint8Array>();
    for (const atlas of atlases) { const bytes = atlasBytes(atlas, files); if (!checkedAtlases.has(bytes)) { parseKtx2(bytes); checkedAtlases.add(bytes); } }
    const decoded=new Map<string,Uint8Array>();
    for(const pack of packs)if(typeof pack.bin!=='string'){
      let bytes=decoded.get(pack.bin.file);
      if(bytes===undefined){bytes=await decodeLaneBytes(binarySourceBytes({file:pack.bin.file},files));live();decoded.set(pack.bin.file,bytes);files.set(pack.bin.file,bytes);}
      createPackedSpecimens(pack).use(bytes);
    }
    return files;
  };
  return{check,read:()=>{try{check();pending??=load();return pending;}catch(error:unknown){return Promise.reject(error instanceof Error?error:new Error('Specimen source check failed',{cause:error}));}}};
}

/** Complete model declaration: parameters and specimen selection are data, with no shard callback. */
export type SpecimenModelRow = v.InferOutput<typeof SpecimenCatalogueSchema>[number];
/** Bind a named parameter map to an ordered catalogue. Definitions register immediately; assets remain lazy. */
export function defineSpecimenCatalogue<Params extends { readonly [K in keyof Params]: object }>(input: unknown, packedInput?: unknown, materialRowsInput: unknown = {}, files:ReadonlyMap<string,Uint8Array>=new Map(),prepare?:()=>Promise<void>): { readonly model: <K extends keyof Params & string>(key: K) => ModelDef<Params[K]>; readonly usePacked: (bytes: Uint8Array) => void; readonly loadPacked:()=>Promise<void> } {
  jsonData(input);
  jsonData(materialRowsInput);
  const packed = packedInput === undefined ? undefined : createPackedSpecimens(packedInput,files);
  const materialRows = v.parse(v.record(v.string(), SpecimenMaterialSchema), materialRowsInput);
  const rows = v.parse(SpecimenCatalogueSchema, input);
  if (rows.length > 1024 || new Set(rows.map(row => row.key)).size !== rows.length || new Set(rows.map(row => row.model.id)).size !== rows.length) throw new Error('Specimen catalogue must be bounded and unique');
  const parameterKey=(value:object):string=>JSON.stringify(Object.entries(value).sort(([a],[b])=>a<b?-1:a>b?1:0));
  for(const row of rows)if(row.source.kind==='selection'&&new Set(row.source.variants.map(variant=>parameterKey(variant.params))).size!==row.source.variants.length)throw new Error('Duplicate specimen selection');
  const validate=():void=>{for(const row of rows)for(const source of row.source.kind==='selection'?row.source.variants.map(variant=>variant.source):[row.source])if(source.kind==='asset'){
    assetBytes(source.asset,files); const atlas = boundAtlas(source.asset); if (atlas !== undefined) atlasBytes(atlas,files);
  }};
  let ready=prepare===undefined,pending:Promise<void>|undefined;
  const ensure=async():Promise<void>=>{validate();await packed?.load();ready=true;};
  const prepareModel=async():Promise<void>=>{await prepare?.();pending??=ensure();return pending;};
  if(ready)validate();
  const definitions = new Map<string, ModelDef<object>>();
  for (const row of rows) {
    const build = (ctx: ModelContext, params: object): ModelBuild => {
      if(!ready)throw new Error('Specimen catalogue requires preparation');
      const source = row.source.kind==='selection'?row.source.variants.find(candidate=>parameterKey(candidate.params)===parameterKey(params))?.source:row.source;
      if(source===undefined)throw new Error(`No authored specimen: ${row.model.id}`);
      if(source.kind==='inline'||source.kind==='file'){
        const decodedBytes=binarySourceBytes(source.kind==='inline'?{data:source.data}:{file:source.file},files);
        if(decodedBytes.length!==bakedGeometryBytes(source.geometry))throw new Error('Inline specimen byte count differs');
        const decoded=readBakedGeometry(decodedBytes,0,source.geometry),geometry=source.geometry.expand?expandBakedGeometry(decoded):decoded;
        const part={geometry,material:specimenMaterial(ctx.sky,source.material),castShadow:true,receiveShadow:true};
        queueMicrotask(()=>{announceModelReady(row.model.id);});
        return source.representation==='parts'?[part]:new THREE.Group().add(Object.assign(new THREE.Mesh(part.geometry,part.material),{castShadow:true,receiveShadow:true}));
      }
      if (source.kind === 'owned') {
        const variant = source.variants.find(candidate => parameterKey(candidate.params) === parameterKey(params));
        if (variant === undefined) throw new Error(`No authored specimen: ${row.model.id}`);
        const material = specimenMaterial(ctx.sky, source.material);
        // a variant names a page URL (fetched on first use) or a product file (prepared with the catalogue)
        const location = variant.url, bytes = typeof location === 'string' ? undefined : files.get(location.file);
        if (typeof location !== 'string' && bytes?.byteLength !== location.bytes) throw new Error(`Owned specimen file was not prepared: ${row.model.id}`);
        return loadingSpecimen(row.model.id, variant.size, async () => {
          const intake = createOwnedGeometry(typeof location === 'string' ? location : location.file); await intake.load(bytes);
          const mesh = new THREE.Mesh(intake.take(), material); mesh.castShadow = true; mesh.receiveShadow = true; return mesh;
        });
      }
      const group = new THREE.Group();
      const fill = (): boolean => {
        if (packed === undefined) throw new Error(`Missing packed specimens: ${row.model.id}`);
        const parts = packed.parts(specimenKey(row.model.id, params), ctx, materialRows);
        if (parts === null) return false;
        for (const part of parts) { const mesh = new THREE.Mesh(part.geometry, part.material); mesh.castShadow = true; mesh.receiveShadow = true; group.add(mesh); }
        queueMicrotask(() => { announceModelReady(row.model.id); }); return true;
      };
      if (source.kind === 'asset') {
        void (async (): Promise<void> => {
          try {
            const asset = await loadBoundSpecimen(ctx.sky, source.asset,files);
            const mesh = new THREE.Mesh(asset.geometry, asset.material); mesh.castShadow = true; mesh.receiveShadow = true;
            group.add(mesh); announceModelReady(row.model.id);
          } catch (error: unknown) { console.warn(`[models] ${row.model.id}: specimen asset failed`, error); }
        })();
      } else if (!fill()) {
        if (packed === undefined) throw new Error(`Missing packed specimens: ${row.model.id}`);
        const pendingBake = packed;
        void (async (): Promise<void> => {
          try { await pendingBake.load(); if (!fill()) console.warn(`[models] no baked specimen ${row.model.id}`); }
          catch (error: unknown) { console.error(`[models] ${row.model.id}: specimen bake failed`, error); }
        })();
      }
      return group;
    };
    const { surface: modelSurface, seed, variants, specimenYaw, ...metadata } = row.model;
    // Placement owners read this inert marker; the host remains the only specimen builder.
    if (row.source.kind === 'asset' && row.source.asset.instance !== undefined) {
      const { instance, material: binding } = row.source.asset;
      const look = { ...(binding.rim === undefined ? {} : { rim: binding.rim }),
        ...(binding.bands === undefined ? {} : { bands: binding.bands }),
        ...(binding.sway === undefined ? {} : { sway: binding.sway }),
        ...(binding.color === undefined ? {} : { color: binding.color }) };
      Object.assign(build, { gen: { id: row.model.id, name: instance.name, lod: instance.lod, look } });
    }
    definitions.set(row.key, defineModel<object>({ ...metadata, build,...(prepare===undefined?{}:{prepare:prepareModel}),
      ...(modelSurface === undefined ? {} : { surface: modelSurface }), ...(seed === undefined ? {} : { seed }),
      ...(variants === undefined ? {} : { variants }), ...(specimenYaw === undefined ? {} : { specimenYaw }),
      ...(row.colliders === undefined ? {} : { colliders: () => (row.colliders ?? []).map(collider => {
        const { surface, yaw, ...shape } = collider;
        return Object.assign(shape, surface === undefined ? {} : { surface }, yaw === undefined ? {} : { yaw });
      }) }),
    }));
  }
  // Parameter types are supplied by the authoring definitions; only this host installs executable fields.
  return { loadPacked:async()=>{if(packed===undefined)throw new Error('Catalogue has no packed specimens');await packed.load();},usePacked: bytes => { if (packed === undefined) throw new Error('Catalogue has no packed specimens'); packed.use(bytes); }, model: <K extends keyof Params & string>(key: K): ModelDef<Params[K]> => {
    const definition = definitions.get(key);
    if (definition === undefined) throw new Error(`Missing catalogue model: ${key}`);
    const { defaults, variants, ...base } = definition;
    return { ...base, defaults: defaults as Params[K],
      ...(variants === undefined ? {} : { variants: variants.map(variant => ({ id: variant.id, label: variant.label, params: variant.params as Partial<Params[K]> })) }),
    };
  } };
}
