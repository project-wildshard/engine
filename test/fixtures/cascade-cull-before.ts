// Frozen complete cull before-control: cascadeCull.ts at 57a964ee02.
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

class CascadeFrustum extends THREE.Frustum {
  /** the footprint in the shadow camera's view xy: a convex polygon, counter-clockwise, [x0, y0, x1, y1, …] */
  private readonly poly: number[] = [];
  /** refresh's scratch (the corners in view xy, the hull's two chains), kept so a frame allocates nothing */
  private readonly pts: [number, number][] = [];
  private readonly lower: [number, number][] = [];
  private readonly upper: [number, number][] = [];
  /** world → the shadow camera's view */
  private readonly view = new THREE.Matrix4();
  private pad = 0;
  /** debug: true = the box alone (the A/B capture's switch: `sky.csm.lights[i].shadow.getFrustum().off`) */
  off = false;

  /** refresh from the cascade's own frustum (already set by updateMatrices) and the view slice's corners */
  refresh(box: THREE.Frustum, shadowCam: THREE.OrthographicCamera, corners: readonly THREE.Vector3[], pad: number): void {
    this.copy(box);
    this.view.copy(shadowCam.matrixWorldInverse);
    this.pad = pad;
    const pts = this.pts;
    while (pts.length < corners.length) pts.push([0, 0]);
    pts.length = corners.length;
    for (let i = 0; i < corners.length; i++) { const v = corners[i], pt = pts[i]; if (v === undefined || pt === undefined) continue; _p.copy(v).applyMatrix4(this.view); pt[0] = _p.x; pt[1] = _p.y; }
    hull(pts, this.lower, this.upper, this.poly);
  }

  override intersectsSphere(sphere: THREE.Sphere): boolean {
    if (!super.intersectsSphere(sphere)) return false;
    if (this.off) return true;
    const poly = this.poly, n = poly.length / 2;
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
 *  `upper` are the caller's scratch chains */
function hull(pts: [number, number][], lower: [number, number][], upper: [number, number][], out: number[]): void {
  pts.sort(byXY);
  lower.length = 0; upper.length = 0;
  for (const p of pts) {
    while (lower.length >= 2) { const a = lower[lower.length - 2], b = lower[lower.length - 1]; if (a === undefined || b === undefined || cross(a, b, p) > 0) break; lower.pop(); }
    lower.push(p);
  }
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    if (p === undefined) continue;
    while (upper.length >= 2) { const a = upper[upper.length - 2], b = upper[upper.length - 1]; if (a === undefined || b === undefined || cross(a, b, p) > 0) break; upper.pop(); }
    upper.push(p);
  }
  lower.pop(); upper.pop();
  out.length = 0;
  for (const p of lower) out.push(p[0], p[1]);
  for (const p of upper) out.push(p[0], p[1]);
}

/**
 * Cull each cascade's casters to its slice's footprint (see the header). Call once after the CSM is made; it follows
 * every later change of the camera, the breaks and the light direction by itself (it reads them each frame).
 */
export function installCascadeCull(csm: CSM, camera: THREE.PerspectiveCamera): void {
  for (const [i, light] of csm.lights.entries()) cullToSlice(csm, camera, light.shadow, i);
}

/**
 * Cull `shadow`'s casters to cascade `i`'s slice footprint, seen from `shadow`'s own camera. A cascade's own shadow, or
 * (E153) the sun fade's ghost of that cascade (shadowFade.ts): the ghost draws the same slice from the old sun direction,
 * and without this it drew every caster in its whole ortho box — +34 draws and +0.66 M triangles a frame on the phone
 * rig, on ~3 frames in 4 (a fade runs most of the time), where its cascades drew a fraction of that.
 */
export function cullToSlice(csm: CSM, camera: THREE.PerspectiveCamera, shadow: THREE.DirectionalLightShadow, i: number): void {
  const corners = Array.from({ length: 8 }, () => new THREE.Vector3());
  const box = shadow.getFrustum(), cull = new CascadeFrustum();
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
