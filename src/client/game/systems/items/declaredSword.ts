import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { lin } from '@wildshard/engine/math/color';
import { REST } from '../../../../shared/game/weapons/starterMoves';

/**
 * SF54: a private, byte-identical copy of the low-poly sword builder (the original moved to Driftwood's
 * weapons/swordView.ts with its only shard user), kept for the declared `kit.sword` item view (declared.ts: the template /
 * standalone boot's iron sword). Delete it when the declared item families graduate to the SDK (sp-x3's slice).
 */
// ───────────────────────────── low-poly geometry ─────────────────────────────

/** sRGB hex → linear Color (vertex colours are linear) */
const C = {
  blade: lin(0xdcbb8c), bladeEdge: lin(0xe9cda3), guard: lin(0xb08752), grip: lin(0x5a3a22), wrap: lin(0x7b5232), pommel: lin(0x6a4728),
  skin: lin(0xcfa082), skinDark: lin(0xb98a6a), sleeve: lin(0xe9e0cf), sleeveDark: lin(0xd2c6b0),
};

/** non-indexed copy with a `color` attribute: `col` per vertex, each FACE brightened/darkened by a tiny deterministic jitter so the facets read */
function paint(g: THREE.BufferGeometry, col: THREE.Color, jitter = 0.05, seed = 1): THREE.BufferGeometry {
  const ni = g.index ? g.toNonIndexed() : g;
  for (const k of Object.keys(ni.attributes)) if (k !== 'position' && k !== 'normal') ni.deleteAttribute(k);
  ni.computeVertexNormals(); // non-indexed → per-face normals (flat)
  const n = ni.getAttribute('position').count, c = new Float32Array(n * 3);
  let h = seed * 7919;
  for (let f = 0; f < n; f += 3) {
    h = (Math.imul(h, 1103515245) + 12345) & 0x7fffffff;
    const j = 1 + ((h / 0x7fffffff) - 0.5) * 2 * jitter;
    for (let v = f; v < f + 3; v++) { c[v * 3] = col.r * j; c[v * 3 + 1] = col.g * j; c[v * 3 + 2] = col.b * j; }
  }
  ni.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return ni;
}

/** loft consecutive rings (same vertex count) into a closed-around, open-ended tube; a ring may collapse to a point (tip) */
function loft(rings: THREE.Vector3[][]): THREE.BufferGeometry {
  const pos: number[] = [];
  for (let r = 0; r < rings.length - 1; r++) {
    const a = rings[r], b = rings[r + 1];
    if (a === undefined || b === undefined) continue;
    const n = a.length;
    for (let i = 0; i < n; i++) {
      const a0 = a[i], a1 = a[(i + 1) % n], b0 = b[i], b1 = b[(i + 1) % n];
      if (a0 === undefined || a1 === undefined || b0 === undefined || b1 === undefined) continue;
      pos.push(a0.x, a0.y, a0.z, a1.x, a1.y, a1.z, b1.x, b1.y, b1.z);
      pos.push(a0.x, a0.y, a0.z, b1.x, b1.y, b1.z, b0.x, b0.y, b0.z);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return g;
}
/** hexagonal blade section: two edges + two flats, so the flat reads as one facet and the edges as bevels */
const hexSection = (y: number, w: number, t: number, flat = 0.5) => [
  new THREE.Vector3(w, y, 0), new THREE.Vector3(w * flat, y, t), new THREE.Vector3(-w * flat, y, t), new THREE.Vector3(-w, y, 0), new THREE.Vector3(-w * flat, y, -t), new THREE.Vector3(w * flat, y, -t),
];
const ring = (y: number, r: number, n: number, rot = 0) => { const out: THREE.Vector3[] = []; for (let i = 0; i < n; i++) { const a = rot + (i / n) * Math.PI * 2; out.push(new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r)); } return out; };
const cap = (ringV: THREE.Vector3[], up: boolean) => { // fan cap over a ring
  const pos: number[] = []; const n = ringV.length; const cx = ringV.reduce((s, v) => s + v.x, 0) / n, cy = ringV[0]?.y ?? 0, cz = ringV.reduce((s, v) => s + v.z, 0) / n;
  for (let i = 0; i < n; i++) { const a = ringV[i], b = ringV[(i + 1) % n]; if (a === undefined || b === undefined) continue; if (up) pos.push(cx, cy, cz, a.x, a.y, a.z, b.x, b.y, b.z); else pos.push(cx, cy, cz, b.x, b.y, b.z, a.x, a.y, a.z); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); return g;
};
/** ring `i` of a lofted stack (build-time only: every stack below is literal, so a miss is a programming error) */
const ringAt = (rings: THREE.Vector3[][], i: number): THREE.Vector3[] => { const r = rings[i]; if (r === undefined) throw new Error(`Sword: no ring ${i}`); return r; };
function xform(g: THREE.BufferGeometry, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, s = 1) {
  if (s !== 1) g.scale(s, s, s);
  if (rx || ry || rz) g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, ry, rz)));
  g.translate(x, y, z);
  return g;
}
/** a low-poly fist: a 2×1×2-segment box with its vertices pulled toward a sphere so the corners knock off */
function fist(w: number, h: number, d: number, round = 0.45): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d, 2, 1, 2).toNonIndexed();
  const p = g.getAttribute('position') as THREE.BufferAttribute, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.set(p.getX(i) / (w / 2), p.getY(i) / (h / 2), p.getZ(i) / (d / 2));
    const l = v.length(); if (l > 1e-6) v.multiplyScalar(THREE.MathUtils.lerp(1, 1 / l, round));
    p.setXYZ(i, v.x * w / 2, v.y * h / 2, v.z * d / 2);
  }
  return g;
}

/**
 * Sword model space: origin at the middle of the grip (between the two fists), +Y up the blade, +X across the
 * guard (the edges), +Z the flat facing the player's eye at rest. Blade 0.56 m, whole sword ≈ 0.78 m.
 * `sword` is the blade, guard, grip, pommel and the two fists on it (one draw); `arms` the forearms. The viewmodel's build
 * and the Model Explorer's gear cards (src/client/engine/models/gear.ts, src/shards/driftwood-isle/models/gear.ts) are this one function.
 */
export function buildSword(blade: 'wood' | 'iron'): { sword: THREE.BufferGeometry; arms: THREE.BufferGeometry; tipY: number; baseY: number } {
  const parts: THREE.BufferGeometry[] = [], armParts: THREE.BufferGeometry[] = [];
  const guardY = 0.085, bladeY0 = guardY + 0.014, L = 0.52, tipY = bladeY0 + L;
  // ── blade: hexagonal section, wide at the base, gently tapering, then a rounded (three-step) tip ──
  const bw = (y: number) => 0.044 - 0.010 * y / L; // half-width 4.4 → 3.4 cm (a chunky carved plank)
  const bt = (y: number) => 0.012 - 0.004 * y / L; // half-thickness 1.2 → 0.8 cm
  const rings: THREE.Vector3[][] = [];
  for (const f of [0, 0.25, 0.5, 0.72, 0.86]) rings.push(hexSection(bladeY0 + L * f, bw(L * f), bt(L * f)));
  rings.push(hexSection(bladeY0 + L * 0.93, bw(L) * 0.86, bt(L) * 0.9));
  rings.push(hexSection(bladeY0 + L * 0.975, bw(L) * 0.55, bt(L) * 0.65));
  rings.push(hexSection(bladeY0 + L * 0.995, bw(L) * 0.22, bt(L) * 0.35));
  rings.push(hexSection(tipY, 0.0005, 0.0003)); // rounded tip: collapses to a point over the last two rings
  const bladeCol = blade === 'iron' ? lin(0xc9ccd2) : C.blade;
  parts.push(paint(loft(rings), bladeCol, 0.045, 3));
  parts.push(paint(cap(ringAt(rings, 0), false), bladeCol, 0, 4));
  // ── guard: a plain bar, a touch thicker in the middle, ends knocked off ──
  const gw = 0.20, gh = 0.028, gd = 0.042;
  const gr = [
    [new THREE.Vector3(-gw / 2 + 0.012, guardY - gh / 2, -gd / 2 + 0.008), new THREE.Vector3(gw / 2 - 0.012, guardY - gh / 2, -gd / 2 + 0.008), new THREE.Vector3(gw / 2 - 0.012, guardY - gh / 2, gd / 2 - 0.008), new THREE.Vector3(-gw / 2 + 0.012, guardY - gh / 2, gd / 2 - 0.008)],
    [new THREE.Vector3(-gw / 2, guardY - gh / 2 + 0.006, -gd / 2), new THREE.Vector3(gw / 2, guardY - gh / 2 + 0.006, -gd / 2), new THREE.Vector3(gw / 2, guardY - gh / 2 + 0.006, gd / 2), new THREE.Vector3(-gw / 2, guardY - gh / 2 + 0.006, gd / 2)],
    [new THREE.Vector3(-gw / 2, guardY + gh / 2 - 0.006, -gd / 2), new THREE.Vector3(gw / 2, guardY + gh / 2 - 0.006, -gd / 2), new THREE.Vector3(gw / 2, guardY + gh / 2 - 0.006, gd / 2), new THREE.Vector3(-gw / 2, guardY + gh / 2 - 0.006, gd / 2)],
    [new THREE.Vector3(-gw / 2 + 0.012, guardY + gh / 2, -gd / 2 + 0.008), new THREE.Vector3(gw / 2 - 0.012, guardY + gh / 2, -gd / 2 + 0.008), new THREE.Vector3(gw / 2 - 0.012, guardY + gh / 2, gd / 2 - 0.008), new THREE.Vector3(-gw / 2 + 0.012, guardY + gh / 2, gd / 2 - 0.008)],
  ];
  const guardCol = blade === 'iron' ? lin(0x4a4a50) : C.guard;
  parts.push(paint(loft(gr), guardCol, 0.05, 5)); parts.push(paint(cap(ringAt(gr, 3), true), guardCol, 0, 6)); parts.push(paint(cap(ringAt(gr, 0), false), guardCol, 0, 7));
  // ── grip: octagonal leather core with three raised wrap bands; a short wooden tang collar under the guard ──
  parts.push(paint(loft([ring(-0.075, 0.0165, 8, 0.2), ring(guardY - 0.013, 0.0175, 8, 0.2)]), C.grip, 0.06, 8));
  for (const y of [-0.055, -0.012, 0.031]) {
    parts.push(paint(loft([ring(y - 0.008, 0.0165, 8, 0.2), ring(y - 0.006, 0.0195, 8, 0.2), ring(y + 0.006, 0.0195, 8, 0.2), ring(y + 0.008, 0.0165, 8, 0.2)]), C.wrap, 0.06, 9));
  }
  // ── pommel: a squat six-sided knob ──
  const pr = [ring(-0.078, 0.014, 6, 0.3), ring(-0.088, 0.024, 6, 0.3), ring(-0.104, 0.024, 6, 0.3), ring(-0.112, 0.013, 6, 0.3)];
  parts.push(paint(loft(pr), C.pommel, 0.06, 10)); parts.push(paint(cap(ringAt(pr, 3), false), C.pommel, 0, 11));
  // ── hands: two fists stacked on the grip (right hand above, left below), thumbs over the top toward the blade ──
  for (const [y, seed, upper] of [[0.037, 12, true], [-0.031, 13, false]] as [number, number, boolean][]) {
    const ry = upper ? 0.18 : -0.14;
    const add = (g: THREE.BufferGeometry, col: THREE.Color, sd: number) => { g.applyMatrix4(new THREE.Matrix4().makeRotationY(ry)); g.translate(0, y, 0); parts.push(paint(g, col, 0.035, sd)); };
    add(fist(0.086, 0.062, 0.078, 0.65), C.skin, seed);                              // palm + fingers wrapped round the grip
    for (let k = 0; k < 4; k++) add(xform(fist(0.019, 0.05, 0.03, 0.7), -0.031 + k * 0.021, 0.002, 0.038, 0, 0, 0), k % 2 ? C.skin : C.skinDark, seed + 1 + k); // finger ridges on the eye side
    add(xform(fist(0.05, 0.024, 0.03, 0.7), -0.008, 0.03, 0.028, 0.25, 0.15, -0.45), C.skinDark, seed + 10); // thumb over the top, toward the blade
  }
  // ── forearms: a wrist stub of skin then a wide cream sleeve, angled off toward the lower right / bottom of the frame ──
  const restInv = REST.q.clone().invert();
  const arm = (fromY: number, dirCam: THREE.Vector3, seed: number) => {
    const d = dirCam.clone().normalize().applyQuaternion(restInv), from = new THREE.Vector3(0, fromY, 0);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d); // tube +Y → down the arm
    const seg = (a: number, b: number, ra: number, rb: number, col: THREE.Color, s: number) => {
      const g = loft([ring(a, ra, 7), ring(b, rb, 7)]);
      g.applyQuaternion(q); g.translate(from.x, from.y, from.z);
      armParts.push(paint(g, col, 0.04, s));
    };
    seg(0.02, 0.10, 0.033, 0.037, C.skin, seed);                // wrist
    seg(0.095, 0.11, 0.038, 0.05, C.sleeveDark, seed + 1);      // cuff lip
    seg(0.11, 0.55, 0.05, 0.058, C.sleeve, seed + 2);           // sleeve to out of frame
  };
  arm(0.01, new THREE.Vector3(0.78, -0.56, 0.28), 30);   // right arm (upper fist): out to the lower-right corner
  arm(-0.058, new THREE.Vector3(0.3, -0.88, 0.34), 40);  // left arm (lower fist): down, a little toward the camera
  const sword = mergeGeometries(parts, false), arms = mergeGeometries(armParts, false);
  sword.computeBoundingSphere(); arms.computeBoundingSphere();
  return { sword, arms, tipY, baseY: bladeY0 };
}
