/**
 * The tiling ripple texture's pixels: RGB a tangent-space normal from a periodic fbm height field (value noise on integer
 * lattices, so it tiles), A a separate bubbly noise for the foam. RGBA, WATER_RIPPLES_N² texels.
 *
 * A pure function of this file, so `scripts/bake-water-ripples.mjs` writes it once to `WATER_RIPPLES_URL`
 * (boot/bakedApi.ts) and bake-check fails when the bytes go stale. A page that fetched that file gets the texture without
 * the ~17 ms march (Mac; ~25 ms of a forest page's world step at phone 4× CPU); any other page marches it here, byte for
 * byte the same in V8.
 */
export const WATER_RIPPLES_N = 256;

export function waterRipplePixels(): Uint8Array {
  const N = WATER_RIPPLES_N;
  const lattice = (seed: number, n: number): Float32Array => {
    const a = new Float32Array(n * n);
    let s = seed >>> 0;
    for (let i = 0; i < a.length; i++) { s = (s * 1664525 + 1013904223) >>> 0; a[i] = s / 4294967296; }
    return a;
  };
  /** periodic value noise: `n` cells across the tile, smoothstep-interpolated */
  const vnoise = (L: Float32Array, n: number, u: number, v: number): number => {
    const x = u * n, y = v * n, xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
    const x0 = ((xi % n) + n) % n, y0 = ((yi % n) + n) % n, x1 = (x0 + 1) % n, y1 = (y0 + 1) % n;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const a = L[y0 * n + x0] ?? 0, b = L[y0 * n + x1] ?? 0, c = L[y1 * n + x0] ?? 0, d = L[y1 * n + x1] ?? 0;
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  };
  const oct = [4, 8, 16, 32, 64].map((n, i) => ({ n, L: lattice(0x51f + i * 7919, n), w: 0.55 ** i }));
  const foamOct = [8, 16, 32, 64].map((n, i) => ({ n, L: lattice(0xf0a + i * 104729, n), w: 0.6 ** i }));
  const H = new Float32Array(N * N), Fm = new Float32Array(N * N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const u = x / N, v = y / N;
    let h = 0, f = 0;
    for (const o of oct) h += vnoise(o.L, o.n, u, v) * o.w;
    for (const o of foamOct) f += vnoise(o.L, o.n, u + 0.13, v + 0.29) * o.w;
    H[y * N + x] = h; Fm[y * N + x] = f;
  }
  // the foam: sharpen the fbm into bubbly clumps and stretch it to 0..1
  let fmin = Infinity, fmax = -Infinity;
  for (const f of Fm) { fmin = Math.min(fmin, f); fmax = Math.max(fmax, f); }
  const data = new Uint8Array(N * N * 4);
  const at = (xx: number, yy: number): number => H[((yy + N) % N) * N + ((xx + N) % N)] ?? 0;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const dx = (at(x + 1, y) - at(x - 1, y)) * 9, dy = (at(x, y + 1) - at(x, y - 1)) * 9, l = Math.hypot(dx, dy, 1);
    const i = (y * N + x) * 4;
    data[i] = Math.round((-dx / l * 0.5 + 0.5) * 255); data[i + 1] = Math.round((-dy / l * 0.5 + 0.5) * 255); data[i + 2] = Math.round((1 / l * 0.5 + 0.5) * 255);
    const f = ((Fm[y * N + x] ?? 0) - fmin) / Math.max(1e-6, fmax - fmin);
    data[i + 3] = Math.round(Math.min(1, Math.max(0, f)) ** 1.4 * 255);
  }
  return data;
}
