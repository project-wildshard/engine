import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { RngPort } from '../../../shared/engine/core/rng';
import { Noise2D } from '../../../shared/engine/core/noise';
import { bakedGeometry } from './geometryBake';
import { dropTriangles, hiddenTriangles, type HiddenOptions } from './hiddenFaces';

/**
 * The engine geometry kit (E357 X5, 10 §X5): the shape builders every model kit shares. Flat-shaded ones (`log`, `beam`,
 * `rope`, `rock`, `plank`, `wobble`, `tris`: the low-poly kit's faceted look) and smooth ones (`blob`: welded, smooth
 * normals, for the painted kit). Each keeps its own vertex maths (a `log` is a scaled unit prism), so every model built
 * from them is unchanged.
 */

// ── flat-shaded primitives ──────────────────────────────────────────────────────────────────────────

/** displace every distinct vertex position by up to ±amp (shared corners move together) */
export function wobble(g: THREE.BufferGeometry, amp: number, rng: RngPort): void {
  const pos = g.getAttribute('position');
  const seen = new Map<string, [number, number, number]>();
  for (let i = 0; i < pos.count; i++) {
    const key = `${pos.getX(i).toFixed(4)},${pos.getY(i).toFixed(4)},${pos.getZ(i).toFixed(4)}`;
    let d = seen.get(key);
    if (!d) { d = [rng.range(-amp, amp), rng.range(-amp, amp), rng.range(-amp, amp)]; seen.set(key, d); }
    pos.setXYZ(i, pos.getX(i) + d[0], pos.getY(i) + d[1], pos.getZ(i) + d[2]);
  }
  pos.needsUpdate = true;
}

const UP = new THREE.Vector3(0, 1, 0);
const _q = new THREE.Quaternion();
const _d = new THREE.Vector3();

/** orient a geometry built along +Y (centred at origin, length 1 unit along y) from a to b */
function alongSegment(g: THREE.BufferGeometry, a: THREE.Vector3, b: THREE.Vector3): THREE.BufferGeometry {
  _d.subVectors(b, a);
  const len = _d.length();
  g.scale(1, len, 1);
  _q.setFromUnitVectors(UP, _d.normalize());
  g.applyQuaternion(_q);
  g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  return g;
}

/**
 * A faceted log / beam / post between two points: an n-sided prism (default 6) tapering r0 → r1, the
 * ring rotated a random amount so neighbouring logs don't line their facets up.
 */
export function log(a: THREE.Vector3, b: THREE.Vector3, r0: number, r1: number = r0, sides = 6, twist = 0): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(r1, r0, 1, sides, 1, false, twist);
  return alongSegment(g, a, b);
}

/** a squared timber (w × h cross-section) between two points; `roll` spins it about its own axis */
export function beam(a: THREE.Vector3, b: THREE.Vector3, w: number, h: number, roll = 0): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, 1, h);
  if (roll !== 0) g.rotateY(roll);
  return alongSegment(g, a, b);
}

/** a rope / cable: a 4-sided tube through the points (segments share no caps; cheap and reads fine) */
export function rope(points: THREE.Vector3[], r: number, sides = 4): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i + 1 < points.length; i++) {
    const p = points[i], q = points[i + 1];
    if (p === undefined || q === undefined) continue;
    const g = new THREE.CylinderGeometry(r, r, 1, sides, 1, true, Math.PI / 4);
    parts.push(alongSegment(g, p, q).toNonIndexed());
  }
  return mergeGeometries(parts, false);
}

/** points along a catenary-ish sag from a to b (n segments), for ropes and rigging */
export function sagLine(a: THREE.Vector3, b: THREE.Vector3, sag: number, n = 6): THREE.Vector3[] {
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= n; i++) { const t = i / n; pts.push(new THREE.Vector3().lerpVectors(a, b, t).setY(a.y + (b.y - a.y) * t - sag * 4 * t * (1 - t))); }
  return pts;
}

/**
 * A boulder: an icosahedron (detail 0 = 20 faces, 1 = 80) with every vertex pushed in/out by value
 * noise, squashed vertically. Shared vertices move together so the rock stays watertight.
 */
export function rock(r: number, detail: number, rng: RngPort, squash = 0.7, rough = 0.28): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(r, detail);
  const pos = g.getAttribute('position');
  const seen = new Map<string, number>();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const key = `${x.toFixed(3)},${y.toFixed(3)},${z.toFixed(3)}`;
    let k = seen.get(key);
    if (k === undefined) { k = 1 + rng.range(-rough, rough); seen.set(key, k); }
    pos.setXYZ(i, x * k, y * k * squash, z * k);
  }
  return g;
}

/** a flat-bottomed plank/board: a box with its corners nudged (± wob) so rows of them look hand-sawn */
export function plank(len: number, w: number, t: number, rng: RngPort, wob = 0.012): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(len, t, w);
  wobble(g, wob, rng);
  return g;
}

/** a flat list of triangles ([x,y,z]×3 per face) as a geometry for `kit.add` */
export function tris(v: number[]): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  return g;
}

// ── smooth primitives ───────────────────────────────────────────────────────────────────────────────

/** a smooth lumpy stone: an icosphere (detail 2 = 320 faces, 1 = 80) displaced by seeded noise, squashed. A shard that adds
 *  a geometry bake (./geometryBake.ts) reads the shape from it; the smooth normals are exact arithmetic, made here */
export function blob(r: number, rng: RngPort, detail = 1, squash = 0.75, rough = 0.22): THREE.BufferGeometry {
  const g = bakedGeometry('engine/blob', [r, detail, squash, rough], rng, () => blobShape(r, rng, detail, squash, rough));
  g.computeVertexNormals();
  return g;
}

/** the blob's welded, displaced shape: indexed, `position` only */
function blobShape(r: number, rng: RngPort, detail: number, squash: number, rough: number): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(r, detail);
  const merged = mergeVerticesByPos(g);
  const pos = merged.getAttribute('position');
  const ox = rng.range(0, 100), oz = rng.range(0, 100);
  const nz = new Noise2D(rng.int(1, 1e6));
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const k = 1 + rough * (nz.get(x / r * 1.3 + ox, z / r * 1.3 + y / r + oz) * 0.75 + nz.get(x / r * 3 + oz, y / r * 3 - ox) * 0.25);
    pos.setXYZ(i, x * k, y * k * squash, z * k);
  }
  return merged;
}

/** weld an unindexed / seam-split geometry by position (so displacement keeps it watertight and normals smooth) */
function mergeVerticesByPos(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const src = g.index ? g.toNonIndexed() : g;
  const pos = src.getAttribute('position');
  const map = new Map<string, number>();
  const verts: number[] = [], idx: number[] = [];
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const key = `${Math.round(x * 1e4)},${Math.round(y * 1e4)},${Math.round(z * 1e4)}`;
    let k = map.get(key);
    if (k === undefined) { k = verts.length / 3; verts.push(x, y, z); map.set(key, k); }
    idx.push(k);
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  out.setIndex(idx);
  if (src !== g) src.dispose();
  g.dispose();
  return out;
}

/** Finished parts (normals and colours baked) without their hidden triangles (hiddenFaces.ts: inside another closed part,
 * or buried), each part culled against all the others; a part with nothing hidden comes back as it was. */
export function withoutHidden(parts: readonly THREE.BufferGeometry[], options: HiddenOptions = {}): THREE.BufferGeometry[] {
  const hidden = hiddenTriangles(parts, options);
  return parts.map((g, i) => dropTriangles(g, hidden[i] ?? new Uint8Array(0)));
}
