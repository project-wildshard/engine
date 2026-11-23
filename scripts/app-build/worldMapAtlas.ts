import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import * as v from 'valibot';
import { readOutputDownloadIndex } from '@wildshard/format/outputDownload';
import { prepareGlbBuffers } from '@wildshard/format/glbBuffers';
import { basisuTextureMean, encodeMapPng, renderCookedMap, type TextureMean } from '../../src/cook/game/cookedMap';
import { FLAT_MAP_SPREAD } from '../../src/shared/game/shardfile/cookedMapPath';

const TILE = 256;
/** The baked atlas as the app build writes it (gitignored, beside the title tables): the image, and the define the
 *  bundle reads (`__GRID_MAP_ATLAS__`, vite.config.ts) with the image's hashed asset name. */
export const WORLD_MAP_ATLAS = 'out/.app/world-map.webp', WORLD_MAP_ROWS = 'out/.app/world-map.json';
const hash = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const plot = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><path fill="#69704f" d="M0 0h256v256H0z"/><path fill="none" stroke="#a6ad90" stroke-width="3" d="M10 10h236v236H10z"/><path stroke="#a6ad90" stroke-width="9" d="M128 0v256M0 128h256"/><path fill="none" stroke="#818a67" stroke-width="2" d="M28 28h78v78H28zM150 28h78v78h-78zM28 150h78v78H28zM150 150h78v78h-78z"/></svg>');

/** Read only the validated product's map section and its hash-checked image, never a runtime or its libraries. */
export function folderMapBytes(root: string, slug: string): Uint8Array | null {
  if (!/^_?[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(slug)) throw new Error('Invalid atlas product');
  const folder = resolve(root, 'out', slug), index = readOutputDownloadIndex(JSON.parse(readFileSync(resolve(folder, 'shard.json'), 'utf8')));
  const row = index.sections.find(section => section.name === 'look/map');
  if (row === undefined) return null;
  const bytes = readFileSync(resolve(folder, row.path));
  if (bytes.length !== row.bytes || hash(bytes) !== row.hash) throw new Error('Atlas map section differs from its product');
  const { map } = v.parse(v.object({ map: v.exactOptional(v.nullable(v.object({ image: v.string() }))) }), JSON.parse(bytes.toString('utf8')));
  if (map === null || map === undefined) return null;
  const file = index.files.find(candidate => candidate.hash === map.image);
  if (file === undefined) throw new Error('Atlas map is absent from its product');
  const image = readFileSync(resolve(folder, file.path));
  if (image.length !== file.compressed || hash(image) !== file.hash) throw new Error('Atlas image differs from its product');
  return image;
}

/** An author map's visible fraction. A flat image, like Saltwind's old map, has no usable coverage. */
async function authorMapCoverage(bytes: Uint8Array): Promise<number> {
  const { data, info } = await sharp(bytes, { limitInputPixels: 4096 * 4096 })
    .resize(32, 32, { fit: 'fill' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let sum = 0, square = 0, alpha = 0;
  for (let i = 0; i < data.length; i += info.channels) {
    const l = 0.2126 * (data[i] ?? 0) + 0.7152 * (data[i + 1] ?? 0) + 0.0722 * (data[i + 2] ?? 0);
    sum += l;
    square += l * l;
    alpha += (data[i + 3] ?? 0) / 255;
  }
  const n = data.length / info.channels, spread = Math.sqrt(Math.max(0, square / n - (sum / n) ** 2));
  return spread < FLAT_MAP_SPREAD ? 0 : alpha / n;
}

let textureMean: Promise<TextureMean | undefined> | undefined;
/** J450: the cook's own map of a built product (`src/cook/game/cookedMap.ts`), drawn from its world as the cook draws an upload's. */
async function folderCookedMap(root: string, slug: string): Promise<{bytes:Uint8Array, covered:number}> {
  const folder = resolve(root, 'out', slug), header: unknown = JSON.parse(readFileSync(resolve(folder, 'shard.json'), 'utf8'));
  const index = readOutputDownloadIndex(header), sections = new Map<string, unknown>();
  for (const row of index.sections) if (row.name.startsWith('world/')) sections.set(row.name, JSON.parse(readFileSync(resolve(folder, row.path), 'utf8')));
  const rows = v.parse(v.object({ files: v.array(v.object({ hash: v.string(), path: v.string(), kind: v.optional(v.string(), '') })) }), header).files;
  await prepareGlbBuffers();
  textureMean ??= basisuTextureMean();
  const map = renderCookedMap({ files: rows, sections, read: path => new Uint8Array(readFileSync(resolve(folder, path))) }, { size: TILE * 2, texture: await textureMean });
  return {bytes:encodeMapPng(map.rgba, map.size, map.size), covered:map.stats.covered};
}

/** Pack every declared product once. Repeated cells share its tile; missing map declarations get an explicit plot diagram. */
export async function bakeWorldMapAtlas(products: readonly string[], read: (slug: string) => Uint8Array | null | Promise<Uint8Array | null>): Promise<{
  readonly bytes: Uint8Array; readonly width: number; readonly height: number; readonly tileSize: number; readonly slugs: readonly string[];
}> {
  const slugs = [...new Set(products)].sort();
  if (slugs.length === 0 || slugs.length > 75) throw new Error('Invalid atlas product count');
  const columns = Math.ceil(Math.sqrt(slugs.length)), width = columns * TILE, height = Math.ceil(slugs.length / columns) * TILE;
  const inputs: { input: Buffer; left: number; top: number }[] = [];
  for (const [i, slug] of slugs.entries()) inputs.push({ input: await sharp(await read(slug) ?? plot, { limitInputPixels: 4096 * 4096 })
    .resize(TILE, TILE, { fit: 'fill' }).png().toBuffer(), left: (i % columns) * TILE, top: Math.floor(i / columns) * TILE });
  const bytes = await sharp({ create: { width, height, channels: 3, background: '#0b1016' } }).composite(inputs).webp({ quality: 85 }).toBuffer();
  if (bytes.length > 1_000_000) throw new Error('World map atlas exceeds its wire cap');
  return { bytes, width, height, tileSize: TILE, slugs };
}

/** One up-front map asset from all grid placements, shared by public and Developer, over the built products (was
 *  vite/worldMapAtlas.ts's config hook): scripts/build-app.mjs runs it after the generators. The grid's cells and every
 *  built placement: a released page adds cells from the signed placement file (placedCells.ts), mostly listed shards
 *  (QA-FEEDBACK 2026-11-13 row 44: open-plot-thin-ice had no tile). A placement this build didn't make, or a shard carded
 *  from the API after it (SA46), gets no tile: the page draws that cell's own map instead (minimapBlend.ts fullMapOverlay). */
export async function writeWorldMapAtlas(root: string): Promise<void> {
  const row = v.object({ slug: v.string() }), catalogue = v.parse(v.object({ placements: v.exactOptional(v.array(row)), shards: v.exactOptional(v.array(row)), grid: v.object({ cells: v.array(row) }) }),
    JSON.parse(readFileSync(Reflect.get(process.env, 'WILDSHARD_CATALOGUE') ?? resolve(root, 'test/pins/catalogue.json'), 'utf8')));
  const cells = catalogue.grid.cells.map(cell => cell.slug), builtHere = (slug: string): boolean => existsSync(resolve(root, 'out', slug, 'shard.json'));
  // MAP-NEXT MN17 (v0.1.76): a pinned shard the grid's cells and placements lack (Mossgate, Mirror Salt: placed by the signed
  // file, built here) gets its tile too. The page reads no cooked map for a slug the build has, so without one it drew a plot.
  const pinned = (catalogue.shards ?? []).map(shard => shard.slug);
  const slugs = [...cells, ...[...(catalogue.placements ?? []).map(placement => placement.slug), ...pinned].filter(builtHere)];
  // A filtered product build (build-shardfiles --shard) leaves only its own products, and the products copy
  // (outputFolders.mjs) publishes just those: the other cells draw the plot tile. A cold atlas, none built, still refuses.
  const built = new Set(slugs.filter(builtHere));
  // J450: keep a usable authored tile unless the world drawing covers ground that a sparse author image leaves out.
  const atlas = await bakeWorldMapAtlas(slugs, async slug => {
    if (built.size > 0 && !built.has(slug)) return null;
    const author = folderMapBytes(root, slug);
    const coverage = author === null ? 0 : await authorMapCoverage(author);
    if (coverage === 1) return author;
    const cooked = await folderCookedMap(root, slug);
    return coverage > 0 && coverage >= cooked.covered ? author : cooked.bytes;
  });
  const fileName = `assets/world-map-${hash(atlas.bytes).slice(0, 16)}.webp`;
  mkdirSync(dirname(join(root, WORLD_MAP_ATLAS)), { recursive: true });
  writeFileSync(join(root, WORLD_MAP_ATLAS), atlas.bytes);
  writeFileSync(join(root, WORLD_MAP_ROWS), JSON.stringify({ fileName, define: { url: `/${fileName}`, compressed: atlas.bytes.length,
    width: atlas.width, height: atlas.height, tileSize: atlas.tileSize, slugs: atlas.slugs } }));
}
