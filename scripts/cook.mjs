#!/usr/bin/env node
// C1 (J28): `cook <shardfile.tar> <out>`, a shard's packs from its tarball alone: no bundle, no src/shards, no public/.
//   node --import ./scripts/bake-loader.mjs scripts/cook.mjs <shardfile.tar> <out> [--phone-textures]
// `out` receives `assets/spawn/parts/<hash>.pack.br`, one manifest per tier and set, and what no part may hold at its URL.
// --phone-textures (S12b): the phone manifests list each KTX2 table row trimmed to its phone size (`phoneTier`).
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { BrotliSizeCache } from '../src/cook/game/brotliSizeCache.mjs';

const { cookShard, servedAsIs } = await import('../src/cook/game/shardCook.ts');
const flags = process.argv.slice(2).filter(arg => arg.startsWith('--')), unknown = flags.find(flag => flag !== '--phone-textures');
if (unknown !== undefined) throw new Error(`cook: unknown flag ${unknown}`);
const [tarball, out] = process.argv.slice(2).filter(arg => !arg.startsWith('--'));
if (tarball === undefined || out === undefined) throw new Error('usage: cook <shardfile.tar> <out> [--phone-textures]');
const served = new BrotliSizeCache(process.env.WILDSHARD_WIRE_SIZE_CACHE ?? resolve(homedir(), '.cache/wildshard/gen/served-bytes/1'));
const report = await cookShard(readFileSync(tarball), resolve(out), {
  now: () => performance.now(),
  wireBytes: (url, bytes) => servedAsIs(url, bytes) ? bytes.length : served.bytes(bytes),
  warn: line => { console.warn(`warning: ${line}`); },
  ...(process.argv.includes('--phone-textures') ? { tiers: { phone: true } } : {}),
});
console.log(JSON.stringify(report));
