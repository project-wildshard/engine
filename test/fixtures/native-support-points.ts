// Original native support-point kernel retained only as the independent bake reference.
import * as THREE from 'three';

const DIRS: number[] = (() => {
  const p = new THREE.IcosahedronGeometry(1, 2).getAttribute('position'), seen = new Set<string>(), out: number[] = [];
  for (let i = 0; i < p.count; i++) {
    const key = `${p.getX(i).toFixed(4)},${p.getY(i).toFixed(4)},${p.getZ(i).toFixed(4)}`;
    if (!seen.has(key)) { seen.add(key); out.push(p.getX(i), p.getY(i), p.getZ(i)); }
  }
  return out;
})();

/** the support points of `g` under `m` (x, y, z each) */
export function supportPoints(g: THREE.BufferGeometry, m: THREE.Matrix4): Float32Array {
  const pos = g.getAttribute('position'), v = new THREE.Vector3(), pts: number[] = [];
  for (let i = 0; i < pos.count; i++) { v.fromBufferAttribute(pos, i).applyMatrix4(m); pts.push(v.x, v.y, v.z); }
  const picked = new Set<number>();
  for (let d = 0; d < DIRS.length; d += 3) {
    const dx = DIRS[d] ?? 0, dy = DIRS[d + 1] ?? 0, dz = DIRS[d + 2] ?? 0;
    let best = -Infinity, at = 0;
    for (let i = 0; i < pts.length; i += 3) { const s = (pts[i] ?? 0) * dx + (pts[i + 1] ?? 0) * dy + (pts[i + 2] ?? 0) * dz; if (s > best) { best = s; at = i; } }
    picked.add(at);
  }
  const out = new Float32Array(picked.size * 3);
  let k = 0;
  for (const i of picked) { out[k++] = pts[i] ?? 0; out[k++] = pts[i + 1] ?? 0; out[k++] = pts[i + 2] ?? 0; }
  return out;
}
