// The baked map's staleness key (SF66, G246 / G247): a hash of the files that place a shard's world. A shard's map image
// is baked from the world (scripts/bake-maps.mjs) and stamped with this hash in src/shards/<slug>/look/map.baked.json; the
// gate test (test/baked-maps.test.ts) recomputes it, so a world change without a rebake fails before it deploys.
// Node only, no git (an exported tree has no .git): file paths and contents, sorted.
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

// Sharp resolves from this file: engine's own devDependency here, the consumer's through the optional
// `sharp` peer when a shard repo or sharddev runs this script from its install of engine.
const sharp = createRequire(import.meta.url)('sharp');

/** Hash decoded sRGB RGBA8 pixels and their dimensions, independent of image encoding and metadata.
 * This binds a stamp to its raster; world freshness still requires the official map bake.
 * @param {string} image @returns {Promise<string>} */
export async function mapPixelHash(image) {
  // Decode these exact bytes: libvips' filename cache can retain a previous
  // raster when an official bake replaces the same path within one clock tick.
  const { data, info } = await sharp(readFileSync(image), { limitInputPixels: 4096 * 4096, animated: false, failOn: 'warning' })
    .toColourspace('srgb').ensureAlpha().raw({ depth: 'uchar' }).toBuffer({ resolveWithObject: true });
  if (info.channels !== 4) throw new Error(`${image}: map must decode to RGBA8`);
  return createHash('sha256').update(`map-rgba8/1\0${info.width}x${info.height}\0`).update(data).digest('hex');
}

/** Refuse an image omitted or replaced independently of its recorded bake stamp.
 * @param {string} image @param {string} expected @returns {Promise<void>} */
export async function verifyMapPixels(image, expected) {
  if (!/^[a-f0-9]{64}$/u.test(expected) || await mapPixelHash(image) !== expected) {
    throw new Error(`${image}: decoded pixels differ from map.baked.json; commit the official bake's image and stamp together`);
  }
}

/** what places a shard's world, relative to its folder; a shard may name its own in look/map.json ("inputs") */
export const DEFAULT_MAP_INPUTS = ['shard.config.ts', 'layout.ts', 'world', 'generators', 'models'];
/** the full cell the bake covers: CHUNK_SIZE (src/shared/engine/core/config.ts) metres square, centred on the origin */
export const MAP_METRES = 500;

/** @param {string} shardDir */
export function mapSettingsPath(shardDir) {
  const source = join(shardDir, 'data', 'map.json');
  return existsSync(source) ? source : join(shardDir, 'look', 'map.json');
}
/** Source-layout projects keep their stamp in data/; old projects retain look/. */
/** @param {string} shardDir */
export function mapStampPath(shardDir) {
  return existsSync(join(shardDir, 'data', 'map.json')) ? join(shardDir, 'data', 'productMap.json') : join(shardDir, 'look', 'map.baked.json');
}

/**
 * A shard's own map settings, src/shards/<slug>/look/map.json (optional): "inputs" (paths that place its world, in place of
 * DEFAULT_MAP_INPUTS) and "hide" (mesh name patterns the bake leaves out, a trailing * a prefix: a cloud sea over the
 * world, a backdrop), and "clipBelow" (metres: nothing under this height is drawn, a cloud sea under floating islands), "clipAbove" (metres: nothing
 * over this height is drawn, the towers that roof over a stack's floors, Nine Dragon),
 * "heightHide" (names left out of the height pass only: a painted layer that may colour the void but is not ground) and
 * "style" (G252: the stylizer's colour table and rules, scripts/map-stylize.py; a palette change rebakes, since this file is
 * part of the hash), "keep" (names whose subtree a "hide" pattern never reaches: Sky Reach's playable isles' keels share
 * the sky isles' model names) and "hideStanding" (the "hide" patterns whose hidden meshes also hide the instances that stand
 * on them: the firs on Sky Reach's decorative sky isles live in the archipelago's one instanced forest), with a "why".
 * "from" (G320): the shard's own world GLB (one of its inputs), baked in Node by scripts/bake-map-glb.mjs, not from a game page.
 * @param {string} shardDir @returns {{inputs: string[], hide: string[], heightHide: string[], keep: string[], hideStanding: string[], clipBelow: number | null, clipAbove: number | null, style: ({kind: string} & Record<string, unknown>) | null, from: string | null}}
 */
export function mapSettings(shardDir) {
  const own = mapSettingsPath(shardDir);
  if (!existsSync(own)) return { inputs: DEFAULT_MAP_INPUTS, hide: [], heightHide: [], keep: [], hideStanding: [], clipBelow: null, clipAbove: null, style: null, from: null };
  const parsed = JSON.parse(readFileSync(own, 'utf8'));
  const list = (/** @type {string} */ key) => {
    const value = parsed[key];
    if (value === undefined) return undefined;
    if (!Array.isArray(value) || !value.every((entry) => typeof entry === 'string')) throw new Error(`${own}: ${key} must be a string list`);
    return value;
  };
  if (typeof parsed.why !== 'string' || parsed.why.length === 0) throw new Error(`${own}: say why ("why")`);
  if (parsed.clipBelow !== undefined && typeof parsed.clipBelow !== 'number') throw new Error(`${own}: clipBelow must be metres`);
  if (parsed.clipAbove !== undefined && typeof parsed.clipAbove !== 'number') throw new Error(`${own}: clipAbove must be metres`);
  const style = parsed.style ?? null;
  if (style !== null && (typeof style !== 'object' || !['isle', 'void', 'ground'].includes(style.kind))) throw new Error(`${own}: style.kind must be isle, void or ground`);
  // G320: "from" names the shard's own world GLB; scripts/bake-map-glb.mjs bakes that map in Node, never from a game page
  if (parsed.from !== undefined && (typeof parsed.from !== 'string' || !parsed.from.endsWith('.glb') || !(list('inputs') ?? []).includes(parsed.from))) throw new Error(`${own}: from must name a .glb listed in inputs`);
  return { inputs: list('inputs') ?? DEFAULT_MAP_INPUTS, hide: list('hide') ?? [], heightHide: list('heightHide') ?? [], keep: list('keep') ?? [], hideStanding: list('hideStanding') ?? [], clipBelow: parsed.clipBelow ?? null, clipAbove: parsed.clipAbove ?? null, style, from: parsed.from ?? null };
}
/** @param {string} shardDir */
export const mapInputs = (shardDir) => mapSettings(shardDir).inputs;

/** Exact absolute roots contributing to mapTilesHash, including absent inputs.
 * Prefix matching these roots also catches newly added or deleted input files.
 * @param {string} shardDir @returns {string[]} */
export function mapInputRoots(shardDir) {
  const root = resolve(shardDir);
  return [...mapInputs(root).map(input => resolve(join(root, input))), resolve(mapSettingsPath(root))];
}

/** @param {string} dir @param {string[]} out */
function walk(dir, out) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    // Package-manager launchers differ across installations and isolated bakes.
    // Dependency identity comes from the declared lockfile, not node_modules.
    if (entry.name === 'node_modules') continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, out); else if (entry.isFile()) out.push(path);
  }
}

/** Sorted relative paths, retaining duplicate declared roots in the staleness key. @param {string} shardDir */
function mapInputFiles(shardDir) {
  const root = resolve(shardDir), files = [];
  for (const path of mapInputRoots(root)) { // the bake's own settings count too
    if (!existsSync(path)) continue;
    if (statSync(path).isDirectory()) walk(path, files); else files.push(path);
  }
  return files.map((f) => relative(root, f).split('\\').join('/')).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/** Per-file hashes for diagnosing a refused map on another build platform. @param {string} shardDir */
export function mapInputHashes(shardDir) {
  return Object.fromEntries(mapInputFiles(shardDir).map(file => [file, createHash('sha256').update(readFileSync(resolve(shardDir, file))).digest('hex')]));
}

/** The hash of a shard's map inputs: every file under each input (that exists), path and bytes. @param {string} shardDir */
export function mapTilesHash(shardDir) {
  const root = resolve(shardDir), hash = createHash('sha256');
  for (const file of mapInputFiles(root)) {
    hash.update(file); hash.update('\0'); hash.update(readFileSync(join(root, file))); hash.update('\0');
  }
  return hash.digest('hex');
}

/** Every shard folder with a shardfile project. @param {string} repoRoot @returns {{slug: string, dir: string}[]} */
export function mapShards(repoRoot) {
  const shards = resolve(repoRoot, 'src/shards');
  return readdirSync(shards, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(shards, entry.name, 'shard.config.ts')))
    .map((entry) => ({ slug: entry.name, dir: join(shards, entry.name) }))
    .sort((a, b) => a.slug.localeCompare(b.slug));
}

/** Publish one official map bake and its existing authored-product companion together.
 * Refuse stale world keys and mismatched pixels before writing either declaration.
 * @param {string} shardDir @param {string} image
 * @param {import('./map-hash.mjs').MapBakeStamp} stamp @returns {Promise<void>} */
export async function writeMapStamp(shardDir, image, stamp) {
  if (stamp.tilesHash !== mapTilesHash(shardDir)) throw new Error(`${shardDir}: map world inputs changed before publication`);
  await verifyMapPixels(image, stamp.pixelHash);
  const companion = join(shardDir, 'data', 'productMap.json');
  const authoredImage = join(shardDir, 'assets', 'map.webp');
  if (existsSync(companion) !== existsSync(authoredImage)) throw new Error(`${shardDir}: incomplete authored map companion`);
  const bytes = `${JSON.stringify(stamp, null, 2)}\n`;
  const stampPath = mapStampPath(shardDir);
  mkdirSync(join(shardDir, stampPath === companion ? 'data' : 'look'), { recursive: true });
  if (existsSync(companion)) {
    copyFileSync(image, authoredImage);
    writeFileSync(companion, bytes);
  }
  writeFileSync(stampPath, bytes);
}
