#!/usr/bin/env node
// C1 (J28): `cook <shardfile.tar> <out>`, a shard's packs from its tarball alone: no bundle, no src/shards, no public/.
//   node --import ./scripts/bake-loader.mjs scripts/cook.mjs <shardfile.tar> <out>
// `out` receives `assets/spawn/parts/<hash>.pack.br`, one manifest per tier and set, and what no part may hold at its URL.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { BrotliSizeCache } from '../src/cook/game/brotliSizeCache.mjs';

const { cookShard, servedAsIs } = await import('../src/cook/game/shardCook.ts');
const [tarball, out] = process.argv.slice(2);
if (tarball === undefined || out === undefined) throw new Error('usage: cook <shardfile.tar> <out>');
const served = new BrotliSizeCache(process.env.WILDSHARD_WIRE_SIZE_CACHE ?? resolve(homedir(), '.cache/wildshard/gen/served-bytes/1'));
const report = await cookShard(readFileSync(tarball), resolve(out), {
  now: () => performance.now(),
  wireBytes: (url, bytes) => servedAsIs(url, bytes) ? bytes.length : served.bytes(bytes),
  warn: line => { console.warn(`warning: ${line}`); },
});
console.log(JSON.stringify(report));
