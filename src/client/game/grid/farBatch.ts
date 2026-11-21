import * as THREE from 'three';
import { ChangedBatchedMesh } from '@wildshard/engine/render/changedTextureUploads';
import { patchShader } from '@wildshard/engine/render/shaderPatches';
import { TIER } from '@wildshard/engine/core/tier';
import { graphicsMode } from '@wildshard/engine/core/graphicsMode';
import { jsonSlot } from '@wildshard/engine/saves/slots';
import { ownedArray } from '@wildshard/engine/core/ownedBuffer';
import type { FarLookRuntime } from '../../../shared/game/grid/farProxy';
import { farProxyMaterial, type FarProxyView } from './farView';

/**
 * DF10 (mini-df10d): the far ring's proxies drawn as one multi-draw batch per program. Each neighbour cell's far proxy was
 * a mesh with a material of its own (its 16 region flags and band share as uniforms), so the horizon drew one draw per
 * cell in view: 7 of the beach's 55. Its proxies share one program per family and mask kind, so each group becomes a
 * three BatchedMesh whose copies read their flags and share from a small data texture by draw id. A proxy's own mesh
 * stays the source of truth (its parent's and its own visibility, its masks and band, its matrix): it no longer draws
 * (no layer), and the batch reads it every frame. A group is rebuilt only when a proxy joins or leaves (the ring moves).
 * A proxy with light or colour layers keeps them (they are its children and still draw).
 */
export const FAR_BATCH_SLOT = 'debug.farBatch';
const farBatchSlot = jsonSlot(FAR_BATCH_SLOT, 'device');
/** The slot's value: a boolean wins; unset, off (a cooled iPhone 13 pair decides the phone-Low default). */
export function farBatch(saved: unknown): boolean { return typeof saved === 'boolean' ? saved : false; }
/** On at phone Low only, where the slot is set (the far ring is the phone's horizon). */
export function farBatchOn(): boolean {
  let saved: unknown = null;
  try { saved = farBatchSlot.read(); } catch { /* storage blocked: the default */ }
  let low = false;
  try { low = graphicsMode() === 'low'; } catch { /* no settings: not Low */ }
  return TIER === 'phone' && low && farBatch(saved);
}

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

/** the batched copy of a group's program: the flags and band read from the data texture by the copy's draw id */
function batchMaterial(look: FarLookRuntime, positionalMask: boolean, data: THREE.DataTexture): THREE.Material {
  const { material } = farProxyMaterial(look, positionalMask, false);
  const reader = `uniform highp sampler2D farBatchData;
float farMaskAt(float id, int r) { return texelFetch(farBatchData, ivec2(r / 4, int(id)), 0)[r - (r / 4) * 4]; }`;
  patchShader(material, 'df10-far-batch', 1, (shader): void => {
    shader.uniforms['farBatchData'] = { value: data };
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

/** one program's proxies as one batch: rebuilt when a proxy joins or leaves, synced from the proxies every frame */
export class FarBatch extends ChangedBatchedMesh {
  readonly members: Member[] = [];
  /** the copies' flags and band (absent on a copy three's clone made: it draws what it was copied with) */
  private flags: { readonly data: THREE.DataTexture; readonly bytes: Uint8Array } | null = null;
  private retired = false;
  /** a batch of `members`, its flags and band in `data` (whose pixels are `bytes`) */
  static of(members: readonly Member[], data: THREE.DataTexture, bytes: Uint8Array, material: THREE.Material): FarBatch {
    const vertices = members.reduce((sum, member) => sum + member.geometry.getAttribute('position').count, 0);
    const indices = members.reduce((sum, member) => sum + (member.geometry.index?.count ?? 0), 0);
    // three's constructor signature, so its clone (`new this.constructor(...)`) still makes a batch
    const batch = new FarBatch(members.length, vertices, Math.max(1, indices), material);
    batch.name = 'far-batch'; batch.frustumCulled = false; batch.perObjectFrustumCulled = true; batch.sortObjects = false;
    batch.castShadow = false; batch.receiveShadow = false; batch.matrixAutoUpdate = false;
    batch.flags = { data, bytes };
    for (const member of members) {
      const geometry = batch.addGeometry(member.geometry);
      member.instance = batch.addInstance(geometry);
      member.view.mesh.updateWorldMatrix(true, false);
      batch.setMatrixAt(member.instance, member.view.mesh.matrixWorld);
      batch.members.push(member);
    }
    batch.sync();
    return batch;
  }
  /** once: three's dispose empties its textures, and a scene owner may dispose the batch before the ring does */
  retire(): void {
    if (this.retired) return;
    this.retired = true;
    this.removeFromParent(); this.dispose();
    const material: unknown = this.material;
    if (isMaterial(material)) material.dispose();
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

/** The far ring's batches, one per program, under `parent` (the scene). */
export class FarBatches {
  private readonly groups = new Map<string, { look: FarLookRuntime; positionalMask: boolean; members: Member[]; batch: FarBatch | null; data: THREE.DataTexture | null; bytes: Uint8Array; rows: number }>();
  constructor(private readonly parent: THREE.Object3D) {}

  /** Draw `view` in its group's batch, if it can be (a far ring proxy with a recorded program state); returns whether it
   *  joined. Its own mesh stops drawing; its dispose leaves the batch. */
  adopt(view: FarProxyView, look: FarLookRuntime, positionalMask: boolean): boolean {
    const material: unknown = view.mesh.material, geometry = view.mesh.geometry;
    if (!isMaterial(material) || farState(material) === null || geometry.getAttribute('position') === undefined) return false;
    const signature = Object.keys(geometry.attributes).sort().map(name => `${name}:${String(geometry.getAttribute(name).itemSize)}`).join(',');
    const key = `${look.family}|${positionalMask ? 'position' : 'region'}|${signature}|${geometry.index === null ? 'flat' : 'indexed'}`;
    let group = this.groups.get(key);
    if (group === undefined) { group = { look, positionalMask, members: [], batch: null, data: null, bytes: EMPTY, rows: 0 }; this.groups.set(key, group); }
    const member: Member = { view, material, geometry, instance: -1 };
    group.members.push(member);
    view.mesh.layers.disableAll();
    const dispose = view.dispose, owner = group;
    view.dispose = () => {
      const at = owner.members.indexOf(member);
      if (at !== -1) { owner.members.splice(at, 1); this.rebuild(key); }
      dispose();
    };
    this.rebuild(key);
    return true;
  }

  private rebuild(key: string): void {
    const group = this.groups.get(key);
    if (group === undefined) return;
    if (group.batch !== null) { group.batch.retire(); group.batch = null; }
    if (group.members.length === 0) { group.data?.dispose(); group.data = null; this.groups.delete(key); return; }
    if (group.data === null || group.rows < group.members.length) {
      group.data?.dispose();
      const rows = Math.max(8, 2 ** Math.ceil(Math.log2(group.members.length)));
      const bytes = ownedArray(Uint8Array, TEXELS * rows * 4, { owner: 'grid/far-batch', asset: 'far-flags', kind: 'scratch' });
      const data = new THREE.DataTexture(bytes, TEXELS, rows, THREE.RGBAFormat, THREE.UnsignedByteType);
      data.magFilter = THREE.NearestFilter; data.minFilter = THREE.NearestFilter; data.generateMipmaps = false; data.needsUpdate = true;
      group.data = data; group.bytes = bytes; group.rows = rows;
    }
    const material = batchMaterial(group.look, group.positionalMask, group.data);
    const batch = FarBatch.of(group.members, group.data, group.bytes, material);
    this.parent.add(batch); batch.updateMatrixWorld(true);
    group.batch = batch;
  }

  /** the drawn batches (tests and the census) */
  batches(): readonly FarBatch[] { return [...this.groups.values()].flatMap(group => group.batch === null ? [] : [group.batch]); }

  dispose(): void {
    for (const group of this.groups.values()) { group.batch?.retire(); group.data?.dispose(); }
    this.groups.clear();
  }
}
