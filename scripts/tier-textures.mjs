#!/usr/bin/env node
// S12 (J330): a shard's phone textures cooked from its masters by mip trim, measured against what phones read today.
//   node --import ./scripts/bake-loader.mjs scripts/tier-textures.mjs out/pine-hollow [--max=512] [--out=tmp/<lane>/phone]
// Reads an opened product dir (`out/<slug>`: discovery.json's KTX2 table and mounts/), no shardfile upload, no network.
// For every row of the shard's phone table it prints three columns: today's phone file (a hand-made 6×6 / 512 set or a
// GPU twin), the desktop master trimmed to --max by `trimKtx2`/`tierGlb` (what a trim-only cook would ship), and today's
// phone file trimmed to --max. Bytes are file bytes; GPU is `ktx2GpuBytes`, mips included. --out writes the trimmed
// phone files at their URL paths, for a browser to load.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const { glbImages, isKtx2, ktx2GpuBytes, masterOf, phoneTier, tierGlb, trimKtx2 } = await import('../src/cook/game/tierTextures.ts');

const args = process.argv.slice(2), flag = (/** @type {string} */ name) => args.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const product = args.find(arg => !arg.startsWith('--'));
if (product === undefined) throw new Error('usage: tier-textures <product-dir> [--max=512] [--out=dir]');
const max = Number(flag('max') ?? 512), out = flag('out');
// --astc6 (S12c): a fourth column, the masters trimmed and re-encoded as ASTC 6×6 by the cook's encoder (`basisuAstc6`), as
// `phoneTier` cooks them with an encoder; its cache is the cook's, so a second run encodes nothing.
const astc6 = args.includes('--astc6') ? (await import('../src/cook/game/astc6Encode.ts')).basisuAstc6(process.env.WILDSHARD_ASTC6_CACHE ?? resolve(homedir(), '.cache/wildshard/gen/astc6/1')) : undefined;
const slug = product.replace(/\/$/u, '').split('/').pop() ?? '';
const discovery = JSON.parse(readFileSync(join(product, 'mounts/shardfiles', slug, 'discovery.json'), 'utf8'));
/** @type {{phone: Record<string, string>, desktop: Record<string, string>}} */
const table = discovery.native.ktx2.args[0].shard;
/** @param {string} url @returns {Uint8Array | undefined} */
const read = url => { const path = join(product, 'mounts', url); return existsSync(path) ? new Uint8Array(readFileSync(path)) : undefined; };
/** @param {string} url @param {Uint8Array} bytes @returns {Uint8Array} */
const trim = (url, bytes) => (url.endsWith('.glb') ? tierGlb(bytes, max) : trimKtx2(bytes, max));
/** @param {string} url @param {Uint8Array} bytes @returns {number} */
const gpu = (url, bytes) => {
  if (url.endsWith('.ktx2')) return isKtx2(bytes) ? ktx2GpuBytes(bytes) : 0;
  if (url.endsWith('.glb')) return glbImages(bytes).reduce((total, image) => total + (isKtx2(image.bytes) ? ktx2GpuBytes(image.bytes) : 0), 0);
  return 0;
};
/** The desktop master of a phone source: the same source, or its name without the `.phone` / `-phone` mark. */
/** @param {string} source @returns {string | undefined} */
const master = source => masterOf(table.desktop, source);

/** @type {Record<string, [number, number]>} */
const sum = { today: [0, 0], master: [0, 0], cooked: [0, 0], trimmed: [0, 0], astc6: [0, 0] };
let rows = 0, missing = 0, mastered = 0;
for (const [source, phoneUrl] of Object.entries(table.phone)) {
  if (!/\.(?:glb|ktx2)$/u.test(phoneUrl)) continue;
  const phone = read(phoneUrl);
  if (phone === undefined) { missing++; continue; }
  rows++;
  const masterUrl = master(source), masterBytes = masterUrl === undefined ? undefined : read(masterUrl);
  const cooked = masterBytes === undefined || masterUrl === undefined ? trim(phoneUrl, phone) : trim(masterUrl, masterBytes);
  if (masterBytes !== undefined) mastered++;
  const trimmed = trim(phoneUrl, phone);
  /** @param {string} key @param {string} url @param {Uint8Array} bytes */
  const add = (key, url, bytes) => { const row = sum[key] ?? [0, 0]; row[0] += bytes.length; row[1] += gpu(url, bytes); sum[key] = row; };
  add('today', phoneUrl, phone);
  add('master', masterUrl ?? phoneUrl, masterBytes ?? phone);
  add('cooked', masterUrl ?? phoneUrl, cooked);
  add('trimmed', phoneUrl, trimmed);

  if (out !== undefined) { const path = resolve(out, `.${phoneUrl}`); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, trimmed); }
}
// --astc6: what `phoneTier` ships with the encoder, row by row: its cooked file, or today's where it keeps one (a `#layer` or horizon row).
if (astc6 !== undefined) {
  const tier = phoneTier(new TextEncoder().encode(JSON.stringify(discovery)), read, undefined, astc6.encode);
  const cookedTable = tier === undefined ? table : JSON.parse(new TextDecoder().decode(tier.discovery)).native.ktx2.args[0].shard;
  const made = new Map([...(tier?.files.values() ?? [])].flat().map(file => [file.url, file.bytes]));
  for (const url of Object.values(cookedTable.phone)) {
    if (!/\.(?:glb|ktx2)$/u.test(url)) continue;
    const bytes = made.get(url) ?? read(url);
    if (bytes === undefined) continue;
    const row = sum.astc6 ?? [0, 0]; row[0] += bytes.length; row[1] += gpu(url, bytes); sum.astc6 = row;
  }
}
const mb = (/** @type {number} */ n) => (n / 1e6).toFixed(2);
console.log(`${slug} phone table: ${rows} KTX2/GLB rows (${mastered} with a desktop master, ${missing} not in the product), --max=${max}`);
for (const [key, label] of [['today', 'phone today'], ['master', 'desktop masters'], ['cooked', `masters trimmed to ${max}`], ['trimmed', `phone today trimmed to ${max}`], ...(astc6 === undefined ? [] : [['astc6', "the cook's phone table, 6x6"]])]) {
  console.log(`${label.padEnd(28)} file ${mb(sum[key]?.[0] ?? 0).padStart(7)} MB  GPU ${mb(sum[key]?.[1] ?? 0).padStart(7)} MB`);
}
if (astc6 !== undefined) console.log(`astc6: ${astc6.stats.encoded} encoded, ${astc6.stats.reused} reused, ${astc6.stats.failed} failed`);
