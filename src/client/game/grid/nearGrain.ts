/** Pixel width of the shared tileable near-placeholder grain. */
export const NEAR_GRAIN_SIZE = 128;

/** Preserve the shipped noise bytes while hashing each octave's lattice only once. */
export function nearGrainBytes(): Uint8Array {
  const n = NEAR_GRAIN_SIZE, field = new Float32Array(n * n);
  const hash = (x: number, y: number, o: number): number => {
    let h = Math.imul(x ^ 0x27d4eb2f, 0x85ebca6b) ^ Math.imul(y ^ 0x165667b1, 0xc2b2ae35) ^ Math.imul(o + 1, 0x9e3779b9);
    h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d); h = Math.imul(h ^ (h >>> 12), 0x297a2d39); h ^= h >>> 15; return (h >>> 0) / 4294967296;
  };
  for (const [cells, weight, octave] of [[8, 0.5, 0], [16, 0.3, 1], [32, 0.2, 2]] as const) {
    // Keep the hash's double precision until interpolation reaches the original Float32 field.
    const lattice = new Float64Array(cells * cells), size = n / cells;
    for (let y = 0; y < cells; y++) for (let x = 0; x < cells; x++) lattice[y * cells + x] = hash(x, y, octave);
    // Rows within one lattice cell use the same horizontal interpolation.
    // Keep only the current pair at double precision, then apply each pixel
    // row's vertical interpolation in the original Float32 accumulation order.
    const horizontal = new Float64Array(n * 2);
    let cached = -1;
    for (let y = 0; y < n; y++) {
      const v = y / size, j = Math.floor(v), fv = v - j, sv = fv * fv * (3 - 2 * fv);
      if (cached !== j) {
        const row = j * cells, nextRow = ((j + 1) % cells) * cells;
        for (let x = 0; x < n; x++) {
          const u = x / size, i = Math.floor(u), fu = u - i, su = fu * fu * (3 - 2 * fu), next = (i + 1) % cells;
          const a = lattice[row + i] ?? 0, b = lattice[row + next] ?? 0;
          const c = lattice[nextRow + i] ?? 0, d = lattice[nextRow + next] ?? 0;
          horizontal[x] = a + (b - a) * su; horizontal[n + x] = c + (d - c) * su;
        }
        cached = j;
      }
      for (let x = 0; x < n; x++) {
        const top = horizontal[x] ?? 0, bottom = horizontal[n + x] ?? 0;
        field[y * n + x] = (field[y * n + x] ?? 0) + weight * (top + (bottom - top) * sv);
      }
    }
  }
  let lo = Infinity, hi = -Infinity; for (const f of field) { lo = Math.min(lo, f); hi = Math.max(hi, f); }
  return Uint8Array.from(field, f => Math.round(((f - lo) / Math.max(1e-6, hi - lo)) * 255));
}
