import * as contentBounds from '@wildshard/format/contentBounds';

// Chunk spec from sources/wildshard/FUNDAMENTALS.md — fixed for every shard.
export const CHUNK_SIZE: 500 = contentBounds.CHUNK_SIZE;
export const CHUNK_HALF: number = contentBounds.CHUNK_HALF;
/** The page camera's vertical field of view at boot (degrees): what a level draws with until a weapon of its kit writes its own. */
export const CAMERA_FOV = 72;
export const CHUNK_DEPTH = 100;       // metres of rock under the surface (the floating slab)
export const ROAD_WIDTH = 15;         // entry road at each edge midpoint
export const ROAD_LENGTH = 60;        // must be >= 50m into the chunk
/** Legal midpoint entry opening, independent from the boulevard's width (metres). */
export const ENTRY_WIDTH: 8 = contentBounds.ENTRY_WIDTH;
/** Neutral platform asphalt reserved inside each legal midpoint entry (metres). */
export const ENTRY_ASPHALT: 15 = contentBounds.ENTRY_ASPHALT;
// The cell every level fits in (Jake, 2026-10-03, MMO-REQUIREMENTS W1 / O1): 500 × 500 × 500 m, split evenly around
// the highway level y = 0. Validation reads these (SHARD-PLATFORM SP4); CHUNK_DEPTH above is only the drawn rock slab.
export const CELL_HEIGHT: 500 = contentBounds.CELL_HEIGHT;
export const CELL_BELOW: 250 = contentBounds.CELL_BELOW;
export const CELL_ABOVE: number = contentBounds.CELL_ABOVE;

/** Decimal bytes per MB in the streaming cost model. */
export const CONTENT_MB: 1000000 = contentBounds.CONTENT_MB;
/** Provisional phone caps v1 (SF22a); shadow draws count in each draw cap. */
export const CONTENT_CAPS: { readonly l0: { readonly size: 62.5; readonly resident: number; readonly compressed: number; readonly triangles: 40000; readonly draws: 8; }; readonly l1: { readonly size: 125; readonly resident: number; readonly compressed: number; readonly triangles: 10000; readonly draws: 2; }; readonly far: { readonly resident: number; readonly compressed: 1000000; readonly triangles: 8000; readonly draws: 1; }; readonly library: { readonly resident: number; readonly compressed: number; }; readonly sim: { readonly resident: number; readonly compressed: number; }; readonly engineBase: number; readonly playing: number; readonly loading: number; readonly l0Count: 40; readonly l1Count: 32; readonly farCount: 9; readonly simCount: 4; readonly libraryCount: 4; readonly overlap: number; readonly residentFactor: 1.11; readonly nearRadius: 150; readonly shadowRadius: 80; readonly pitch: 562.5; } = contentBounds.CONTENT_CAPS;

export const TERRAIN_RES = 256;       // vertices per side

// ── per-shard values ──
// Live bindings mirrored from the active ShardManifest (src/client/game/shard/registry.ts). They are set when the
// registry module initialises (from ?chunk=) and again on setActiveChunk(); read them at build time,
// not at module top level, unless your module imports the registry / Heightfield first.
// The defaults are the default level's (the registry's DEFAULT_CHUNK), so a read before the registry has run sees the
// level a bare URL boots.
export let CHUNK_COORDS = '(−1, +6)';
export let TREE_COUNT = 0;
export let SEED = 0x5ea1;

/** the level this page booted: the registry's first apply (from ?chunk= at its import, before standalone mode strips the
 *  query for crash-safe recovery); '' until the registry runs. Travel never changes it. */
export let PAGE_LEVEL = '';

interface ChunkConstants { slug: string; label: string; seed: number; treeCount: number }
let homeConstants: ChunkConstants | null = null;
const frames: { constants: ChunkConstants }[] = [];
function publishConstants(c: ChunkConstants): void {
  CHUNK_COORDS = c.label; SEED = c.seed; TREE_COUNT = c.treeCount;
}

/** Retained frame constants; PAGE_LEVEL always remains the document's original level. */
export function bindChunkConstants(c: ChunkConstants): () => void {
  if (frames.length === 0) homeConstants = { slug: PAGE_LEVEL, label: CHUNK_COORDS, seed: SEED, treeCount: TREE_COUNT };
  const entry = { constants: c }; frames.push(entry); publishConstants(c);
  return () => {
    const index = frames.indexOf(entry); if (index === -1) return;
    frames.splice(index, 1);
    const next = frames.at(-1)?.constants ?? homeConstants;
    if (next !== null) publishConstants(next);
  };
}

/** @internal — called by the chunk registry; do not call from features. */
export function _applyChunkConstants(c: { slug: string; label: string; seed: number; treeCount: number }): void {
  if (PAGE_LEVEL === '') PAGE_LEVEL = c.slug;
  homeConstants = c;
  if (frames.length === 0) publishConstants(c);
}
