/**
 * The engine's tileable cloud fbm (SF67, E461): 512² six-octave simplex noise sampled on a torus, so both axes wrap
 * without seams. One grey byte per texel, rows top to bottom (a canvas's order).
 *
 * It is a pure function of this file and `core/noise.ts`, so `scripts/bake-cloud-field.mjs` writes it once to
 * `CLOUD_FIELD_URL` (boot/bakedApi.ts) (bake-check fails when the bytes go stale) and a level that declares that file in its boot gets the
 * texture without the ~400 ms task (4× CPU) the march costs; any other page marches it here, byte for byte the same in V8.
 *
 *   const grey = cloudFieldPixels();            // Uint8ClampedArray, CLOUD_FIELD_N² bytes
 */
import { Noise2D } from '../../../shared/engine/core/noise';

export const CLOUD_FIELD_N = 512;

/** The field marched in code: what the bake holds. */
export function cloudFieldPixels(): Uint8ClampedArray {
  const N = CLOUD_FIELD_N;
  const out = new Uint8ClampedArray(N * N);
  const n = new Noise2D(1234);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const u = (x / N) * Math.PI * 2, v = (y / N) * Math.PI * 2;
    const px = Math.cos(u) * 1.5, py = Math.sin(u) * 1.5, pz = Math.cos(v) * 1.5, pw = Math.sin(v) * 1.5;
    let s = 0, amp = 0.5, norm = 0;
    for (let o = 0; o < 6; o++) { const f = 2 ** o; s += (n.get((px + pz * 0.7) * f, (py + pw * 0.7) * f + o * 7.3) * 0.5 + 0.5) * amp; norm += amp; amp *= 0.55; }
    s /= norm;
    out[y * N + x] = s * 255; // Uint8ClampedArray rounds exactly as the ImageData store did
  }
  return out;
}
