import { TREE_SPECS, treeSetOf } from './treeSpec';
import type { TreeSpec, ForestSpec, TerrainField } from '../../level/data';
/**
 * Where the forest and the forest floor go — the pure part of Forest / Undergrowth, shared by the game
 * and by the build (scripts/bake-chunk.mjs, project/archive/2026-09-22-load-perf.md). Nothing here touches the GPU or
 * the DOM: seeded Rng / Noise2D and the Heightfield functions of the active chunk.
 *
 * The undergrowth pass is the expensive one: ~10^5 candidates, each run through the trail / cabin /
 * pond / slope / splat tests and a tree query, to keep ~20 k. Every one of those tests is pure and none
 * draws from the rng, so the whole outcome of a candidate is one bit: kept or not. The build runs the
 * tests once (`DecisionLog.record`), and stores the bits — ~17 KB — in the chunk's terrain.bin; the phone
 * replays them (`DecisionLog.replay`): the same rng stream, the same candidate positions, the kept ones
 * built exactly as before (their height, normal and colour recomputed from the same pure functions), the
 * rest skipped without a test. Same scene, byte for byte; a stale or foreign log is caught by the
 * placement checksum and the tests run instead.
 */
import * as THREE from 'three';
import { CHUNK_HALF, CHUNK_SIZE, TREE_COUNT, SEED } from '../../core/config';
import { Rng } from '../../core/rng';
import { Noise2D, smoothstep, lerp } from '../../core/noise';
import { heightAt, normalAt, splatAt, trailDistance, cabinMask, inChunk, pondMask, waterLevel, POND } from '../Heightfield';
import { activeLevel } from '../../level/selection';
import type { TreeSpecies, SpeciesWeights, TreeSpeciesTraits, TreeSetVariant } from '../../../../client/engine/world/forest/treeSpecies';


export interface TreeInstance { x: number; y: number; z: number; r: number; variant: number; scale: number; rot: number; height: number; tint: THREE.Color; species?: TreeSpecies | undefined }

/**
 * The soft canopy density over the chunk (`n` x `n` cells, row-major, z rows): each tree's crown as a disc of radius
 * 0.16 x its height, summed and capped at 1. The ground darkens and grass thins by it; the forest builds it at runtime and
 * a tiled ground bakes it into a per-vertex channel (G227 `_CANOPY`). Pure: the same trees give the same map.
 */
export function canopyMapOf(trees: readonly Pick<TreeInstance, 'x' | 'z' | 'height'>[], n = 256): Float32Array {
  const data = new Float32Array(n * n);
  const toCell = (v: number): number => ((v + CHUNK_HALF) / CHUNK_SIZE) * n;
  for (const t of trees) {
    const r = (t.height * 0.16) / (CHUNK_SIZE / n); // crown radius in cells
    const cx = toCell(t.x), cz = toCell(t.z);
    const R = Math.ceil(r + 1);
    for (let j = -R; j <= R; j++) for (let i = -R; i <= R; i++) {
      const x = Math.round(cx) + i, z = Math.round(cz) + j;
      if (x < 0 || z < 0 || x >= n || z >= n) continue;
      const d = Math.hypot(x - cx, z - cz) / r;
      if (d < 1) data[z * n + x] = Math.min(1, (data[z * n + x] ?? 0) + (1 - d * d) * 0.7);
    }
  }
  return data;
}

/** What placement needs of a variant (TreeFactory's variants carry these; the build's bakes pass them from the specs). */
export interface PlantSpec { trunkRadius: number; height: number; species?: TreeSpecies | undefined; collider?: number | undefined }

/** Explicit forest construction inputs for renderer-free native authors.
 * Supplying this never selects a level, installs terrain or changes page constants. */
export interface ForestPlacementSource extends Pick<TerrainField, 'heightAt' | 'normalAt' | 'trailDistance' | 'cabinMask' | 'pondMask'> {
  readonly seed: number;
  readonly treeCount: number;
  readonly forest?: ForestSpec;
}

/** The variants placement plants for a shard's trees (the bakes; TreeFactory builds the same list with geometry). */
export function plantSpecs(trees: { factory: TreeSpec['factory']; set?: string | undefined; setVariants?: readonly TreeSetVariant[] | undefined }): PlantSpec[] {
  if (trees.factory === 'none') return [];
  if (treeSetOf(trees) !== null) return (trees.setVariants ?? []).map((s) => ({ trunkRadius: s.trunk, height: s.height, species: s.species, collider: s.collider }));
  return TREE_SPECS.map((s) => ({ trunkRadius: s.trunk, height: s.height }));
}

/** A 16 m grid cell as one integer (exact for cells within 2^20 of the origin: any coordinate a query meets in play). */
const cellKey = (cx: number, cz: number): number => (cx + 1048576) * 2097152 + (cz + 1048576);

/** Trees bucketed in 16 m cells, for "which trunks are near (x, z)" (collision, planting, herds, bolts); generic over the
 *  tree's record, so a renderer-free host buckets its baked trunks exactly as the page's forest does. */
export class TreeGrid<T extends { readonly x: number; readonly z: number; readonly r: number } = TreeInstance> {
  private cells = new Map<number, T[]>();
  add(t: T): void {
    const k = cellKey(Math.floor(t.x / 16), Math.floor(t.z / 16));
    let bucket = this.cells.get(k);
    if (!bucket) { bucket = []; this.cells.set(k, bucket); }
    bucket.push(t);
  }
  /** trees whose trunk might intersect a circle at (x,z) */
  nearby(x: number, z: number, radius = 2): T[] {
    const out: T[] = [];
    const cx = Math.floor(x / 16), cz = Math.floor(z / 16);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      const list = this.cells.get(cellKey(cx + i, cz + j));
      if (list) for (const t of list) {
        const dx = t.x - x, dz = t.z - z, reach = radius + t.r + 3;
        // Reject only outside the circle's box; keep the exact trunk-distance law.
        if (Math.abs(dx) > reach || Math.abs(dz) > reach) continue;
        if (Math.hypot(dx, dz) < reach) out.push(t);
      }
    }
    return out;
  }
}

/** The active chunk's trees for these variants (none for an empty list: a treeless shard). */
export function placeForest(variants: readonly PlantSpec[], source?: ForestPlacementSource): { trees: TreeInstance[]; grid: TreeGrid } {
  const steps = placeForestSteps(variants, source);
  for (;;) { const step = steps.next(); if (step.done === true) return step.value; }
}

/** `placeForest` as steps (SF67: `Forest.buildSliced` pauses between them): a yield every 256 candidates, which draws
 *  nothing, so the same trees from the same stream */
export function* placeForestSteps(variants: readonly PlantSpec[], source?: ForestPlacementSource): Generator<void, { trees: TreeInstance[]; grid: TreeGrid }> {
  const trees: TreeInstance[] = [];
  const grid = new TreeGrid();
  if (variants.length === 0) return { trees, grid };
  const F = source === undefined ? activeLevel().forest : source.forest;
  if (!F) return { trees, grid }; // no ShardManifest.forest: no forest to place
  const rng = new Rng((source?.seed ?? SEED) + 99);
  const density = new Noise2D((source?.seed ?? SEED) + 5);
  const cell = F.spacing; // metres between candidates → ~3400 candidates at 8.5, thinned by density
  const half = CHUNK_HALF - 6;
  const candidates: [number, number][] = [];
  for (let x = -half; x < half; x += cell) for (let z = -half; z < half; z += cell) {
    candidates.push([x + rng.range(-cell * 0.45, cell * 0.45), z + rng.range(-cell * 0.45, cell * 0.45)]);
  }
  // shuffle so thinning is unbiased
  for (let i = candidates.length - 1; i > 0; i--) { const j = Math.floor(rng.next() * (i + 1)); const a = candidates[i], b = candidates[j]; if (a && b) { candidates[i] = b; candidates[j] = a; } }

  // PH-B4: a species set picks each tree's species from the chunk's zone mix, then one of that species' variants
  const mix = F.species && F.speciesTraits && variants.every((v) => v.species !== undefined) ? F.species : null;
  const traits: readonly TreeSpeciesTraits[] = F.speciesTraits ?? [];
  const traitOf = new Map(traits.map((t) => [t.id, t]));
  const bySpecies = new Map<TreeSpecies, number[]>();
  variants.forEach((v, i) => { if (v.species) bySpecies.set(v.species, [...(bySpecies.get(v.species) ?? []), i]); });
  const plantSpecies = (x: number, y: number, z: number, w: SpeciesWeights): void => {
    let total = 0;
    for (const { id: s } of traits) total += bySpecies.has(s) ? Math.max(0, w[s] ?? 0) : 0;
    if (total <= 0) return;
    let r = rng.next() * total, species: TreeSpecies = traits[0]?.id ?? '';
    for (const { id: s } of traits) { const k = bySpecies.has(s) ? Math.max(0, w[s] ?? 0) : 0; if (r < k) { species = s; break; } r -= k; }
    const list = bySpecies.get(species) ?? [];
    const variant = list[rng.int(0, list.length - 1)] ?? 0;
    const v = variants[variant];
    if (!v) throw new Error(`[forest] no tree variant ${variant}`);
    const trait = traitOf.get(species);
    if (trait === undefined) throw new Error(`[forest] no traits for species '${species}'`);
    const scale = rng.range(trait.scale[0], trait.scale[1]) * (trait.grows && F.scale ? F.scale(x, z) : 1);
    const r0 = v.trunkRadius * scale * (v.collider ?? 1) + trait.girth;
    // no trunk inside another's: a giant keeps its neighbours off its buttresses and out from under its limbs
    for (const o of grid.nearby(x, z, r0 + 8)) {
      const other = o.species === undefined ? undefined : traitOf.get(o.species)?.spacing;
      const gap = trait.spacing === 'wide' || other === 'wide' ? 3.5 : trait.spacing === 'tight' || other === 'tight' ? 0.6 : 1.2;
      if (Math.hypot(o.x - x, o.z - z) < o.r + r0 + gap) return;
    }
    const h = F.tintHue + rng.range(F.tintHueJitter[0], F.tintHueJitter[1]);
    const tint = new THREE.Color().setHSL(h + (trait.hue ?? 0), rng.range(0.1, 0.3), rng.range(0.8, 0.95));
    const t: TreeInstance = { x, y: y - 0.25, z, r: r0, variant, scale, rot: rng.range(0, Math.PI * 2), height: v.height * scale, tint, species };
    trees.push(t);
    grid.add(t);
  };
  // a zone's infill (ChunkForest.infill; Pine Hollow's Hollow grove, PH-L1 round 2): a second candidate grid half a cell
  // off the first, inside a circle, tested after the chunk's own (so every tree the grid placed stays where it was)
  const infill: [number, number][] = [];
  const fill = F.infill;
  if (fill) {
    for (let x = fill.x - fill.r + cell / 2; x < fill.x + fill.r; x += cell) for (let z = fill.z - fill.r + cell / 2; z < fill.z + fill.r; z += cell) {
      const jx = x + rng.range(-cell * 0.3, cell * 0.3), jz = z + rng.range(-cell * 0.3, cell * 0.3);
      if (Math.hypot(jx - fill.x, jz - fill.z) < fill.r) infill.push([jx, jz]);
    }
  }
  let tested = 0;
  for (const [x, z] of [...candidates, ...infill]) {
    if ((++tested & 255) === 0) yield;
    if (trees.length >= (source?.treeCount ?? TREE_COUNT)) break;
    if (!inChunk(x, z, 4)) continue;
    const d = density.fbm(x * F.densityFreq, z * F.densityFreq, 3); // clearings & dense groves
    const keep = (smoothstep(F.clearings[0], F.clearings[1], d) * 0.92 + 0.08) * (F.density ? F.density(x, z) : 1);
    if (rng.next() > keep) continue;
    if (F.mask && rng.next() > F.mask(x, z)) continue;          // a shard's own planting field (Nalati's spruce gullies)
    const roadEntry = (Math.abs(x) < 16 && Math.abs(z) > CHUNK_HALF - 95) || (Math.abs(z) < 16 && Math.abs(x) > CHUNK_HALF - 95);
    if (roadEntry) continue;
    if ((source?.trailDistance ?? trailDistance)(x, z) < 9 + rng.range(0, 4)) continue;
    if ((source?.cabinMask ?? cabinMask)(x, z) > 0.02) continue;
    if ((source?.pondMask ?? pondMask)(x, z) > 0.03) continue;
    const [, ny] = (source?.normalAt ?? normalAt)(x, z);
    if (ny < F.maxSlope) continue;                               // too steep
    const y = (source?.heightAt ?? heightAt)(x, z);
    if (mix) { plantSpecies(x, y, z, mix(x, z)); continue; }
    const variant = rng.next() < F.largeVariantChance ? 3 : rng.int(0, 2);
    const scale = rng.range(0.8, 1.2) * (F.scale ? F.scale(x, z) : 1);
    const v = variants[variant];
    if (!v) throw new Error(`[forest] no tree variant ${variant}`);
    const tint = new THREE.Color().setHSL(F.tintHue + rng.range(F.tintHueJitter[0], F.tintHueJitter[1]), rng.range(F.tintSat[0], F.tintSat[1]), rng.range(F.tintLight[0], F.tintLight[1]));
    const t: TreeInstance = { x, y: y - 0.25, z, r: v.trunkRadius * scale + 0.15, variant, scale, rot: rng.range(0, Math.PI * 2), height: v.height * scale, tint };
    trees.push(t);
    grid.add(t);
  }
  return { trees, grid };
}

/**
 * One kept / skipped bit per undergrowth candidate, in candidate order. `record` runs the tests and
 * writes the bits; `replay` reads them instead of testing.
 */
export class DecisionLog {
  private bytes: Uint8Array;
  private n = 0;
  readonly replaying: boolean;
  readonly length: number;
  // plain fields, no parameter properties: scripts/bake-chunk.mjs runs this file in Node's strip-only TypeScript
  private constructor(replaying: boolean, bytes: Uint8Array, length: number) { this.replaying = replaying; this.bytes = bytes; this.length = length; }
  static record(): DecisionLog { return new DecisionLog(false, new Uint8Array(1 << 14), 0); }
  static replay(bytes: Uint8Array, length: number): DecisionLog { return new DecisionLog(true, bytes, length); }
  /** the next recorded decision (replay) */
  read(): boolean {
    if (this.n >= this.length) throw new Error('[placement] decision log exhausted (stale bake)');
    const i = this.n++;
    return ((this.bytes[i >> 3] ?? 0) >> (i & 7) & 1) === 1;
  }
  /** append a decision (record); returns it */
  write(ok: boolean): boolean {
    const i = this.n++;
    if ((i >> 3) >= this.bytes.length) { const b = new Uint8Array(this.bytes.length * 2); b.set(this.bytes); this.bytes = b; }
    if (ok) this.bytes[i >> 3] = (this.bytes[i >> 3] ?? 0) | (1 << (i & 7));
    return ok;
  }
  /** decisions read / written so far */
  get count(): number { return this.n; }
  /** the recorded bits, trimmed */
  bits(): Uint8Array { return this.bytes.slice(0, (this.n + 7) >> 3); }
}

/** one undergrowth copy: its position, the ground normal, yaw, scale and tint */
export interface Placement { x: number; y: number; z: number; nx: number; ny: number; nz: number; rot: number; scale: number; r: number; g: number; b: number }
export const UNDER_KINDS = ['ferns', 'shrubs', 'litter', 'stones', 'moss', 'reeds'] as const;
export type UnderPlacements = Record<(typeof UNDER_KINDS)[number], Placement[]>;
export const FERN_MAX = 6000, SHRUB_MAX = 1500, LITTER_MAX = 5000, STONE_MAX = 3000, MOSS_MAX = 3000, REED_MAX = 1500;

/** A fingerprint of a placement result: its counts and a position sum (a stale decision log fails it). */
export function placementChecksum(p: UnderPlacements): { counts: number[]; sum: number } {
  let sum = 0;
  for (const k of UNDER_KINDS) for (const it of p[k]) sum += it.x + 2 * it.z + 3 * it.scale;
  return { counts: UNDER_KINDS.map((k) => p[k].length), sum };
}

type Kind = 'fern' | 'shrub' | 'litter' | 'stone' | 'moss' | 'reed';

/**
 * The forest-floor placement of the active chunk around `trees`; yields between its passes (one rng
 * stream, so the order of passes is fixed). `log` records the candidates' outcomes or replays them.
 */
export function* placeUndergrowth(trees: TreeInstance[], grid: { nearby: (x: number, z: number, radius: number) => TreeInstance[] }, log: DecisionLog): Generator<void, UnderPlacements, undefined> {
  const rng = new Rng(SEED + 77);
  const cluster = new Noise2D(SEED + 78);
  const ferns: Placement[] = [], shrubs: Placement[] = [], litter: Placement[] = [], stones: Placement[] = [], moss: Placement[] = [], reeds: Placement[] = [];
  const half = CHUNK_HALF - 8;
  const wl = waterLevel();
  const forest = activeLevel().forest;
  const bare = forest?.density;
  const us = forest?.understory;
  const fernK = us?.ferns ?? 1, shrubK = us?.shrubs ?? 1, fernCanopy = us?.fernCanopy === true;
  /** the tests: pure, no rng — so a candidate's outcome is the one bit the log keeps */
  const accepts = (kind: Kind, x: number, z: number): boolean => {
    if (!inChunk(x, z, 8)) return false;
    if (bare && kind !== 'reed' && bare(x, z) <= 0) return false; // a bare pad (ChunkForest.density = 0)
    const td = trailDistance(x, z);
    const pm = pondMask(x, z);
    const y = heightAt(x, z);
    const depth = wl - y;                       // > 0 under water
    if (kind === 'reed') {
      if (depth < -0.55 || depth > 0.35 || pm < 0.05) return false;
    } else {
      if (depth > -0.1) return false;              // nothing else grows in the water
      if (td < (kind === 'litter' || kind === 'stone' ? 3 : 5.5)) return false;
      if (cabinMask(x, z) > 0.02) return false;
    }
    const c = cluster.fbm(x * 0.02 + (kind === 'shrub' ? 40 : 0), z * 0.02, 3);
    const verge = td < 10 || (pm > 0.03 && depth < -0.1);   // trail edge or pond rim: ferns like it here
    if (kind === 'fern' && c < (fernCanopy ? -0.25 : 0.12) && !verge) return false;
    if (kind === 'shrub' && c < -0.1) return false;
    // the grid lookups first, the tree query (the expensive one) last
    const nrm = normalAt(x, z, 0.8);
    if (nrm[1] < (kind === 'moss' ? 0.7 : 0.8)) return false;
    const [f, g, r, t] = splatAt(x, z);
    if (r > (kind === 'stone' || kind === 'moss' ? 0.6 : 0.25)) return false;
    if (kind === 'fern' && f < 0.55 && !(verge && t < 0.5 && f + g > 0.4)) return false;
    if (kind === 'shrub' && f + g < 0.6) return false;
    if (kind === 'litter' && f < 0.5) return false;
    if (kind === 'stone' && f + r < 0.5) return false;
    const near = grid.nearby(x, z, 12);
    let canopy = 0, trunkD = 1e9;
    for (const tr of near) { const d = Math.hypot(tr.x - x, tr.z - z); if (d < tr.r + (kind === 'moss' ? 0.1 : 0.45)) return false; if (d < 12) canopy++; trunkD = Math.min(trunkD, d - tr.r); }
    if (kind === 'fern' && canopy < 2 && !verge) return false;
    if (kind === 'fern' && fernCanopy && c < 0.12 && !verge && canopy < 5) return false; // outside a cluster: only the deep shade
    if ((kind === 'litter' || kind === 'stone') && canopy < 1) return false;
    if (kind === 'moss' && trunkD > 2.2) return false;
    return true;
  };
  const tryPlace = (kind: Kind, x: number, z: number) => {
    if (!(log.replaying ? log.read() : log.write(accepts(kind, x, z)))) return;
    // a kept candidate: what the tests computed about it, again (pure functions of x, z — the same numbers)
    const y = heightAt(x, z);
    const depth = wl - y;
    const nrm = normalAt(x, z, 0.8);
    const hue = rng.next();
    const base = { x, y, z, nx: nrm[0], ny: nrm[1], nz: nrm[2], rot: rng.range(0, Math.PI * 2) };
    if (kind === 'fern') {
      const c = cluster.fbm(x * 0.02, z * 0.02, 3);
      const scale = rng.range(0.9, 1.6) * (0.8 + 0.2 * smoothstep(0, 0.5, c));
      ferns.push({ ...base, y: y - 0.02, scale, r: lerp(0.5, 0.78, hue), g: lerp(0.72, 0.82, hue), b: lerp(0.48, 0.6, hue) });
    } else if (kind === 'shrub') {
      shrubs.push({ ...base, y: y - 0.03, scale: rng.range(0.8, 1.5), r: lerp(0.8, 1.0, hue), g: lerp(0.9, 0.8, hue), b: lerp(0.6, 0.55, hue) });
    } else if (kind === 'litter') {
      litter.push({ ...base, y: y + 0.06, scale: rng.range(0.8, 1.5), r: lerp(0.7, 0.9, hue), g: lerp(0.68, 0.82, hue), b: lerp(0.62, 0.75, hue) });
    } else if (kind === 'stone') {
      stones.push({ ...base, y: y + 0.06, scale: rng.range(0.6, 1.3), r: lerp(0.75, 1.0, hue), g: lerp(0.75, 0.98, hue), b: lerp(0.75, 0.95, hue) });
    } else if (kind === 'moss') {
      moss.push({ ...base, y: y + 0.05, scale: rng.range(0.7, 1.6), r: lerp(0.6, 0.85, hue), g: lerp(0.62, 0.78, hue), b: lerp(0.5, 0.62, hue) });
    } else {
      reeds.push({ ...base, y: y - 0.05, scale: rng.range(0.8, 1.2) * (depth > 0 ? 1.1 : 1), r: lerp(0.75, 1.0, hue), g: lerp(0.85, 0.95, hue), b: lerp(0.45, 0.6, hue) });
    }
  };
  const anywhere = (kind: Kind) => tryPlace(kind, rng.range(-half, half), rng.range(-half, half));
  for (let i = 0; i < 30000 * fernK && ferns.length < FERN_MAX * fernK * 0.7; i++) anywhere('fern');
  yield;
  // trail verges + pond rim: sample near the trails / pond directly so the verge fills up
  for (let i = 0; i < 12000 * fernK && ferns.length < FERN_MAX * fernK; i++) {
    if (rng.next() < 0.75) {
      const x = rng.range(-half, half), z = rng.range(-half, half);
      tryPlace('fern', x, z);
    } else {
      const a = rng.range(0, Math.PI * 2), d = POND.r + rng.range(-4, 14);
      tryPlace('fern', POND.x + Math.cos(a) * d, POND.z + Math.sin(a) * d);
    }
  }
  yield;
  for (let i = 0; i < 9000 * shrubK && shrubs.length < SHRUB_MAX * shrubK; i++) anywhere('shrub');
  yield;
  for (let i = 0; i < 18000 && litter.length < LITTER_MAX; i++) anywhere('litter');
  yield;
  for (let i = 0; i < 12000 && stones.length < STONE_MAX; i++) anywhere('stone');
  yield;
  // moss: sample right at the trunks
  for (let i = 0; i < 14000 && moss.length < MOSS_MAX; i++) {
    const t = rng.pick(trees);
    const a = rng.range(0, Math.PI * 2), d = t.r + rng.range(0.15, 1.6);
    tryPlace('moss', t.x + Math.cos(a) * d, t.z + Math.sin(a) * d);
  }
  yield;
  for (let i = 0; i < 40000 && reeds.length < REED_MAX; i++) {
    const a = rng.range(0, Math.PI * 2), d = rng.range(POND.r * 0.3, POND.r + 10);
    tryPlace('reed', POND.x + Math.cos(a) * d, POND.z + Math.sin(a) * d);
  }
  return { ferns, shrubs, litter, stones, moss, reeds };
}

/**
 * Baked forest instance records (SHARD-PLATFORM G227: a world's forest declared by its shardfile instead of placed at boot).
 * Little-endian: a 16-byte header (`WSFI`, version 1, the tree count, the variant count) then per tree eleven float64s:
 * x, y (the foot, as placed: ground − 0.25), z, r (the trunk's collision radius), variant (an index into the forest's
 * variants, in their order), scale, rot (yaw, radians), height, tint r, g, b (linear). Float64 keeps every placed value
 * exact, so the forest drawn from records is the placed one, matrix for matrix (~88 B a tree: Pine's ~2 k trees ~180 KB).
 */
export const TREE_RECORD_MAGIC = 0x49465357; // 'WSFI'
const TREE_RECORD_FLOATS = 11, TREE_RECORD_HEADER = 16;


/**
 * Decode tree records against the forest's variants (their species come from the variant, as placement picks them);
 * refuses a foreign or truncated file, a variant count other than the forest's, an out-of-range variant or a non-finite value.
 */
export function decodeTreeRecords(bytes: Uint8Array, variants: readonly PlantSpec[]): TreeInstance[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength < TREE_RECORD_HEADER || view.getUint32(0, true) !== TREE_RECORD_MAGIC || view.getUint32(4, true) !== 1) throw new Error('not a version-1 tree record file');
  const count = view.getUint32(8, true);
  if (view.getUint32(12, true) !== variants.length) throw new Error(`tree records name ${view.getUint32(12, true)} variants, the forest has ${variants.length}`);
  if (bytes.byteLength !== TREE_RECORD_HEADER + count * TREE_RECORD_FLOATS * 8) throw new Error('tree record file length does not match its count');
  const trees: TreeInstance[] = [];
  for (let i = 0; i < count; i++) {
    const f = (k: number): number => {
      const value = view.getFloat64(TREE_RECORD_HEADER + (i * TREE_RECORD_FLOATS + k) * 8, true);
      if (!Number.isFinite(value)) throw new Error(`tree ${i}: non-finite record value`);
      return value;
    };
    const variant = f(4), spec = variants[variant];
    if (!Number.isInteger(variant) || spec === undefined) throw new Error(`tree ${i}: variant ${variant} outside the forest's ${variants.length}`);
    trees.push({ x: f(0), y: f(1), z: f(2), r: f(3), variant, scale: f(5), rot: f(6), height: f(7), tint: new THREE.Color(f(8), f(9), f(10)), species: spec.species });
  }
  return trees;
}

/** The 16 m lookup grid over given trees (what `placeForest` returns beside them). */
export function treeGridOf(trees: readonly TreeInstance[]): TreeGrid {
  const grid = new TreeGrid();
  for (const t of trees) grid.add(t);
  return grid;
}
