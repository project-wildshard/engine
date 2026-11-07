/**
 * The pond's two baked inputs (PH-L9), shared by the engine pond (pond.ts) and a shard that dresses it in its own water
 * look (Pine Hollow's graphs): the tiling ripple normal map and the skyline probe. The frozen classic shader that once
 * read them lives on in waterSurface.ts for the legacy copies only.
 */
import * as THREE from 'three';
import type { TreeInstance } from '../../../../shared/engine/world/forest/placement';
import { WATER_RIPPLES_URL } from '../../boot/bakedApi';
import { bakedBytes, loadCommonBytes } from '../../boot/bakedTextures';
import { WATER_RIPPLES_N, waterRipplePixels } from './ripplePixels';

/** the skyline texture's encoding: R = occluder top above the water (/ SKY_TOP m), G = its distance (/ SKY_DIST m),
 *  B = the bank's albedo where the occluder is the ground (/ BANK_MAX; 0 = a tree crown, drawn with the forest's albedo) */
export const SKY_TOP = 80, SKY_DIST = 400, BANK_MAX = 0.5;
const SKY_BINS = 512;
/** the shore's albedo in the reflection where the ground is the occluder: a bank's earth, a cliff's rock (E401) */
const BANK_EARTH = 0.12, BANK_ROCK = 0.3;

let texCache: THREE.DataTexture | null = null;

/** Fetch the baked ripple bytes (scripts/bake-water-ripples.mjs) so a later `waterTexture()` skips the march. */
export function preloadWaterRipples(): Promise<void> { return loadCommonBytes(WATER_RIPPLES_URL); }

/**
 * The tiling ripple texture (water/ripplePixels.ts): 256², mipmapped; built once, from the baked bytes when a page fetched
 * them (`preloadWaterRipples`), else marched here (~17 ms).
 */
export function waterTexture(): THREE.DataTexture {
  if (texCache) return texCache;
  const N = WATER_RIPPLES_N;
  const data = bakedBytes(WATER_RIPPLES_URL, N * N * 4) ?? waterRipplePixels();
  const t = new THREE.DataTexture(data, N, N, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true;
  t.anisotropy = 4;
  t.needsUpdate = true;
  texCache = t;
  return t;
}

/**
 * The pond's skyline probe: per azimuth round (cx, cz), the tallest thing on the horizon seen from the centre — each
 * pine's crown as a cone (its top `height` over its foot, ~0.2 × height wide), the terrain (the Ridge) — kept as (its top
 * above the water, its distance, and for the terrain its albedo: earth on a bank, rock where the face below it is steep,
 * E401). 512 bins, RGB8, linear, wrapping round the circle.
 */
export function buildSkyline(cx: number, cz: number, level: number, trees: readonly TreeInstance[], heightAt: (x: number, z: number) => number): THREE.DataTexture {
  const el = new Float32Array(SKY_BINS).fill(-1), top = new Float32Array(SKY_BINS), dist = new Float32Array(SKY_BINS).fill(60);
  const alb = new Float32Array(SKY_BINS); // −1 = a tree crown, until the pass below
  const put = (bin: number, h: number, d: number, albedo: number): void => {
    const k = ((bin % SKY_BINS) + SKY_BINS) % SKY_BINS, e = Math.atan2(h, d);
    if (e > (el[k] ?? -1)) { el[k] = e; top[k] = h; dist[k] = d; alb[k] = albedo; }
  };
  // the terrain: march out along each bin's azimuth; its albedo from the slope of the 6 m below the top (a cliff's face is
  // grey rock, a grassy bank darker earth)
  for (let k = 0; k < SKY_BINS; k++) {
    const a = ((k + 0.5) / SKY_BINS - 0.5) * Math.PI * 2, dx = Math.cos(a), dz = Math.sin(a);
    for (let d = 20; d < 380; d += d < 80 ? 1.5 : 4) {
      const h = heightAt(cx + dx * d, cz + dz * d), slope = (h - heightAt(cx + dx * (d - 6), cz + dz * (d - 6))) / 6;
      put(k, h - level, d, BANK_EARTH + (BANK_ROCK - BANK_EARTH) * THREE.MathUtils.smoothstep(slope, 0.5, 1.2));
    }
  }
  const groundTop = top.slice(), groundAlb = alb.slice();
  // the pines: a cone per crown over the bins it covers
  for (const t of trees) {
    const dx = t.x - cx, dz = t.z - cz, d = Math.hypot(dx, dz);
    if (d < 12 || d > 380) continue;
    const a0 = Math.atan2(dz, dx), crownR = Math.max(1.2, t.height * 0.13), half = Math.atan2(crownR, d);
    const k0 = Math.floor(((a0 - half) / (Math.PI * 2) + 0.5) * SKY_BINS), k1 = Math.ceil(((a0 + half) / (Math.PI * 2) + 0.5) * SKY_BINS);
    const tip = t.y + t.height - level;
    for (let k = k0; k <= k1; k++) {
      const ak = ((k + 0.5) / SKY_BINS - 0.5) * Math.PI * 2;
      let da = Math.abs(ak - a0); if (da > Math.PI) da = Math.PI * 2 - da;
      const off = Math.min(1, (Math.tan(da) * d) / crownR); // 0 on the trunk's line → 1 at the crown's edge
      put(k, tip - off * t.height * 0.55, d, -1);
    }
  }
  // a bin a crown tops keeps its ground's albedo over the share of the mirrored column the ground fills (a pine on the
  // cliff's lip darkens only its top), and the albedo is smoothed over ±2 bins so the rock doesn't mirror in stripes
  const mixed = new Float32Array(SKY_BINS);
  for (let k = 0; k < SKY_BINS; k++) {
    const a = alb[k] ?? 0, h = top[k] ?? 0;
    mixed[k] = a >= 0 ? a : (groundAlb[k] ?? 0) * Math.min(1, Math.max(0, (groundTop[k] ?? 0) / Math.max(h, 1e-3)));
  }
  for (let k = 0; k < SKY_BINS; k++) {
    let sum = 0;
    for (let j = -2; j <= 2; j++) sum += mixed[(k + j + SKY_BINS) % SKY_BINS] ?? 0;
    alb[k] = sum / 5;
  }
  const data = new Uint8Array(SKY_BINS * 4);
  for (let k = 0; k < SKY_BINS; k++) {
    data[k * 4] = Math.round(Math.min(1, Math.max(0, (top[k] ?? 0) / SKY_TOP)) * 255);
    data[k * 4 + 1] = Math.round(Math.min(1, Math.max(0, (dist[k] ?? 0) / SKY_DIST)) * 255);
    data[k * 4 + 2] = Math.round(Math.min(1, Math.max(0, (alb[k] ?? 0) / BANK_MAX)) * 255);
    data[k * 4 + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, SKY_BINS, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.wrapS = THREE.RepeatWrapping; tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearFilter; tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}
