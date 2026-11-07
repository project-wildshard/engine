// @ts-check
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as v from 'valibot';
import { outputFormat } from './shard-platform-format.mjs';
import { parseTileBakePolicy, TILE_BAKE_POLICY } from './tile-bake-policy.mjs';

const { CONTENT_CAPS: caps } = await import('@wildshard/format/contentBounds');
const { TilesSchema } = await import('@wildshard/format/shardSections');
/** @param {string|Uint8Array} bytes */
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
/** @type {readonly ['resident','compressed','triangles','draws']} */
const metrics = ['resident', 'compressed', 'triangles', 'draws'];
/** @param {{decoded:number,gpu:number,compressed:number,triangles:number,draws:number}} row */
const cost = row => ({ resident: row.decoded + row.gpu, compressed: row.compressed, triangles: row.triangles, draws: row.draws });
/** @param {readonly ReturnType<typeof cost>[]} rows */
const sum = rows => rows.reduce((total, row) => {
  for (const metric of metrics) {
    total[metric] += row[metric];
    if (!Number.isSafeInteger(total[metric])) throw new Error('Tile aggregate cost exceeds exact integer range');
  }
  return total;
}, { resident: 0, compressed: 0, triangles: 0, draws: 0 });

/** Inspect every lattice coordinate and every full interior 5x5 window. Costs are
 * declarations, not a live-memory claim. Shared file dependencies are counted once
 * in each window's separate closure census; row caps retain their existing law.
 * @param {import('@wildshard/format/shardSchema').Shardfile['tiles']} input
 * @param {readonly {hash:string,commons?:true,dependencies:readonly string[],decoded:number,gpu:number,compressed:number,triangles:number,draws:number}[]} files */
export function tileBakeCensus(input, files) {
  const tiles = v.parse(TilesSchema, input), addresses = new Set(), windows = [];
  /** @type {Record<string,number>} */
  const debt = {};
  const inventory = new Map(files.map(file => [`${file.commons === true ? 'commons:' : ''}${file.hash}`, file]));
  /** @param {readonly string[]} roots */
  const closure = roots => {
    const seen = new Set(), pending = [...roots], costs = [];
    while (pending.length > 0) {
      const ref = pending.pop();
      if (ref === undefined || seen.has(ref)) continue;
      const file = inventory.get(ref);
      if (file === undefined) throw new Error(`Tile file/dependency is absent: ${ref}`);
      seen.add(ref); pending.push(...file.dependencies); costs.push(cost(file));
    }
    return sum(costs);
  };
  /** @param {string} prefix @param {ReturnType<typeof cost>} actual @param {ReturnType<typeof cost>} limits */
  const check = (prefix, actual, limits) => {
    for (const metric of metrics) if (actual[metric] > limits[metric]) debt[`${prefix}/${metric}`] = actual[metric];
  };
  for (const tile of tiles) {
    const size = tile.lod === 0 ? 8 : 4, width = 500 / size, key = `${tile.lod}/${tile.x}/${tile.z}`;
    if (tile.x >= size || tile.z >= size || addresses.has(key)) throw new Error(`Duplicate or outside tile: ${key}`);
    addresses.add(key);
    if (tile.bounds.min[0] !== -250 + tile.x * width || tile.bounds.max[0] !== -250 + (tile.x + 1) * width
      || tile.bounds.min[2] !== -250 + tile.z * width || tile.bounds.max[2] !== -250 + (tile.z + 1) * width) throw new Error(`Tile bounds differ from lattice: ${key}`);
    closure(tile.files);
    check(`tile/${key}`, cost(tile), tile.lod === 0 ? caps.l0 : caps.l1);
  }
  for (const lod of [0, 1]) for (let x = 0; x < (lod === 0 ? 8 : 4); x++) for (let z = 0; z < (lod === 0 ? 8 : 4); z++) {
    const key = `${lod}/${x}/${z}`;
    if (!addresses.has(key)) debt[`missing/${key}`] = 1;
  }
  for (let x = 2; x <= 5; x++) for (let z = 2; z <= 5; z++) {
    const rows = tiles.filter(tile => tile.lod === 0 && Math.abs(tile.x - x) <= 2 && Math.abs(tile.z - z) <= 2);
    const declared = sum(rows.map(cost)), unique = closure(rows.flatMap(tile => tile.files));
    check(`window/${x}/${z}`, declared, { resident: 25 * caps.l0.resident, compressed: 25 * caps.l0.compressed,
      triangles: 25 * caps.l0.triangles, draws: 25 * caps.l0.draws });
    windows.push({ x, z, tiles: rows.length, declared, unique });
  }
  return { l0: tiles.filter(tile => tile.lod === 0).length, l1: tiles.filter(tile => tile.lod === 1).length, debt, windows };
}

/** Verify the exact product envelope and tile bytes before applying bake policy.
 * No producer, build, cache mutation or live readiness latch is invoked.
 * @param {string} folder @param {string} product */
export function readTileBakeCensus(folder, product) {
  const bytes = readFileSync(resolve(folder, 'shard.json')), index = outputFormat.parseOutputIndex(JSON.parse(bytes.toString('utf8')));
  if (index.identity.slug !== (product === '_template' ? 'template' : product)) throw new Error(`${product}: tile product identity differs`);
  const receipt = JSON.parse(readFileSync(resolve(folder, 'validation.json'), 'utf8'));
  if (receipt.indexHash !== hash(bytes)) throw new Error(`${product}: tile index receipt differs`);
  const section = index.sections.find(row => row.name === 'world/tiles');
  if (section === undefined) throw new Error(`${product}: missing tile section`);
  const wire = readFileSync(resolve(folder, section.path));
  if (wire.length !== section.bytes || hash(wire) !== section.hash) throw new Error(`${product}: tile section hash/size differs`);
  const rows = outputFormat.parseOutputSection(section.name, JSON.parse(wire.toString('utf8')));
  return tileBakeCensus(v.parse(TilesSchema, Reflect.get(rows, 'tiles')), index.files);
}

/** A normal build or reuse cannot introduce new/more costly debt. Existing
 * exceptions are exact product/coordinate/metric rows, never whole-shard waivers.
 * @param {string} root @param {string} product @param {string} folder */
export function checkTileBake(root, product, folder) {
  const policy = parseTileBakePolicy(JSON.parse(readFileSync(resolve(root, TILE_BAKE_POLICY), 'utf8')));
  const census = readTileBakeCensus(folder, product), allowed = policy.products[product] ?? {};
  const failures = Object.entries(census.debt).filter(([key, value]) => value > (allowed[key] ?? 0));
  if (failures.length > 0) throw new Error(`${product}: tile bake refused: ${failures.map(([key, value]) => `${key} ${value} > ${allowed[key] ?? 0}`).join('; ')}`);
  return census;
}
