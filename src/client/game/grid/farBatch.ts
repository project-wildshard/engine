import * as THREE from 'three';
import { ChangedBatchedMesh } from '@wildshard/engine/render/changedTextureUploads';
import { patchShader } from '@wildshard/engine/render/shaderPatches';
import { TIER } from '@wildshard/engine/core/tier';
import { farBatchAtLow } from '@wildshard/engine/core/graphicsMode';
import { ownedArray } from '@wildshard/engine/core/ownedBuffer';
import { skipEmptyBatches } from '@wildshard/engine/render/drawGuards';
import type { FarLookRuntime } from '../../../shared/game/grid/farProxy';
import { farProxyMaterial, type FarProxyView } from './farView';

/**
 * DF10 (mini-df10d): the far ring's proxies drawn as one multi-draw batch per program. Each neighbour cell's far proxy was
 * a mesh with a material of its own (its 16 region flags and band share as uniforms), so the horizon drew one draw per
 * cell in view: 7 of the beach's 55. Its proxies share one program per family and mask kind, so each group becomes a
 * three BatchedMesh whose copies read their flags and share from a small data texture by draw id. A proxy's own mesh
 * stays the source of truth (its parent's and its own visibility, its masks and band, its matrix): it no longer draws
 * (no layer), and the batch reads it every frame. The batch keeps its geometry buffers as proxies enter and leave.
 * A proxy with light or colour layers keeps them (they are its children and still draw).
 */
/** The far ring batches only at phone Low. */
export function farBatchOn(): boolean { return TIER === 'phone' && farBatchAtLow(); }

/** whether a renderer multi-draws (`WEBGL_multi_draw`); none (a test host): no */
export function multiDraws(renderer: unknown): boolean {
  const extensions: unknown = typeof renderer === 'object' && renderer !== null ? Reflect.get(renderer, 'extensions') : null;
  const has: unknown = typeof extensions === 'object' && extensions !== null ? Reflect.get(extensions, 'has') : null;
  return typeof has === 'function' && Reflect.apply(has, extensions, ['WEBGL_multi_draw']) === true;
}

const isMaterial = (value: unknown): value is THREE.Material => value instanceof THREE.Material;

/** per copy: four texels of region flags, one of band share */
const TEXELS = 5;
const MASKS = 16;
const EMPTY = ownedArray(Uint8Array, 0, { owner: 'grid/far-batch', asset: 'far-flags', kind: 'scratch' });

interface Member { readonly view: FarProxyView; readonly material: THREE.Material; readonly geometry: THREE.BufferGeometry; instance: number }
interface VacantGeometry { readonly id: number; readonly vertices: number; readonly indices: number }

/** Shader warm-up needs the same attribute layout, with no need for the proxy's full draw geometry. */
function standGeometry(source: THREE.BufferGeometry): THREE.BufferGeometry {
  if (source.getAttribute('position').count < 3) return source;
  const attributes = Object.entries(source.attributes);
  const stand = new THREE.BufferGeometry();
  for (const [name, attribute] of attributes) {
    if (!(attribute instanceof THREE.BufferAttribute)) return source;
    stand.setAttribute(name, new THREE.BufferAttribute(attribute.array.subarray(0, 3 * attribute.itemSize), attribute.itemSize, attribute.normalized));
  }
  if (source.index !== null) stand.setIndex([0, 1, 2]);
  return stand;
}

/** a proxy material's flags and band, as `farProxyMaterial` records them */
function farState(material: THREE.Material): { mask: Float32Array; band: number } | null {
  const mask: unknown = material.userData['farMask'], band: unknown = material.userData['farBand'];
  if (!(mask instanceof Float32Array) || mask.length !== MASKS || typeof band !== 'object' || band === null) return null;
  const value: unknown = Reflect.get(band, 'value');
  return typeof value === 'number' ? { mask, band: value } : null;
}

/** whether `object` and every ancestor are visible */
function shown(object: THREE.Object3D): boolean {
  for (let node: THREE.Object3D | null = object; node !== null; node = node.parent) if (!node.visible) return false;
  return true;
}

/** the batched copy of a group's program: the flags and band read from the data texture by the copy's draw id (`data`'s
 *  value: a kept material's holder follows its group's texture) */
function batchMaterial(look: FarLookRuntime, positionalMask: boolean, data: { value: THREE.DataTexture }): THREE.Material {
  const { material } = farProxyMaterial(look, positionalMask, false);
  const reader = `uniform highp sampler2D farBatchData;
float farMaskAt(float id, int r) { return texelFetch(farBatchData, ivec2(r / 4, int(id)), 0)[r - (r / 4) * 4]; }`;
  patchShader(material, 'df10-far-batch', 1, (shader): void => {
    shader.uniforms['farBatchData'] = data;
    shader.vertexShader = shader.vertexShader
      .replace(`uniform float farMask[${String(MASKS)}];`, `${reader}\nflat varying float vFarBatchId;\nfloat farBatchId;`)
      .replace('#include <batching_vertex>', '#include <batching_vertex>\nfarBatchId = getIndirectIndex(gl_DrawID);\nvFarBatchId = farBatchId;')
      .replaceAll(/farMask\[([^\]]+)\]/gu, 'farMaskAt(farBatchId, $1)');
    shader.fragmentShader = shader.fragmentShader
      .replace('uniform float farBand;', `${reader}\nflat varying float vFarBatchId;\n#define farBand (texelFetch(farBatchData, ivec2(${String(TEXELS - 1)}, int(vFarBatchId)), 0).r)`)
      .replace(`uniform float farMask[${String(MASKS)}];`, '')
      .replaceAll(/farMask\[([^\]]+)\]/gu, 'farMaskAt(vFarBatchId, $1)');
  }, { key: (prior: string) => `${prior}|df10-far-batch` });
  return material;
}

/** One program's proxies as one batch, synced from the proxies every frame. */
export class FarBatch extends ChangedBatchedMesh {
  readonly members: Member[] = [];
  /** the copies' flags and band (absent on a copy three's clone made: it draws what it was copied with) */
  private flags: { readonly data: THREE.DataTexture; readonly bytes: Uint8Array } | null = null;
  private retired = false;
  private readonly vacant: VacantGeometry[] = [];
  /** DF8 (`debug.programReuse`): the material is its group's, kept across rebuilds; the group disposes it */
  private sharedMaterial = false;
  /** a batch of `members`, its flags and band in `data` (whose pixels are `bytes`); `shared`: the material outlives it */
  static of(members: readonly Member[], data: THREE.DataTexture, bytes: Uint8Array, material: THREE.Material, shared = false, instances: number = members.length): FarBatch {
    const vertices = members.reduce((sum, member) => sum + member.geometry.getAttribute('position').count, 0);
    const indices = members.reduce((sum, member) => sum + (member.geometry.index?.count ?? 0), 0);
    const reserve = instances > members.length ? 1.5 : 1;
    // three's constructor signature, so its clone (`new this.constructor(...)`) still makes a batch
    const batch = new FarBatch(instances, Math.ceil(vertices * reserve), Math.max(1, Math.ceil(indices * reserve)), material);
    batch.name = 'far-batch'; batch.frustumCulled = false; batch.perObjectFrustumCulled = true; batch.sortObjects = false;
    batch.castShadow = false; batch.receiveShadow = false; batch.matrixAutoUpdate = false;
    batch.flags = { data, bytes }; batch.sharedMaterial = shared;
    for (const member of members) batch.append(member);
    // The first GL upload copies the entire buffer. Future appends should upload only their changed spans.
    batch.geometry.index?.clearUpdateRanges();
    for (const attribute of Object.values(batch.geometry.attributes)) {
      if (attribute instanceof THREE.BufferAttribute) attribute.clearUpdateRanges();
    }
    batch.sync();
    return batch;
  }
  private append(member: Member, geometry = this.addGeometry(member.geometry)): void {
    member.instance = this.addInstance(geometry);
    member.view.mesh.updateWorldMatrix(true, false);
    this.setMatrixAt(member.instance, member.view.mesh.matrixWorld);
    this.members.push(member);
    this.boundingBox = null; this.boundingSphere = null;
  }
  /** Fill a vacant range, append, or compact when empty ranges are large enough together. */
  tryAppend(member: Member): boolean {
    if (this.retired || this.instanceCount === this.maxInstanceCount) return false;
    const vertices = member.geometry.getAttribute('position').count, indices = member.geometry.index?.count ?? 0;
    const hole = this.vacant.findIndex(entry => vertices <= entry.vertices && indices <= entry.indices);
    const fitting = this.vacant[hole];
    if (fitting !== undefined) {
      this.setGeometryAt(fitting.id, member.geometry);
      this.vacant.splice(hole, 1);
      this.append(member, fitting.id);
      return true;
    }
    if (vertices > this.unusedVertexCount || indices > this.unusedIndexCount) {
      if (vertices > this.vacant.reduce((total, entry) => total + entry.vertices, this.unusedVertexCount)
        || indices > this.vacant.reduce((total, entry) => total + entry.indices, this.unusedIndexCount)) return false;
      for (const entry of this.vacant) this.deleteGeometry(entry.id);
      this.vacant.length = 0;
      this.optimize();
    }
    this.append(member);
    return true;
  }
  removeMember(member: Member): void {
    const at = this.members.indexOf(member);
    if (at === -1) return;
    const id = this.getGeometryIdAt(member.instance), range = this.getGeometryRangeAt(id);
    if (range === null) throw new Error('Missing far batch geometry range');
    this.vacant.push({ id, vertices: range.reservedVertexCount, indices: Math.max(0, range.reservedIndexCount) });
    this.deleteInstance(member.instance);
    this.members.splice(at, 1);
    this.boundingBox = null; this.boundingSphere = null;
  }
  /** once: three's dispose empties its textures, and a scene owner may dispose the batch before the ring does */
  retire(): void {
    if (this.retired) return;
    this.retired = true;
    this.removeFromParent(); this.dispose();
    const material: unknown = this.material;
    if (isMaterial(material) && !this.sharedMaterial) material.dispose();
  }
  /** each copy's visibility, flags and band, as its proxy has them now */
  sync(): void {
    const flags = this.flags;
    if (flags === null || this.retired) return;
    let changed = false;
    for (const member of this.members) {
      const state = farState(member.material);
      const visible = shown(member.view.mesh) && member.material.visible && state !== null;
      if (this.getVisibleAt(member.instance) !== visible) this.setVisibleAt(member.instance, visible);
      if (state === null) continue;
      const row = member.instance * TEXELS * 4;
      for (let r = 0; r < MASKS; r++) {
        const byte = (state.mask[r] ?? 0) > 0.5 ? 255 : 0;
        if (flags.bytes[row + r] !== byte) { flags.bytes[row + r] = byte; changed = true; }
      }
      const band = Math.round(Math.min(1, Math.max(0, state.band)) * 255);
      if (flags.bytes[row + MASKS] !== band) { flags.bytes[row + MASKS] = band; changed = true; }
    }
    if (changed) flags.data.needsUpdate = true;
  }
  override onBeforeRender(...args: Parameters<ChangedBatchedMesh['onBeforeRender']>): void {
    this.sync();
    super.onBeforeRender(...args);
  }
}

/** one program's proxies and their batch */
interface Group { look: FarLookRuntime; positionalMask: boolean; members: Member[]; batch: FarBatch | null; data: THREE.DataTexture | null; bytes: Uint8Array; rows: number;
  /** DF8 (`debug.programReuse`, `debug.programFold`): the group's one material and its texture holder, kept across rebuilds */
  material: THREE.Material | null; holder: { value: THREE.DataTexture } | null }

/** The far ring's batches, one per program, under `parent` (the scene). */
export class FarBatches {
  private readonly groups = new Map<string, Group>();
  /** DF8 (mini-df8): a group keeps one material across rebuilds, so a ring change never frees its program and links it
   *  again at the next draw (a new material per rebuild disposed the old one first: its program went with it).
   *  DF10 (mini-dfload): always, with or without DF8's slots, so the ring's preparation also links each batch's program
   *  through its stand-in (`stand`) before the batch replaces its proxies: on the iPhone 13 a far batch linked its program
   *  inside a draw after control (a 1.1 s frame). */
  private readonly parent: THREE.Object3D;
  private readonly keepMaterials;
  constructor(parent: THREE.Object3D, keepMaterials = true) {
    this.parent = parent; this.keepMaterials = keepMaterials;
    // DF10 (mini-dfload): a batch whose proxies are all hidden draws nothing, so it never looks a program up for nothing
    skipEmptyBatches(true);
  }

  /** the group key `view` would join, or null when it cannot be batched */
  private keyOf(view: FarProxyView, look: FarLookRuntime, positionalMask: boolean): string | null {
    const material: unknown = view.mesh.material, geometry = view.mesh.geometry;
    if (!isMaterial(material) || farState(material) === null || geometry.getAttribute('position') === undefined) return null;
    const signature = Object.keys(geometry.attributes).sort().map(name => `${name}:${String(geometry.getAttribute(name).itemSize)}`).join(',');
    return `${look.family}|${positionalMask ? 'position' : 'region'}|${signature}|${geometry.index === null ? 'flat' : 'indexed'}`;
  }
  private groupOf(key: string, look: FarLookRuntime, positionalMask: boolean): Group {
    let group = this.groups.get(key);
    if (group === undefined) { group = { look, positionalMask, members: [], batch: null, data: null, bytes: EMPTY, rows: 0, material: null, holder: null }; this.groups.set(key, group); }
    return group;
  }
  /** the group's flags texture, at least `rows` copies tall */
  private ensureData(group: Group, rows: number): THREE.DataTexture {
    if (group.data === null || group.rows < rows) {
      group.data?.dispose();
      const size = Math.max(8, 2 ** Math.ceil(Math.log2(Math.max(1, rows))));
      const bytes = ownedArray(Uint8Array, TEXELS * size * 4, { owner: 'grid/far-batch', asset: 'far-flags', kind: 'scratch' });
      const data = new THREE.DataTexture(bytes, TEXELS, size, THREE.RGBAFormat, THREE.UnsignedByteType);
      data.magFilter = THREE.NearestFilter; data.minFilter = THREE.NearestFilter; data.generateMipmaps = false; data.needsUpdate = true;
      group.data = data; group.bytes = bytes; group.rows = size;
    }
    return group.data;
  }

  /**
   * DF8 (`debug.programFold`): a stand-in of the batch `view` will join, drawn with the group's kept material, for a warm-up
   * to link the batch's program before the batch replaces its proxies (the far ring's first batches linked their programs
   * at their first draw, 3.9 s after control). Null when the view cannot be batched or the group keeps no material. The
   * caller retires it (its material stays the group's).
   */
  stand(view: FarProxyView, look: FarLookRuntime, positionalMask: boolean): FarBatch | null {
    const key = this.keepMaterials ? this.keyOf(view, look, positionalMask) : null;
    const material: unknown = view.mesh.material;
    if (key === null || !isMaterial(material)) return null;
    // a live batch keeps reading the group's texture: the stand-in never replaces it
    const group = this.groupOf(key, look, positionalMask), data = group.data ?? this.ensureData(group, 1);
    group.holder ??= { value: data };
    group.material ??= batchMaterial(group.look, group.positionalMask, group.holder);
    const bytes = ownedArray(Uint8Array, TEXELS * 8 * 4, { owner: 'grid/far-batch', asset: 'far-flags', kind: 'scratch' });
    const scratch = new THREE.DataTexture(bytes, TEXELS, 8, THREE.RGBAFormat, THREE.UnsignedByteType);
    const batch = FarBatch.of([{ view, material, geometry: standGeometry(view.mesh.geometry), instance: -1 }], scratch, bytes, group.material, true);
    batch.name = 'far-batch:stand-in';
    const retire = batch.retire.bind(batch);
    batch.retire = (): void => { retire(); scratch.dispose(); };
    return batch;
  }

  /** Draw `view` in its group's batch, if it can be (a far ring proxy with a recorded program state); returns whether it
   *  joined. Its own mesh stops drawing; its dispose leaves the batch. */
  adopt(view: FarProxyView, look: FarLookRuntime, positionalMask: boolean): boolean {
    const material: unknown = view.mesh.material, geometry = view.mesh.geometry;
    const key = this.keyOf(view, look, positionalMask);
    if (key === null || !isMaterial(material)) return false;
    const group = this.groupOf(key, look, positionalMask);
    const member: Member = { view, material, geometry, instance: -1 };
    group.members.push(member);
    view.mesh.layers.disableAll();
    const dispose = view.dispose;
    view.dispose = () => {
      const at = group.members.indexOf(member);
      if (at !== -1 && this.groups.get(key) === group) {
        group.members.splice(at, 1);
        if (group.members.length === 0) {
          group.batch?.retire(); group.data?.dispose(); group.material?.dispose();
          this.groups.delete(key);
        } else group.batch?.removeMember(member);
      }
      dispose();
    };
    if (group.batch?.tryAppend(member) !== true) this.grow(group);
    return true;
  }

  private grow(group: Group): void {
    const instances = Math.max(8, group.members.length * 2);
    group.batch?.retire();
    const data = this.ensureData(group, instances);
    let material: THREE.Material;
    if (this.keepMaterials) {
      group.holder ??= { value: data };
      group.holder.value = data;
      group.material ??= batchMaterial(group.look, group.positionalMask, group.holder);
      material = group.material;
    } else material = batchMaterial(group.look, group.positionalMask, { value: data });
    const batch = FarBatch.of(group.members, data, group.bytes, material, this.keepMaterials, instances);
    this.parent.add(batch); batch.updateMatrixWorld(true);
    group.batch = batch;
  }

  /** the drawn batches (tests and the census) */
  batches(): readonly FarBatch[] { return [...this.groups.values()].flatMap(group => group.batch === null ? [] : [group.batch]); }

  dispose(): void {
    for (const group of this.groups.values()) { group.batch?.retire(); group.data?.dispose(); group.material?.dispose(); }
    this.groups.clear();
  }
}
