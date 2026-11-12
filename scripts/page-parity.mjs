#!/usr/bin/env node
// Page parity (meta OFF-VERCEL-PLAN OV2, J272): do two hosts serving the same build answer alike?
//
//   node scripts/page-parity.mjs <old> <new> [--identity]
//   node scripts/page-parity.mjs https://play.wildshard.io https://<version>-wildshard-play.<subdomain>.workers.dev
//
// It asks both hosts for a fixed list of 30 URLs, one or more for each header rule in public/_headers (and so in
// vercel.json), and compares status, cache-control, content-type, content-encoding and clear-site-data. Hashed names
// come from the old host's own files (index.html, sw.js, asset-index.json, deploy-chunks.json, the spawn books), so
// both hosts must serve the same build. Any difference exits 1: J272 answer 3, parity blocks a cutover. `server` and
// the approved COOP/COEP headers are not compared, so they never block.
// A redirect's or a 404's content type is not compared (Vercel says text/plain, Workers nothing).
// `--identity` asks without compression, for a local `wrangler dev`, which never compresses.

import process from 'node:process';

const FIELDS = ['status', 'cache-control', 'content-type', 'content-encoding', 'clear-site-data'];

const args = process.argv.slice(2);
const identity = args.includes('--identity');
const [oldBase, newBase] = args.filter(arg => !arg.startsWith('--'));
if (oldBase === undefined || newBase === undefined) {
  console.error('usage: node scripts/page-parity.mjs <old> <new> [--identity]');
  process.exit(2);
}
const headers = { 'accept-encoding': identity ? 'identity' : 'br, gzip', 'user-agent': 'wildshard-page-parity' };

/** @param {string} base @param {string} path */
async function get(base, path) {
  const response = await fetch(new URL(path, base), { headers, redirect: 'manual' });
  await response.body?.cancel();
  return response;
}

/** @param {string} path @returns {Promise<string>} */
async function text(path) {
  const response = await fetch(new URL(path, oldBase), { headers });
  if (!response.ok) throw new Error(`${oldBase}${path} answered ${String(response.status)}`);
  return response.text();
}

/** @param {string} what @param {string | undefined} found */
function need(what, found) {
  if (found === undefined) throw new Error(`no ${what} found on ${oldBase}`);
  return found.startsWith('/') ? found : `/${found}`;
}

/** The 30 URLs: the fixed paths, then one hashed name per rule, found on the old host. */
async function urls() {
  const [page, sw, index, chunks, version] = await Promise.all([text('/'), text('/sw.js'), text('/asset-index.json'),
    text('/deploy-chunks.json'), text('/version.json')]);
  const { build } = /** @type {{ build: string }} */ (JSON.parse(version));
  const assets = Object.keys(/** @type {Record<string, number>} */ (JSON.parse(index)));
  const asset = (/** @type {RegExp} */ re) => need(String(re), assets.find(path => re.test(path)));
  const carried = /** @type {{ builds: { build: string, files: { path: string }[] }[] }} */ (JSON.parse(chunks)).builds
    .find(row => row.build === build)?.files.map(file => file.path) ?? [];
  const clientBook = need('client spawn book', carried.find(path => path.startsWith('assets/spawn/driftwood-isle-client-desktop-')));
  const [clientParts, serverBook, shard] = await Promise.all([text(clientBook), text(`/assets/spawn/server-${build}.json`),
    text('/shardfiles/driftwood-isle/shard.json')]);
  return [
    '/', '/index.html', '/?doctor', '/index.html?doctor', '/version.json', '/asset-index.json', '/asset-manifest.json',
    '/manifest.webmanifest', '/sw.js', '/clear-cache.json', '/deploy-chunks.json', '/favicon.png', '/trailer-15.mp4',
    '/page-parity-missing.js', '/basis/r186/basis_transcoder.wasm',
    need('page chunk', /"(\/b\/[^"]+\.css)"/u.exec(page)?.[1]),
    need('carried build chunk', carried.find(path => path.startsWith(`b/${build}/`) && path.endsWith('.js'))),
    need('sw-core file', /\/sw-core\/[0-9a-f]+\.js/u.exec(sw)?.[0]),
    asset(/^\/assets\/physics\//u), asset(/^\/assets\/tex\//u), asset(/^\/assets\/models\/.*\.bin$/u),
    asset(/^\/assets\/hdri\/.*\.hdr$/u), asset(/^\/assets\/music\/.*\.json$/u), asset(/^\/assets\/sfx\/.*\.json$/u),
    asset(/^\/assets\/baked\/.*\.glb$/u), asset(/\.ktx2$/u), asset(/\.gltf$/u),
    need('shard blob', /blobs\/[a-z]+\/[0-9a-f]{64}\.[a-z0-9]+/u.exec(shard)?.[0]?.replace(/^/u, 'shardfiles/driftwood-isle/')),
    need('client part', /[0-9a-f]{16}\.pack\.br/u.exec(clientParts)?.[0]?.replace(/^/u, 'assets/spawn/parts/')),
    need('server part', /\/assets\/spawn\/server\/[0-9a-f]{16}\.pack\.br/u.exec(serverBook)?.[0]),
  ];
}

const list = await urls();
if (list.length !== 30) throw new Error(`expected 30 URLs, built ${String(list.length)}`);
let differences = 0;
for (const path of list) {
  const [before, after] = await Promise.all([get(oldBase, path), get(newBase, path)]);
  const value = (/** @type {Response} */ response, /** @type {string} */ field) =>
    field === 'status' ? String(response.status) : response.headers.get(field) ?? '-';
  // A redirect or a 404 has no body to type: Vercel says text/plain, Workers says nothing. Only its content type is skipped.
  const bodiless = before.status === after.status && (before.status === 404 || (before.status >= 300 && before.status < 400));
  const differ = FIELDS.filter(field => !(bodiless && field === 'content-type') && value(before, field) !== value(after, field));
  differences += differ.length;
  console.log(`${differ.length === 0 ? 'same' : 'DIFF'}  ${path}`);
  for (const field of differ) console.log(`      ${field}: ${value(before, field)}  →  ${value(after, field)}`);
}
console.log(differences === 0
  ? `page parity: ${String(list.length)} URLs, no difference (${FIELDS.join(', ')})`
  : `page parity: ${String(differences)} difference(s) across ${String(list.length)} URLs; a cutover is blocked (J272)`);
process.exit(differences === 0 ? 0 : 1);
