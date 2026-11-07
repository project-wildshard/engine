/**
 * The Sets explorer's pure parts (E306 / E315 M7; the pane is ./SetExplorer.ts): how a set is framed from the air, what
 * it is made of, what it draws in view, and the lines that mark it. No DOM, so test/sets-explorer.test.ts runs them.
 *
 *   const d = fitOrbit(set.bounds, scratchCam, pitch, { x0: -0.9, x1: 0.9, y0: -0.1, y1: 0.85 });   // every yaw fits
 *   poseOrbit(camera, centre, yaw, pitch, d, lift(window));   // a 3/4 aerial round the set, its centre raised to the window's middle
 *   memberFacts(set, entries) / setTotals(set)                 // the member rows, the card's line
 *   measureDrawn(drawnRoots(set))                              // the set's own triangles and draws in this frame
 *   boxEdges(boxes)                                            // line positions: the set's bounds, a member's copies
 */
import * as THREE from 'three';
import type { DrawnAs, Pipeline, RegisteredSet } from '../world/registry';

/** a rectangle of the screen in NDC (−1 … 1, y up) the framed set must stay inside */
export interface NdcWindow { readonly x0: number; readonly x1: number; readonly y0: number; readonly y1: number }

/** the NDC height the set's centre is lifted to: the middle of the window (a bottom sheet pushes it up) */
export const liftOf = (w: NdcWindow): number => (w.y0 + w.y1) / 2;

/**
 * Pose `cam` on an orbit round `centre`: `yaw` about +Y (0 = from +Z), `pitch` above the horizon, `dist` metres out,
 * looking at the centre — then tipped down so the centre sits at NDC y = `lift` (above a bottom sheet).
 */
export function poseOrbit(cam: THREE.PerspectiveCamera, centre: THREE.Vector3, yaw: number, pitch: number, dist: number, lift = 0): void {
  const cp = Math.cos(pitch);
  cam.position.set(centre.x + Math.sin(yaw) * cp * dist, centre.y + Math.sin(pitch) * dist, centre.z + Math.cos(yaw) * cp * dist);
  cam.lookAt(centre);
  if (lift !== 0) cam.rotateX(-Math.atan(lift * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2)));
  cam.updateMatrixWorld();
}

/**
 * Shift the lens (E315, Jake: "the model rendering zone should be the top two thirds of the screen"): the view's centre —
 * where whatever the camera looks at lands — moves to `cy` CSS px from the top of a `w` × `h` screen, by a view offset,
 * so an orbit still turns round what it looks at while it sits in the zone above a bottom sheet. The same camera pose
 * sees the same things; only the frame slides. True when it changed the projection (a CSM's frustums follow it).
 */
export function lensShift(cam: THREE.PerspectiveCamera, w: number, h: number, cy: number): boolean {
  const s = Math.round(h / 2 - cy);
  const v = cam.view;
  if (s === 0) return lensReset(cam);
  // a frame taller by 2|s| (and wider in proportion, so nothing stretches), the screen a window slid into it
  const fullH = h + 2 * Math.abs(s), fullW = (w * fullH) / h, x = (fullW - w) / 2, y = fullH / 2 - (h / 2 - s);
  if (v?.enabled === true && v.fullWidth === fullW && v.fullHeight === fullH && v.offsetX === x && v.offsetY === y && v.width === w && v.height === h) return false;
  cam.setViewOffset(fullW, fullH, x, y, w, h);
  return true;
}

/** the lens back on the middle; true when it changed */
export function lensReset(cam: THREE.PerspectiveCamera): boolean {
  if (cam.view?.enabled !== true) return false;
  cam.clearViewOffset();
  return true;
}

/** a screen band (CSS px from the top) as an NDC window, `margin` of its height kept clear on every side */
export function bandWindow(top: number, bottom: number, h: number, margin = 0.08, x = 0.8): NdcWindow {
  const m = (bottom - top) * margin;
  return { x0: -x, x1: x, y0: 1 - (2 * (bottom - m)) / h, y1: 1 - (2 * (top + m)) / h };
}

const _corners = Array.from({ length: 8 }, () => new THREE.Vector3());
const _p = new THREE.Vector3();

/** the box's eight corners */
function cornersOf(box: THREE.Box3): THREE.Vector3[] {
  _corners.forEach((c, i) => { c.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z); });
  return _corners;
}

/**
 * The orbit distance at which every corner of `box` stays inside `win` from `yaws` yaws spread round it from `yaw0` (12:
 * every side, as the view turns while you look; 1: this one view), at this pitch. `cam` is a scratch camera with the game
 * camera's fov and aspect (its projection up to date).
 */
export function fitOrbit(box: THREE.Box3, cam: THREE.PerspectiveCamera, pitch: number, win: NdcWindow, yaws = 12, yaw0 = 0, lift: number = liftOf(win)): number {
  return fitPoints(box.getCenter(new THREE.Vector3()), cornersOf(box).map((c) => c.clone()), cam, pitch, win, yaws, yaw0, lift);
}

/** fitOrbit for any points round `centre` (a diorama's rim is a circle: its box's corners would over-fit it by √2) */
export function fitPoints(centre: THREE.Vector3, corners: readonly THREE.Vector3[], cam: THREE.PerspectiveCamera, pitch: number, win: NdcWindow, yaws = 12, yaw0 = 0, lift: number = liftOf(win)): number {
  const fits = (d: number): boolean => {
    for (let k = 0; k < yaws; k++) {
      poseOrbit(cam, centre, yaw0 + (k / yaws) * Math.PI * 2, pitch, d, lift);
      for (const c of corners) {
        _p.copy(c).project(cam);
        if (!(_p.z > -1 && _p.z < 1 && _p.x >= win.x0 && _p.x <= win.x1 && _p.y >= win.y0 && _p.y <= win.y1)) return false;
      }
    }
    return true;
  };
  let r = 1;
  for (const c of corners) r = Math.max(r, c.distanceTo(centre));
  let lo = r * 0.2, hi = r * 2;
  for (let i = 0; i < 16 && !fits(hi); i++) { lo = hi; hi *= 2; }
  for (let i = 0; i < 22; i++) { const mid = (lo + hi) / 2; if (fits(mid)) hi = mid; else lo = mid; }
  return hi;
}

/** what the catalog says about a model (a CatalogEntry's fields the set needs) */
export interface MemberSource {
  readonly id: string;
  readonly name: string;
  readonly pipeline: readonly Pipeline[];
  readonly drawnAs: DrawnAs;
}

/** a member row: the model, how many copies the set places, how it's made and drawn */
export interface MemberFact {
  readonly model: string;
  readonly name: string;
  readonly copies: number;
  readonly pipeline: readonly Pipeline[];
  /** null: the model is not in this shard's catalog (its card can't open) */
  readonly drawnAs: DrawnAs | null;
}

/** the set's members as rows, most copies first (a tie keeps the set's own order) */
export function memberFacts(set: RegisteredSet, entries: readonly MemberSource[]): MemberFact[] {
  return set.members.map((m) => {
    const e = entries.find((x) => x.id === m.model);
    return { model: m.model, name: e?.name ?? m.model, copies: m.copies, pipeline: e?.pipeline ?? [], drawnAs: e?.drawnAs ?? null };
  }).sort((a, b) => b.copies - a.copies);
}

/** models and copies in a set */
export function setTotals(set: RegisteredSet): { models: number; copies: number } {
  let copies = 0;
  for (const m of set.members) copies += m.copies;
  return { models: set.members.length, copies };
}

/** the compass regions a shard's sets are grouped by (north is −z, east +x, as the map draws them), in list order */
export const REGIONS = ['Centre', 'North', 'North-east', 'East', 'South-east', 'South', 'South-west', 'West', 'North-west'] as const;
export type Region = (typeof REGIONS)[number];

/** where a set stands on its shard: the centre within `half / 4` of the middle, else one of eight compass sectors */
export function regionOf(bounds: THREE.Box3, half: number): Region {
  const c = bounds.getCenter(_p);
  if (Math.hypot(c.x, c.z) < half / 4) return 'Centre';
  const sector = Math.round((Math.atan2(c.x, -c.z) / (Math.PI * 2)) * 8 + 8) % 8; // 0 = north, clockwise
  return REGIONS[sector + 1] ?? 'Centre';
}

/** how the list is ordered: by where the sets stand (grouped by region), by name, or most copies first */
export type SetOrder = 'map' | 'az' | 'size';

/** the sets in list order; with 'map', each group's region heads it */
export function orderSets<T extends { set: RegisteredSet; totals: { copies: number } }>(infos: readonly T[], order: SetOrder, half: number): { region: Region | null; info: T }[] {
  const byName = (a: T, b: T): number => a.set.name.localeCompare(b.set.name);
  if (order === 'az') return [...infos].sort(byName).map((info) => ({ region: null, info }));
  if (order === 'size') return [...infos].sort((a, b) => b.totals.copies - a.totals.copies || byName(a, b)).map((info) => ({ region: null, info }));
  const at = (t: T): number => (t.set.bounds.isEmpty() ? REGIONS.length : REGIONS.indexOf(regionOf(t.set.bounds, half)));
  return [...infos].sort((a, b) => at(a) - at(b) || byName(a, b)).map((info) => ({ region: info.set.bounds.isEmpty() ? null : regionOf(info.set.bounds, half), info }));
}

/** the models of a set's place not on the contract yet (`placeSet({ pending })`, M12): their ids */
export function pendingOf(set: RegisteredSet): string[] { return [...(set.pending ?? [])]; }

/** the sets a model is a member of (its card's PART OF) */
export function setsOf(model: string, sets: readonly RegisteredSet[]): RegisteredSet[] {
  return sets.filter((s) => s.members.some((m) => m.model === model));
}

/**
 * The objects that draw a set, each once: members drawn into one kit share it (a Nalati place's painted mesh), and an
 * object inside another one listed (a fire pit in its building's root) is drawn by that one.
 */
export function drawnRoots(set: RegisteredSet): THREE.Object3D[] {
  const all = [...new Set((set.placed ?? []).map((p) => p.object))];
  return all.filter((o) => { for (let a = o.parent; a; a = a.parent) if (all.includes(a)) return false; return true; });
}

/** shown: it and every parent visible */
function shown(o: THREE.Object3D): boolean {
  for (let a: THREE.Object3D | null = o; a; a = a.parent) if (!a.visible) return false;
  return true;
}

/** the triangles and draw calls these objects issue as they stand this frame (hidden levels, culled copies left out) */
export function measureDrawn(roots: readonly THREE.Object3D[]): { tris: number; calls: number } {
  let tris = 0, calls = 0;
  for (const r of roots) {
    if (!shown(r)) continue;
    r.traverseVisible((c) => {
      const m = c as Partial<THREE.Mesh>;
      if (m.isMesh !== true || m.geometry === undefined) return;
      const inst = (c as Partial<THREE.InstancedMesh>).isInstancedMesh === true ? (c as THREE.InstancedMesh).count : 1;
      if (inst === 0) return;
      const g = m.geometry, n = g.index ? g.index.count : g.getAttribute('position').count;
      const range = g.drawRange.count === Infinity ? n : Math.min(n, g.drawRange.count);
      tris += (range / 3) * inst;
      calls += Array.isArray(m.material) ? m.material.length : 1;
    });
  }
  return { tris: Math.round(tris), calls };
}

/** every copy box of the set's members (of one model when `model` is given) */
export function copyBoxes(set: RegisteredSet, model?: string): THREE.Box3[] {
  const out: THREE.Box3[] = [];
  for (const p of set.placed ?? []) {
    if (model !== undefined && p.model !== model) continue;
    for (let i = 0; i < p.copies; i++) out.push(p.copyBox(i, new THREE.Box3()));
  }
  return out;
}

/** LineSegments positions: the twelve edges of each box */
export function boxEdges(boxes: readonly THREE.Box3[]): Float32Array {
  const out = new Float32Array(boxes.length * 72);
  let o = 0;
  const put = (x: number, y: number, z: number): void => { out[o++] = x; out[o++] = y; out[o++] = z; };
  for (const b of boxes) {
    const { min: a, max: c } = b;
    const xs = [a.x, c.x], ys = [a.y, c.y], zs = [a.z, c.z];
    for (const y of ys) for (const z of zs) { put(a.x, y, z); put(c.x, y, z); }
    for (const x of xs) for (const z of zs) { put(x, a.y, z); put(x, c.y, z); }
    for (const x of xs) for (const y of ys) { put(x, y, a.z); put(x, y, c.z); }
  }
  return out;
}
