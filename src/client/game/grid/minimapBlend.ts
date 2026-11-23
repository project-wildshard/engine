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
import type { GridAssembly, GridCell } from '../../../shared/game/grid/assembly';
import type { GridCellEvents } from '../../../shared/game/grid/cellEvents';
import { RAIL_OFFSET, ROAD_HALF } from '../../../shared/game/grid/roadLayout';
import { FLAT_MAP_SPREAD } from '../../../shared/game/shardfile/cookedMapPath';
import { DRAWN_GRID_RADIUS } from '../../../shared/game/grid/catalogue';
import type { MapGrid } from '@wildshard/engine/ui/mapView';

/** On the road the neighbours' terrain shows at this opacity (G107: "faded ~50 %"). */
export const ROAD_TERRAIN_ALPHA = 0.5;
/** Where a cell's name sits on the road minimap: this far inside its edge, on its own ground, beside the feet. */
const NAME_IN = 12;
/** STAGING-BUGBASH SB32c (Jake's option 3): the cells' names show only on the road between cells, each while its spot is inside
 *  the minimap's disc (the engine minimap's 110 m view less its 9 m rim). Inside a cell no name shows: at Pine Hollow's spawn,
 *  5 m from the road, "DRIFTWOOD ISLE" across it read as the minimap's own title (as in Sky Reach before E435 narrowed it). */
const NAME_RANGE = 101;
/** A neighbour's baked map is kept at this many px a side (0.8 px per metre, 0.64 MB): the minimap shows it ~110 m across */
export const CELL_PX = 400;
/** J455: an empty cell of the 7 by 7 on the full map */
const EMPTY = '#2c3029';
/** QA 11-23-b row 16: an empty cell's survey lines, so it reads as open land waiting for a zone, not a flat grey block */
const SURVEY = '#3d4436', SURVEY_LINES = 3;
const STRIP = '#3b4038', ROAD = '#2a2e35', LINE = '#c9a640', VOID = '#0b1016', NAME = '#eaf6ff';
/** Each cell whose name spot is in the disc from the feet (home-frame metres), with an arrow toward it. */
function roadNames(host: MinimapBlendHost, feet: { readonly x: number; readonly z: number }): MapExtraLabel[] {
  const { home } = host, labels: MapExtraLabel[] = [], along = (v: number): number => Math.max(-CHUNK_HALF + 40, Math.min(CHUNK_HALF - 40, v));
  for (const cell of host.assembly.cells) {
    const lx = feet.x - cell.origin.x, lz = feet.z - cell.origin.z, beside = Math.abs(lx) - CHUNK_HALF >= Math.abs(lz) - CHUNK_HALF;
    const x = beside ? Math.sign(lx) * (CHUNK_HALF - NAME_IN) : along(lx), z = beside ? along(lz) : Math.sign(lz) * (CHUNK_HALF - NAME_IN);
    if (Math.hypot(x - lx, z - lz) > NAME_RANGE) continue;
    labels.push({ x: cell.origin.x - home.origin.x + x, z: cell.origin.z - home.origin.z + z, text: host.name(cell), color: NAME, toward: true });
  }
  return labels;
}
/** A cell the atlas has no tile for, until its own map loads: the build's plain-plot green (scripts/app-build/worldMapAtlas.ts). */
const PLOT = '#69704f';

/** J450: whether a decoded map is one flat colour; false when it can't be measured (no canvas), so the author's map stays. */
export function flatMap(image: CanvasImageSource): boolean {
  if (typeof document === 'undefined') return false;
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 32;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (ctx === null) return false;
  try {
    ctx.drawImage(image, 0, 0, 32, 32);
    const { data } = ctx.getImageData(0, 0, 32, 32);
    let sum = 0, square = 0;
    for (let i = 0; i < data.length; i += 4) { const l = 0.2126 * (data[i] ?? 0) + 0.7152 * (data[i + 1] ?? 0) + 0.0722 * (data[i + 2] ?? 0); sum += l; square += l * l; }
    const n = data.length / 4;
    return Math.sqrt(Math.max(0, square / n - (sum / n) ** 2)) < FLAT_MAP_SPREAD;
  } catch { return false; } finally { canvas.width = canvas.height = 0; }
}

/** Each shard's baked map, loaded the first time a cell of it is drawn, downscaled once and shared by its copies. */
interface MapEntry { image: HTMLCanvasElement | ImageBitmap | null; deferredAt?: number }
export class CellMinimaps {
  private readonly maps = new Map<string, MapEntry>();
  private disposed = false;
  constructor(scope: Scope, private readonly url: (slug: string) => Promise<string | {
    readonly url: string; readonly retained: (image: { readonly width: number; readonly height: number } | null) => void;
    /** J450: the cook's map, drawn instead when the author's own map is flat (`flatMap`) */
    readonly fallback?: string;
  } | undefined>, private readonly fullSize: (slug: string) => boolean = () => false,
  private readonly retry?: { revision: () => number; deferred: (error: unknown) => boolean },
  private readonly flat: (image: CanvasImageSource) => boolean = flatMap) {
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
  /** MAP-NEXT MN14: the shard's map if it is already loaded, without starting a load (the Bag map's cells past the atlas) */
  peek(slug: string): HTMLCanvasElement | ImageBitmap | null { return this.disposed ? null : this.maps.get(slug)?.image ?? null; }
  /** whether `slug`'s map is kept at full size (the home's), else at CELL_PX */
  fullSized(slug: string): boolean { return this.fullSize(slug); }
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
      const decode = async (at: string): Promise<ImageBitmap> => {
        const res = await fetch(at);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return createImageBitmap(await res.blob());
      };
      let full = await decode(url);
      // J450: an author's map that is one flat colour (Saltwind's, Cinder Orchard's) counts as no map: the cook's is drawn.
      // MN14: with no cook's map (a build-pinned slug) it is none at all, so the cell's atlas tile draws, not a flat disc
      const fallback = typeof leased === 'string' ? undefined : leased.fallback;
      if (!this.isDisposed() && this.flat(full)) {
        full.close();
        if (fallback === undefined) return;
        full = await decode(fallback);
      }
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


/** What the blend reads: the grid, the cell events, the feet (grid metres), each cell's map (null for the home: the minimap's
 *  own ground) and its shard name. */
export interface MinimapBlendHost {
  readonly assembly: GridAssembly; readonly home: GridCell; readonly cells: GridCellEvents;
  readonly worldFeet: () => { readonly x: number; readonly z: number };
  readonly image: (instance: string) => CanvasImageSource | null;
  /** MN14: a cell's map if already loaded, without starting a load (unset: none is) */
  readonly peek?: (instance: string) => CanvasImageSource | null;
  readonly name: (cell: GridCell) => string;
}
type AtlasTile = (slug: string) => Pick<MapExtraImage, 'image' | 'crop'> | null;
/** MAP-NEXT MN14: a cell's map, the one choice the HUD minimap and the Bag map both draw. Its own map (the author's look/map
 *  unless flat, else the cook's: CellMinimaps) once loaded, else the build's atlas tile (a pinned slug's cooked render), else,
 *  for a cell the atlas lacks (a placed upload), its own map loaded now. `load` loads the cell's own map first (the cell you
 *  stand in, the home); otherwise the atlas stands in, so the overview never reads every cell's product (ZONE-ENTRY ZE14). */
export function cellMap(host: MinimapBlendHost, cell: GridCell, atlas: AtlasTile | undefined, load: boolean): Pick<MapExtraImage, 'image' | 'crop'> | null {
  const own = load ? host.image(cell.instance) : host.peek?.(cell.instance) ?? null;
  if (own !== null) return { image: own };
  const tile = atlas?.(cell.slug) ?? null;
  if (tile !== null || load) return tile;
  const image = host.image(cell.instance);
  return image === null ? null : { image };
}
/** The overlay for the feet now (pure but for the rasters; the home frame's metres). */
export function minimapOverlay(host: MinimapBlendHost, rects: readonly MapExtraRect[], atlas?: AtlasTile): MapExtras {
  const { assembly, home } = host, feet = host.worldFeet(), ox = home.origin.x, oz = home.origin.z;
  const inside = host.cells.cell === null ? undefined : assembly.at(feet.x, feet.z);
  // MN14: every cell's ground is cellMap's choice, the home's too (its atlas tile before painted ground: Mossgate's green disc)
  const homeMap = cellMap(host, home, atlas, true);
  const images: MapExtraImage[] = [];
  if (inside === undefined) {
    // G107 on the road: every cell in view faded, the home too. ZONE-ENTRY ZE14: another cell is its world map atlas tile
    // until its own map is loaded; its own map read admits its whole product (24 cells' worth on the first road step)
    for (const cell of assembly.cells) {
      const map = cell.instance === home.instance ? homeMap : cellMap(host, cell, atlas, false);
      if (map !== null) images.push({ ...map, x: cell.origin.x - ox, z: cell.origin.z - oz, size: 2 * CHUNK_HALF, alpha: ROAD_TERRAIN_ALPHA });
    }
    return { outside: VOID, baseAlpha: homeMap === null ? ROAD_TERRAIN_ALPHA : 0, rects, images, labels: roadNames(host, feet) };
  }
  // inside a cell: that shard at full strength and the road; no shard's name (SB32c: names are the road's). Painted ground
  // only for a home with neither its own map nor an atlas tile
  const map = inside.instance === home.instance ? homeMap : cellMap(host, inside, atlas, true);
  if (map !== null) images.push({ ...map, x: inside.origin.x - ox, z: inside.origin.z - oz, size: 2 * CHUNK_HALF, alpha: 1 });
  return { outside: VOID, baseAlpha: inside.instance === home.instance && map === null ? 1 : 0, rects, images, labels: [] };
}

/** The grid's full map (SF66): every cell's baked map at its cell, the road network, each shard's name near its cell's north
 *  edge; the home's own ground is the map's base layer. Home-frame metres. A cell the atlas has no tile for (a placed cell,
 *  QA-FEEDBACK 2026-11-13 row 44) draws its own baked map once that loads, and a plain-plot square until then. */
/** J455: the whole drawn 7 by 7 in the home frame, so the full map spans it, opens on you inside it and clamps its pan to it.
 *  Spanning only the placed cells' rectangle cut staging's map to 6 by 6 (QA 2026-11-19 row 31: x -2..3, z -2..3 placed).
 *  A lone shard (one cell) keeps its own map. */
export function fullMapGrid(assembly: GridAssembly, home: GridCell): MapGrid | undefined {
  if (assembly.cells.length < 2) return undefined;
  const p = assembly.pitch, edge = -(DRAWN_GRID_RADIUS + 0.5) * p;
  return { x0: edge - home.origin.x, z0: edge - home.origin.z, pitch: p, cells: 2 * DRAWN_GRID_RADIUS + 1 };
}
export function fullMapOverlay(host: MinimapBlendHost, rects: readonly MapExtraRect[], atlas?: AtlasTile): MapExtras {
  const { assembly, home } = host, ox = home.origin.x, oz = home.origin.z;
  const images: MapExtraImage[] = [], labels: MapExtraLabel[] = [], plots: MapExtraRect[] = [];
  let bareHome = false;
  for (const cell of assembly.cells) {
    const x = cell.origin.x - ox, z = cell.origin.z - oz;
    const text = host.name(cell);
    labels.push({ x, z: z + CHUNK_HALF - 90, text, short: text.split(' · ').at(-1) ?? text, color: NAME, width: CHUNK_HALF * 2 - 32, height: 160,
      fill: { x, z, width: assembly.pitch - 24, height: CHUNK_HALF * 2 - 32 } }); // MAP-NEXT MN9: the whole cell and its roads, at the overview
    // MN14: the same choice as the HUD minimap (cellMap); with an atlas a cell that has nothing yet is a plain plot
    const map = cellMap(host, cell, atlas, false);
    if (map !== null) images.push({ ...map, x, z, size: 2 * CHUNK_HALF, alpha: 1 });
    else if (atlas !== undefined) plots.push({ x, z, hx: CHUNK_HALF, hz: CHUNK_HALF, color: PLOT });
    else if (cell.instance === home.instance) bareHome = true;
  }
  const grid = fullMapGrid(assembly, home), side = grid === undefined ? 0 : grid.cells * grid.pitch;
  // the 7 by 7's empty cells past the placed rectangle show as the strips' ground, as the empty cells inside it do
  const ground: MapExtraRect[] = grid === undefined ? [] : [{ x: grid.x0 + side / 2, z: grid.z0 + side / 2, hx: side / 2, hz: side / 2, color: STRIP }];
  // and each empty cell as a darker square, so a clamped view's corner cell reads as a cell (J455), not as more strip
  if (grid !== undefined) {
    const taken = new Set(assembly.cells.map((c) => c.cell.join(',')));
    for (let i = -DRAWN_GRID_RADIUS; i <= DRAWN_GRID_RADIUS; i++) for (let j = -DRAWN_GRID_RADIUS; j <= DRAWN_GRID_RADIUS; j++)
      if (!taken.has(`${String(i)},${String(j)}`)) {
        const x = i * grid.pitch - ox, z = j * grid.pitch - oz;
        ground.push({ x, z, hx: CHUNK_HALF, hz: CHUNK_HALF, color: EMPTY });
        for (let k = 1; k <= SURVEY_LINES; k++) {
          const at = -CHUNK_HALF + (2 * CHUNK_HALF * k) / (SURVEY_LINES + 1);
          ground.push({ x: x + at, z, hx: 1.5, hz: CHUNK_HALF - 24, color: SURVEY }, { x, z: z + at, hx: CHUNK_HALF - 24, hz: 1.5, color: SURVEY });
        }
      }
  }
  return { outside: VOID, baseAlpha: bareHome ? 1 : 0, rects: [...ground, ...rects, ...plots], images, labels, ...(grid === undefined ? {} : { grid }) };
}

interface ExtrasSink { setExtras: (source: (() => MapExtras | null) | null) => void }
/** An inline author product plays on its own map rather than the grid's overlays. */
export function installAuthorMap(minimap: ExtrasSink, fullMap: ExtrasSink, scope: Scope, url: string): void {
  const map = new CellMinimaps(scope, () => Promise.resolve(url), () => true);
  const extras = (): MapExtras | null => {
    const image = map.image(url);
    return image === null ? null : { baseAlpha: 0, rects: [], labels: [], images: [{ image, x: 0, z: 0, size: CHUNK_HALF * 2, alpha: 1 }] };
  };
  minimap.setExtras(extras);
  fullMap.setExtras(extras);
  scope.onDispose(() => { minimap.setExtras(null); fullMap.setExtras(null); });
}
/** Feed the page's minimap (and its full map) while the grid runs; the overlays leave with the scope. */
export function installMinimapBlend(minimap: ExtrasSink, host: MinimapBlendHost, scope: Scope, fullMap?: ExtrasSink, atlas?: AtlasTile): () => MapExtras {
  const rects = roadRects(host.assembly, host.home);
  let last: MapExtras = { rects, images: [], labels: [] };
  minimap.setExtras(() => { last = minimapOverlay(host, rects, atlas); return last; });
  fullMap?.setExtras(() => fullMapOverlay(host, rects, atlas));
  scope.onDispose(() => { minimap.setExtras(null); fullMap?.setExtras(null); });
  return () => last;
}
