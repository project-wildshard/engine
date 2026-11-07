import { pondGrid } from './pondGrid';
import * as THREE from 'three';
import { POND, waterLevel, heightAt } from '../../../shared/engine/world/Heightfield';
import type { SkyRig as Sky } from './skyRig';
import { Rng } from '../../../shared/engine/core/rng';
import { Noise2D } from '../../../shared/engine/core/noise';
import { SEED } from '../../../shared/engine/core/config';
import { buildSkyline, waterTexture } from './water/ripples';
import { patchWindField } from './wind';
import type { TreeInstance } from '../../../shared/engine/world/forest/placement';
import { PATCH_ORDER, patchShader } from '../render/shaderPatches';

// ── the lily pads ────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * ~110 lily pads in clusters on the pond's shallows (0.3–1.6 m), a few white water lilies among them: one static mesh in
 * world space (one draw), each pad turning and bobbing about its own centre on the shared wind (`windGustAt`).
 */
function buildLilies(sky: Sky, exclusions: readonly { x: number; z: number; r: number }[]): THREE.Mesh | null {
  const wl = waterLevel(), rng = new Rng(SEED + 4411), cluster = new Noise2D(SEED + 4412);
  const pads: { x: number; z: number; r: number; rot: number; flower: boolean; hue: number }[] = [];
  for (let i = 0; i < 6000 && pads.length < 110; i++) {
    const a = rng.range(0, Math.PI * 2), d = Math.sqrt(rng.next()) * (POND.r + 8);
    const x = POND.x + Math.cos(a) * d, z = POND.z + Math.sin(a) * d, depth = wl - heightAt(x, z);
    if (depth < 0.3 || depth > 1.6) continue;
    if (cluster.fbm(x * 0.07, z * 0.07, 2) < 0.18) continue;
    if (exclusions.some((spot) => Math.hypot(x - spot.x, z - spot.z) < spot.r)) continue;
    const r = rng.range(0.12, 0.27);
    if (pads.some((p) => Math.hypot(p.x - x, p.z - z) < p.r + r + 0.03)) continue;
    pads.push({ x, z, r, rot: rng.range(0, Math.PI * 2), flower: false, hue: rng.next() });
  }
  if (pads.length === 0) return null;
  for (let i = 0; i < pads.length; i += 13) { const p = pads[i]; if (p) p.flower = true; }
  const pos: number[] = [], col: number[] = [], nrm: number[] = [], pad: number[] = [];
  const vert = (x: number, y: number, z: number, c: readonly [number, number, number], n: readonly [number, number, number], p: { x: number; z: number }, ph: number): void => {
    pos.push(x, y, z); col.push(c[0], c[1], c[2]); nrm.push(n[0], n[1], n[2]); pad.push(p.x, p.z, ph);
  };
  const up = [0, 1, 0] as const;
  for (const p of pads) {
    const y0 = wl + 0.012, ph = p.hue * 40, segs = 14, notch = 0.32;
    const aged = p.hue > 0.86;
    const inner: [number, number, number] = aged ? [0.16, 0.11, 0.035] : [0.035 + p.hue * 0.02, 0.075 + p.hue * 0.03, 0.02];
    const rim: [number, number, number] = aged ? [0.22, 0.12, 0.04] : [0.055 + p.hue * 0.03, 0.11 + p.hue * 0.04, 0.03];
    const curl = p.hue > 0.6 ? 0.012 : 0.004;
    for (let s = 0; s < segs; s++) {
      const a0 = p.rot + notch / 2 + (s / segs) * (Math.PI * 2 - notch), a1 = p.rot + notch / 2 + ((s + 1) / segs) * (Math.PI * 2 - notch);
      const stripe = s % 2 === 0 ? 1 : 0.9;
      const r0: [number, number, number] = [rim[0] * stripe, rim[1] * stripe, rim[2] * stripe];
      vert(p.x, y0 + 0.003, p.z, inner, up, p, ph);
      vert(p.x + Math.cos(a1) * p.r, y0 + curl, p.z + Math.sin(a1) * p.r, r0, up, p, ph);
      vert(p.x + Math.cos(a0) * p.r, y0 + curl, p.z + Math.sin(a0) * p.r, r0, up, p, ph);
    }
    if (!p.flower) continue;
    // a white water lily: two rings of eight petals cupped upward round a yellow heart
    const fx = p.x + Math.cos(p.rot + Math.PI) * p.r * 0.3, fz = p.z + Math.sin(p.rot + Math.PI) * p.r * 0.3, fy = y0 + 0.015;
    const fc = { x: p.x, z: p.z };
    for (const [ring, len, lift, off] of [[0, 0.085, 0.45, 0], [1, 0.065, 0.95, Math.PI / 8]] as const) {
      for (let k = 0; k < 8; k++) {
        const a = off + (k / 8) * Math.PI * 2, w = 0.022, ca = Math.cos(a), sa = Math.sin(a);
        const tipX = fx + ca * len * Math.cos(lift), tipZ = fz + sa * len * Math.cos(lift), tipY = fy + len * Math.sin(lift);
        const bx = -sa * w, bz = ca * w;
        const base: [number, number, number] = ring === 0 ? [0.78, 0.76, 0.7] : [0.9, 0.86, 0.82];
        const tip: [number, number, number] = [0.95, 0.82, 0.84];
        const n: [number, number, number] = [-ca * Math.sin(lift), Math.cos(lift), -sa * Math.sin(lift)];
        const mx = fx + ca * len * 0.5 * Math.cos(lift), mz = fz + sa * len * 0.5 * Math.cos(lift), my = fy + len * 0.5 * Math.sin(lift);
        vert(fx, fy, fz, base, n, fc, ph); vert(mx + bx, my, mz + bz, base, n, fc, ph); vert(tipX, tipY, tipZ, tip, n, fc, ph);
        vert(fx, fy, fz, base, n, fc, ph); vert(tipX, tipY, tipZ, tip, n, fc, ph); vert(mx - bx, my, mz - bz, base, n, fc, ph);
      }
    }
    const heart: [number, number, number] = [0.95, 0.72, 0.12];
    for (let k = 0; k < 6; k++) {
      const a0 = (k / 6) * Math.PI * 2, a1 = ((k + 1) / 6) * Math.PI * 2, r = 0.02;
      vert(fx, fy + 0.03, fz, heart, up, fc, ph);
      vert(fx + Math.cos(a1) * r, fy + 0.012, fz + Math.sin(a1) * r, heart, up, fc, ph);
      vert(fx + Math.cos(a0) * r, fy + 0.012, fz + Math.sin(a0) * r, heart, up, fc, ph);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setAttribute('aPad', new THREE.Float32BufferAttribute(pad, 3));
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0, side: THREE.DoubleSide });
  patchShader(mat, 'engine.pond-lilies', PATCH_ORDER.material, (shader) => {
    patchWindField(shader);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aPad;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        {
          // each pad turns a little about its centre and bobs as the gusts cross the pond; the lot drifts downwind
          float g = windGustAt( aPad.xy );
          float ang = 0.07 * g * sin( uWindTime * 0.45 + aPad.z );
          vec2 rel = transformed.xz - aPad.xy;
          float c = cos( ang ), s = sin( ang );
          transformed.xz = aPad.xy + vec2( c * rel.x - s * rel.y, s * rel.x + c * rel.y ) + windDirXZ() * 0.04 * g * ( 0.6 + 0.4 * sin( uWindTime * 0.3 + aPad.z ) );
          transformed.y += 0.006 * g * sin( uWindTime * 1.7 + aPad.z * 1.3 + rel.x * 9.0 );
        }`);
  }, { mode: 'replace', key: 'ph-lilies' });
  sky.setupMaterial(mat);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'lily-pads';
  mesh.receiveShadow = true;
  return mesh;
}

/** the pond surface's grid: a square `half` m round the pond's centre in `segs` cells a side (a body that meets the pond
 *  across a `pondClip` lays its cells on the same grid) */

/**
 * The still pond (PH-L9, the user's pick PH-U28). `group` holds the surface (`mesh`) and the lily pads.
 *
 * One draw, no extra render pass. The engine builds the surface (per-vertex depth in `aWater`, the wet film draped on the
 * bank) and its two baked inputs (water/ripples.ts: the ripple normal map and the skyline probe of `forest.trees` and the
 * terrain, kept in `userData.waterSkyline`); the shard dresses it in its own water look. (The pre-remaster planar
 * reflection, a mirrored second scene render, went in E162.)
 */
export class Water {
  readonly group: THREE.Group = new THREE.Group();
  /** the pond's surface */
  mesh!: THREE.Mesh;
  /** the lily pads + a few flowers (one mesh, bobbing on the wind) */
  lilies: THREE.Mesh | null = null;

  private sky: Sky;
  private trees: readonly TreeInstance[];
  private readonly policy: { clip?: (x: number, z: number) => boolean; lilyExclusions?: readonly { x: number; z: number; r: number }[] };
  constructor(sky: Sky, trees: readonly TreeInstance[] = [], policy: { clip?: (x: number, z: number) => boolean; lilyExclusions?: readonly { x: number; z: number; r: number }[] } = {}) {
    this.sky = sky;
    this.trees = trees;
    this.policy = policy;
  }

  build(): this {
    this.mesh = this.buildProbe();
    this.group.add(this.mesh);
    this.lilies = buildLilies(this.sky, this.policy.lilyExclusions ?? []);
    if (this.lilies) this.group.add(this.lilies);
    return this;
  }

  private buildProbe(): THREE.Mesh {
    const wl = waterLevel(), { half, segs } = pondGrid(POND);
    const skyline = buildSkyline(POND.x, POND.z, wl, this.trees, heightAt);
    // a plain stand-in until the shard dresses the pond in its own water look (it borrows this normal map and the probe)
    const material = new THREE.MeshPhysicalMaterial({ roughness: 0.04, ior: 1.333, transparent: true, depthWrite: false, normalMap: waterTexture() });
    this.sky.setupMaterial(material);
    const n = segs + 1, pos = new Float32Array(n * n * 3), uv = new Float32Array(n * n * 2), aw = new Float32Array(n * n * 4);
    const depth = new Float32Array(n * n);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const k = j * n + i, x = POND.x - half + (i / segs) * half * 2, z = POND.z - half + (j / segs) * half * 2;
      const h = heightAt(x, z), d = wl - h;
      depth[k] = d;
      // just above the water line the surface drapes onto the bank: the wet film (depth < 0)
      const y = d < 0 && d > -0.45 ? h + 0.05 : wl;
      pos[k * 3] = x; pos[k * 3 + 1] = y; pos[k * 3 + 2] = z;
      uv[k * 2] = x; uv[k * 2 + 1] = z;
      aw[k * 4] = d; aw[k * 4 + 1] = 0; aw[k * 4 + 2] = 0; aw[k * 4 + 3] = 2.4; // peaty still water: 2.4 / m
    }
    const idx: number[] = [];
    const dry = (k: number): boolean => (depth[k] ?? 0) < -0.45;
    // another water body's reach inside the square (a complementary pond surface, E322 F-L6), by each cell's centre: that body
    // draws the complementary cells on this same grid (the level surface builder), so the two meet with no gap or overlap
    const clip = this.policy.clip, cell = (half * 2) / segs;
    for (let j = 0; j < segs; j++) for (let i = 0; i < segs; i++) {
      const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
      if (dry(a) && dry(b) && dry(c) && dry(d)) continue; // under the bank everywhere: never seen
      if (clip?.(POND.x - half + (i + 0.5) * cell, POND.z - half + (j + 0.5) * cell)) continue;
      idx.push(a, c, b, b, c, d);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setAttribute('aWater', new THREE.BufferAttribute(aw, 4));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, material);
    mesh.name = 'pond';
    // the probe, for a shard that dresses the pond in its own water look (Pine Hollow's graphs)
    mesh.userData['waterSkyline'] = skyline;
    mesh.receiveShadow = true;
    mesh.renderOrder = 5;
    return mesh;
  }
}
