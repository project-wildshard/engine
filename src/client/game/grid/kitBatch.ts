import * as THREE from 'three';
import type { Scope } from '@wildshard/engine/app/scope';
import { ChangedBatchedMesh } from '@wildshard/engine/render/changedTextureUploads';
import { TIER } from '@wildshard/engine/core/tier';
import { graphicsMode } from '@wildshard/engine/core/graphicsMode';
import { jsonSlot } from '@wildshard/engine/saves/slots';
import { isGpuOnlyAttribute } from '@wildshard/engine/core/gpuOnly';
import { BATCHED_VIEW, MERGED_VIEW } from '@wildshard/engine/core/shadowLayer';
import { ownedArray } from '@wildshard/engine/core/ownedBuffer';
import { skipEmptyBatches } from '@wildshard/engine/render/drawGuards';
import { retainBatchFarLod } from '@wildshard/engine/render/farLod';
import { copyBatchIndex } from '@wildshard/engine/render/memorySaver';
import { diagnosticNow } from '@wildshard/engine/core/clock';
import { programFoldOn } from '@wildshard/engine/render/programFold';
import { hasShaderPatch } from '@wildshard/engine/render/shaderPatches';
import { mergeableMaterial, readsNoNormals, sharedHook } from './staticViewMerge';
import { FarBatch } from './farBatch';

/**
 * DF10 (mini-df10e): the level's plain meshes drawn as one multi-draw batch per material. After the static merge, the
 * phone-Low route still drew 6 to 9 `driftwood-kit` meshes (the hibiscus and palm slabs, the lookout, the trader's parts),
 * 5 to 8 `driftwood-kit-still` ones (the hut, the cove kit, the merged props) and 4 `driftwood-kit-rock` ones, each a draw:
 * most give their CPU copies up at upload (`gpuOnlyAttributes`), draw a slab's range or move, so the merge refuses them.
 *
 * Under the loading card (`primeKitBatches`, before the shaders step, so the batched programs link and upload there),
 * every plain mesh of an opaque material another such mesh draws joins that material's batch: its vertices are copied
 * once (a geometry with no index draws through an identity one; a custom channel a member lacks reads 0, as GL reads a
 * missing attribute) and the mesh stops drawing (no layer). The member stays the source of its pose, visibility and draw
 * range: the batch reads them each frame. A member whose channels give their CPU copies up at upload (`gpuOnlyAttributes`)
 * releases them now, as its upload would have (it never uploads); the batch's copy goes as any drawn geometry's does
 * (memorySaver). The batch is built once: a member whose geometry, material or vertices change leaves it for good (it
 * draws itself again; one whose copies went is hidden).
 * Plain: three's own Mesh, on layer 0 only, frustum culled, no morphs or groups, not a merge member; a render hook only of
 * the shared kind (it reads nothing of its mesh), run once per batch draw.
 */
export const KIT_BATCH_SLOT = 'debug.kitBatch';
const BAKED_TILE_MEMBER = 'bakedTileBatchMember';
const bakedTileSlot = jsonSlot('debug.bakedTileBatch', 'device');
function bakedTileBatchOn(): boolean {
  try { return bakedTileSlot.read() !== false; } catch { return true; }
}
const kitBatchSlot = jsonSlot(KIT_BATCH_SLOT, 'device');
/** DF10 defaults the kit batches on for phone Low. A saved boolean wins. */
export function kitBatch(saved: unknown): boolean { return saved !== false; }
/** The kit batches only at phone Low. */
export function kitBatchOn(): boolean {
  let saved: unknown = null;
  try { saved = kitBatchSlot.read(); } catch { /* storage blocked: the default */ }
  let low = false;
  try { low = graphicsMode() === 'low'; } catch { /* no settings: not Low */ }
  return TIER === 'phone' && low && kitBatch(saved);
}

/** the patches a cell's scope gives its materials and takes back as the cell leaves (render/regionLook.ts) */
const CELL_PATCHES: readonly string[] = ['region.look'];

const DEFAULT_RENDER_HOOK: unknown = Reflect.get(THREE.Mesh.prototype, 'onBeforeRender'), DEFAULT_AFTER_HOOK: unknown = Reflect.get(THREE.Mesh.prototype, 'onAfterRender');
/** the channels three's program keys on (presence or size): never filled for a member that lacks them */
const KEYED: ReadonlySet<string> = new Set(['position', 'normal', 'tangent', 'uv', 'uv1', 'uv2', 'uv3', 'color']);
/** a batch this large (vertices) is split: one draw still, but its arrays must stay a sane size */
export const MAX_BATCH_VERTICES = 1_048_576;

type Attribute = THREE.BufferAttribute;
/** a batch channel's storage: the members' own where they agree, else 32-bit floats (three reads every one as floats) */
interface Format {
  readonly itemSize: number;
  readonly normalized: boolean;
  readonly Typed: { new (length: number): THREE.TypedArray; readonly BYTES_PER_ELEMENT: number };
}
const formatOf = (a: Attribute): Format => ({ itemSize: a.itemSize, normalized: a.normalized, Typed: a.array.constructor as Format['Typed'] });
const sameFormat = (a: Format, b: Format): boolean => a.itemSize === b.itemSize && a.normalized === b.normalized && a.Typed === b.Typed;
/** `a` in `format`: itself, or its values (denormalized) as floats */
function inFormat(a: Attribute, format: Format): Attribute {
  if (sameFormat(formatOf(a), format)) return a;
  const out = new THREE.BufferAttribute(new format.Typed(a.count * a.itemSize), a.itemSize, format.normalized);
  for (let i = 0; i < a.count; i++) for (let c = 0; c < a.itemSize; c++) out.setComponent(i, c, a.getComponent(i, c));
  return out;
}

/** The baked GLB pads quantized positions to a four-component stride. Copy just the channels the batch reads. */
export function prepareBakedTileBatch(mesh: THREE.Mesh): void {
  for (const [name, attribute] of Object.entries(mesh.geometry.attributes)) {
    if (!(attribute instanceof THREE.InterleavedBufferAttribute)) continue;
    const { array, stride } = attribute.data, { count, itemSize, normalized, offset } = attribute;
    const Typed = array.constructor as Format['Typed'];
    const values = ownedArray(Typed, count * itemSize, { owner: 'game/kit-batch', asset: 'baked-tile-channel', kind: 'geometry-cpu' });
    for (let row = 0; row < count; row++) {
      for (let i = 0; i < itemSize; i++) values[row * itemSize + i] = array[row * stride + offset + i] ?? 0;
    }
    mesh.geometry.setAttribute(name, new THREE.BufferAttribute(values, itemSize, normalized).setUsage(attribute.data.usage));
  }
  mesh.userData[BAKED_TILE_MEMBER] = true;
}

/** Whether `object` is a plain mesh the batch may draw, with every channel's CPU copy still whole. */
export function batchableMesh(object: THREE.Object3D, includeBakedTiles = false): object is THREE.Mesh {
  if (Object.getPrototypeOf(object) !== THREE.Mesh.prototype) return false;
  const mesh = object as THREE.Mesh, geometry = mesh.geometry;
  if (!mesh.visible || mesh.layers.mask !== 1 || !mesh.frustumCulled || mesh.userData[MERGED_VIEW] === true) return false;
  if ((Reflect.get(mesh, 'onBeforeRender') !== DEFAULT_RENDER_HOOK && sharedHook(mesh) === undefined) || Reflect.get(mesh, 'onAfterRender') !== DEFAULT_AFTER_HOOK) return false;
  if (Object.keys(geometry.morphAttributes).length > 0 || geometry.groups.length > 0) return false;
  const position = geometry.getAttribute('position');
  if (!(position instanceof THREE.BufferAttribute) || position.count === 0) return false;
  for (const attribute of Object.values(geometry.attributes)) if (!(attribute instanceof THREE.BufferAttribute) || attribute.array.length < attribute.count * attribute.itemSize) return false;
  const index = geometry.index;
  if (index !== null && index.array.length < index.count) return false;
  if (includeBakedTiles && mesh.userData[BAKED_TILE_MEMBER] === true && mesh.material instanceof THREE.Material) {
    const material = mesh.material;
    return material.visible && !material.transparent && material.userData['sceneCard'] !== true
      && material.userData['sceneAlpha'] !== true && !Object.values(geometry.attributes).some(isGpuOnlyAttribute);
  }
  return mergeableMaterial(mesh.material) !== null;
}

interface Member {
  readonly mesh: THREE.Mesh; readonly geometry: THREE.BufferGeometry; readonly material: THREE.Material;
  /** each channel's (and the index's) change count when copied */
  readonly versions: number[]; readonly attributes: (Attribute | null)[];
  /** its channels' CPU copies went with the copy: it cannot draw itself again */
  readonly released: boolean; readonly mask: number; readonly drawn: number; readonly farLod: ReturnType<typeof retainBatchFarLod>;
  instance: number; geometryId: number; gone: boolean; at: Float64Array; spaceRevision: number;
  /** why it left (the census) */
  left?: string;
}

/** whether `object` and every ancestor are visible, up to a scene */
function shown(object: THREE.Object3D): boolean {
  let node: THREE.Object3D | null = object;
  for (; node !== null; node = node.parent) { if (!node.visible) return false; if (node.parent === null) return Reflect.get(node, 'isScene') === true; }
  return false;
}

/** One material's members as one batch: sealed once built; synced from its members every draw. */
export class KitBatch extends ChangedBatchedMesh {
  readonly members: Member[] = [];
  private hooks: (() => void)[] = [];
  private retired = false;
  private space: THREE.Object3D | null = null;
  private readonly spaceAt = new Float64Array(16);
  private spaceRevision = 0;
  private readonly worldToSpace = new THREE.Matrix4();
  private readonly memberInSpace = new THREE.Matrix4();
  /**
   * DF8 (mini-df8c, `debug.programFold`): the cell patches its material ran when the batch was built. A cell's look patch
   * (`region.look`) leaves with the cell's scope, while the batch is the level's: as Driftwood
   * left (~183 s on the route) its members still showed for a frame mid-teardown, and the batch, which no cell guard
   * refuses, drew them with the patches gone, linking a no-look program at draw. Once one has left, the batch draws
   * nothing again (its members go with their cell). Null: the slot is off.
   */
  private patches: readonly string[] | null = null;
  private stale = false;
  /** a batch of `meshes` (one material, one keyed layout), each channel stored as `formats` has it (a custom channel a
   *  member lacks is filled with zeros) */
  static of(meshes: readonly THREE.Mesh[], material: THREE.Material, formats: ReadonlyMap<string, Format>, cellPatches: boolean, space: THREE.Object3D): KitBatch {
    const geometries = meshes.map(mesh => mesh.geometry);
    const vertices = geometries.reduce((sum, g) => sum + g.getAttribute('position').count, 0);
    const indices = geometries.reduce((sum, g) => sum + (g.index?.count ?? g.getAttribute('position').count), 0);
    // three's constructor signature, so its clone (`new this.constructor(...)`) still makes a batch
    const batch = new KitBatch(meshes.length, vertices, indices, material);
    batch.name = `kit-batch:${material.name}`; batch.frustumCulled = false; batch.perObjectFrustumCulled = true; batch.sortObjects = false;
    batch.matrixAutoUpdate = false;
    batch.space = space; batch.refreshSpace();
    const hooks = new Set<() => void>();
    for (const mesh of meshes) {
      const farLod = mesh.userData[BAKED_TILE_MEMBER] === true ? null : retainBatchFarLod(mesh, batch);
      const geometry = mesh.geometry, position = geometry.getAttribute('position');
      // the copy: the member's own channels, a filled one for each custom channel it lacks, an identity index if it has none
      const copy = new THREE.BufferGeometry();
      for (const [name, format] of formats) {
        const own = geometry.getAttribute(name) as Attribute | undefined;
        const data = own === undefined
          ? new THREE.BufferAttribute(ownedArray(format.Typed, position.count * format.itemSize,
            { owner: 'game/kit-batch', asset: `missing-${name}`, kind: 'geometry-cpu' }), format.itemSize, format.normalized)
          : inFormat(own, format);
        copy.setAttribute(name, data);
      }
      if (geometry.index !== null) copy.setIndex(geometry.index);
      else { const identity = ownedArray(Uint32Array, position.count, { owner: 'game/kit-batch', asset: 'identity-index', kind: 'geometry-cpu' }); for (let i = 0; i < identity.length; i++) identity[i] = i; copy.setIndex(new THREE.BufferAttribute(identity, 1)); }
      if (geometry.boundingBox === null) geometry.computeBoundingBox();
      if (geometry.boundingSphere === null) geometry.computeBoundingSphere();
      copy.boundingBox = geometry.boundingBox; copy.boundingSphere = geometry.boundingSphere;
      const geometryId = batch.addGeometry(copy);
      // bounds now, from the source: the batch's own arrays go at upload
      batch.getBoundingBoxAt(geometryId, new THREE.Box3()); batch.getBoundingSphereAt(geometryId, new THREE.Sphere());
      const instance = batch.addInstance(geometryId);
      mesh.updateWorldMatrix(true, false);
      batch.placeMember(instance, mesh.matrixWorld);
      if (mesh.castShadow) batch.castShadow = true;
      if (mesh.receiveShadow) batch.receiveShadow = true;
      const hook = sharedHook(mesh);
      if (hook !== undefined) hooks.add(hook as unknown as () => void);
      const attributes: (Attribute | null)[] = [...Object.values(geometry.attributes).map(a => a as Attribute), geometry.index];
      const released = attributes.some(a => a !== null && isGpuOnlyAttribute(a));
      batch.members.push({ mesh, geometry, material, attributes, versions: attributes.map(a => a?.version ?? 0), released, mask: mesh.layers.mask,
        drawn: geometry.index?.count ?? position.count, farLod, instance, geometryId, gone: false, at: Float64Array.from(mesh.matrixWorld.elements),
        spaceRevision: batch.spaceRevision });
      // a channel that gives its CPU copy up at upload goes now: the member never uploads, and the batch holds its copy
      for (const attribute of attributes) if (attribute !== null && isGpuOnlyAttribute(attribute)) attribute.onUploadCallback();
      mesh.layers.disableAll(); mesh.userData[BATCHED_VIEW] = true;
    }
    batch.hooks = [...hooks];
    batch.patches = cellPatches ? CELL_PATCHES.filter(id => hasShaderPatch(material, id)) : null;
    // the copies follow their members' rewritten triangles: the batch's index stays on the CPU (the Memory saver keeps a
    // dynamic channel's copy)
    batch.geometry.index?.setUsage(THREE.DynamicDrawUsage);
    batch.sync();
    return batch;
  }
  private disposed = false;
  /** once: a scene owner may dispose the batch before its level does, and three's second dispose throws */
  override dispose(): void { if (this.disposed) return; this.disposed = true; super.dispose(); }
  /** once: three's dispose empties its arrays; a member that can draw itself again does */
  retire(): void {
    if (this.retired) return;
    this.retired = true;
    for (const member of this.members) {
      member.farLod?.release();
      Reflect.deleteProperty(member.mesh.userData, BATCHED_VIEW);
      if (!member.gone && !member.released) member.mesh.layers.mask = member.mask;
    }
    this.removeFromParent(); this.dispose();
  }
  /** Batch matrices are relative to the cell that owns the draw. Recompute its inverse only when that frame moves. */
  private refreshSpace(): void {
    const matrix = this.space?.matrixWorld;
    if (matrix === undefined) return;
    for (let i = 0; i < 16; i++) {
      if (matrix.elements[i] === this.spaceAt[i]) continue;
      this.spaceAt.set(matrix.elements);
      this.worldToSpace.copy(matrix).invert();
      this.spaceRevision++;
      return;
    }
  }
  private placeMember(instance: number, world: THREE.Matrix4): void {
    this.setMatrixAt(instance, this.memberInSpace.multiplyMatrices(this.worldToSpace, world));
  }
  /** each copy's pose, visibility and range, as its member has them now; a changed member leaves */
  sync(): void {
    if (this.retired || this.stale) return;
    const patches = this.patches, material = this.members[0]?.material;
    if (patches !== null && material !== undefined && !patches.every(id => hasShaderPatch(material, id))) {
      this.stale = true;
      for (const member of this.members) if (!member.gone && this.getVisibleAt(member.instance)) this.setVisibleAt(member.instance, false);
      return;
    }
    this.refreshSpace();
    const info: unknown = Reflect.get(this, '_geometryInfo');
    for (const member of this.members) {
      if (member.gone) continue;
      const mesh = member.mesh;
      // a slab or cull writer rewrites a member's triangles in place (its own index, never uploaded, takes the write on the
      // CPU): the copy follows, into the batch's index (kept on the CPU for this)
      const index = member.geometry.index, last = member.attributes.length - 1;
      if (index !== null && index === member.attributes[last] && index.version !== member.versions[last]) { this.copyIndex(member, index); member.versions[last] = index.version; }
      const changed = mesh.geometry !== member.geometry || mesh.material !== member.material || member.geometry.index !== member.attributes[last]
        || member.attributes.some((a, i) => (a?.version ?? 0) !== member.versions[i]);
      if (changed) {
        member.gone = true; Reflect.deleteProperty(mesh.userData, BATCHED_VIEW);
        member.farLod?.release();
        member.left = mesh.geometry !== member.geometry ? 'geometry' : mesh.material !== member.material ? 'material' : `vertices:${String(member.attributes.findIndex((a, i) => (a?.version ?? 0) !== member.versions[i]))}`;
        this.setVisibleAt(member.instance, false);
        // its own copies are whole (or it has a new geometry): it draws itself again
        if (!member.released || mesh.geometry !== member.geometry) mesh.layers.mask = member.mask;
        continue;
      }
      const visible = shown(mesh);
      if (this.getVisibleAt(member.instance) !== visible) this.setVisibleAt(member.instance, visible);
      if (!visible) continue;
      const e = mesh.matrixWorld.elements;
      let moved = member.spaceRevision !== this.spaceRevision;
      for (let i = 0; !moved && i < 16; i++) if (e[i] !== member.at[i]) moved = true;
      if (moved) { member.at.set(e); member.spaceRevision = this.spaceRevision; this.placeMember(member.instance, mesh.matrixWorld); }
      // a slab's range: the copy draws the same span of its own indices
      const row: unknown = Array.isArray(info) ? info[member.geometryId] : undefined;
      if (typeof row === 'object' && row !== null) {
        const range = member.geometry.drawRange, indexStart = Number(Reflect.get(row, 'indexStart'));
        const from = Math.min(member.drawn, Math.max(0, range.start)), count = Math.max(0, Math.min(range.count, member.drawn - from));
        Reflect.set(row, 'start', indexStart + from); Reflect.set(row, 'count', count);
      }
    }
  }
  /** `member`'s triangles, as its own index holds them now, into its span of the batch's index */
  private copyIndex(member: Member, index: Attribute): void {
    const info: unknown = Reflect.get(this, '_geometryInfo'), row: unknown = Array.isArray(info) ? info[member.geometryId] : undefined, target = this.geometry.index;
    if (typeof row !== 'object' || row === null || target === null) return;
    const indexStart = Number(Reflect.get(row, 'indexStart')), vertexStart = Number(Reflect.get(row, 'vertexStart')), count = Math.min(index.count, member.drawn);
    copyBatchIndex(target, index, indexStart, vertexStart, count);
  }
  override onBeforeRender(...args: Parameters<ChangedBatchedMesh['onBeforeRender']>): void {
    for (const hook of this.hooks) hook();
    for (const member of this.members) if (!member.gone) member.farLod?.update(args[0], args[2]);
    this.sync();
    super.onBeforeRender(...args);
  }
}

/** Gather `root`'s batchable meshes by material and layout; each set of two or more becomes a batch under `root`. */
export function buildKitBatches(root: THREE.Object3D, cellPatches = false, includeBakedTiles = false): KitBatch[] {
  const sets = new Map<string, { material: THREE.Material; keyed: string; meshes: THREE.Mesh[] }>();
  root.updateWorldMatrix(true, true);
  root.traverse((object) => {
    if (includeBakedTiles && object.userData[BAKED_TILE_MEMBER] !== true) return;
    if (!batchableMesh(object, includeBakedTiles)) return;
    const material = object.material as THREE.Material, geometry = object.geometry;
    // Flat kit props shade by derivatives. A missing normal doesn't split their layout; keep every normal a member has.
    const flat = readsNoNormals(material);
    const keyed = Object.entries(geometry.attributes).filter(([name]) => KEYED.has(name) && (name !== 'normal' || !flat))
      .map(([name, a]) => `${name}:${String(a.itemSize)}`).sort().join('|');
    const key = `${material.uuid}|${keyed}`;
    let set = sets.get(key);
    if (set === undefined) { set = { material, keyed, meshes: [] }; sets.set(key, set); }
    set.meshes.push(object);
  });
  const batches: KitBatch[] = [];
  for (const { material, keyed, meshes } of sets.values()) {
    // each channel's storage: the members' own where they agree, else floats; a custom channel's size must agree (a
    // member whose differs stays out), and a vec4 one (it reads (0,0,0,1) when missing) every member must have
    const formats = new Map<string, Format>(), members: THREE.Mesh[] = [];
    let vertices = 0;
    for (const mesh of meshes) {
      const own = Object.entries(mesh.geometry.attributes) as [string, Attribute][];
      if (own.some(([name, a]) => { const like = formats.get(name); return like !== undefined && like.itemSize !== a.itemSize; })) continue;
      const count = mesh.geometry.getAttribute('position').count;
      if (vertices + count > MAX_BATCH_VERTICES) continue;
      vertices += count;
      for (const [name, a] of own) {
        const like = formats.get(name), format = formatOf(a);
        formats.set(name, like === undefined || sameFormat(like, format) ? format : { itemSize: a.itemSize, normalized: false, Typed: Float32Array });
      }
      members.push(mesh);
    }
    const kept = members.filter(mesh => [...formats].every(([name, format]) => format.itemSize <= 3 || mesh.geometry.hasAttribute(name)));
    if (kept.length < 2) continue;
    const batch = KitBatch.of(kept, material, formats, cellPatches, root);
    batch.userData['layout'] = keyed;
    root.add(batch); batch.updateMatrixWorld(true);
    batches.push(batch);
  }
  return batches;
}

/** The baked set's index ranges are installed. Batch before world assembly gives the source arrays up to the GPU. */
export function primeBakedTileBatches(root: THREE.Object3D, tiles: readonly THREE.Mesh[], scope: Scope, multiDraw: boolean): void {
  if (!multiDraw || !kitBatchOn() || !bakedTileBatchOn() || scope.disposed || scope.disposing) return;
  for (const tile of tiles) prepareBakedTileBatch(tile);
  const batches = buildKitBatches(root, false, true);
  if (batches.length > 0) skipEmptyBatches(true);
  scope.onDispose(() => { for (const batch of batches) batch.retire(); });
}

/**
 * Batch `scene`'s kit now, once, while `scope` lives: when the slot is on at phone Low and the renderer multi-draws. The
 * boot calls it before the shaders step, while every channel's CPU copy is whole (the first frames upload and release
 * them), so the batched programs link and upload under the card. A road admission calls it on its own view
 * after the cell look is ready, before the final warm draw. Returns the census the bench reads.
 */
export function primeKitBatches(scene: THREE.Object3D, scope: Scope, multiDraw: boolean, enabled: () => boolean = kitBatchOn, cellPatches: () => boolean = programFoldOn): { batches: number; members: number } {
  if (!multiDraw || !enabled() || scope.disposed || scope.disposing || scene.userData['kitBatch'] !== undefined) return { batches: 0, members: 0 };
  let batches: KitBatch[];
  try { batches = buildKitBatches(scene, cellPatches()); }
  catch (error: unknown) { console.warn('[kit-batch] not built', error instanceof Error ? error.stack : error); return { batches: 0, members: 0 }; }
  // DF10 (mini-dfload): a batch whose members all left (their cell retired at the road crossing) draws nothing, so it never
  // looks its program up again: on the iPhone 13 the empty kit batches relinked their three materials as the player
  // crossed the road and came back (1.1 to 1.4 s frames). A batch with no copy to draw draws no pixel either way.
  if (batches.length > 0) skipEmptyBatches(true);
  scope.onDispose(() => { for (const batch of batches) batch.retire(); Reflect.deleteProperty(scene.userData, 'kitBatch'); });
  scene.userData['kitBatch'] = (): { batches: number; members: number; gone: number; names: string[] } => ({ batches: batches.length,
    members: batches.reduce((sum, batch) => sum + batch.members.length, 0), gone: batches.reduce((sum, batch) => sum + batch.members.filter(m => m.gone).length, 0),
    names: batches.map(batch => `${batch.name} [${String(batch.userData['layout'])}] x${String(batch.members.length)}: ${batch.members.map(m => `${m.mesh.name !== '' ? m.mesh.name : (m.mesh.parent?.name ?? '?')}${m.left === undefined ? '' : ` (left: ${m.left})`}`).join(', ')}`) });
  return { batches: batches.length, members: batches.reduce((sum, batch) => sum + batch.members.length, 0) };
}

/** DF10 (mini-dfload): the page's batches, the kit's and the far ring's (not a ring stand-in, which leaves at once). */
export function sceneBatches(scene: THREE.Object3D): THREE.Object3D[] {
  const batches: THREE.Object3D[] = [];
  scene.traverse((object) => { if (object instanceof KitBatch || (object instanceof FarBatch && object.name === 'far-batch')) batches.push(object); });
  return batches;
}

/**
 * DF10 (mini-dfload): link every batch's programs under the loading card, its road (exterior) variants with them (`warm`:
 * Game.warmRootsNow). A batch hangs on the page scene, outside the entered roots whose warm-ups link those variants, so on
 * the iPhone 13 each linked in a draw after control: the far batch's and the kit's three materials, 1.1 to 1.4 s frames.
 * Returns how many batches it linked.
 */
export async function primeBatchPrograms(scene: THREE.Object3D, warm: (roots: readonly THREE.Object3D[]) => Promise<void>): Promise<number> {
  const batches = sceneBatches(scene), at = diagnosticNow();
  if (batches.length > 0) await warm(batches);
  // the route bench reads it (`__wsBatchPrograms`)
  Reflect.set(globalThis, '__wsBatchPrograms', { batches: batches.length, ms: Math.round(diagnosticNow() - at) });
  return batches.length;
}
