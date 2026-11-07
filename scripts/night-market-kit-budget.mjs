// @ts-check
// RM3: read the final product, not unmerged kit triangles or estimates of a live scene.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as v from 'valibot';
import { readBuiltShardfile } from './built-product.mjs';
import { outputFormat } from './shard-platform-format.mjs';
import { tileBakeCensus } from './tile-bakes.mjs';

// Use the existing format-only Node resolver installed by shard-platform-format, as tile-bakes does.
const { TilesSchema } = await import('@wildshard/format/shardSections');
const product = 'open-plot-night-market';
/** @param {Uint8Array} bytes */
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
/** @param {{compressed:number,decoded:number,gpu:number,triangles:number,draws:number}} row */
const cost = row => {
  const values = { compressed: row.compressed, resident: row.decoded + row.gpu, triangles: row.triangles, draws: row.draws };
  if (Object.values(values).some(value => !Number.isSafeInteger(value))) throw new Error('Night Market budget: cost exceeds exact integer range');
  return values;
};
/** @type {readonly ['compressed', 'resident', 'triangles', 'draws']} */
const metrics = ['compressed', 'resident', 'triangles', 'draws'];

/** Verify the sealed envelope/section and every tile dependency's actual wire bytes.
 * Per-tile declarations include repeated shared dependencies; uniqueTileClosure counts them once across both levels.
 * Resident/triangle/draw costs are build declarations, never a live-memory or frame-floor measurement.
 * RM8's 15k/300k targets are reported only; this tool changes no product cap or admission rule.
 * @param {string} folder */
export function readNightMarketKitBudget(folder) {
  const wire = readFileSync(resolve(folder, 'shard.json'));
  const index = outputFormat.parseOutputIndex(JSON.parse(wire.toString('utf8')));
  const receipt = v.parse(v.object({ indexHash: v.string() }), JSON.parse(readFileSync(resolve(folder, 'validation.json'), 'utf8')));
  if (index.identity.slug !== product || receipt.indexHash !== hash(wire)) throw new Error('Night Market budget: identity or index receipt differs');
  const section = index.sections.find(row => row.name === 'world/tiles');
  if (section === undefined) throw new Error('Night Market budget: missing tiles');
  const bytes = readFileSync(resolve(folder, section.path));
  if (bytes.length !== section.bytes || hash(bytes) !== section.hash) throw new Error('Night Market budget: tile section differs');
  const value = outputFormat.parseOutputSection(section.name, JSON.parse(bytes.toString('utf8')));
  const tiles = v.parse(TilesSchema, Reflect.get(value, 'tiles'));
  const census = tileBakeCensus(tiles, index.files);
  if (census.l0 !== 64 || census.l1 !== 16) throw new Error('Night Market budget: all 64 L0 and 16 L1 tiles required');
  const inventory = new Map(index.files.map(file => [file.hash, file]));
  /** @type {Set<string>} */
  const verified = new Set();
  const uniqueTileClosure = { compressed: 0, resident: 0, triangles: 0, draws: 0 };
  for (const tile of tiles) {
    const pending = [...tile.files];
    while (pending.length > 0) {
      const ref = pending.pop();
      if (ref === undefined || verified.has(ref)) continue;
      const file = inventory.get(ref);
      if (file === undefined) throw new Error(`Night Market budget: unresolved local tile dependency ${ref}`);
      const payload = readFileSync(resolve(folder, file.path));
      if (payload.length !== file.compressed || hash(payload) !== file.hash) throw new Error(`Night Market budget: tile payload differs ${ref}`);
      verified.add(ref); pending.push(...file.dependencies);
      const row = cost(file);
      for (const key of metrics) {
        uniqueTileClosure[key] += row[key];
        if (!Number.isSafeInteger(uniqueTileClosure[key])) throw new Error('Night Market budget: cost exceeds exact integer range');
      }
    }
  }
  const rows = tiles.map(tile => {
    const values = cost(tile);
    return { lod: tile.lod, x: tile.x, z: tile.z, compressed: values.compressed, resident: values.resident,
      triangles: values.triangles, draws: values.draws,
      rm8Target: tile.lod === 0 ? tile.triangles <= 15000 && tile.compressed <= 300000 : null };
  })
    .sort((a, b) => a.lod - b.lod || a.z - b.z || a.x - b.x);
  return { product, indexHash: hash(wire), basis: 'verified product wire; declared costs, not live memory',
    rm8Targets: { l0Triangles: 15000, l0Compressed: 300000, reportOnly: true }, rows,
    uniqueTileFiles: verified.size, uniqueTileClosure, existingCapDebt: census.debt };
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const root = resolve(import.meta.dirname, '..');
  console.info(JSON.stringify(readNightMarketKitBudget(readBuiltShardfile(root, product)), null, 2));
}
