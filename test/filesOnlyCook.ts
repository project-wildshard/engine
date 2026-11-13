// AUDIO AU19 / AU6: the real spawn-manifest cook over pinned products, files only (`BuildHalf.filesOnly`: no parts, a
// row's wire size its raw size), with this checkout's boot tables baked in as the app build bakes them. A build root in
// the repository's tmp/ holds the tables, links to the products, public/ and src/shards (their recorded fences).
// oxlint-disable-next-line import/no-nodejs-modules -- Bake this checkout's boot tables, as the app build does.
import { spawnSync } from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- Read the pinned products and own the cook's folder.
import { existsSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Keep the cook's folder inside the repository's tmp/.
import { resolve } from 'node:path';
import { writeSpawnManifests, type BuildHalf, type SpawnManifestBook } from '../src/cook/game/entryTotals';
import type { AssetTables } from '../src/shared/engine/boot/tables';
import { ASSET_TABLES, assetTableAddresses, readAssetTables, writeAssetTables } from '../scripts/app-build/assetTables.mjs';
import { GPU_FILES } from '../src/client/engine/boot/ktx2.generated';

export interface FilesOnlyCook { readonly root: string; readonly output: string; readonly book: SpawnManifestBook; readonly common: AssetTables }

/** Cook `shards` (folders under out/) in a new folder under tmp/<scratch>; the caller removes `root`. */
export async function cookFilesOnly(shards: readonly string[], scratch: string): Promise<FilesOnlyCook> {
  mkdirSync(`tmp/${scratch}`, { recursive: true });
  const root = mkdtempSync(resolve(`tmp/${scratch}/cook-`));
  const baked = spawnSync(process.execPath, ['--import', './scripts/bake-loader.mjs', 'scripts/serialize-asset-tables.mjs'],
    { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'inherit'] });
  if (baked.status !== 0) throw new Error(`boot tables did not bake (${String(baked.status)})`);
  mkdirSync(resolve(root, 'out/.app'), { recursive: true });
  writeFileSync(resolve(root, ASSET_TABLES), baked.stdout);
  for (const shard of shards) symlinkSync(resolve('out', shard), resolve(root, 'out', shard));
  symlinkSync(resolve('public'), resolve(root, 'public'));
  // A shard's recorded fence (src/shards/<slug>/fence-reads.json) is the cook's other way to list audio.
  if (existsSync('src/shards')) { mkdirSync(resolve(root, 'src'), { recursive: true }); symlinkSync(resolve('src/shards'), resolve(root, 'src/shards')); }
  const common = JSON.parse(readAssetTables(root).common.source) as AssetTables;
  const output = resolve(root, 'dist');
  mkdirSync(resolve(output, 'assets'), { recursive: true });
  writeAssetTables(output, root);
  const build: BuildHalf = { cacheName: scratch, gpuFiles: GPU_FILES, filesOnly: true, tables: readAssetTables,
    tableAddresses: at => assetTableAddresses(readAssetTables(at)), seams: () => { throw new Error('no grid seams in this root'); } };
  const input = { common: [], client: [], grid: [], optional: { files: [], groups: {} }, extras: {},
    products: Object.fromEntries(shards.map(shard => [`/shardfiles/${shard}/`, [0, 0]])) };
  const book = await writeSpawnManifests(output, input, { '000': {} }, root, build);
  return { root, output, book, common };
}
