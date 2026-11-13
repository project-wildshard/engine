#!/usr/bin/env node
// C1 (J28): `cook <shardfile.tar> <out>`, a shard's packs from its tarball alone: no bundle, no src/shards, no public/.
//   node --import ./scripts/bake-loader.mjs scripts/cook.mjs <shardfile.tar> <out> [--phone-textures] [--phone-astc6]
// `out` receives `assets/spawn/parts/<hash>.pack.br`, one manifest per tier and set, and what no part may hold at its URL.
// --phone-textures (S12b): the phone manifests list each KTX2 table row trimmed to its phone size (`phoneTier`).
// --phone-astc6 (S12c, implies --phone-textures): each phone row is cooked from its desktop master as ASTC 6×6 with
// basisu (`basisuAstc6`), cached in $WILDSHARD_ASTC6_CACHE (default ~/.cache/wildshard/gen/astc6/1); the counts go to stderr.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { BrotliSizeCache } from '../src/cook/game/brotliSizeCache.mjs';

const { cookShard, servedAsIs } = await import('../src/cook/game/shardCook.ts');
const flags = process.argv.slice(2).filter(arg => arg.startsWith('--')), unknown = flags.find(flag => flag !== '--phone-textures' && flag !== '--phone-astc6');
if (unknown !== undefined) throw new Error(`cook: unknown flag ${unknown}`);
const [tarball, out] = process.argv.slice(2).filter(arg => !arg.startsWith('--'));
if (tarball === undefined || out === undefined) throw new Error('usage: cook <shardfile.tar> <out> [--phone-textures] [--phone-astc6]');
const served = new BrotliSizeCache(process.env.WILDSHARD_WIRE_SIZE_CACHE ?? resolve(homedir(), '.cache/wildshard/gen/served-bytes/1'));
const astc6 = flags.includes('--phone-astc6')
  ? (await import('../src/cook/game/astc6Encode.ts')).basisuAstc6(process.env.WILDSHARD_ASTC6_CACHE ?? resolve(homedir(), '.cache/wildshard/gen/astc6/1'))
  : undefined;
const report = await cookShard(readFileSync(tarball), resolve(out), {
  now: () => performance.now(),
  wireBytes: (url, bytes) => servedAsIs(url, bytes) ? bytes.length : served.bytes(bytes),
  warn: line => { console.warn(`warning: ${line}`); },
  ...(flags.length > 0 ? { tiers: { phone: true, ...(astc6 === undefined ? {} : { encode: astc6.encode }) } } : {}),
});
if (astc6 !== undefined) console.warn(`astc6: ${astc6.stats.encoded} encoded, ${astc6.stats.reused} reused, ${astc6.stats.failed} failed`);
console.log(JSON.stringify(report));
