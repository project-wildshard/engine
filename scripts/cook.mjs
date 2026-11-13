#!/usr/bin/env node
// C1 (J28): `cook <shardfile.tar> <out>`, a shard's packs from its tarball alone: no bundle, no src/shards, no public/.
//   node --import ./scripts/bake-loader.mjs scripts/cook.mjs <shardfile.tar> <out> [--no-phone-tier | --phone-textures | --phone-astc6]
// `out` receives `assets/spawn/parts/<hash>.pack.br`, one manifest per tier and set, and what no part may hold at its URL.
// By default (S12d) each phone row of the KTX2 table is cooked from its desktop master as ASTC 6×6 by basisu's
// WebAssembly build (`wasmAstc6`), cached in $WILDSHARD_ASTC6_CACHE (default ~/.cache/wildshard/gen/astc6-wasm/1).
// --no-phone-tier: phones read the rows as authored (before S12b). --phone-textures (S12b): trimmed to the phone size only.
// --phone-astc6 (S12c): the 6×6 encode by the basisu CLI (`basisuAstc6`), cached in ~/.cache/wildshard/gen/astc6/1.
// The encode counts go to stderr.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { BrotliSizeCache } from '../src/cook/game/brotliSizeCache.mjs';

const { cookShard, servedAsIs } = await import('../src/cook/game/shardCook.ts');
const FLAGS = new Set(['--no-phone-tier', '--phone-textures', '--phone-astc6']);
const flags = process.argv.slice(2).filter(arg => arg.startsWith('--')), unknown = flags.find(flag => !FLAGS.has(flag));
if (unknown !== undefined) throw new Error(`cook: unknown flag ${unknown}`);
const [tarball, out] = process.argv.slice(2).filter(arg => !arg.startsWith('--'));
if (tarball === undefined || out === undefined || flags.length > 1) throw new Error('usage: cook <shardfile.tar> <out> [--no-phone-tier | --phone-textures | --phone-astc6]');
const served = new BrotliSizeCache(process.env.WILDSHARD_WIRE_SIZE_CACHE ?? resolve(homedir(), '.cache/wildshard/gen/served-bytes/1'));
const wasm = flags.length === 0
  ? await (await import('../src/cook/game/astc6Wasm.ts')).wasmAstc6({ cacheDir: process.env.WILDSHARD_ASTC6_CACHE ?? resolve(homedir(), '.cache/wildshard/gen/astc6-wasm/1') })
  : undefined;
const astc6 = flags.includes('--phone-astc6')
  ? (await import('../src/cook/game/astc6Encode.ts')).basisuAstc6(process.env.WILDSHARD_ASTC6_CACHE ?? resolve(homedir(), '.cache/wildshard/gen/astc6/1'))
  : wasm;
const tiers = flags.includes('--no-phone-tier') ? {} : { phone: true, ...(astc6 === undefined ? {} : { encode: astc6.encode }), ...(wasm === undefined ? {} : { prepare: wasm }) };
const report = await cookShard(readFileSync(tarball), resolve(out), {
  now: () => performance.now(),
  wireBytes: (url, bytes) => servedAsIs(url, bytes) ? bytes.length : served.bytes(bytes),
  warn: line => { console.warn(`warning: ${line}`); },
  tiers,
});
if (astc6 !== undefined) console.warn(`astc6: ${astc6.stats.encoded} encoded, ${astc6.stats.reused} reused, ${astc6.stats.failed} failed`);
console.log(JSON.stringify(report));
