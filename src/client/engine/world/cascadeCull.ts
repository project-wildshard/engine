import * as THREE from 'three';
import type { CSM } from 'three/examples/jsm/csm/CSM.js';

/**
 * Per-cascade shadow culling (PINE-HOLLOW-REMASTER PH-P2). three culls each cascade's casters against that cascade's
 * shadow camera — an ortho box CSM sizes to the slice's 3D diagonal, square, and stretched toward the sun — so a small
 * caster is drawn into every cascade whose box it sits in, although a cascade's depth is only ever read by the fragments
 * of its own slice of the view. A caster's depth is read where its shadow falls: at its own position in the shadow
 * camera's view plane (the projection is orthographic along the light). So a cascade needs a caster only when the
 * caster's disc in that plane touches the slice's footprint there — the convex hull of the slice's 8 corners, the slice
 * widened by CSM's fade band (CSMShader: a fragment within 0.125·edge² of a break samples both cascades) and, for the
 * last cascade, reaching the camera's far plane (every fragment past it samples the last cascade), padded by the PCF
 * kernel, the normal bias and half a metre. What a cascade does draw is unchanged, so every shadow texel any fragment
 * reads is the same depth: the pixels are the same, with fewer draws. Measured: desktop cabin pose, the animals at
 * 45–80 m left cascade 0 and the casters behind the camera left all three.
 *
 * It swaps each cascade light's `shadow.getFrustum()` (WebGLShadowMap's culling frustum, fetched right after the
 * shadow's updateMatrices) for a CascadeFrustum: the box's six planes, then the footprint test on each sphere.
 */

const _p = new THREE.Vector3();
const _c = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _s = new THREE.Sphere();

/**
 * D12: an instanced caster is one draw whose sphere spans every copy (the cove's palms, cliffs and coconuts reach across
 * the island), so it passed every cascade although most cascades hold none of its copies: at Driftwood's spawn 43 of
 * the near cascade's 60 shadow draws, and as many of each sun-fade ghost's. It is tested by its copies instead, as
 * spheres round each CELL × CELL square of them (its own space; rebuilt when its matrices, count or geometry change).
 * A cascade that holds any copy still draws them all, so every shadow texel any fragment reads is the same depth.
 */
const CELL = 24;
interface CopyCells { readonly version: number; readonly count: number; readonly geometry: THREE.BufferGeometry; readonly spheres: Float32Array }
const copyCells = new WeakMap<THREE.InstancedMesh, CopyCells>();
/** three's own flag (an `instanceof` narrows to InstancedMesh<any>) */
const instanced = (object: THREE.Object3D): object is THREE.InstancedMesh => Reflect.get(object, 'isInstancedMesh') === true;
function cellsOf(mesh: THREE.InstancedMesh): Float32Array {
  const known = copyCells.get(mesh), version = mesh.instanceMatrix.version;
  if (known !== undefined && known.version === version && known.count === mesh.count && known.geometry === mesh.geometry) return known.spheres;
  if (mesh.geometry.boundingSphere === null) mesh.geometry.computeBoundingSphere();
  const bounds = mesh.geometry.boundingSphere ?? _s.makeEmpty();
  const boxes = new Map<number, number[]>();
  for (let i = 0; i < mesh.count; i++) {
    mesh.getMatrixAt(i, _m);
    _p.copy(bounds.center).applyMatrix4(_m);
    const r = bounds.radius * _m.getMaxScaleOnAxis(), key = (Math.floor(_p.x / CELL) + 32768) * 65536 + Math.floor(_p.z / CELL) + 32768;
    const box = boxes.get(key);
    if (box === undefined) { boxes.set(key, [_p.x - r, _p.y - r, _p.z - r, _p.x + r, _p.y + r, _p.z + r]); continue; }
    box[0] = Math.min(box[0] ?? 0, _p.x - r); box[1] = Math.min(box[1] ?? 0, _p.y - r); box[2] = Math.min(box[2] ?? 0, _p.z - r);
    box[3] = Math.max(box[3] ?? 0, _p.x + r); box[4] = Math.max(box[4] ?? 0, _p.y + r); box[5] = Math.max(box[5] ?? 0, _p.z + r);
  }
  const spheres = new Float32Array(boxes.size * 4);
  let at = 0;
  for (const [x0 = 0, y0 = 0, z0 = 0, x1 = 0, y1 = 0, z1 = 0] of boxes.values()) {
    spheres[at++] = (x0 + x1) / 2; spheres[at++] = (y0 + y1) / 2; spheres[at++] = (z0 + z1) / 2;
    // a hair over the half diagonal: Float32 centres never shave a copy's edge off
    spheres[at++] = Math.hypot(x1 - x0, y1 - y0, z1 - z0) / 2 * 1.0001 + 1e-3;
  }
  copyCells.set(mesh, { version, count: mesh.count, geometry: mesh.geometry, spheres });
  return spheres;
}

class CascadeFrustum extends THREE.Frustum {
  /** the footprint in the shadow camera's view xy: a convex polygon, counter-clockwise, [x0, y0, x1, y1, …] */
  private readonly poly: number[] = [];
  /** how many of `poly`'s numbers are this frame's (D107: the array keeps its backing store, never trimmed a frame) */
  private polyLength = 0;
  /** refresh's scratch (the corners in view xy, the hull's two chains), kept so a frame allocates nothing */
  private readonly pts: [number, number][] = [];
  private readonly lower: [number, number][] = [];
  private readonly upper: [number, number][] = [];
  /** world → the shadow camera's view */
  private readonly view = new THREE.Matrix4();
  private pad = 0;
  /** debug: true = the box alone (the A/B capture's switch: `sky.csm.lights[i].shadow.getFrustum().off`) */
  off = false;
  /** the last cascade's own shadow (never a ghost): the one that draws a chunked caster whole (`castWholeInLastCascade`) */
  last = false;

  /** refresh from the cascade's own frustum (already set by updateMatrices) and the view slice's corners */
  refresh(box: THREE.Frustum, shadowCam: THREE.OrthographicCamera, corners: readonly THREE.Vector3[], pad: number): void {
    this.copy(box);
    this.view.copy(shadowCam.matrixWorldInverse);
    this.pad = pad;
    const pts = this.pts;
    while (pts.length < corners.length) pts.push([0, 0]);
    pts.length = corners.length;
    for (let i = 0; i < corners.length; i++) { const v = corners[i], pt = pts[i]; if (v === undefined || pt === undefined) continue; _p.copy(v).applyMatrix4(this.view); pt[0] = _p.x; pt[1] = _p.y; }
    this.polyLength = hull(pts, this.lower, this.upper, this.poly);
  }

  /** an instanced caster passes when one of its copy cells does (see CELL above; its own sphere can be stale: never read
   *  here); anything else as three tests it */
  override intersectsObject(object: THREE.Object3D): boolean {
    if (!instanced(object)) return super.intersectsObject(object);
    if (this.off) return true;
    const cells = cellsOf(object), scale = object.matrixWorld.getMaxScaleOnAxis();
    for (let i = 0; i + 3 < cells.length; i += 4) {
      _s.center.set(cells[i] ?? 0, cells[i + 1] ?? 0, cells[i + 2] ?? 0).applyMatrix4(object.matrixWorld);
      _s.radius = (cells[i + 3] ?? 0) * scale;
      if (this.intersectsSphere(_s)) return true;
    }
    return false;
  }

  override intersectsSphere(sphere: THREE.Sphere): boolean {
    if (!super.intersectsSphere(sphere)) return false;
    if (this.off) return true;
    const poly = this.poly, n = this.polyLength / 2;
    if (n < 3) return true;
    _c.copy(sphere.center).applyMatrix4(this.view);
    const r = sphere.radius + this.pad;
    let inside = true, best = Infinity;
    for (let i = 0; i < n; i++) {
      const ax = poly[2 * i] ?? 0, ay = poly[2 * i + 1] ?? 0;
      const j = (i + 1) % n, bx = poly[2 * j] ?? 0, by = poly[2 * j + 1] ?? 0;
      const ex = bx - ax, ey = by - ay, px = _c.x - ax, py = _c.y - ay;
      if (ex * py - ey * px < 0) inside = false; // right of a ccw edge: outside
      const len2 = ex * ex + ey * ey;
      const t = len2 > 0 ? THREE.MathUtils.clamp((px * ex + py * ey) / len2, 0, 1) : 0;
      const dx = px - t * ex, dy = py - t * ey;
      best = Math.min(best, dx * dx + dy * dy);
    }
    return inside || best <= r * r;
  }
}

const byXY = (a: [number, number], b: [number, number]): number => a[0] - b[0] || a[1] - b[1];
const cross = (o: [number, number], a: [number, number], b: [number, number]): number => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
/** Andrew's monotone chain: the convex hull of `pts` (sorted in place), counter-clockwise, flat into `out`; `lower` and
 *  `upper` are the caller's scratch chains. Returns how many numbers of `out` it wrote. */
function hull(pts: [number, number][], lower: [number, number][], upper: [number, number][], out: number[]): number {
  // A cascade supplies eight private points. Stable insertion order matches
  // native sort without allocating its per-frame temporary array. Keep the
  // original native path for non-finite/other-sized future inputs.
  let finite = pts.length <= 8;
  for (const point of pts) if (!Number.isFinite(point[0]) || !Number.isFinite(point[1])) { finite = false; break; }
  if (!finite) pts.sort(byXY);
  else for (let index = 1; index < pts.length; index++) {
    const point = pts[index]; if (point === undefined) continue;
    let at = index;
    while (at > 0) {
      const previous = pts[at - 1]; if (previous === undefined || !(byXY(previous, point) > 0)) break;
      pts[at--] = previous;
    }
    pts[at] = point;
  }
  // Retain chain/output backing stores between frames: logical cursors only, never a length cut (a trimmed store
  // regrew, a fresh backing store, on the next frame's writes; D107).
  let lowerCount = 0, upperCount = 0, used = 0;
  for (const p of pts) {
    while (lowerCount >= 2) { const a = lower[lowerCount - 2], b = lower[lowerCount - 1]; if (a === undefined || b === undefined || cross(a, b, p) > 0) break; lowerCount--; }
    lower[lowerCount++] = p;
  }
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    if (p === undefined) continue;
    while (upperCount >= 2) { const a = upper[upperCount - 2], b = upper[upperCount - 1]; if (a === undefined || b === undefined || cross(a, b, p) > 0) break; upperCount--; }
    upper[upperCount++] = p;
  }
  lowerCount = Math.max(0, lowerCount - 1); upperCount = Math.max(0, upperCount - 1);
  for (let index = 0; index < lowerCount; index++) { const p = lower[index]; if (p !== undefined) { out[used++] = p[0]; out[used++] = p[1]; } }
  for (let index = 0; index < upperCount; index++) { const p = upper[index]; if (p !== undefined) { out[used++] = p[0]; out[used++] = p[1]; } }
  return used;
}

/** shadow passes in progress (Game's shadowMap.render wrapper): only then do copy-culled casters report frustumCulled */
let shadowPass = 0;
/** Draw the shadow maps with copy-culled casters culled per cascade (Game wraps every shadow pass in this). */
export function duringShadowPass(draw: () => void): void {
  shadowPass++;
  try { draw(); } finally { shadowPass--; }
}

/**
 * D12: an instanced caster whose owner culls its copies for the view (`frustumCulled` false: its own sphere goes stale as
 * copies change) is still culled per cascade by its copies. It reports `frustumCulled` only while a shadow pass draws, so
 * the view, precompile and every other reader see it exactly as before; in the pass a cascade frustum tests its copy
 * cells, and any other light's frustum draws it as before.
 */
export function cullCopiesPerCascade(mesh: THREE.InstancedMesh): void {
  let authored = mesh.frustumCulled;
  Object.defineProperty(mesh, 'frustumCulled', { configurable: true, enumerable: true,
    get: (): boolean => authored || shadowPass > 0, set: (value: boolean): void => { authored = value; } });
  mesh.intersectsFrustum = (frustum: THREE.Frustum | THREE.FrustumArray): boolean => {
    if (frustum instanceof CascadeFrustum) return frustum.intersectsObject(mesh);
    return !authored || frustum.intersectsObject(mesh);
  };
}

/**
 * Cull each cascade's casters to its slice's footprint (see the header). Call once after the CSM is made; it follows
 * every later change of the camera, the breaks and the light direction by itself (it reads them each frame).
 */
export function installCascadeCull(csm: CSM, camera: THREE.PerspectiveCamera): void {
  for (const [i, light] of csm.lights.entries()) cullToSlice(csm, camera, light.shadow, i, i === csm.lights.length - 1);
}

/**
 * DW (Driftwood draw budget, engine-performance §10): the last cascade draws a chunked island-wide caster (shadowChunks.ts)
 * whole, in one draw, and skips its pieces; every other cascade and ghost keeps the pieces. The last cascade's footprint
 * reaches the camera's far plane, so it took most of a mesh's pieces anyway (18 + 5 of Driftwood's spawn's 62 far draws).
 * The whole mesh is the pieces' own triangles, material, depth material and transform, so every texel a fragment reads
 * holds the same depth; the extra triangles fall only on texels no fragment of that slice reads. The view's culling is
 * the mesh's own (the override acts only inside a shadow pass).
 */
export function castWholeInLastCascade(mesh: THREE.Mesh, pieces: readonly THREE.Mesh[]): void {
  const own = mesh.intersectsFrustum.bind(mesh);
  mesh.intersectsFrustum = (frustum: THREE.Frustum | THREE.FrustumArray): boolean =>
    shadowPass > 0 ? frustum instanceof CascadeFrustum && frustum.last && frustum.intersectsObject(mesh) : own(frustum);
  for (const piece of pieces) {
    const piecewise = piece.intersectsFrustum.bind(piece);
    piece.intersectsFrustum = (frustum: THREE.Frustum | THREE.FrustumArray): boolean =>
      !(frustum instanceof CascadeFrustum && frustum.last) && piecewise(frustum);
  }
  mesh.castShadow = true;
}

/**
 * Cull `shadow`'s casters to cascade `i`'s slice footprint, seen from `shadow`'s own camera. A cascade's own shadow, or
 * (E153) the sun fade's ghost of that cascade (shadowFade.ts): the ghost draws the same slice from the old sun direction,
 * and without this it drew every caster in its whole ortho box — +34 draws and +0.66 M triangles a frame on the phone
 * rig, on ~3 frames in 4 (a fade runs most of the time), where its cascades drew a fraction of that.
 */
export function cullToSlice(csm: CSM, camera: THREE.PerspectiveCamera, shadow: THREE.DirectionalLightShadow, i: number, own = false): void {
  const corners = Array.from({ length: 8 }, () => new THREE.Vector3());
  const box = shadow.getFrustum(), cull = new CascadeFrustum();
  cull.last = own;
  shadow.getFrustum = (): THREE.Frustum => {
    const slice = csm.frustums[i];
    if (slice === undefined) return box;
    const last = i === csm.lights.length - 1;
    const span = Math.min(camera.far, csm.maxFar) - camera.near;
    // the slice's depths (CSMFrustum.split: break · far) widened by the fade band, in camera-space distance along −z
    const x = i === 0 ? 0 : csm.breaks[i - 1] ?? 0, y = csm.breaks[i] ?? 1;
    const d0 = i === 0 ? camera.near : Math.max(camera.near, (x - (csm.fade ? 0.125 * x * x : 0)) * span * 0.98);
    const d1 = last ? camera.far : (y + (csm.fade ? 0.125 * y * y : 0)) * span * 1.02;
    for (let j = 0; j < 4; j++) {
      const n = slice.vertices.near[j], f = slice.vertices.far[j], cn = corners[j], cf = corners[j + 4];
      if (n === undefined || f === undefined || cn === undefined || cf === undefined) return box;
      // along each corner ray: a view-space point at depth d is the ray's point scaled by d / −z
      cn.copy(n).multiplyScalar(d0 / -n.z).applyMatrix4(camera.matrixWorld);
      cf.copy(f).multiplyScalar(d1 / -f.z).applyMatrix4(camera.matrixWorld);
    }
    const cam = shadow.camera;
    const texel = (cam.right - cam.left) / Math.max(1, shadow.mapSize.x);
    cull.refresh(box, cam, corners, 0.5 + shadow.normalBias + (shadow.radius + 2) * texel);
    return cull;
  };
}
