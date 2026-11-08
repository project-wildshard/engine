#!/usr/bin/env node
// J65: engine's products are pinned real shardfiles, not a shard build. `test/pins/shardfiles.json` names each one by the
// hash `api.wildshard.io` serves, and `test/pins/catalogue.json` is the catalogue document those heads came from.
//
//   node scripts/pins.ts refresh            re-pin to the live heads (read only: GETs)
//   node scripts/pins.ts install [slug...]  fetch, check, validate, then write out/<folder> and publish its mounts
//   node scripts/pins.ts install --ring 1   Ring 1 alone: its three products, its server slices and a catalogue of just those
//   node scripts/pins.ts slice              cut Ring 1's server slices from the pinned heads into test/pins/slices.json
//   node scripts/pins.ts keep <dir>         copy every pinned and sliced tarball to <dir>, for the release that outlives J85
//   node scripts/pins.ts status             what the tree holds against the pins
//
// `install` is what a build runs first. For each pin, in order:
//   1. The tarball comes from the cache, the mirror or the API, and its sha256 has to be the pin.
//   2. This tree's format validator admits it: files, hashes, schemas, budgets (`validateShardfileProduct`).
//   3. Its product goes to `out/<folder>`, with any pack a tarball left out rebuilt from its members, so a page and the
//      grid bake read what they would from a build. Its receipt is issued under this tree's validator revision, by this file, only
//      after step 2 passed, as `productVerdict` earns one for a head a build never made. The cost numbers stay the
//      tarball's: a receipt is static build evidence, never authority (G491).
//   4. Its mounts, under `mounts/` or as `cook.json` rows over a blob, are published at their URLs under `public/`, because
//      the cook and the page read `/assets/<shard>/...`.
//      They are excluded in `.git/info/exclude`, so a pinned tree stays clean.
//
// Build with WILDSHARD_CATALOGUE=test/pins/catalogue.json: the tarball hashes a page sees are then the pins'.
//
// J85 keeps only live, previous and preview, so an old commit's head eventually 404s on the API. Every tarball therefore has a
// second home: WILDSHARD_PIN_MIRROR, by default this repo's `pins` release, whose assets are named by hash and never replaced.
// The cache is tried first, then the mirror, then the API. A slice isn't a shardfile and the API never held one, so only the
// mirror serves it. Coverage rows 4 and 5.
// oxlint-disable-next-line import/no-unassigned-import -- Its hooks are the point, and they must run first.
import './bake-loader.mjs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { shardfileValidationRevision } from './shardfile-validation-revision.mjs';
import type { PackedIndex } from './pin-packs.ts';

interface Pin { readonly slug: string; readonly revision: number; readonly hash: string; readonly bytes: number }
interface PinFile { readonly api: string; readonly shards: readonly Pin[] }
interface Slice { readonly slug: string; readonly from: string; readonly hash: string; readonly bytes: number; readonly files: number }
interface Ring { readonly products: readonly string[]; readonly slices: readonly string[] }
interface Ledger { readonly revision: string; readonly published: readonly string[] }
interface CatalogueRow { readonly slug: string; readonly live?: { readonly revision: number; readonly hash: string } }
interface ListedRow { readonly hash: string; readonly bytes: number }

const API = process.env.WILDSHARD_API ?? 'https://api.wildshard.io';
const CACHE = process.env.WILDSHARD_PIN_CACHE ?? resolve(homedir(), '.cache/wildshard/pins');
const MIRROR = process.env.WILDSHARD_PIN_MIRROR ?? 'https://github.com/project-wildshard/engine/releases/download/pins';
const PINS = 'test/pins/shardfiles.json', CATALOGUE = 'test/pins/catalogue.json', LEDGER = 'out/.pins.json';
const RINGS = 'test/pins/rings.json', SLICES = 'test/pins/slices.json', SLICED = 'out/.slices', RING_CATALOGUE = 'out/.ring-catalogue.json';
const MARK = ['# pins: mounts published under public/, begin', '# pins: mounts published under public/, end'] as const;
const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;
const readJson = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8'));

/** Large real release saves use the same immutable public mirror as shard pins. */
async function installSaves(only: readonly string[] = []): Promise<void> {
  const directory = 'test/pins/saves';
  if (!existsSync(directory)) return;
  for (const name of readdirSync(directory).filter(entry => entry.endsWith('.json'))) {
    const row = readJson(join(directory, name)) as {slug: string; file: string; remote?: boolean; sha256: string; bytes: number};
    if (row.remote !== true || (only.length > 0 && !only.includes(row.slug))) continue;
    if (!/^[a-f0-9]{64}$/u.test(row.sha256) || row.file !== `${row.sha256}.save.br`
      || !Number.isSafeInteger(row.bytes) || row.bytes <= 0 || row.bytes > 32 * 1024 * 1024) throw new Error(`${row.slug}: invalid save pin`);
    const file = join(CACHE, row.file);
    if (existsSync(file)) {
      const held = readFileSync(file);
      if (held.length === row.bytes && sha256(held) === row.sha256) continue;
    }
    // GitHub's browser URL can return a gateway error for large save assets
    // while its explicit download endpoint serves the exact immutable bytes.
    // Both routes retain the same hash; corrupt bytes refuse immediately.
    let body: Uint8Array | undefined;
    for (const url of [`${MIRROR}/${row.file}?download=1`, `${MIRROR}/${row.file}`]) {
      body = await fetched(url, row.slug, row.sha256, {cache: 'no-store', signal: AbortSignal.timeout(90_000)});
      if (body !== undefined) break;
    }
    if (body === undefined || body.length !== row.bytes) throw new Error(`${row.slug}: mirror has no matching released save`);
    mkdirSync(CACHE, {recursive: true});
    const part = `${file}.${process.pid}`;
    writeFileSync(part, body); renameSync(part, file);
    console.log(`${row.slug}: installed released save, ${body.length} bytes`);
  }
}

async function getJson(path: string): Promise<unknown> {
  const response = await fetch(`${API}${path}`);
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return response.json();
}

/** Re-pin to the catalogue's live heads. */
async function refresh(): Promise<void> {
  const [catalogue, listed, document] = await Promise.all([getJson('/api/catalogue'), getJson('/api/shardfiles'), getJson('/api/catalogue.json?stage=live')]);
  const { shards } = catalogue as { shards: readonly CatalogueRow[] }, rows = Array.isArray(listed) ? listed as readonly ListedRow[] : (listed as { shardfiles: readonly ListedRow[] }).shardfiles;
  const sizes = new Map(rows.map(row => [row.hash, row.bytes]));
  const pins = shards.flatMap(({ slug, live }): Pin[] => (live === undefined ? [] : [{ slug, revision: live.revision, hash: live.hash, bytes: sizes.get(live.hash) ?? 0 }]));
  mkdirSync(dirname(PINS), { recursive: true });
  writeFileSync(PINS, json({ api: API, shards: pins }));
  writeFileSync(CATALOGUE, json(document));
  console.log(`pinned ${pins.length} shardfiles, ${(pins.reduce((sum, row) => sum + row.bytes, 0) / 1e9).toFixed(2)} GB`);
}

/** One source's bytes for a hash, or undefined if it doesn't hold them. Bytes that aren't the pin stop the build. */
async function fetched(url: string, slug: string, hash: string, options?: RequestInit): Promise<Uint8Array | undefined> {
  const response = await fetch(url, options).catch(() => undefined);
  if (response?.ok !== true) return undefined;
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (sha256(bytes) !== hash) throw new Error(`${slug}: ${url} is not the pin`);
  return bytes;
}

/** The tarball's bytes, proved against the pin. fetch follows the 302 to R2 and decodes the stored Brotli. */
async function tarball({ slug, hash }: Pick<Pin, 'slug' | 'hash'>, apiHolds = true): Promise<Uint8Array> {
  const file = join(CACHE, `${hash}.tar`);
  if (existsSync(file)) {
    const bytes = readFileSync(file);
    if (sha256(bytes) === hash) return bytes;
    rmSync(file);
  }
  const bytes = await fetched(`${MIRROR}/${hash}.tar`, slug, hash) ?? (apiHolds ? await fetched(`${API}/api/shardfiles/${hash}`, slug, hash) : undefined);
  if (bytes === undefined) throw new Error(`${slug}: neither the mirror nor the API holds ${hash}`);
  mkdirSync(CACHE, { recursive: true });
  const part = `${file}.${process.pid}`;
  writeFileSync(part, bytes);
  renameSync(part, file);
  return bytes;
}

/** Each pin with its tarball, in pin order, with at most `limit` fetches ahead of the reader. */
async function* inOrder(pins: readonly Pin[], limit: number): AsyncGenerator<readonly [Pin, Uint8Array]> {
  const started = new Map(pins.slice(0, limit).map((pin, at) => [at, tarball(pin)]));
  for (const [at, pin] of pins.entries()) {
    const bytes = await started.get(at);
    if (bytes === undefined) throw new Error(`${pin.slug}: no fetch started`);
    started.delete(at);
    const next = pins[at + limit];
    if (next !== undefined) started.set(at + limit, tarball(next));
    yield [pin, bytes];
  }
}

const decoder = new TextDecoder();
const DISCOVERY = /^mounts\/shardfiles\/([^/]+)\/discovery\.json$/u;
/** The folder a product is served from: its discovery document's, which isn't always its slug. No page can title a head without one. */
function folderOf(files: ReadonlyMap<string, Uint8Array>): string | undefined {
  return DISCOVERY.exec([...files.keys()].find(path => DISCOVERY.test(path)) ?? '')?.[1];
}

interface CookMount { readonly url: string; readonly path: string }
const PUBLISHED = /^\/(?:assets|programs)\//u;
function cookMounts(files: ReadonlyMap<string, Uint8Array>): readonly CookMount[] {
  const body = files.get('cook.json');
  return body === undefined ? [] : (JSON.parse(decoder.decode(body)) as { readonly mounts?: readonly CookMount[] }).mounts ?? [];
}

function tracked(): ReadonlySet<string> {
  try {
    return new Set(execFileSync('git', ['ls-files', '-z', 'public'], { encoding: 'utf8', maxBuffer: 1 << 28 }).split('\0'));
  } catch {
    return new Set();
  }
}

function exclude(paths: readonly string[]): void {
  const file = '.git/info/exclude';
  if (!existsSync('.git')) return;
  const text = existsSync(file) ? readFileSync(file, 'utf8') : '';
  const start = text.indexOf(MARK[0]), end = text.indexOf(MARK[1]);
  const kept = start === -1 ? text : `${text.slice(0, start)}${text.slice(end + MARK[1].length + 1)}`;
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${kept}${MARK[0]}\n${paths.map(path => `/${path}`).join('\n')}\n${MARK[1]}\n`);
}

async function install(only: readonly string[]): Promise<void> {
  const { prepareAssetDecoders } = await import('@wildshard/format/product');
  const { validateShardfileProduct } = await import('@wildshard/format/productValidation');
  const { readTar } = await import('@wildshard/format/tar');
  const { restorePacks } = await import('./pin-packs.ts');
  await prepareAssetDecoders();
  const { shards } = readJson(PINS) as PinFile;
  const pins = only.length === 0 ? shards : shards.filter(row => only.includes(row.slug));
  const unknown = only.filter(slug => !shards.some(row => row.slug === slug));
  if (unknown.length > 0) throw new Error(`Not pinned: ${unknown.join(', ')}`);
  const revision = shardfileValidationRevision(process.cwd());
  for (const path of existsSync(LEDGER) ? (readJson(LEDGER) as Ledger).published : []) rmSync(path, { force: true });
  const shared = tracked(), published = new Map<string, string>();
  let failed = 0;
  for await (const [pin, bytes] of inOrder(pins, 6)) {
    const started = performance.now(), files = readTar(bytes);
    const fileNamed = (path: string): Uint8Array => { const body = files.get(path); if (body === undefined) throw new Error(`${pin.slug}: no ${path}`); return body; };
    try {
      validateShardfileProduct(
        { read: (path, maximum) => { const body = fileNamed(path); if (body.length > maximum) throw new Error(`${path} is over its cap`); return body; }, paths: () => files.keys() },
        { hash: sha256 },
      );
    } catch (error) {
      failed++;
      console.error(`refused ${pin.slug}: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    const receipt = JSON.parse(decoder.decode(fileNamed('validation.json'))) as { readonly indexHash: string };
    if (receipt.indexHash !== sha256(fileNamed('shard.json'))) throw new Error(`${pin.slug}: its receipt names another index`);
    const folder = folderOf(files);
    if (folder === undefined) { failed++; console.error(`refused ${pin.slug}: no discovery document`); continue; }
    const target = resolve('out', folder);
    rmSync(target, { recursive: true, force: true });
    let mounts = 0;
    const publish = (url: string, body: Uint8Array): void => {
      const hash = sha256(body), held = published.get(url);
      if (held !== undefined && held !== hash) throw new Error(`Two pins publish different ${url}`);
      if (shared.has(url)) {
        if (sha256(readFileSync(url)) !== hash) throw new Error(`${pin.slug}: ${url} differs from engine's tracked file`);
        return;
      }
      if (held !== undefined) return;
      published.set(url, hash);
      mkdirSync(dirname(url), { recursive: true });
      writeFileSync(url, body);
      mounts++;
    };
    for (const [path, body] of files) {
      if (path.endsWith('/') || path === 'validation.json') continue;
      const out = join(target, path);
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(out, body);
      const mounted = /^mounts\/((?:assets|programs)\/.+)$/u.exec(path)?.[1];
      if (mounted !== undefined) publish(`public/${mounted}`, body);
    }
    // A thin head keeps one copy of a file: most of its mounts are `cook.json` rows, a URL over a blob, and no path under mounts/.
    for (const row of cookMounts(files)) if (PUBLISHED.test(row.url)) publish(`public${row.url}`, fileNamed(row.path));
    // Thin heads (C0) list packs they don't carry, and step 2 proved each one from its members.
    const index = JSON.parse(decoder.decode(fileNamed('shard.json'))) as PackedIndex;
    for (const [path, body] of restorePacks(index, files)) {
      mkdirSync(dirname(join(target, path)), { recursive: true });
      writeFileSync(join(target, path), body);
    }
    writeFileSync(join(target, 'validation.json'), `${JSON.stringify({ ...receipt, revision, pin: { hash: pin.hash, revision: pin.revision } })}\n`);
    console.log(`${pin.slug}: admitted in ${((performance.now() - started) / 1000).toFixed(1)}s, ${files.size} files, ${mounts} mounts published`);
  }
  if (failed > 0) process.exitCode = 1;
  mkdirSync('out', { recursive: true });
  const paths = [...published.keys()].sort((a, b) => a.localeCompare(b));
  writeFileSync(LEDGER, json({ revision, published: paths } satisfies Ledger));
  exclude(paths);
  await installSaves(pins.map(row => row.slug));
  console.log(`${pins.length - failed} of ${pins.length} pins admitted, ${paths.length} mounts published`);
}

const ringOf = (name: string): Ring => {
  const ring = (readJson(RINGS) as Record<string, Ring>)[name];
  if (ring === undefined) throw new Error(`No ring ${name}`);
  return ring;
};

/** What a server reads of a head, as a tarball of its own: a slice proves a host on real data with none of the art. It holds no
 *  receipt and isn't a product a page can open, so no build reads it. */
async function slice(check = false): Promise<void> {
  const { serverRows, openShardfile } = await import('../src/cook/game/shardCook.ts');
  const { writeTar } = await import('@wildshard/format/tar');
  const { shards } = readJson(PINS) as PinFile, rows: Slice[] = [];
  const existing = existsSync(SLICES) ? (readJson(SLICES) as {slices: readonly Slice[]}).slices : [];
  for (const slug of ringOf('1').slices) {
    const pin = shards.find(row => row.slug === slug);
    if (pin === undefined) throw new Error(`Not pinned: ${slug}`);
    const shard = openShardfile(await tarball(pin)), files = new Map<string, Uint8Array>();
    for (const row of serverRows(shard)) files.set(row.path, shard.read(row.path));
    const bytes = writeTar(files), hash = sha256(bytes);
    if (check) {
      const prior = existing.find(row => row.slug === slug);
      if (prior?.from !== pin.hash || prior.hash !== hash) throw new Error(`${slug}: slice differs from a fresh cook; re-cut with node scripts/pins.ts slice`);
    } else {
      mkdirSync(CACHE, { recursive: true });
      writeFileSync(join(CACHE, `${hash}.tar`), bytes);
    }
    rows.push({ slug, from: pin.hash, hash, bytes: bytes.length, files: files.size });
    console.log(`${slug}: ${(pin.bytes / 1e6).toFixed(1)} MB head, ${(bytes.length / 1e6).toFixed(1)} MB slice, ${files.size} files`);
  }
  if (!check) writeFileSync(SLICES, json({ slices: rows }));
  console.log(`${rows.length} slices, ${(rows.reduce((sum, row) => sum + row.bytes, 0) / 1e6).toFixed(1)} MB`);
}

/** A catalogue a build can bake with only `slugs` on disk. Dunes takes the home cell, because a grid opens on a shard it can admit; every other
 *  cell becomes a road, as the live grid's template cell is, so the grid keeps its shape (G972) and the crossing stays real. */
function ringCatalogue(slugs: readonly string[]): void {
  interface Cell { slug: string; instance: string; cell: readonly [number, number] }
  const catalogue = readJson(CATALOGUE) as { shards: readonly { slug: string }[]; placements: readonly { slug: string }[]; grid: { cells: readonly Cell[] } };
  const kept = new Set(slugs.flatMap(slug => [slug, `_${slug}`]));
  const home = catalogue.grid.cells.find(row => row.cell[0] === 0 && row.cell[1] === 0)?.instance ?? 'home';
  const cells = catalogue.grid.cells.map(row => {
    if (row.instance === home) return { instance: 'sunscar-dunes', slug: 'sunscar-dunes', cell: row.cell };
    if (row.slug === 'sunscar-dunes') return { instance: home, slug: '_template', cell: row.cell, speedClass: 'road' };
    return kept.has(row.slug) ? row : { instance: row.instance, slug: '_template', cell: row.cell, speedClass: 'road' };
  });
  writeFileSync(RING_CATALOGUE, json({ ...catalogue, shards: catalogue.shards.filter(row => kept.has(row.slug)), placements: catalogue.placements.filter(row => kept.has(row.slug)), grid: { ...catalogue.grid, cells } }));
}

async function installRing(name: string): Promise<void> {
  const { readTar } = await import('@wildshard/format/tar');
  const { checkSlice } = await import('./slice-inputs.ts');
  const ring = ringOf(name), started = performance.now();
  await install(ring.products);
  // A tree that held every head keeps none of the others: their mounts just left public/.
  const wanted = new Set((readJson(PINS) as PinFile).shards.filter(row => ring.products.includes(row.slug)).map(row => row.hash));
  for (const folder of readdirSync('out')) {
    const receipt = join('out', folder, 'validation.json');
    if (existsSync(receipt) && !wanted.has((readJson(receipt) as { pin?: Pin }).pin?.hash ?? '')) rmSync(join('out', folder), { recursive: true });
  }
  rmSync(SLICED, { recursive: true, force: true });
  const { slices } = readJson(SLICES) as { slices: readonly Slice[] };
  let bytes = 0;
  for (const row of slices.filter(({ slug }) => ring.slices.includes(slug))) {
    if (row.from !== (readJson(PINS) as PinFile).shards.find(pin => pin.slug === row.slug)?.hash) throw new Error(`${row.slug}: slice belongs to another head; re-cut with node scripts/pins.ts slice`);
    const body = await tarball(row, false), target = join(SLICED, row.slug);
    checkSlice(body, row.slug);
    bytes += body.length;
    for (const [path, file] of readTar(body)) {
      if (path.endsWith('/')) continue;
      mkdirSync(dirname(join(target, path)), { recursive: true });
      writeFileSync(join(target, path), file);
    }
  }
  ringCatalogue(ring.products);
  await installSaves(ring.slices);
  const { shards } = readJson(PINS) as PinFile, products = shards.filter(row => ring.products.includes(row.slug)).reduce((sum, row) => sum + row.bytes, 0);
  console.log(`ring ${name}: ${((products + bytes) / 1e6).toFixed(1)} MB, products ${(products / 1e6).toFixed(1)}, slices ${(bytes / 1e6).toFixed(1)}, in ${((performance.now() - started) / 1000).toFixed(1)}s`);
}

/** Every tarball a commit of this repo can name, for `gh release upload pins <dir>/*`: the release keeps what J85 drops. */
async function keep(dir: string): Promise<void> {
  const { shards } = readJson(PINS) as PinFile, slices = existsSync(SLICES) ? (readJson(SLICES) as { slices: readonly Slice[] }).slices : [];
  mkdirSync(dir, { recursive: true });
  for (const row of shards) writeFileSync(join(dir, `${row.hash}.tar`), await tarball(row));
  for (const row of slices) writeFileSync(join(dir, `${row.hash}.tar`), await tarball(row, false));
  console.log(`${shards.length + slices.length} tarballs in ${dir}`);
}

function status(): void {
  const { shards } = readJson(PINS) as PinFile;
  const ledger = existsSync(LEDGER) ? readJson(LEDGER) as Ledger : undefined;
  const here = existsSync('out') ? readdirSync('out').filter(name => existsSync(`out/${name}/validation.json`)).map(name => (readJson(`out/${name}/validation.json`) as { pin?: Pin }).pin?.hash) : [];
  const missing = shards.filter(row => !here.includes(row.hash));
  console.log(JSON.stringify({ pins: shards.length, installed: shards.length - missing.length, missing: missing.map(row => row.slug), stale: ledger !== undefined && ledger.revision !== shardfileValidationRevision(process.cwd()) }));
  if (missing.length > 0) process.exitCode = 1;
}

const [command = 'status', ...rest] = process.argv.slice(2);
if (command === 'refresh') await refresh();
else if (command === 'install' && rest[0] === '--ring') await installRing(rest[1] ?? '1');
else if (command === 'install') await install(rest);
else if (command === 'slice') await slice();
else if (command === 'verify-slices') await slice(true);
else if (command === 'install-saves') await installSaves(rest);
else if (command === 'keep') await keep(rest[0] ?? 'tmp/pins-release');
else if (command === 'status') status();
else throw new Error('usage: pins.ts refresh | install [slug...] | install --ring 1 | install-saves [slug...] | slice | verify-slices | keep <dir> | status');
