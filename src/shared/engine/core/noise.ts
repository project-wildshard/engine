// 2D simplex noise (Stefan Gustavson's reference implementation, seeded permutation).
import { Rng } from './rng';

const F2 = 0.5 * (Math.sqrt(3) - 1);
const G2 = (3 - Math.sqrt(3)) / 6;
const grad3: readonly (readonly [number, number])[] = [[1, 1], [-1, 1], [1, -1], [-1, -1], [1, 0], [-1, 0], [0, 1], [0, -1]];
const G_NONE: readonly [number, number] = [0, 0]; // never hit: `% 8` keeps the index in range; satisfies noUncheckedIndexedAccess

export class Noise2D {
  private perm = new Uint8Array(512);
  constructor(seed: number) {
    const rng = new Rng(seed);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) { const j = Math.floor(rng.next() * (i + 1)); [p[i], p[j]] = [p[j] ?? 0, p[i] ?? 0]; }
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255] ?? 0;
  }
  /** returns roughly [-1, 1] */
  get(xin: number, yin: number): number {
    const perm = this.perm;
    const s = (xin + yin) * F2;
    const i = Math.floor(xin + s), j = Math.floor(yin + s);
    const t = (i + j) * G2;
    const x0 = xin - (i - t), y0 = yin - (j - t);
    const i1 = x0 > y0 ? 1 : 0, j1 = x0 > y0 ? 0 : 1;
    const x1 = x0 - i1 + G2, y1 = y0 - j1 + G2;
    const x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2;
    const ii = i & 255, jj = j & 255;
    let n = 0;
    let t0 = 0.5 - x0 * x0 - y0 * y0;
    if (t0 > 0) { const g = grad3[(perm[ii + (perm[jj] ?? 0)] ?? 0) % 8] ?? G_NONE; t0 *= t0; n += t0 * t0 * (g[0] * x0 + g[1] * y0); }
    let t1 = 0.5 - x1 * x1 - y1 * y1;
    if (t1 > 0) { const g = grad3[(perm[ii + i1 + (perm[jj + j1] ?? 0)] ?? 0) % 8] ?? G_NONE; t1 *= t1; n += t1 * t1 * (g[0] * x1 + g[1] * y1); }
    let t2 = 0.5 - x2 * x2 - y2 * y2;
    if (t2 > 0) { const g = grad3[(perm[ii + 1 + (perm[jj + 1] ?? 0)] ?? 0) % 8] ?? G_NONE; t2 *= t2; n += t2 * t2 * (g[0] * x2 + g[1] * y2); }
    return 70 * n;
  }
  fbm(x: number, y: number, octaves = 5, lacunarity = 2, gain = 0.5): number {
    let a = 1, f = 1, sum = 0, norm = 0;
    for (let o = 0; o < octaves; o++) { sum += a * this.get(x * f, y * f); norm += a; a *= gain; f *= lacunarity; }
    return sum / norm;
  }
  /** ridged multifractal, [0,1] */
  ridged(x: number, y: number, octaves = 4): number {
    let a = 1, f = 1, sum = 0, norm = 0;
    for (let o = 0; o < octaves; o++) { const n = 1 - Math.abs(this.get(x * f, y * f)); sum += a * n * n; norm += a; a *= 0.5; f *= 2.1; }
    return sum / norm;
  }
}

export const smoothstep = (a: number, b: number, x: number): number => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
export const clamp = (x: number, a: number, b: number): number => Math.min(b, Math.max(a, x));
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
