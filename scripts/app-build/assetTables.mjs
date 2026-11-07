import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** The serialized boot table banks as the app build writes them (gitignored, beside the title tables): the bundle
 *  defines only their addresses (`__BOOT_TABLE_ASSETS__`, vite.config.ts) and ships each bank as one hashed asset. */
export const ASSET_TABLES = 'out/.app/boot-tables.json';

/** Move the exact generated values across a JSON transport, not into compiled JS. */
export function assetTableAsset(source) {
  const bytes = Buffer.byteLength(source);
  if (bytes < 2 || bytes > 16 * 1024 * 1024) throw new Error('Asset tables exceed their transport cap');
  const sha256 = createHash('sha256').update(source).digest('hex'), fileName = `assets/boot-tables-${sha256.slice(0, 8)}.json`;
  return { source, fileName, address: { url: `/${fileName}`, bytes, sha256 } };
}
/** A selected phone loads its geometry and its own late audio metadata together.
 * Unpacked homes still get an audio bank; unrelated homes remain excluded.
 * @param {Readonly<Record<string,unknown>>} packs @param {readonly string[]} homes */
export function selectedPackTables(packs, homes) {
  return Object.fromEntries(homes.map(slug => [slug, JSON.stringify({ bytes: {}, versions: {}, music: {}, sfx: {},
    packs: Object.fromEntries(Object.entries(packs).filter(([name]) => name === slug || name.startsWith(`${slug}-audio-`))) })]));
}
/** Common URL/tier/audio facts are shared; each selected pack bank has its own bytes. */
export function assetTableBanks(source) {
  const input = JSON.parse(source);
  if (typeof input !== 'object' || input === null || !('common' in input) || typeof input.common !== 'string'
    || !('all' in input) || typeof input.all !== 'string' || !('packs' in input) || typeof input.packs !== 'object' || input.packs === null) throw new Error('Invalid generated table banks');
  const packs = {};
  for (const [slug, value] of Object.entries(input.packs)) {
    if (!/^[a-z0-9_-]+$/u.test(slug) || typeof value !== 'string') throw new Error('Invalid generated pack bank');
    packs[slug] = assetTableAsset(value);
  }
  return { common: assetTableAsset(input.common), all: assetTableAsset(input.all), packs };
}

/** Serialize the boot tables after the generators (was vite/assetTables.ts's config hook). */
export function bakeAssetTables(root) {
  const run = spawnSync(process.execPath, ['--import', './scripts/bake-loader.mjs', 'scripts/serialize-asset-tables.mjs'],
    { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'inherit'] });
  if (run.error !== undefined) throw run.error;
  if (run.status !== 0) throw new Error(`Asset table serialization failed (${String(run.status)})`);
  assetTableBanks(run.stdout);
  mkdirSync(dirname(join(root, ASSET_TABLES)), { recursive: true });
  writeFileSync(join(root, ASSET_TABLES), run.stdout);
}

/** The baked banks; the app build serializes them first. */
export function readAssetTables(root) {
  let source;
  try { source = readFileSync(join(root, ASSET_TABLES), 'utf8'); }
  catch { throw new Error(`Missing ${ASSET_TABLES}: build the app through scripts/build-app.mjs, which serializes the boot tables first`); }
  return assetTableBanks(source);
}

/** `__BOOT_TABLE_ASSETS__`: each bank's address. */
export function assetTableAddresses(banks) {
  return { common: banks.common.address, all: banks.all.address, packs: Object.fromEntries(Object.entries(banks.packs).map(([slug, asset]) => [slug, asset.address])) };
}

/** Ship each bank's exact bytes once as its hashed asset beside the bundle. */
export function writeAssetTables(outDir, root) {
  const banks = readAssetTables(root);
  for (const asset of new Map([banks.common, banks.all, ...Object.values(banks.packs)].map(row => [row.fileName, row])).values()) {
    mkdirSync(dirname(join(outDir, asset.fileName)), { recursive: true });
    writeFileSync(join(outDir, asset.fileName), asset.source);
  }
}
