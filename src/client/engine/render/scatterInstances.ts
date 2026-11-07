import * as THREE from 'three';
import { smoothstep } from '../../../shared/engine/core/noise';

/** Client-only bounded scatter drawing. Placement, colour, range and collision ownership remain authored data. */
export interface ScatterPose {
  x: number; y: number; z: number;
  yaw: number;
  sx: number; sy: number; sz: number;
  /** lean (radians) about x / z — rocks settling into a slope, a tilted clump */
  tiltX?: number; tiltZ?: number;
  /** Optional solid source marker; collision is registered separately. */
  solid?: true;
  /** metres: this instance's draw distance (before the tier scale) */
  far: number;
  /** linear RGB multiplier (instanceColor) */
  r: number; g: number; b: number;
}

export interface ScatterSource {
  version: 1; count: number; matrices: Float32Array; colours: Float32Array; spheres: Float32Array; ranges: Float32Array;
  cellSize: number; keepNear: number; fadeStart: number; rangeScale: number;
}

export interface ScatterLayer { name: string; mesh: THREE.InstancedMesh; count: number; cull: (frustum: THREE.Frustum, viewer: THREE.Vector3) => void; readonly visible: number; readonly tris: number }
const sourceLayers = new WeakMap<THREE.Object3D, ScatterSource>();
/** Copy original placement rows only when the offline map inventory requests them. */
export function captureScatterSource(mesh: THREE.Object3D): ScatterSource | undefined {
  const source = sourceLayers.get(mesh);
  return source === undefined ? undefined : { ...source, matrices: source.matrices.slice(), colours: source.colours.slice(), spheres: source.spheres.slice(), ranges: source.ranges.slice() };
}

export function scatterLayer(name: string, geometry: THREE.BufferGeometry, material: THREE.Material, list: ScatterPose[], farScale: number, castShadow = false, keepNear = 26): ScatterLayer {
  if (list.length > 1_000_000 || !Number.isFinite(farScale) || farScale <= 0 || !Number.isFinite(keepNear) || keepNear < 0 || !list.every(row => finiteRow(row, farScale))) throw new Error('Invalid scatter rows');
  geometry.computeBoundingSphere();
  const mesh = new THREE.InstancedMesh(geometry, material, Math.max(1, list.length));
  mesh.name = name; mesh.frustumCulled = false; mesh.castShadow = castShadow; mesh.receiveShadow = true;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, list.length) * 3), 3);
  mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
  const matrices = new Float32Array(list.length * 16), colours = new Float32Array(list.length * 3), spheres = new Float32Array(list.length * 4), ranges = new Float32Array(list.length);
  const transform = new THREE.Matrix4(), rotation = new THREE.Quaternion(), angles = new THREE.Euler(), point = new THREE.Vector3(), scale = new THREE.Vector3(), sphere = new THREE.Sphere();
  // T10 (Nalati cold tail): written straight into the typed arrays, and cells keyed by number (an array literal per copy
  // and a string per row were most of this build: 59 ms of a Nalati entry's dressing at phone 4x)
  const radius = geometry.boundingSphere?.radius ?? 1;
  for (let i = 0; i < list.length; i++) {
    const it = list[i];
    if (it === undefined) continue;
    transform.compose(point.set(it.x, it.y, it.z), rotation.setFromEuler(angles.set(it.tiltX ?? 0, it.yaw, it.tiltZ ?? 0, 'YXZ')), scale.set(it.sx, it.sy, it.sz)).toArray(matrices, i * 16);
    colours[i * 3] = it.r; colours[i * 3 + 1] = it.g; colours[i * 3 + 2] = it.b;
    spheres[i * 4] = it.x; spheres[i * 4 + 1] = it.y; spheres[i * 4 + 2] = it.z; spheres[i * 4 + 3] = radius * Math.max(it.sx, it.sy, it.sz);
    ranges[i] = it.far * farScale;
  }
  // 24 m cells, each with the box round its instances' spheres and the xz bounds of their centres: a cell wholly past
  // keepNear and outside the frustum skips its instances in one test (G639: per-instance sphere tests and string-keyed
  // cell reads were ~2 ms of a Nalati look frame at phone 4x). Cells list in the old window's order, nearest first.
  const buckets = new Map<number | string, { cx: number; cz: number; members: number[] }>();
  for (let i = 0; i < list.length; i++) {
    const it = list[i];
    if (it === undefined) continue;
    const cx = Math.floor(it.x / 24), cz = Math.floor(it.z / 24), key = cellKey(cx, cz), bucket = buckets.get(key);
    if (bucket === undefined) buckets.set(key, { cx, cz, members: [i] }); else bucket.members.push(i);
  }
  const cells = [...buckets.values()].sort((a, b) => a.cz - b.cz || a.cx - b.cx).map(({ cx, cz, members }) => {
    const box = new THREE.Box3();
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const i of members) {
      const x = spheres[i * 4] ?? 0, y = spheres[i * 4 + 1] ?? 0, z = spheres[i * 4 + 2] ?? 0, r = spheres[i * 4 + 3] ?? 1;
      box.expandByPoint(point.set(x - r, y - r, z - r)).expandByPoint(point.set(x + r, y + r, z + r));
      x0 = Math.min(x0, x); z0 = Math.min(z0, z); x1 = Math.max(x1, x); z1 = Math.max(z1, z);
    }
    return { cx, cz, members: Int32Array.from(members), box, x0, z0, x1, z1, d2: 0 };
  });
  const near: (typeof cells)[number][] = [];
  const reach = ranges.reduce((far, value) => Math.max(far, value), 0);
  const cull = (frustum: THREE.Frustum, viewer: THREE.Vector3): void => {
    let n = 0;
    near.length = 0;
    for (const cell of cells) {
      const dx = Math.max(0, cell.cx * 24 - viewer.x, viewer.x - (cell.cx + 1) * 24), dz = Math.max(0, cell.cz * 24 - viewer.z, viewer.z - (cell.cz + 1) * 24);
      cell.d2 = dx * dx + dz * dz;
      if (cell.d2 > reach * reach) continue;
      const ex = Math.max(0, cell.x0 - viewer.x, viewer.x - cell.x1), ez = Math.max(0, cell.z0 - viewer.z, viewer.z - cell.z1);
      if (ex * ex + ez * ez > keepNear * keepNear && !frustum.intersectsBox(cell.box)) continue;
      near.push(cell);
    }
    near.sort((a, b) => a.d2 - b.d2);
    for (const cell of near) for (const i of cell.members) {
      const far = ranges[i] ?? 0, d2 = ((spheres[i * 4] ?? 0) - viewer.x) ** 2 + ((spheres[i * 4 + 2] ?? 0) - viewer.z) ** 2;
      if (d2 > far * far) continue;
      sphere.center.set(spheres[i * 4] ?? 0, spheres[i * 4 + 1] ?? 0, spheres[i * 4 + 2] ?? 0); sphere.radius = spheres[i * 4 + 3] ?? 1;
      if (d2 > keepNear * keepNear && !frustum.intersectsSphere(sphere)) continue;
      const fade = smoothstep(far, far * 0.82, Math.sqrt(d2)), out = mesh.instanceMatrix.array;
      for (let q = 0; q < 16; q++) out[n * 16 + q] = (matrices[i * 16 + q] ?? 0) * (q < 11 && (q & 3) !== 3 ? fade : 1);
      mesh.instanceColor?.setXYZ(n, colours[i * 3] ?? 1, colours[i * 3 + 1] ?? 1, colours[i * 3 + 2] ?? 1); n++;
    }
    mesh.count = n; mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor !== null) mesh.instanceColor.needsUpdate = true;
  };
  sourceLayers.set(mesh, { version: 1, count: list.length, matrices, colours, spheres, ranges, cellSize: 24, keepNear, fadeStart: 0.82, rangeScale: farScale });
  const tris = (geometry.index?.count ?? geometry.getAttribute('position').count) / 3;
  mesh.count = 0;
  return { name, mesh, count: list.length, cull, get visible() { return mesh.count; }, get tris() { return mesh.count * tris; } };
}

/** the validation `scatterLayer` applies to each row: every number finite, its draw distance within reach */
function finiteRow(row: ScatterPose, farScale: number): boolean {
  return Number.isFinite(row.x) && Number.isFinite(row.y) && Number.isFinite(row.z) && Number.isFinite(row.yaw) && Number.isFinite(row.sx)
    && Number.isFinite(row.sy) && Number.isFinite(row.sz) && Number.isFinite(row.far) && Number.isFinite(row.r) && Number.isFinite(row.g)
    && Number.isFinite(row.b) && Number.isFinite(row.tiltX ?? 0) && Number.isFinite(row.tiltZ ?? 0) && row.far >= 0 && row.far * farScale <= 2000;
}
/** one key per 24 m cell (cells only group, and are sorted by (cz, cx) after): a number while it is one-to-one, the
 *  original string past that */
function cellKey(cx: number, cz: number): number | string {
  return Math.abs(cx) < 2_097_152 && Math.abs(cz) < 2_097_152 ? cx * 4_194_304 + cz : `${cx},${cz}`;
}

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3();

/** each instance's world box (6 floats: min xyz, max xyz): its layer's geometry box at the instance's transform */
export function instanceBoxes(geometry: THREE.BufferGeometry, list: readonly ScatterPose[]): Float32Array {
  if (geometry.boundingBox === null) geometry.computeBoundingBox();
  const bb = geometry.boundingBox ?? new THREE.Box3();
  const out = new Float32Array(list.length * 6), lo = bb.min, hi = bb.max, empty = bb.isEmpty();
  list.forEach((it, i) => {
    if (empty) { out[i * 6] = lo.x; out[i * 6 + 1] = lo.y; out[i * 6 + 2] = lo.z; out[i * 6 + 3] = hi.x; out[i * 6 + 4] = hi.y; out[i * 6 + 5] = hi.z; return; }
    const e = _m.compose(_p.set(it.x, it.y, it.z), _q.setFromEuler(_e.set(it.tiltX ?? 0, it.yaw, it.tiltZ ?? 0, 'YXZ')), _s.set(it.sx, it.sy, it.sz)).elements;
    // Box3.applyMatrix4 inlined (T10: its eight Vector3s through setFromPoints were most of 26 ms of a Nalati entry's
    // dressing at phone 4x): each corner by Vector3.applyMatrix4's arithmetic, then the same min / max
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    for (let c = 0; c < 8; c++) {
      const x = (c & 4) === 0 ? lo.x : hi.x, y = (c & 2) === 0 ? lo.y : hi.y, z = (c & 1) === 0 ? lo.z : hi.z;
      const w = 1 / ((e[3] ?? 0) * x + (e[7] ?? 0) * y + (e[11] ?? 0) * z + (e[15] ?? 1));
      const px = ((e[0] ?? 1) * x + (e[4] ?? 0) * y + (e[8] ?? 0) * z + (e[12] ?? 0)) * w, py = ((e[1] ?? 0) * x + (e[5] ?? 1) * y + (e[9] ?? 0) * z + (e[13] ?? 0)) * w;
      const pz = ((e[2] ?? 0) * x + (e[6] ?? 0) * y + (e[10] ?? 1) * z + (e[14] ?? 0)) * w;
      x0 = Math.min(x0, px); y0 = Math.min(y0, py); z0 = Math.min(z0, pz); x1 = Math.max(x1, px); y1 = Math.max(y1, py); z1 = Math.max(z1, pz);
    }
    out[i * 6] = x0; out[i * 6 + 1] = y0; out[i * 6 + 2] = z0; out[i * 6 + 3] = x1; out[i * 6 + 4] = y1; out[i * 6 + 5] = z1;
  });
  return out;
}
