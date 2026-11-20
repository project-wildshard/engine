/**
 * meta DRIFTWOOD-FPS DF10 (mini-driftwood df10): a region's still set pieces drawn as one view mesh per material. Driftwood's
 * route spent 9 to 11 of its ~95 phone-Low draws on `driftwood-kit-still` meshes alone (piers, hut, decks, shrine, plaques,
 * boat), each a mesh of its own, and 3 to 7 on its swaying `driftwood-kit` pieces and rocks.
 *
 * With the device slot `debug.staticMerge` on (unset: STATIC_MERGE_PHONE_LOW at phone Low), a region view sweeps its root
 * every SWEEP_STEPS fixed steps. A plain mesh that has held one pose relative to the root for a whole sweep, on a material
 * at least one other such mesh draws, joins that material's prop merge under the root (`mergeView`: 250 m blocks by vertex
 * layout; the member keeps drawing into the shadow maps and stays the World Explorer's to pick). Plain: not instanced,
 * skinned or batched; no per-object render hook, morphs, groups or draw range; an opaque material the merge may move into
 * root space (a built-in material, or a graph whose program reads no model-space position or object origin).
 *
 * A member that moves, hides (itself or an ancestor below the root), changes material or leaves the root leaves its merge
 * at the next check and draws on its own again for good. Leaving phone Low or the region ends every merge.
 */
import { Matrix4, Mesh, ShaderMaterial, type Material, type Object3D } from 'three';
import type { Scope } from '@wildshard/engine/app/scope';
import { jsonSlot } from '@wildshard/engine/saves/slots';
import { TIER } from '@wildshard/engine/core/tier';
import { graphicsMode, PIXELS_EVENT } from '@wildshard/engine/core/graphicsMode';
import { MERGED_COPY, MERGED_VIEW } from '@wildshard/engine/core/shadowLayer';
import { mergeView } from '../shardfile/groundMerge';

export const STATIC_MERGE_SLOT = 'debug.staticMerge';
export const STATIC_MERGE_DEFAULT = false;
/** Unset at phone Low: off until a cooled phone pair and the look board decide. */
export const STATIC_MERGE_PHONE_LOW = false;
/** fixed steps between sweeps (and member checks) */
export const SWEEP_STEPS = 60;
/** a mesh this large (vertices) keeps its own draw: its merged copy would double too much vertex memory */
export const MAX_MEMBER_VERTICES = 131_072;

/** The slot's value: a boolean wins; unset, STATIC_MERGE_PHONE_LOW at phone Low, else STATIC_MERGE_DEFAULT. */
export function staticMerge(saved: unknown, phoneLow = false): boolean {
  if (typeof saved === 'boolean') return saved;
  return phoneLow ? STATIC_MERGE_PHONE_LOW : STATIC_MERGE_DEFAULT;
}
function staticMergeOn(): boolean {
  let saved: unknown = null;
  try { saved = jsonSlot(STATIC_MERGE_SLOT, 'device').read(); } catch { /* storage blocked: the default */ }
  let low = false;
  try { low = graphicsMode() === 'low'; } catch { /* no settings: not Low */ }
  return TIER === 'phone' && low && staticMerge(saved, true);
}

const DEFAULT_RENDER_HOOK: unknown = Reflect.get(Mesh.prototype, 'onBeforeRender'), DEFAULT_AFTER_HOOK: unknown = Reflect.get(Mesh.prototype, 'onAfterRender');
/** How a material may draw in root space: 'any' pose; only 'translation' (its member's axes are the root's: a graph that
 *  moves its vertices in its mesh's own axes); or null. One opaque, visible material: a built-in one, or a graph that reads
 *  nothing of its mesh's own space (object origin, local position or normal). */
export function mergeableMaterial(material: unknown): 'any' | 'translation' | null {
  if (Array.isArray(material) || typeof material !== 'object' || material === null) return null;
  const m = material as Material;
  if (!m.visible || m.transparent || m.userData['sceneAlpha'] === true || m.userData['sceneCard'] === true) return null;
  if (Reflect.get(m, 'isGraphShaderMaterial') === true) {
    if (Reflect.get(m, 'readsModelSpace') !== false) return null;
    return Reflect.get(m, 'movesVertices') === false ? 'any' : 'translation';
  }
  return m instanceof ShaderMaterial ? null : 'any';
}
/** A plain mesh (own prototype Mesh) with a mergeable material and a geometry the merge copies whole. */
export function mergeableMesh(object: Object3D): object is Mesh {
  if (Object.getPrototypeOf(object) !== Mesh.prototype) return false;
  const mesh = object as Mesh, geometry = mesh.geometry;
  if (!mesh.visible || mesh.layers.mask !== 1 || mesh.name === MERGED_COPY || mesh.userData[MERGED_VIEW] === true || !mesh.frustumCulled) return false;
  if ((Reflect.get(mesh, 'onBeforeRender') !== DEFAULT_RENDER_HOOK && sharedHook(mesh) === undefined) || Reflect.get(mesh, 'onAfterRender') !== DEFAULT_AFTER_HOOK) return false;
  const position = geometry.getAttribute('position');
  if (position === undefined || position.count > MAX_MEMBER_VERTICES) return false;
  const drawn = geometry.index?.count ?? position.count;
  if (Object.keys(geometry.morphAttributes).length > 0 || geometry.groups.length > 0 || geometry.drawRange.start !== 0 || geometry.drawRange.count < drawn) return false;
  return mergeableMaterial(mesh.material) !== null;
}
/** A render hook the merged mesh may share: an arrow function (no `this`) that takes no arguments, so it reads nothing of
 *  the mesh it draws (bakedTiles' toon-day follow sets its look's uniforms); undefined for none or any other hook. */
export function sharedHook(mesh: Mesh): Mesh['onBeforeRender'] | undefined {
  const hook: unknown = Reflect.get(mesh, 'onBeforeRender');
  return typeof hook === 'function' && hook !== DEFAULT_RENDER_HOOK && hook.length === 0 && !Object.hasOwn(hook, 'prototype') ? hook as Mesh['onBeforeRender'] : undefined;
}
/** A flat-shaded material (three's own flag, or a graph's FLAT_SHADED define) none of whose graph nodes read the normal:
 *  it shades by derivatives, so its merge may leave the normals out (and members with and without them draw together). */
export function readsNoNormals(material: Material): boolean {
  const defines: unknown = Reflect.get(material, 'defines');
  const flat = Reflect.get(material, 'flatShading') === true || (typeof defines === 'object' && defines !== null && 'FLAT_SHADED' in defines);
  return flat && (Reflect.get(material, 'isGraphShaderMaterial') !== true || Reflect.get(material, 'readsNormals') === false);
}
/** a root-space matrix with no rotation or scale (16 elements, column-major) */
function translationOnly(m: Float64Array): boolean {
  const near = (a: number | undefined, b: number): boolean => Math.abs((a ?? 0) - b) < 1e-6;
  return near(m[0], 1) && near(m[1], 0) && near(m[2], 0) && near(m[4], 0) && near(m[5], 1) && near(m[6], 0) && near(m[8], 0) && near(m[9], 0) && near(m[10], 1);
}

interface Member { readonly mesh: Mesh; readonly material: Material; readonly at: Float64Array; readonly scope: Scope; readonly mask: number }
/** the mesh's matrix in root space, or null when it has left the root or something below the root hides it */
function rootPose(mesh: Mesh, root: Object3D, inverse: Matrix4, scratch: Matrix4, out: Float64Array): Float64Array | null {
  for (let node: Object3D | null = mesh.parent; node !== root; node = node.parent) if (node === null || !node.visible) return null;
  mesh.updateWorldMatrix(true, false);
  scratch.multiplyMatrices(inverse, mesh.matrixWorld); out.set(scratch.elements);
  return out;
}
function samePose(a: Float64Array, b: Float64Array): boolean {
  for (let i = 0; i < 16; i++) if (Math.abs((a[i] ?? 0) - (b[i] ?? 0)) > 1e-6) return false;
  return true;
}

/**
 * Sweep `root`'s still meshes into per-material view merges while `scope` lives and the slot is on at phone Low.
 * `frame` registers the view's per-fixed-step check; `enabled` is the slot's pick (tests pass their own). Returns the census
 * the bench reads.
 */
export function installStaticViewMerge(root: Object3D, scope: Scope, frame: (check: () => void) => void, enabled: () => boolean = staticMergeOn): () => { members: number; seen: number } {
  const members = new Map<Mesh, Member>(), seen = new Map<Mesh, Float64Array>(), refused = new WeakSet<Mesh>();
  const inverse = new Matrix4(), scratch = new Matrix4(), pose = new Float64Array(16);
  let live: Scope | undefined, steps = 0;
  const leave = (member: Member, refuse: boolean): void => {
    members.delete(member.mesh); if (refuse) refused.add(member.mesh);
    member.scope.dispose(); member.mesh.layers.mask = member.mask;
  };
  const end = (): void => { for (const member of Array.from(members.values())) leave(member, false); seen.clear(); live?.dispose(); live = undefined; };
  const refresh = (): void => {
    if (scope.disposed || scope.disposing) return;
    if (!enabled()) { end(); return; }
    live ??= scope.child('static-view-merge');
  };
  scope.listen(document, PIXELS_EVENT, refresh);
  scope.onDispose(end);
  refresh();
  frame(() => {
    if (live === undefined || ++steps < SWEEP_STEPS) return;
    steps = 0;
    root.updateWorldMatrix(true, false); inverse.copy(root.matrixWorld).invert();
    // members that moved, hid, changed material or left draw on their own again, for good
    for (const member of Array.from(members.values())) {
      const at = rootPose(member.mesh, root, inverse, scratch, pose);
      if (at === null || !member.mesh.visible || member.mesh.material !== member.material || !samePose(at, member.at)) leave(member, true);
    }
    // candidates: still for a whole sweep, on a material another candidate or member shares
    const candidates: Mesh[] = [], next = new Map<Mesh, Float64Array>();
    root.traverse((object) => {
      if (!mergeableMesh(object) || members.has(object) || refused.has(object)) return;
      const at = rootPose(object, root, inverse, scratch, pose); if (at === null) return;
      const prior = seen.get(object);
      if (mergeableMaterial(object.material) === 'translation' && !translationOnly(at)) return;
      next.set(object, prior !== undefined && samePose(prior, at) ? prior : Float64Array.from(at));
      if (prior !== undefined && samePose(prior, at)) candidates.push(object);
    });
    seen.clear(); for (const [mesh, at] of next) seen.set(mesh, at);
    const users = new Map<Material, number>();
    for (const member of members.values()) users.set(member.material, (users.get(member.material) ?? 0) + 1);
    for (const mesh of candidates) users.set(mesh.material as Material, (users.get(mesh.material as Material) ?? 0) + 1);
    const owner = live;
    for (const mesh of candidates) {
      const material = mesh.material as Material, at = seen.get(mesh);
      if ((users.get(material) ?? 0) < 2 || at === undefined) continue;
      const mask = mesh.layers.mask, memberScope = owner.child('static-view-merge.member');
      // the whole cell per layout (a set piece's block would draw it alone); a flat-shaded look reads no normals
      mergeView(root, mesh, material, memberScope, sharedHook(mesh), { grouping: 'region', ignore: readsNoNormals(material) ? ['normal'] : [] });
      members.set(mesh, { mesh, material, at, scope: memberScope, mask });
      seen.delete(mesh);
    }
  });
  return () => ({ members: members.size, seen: seen.size });
}
