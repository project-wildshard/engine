import * as THREE from 'three';

/**
 * Faces nobody can see, found at bake time (T8: Driftwood's over-cap tiles). A merged low-poly model is a heap of closed
 * parts: crag boulders piled into one another, planks lapped over their neighbours, steps standing on steps. A triangle
 * whose three corners lie inside one other closed part (behind every one of its face planes) is inside that solid, since
 * the region behind all of a closed mesh's planes is convex and lies within it; one resting on such a part's face and
 * turned into it is covered by that face, as is one two closed parts share face to face (a plank's end on the next
 * plank's). A triangle wholly under the terrain is buried. Dropping them leaves every visible pixel as it was.
 * `LowPolyKit.finish({ hidden })` reads this after its AO bake, so the colours the kept faces bake are the ones they
 * always had.
 *
 * A part counts as an occluder only when it is watertight (every edge shared by exactly two of its triangles) and does
 * not sway; parts are non-indexed, world-space triangle soups (the kit's own form).
 */
export interface HiddenOptions {
  /** the terrain height under (x, z): triangles wholly below it by `margin` are buried */
  readonly ground?: (x: number, z: number) => number;
  /** metres below the ground a buried triangle's corners, edge midpoints and centre must all sit (default 0.25) */
  readonly margin?: number;
}

/** metres: a corner this close to a plane is on it */
const ON = 1e-3;
/** the occluder lookup grid's cell (m, x / z) */
const CELL = 2;

interface Occluder { readonly part: number; readonly min: THREE.Vector3; readonly max: THREE.Vector3; readonly planes: Float64Array; readonly faces: readonly string[] }

/** a triangle's corners in winding order from its smallest corner (the reverse winding reads as the touching face's) */
const faceKey = (k: readonly string[], reverse: boolean): string => {
  const order = reverse ? [k[0] ?? '', k[2] ?? '', k[1] ?? ''] : [k[0] ?? '', k[1] ?? '', k[2] ?? ''];
  let start = 0;
  for (let i = 1; i < 3; i++) if ((order[i] ?? '') < (order[start] ?? '')) start = i;
  return `${order[start] ?? ''}|${order[(start + 1) % 3] ?? ''}|${order[(start + 2) % 3] ?? ''}`;
};

function occluder(g: THREE.BufferGeometry, part: number): Occluder | null {
  const p = g.getAttribute('position').array, n = p.length / 9;
  if (n < 4 || g.hasAttribute('aSway')) return null;
  const key = (i: number): string => `${Math.round((p[i] ?? 0) * 1e4)},${Math.round((p[i + 1] ?? 0) * 1e4)},${Math.round((p[i + 2] ?? 0) * 1e4)}`;
  const edges = new Map<string, number>(), faces: string[] = [];
  for (let t = 0; t < n; t++) {
    const k = [key(t * 9), key(t * 9 + 3), key(t * 9 + 6)];
    faces.push(faceKey(k, false));
    for (let e = 0; e < 3; e++) {
      const a = k[e] ?? '', b = k[(e + 1) % 3] ?? '';
      if (a === b) continue;
      const edge = a < b ? `${a}|${b}` : `${b}|${a}`;
      edges.set(edge, (edges.get(edge) ?? 0) + 1);
    }
  }
  for (const uses of edges.values()) if (uses !== 2) return null;
  const planes: number[] = [], min = new THREE.Vector3(Infinity, Infinity, Infinity), max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  let volume = 0;
  for (let t = 0; t < n; t++) {
    a.fromArray(p, t * 9); b.fromArray(p, t * 9 + 3); c.fromArray(p, t * 9 + 6);
    min.min(a).min(b).min(c); max.max(a).max(b).max(c);
    volume += a.dot(b.clone().cross(c));
    b.sub(a); c.sub(a); b.cross(c);
    const length = b.length();
    if (length < 1e-9) continue;
    b.divideScalar(length);
    planes.push(b.x, b.y, b.z, b.dot(a));
  }
  // inward-wound (or inside-out) parts are not trusted as solids
  return volume > 0 ? { part, min, max, planes: Float64Array.from(planes), faces } : null;
}

/** Whether triangle (a, b, c) with unit normal `normal` is inside `o`, or on one of its faces and turned into it. */
function covered(o: Occluder, corners: Float32Array | Float64Array, at: number, normal: THREE.Vector3): boolean {
  for (let j = 0; j < 3; j++) {
    const x = corners[at + j * 3] ?? 0, y = corners[at + j * 3 + 1] ?? 0, z = corners[at + j * 3 + 2] ?? 0;
    if (x < o.min.x - ON || y < o.min.y - ON || z < o.min.z - ON || x > o.max.x + ON || y > o.max.y + ON || z > o.max.z + ON) return false;
  }
  const pl = o.planes;
  for (let i = 0; i < pl.length; i += 4) {
    const nx = pl[i] ?? 0, ny = pl[i + 1] ?? 0, nz = pl[i + 2] ?? 0, d = pl[i + 3] ?? 0;
    let far = -Infinity, near = Infinity;
    for (let j = 0; j < 3; j++) {
      const s = nx * (corners[at + j * 3] ?? 0) + ny * (corners[at + j * 3 + 1] ?? 0) + nz * (corners[at + j * 3 + 2] ?? 0) - d;
      far = Math.max(far, s); near = Math.min(near, s);
    }
    if (far > ON) return false;
    // lying in this face's plane: only a triangle facing into the solid is covered by it (one facing out would show)
    if (near > -ON && nx * normal.x + ny * normal.y + nz * normal.z > -0.999) return false;
  }
  return true;
}

/** Per part, 1 for each triangle no viewpoint outside the solids and above the ground can see. */
export function hiddenTriangles(parts: readonly THREE.BufferGeometry[], options: HiddenOptions = {}): Uint8Array[] {
  const grid = new Map<string, Occluder[]>(), cell = (x: number, z: number): string => `${Math.floor(x / CELL)},${Math.floor(z / CELL)}`;
  // the faces of the closed parts, by winding: a face another closed part shares reversed lies between the two solids
  const faces = new Map<string, number>(), solid: (Occluder | null)[] = [];
  parts.forEach((g, part) => {
    const o = occluder(g, part);
    solid.push(o);
    if (o === null) return;
    for (const face of o.faces) faces.set(face, faces.has(face) && faces.get(face) !== part ? -1 : part);
    for (let gx = Math.floor(o.min.x / CELL); gx <= Math.floor(o.max.x / CELL); gx++) for (let gz = Math.floor(o.min.z / CELL); gz <= Math.floor(o.max.z / CELL); gz++) {
      const k = `${gx},${gz}`, list = grid.get(k);
      if (list === undefined) grid.set(k, [o]); else list.push(o);
    }
  });
  const { ground } = options, margin = options.margin ?? 0.25;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), normal = new THREE.Vector3();
  const buried = (): boolean => {
    if (ground === undefined) return false;
    const below = (x: number, y: number, z: number): boolean => y < ground(x, z) - margin;
    return below(a.x, a.y, a.z) && below(b.x, b.y, b.z) && below(c.x, c.y, c.z)
      && below((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2) && below((b.x + c.x) / 2, (b.y + c.y) / 2, (b.z + c.z) / 2)
      && below((c.x + a.x) / 2, (c.y + a.y) / 2, (c.z + a.z) / 2) && below((a.x + b.x + c.x) / 3, (a.y + b.y + c.y) / 3, (a.z + b.z + c.z) / 3);
  };
  return parts.map((g, part) => {
    const p = g.getAttribute('position').array, n = p.length / 9, out = new Uint8Array(n);
    if (!(p instanceof Float32Array)) return out;
    for (let t = 0; t < n; t++) {
      a.fromArray(p, t * 9); b.fromArray(p, t * 9 + 3); c.fromArray(p, t * 9 + 6);
      if (buried()) { out[t] = 1; continue; }
      normal.subVectors(c, a).cross(b.clone().sub(a)).negate();
      const length = normal.length();
      if (length < 1e-12) continue;
      normal.divideScalar(length);
      const own = solid[part]?.faces[t];
      if (own !== undefined) {
        const touching = faces.get(faceKey(own.split('|'), true));
        if (touching !== undefined && touching !== part) { out[t] = 1; continue; }
      }
      for (const o of grid.get(cell(a.x, a.z)) ?? []) if (o.part !== part && covered(o, p, t * 9, normal)) { out[t] = 1; break; }
    }
    return out;
  });
}

/** `geometry` without the triangles `hidden` marks (non-indexed; every attribute kept per remaining vertex). */
export function dropTriangles(geometry: THREE.BufferGeometry, hidden: Uint8Array): THREE.BufferGeometry {
  const triangles = geometry.getAttribute('position').count / 3;
  let kept = 0;
  for (let t = 0; t < triangles; t++) if (hidden[t] !== 1) kept++;
  if (kept === triangles) return geometry;
  const out = new THREE.BufferGeometry();
  for (const [name, attribute] of Object.entries(geometry.attributes)) {
    if (!(attribute instanceof THREE.BufferAttribute)) throw new Error(`Interleaved attribute ${name} cannot drop triangles`);
    const size = attribute.itemSize * 3, source = attribute.array, array = source.slice(0, kept * size);
    for (let t = 0, at = 0; t < triangles; t++) if (hidden[t] !== 1) { array.set(source.subarray(t * size, (t + 1) * size), at); at += size; }
    out.setAttribute(name, new THREE.BufferAttribute(array, attribute.itemSize, attribute.normalized));
  }
  out.userData = geometry.userData;
  geometry.dispose();
  return out;
}
