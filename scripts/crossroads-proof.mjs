#!/usr/bin/env node
// E5.2b: build the crossroads proof page (test/crossroads) with the server bytes of the four cells at its corner. It never ships
// with the game. `--out` is a folder Vercel or the smoke can serve as it stands.
//
//   node scripts/crossroads-proof.mjs [--out=tmp/crossroads/site] [--products=out]
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { build } from 'vite';
import { rapierAlias } from '../vite/rapier.ts';

const ROOT = resolve(import.meta.dirname, '..');
const option = (name, fallback) => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
/** The four cells around the corner the page stands at, and any world a player can reach from there on foot. */
export const CROSSROADS = ['driftwood-isle', 'nalati-grasslands', 'pine-hollow', '_template'];
const out = resolve(option('out', join(ROOT, 'tmp/crossroads/site'))), products = resolve(option('products', join(ROOT, 'out')));

/** Copy what a server can read of one product: the index, its sections, and its bin, json, wasm and tiles. */
export function copyServerProduct(from, to) {
  const index = JSON.parse(readFileSync(join(from, 'shard.json'), 'utf8')), server = index.files.filter(file => ['bin', 'json', 'wasm', 'tile'].includes(file.kind));
  for (const path of ['shard.json', 'sections', 'server', ...server.map(file => file.path)]) {
    try { mkdirSync(dirname(join(to, path)), { recursive: true }); cpSync(join(from, path), join(to, path), { recursive: true }); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}

rmSync(out, { recursive: true, force: true });
await build({ configFile: false, root: join(ROOT, 'test/crossroads'), base: '/', logLevel: 'warn', publicDir: false, resolve: { alias: rapierAlias }, assetsInclude: ['**/*.bin', '**/*.wasm'],
  define: { __TITLE_ASSET_URLS__: '{}', __BUILD_ID__: '"crossroads"' }, worker: { format: 'es' }, build: { outDir: out, emptyOutDir: true, target: 'es2022', minify: true, sourcemap: false } });
for (const slug of CROSSROADS) copyServerProduct(join(products, slug), join(out, 'shards', slug));
mkdirSync(join(out, 'assets/physics'), { recursive: true });
cpSync(join(ROOT, 'public/assets/physics/rapier.wasm'), join(out, 'assets/physics/rapier.wasm'));
writeFileSync(join(out, 'vercel.json'), `${JSON.stringify({ headers: [{ source: '/(.*)', headers: [{ key: 'Cache-Control', value: 'no-store' }] }] }, null, 2)}\n`);
console.info(`crossroads proof: ${out}`);
