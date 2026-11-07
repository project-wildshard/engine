/**
 * Welds (E347): a merge across several models' copies, owned by `place` (./place.ts `PlaceOptions.weld`). Site-fitted
 * buildings (Pine Hollow's homestead: its three log cabins and the mill hamlet's five buildings) hand `place` their parts
 * — geometry in the copy's frame, per material, each with its band — and the weld draws them:
 *
 *   unit 'copy'   each copy is its own unit: its parts merge into one mesh per material and band under its root, banded by
 *                 its distance; the meshes drawn at every distance are then welded ACROSS the copies into one mesh per
 *                 material (`WeldBatch`: drawn in a pass when any copy's share would be), each copy keeping a view of its
 *                 share (`WeldView`: its picking, its box, Explore's isolation) — the cabins: 1 draw per material, not 3
 *   unit 'whole'  every copy's parts merge into ONE set under the weld's root (its frame, banded by its distance + `pad`)
 *                 — the hamlet: five buildings cost about one cabin's draws
 *
 * Shadows (the log kit's, as data on the parts): a part's `depth` says how its depth reaches the shadow maps — through its
 * unit's position-only proxy for its band (`'proxy'`: one depth-only draw per band on SHADOW_LAYER, not one per material),
 * only through the near proxy (`'near'`), or its own mesh (none). A weld with `near` (the desktop tier) gives each 'copy'
 * unit one near proxy of everything it draws plus its copy's double-sided dressing (`casters`), drawn within the weld's
 * `detail` band, while the band proxies cast only past it: the same depth at every distance, one draw.
 *
 * Bands are data too: an object tagged `userData.until` (metres) is drawn only while the eye is nearer its copy (its unit,
 * + pad, for the unit's meshes), one tagged `userData.castFrom` casts only from that far (`WeldCull`, ./cull.ts): the
 * homestead's old per-building detail state machine (Cabins.update), as data.
 *
 * Copies placed instanced into a weld (`Placement.host`: the copy they stand about) are drawn by their host: one
 * InstancedMesh per part across the weld, holding the copies whose unit is within the weld's `detail` band (the props the
 * buildings set about). They cast no shadow of their own (the host's near proxy carries their depth).
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { geometryBoundsSteps } from '../world/geometryBounds';
import { SHADOW_LAYER } from '../core/shadowLayer';
import type { ColliderDesc } from '../world/registry';

/** @types/three says mergeGeometries always returns a geometry; at runtime it returns null on an attribute mismatch */
export function mergeOrNull(list: THREE.BufferGeometry[]): THREE.BufferGeometry | null {
  return mergeGeometries(list);
}

// Welding has a synchronous public contract. Exhaust the same exact bounds scan
// used by sliced placement; packed positions avoid per-coordinate accessors.
function bound(geometry: THREE.BufferGeometry, bounds: 'sphere' | 'both' = 'sphere'): void {
  const steps = geometryBoundsSteps(geometry, bounds);
  while (!steps.next().done) { /* synchronous callers finish all existing steps */ }
}

// ── depth-only casters (SHADOW_LAYER) ──

/** never drawn in a view (SHADOW_LAYER), only its depth: front-sided like the materials it stands in for */
export const shadowProxyMaterial: THREE.MeshBasicMaterial = new THREE.MeshBasicMaterial({ colorWrite: false });

/** position-only merged caster on SHADOW_LAYER (drawn into the sun's shadow maps and nowhere else); null for an empty list */
export function shadowProxy(list: THREE.BufferGeometry[]): THREE.Mesh | null {
  const g = list.length > 0 ? mergeOrNull(list) : null;
  if (g === null) return null;
  bound(g);
  const proxy = new THREE.Mesh(g, shadowProxyMaterial);
  proxy.castShadow = true; proxy.layers.set(SHADOW_LAYER);
  return proxy;
}


/** a non-indexed position-only geometry with the plain index 0 … n−1 (its position attribute shared) */
function sequentialIndex(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  const pos = geo.getAttribute('position'), idx = new Uint32Array(pos.count);
  for (let i = 0; i < idx.length; i++) idx[i] = i;
  const out = new THREE.BufferGeometry(); out.setAttribute('position', pos); out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}

// ── parts and units ──

/** Geometries of one welded copy that merge into one mesh with their unit's of the same material and band. */
export interface WeldPart {
  readonly material: THREE.Material;
  /** in the copy's frame (its root's) */
  readonly geometries: readonly THREE.BufferGeometry[];
  /** metres: drawn only while the eye is nearer its unit (+ the unit's pad); omitted = at every distance */
  readonly until?: number;
  /** parts merge when they share material, band and this key (default: none): a copy that draws one set of a material
   *  as several meshes keys them apart (a building's window groups) */
  readonly key?: string;
  /**
   * how its depth reaches the shadow maps: `'proxy'` through its unit's position-only proxy for its band (and the near
   * proxy while that draws), `'near'` only through the near proxy; omitted: its own mesh, per `castShadow`
   */
  readonly depth?: 'proxy' | 'near';
  readonly castShadow?: boolean;
  readonly receiveShadow?: boolean;
  readonly renderOrder?: number;
}

/**
 * One copy of a site-fitted model as it hands itself to a weld (`ModelDef.weld`, `place(…, { draw: 'merged', weld })`):
 * built where it stands.
 */
export interface WeldBuild {
  /** its root, posed where it stands, with what it draws on its own (a door that swings, a lantern, smoke): an object
   *  tagged `userData.until` / `castFrom` (metres) banded by the copy's distance */
  readonly root: THREE.Object3D;
  /** its parts, in the root's frame */
  readonly parts: readonly WeldPart[];
  /** depth-only casters in the root's frame (its double-sided dressing) for its near proxy */
  readonly casters?: readonly THREE.BufferGeometry[];
  /** its colliders, world space (computed where it stands) */
  readonly colliders: readonly ColliderDesc[];
  /** its world box once the weld has drawn it (VIEW IN WORLD, a tap's claim) */
  readonly box: (target: THREE.Box3) => THREE.Box3;
}

/** a unit's drawn meshes (with the part each came from, in order) and its band proxies */
export interface UnitDrawn {
  readonly meshes: readonly { readonly mesh: THREE.Mesh; readonly part: WeldPart }[];
  /** the band proxies, the always-drawn one first, then by band */
  readonly proxies: readonly { readonly mesh: THREE.Mesh; readonly until: number | undefined }[];
  /** positions of every part with a `depth`, in mesh order (a near proxy's) */
  readonly front: readonly THREE.BufferGeometry[];
}

interface Slot { readonly part: WeldPart; readonly geos: THREE.BufferGeometry[] }

/** Parts gathered for one unit, merged once: one slot per (material, band), in the order they first came. */
export class UnitParts {
  private readonly slots: Slot[] = [];
  private readonly byMat = new Map<THREE.Material, Map<string, Slot>>();
  /** add a copy's parts, moved by `frame` first when given (a 'whole' unit: the copy's frame → the unit's) */
  add(parts: readonly WeldPart[], frame?: THREE.Matrix4): void {
    for (const p of parts) {
      if (p.geometries.length === 0) continue;
      let bands = this.byMat.get(p.material);
      if (bands === undefined) { bands = new Map(); this.byMat.set(p.material, bands); }
      const k = `${p.until ?? ''}|${p.key ?? ''}`;
      let s = bands.get(k);
      if (s === undefined) { s = { part: p, geos: [] }; bands.set(k, s); this.slots.push(s); }
      for (const g of p.geometries) s.geos.push(frame ? g.applyMatrix4(frame) : g);
    }
  }

  /**
   * Merge under `root`: a mesh per (material, band) with its part's flags, then the band proxies of the `'proxy'` parts
   * (the always-drawn set first). `near`: the proxies cast only past the near band (the caller tags them).
   */
  draw(root: THREE.Object3D, near: boolean): UnitDrawn {
    const meshes: { mesh: THREE.Mesh; part: WeldPart }[] = [], front: THREE.BufferGeometry[] = [];
    const bands = new Map<number | undefined, THREE.BufferGeometry[]>();
    for (const { part, geos } of this.slots) {
      const merged = mergeOrNull(geos);
      if (merged === null) continue;
      bound(merged);
      const mesh = new THREE.Mesh(merged, part.material);
      mesh.receiveShadow = part.receiveShadow ?? false;
      mesh.castShadow = part.castShadow ?? false;
      if (part.renderOrder !== undefined) mesh.renderOrder = part.renderOrder;
      root.add(mesh);
      meshes.push({ mesh, part });
      if (part.depth === undefined) continue;
      const pos = new THREE.BufferGeometry(); pos.setAttribute('position', merged.getAttribute('position'));
      front.push(pos);
      if (part.depth !== 'proxy') continue;
      const list = bands.get(part.until);
      if (list === undefined) bands.set(part.until, [pos]); else list.push(pos);
    }
    this.slots.length = 0; this.byMat.clear();
    // the always-drawn set first, then the bands nearest first (Array#sort puts `undefined` last whatever its comparator says)
    const order: (number | undefined)[] = [...(bands.has(undefined) ? [undefined] : []), ...[...bands.keys()].filter((b): b is number => b !== undefined).sort((a, b) => a - b)];
    const proxies: { mesh: THREE.Mesh; until: number | undefined }[] = [];
    for (const until of order) {
      const proxy = shadowProxy(bands.get(until) ?? []);
      if (proxy === null) continue;
      root.add(proxy);
      if (near) proxy.castShadow = false;
      proxies.push({ mesh: proxy, until });
    }
    return { meshes, proxies, front };
  }
}

/** a unit's near proxy: every part's depth it draws (`front`) and its copy's double-sided casters; null when neither */
export function nearProxy(front: readonly THREE.BufferGeometry[], casters: readonly THREE.BufferGeometry[]): THREE.Mesh | null {
  return shadowProxy(casters.length === 0 ? [...front] : [...front.map(sequentialIndex), ...casters]);
}

// ── the weld across 'copy' units: one mesh per material, a view per copy ──

/**
 * The copies' always-drawn meshes of one material merged into ONE draw, in the weld's parent frame. Culled per copy: it
 * is drawn in a pass when any copy's own mesh (`views`) would have been — never where none would.
 */
export class WeldBatch extends THREE.Mesh {
  readonly views: WeldView[] = [];
  override intersectsFrustum(frustum: THREE.Frustum | THREE.FrustumArray): boolean {
    return this.views.some((v) => v.inFrustum(frustum));
  }
}

/**
 * A copy's own share of a batch, still in its root (its selection box, ray hits and triangle count; Explore isolates one
 * root): its buffers are views (subarrays) into its batch's, no copy. It never draws while its batch is shown — only when
 * the batch is hidden (Explore's isolation hides the root's siblings, the batch among them).
 */
export class WeldView extends THREE.Mesh {
  private readonly batch: WeldBatch;
  constructor(geometry: THREE.BufferGeometry, material: THREE.Material | THREE.Material[], batch: WeldBatch) {
    super(geometry, material);
    this.batch = batch;
  }
  /** the renderer's own test for this copy's part (the batch's culling asks it) */
  inFrustum(frustum: THREE.Frustum | THREE.FrustumArray): boolean { return super.intersectsFrustum(frustum); }
  override intersectsFrustum(frustum: THREE.Frustum | THREE.FrustumArray): boolean { return !this.batch.visible && super.intersectsFrustum(frustum); }
}

/** vertices [start, start + count) of a non-indexed geometry: every attribute a subarray of `geo`'s (shared memory) */
function geometrySlice(geo: THREE.BufferGeometry, start: number, count: number): THREE.BufferGeometry | null {
  const out = new THREE.BufferGeometry();
  for (const [name, a] of Object.entries(geo.attributes)) {
    if (!(a instanceof THREE.BufferAttribute)) return null;
    out.setAttribute(name, new THREE.BufferAttribute(a.array.subarray(start * a.itemSize, (start + count) * a.itemSize), a.itemSize, a.normalized));
  }
  bound(out, 'both');
  return out;
}

/**
 * Weld each material's always-drawn meshes across the copies (`copies[i].meshes` under `copies[i].root`) into one
 * WeldBatch under `parent`; each copy's mesh is swapped for its WeldView. A material only one copy draws stays as it is,
 * and never half a batch: when a share can't be viewed, the copies keep their own meshes.
 */
export function weldAcross(copies: readonly { readonly root: THREE.Object3D; readonly meshes: readonly THREE.Mesh[] }[], parent: THREE.Object3D): void {
  const byMat = new Map<THREE.Material, { root: THREE.Object3D; mesh: THREE.Mesh }[]>();
  for (const { root, meshes } of copies) for (const mesh of meshes) {
    const m = mesh.material;
    if (Array.isArray(m)) continue;
    const list = byMat.get(m);
    if (list === undefined) byMat.set(m, [{ root, mesh }]); else list.push({ root, mesh });
  }
  for (const list of byMat.values()) {
    const first = list[0];
    if (list.length < 2 || first === undefined) continue;
    const merged = mergeOrNull(list.map(({ root, mesh }) => mesh.geometry.clone().applyMatrix4(root.matrix)));   // root → parent frame
    if (merged === null) continue;
    bound(merged);
    const batch = new WeldBatch(merged, first.mesh.material);
    batch.castShadow = first.mesh.castShadow; batch.receiveShadow = first.mesh.receiveShadow; batch.renderOrder = first.mesh.renderOrder;
    const views: { root: THREE.Object3D; mesh: THREE.Mesh; view: WeldView }[] = [];
    let start = 0;
    for (const { root, mesh } of list) {
      const n = mesh.geometry.getAttribute('position').count;
      const g = geometrySlice(merged, start, n);
      start += n;
      if (g === null) break;
      const view = new WeldView(g, mesh.material, batch);
      view.castShadow = mesh.castShadow; view.receiveShadow = mesh.receiveShadow; view.renderOrder = mesh.renderOrder;
      view.matrixAutoUpdate = false;
      view.matrix.copy(root.matrix).invert();   // its buffers are in the parent's frame: undo the root's placement
      view.matrixWorldNeedsUpdate = true;
      views.push({ root, mesh, view });
    }
    if (views.length !== list.length) continue;   // never half a batch: the copies keep their own meshes
    for (const { root, mesh, view } of views) { root.remove(mesh); root.add(view); batch.views.push(view); }
    parent.add(batch);
  }
}
