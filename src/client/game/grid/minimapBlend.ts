/**
 * The minimap at the road boundary (SHARD-PLATFORM SF28, Jake's G107 "A terrain faded, but only on the road") and the grid's
 * full map (SF66). It feeds the engine minimap's data-only overlay (`Minimap.setExtras`) in the home frame's metres:
 *
 * - **inside a shard's cell**: that shard (the home's own minimap ground, or a neighbour's baked map at full strength), the
 *   road network, and each neighbour's NAME across the road once that road is near (no neighbour terrain);
 * - **on the road / no-man's land**: every cell in view as faded terrain (~50 %) on both sides, so a roundabout shows all four.
 *
 * The full map (`FullMap.setExtras`) lays out every cell's baked map at its cell, the road network and each shard's name.
 * Each cell's ground is its admitted shardfile map (SF66): the home's at full size, each other shard's decoded once,
 * downscaled to CELL_PX and shared by its copies; they go
 * with the grid's scope.
 */
import type { MapExtras, MapExtraImage, MapExtraLabel, MapExtraRect } from '@wildshard/engine/ui/Minimap';
import { CHUNK_HALF } from '@wildshard/engine/core/config';
import type { Scope } from '@wildshard/engine/app/scope';
import type { GridAssembly, GridCell, GridSide } from '../../../shared/game/grid/assembly';
import type { GridCellEvents } from '../../../shared/game/grid/cellEvents';
import { GAP_HALF, RAIL_OFFSET, ROAD_HALF } from '../../../shared/game/grid/roadLayout';

/** On the road the neighbours' terrain shows at this opacity (G107: "faded ~50 %"). */
export const ROAD_TERRAIN_ALPHA = 0.5;
/** Where a neighbour's name sits: this far past the road's centre line, on the neighbour's own ground (its edge is GAP_HALF out). */
const NAME_ACROSS = GAP_HALF + 12;
/** template-prompts (E435): a neighbour's name shows only while its spot across the road is inside the minimap's disc (the
 *  engine minimap's 110 m view less its 9 m rim), so it reads as the shard across the road. Before, it showed from 140 m
 *  out, pinned to the rim: in Sky Reach and the template copies "DRIFTWOOD ISLE" sat under the N tab like the minimap's
 *  own title for the cell you were in. Metres from the feet to the road's centre line. */
const NAME_RANGE = 101 - NAME_ACROSS;
/** A neighbour's baked map is kept at this many px a side (0.8 px per metre, 0.64 MB): the minimap shows it ~110 m across */
export const CELL_PX = 400;
const STRIP = '#3b4038', ROAD = '#2a2e35', LINE = '#c9a640', VOID = '#0b1016', NAME = '#eaf6ff';

/** Each shard's baked map, loaded the first time a cell of it is drawn, downscaled once and shared by its copies. */
interface MapEntry { image: HTMLCanvasElement | ImageBitmap | null; deferredAt?: number }
export class CellMinimaps {
  private readonly maps = new Map<string, MapEntry>();
  private disposed = false;
  constructor(scope: Scope, private readonly url: (slug: string) => Promise<string | {
    readonly url: string; readonly retained: (image: { readonly width: number; readonly height: number } | null) => void;
  } | undefined>, private readonly fullSize: (slug: string) => boolean = () => false,
  private readonly retry?: { revision: () => number; deferred: (error: unknown) => boolean }) {
    scope.onDispose(() => { this.disposed = true; for (const m of this.maps.values()) if (m.image !== null) {
      if ('close' in m.image) m.image.close(); else m.image.width = m.image.height = 0;
    } this.maps.clear(); });
  }
  /** the shard's map, or null while it loads (or when it names none) */
  image(slug: string): HTMLCanvasElement | ImageBitmap | null {
    if (this.disposed) return null;
    const hit = this.maps.get(slug);
    if (hit !== undefined) {
      if (!this.disposed && hit.deferredAt !== undefined && hit.deferredAt !== this.retry?.revision()) { delete hit.deferredAt; void this.load(slug, hit); }
      return hit.image;
    }
    const entry: MapEntry = { image: null };
    this.maps.set(slug, entry);
    if (typeof document !== 'undefined') void this.load(slug, entry);
    return null;
  }
  /** bytes held now (RGBA), for the memory readouts */
  get bytes(): number { let n = 0; for (const m of this.maps.values()) if (m.image !== null) n += m.image.width * m.image.height * 4; return n; }
  private isDisposed(): boolean { return this.disposed; }
  private async load(slug: string, entry: MapEntry): Promise<void> {
    let settled: ((image: { readonly width: number; readonly height: number } | null) => void) | undefined;
    try {
      const leased = await this.url(slug);
      if (leased === undefined) return;
      const url = typeof leased === 'string' ? leased : leased.url;
      if (typeof leased !== 'string') settled = leased.retained;
      if (this.isDisposed()) return;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const full = await createImageBitmap(await res.blob());
      try {
        if (this.disposed) return;
        if (this.fullSize(slug)) { entry.image = full; return; }
        const canvas = document.createElement('canvas'); canvas.width = canvas.height = CELL_PX;
        const ctx = canvas.getContext('2d');
        if (ctx === null) return;
        ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(full, 0, 0, canvas.width, canvas.height);
        entry.image = canvas;
      } finally { if (entry.image !== full) full.close(); }
    } catch (error) {
      if (!this.disposed && this.retry?.deferred(error)) entry.deferredAt = this.retry.revision();
      else if (!this.disposed) console.warn(`[grid] the baked map ${slug} did not load:`, error);
    }
    finally {
      try { settled?.(entry.image); }
      catch (error) {
        if (entry.image !== null) {
          if ('close' in entry.image) entry.image.close(); else entry.image.width = entry.image.height = 0;
          entry.image = null;
        }
        if (!this.disposed && this.retry?.deferred(error)) entry.deferredAt = this.retry.revision();
        else if (!this.disposed) console.warn(`[grid] the baked map ${slug} could not reserve its retained image:`, error);
      }
    }
  }
}

/** The road network as overlay rectangles in the home frame: the strips' ground over the grid's box, each road band and its centre line. */
export function roadRects(assembly: GridAssembly, home: GridCell): MapExtraRect[] {
  const xs = assembly.cells.map((c) => c.cell[0]), zs = assembly.cells.map((c) => c.cell[1]), p = assembly.pitch;
  const minX = Math.min(...xs), maxX = Math.max(...xs), minZ = Math.min(...zs), maxZ = Math.max(...zs);
  const x0 = minX * p - p / 2 - RAIL_OFFSET, x1 = maxX * p + p / 2 + RAIL_OFFSET, z0 = minZ * p - p / 2 - RAIL_OFFSET, z1 = maxZ * p + p / 2 + RAIL_OFFSET;
  const ox = home.origin.x, oz = home.origin.z, cx = (x0 + x1) / 2 - ox, cz = (z0 + z1) / 2 - oz, hx = (x1 - x0) / 2, hz = (z1 - z0) / 2;
  const out: MapExtraRect[] = [{ x: cx, z: cz, hx, hz, color: STRIP }];
  for (let i = minX - 1; i <= maxX; i++) out.push({ x: (i + 0.5) * p - ox, z: cz, hx: ROAD_HALF, hz: hz - (RAIL_OFFSET - ROAD_HALF), color: ROAD });
  for (let j = minZ - 1; j <= maxZ; j++) out.push({ x: cx, z: (j + 0.5) * p - oz, hx: hx - (RAIL_OFFSET - ROAD_HALF), hz: ROAD_HALF, color: ROAD });
  for (let i = minX - 1; i <= maxX; i++) out.push({ x: (i + 0.5) * p - ox, z: cz, hx: 0.35, hz: hz - RAIL_OFFSET, color: LINE });
  for (let j = minZ - 1; j <= maxZ; j++) out.push({ x: cx, z: (j + 0.5) * p - oz, hx: hx - RAIL_OFFSET, hz: 0.35, color: LINE });
  return out;
}

const SIDES: readonly { side: GridSide; dx: number; dz: number }[] = [{ side: 'north', dx: 0, dz: 1 }, { side: 'south', dx: 0, dz: -1 }, { side: 'east', dx: 1, dz: 0 }, { side: 'west', dx: -1, dz: 0 }];

/** What the blend reads: the grid, the cell events, the feet (grid metres), each cell's map (null for the home: the minimap's
 *  own ground) and its shard name. */
export interface MinimapBlendHost {
  readonly assembly: GridAssembly; readonly home: GridCell; readonly cells: GridCellEvents;
  readonly worldFeet: () => { readonly x: number; readonly z: number };
  readonly image: (instance: string) => CanvasImageSource | null;
  readonly name: (cell: GridCell) => string;
}
/** The overlay for the feet now (pure but for the rasters; the home frame's metres). */
export function minimapOverlay(host: MinimapBlendHost, rects: readonly MapExtraRect[]): MapExtras {
  const { assembly, home } = host, feet = host.worldFeet(), ox = home.origin.x, oz = home.origin.z;
  const inside = host.cells.cell === null ? undefined : assembly.at(feet.x, feet.z);
  const homeImage = host.image(home.instance);
  const images: MapExtraImage[] = [], labels: MapExtraLabel[] = [];
  if (inside === undefined) {
    // G107 on the road: every cell in view faded, the home's own layer too
    for (const cell of assembly.cells) {
      if (cell.instance === home.instance && homeImage === null) continue;
      const image = host.image(cell.instance);
      if (image !== null) images.push({ image, x: cell.origin.x - ox, z: cell.origin.z - oz, size: 2 * CHUNK_HALF, alpha: ROAD_TERRAIN_ALPHA });
    }
    return { outside: VOID, baseAlpha: homeImage === null ? ROAD_TERRAIN_ALPHA : 0, rects, images, labels };
  }
  // inside a cell: that shard at full strength, the road, the neighbours' names across it
  if (inside.instance !== home.instance || homeImage !== null) {
    const image = host.image(inside.instance);
    if (image !== null) images.push({ image, x: inside.origin.x - ox, z: inside.origin.z - oz, size: 2 * CHUNK_HALF, alpha: 1 });
  }
  const lx = feet.x - inside.origin.x, lz = feet.z - inside.origin.z, edgeToRoad = CHUNK_HALF + GAP_HALF;
  for (const { side, dx, dz } of SIDES) {
    const next = assembly.neighbour(inside, side);
    if (!('instance' in next)) continue;
    const toRoad = dx !== 0 ? edgeToRoad - dx * lx : edgeToRoad - dz * lz;
    if (toRoad > NAME_RANGE) continue;
    const along = Math.max(-CHUNK_HALF + 40, Math.min(CHUNK_HALF - 40, dx !== 0 ? lz : lx)), across = edgeToRoad + NAME_ACROSS;
    labels.push({ x: inside.origin.x - ox + (dx !== 0 ? dx * across : along), z: inside.origin.z - oz + (dz !== 0 ? dz * across : along), text: host.name(next), color: NAME });
  }
  return { outside: VOID, baseAlpha: inside.instance === home.instance && homeImage === null ? 1 : 0, rects, images, labels };
}

/** The grid's full map (SF66): every cell's baked map at its cell, the road network, each shard's name near its cell's north
 *  edge; the home's own ground is the map's base layer. Home-frame metres. */
type AtlasTile = (slug: string) => Pick<MapExtraImage, 'image' | 'crop'>;
export function fullMapOverlay(host: MinimapBlendHost, rects: readonly MapExtraRect[], atlas?: AtlasTile): MapExtras {
  const { assembly, home } = host, ox = home.origin.x, oz = home.origin.z, homeImage = atlas === undefined ? host.image(home.instance) : null;
  const images: MapExtraImage[] = [], labels: MapExtraLabel[] = [];
  for (const cell of assembly.cells) {
    const x = cell.origin.x - ox, z = cell.origin.z - oz;
    const text = host.name(cell);
    labels.push({ x, z: z + CHUNK_HALF - 90, text, short: text.split(' · ').at(-1) ?? text, color: NAME, width: CHUNK_HALF * 2 - 32, height: 160 });
    if (atlas !== undefined) { images.push({ ...atlas(cell.slug), x, z, size: 2 * CHUNK_HALF, alpha: 1 }); continue; }
    if (cell.instance === home.instance && homeImage === null) continue;
    const image = host.image(cell.instance);
    if (image !== null) images.push({ image, x, z, size: 2 * CHUNK_HALF, alpha: 1 });
  }
  return { outside: VOID, baseAlpha: atlas === undefined && homeImage === null ? 1 : 0, rects, images, labels };
}

interface ExtrasSink { setExtras: (source: (() => MapExtras | null) | null) => void }
/** Feed the page's minimap (and its full map) while the grid runs; the overlays leave with the scope. */
export function installMinimapBlend(minimap: ExtrasSink, host: MinimapBlendHost, scope: Scope, fullMap?: ExtrasSink, atlas?: AtlasTile): () => MapExtras {
  const rects = roadRects(host.assembly, host.home);
  let last: MapExtras = { rects, images: [], labels: [] };
  minimap.setExtras(() => { last = minimapOverlay(host, rects); return last; });
  fullMap?.setExtras(() => fullMapOverlay(host, rects, atlas));
  scope.onDispose(() => { minimap.setExtras(null); fullMap?.setExtras(null); });
  return () => last;
}
