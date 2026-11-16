import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { manifestFolders, outputManifest, builtShardFolders } from './shard-outputs.mjs';
import { bootCases } from './parity/boot-smoke.mjs';
import { explorerCases } from './parity/explorer-smoke.mjs';

// Read the same authored scalar catalogue and output composition used by gen-shards.
const root = resolve(process.argv[2] ?? '.');
const rows = builtShardFolders(root, manifestFolders(root)).map(product => {
  const row = product.output === null ? JSON.parse(readFileSync(resolve(root, 'src/shards', product.folder, 'manifest.json'), 'utf8'))
    : outputManifest(root, product.folder, product.output);
  return { slug: product.slug, status: row.status, legacy: false, shardSelect: row.shardSelect !== false, order: row.order ?? 0, card: row.card };
}).sort((left, right) => left.order - right.order || left.slug.localeCompare(right.slug));
const all = rows.map(row => row.slug);
// Shared game data may refer to a shard-named asset (for example the common
// weapon catalogue). Preserve those exact references in every leg.
const shared = new Set();
for (const row of rows) for (const url of Object.values(row.card ?? {})) {
  if (typeof url === 'string' && url.startsWith('/assets/')) shared.add(url.slice(1));
}
/** @param {string} directory */
function scan(directory) {
  for (const row of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, row.name);
    if (row.isDirectory() && row.name !== 'test') scan(path);
    else if (row.isFile() && /\.(?:json|ts|mjs)$/u.test(row.name) && !row.name.endsWith('.test.ts')) {
      const text = readFileSync(path, 'utf8');
      for (const match of text.matchAll(/['"`](\/assets\/[^'"`\s$]*)/gu)) {
        // A generic URL prefix is a reader capability, not a file dependency.
        if (/\.[a-z0-9]+$/iu.test(match[1]) && !match[1].includes('..')) shared.add(match[1].replace(/^\//u, ''));
      }
    }
  }
}
for (const dir of ['client/game', 'shared/game', 'server/game', 'cook/game', 'client/engine', 'shared/engine', 'server/engine']) scan(resolve(root, 'src', dir));
const plan = {
  'boot-public': bootCases(rows, 'public').map(row => row[1]),
  'boot-developer': bootCases(rows, 'developer').map(row => row[1]),
  // Grid prediction may prepare any declared neighbour, even before a crossing.
  'boot-grid': all, 'hover-chromium': all, 'hover-webkit': all,
  explorer: explorerCases(rows),
  // Its real road crossings can trigger declared neighbour prediction. Preserve
  // the same complete grid set; the manifest binds its exact shared archive.
  'phone-route': all,
  shared: [...shared].sort((left, right) => left.localeCompare(right)),
};
process.stdout.write(`${JSON.stringify(plan)}\n`);
