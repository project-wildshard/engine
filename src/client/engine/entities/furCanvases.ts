/**
 * The creature fur's procedural canvases (moved from AnimalFactory for ONE-FORMAT OF3c2): the tileable strand albedo and
 * normal field the factory draws its fur with, and the value noise behind them. A `platform.skin` surface's `strands`
 * (format `fur-strands.ts`) draws the same canvases from the same numbers (render/families/strands.ts).
 */
import { Rng } from '@wildshard/format/seededRng';
import type { FurStyle } from '../../../shared/engine/entities/species/registry';


/** periodic value noise on a (px × py) lattice, sampled at (u,v) in [0,1) */
export function lattice(px: number, py: number, rng: Rng): (u: number, v: number) => number {
  const grid = new Float32Array(px * py);
  for (let i = 0; i < grid.length; i++) grid[i] = rng.next();
  const sm = (t: number) => t * t * (3 - 2 * t);
  return (u: number, v: number) => {
    const x = (u * px) % px, y = (v * py) % py;
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const fx = sm(x - x0), fy = sm(y - y0);
    const x1 = (x0 + 1) % px, y1 = (y0 + 1) % py;
    const a = grid[y0 * px + x0] ?? 0, b = grid[y0 * px + x1] ?? 0, c = grid[y1 * px + x0] ?? 0, d = grid[y1 * px + x1] ?? 0;
    return (a + (b - a) * fx) + ((c + (d - c) * fx) - (a + (b - a) * fx)) * fy;
  };
}

export function makeFurCanvases(seed: number, opts: FurStyle['tex']): { ca: HTMLCanvasElement; cn: HTMLCanvasElement } {
  const S = 512;
  const rng = new Rng(seed);
  // fur strands: narrow across (x, ~2-3 mm at TEX_M), long along (y)
  const f0 = lattice(30, 5, rng), f1 = lattice(112, 14, rng), f2 = lattice(224, 28, rng), f3 = lattice(448, 56, rng); // f0 = 1 cm tufts, visible at 5 m
  const m1 = lattice(6, 6, rng), m2 = lattice(12, 12, rng), m3 = lattice(24, 24, rng);
  const ph = lattice(128, 8, rng);       // per-strand phase so root/tip breaks don't line up
  const height = new Float32Array(S * S);
  const albedo = new Float32Array(S * S);
  const L = opts.strandLen;              // strand segments per texture repeat along v
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const u = x / S, v = y / S;
    // wobble the strands so they aren't perfectly parallel
    const wob = (m3(u, v) - 0.5) * 0.03;
    const fur = f0(u + wob * 3, v) * 0.35 + f1(u + wob, v) * 0.35 + f2(u + wob * 2, v) * 0.2 + f3(u, v) * 0.1;
    const mott = m1(u, v) * 0.55 + m2(u, v) * 0.3 + m3(u, v) * 0.15;
    // root → tip: each strand segment is dark at its root and pale at its tip
    const seg = (v * L + ph(u, v) * 1.7) % 1;
    const tip = seg * seg;
    const i = y * S + x;
    height[i] = fur * 0.7 + tip * 0.3;
    // grizzle: sparse pale guard-hair tips
    const g = opts.grizzle > 0 ? Math.max(0, f1(u, v) * 0.6 + f0(u, v) * 0.4 - 0.58) * 1.6 * opts.grizzle * (0.4 + tip) : 0;   // pale guard-hair streaks, not sparkles
    albedo[i] = 1 - opts.contrast * (0.55 - fur) - 0.2 * (mott - 0.5) * (1 + opts.bristle) - opts.root * (1 - tip) + g;
  }
  // albedo canvas (values ≤ 1 → material colour is carried by vertex colours)
  const ca = document.createElement('canvas'); ca.width = S; ca.height = S;
  const ga = canvas2d(ca);
  const ia = ga.createImageData(S, S);
  for (let i = 0; i < S * S; i++) {
    const a = Math.min(1, Math.max(0.2, (albedo[i] ?? 0) + 0.12));
    const v = Math.round(a * 255);
    ia.data[i * 4] = v; ia.data[i * 4 + 1] = Math.round(v * 0.985); ia.data[i * 4 + 2] = Math.round(v * 0.96); ia.data[i * 4 + 3] = 255;
  }
  ga.putImageData(ia, 0, 0);
  // normal map from the strand height field
  const cn = document.createElement('canvas'); cn.width = S; cn.height = S;
  const gn = canvas2d(cn);
  const inn = gn.createImageData(S, S);
  const k = opts.normalStrength * 18;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const l = height[y * S + ((x - 1 + S) % S)] ?? 0, r = height[y * S + ((x + 1) % S)] ?? 0;
    const d = height[((y - 1 + S) % S) * S + x] ?? 0, u = height[((y + 1) % S) * S + x] ?? 0;
    let nx = -(r - l) * k, ny = -(u - d) * k * 0.7, nz = 1;
    const len = Math.hypot(nx, ny, nz); nx /= len; ny /= len; nz /= len;
    const i = (y * S + x) * 4;
    inn.data[i] = Math.round((nx * 0.5 + 0.5) * 255); inn.data[i + 1] = Math.round((ny * 0.5 + 0.5) * 255); inn.data[i + 2] = Math.round((nz * 0.5 + 0.5) * 255); inn.data[i + 3] = 255;
  }
  gn.putImageData(inn, 0, 0);
  return { ca, cn };
}

/** the 2d context of a canvas we just created (getContext is typed nullable; it only fails when the browser is out of contexts) */
export function canvas2d(c: HTMLCanvasElement): CanvasRenderingContext2D {
  const g = c.getContext('2d');
  if (g === null) throw new Error('AnimalFactory: could not get a 2d canvas context');
  return g;
}
