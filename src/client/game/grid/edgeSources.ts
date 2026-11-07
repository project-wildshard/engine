/**
 * The grid session's edge reader (SHARD-PLATFORM SF17b phase 2, the interim G90 observation source): what each cell's
 * four boundary rows and their physical observations are, for `loadGridEdgeProfiles` to admit before the one platform
 * generation. Everything comes from the shard's own declared data, never from a shard name written here:
 *
 * - **rows**: a shardfile shard's admitted `edge` rows; a legacy shard's committed terrain bake
 *   (`public/assets/baked/<slug>/terrain.bin`, the WSTR lattice, only for the shards `bakesTerrain` names); a structures
 *   world's own terrain heights, or, with no landscape at all (Sky Reach), a void at road level that the platform closes
 *   with G99's road wall and guard rail; coloured by its own map palette's ground ramp, and the platform's neutral grey
 *   when it declares none.
 * - **entries**: admitted shardfile midpoint declarations open their exact width; undeclared legacy edges stay closed.
 * - **water**: a shard's open water (its map's `openWater` level). Above the road (G91) the dike holds it; a sea at exactly 0
 *   is kept as 0 (C2-R3-B1), so its seabed edges get the shore rule's revetment (G134 / G149); below 0 none is reported.
 *
 * A proper format field for the observations is sp-x5's follow-up (the coordinator's interim decision).
 */
import { versionedUrl } from '@wildshard/engine/boot/bytes';
import type { GridCell } from '../../../shared/game/grid/assembly';
import type { GridEdgeObservations, GridEdgeSource } from '../../../shared/game/grid/edgeProfiles';
import type { ShardEntryways } from '@wildshard/format/entryways';
import type { RuntimeDeclaration } from '@wildshard/format/runtime';
import { findShard } from '../shard/registry';
import { bakesTerrain } from '../../../shared/game/shard/terrainBake';

type Rgb = [number, number, number];
interface Row { heights: number[]; colours: Rgb[]; roadHeight: 0 }
type Rows = Record<'north' | 'east' | 'south' | 'west', Row>;
const SIDES = ['north', 'east', 'south', 'west'] as const;
const NEUTRAL: Rgb = [0.25, 0.25, 0.25];
/** An unbaked shard's rows are sampled on the bake's own lattice (the engine's TERRAIN_RES). */
const LATTICE = 256;
const srgbToLinear = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const unit = (c: number): number => Math.max(0, Math.min(1, Number.isFinite(c) ? c : 0));

/** Decode the bake's height lattice (the WSTR header: magic, version, resolution, size 500, then res² f32 heights). */
function bakeHeights(bytes: Uint8Array): { res: number; heights: Float32Array } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 24 || view.getUint32(0, true) !== 0x52545357 || view.getUint32(4, true) !== 1 || view.getFloat32(12, true) !== 500) throw new RangeError('Invalid terrain bake header');
  const res = view.getUint32(8, true);
  if ((res !== 256 && res !== 257) || bytes.length < 24 + res * res * 4) throw new RangeError('Invalid terrain bake lattice');
  return { res, heights: Float32Array.from({ length: res * res }, (_, i) => view.getFloat32(24 + i * 4, true)) };
}

/** The four native boundary rows of a lattice (north = +z; rows run west→east and south→north), coloured per vertex. */
function latticeRows(res: number, height: (i: number, j: number) => number, colour: (x: number, z: number, h: number, slope: number) => Rgb): Rows {
  const step = 500 / (res - 1), at = (i: number, j: number): number => height(Math.max(0, Math.min(res - 1, i)), Math.max(0, Math.min(res - 1, j)));
  const row = (side: typeof SIDES[number]): Row => {
    const out: Row = { heights: [], colours: [], roadHeight: 0 };
    for (let k = 0; k < res; k++) {
      const i = side === 'east' ? res - 1 : side === 'west' ? 0 : k, j = side === 'north' ? res - 1 : side === 'south' ? 0 : k, h = at(i, j);
      const slope = Math.min(1, Math.hypot(at(i + 1, j) - at(i - 1, j), at(i, j + 1) - at(i, j - 1)) / (2 * step) / 2);
      out.heights.push(h); out.colours.push(colour(-250 + i * step, -250 + j * step, h, slope));
    }
    return out;
  };
  return { north: row('north'), east: row('east'), south: row('south'), west: row('west') };
}

function observe(entries: ShardEntryways, water: number | undefined, geometry: 'ground' | 'void' = 'ground'): GridEdgeObservations {
  const edge = (side: typeof SIDES[number]): GridEdgeObservations['north'] => ({ entryWidth: entries.find(row => row.edge === side)?.width ?? 0, geometry, ...(water === undefined || !Number.isFinite(water) || water < 0 ? {} : { waterSurface: water }) });
  return { north: edge('north'), east: edge('east'), south: edge('south'), west: edge('west') };
}

/** Admitted products and immutable transport can be supplied by the owning composition without replacing modules. */
export interface GridEdgeReaderPorts {
  /** Index-only edge metadata; it grants no simulation/runtime readiness. */
  edges?: (slug: string) => Promise<{ edge: Rows; entryways: ShardEntryways }> | null;
  product?: (slug: string) => Promise<{ admitted: { source: { edge: Rows; entryways: ShardEntryways; runtime?: RuntimeDeclaration | null } }; release?: () => void }> | null;
  fetch: (url: string) => Promise<Response>;
  /** Loading-stage module preparation while the already-admitted product lease is still held. */
  prepare?: (source: { readonly runtime?: RuntimeDeclaration | null }) => Promise<void>;
}

/** Read one cell's edge source from its shard's own data. */
export async function readGridEdges(cell: GridCell, reader: GridEdgeReaderPorts): Promise<GridEdgeSource> {
  const manifest = findShard(cell.slug), water = manifest?.minimap?.openWater?.level;
  const indexed = reader.edges?.(cell.slug);
  if (indexed !== undefined && indexed !== null) {
    const source = await indexed, geometry = manifest?.ground.structures === true && manifest.ground.terrain === undefined ? 'void' : 'ground';
    return { kind: 'declared', profiles: structuredClone(source.edge), observations: observe(source.entryways, water, geometry) };
  }
  const product = reader.product?.(cell.slug) ?? null;
  if (product !== null) {
    const lease = await product;
    try {
      const source = lease.admitted.source;
      await reader.prepare?.(source);
      // Admitting a product opens only its declared entries; it does not invent ground around a structures-only world.
      const geometry = manifest?.ground.structures === true && manifest.ground.terrain === undefined ? 'void' : 'ground';
      return { kind: 'declared', profiles: structuredClone(source.edge), observations: observe(source.entryways, water, geometry) };
    }
    finally { lease.release?.(); }
  }
  const palette = manifest?.minimap?.palette?.ground;
  const scratch: Rgb = [0, 0, 0];
  const colour = (x: number, z: number, h: number, slope: number): Rgb => {
    if (palette !== undefined) {
      palette(x, z, h, slope, 0, scratch);
      const scale = Math.max(scratch[0], scratch[1], scratch[2]) > 1 ? 255 : 1; // a map palette paints sRGB (0..1 or bytes)
      return [unit(srgbToLinear(scratch[0] / scale)), unit(srgbToLinear(scratch[1] / scale)), unit(srgbToLinear(scratch[2] / scale))];
    }
    return [...NEUTRAL];
  };
  const ground = manifest?.ground;
  // Only a terrain-only shard ships a bake (bakesTerrain, the baker's own rule); a structures world is read from its manifest,
  // never fetched (C4-R1-C13: Sky Reach's never-committed terrain.bin 404'd and closed its edges at the fallback).
  if (ground !== undefined && !bakesTerrain(ground)) {
    const terrain = ground.terrain;
    // no landscape at all (islands over the void): every edge is a void at road level, so the platform builds G99's road
    // wall and guard rail along it; with a landscape under the structures, its own authored heights (the bake's datum rule)
    if (terrain === undefined) return { kind: 'declared', profiles: latticeRows(LATTICE, () => 0, colour), observations: observe([], water, 'void') };
    const datum = terrain.datum ?? 0, step = 500 / (LATTICE - 1);
    return { kind: 'declared', profiles: latticeRows(LATTICE, (i, j) => terrain.heightAt(-250 + i * step, -250 + j * step) - datum, colour), observations: observe([], water) };
  }
  const response = await reader.fetch(versionedUrl(`/assets/baked/${cell.slug}/terrain.bin`));
  if (!response.ok) throw new Error(`terrain.bin ${cell.slug}: ${String(response.status)}`);
  const { res, heights } = bakeHeights(new Uint8Array(await response.arrayBuffer()));
  const rows = latticeRows(res, (i, j) => heights[j * res + i] ?? 0, colour);
  return { kind: 'declared', profiles: rows, observations: observe([], water) };
}
