/**
 * The sky's procedural textures (cloud field, banded planet, gas giant), as pure canvas painters with no boot, level or
 * table state, so the pixel bake (`scripts/bake-textures.mjs`, SF87 / G320) renders them in a bake page that loads only
 * this module and its noise, never the game. `world/skyBackdrop.ts` paints them at runtime when the build has no file.
 *
 *   const clouds = cloudTexture(cloudFieldPixels());   // 512² grey fbm, repeat-wrapped
 *   const bands = giantTexture();                       // 512 × 256 gas-giant bands, seeded
 */
import * as THREE from 'three';
import { Noise2D } from '../../../shared/engine/core/noise';
import { Rng } from '../../../shared/engine/core/rng';
import { CLOUD_FIELD_N } from './cloudField';

/** A canvas's 2D context, or a thrown error naming the sky. */
export function ctx2d(c: HTMLCanvasElement): CanvasRenderingContext2D {
  const g = c.getContext('2d');
  if (!g) throw new Error('[sky] no 2d canvas context');
  return g;
}

/** The tileable cloud fbm as a repeat-wrapped canvas texture, from its CLOUD_FIELD_N² grey bytes (`world/cloudField.ts`). */
export function cloudTexture(grey: ArrayLike<number>): THREE.CanvasTexture {
  const N = CLOUD_FIELD_N;
  const c = document.createElement('canvas'); c.width = c.height = N;
  const g = ctx2d(c);
  const img = g.createImageData(N, N);
  for (let p = 0; p < N * N; p++) { const s = grey[p] ?? 0, i = p * 4; img.data[i] = img.data[i + 1] = img.data[i + 2] = s; img.data[i + 3] = 255; }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
}

/** The ringed planet's latitude bands (1024 × 512), seeded so the bake (`scripts/bake-textures.mjs`, name `planet`) reproduces. */
export function planetTexture(): THREE.CanvasTexture {
  const rng = new Rng(4242);
  const c = document.createElement('canvas'); c.width = 1024; c.height = 512;
  const g = ctx2d(c);
  const bands = ['#d9d3c6', '#c4b8a6', '#e6e0d4', '#b8a996', '#d2c9ba', '#a8998a', '#e3dccf', '#c9bcab'];
  for (let y = 0; y < 512; y++) {
    const t = y / 512;
    const k = t * bands.length + Math.sin(t * 37) * 0.6 + Math.sin(t * 91) * 0.25;
    const b = bands[Math.floor(Math.abs(k)) % bands.length];
    if (b === undefined) continue;
    g.fillStyle = b; g.globalAlpha = 0.9 + 0.1 * Math.sin(y * 0.2);
    g.fillRect(0, y, 1024, 1);
  }
  g.globalAlpha = 0.18;
  for (let i = 0; i < 90; i++) {
    g.fillStyle = i % 3 ? '#ffffff' : '#8a7a68'; g.beginPath();
    g.ellipse(rng.next() * 1024, rng.next() * 512, 30 + rng.next() * 140, 3 + rng.next() * 7, 0, 0, Math.PI * 2); g.fill();
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

/**
 * The gas giant's bands (`ChunkSky.planet`): cream / tan / rust latitude bands with turbulent edges and
 * a few storm ovals, wrapping seamlessly in longitude (noise sampled on a circle). Seeded so the bake is
 * reproducible (scripts/bake-textures.mjs, name `giant`).
 */
export function giantTexture(): THREE.CanvasTexture {
  const W = 512, H = 256;
  const rng = new Rng(7171), n = new Noise2D(7171);
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = ctx2d(c);
  const img = g.createImageData(W, H);
  // colour stops down the latitude (0 = south pole … 1 = north pole)
  const stops: [number, [number, number, number]][] = [
    [0.0, [200, 180, 150]], [0.08, [230, 214, 184]], [0.16, [196, 156, 108]], [0.24, [240, 228, 202]], [0.3, [172, 104, 64]],
    [0.36, [234, 218, 188]], [0.43, [208, 168, 118]], [0.5, [246, 236, 214]], [0.56, [190, 136, 90]], [0.62, [228, 208, 176]],
    [0.7, [156, 92, 58]], [0.76, [236, 222, 196]], [0.84, [200, 164, 118]], [0.92, [224, 204, 174]], [1.0, [188, 168, 142]],
  ];
  const ramp = (vIn: number, out: [number, number, number]) => {
    const v = Math.min(1, Math.max(0, vIn));
    let i = 0; for (; i < stops.length - 2; i++) { const next = stops[i + 1]; if (!next || !(next[0] < v)) break; }
    const s0 = stops[i], s1 = stops[i + 1];
    if (!s0 || !s1) return;
    const [v0, c0] = s0, [v1, c1] = s1;
    const u = Math.min(1, Math.max(0, (v - v0) / (v1 - v0)));
    const e = u * u * (3 - 2 * u) * 0.6 + u * 0.4; // soft-ish band edges
    out[0] = c0[0] + (c1[0] - c0[0]) * e; out[1] = c0[1] + (c1[1] - c0[1]) * e; out[2] = c0[2] + (c1[2] - c0[2]) * e;
  };
  const col: [number, number, number] = [0, 0, 0];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const u = (x / W) * Math.PI * 2, v = y / H;
    const cu = Math.cos(u), su = Math.sin(u);
    // turbulence: seamless in u (circle), stretched along the bands
    const t1 = n.fbm(cu * 1.4 + v * 9.0, su * 1.4 + 3.0, 3);
    const t2 = n.get(cu * 4.0 + v * 22.0, su * 4.0 + 11.0);
    ramp(v + t1 * 0.035 + t2 * 0.008, col);
    const shade = 0.96 + 0.04 * n.get(cu * 3 + v * 30, su * 3 + 5);
    const i = (y * W + x) * 4; img.data[i] = col[0] * shade; img.data[i + 1] = col[1] * shade; img.data[i + 2] = col[2] * shade; img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  // storm ovals: a couple of rust spots and pale eddies riding the bands
  for (let i = 0; i < 14; i++) {
    const big = i < 2;
    g.globalAlpha = big ? 0.55 : 0.3;
    g.fillStyle = big ? '#b0603e' : i % 3 ? '#f4eee0' : '#a97a52';
    g.beginPath();
    g.ellipse(rng.next() * W, H * (0.2 + rng.next() * 0.6), big ? 22 + rng.next() * 14 : 8 + rng.next() * 16, big ? 9 + rng.next() * 4 : 2.5 + rng.next() * 3, 0, 0, Math.PI * 2);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.RepeatWrapping; return t;
}
