#!/usr/bin/env node
// J65: engine's products are pinned real shardfiles, not a shard build. `test/pins/shardfiles.json` names each one by the
// hash `api.wildshard.io` serves, and `test/pins/catalogue.json` is the catalogue document those heads came from.
//
//   node scripts/pins.ts refresh            re-pin to the live heads (read only: GETs); refuses while a pin, the default
//                                           release pair or a set E7_*_SHARDS names a slug GET /api/catalogue no longer
//                                           lists (DEL9); `--drop <slug>` lets refresh drop a deleted pin
//   node scripts/pins.ts install [slug...]  fetch, check, validate, then write out/<folder> and publish its mounts
//   node scripts/pins.ts install --for-tests  also install frozen retired grid products for test suites
//   node scripts/pins.ts install --staging  install the reviewed staging snapshot for a public dev build
//   node scripts/pins.ts install --ring 1   Ring 1: pinned Brasscap Mesa and Dunes (J434), and server slices
//   node scripts/pins.ts install --ring-slices 1  add Ring 1 server slices beside installed full pins
//   node scripts/pins.ts install --from-format <slug>  a frozen dependency product (brasscap-mesa),
//                                                      without network or cook
//   node scripts/pins.ts slice              cut Ring 1's server slices from the pinned heads into test/pins/slices.json
//   node scripts/pins.ts keep <dir>         copy every pinned and sliced tarball to <dir>, for the release that outlives J85
//   node scripts/pins.ts status             what the tree holds against the pins
//
// `install` is what a build runs first. For each pin, in order:
//   1. The tarball comes from the cache, the mirror or the API, and its sha256 has to be the pin.
//   2. This tree's format validator admits it: files, hashes, schemas, budgets (`validateShardfileFolder`).
//   3. Its product goes to `out/<folder>`, with any pack a tarball left out rebuilt from its members, so a page and the
//      grid bake read what they would from a build. Its receipt is issued under this tree's validator revision, by this file, only
//      after step 2 passed, as `folderVerdict` earns one for a head a build never made. The cost numbers stay the
//      tarball's: a receipt is static build evidence, never authority (G491).
//   4. Its mounts, under `mounts/` or as `cook.json` rows over a blob, are published at their URLs under `public/`, because
//      the cook and the page read `/assets/<shard>/...`.
//      They are excluded in Git's `info/exclude`, so a pinned tree stays clean.
//
// Build with WILDSHARD_CATALOGUE=test/pins/catalogue.json: the tarball hashes a page sees are then the pins'.
//
// J85 keeps only live, previous and preview, so an old commit's head eventually 404s on the API. Every tarball therefore has a
// second home: WILDSHARD_PIN_MIRROR, by default this repo's `pins` release, whose assets are named by hash and never replaced.
// The cache is tried first, then the mirror, then the API. A missing slice is rebuilt from its pinned parent, and must
// match its committed hash, byte count and file count exactly. Coverage rows 4 and 5.
// oxlint-disable-next-line import/no-unassigned-import -- Its hooks are the point, and they must run first.
import { setTimeout as sleep } from 'node:timers/promises';
import './bake-loader.mjs';
import { agentFetch as fetch } from './agent-requests.mjs';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { shardfileValidationRevision } from './shardfile-validation-revision.mjs';
import { rendererRevision } from './renderer-revision.mjs';
import { excludePublished } from './pins-exclude.mjs';
import { dropManifest, folderName, insideTree, lockPins, mountPath, pinDescriptor, pinsCompatibilityKey, pinsKey, pruneStalePinProducts, reusePins, reuseUnchangedPins, writeManifest, type PinOwner } from './pins-reuse.mjs';
import type { PackedIndex } from './pin-packs.ts';
import { fetchPinnedPublicAssets, pinnedPublicAssets } from './pin-assets.ts';
import { assertKtx2TableTargets } from '../src/shared/game/shardfile/ktx2Targets.ts';
import { trackedPublic } from './tracked-public.mjs';
import { catalogueSlugs, documentSlugs, pinnedSlugs, releaseNamed, unlistedMessage, unlistedSlugs } from './pins-catalogue.ts';
import { servedSlug } from './server-release/served-slug.mjs';
import { assertTestsDropped } from './pin-test-names.ts';
import {clearLocalCandidates, recordLocalCandidate} from './local-candidates.ts';
import type {localProduct} from './pin-local.ts';

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
const ASSET_API = process.env.WILDSHARD_PIN_ASSET_API ?? 'https://api.github.com/repos/project-wildshard/engine/releases/assets';
const PINS = 'test/pins/shardfiles.json', CATALOGUE = 'test/pins/catalogue.json', LEDGER = 'out/.pins.json';
const RINGS = 'test/pins/rings.json', SLICES = 'test/pins/slices.json', SLICED = 'out/.slices', RING_CATALOGUE = 'out/.ring-catalogue.json';
const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;
const readJson = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8'));

/** Large real release saves use the same immutable public mirror as shard pins. */
async function installSaves(only: readonly string[] = []): Promise<void> {
  const directory = 'test/pins/saves';
  if (!existsSync(directory)) return;
  for (const name of readdirSync(directory).filter(entry => entry.endsWith('.json'))) {
    const row = readJson(join(directory, name)) as {slug: string; file: string; remote?: boolean; sha256: string; bytes: number; assetId?: number};
    if (row.remote !== true || (only.length > 0 && !only.includes(row.slug))) continue;
    if (!/^[a-f0-9]{64}$/u.test(row.sha256) || row.file !== `${row.sha256}.save.br`
      || !Number.isSafeInteger(row.bytes) || row.bytes <= 0 || row.bytes > 32 * 1024 * 1024
      || (row.assetId !== undefined && (!Number.isSafeInteger(row.assetId) || row.assetId <= 0))) throw new Error(`${row.slug}: invalid save pin`);
    const file = join(CACHE, row.file);
    if (existsSync(file)) {
      const held = readFileSync(file);
      if (held.length === row.bytes && sha256(held) === row.sha256) continue;
    }
    // GitHub's browser URL can return a gateway error for large save assets
    // while its explicit download endpoint serves the exact immutable bytes.
    // Both routes retain the same hash; corrupt bytes refuse immediately.
    // An asset ID identifies the existing release upload; the API's binary
    // media type avoids the browser-download gateway. Hashes remain authority.
    let body = row.assetId === undefined ? undefined : await fetched(`${ASSET_API}/${row.assetId}`, row.slug, row.sha256,
      {headers: {Accept: 'application/octet-stream'}, cache: 'no-store', signal: AbortSignal.timeout(90_000)});
    for (const url of [`${MIRROR}/${row.file}?download=1`, `${MIRROR}/${row.file}`]) {
      if (body !== undefined) break;
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

/** Re-pin to the catalogue's live heads. A slug the catalogue no longer lists (DEL9: deleted) is refused, never silently
 *  dropped: whatever names it (a ring, a release variable, a proof list) has to drop it first, then `--drop <slug>`. */
async function refresh(drop: readonly string[]): Promise<void> {
  const [catalogue, listed, document] = await Promise.all([getJson('/api/catalogue'), getJson('/api/shardfiles'), getJson('/api/catalogue.json?stage=live')]);
  const pinned = existsSync(PINS) ? pinnedSlugs(readJson(PINS)) : [], liveSlugs = catalogueSlugs(catalogue);
  const wrongDrop = drop.filter(slug => !pinned.includes(slug) || liveSlugs.has(servedSlug(slug)));
  if (wrongDrop.length > 0) throw new Error(`pins refresh refused: --drop ${wrongDrop.join(',')} names no pin, or one GET /api/catalogue still lists`);
  assertTestsDropped(drop);
  const held = pinned.filter(slug => !drop.includes(slug));
  const unlisted = unlistedSlugs(liveSlugs, { [PINS]: held, 'GET /api/catalogue.json?stage=live': documentSlugs(document), ...releaseNamed(process.env) });
  if (unlisted.length > 0) throw new Error(`pins refresh refused, nothing written:\n${unlistedMessage(unlisted)}\n`
    + `A deleted pin: drop it from what names it, then run pins.ts refresh --drop <slug>.`);
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
  // A connection can close after headers, before the immutable body is complete.
  const body = await response.arrayBuffer().catch(() => {
    console.warn(`${slug}: could not finish reading a pin source`);
    return undefined;
  });
  if (body === undefined) return undefined;
  const bytes = new Uint8Array(body);
  if (sha256(bytes) !== hash) throw new Error(`${slug}: ${url} is not the pin`);
  return bytes;
}

/** `fetched`, tried three times with backoff (1 s, then 3 s): one API blip must not leave a pin with no source (main red
 *  45404606407, two open-plot pins with no mirror copy). */
async function fetchedRetrying(url: string, slug: string, hash: string): Promise<Uint8Array | undefined> {
  for (const wait of [1000, 3000, 0]) {
    const bytes = await fetched(url, slug, hash);
    if (bytes !== undefined || wait === 0) return bytes;
    console.warn(`${slug}: ${url} held no bytes; trying again in ${wait / 1000} s`);
    await sleep(wait);
  }
  return undefined;
}

/** The tarball's bytes, proved against the pin. fetch follows the 302 to R2 and decodes the stored Brotli. */
async function tarball({ slug, hash }: Pick<Pin, 'slug' | 'hash'>, apiHolds = true): Promise<Uint8Array> {
  const file = join(CACHE, `${hash}.tar`);
  if (existsSync(file)) {
    const bytes = readFileSync(file);
    if (sha256(bytes) === hash) return bytes;
    rmSync(file);
  }
  let bytes = await fetched(`${MIRROR}/${hash}.tar`, slug, hash) ?? (apiHolds ? await fetchedRetrying(`${API}/api/shardfiles/${hash}`, slug, hash) : undefined);
  if (bytes === undefined && !apiHolds) {
    const row = (readJson(SLICES) as {slices: readonly Slice[]}).slices.find(candidate => candidate.slug === slug && candidate.hash === hash);
    const parent = (readJson(PINS) as PinFile).shards.find(pin => pin.slug === slug);
    if (row === undefined || parent === undefined || row.from !== parent.hash) throw new Error(`${slug}: slice belongs to another head; re-cut with node scripts/pins.ts slice`);
    const rebuilt = await cutSlice(parent);
    if (sha256(rebuilt.bytes) !== hash || rebuilt.bytes.length !== row.bytes || rebuilt.files !== row.files) throw new Error(`${slug}: reconstructed slice differs from the pin; re-cut with node scripts/pins.ts slice`);
    bytes = rebuilt.bytes;
    console.log(`${slug}: reconstructed pinned server slice from its verified head`);
  }
  if (bytes === undefined) throw new Error(`${slug}: neither the mirror nor the API holds ${hash}`);
  mkdirSync(CACHE, { recursive: true });
  const part = `${file}.${process.pid}`;
  writeFileSync(part, bytes);
  renameSync(part, file);
  return bytes;
}

/** The same deterministic server inventory backs a fresh cut and a missing mirror artifact. */
async function cutSlice(pin: Pin): Promise<{bytes: Uint8Array; files: number}> {
  const {serverRows, openShardfile} = await import('../src/cook/game/shardCook.ts');
  const {writeTar} = await import('@wildshard/format/tar');
  const shard = openShardfile(await tarball(pin)), files = new Map<string, Uint8Array>();
  for (const row of serverRows(shard)) files.set(row.path, shard.read(row.path));
  return {bytes: writeTar(files), files: files.size};
}

/** Each pin with its tarball, in pin order, with at most `limit` fetches ahead of the reader. */
async function* inOrder(pins: readonly Pin[], limit: number, local?: ReadonlyMap<string, Uint8Array>): AsyncGenerator<readonly [Pin, Uint8Array]> {
  const bytesOf = (pin: Pin): Promise<Uint8Array> => Promise.resolve(local?.get(pin.hash) ?? tarball(pin));
  const started = new Map(pins.slice(0, limit).map((pin, at) => [at, bytesOf(pin)]));
  for (const [at, pin] of pins.entries()) {
    const bytes = await started.get(at);
    if (bytes === undefined) throw new Error(`${pin.slug}: no fetch started`);
    started.delete(at);
    const next = pins[at + limit];
    if (next !== undefined) started.set(at + limit, bytesOf(next));
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

/** J262: `current` when the author preparation names this engine's renderer fingerprint, `stale` for another (or when this
 *  tree can't compute its own), `none` without one. The same verdict `openShardfile` reaches; validation already
 *  refused a preparation that doesn't match its own inputs. SP1b4: a stale one with a sidecar in `WILDSHARD_COOK_SIDECARS`
 *  for this pin on this renderer opens as the cook would: `cook` on a hit, `stale` (and the line why) otherwise. */
let ownRenderer: string | null | undefined;
async function preparationOf(files: ReadonlyMap<string, Uint8Array>, root: string, pin: Pin, bytes: Uint8Array): Promise<'current' | 'stale' | 'cook' | 'none'> {
  const body = files.get('cook.json');
  if (body === undefined) return 'none';
  const cook = JSON.parse(decoder.decode(body)) as { readonly version?: number; readonly renderer?: string };
  if (cook.version !== 3) return 'none';
  if (ownRenderer === undefined) { try { ownRenderer = rendererRevision(root); } catch { ownRenderer = null; } }
  if (cook.renderer === ownRenderer) return 'current';
  const {sidecarIn} = await import('../src/cook/game/cookSidecar.ts');
  const sidecar = sidecarIn(process.env.WILDSHARD_COOK_SIDECARS, pin.hash, ownRenderer);
  if (sidecar === undefined || ownRenderer === null) return 'stale';
  const {openShardfile} = await import('../src/cook/game/shardCook.ts');
  const shard = openShardfile(bytes, { renderer: ownRenderer, sidecar, warn: line => { console.warn(line); } });
  return shard.preparation === 'cook' ? 'cook' : 'stale';
}


/** The public paths an installed product published: its files under mounts/assets|programs and its cook.json rows. */
function mountsOf(folder: string): Set<string> {
  const paths = new Set<string>(), mounts = join(folder, 'mounts');
  if (!existsSync(folder)) return paths;
  for (const top of ['assets', 'programs']) {
    const base = join(mounts, top);
    if (!existsSync(base)) continue;
    for (const entry of readdirSync(base, { recursive: true, withFileTypes: true })) {
      if (entry.isFile()) paths.add(`public/${top}/${join(entry.parentPath, entry.name).slice(base.length + 1)}`);
    }
  }
  const cook = join(folder, 'cook.json');
  if (existsSync(cook)) for (const row of cookMounts(new Map([['cook.json', readFileSync(cook)]]))) if (PUBLISHED.test(row.url)) paths.add(`public${row.url}`);
  return paths;
}

/** A full install leaves no out/ product the pins don't name, so land's gen:inputs has nothing stale to refuse (pins-reuse.mjs). */
function pruneStale(root: string): void {
  for (const row of pruneStalePinProducts(root)) console.log(`pins: removed out/${row.folder} (revision ${String(row.revision)}), a product no pin names`);
}

/** One install of this tree at a time, full or reused: out/.pins.lock (pins-reuse.mjs). */
type LocalProduct = Awaited<ReturnType<typeof localProduct>>;
async function install(only: readonly string[], source: 'pins' | 'format' | 'ring' | 'local' | 'staging' | 'tests' = 'pins', localPath?: string): Promise<readonly Pin[]> {
  const release = lockPins(process.cwd());
  try {
    const local = localPath === undefined ? undefined : await (await import('./pin-local.ts')).localProduct(localPath, process.cwd());
    return await installLocked(local === undefined ? only : [local.pin.slug], source, local);
  } finally { release?.(); }
}

async function installLocked(only: readonly string[], source: 'pins' | 'format' | 'ring' | 'local' | 'staging' | 'tests', local?: LocalProduct): Promise<readonly Pin[]> {
  // DS12: a full install whose pins match this tree's last one, or another worktree's, clones and verifies (pins-reuse.mjs).
  const full = only.length === 0 && source === 'pins', root = process.cwd();
  const revision = shardfileValidationRevision(root), inputs = full ? pinsCompatibilityKey(root, revision) : '';
  const key = full ? pinsKey(root, revision, inputs) : '';
  const canReuse = full && process.env.WILDSHARD_PINS_REUSE !== '0';
  const overlay = source === 'format' || source === 'local';
  const testFixtures = source === 'tests';
  const output = testFixtures ? 'out/.test-products' : 'out';
  const trackedPins = source === 'staging' ? (await import('./pins-staging.ts')).readStaging().shards
    : overlay ? [] : (readJson(testFixtures ? 'test/fixtures/retired-grid-products.json' : PINS) as Pick<PinFile, 'shards'>).shards;
  let retained: Awaited<ReturnType<typeof reuseUnchangedPins>>;
  if (canReuse) {
    const reused = await reusePins(root, key, { log: line => { console.log(line); } });
    if (reused !== undefined) {
      const paths = [...reused.published].sort((a, b) => a.localeCompare(b));
      writeFileSync(LEDGER, json({ revision, published: paths } satisfies Ledger));
      excludePublished(paths);
      await installSaves(trackedPins.map(row => row.slug));
      pruneStale(root);
      clearLocalCandidates(root);
      const from = reused.source === root ? 'this tree, unchanged' : `${reused.mode} of ${reused.source}`;
      console.log(`pins reused: ${from}; ${reused.files} files, ${(reused.bytes / 2 ** 20).toFixed(0)} MiB verified by sha256 (clone ${reused.seconds.clone.toFixed(1)}s, verify ${reused.seconds.verify.toFixed(1)}s), ${paths.length} mounts published`);
      return trackedPins;
    }
    retained = await reuseUnchangedPins(root, inputs, trackedPins);
  }
  if (!testFixtures) dropManifest(root);
  const folderHashes = new Map(Object.entries(retained?.products ?? {})), mountHashes = new Map(Object.entries(retained?.mounts ?? {}));
  const owners = new Map<string, PinOwner>(Object.entries(retained?.owners ?? {}));
  // The validator hashes most members already; the manifest reuses those digests rather than hashing twice.
  const digests = new WeakMap<Uint8Array, string>();
  const digest = (bytes: Uint8Array): string => { let held = digests.get(bytes); if (held === undefined) { held = sha256(bytes); digests.set(bytes, held); } return held; };
  const { prepareAssetDecoders } = await import('@wildshard/format/shardfileAssets');
  const { validateShardfileFolder } = await import('@wildshard/format/shardfileValidation');
  // SHARD-COMPAT CP10 (J486): a pin was judged at its upload; memory policy only reports here (spread: pre-CP10 formats type).
  const STORED = { judged: 'stored' } as const;
  const { readTar } = await import('@wildshard/format/tar');
  const { restorePacks } = await import('./pin-packs.ts');
  const { admitPin } = await import('./pin-admit.ts');
  if (source === 'format' && only.length !== 1) throw new Error('--from-format needs exactly one product: brasscap-mesa');
  const formatSlug = source === 'format' ? only[0] : undefined;
  const dependency = local ?? (formatSlug === undefined ? undefined : (await import('./pin-format.ts')).formatTemplate(formatSlug));
  const shards = dependency === undefined ? trackedPins : [...trackedPins.filter(row => row.slug !== dependency.pin.slug), dependency.pin];
  const pins = only.length === 0 ? shards : shards.filter(row => only.includes(row.slug));
  const toAdmit = pins.filter(({slug}) => !owners.has(slug));
  if (toAdmit.length > 0) await prepareAssetDecoders();
  const unknown = only.filter(slug => !shards.some(row => row.slug === slug));
  if (unknown.length > 0) throw new Error(`Not pinned: ${unknown.join(', ')}`);
  const remoteSlugs = pins.filter(row => row.slug !== dependency?.pin.slug).map(row => row.slug);
  if (remoteSlugs.length > 0) await fetchPinnedPublicAssets(process.cwd(), remoteSlugs);
  const publicAssets = remoteSlugs.length > 0 ? pinnedPublicAssets(process.cwd(), remoteSlugs) : [];
  // T2E-1: --from-format adds Template 2 beside whatever is installed, so `pnpm test:e2e` never strips a worktree's other
  // pins (their public assets feed the committed boot tables); only the Template 2 it replaces leaves. Every other
  // install replaces the whole set.
  const replaced = dependency === undefined || !overlay ? new Set<string>() : mountsOf(resolve('out', local?.folder ?? dependency.pin.slug));
  for (const path of local?.preservedMounts ?? []) replaced.delete(path);
  const before = !testFixtures && existsSync(LEDGER) ? (readJson(LEDGER) as Ledger).published : [];
  const shared = trackedPublic(), publicUrls = new Set(publicAssets.map(asset => asset.url));
  const published = new Set([...mountHashes.keys()].filter(path => !shared.has(path)));
  // Mark before writing: a failed local install must still prevent publication.
  if (local !== undefined) recordLocalCandidate(root, {slug: local.pin.slug, ...local.source});
  // Only plain public/ paths, under folders that are this tree's own: a ledger or a linked folder never reaches outside.
  for (const path of before) {
    if (overlay && !replaced.has(path)) continue;
    if (!mountPath(path) || shared.has(path) || published.has(path)) continue;
    insideTree(root, dirname(path));
    rmSync(path, { force: true });
  }
  const publish = (url: string, body: Uint8Array): void => {
    if (!mountPath(url)) throw new Error(`A pin publishes ${url}, outside public/`);
    const hash = digest(body), held = mountHashes.get(url);
    if (held !== undefined) {
      if (held !== hash) throw new Error(`Two pins publish different ${url}`);
      return;
    }
    insideTree(root, dirname(url), !shared.has(url));
    mountHashes.set(url, hash);
    if (shared.has(url)) {
      if (!lstatSync(url).isFile() || sha256(readFileSync(url)) !== hash) throw new Error(`${url} differs from engine's tracked file`);
      return;
    }
    // Never write through a link at a publication path, even if the old ledger did not name it.
    const existing = lstatSync(url, {throwIfNoEntry: false});
    if (existing !== undefined && !existing.isFile()) throw new Error(`${url} is not a regular file`);
    published.add(url);
    writeFileSync(url, body);
  };
  let failed = 0;
  let paths: string[];
  try {
    for await (const [pin, bytes] of inOrder(toAdmit, 6, dependency === undefined ? undefined : new Map([[dependency.pin.hash, dependency.bytes]]))) {
      const started = performance.now();
      let files: ReadonlyMap<string, Uint8Array> = readTar(bytes), applied: readonly string[] = [];
      const fileNamed = (path: string): Uint8Array => { const body = files.get(path); if (body === undefined) throw new Error(`${pin.slug}: no ${path}`); return body; };
      try {
        // FE9b: a pin this validator refuses installs as the chain's validated copy, as the cook admits it (pin-admit.ts).
        const admitted = admitPin(files, digest, rows => validateShardfileFolder(
          { read: (path, maximum) => { const body = rows.get(path); if (body === undefined) throw new Error(`${pin.slug}: no ${path}`); if (body.length > maximum) throw new Error(`${path} is over its cap`); return body; }, paths: () => rows.keys() },
          { hash: digest, ...STORED },
        ));
        ({ files, applied } = admitted);
        if (applied.length > 0) console.warn(`migrated ${pin.slug}: ${applied.join(', ')}`);
        // SS12: a grandfathered product (Pine's page.life, SERVER-PARITY SS11) is admitted with a warning; say it.
        for (const warning of admitted.warnings) console.warn(`warning ${pin.slug}: ${warning}`);
        // S11: every target of the KTX2 table is in the product, a tracked engine file or a pinned public asset.
        assertKtx2TableTargets({ paths: () => files.keys(), read: fileNamed }, url => shared.has(`public${url}`) || publicUrls.has(url));
      } catch (error) {
        failed++;
        console.error(`refused ${pin.slug}: ${error instanceof Error ? error.message : String(error)}`);
        continue;
      }
      // A migrated copy carries no build receipt: the chain drops it with the old source hash.
      const receipt = applied.length > 0 ? undefined : JSON.parse(decoder.decode(fileNamed('validation.json'))) as { readonly indexHash: string };
      if (receipt !== undefined && receipt.indexHash !== sha256(fileNamed('shard.json'))) throw new Error(`${pin.slug}: its receipt names another index`);
      const folder = folderOf(files);
      if (folder === undefined) { failed++; console.error(`refused ${pin.slug}: no discovery document`); continue; }
      if (!folderName(folder)) { failed++; console.error(`refused ${pin.slug}: product folder ${folder}`); continue; }
      if (folderHashes.has(folder)) throw new Error(`Two pins publish out/${folder}`);
      insideTree(root, output, true);
      const target = resolve(output, folder);
      rmSync(target, { recursive: true, force: true });
      const written = new Map<string, string>(), mounts = new Set<string>();
      const publishMount = (url: string, body: Uint8Array): void => { if (!testFixtures) { publish(url, body); mounts.add(url); } };
      const beforeMounts = published.size;
      for (const [path, body] of files) {
        if (path.endsWith('/') || path === 'validation.json') continue;
        const out = join(target, path);
        mkdirSync(dirname(out), { recursive: true });
        writeFileSync(out, body);
        written.set(path, digest(body));
        const mounted = /^mounts\/((?:assets|programs)\/.+)$/u.exec(path)?.[1];
        if (mounted !== undefined) publishMount(`public/${mounted}`, body);
      }
      // A thin head keeps one copy of a file: most of its mounts are `cook.json` rows, a URL over a blob, and no path under mounts/.
      for (const row of cookMounts(files)) if (PUBLISHED.test(row.url)) publishMount(`public${row.url}`, fileNamed(row.path));
      // Thin heads (C0) list packs they don't carry, and step 2 proved each one from its members.
      const index = JSON.parse(decoder.decode(fileNamed('shard.json'))) as PackedIndex;
      for (const [path, body] of restorePacks(index, files)) {
        mkdirSync(dirname(join(target, path)), { recursive: true });
        writeFileSync(join(target, path), body);
        written.set(path, digest(body));
      }
      const validation = `${JSON.stringify({ ...receipt, revision, pin: { hash: pin.hash, revision: pin.revision }, ...(pin.slug === dependency?.pin.slug ? {source: dependency.source} : {}) })}\n`;
      writeFileSync(join(target, 'validation.json'), validation);
      written.set('validation.json', sha256(Buffer.from(validation)));
      folderHashes.set(folder, Object.fromEntries(written));
      owners.set(pin.slug, {folder, descriptor: pinDescriptor(pin), mounts: [...mounts].sort()});
      // J262 (SP1a): a preparation from another renderer installs and cooks as it is; say so, as the cook does.
      const preparation = await preparationOf(files, root, pin, bytes);
      console.log(`${pin.slug}: admitted in ${((performance.now() - started) / 1000).toFixed(1)}s, ${files.size} files, ${published.size - beforeMounts} mounts published${preparation === 'none' ? '' : `, ${preparation} preparation`}`);
      if (preparation === 'stale') console.warn(`stale preparation: ${pin.slug}`);
      if (preparation === 'cook') console.warn(`prepared by cook: ${pin.slug}`);
    }
    if (!testFixtures) for (const asset of publicAssets) publish(`public${asset.url}`, asset.body);
  } finally {
    // The install lock has created out/. Keep cleanup information even if publication stopped midway.
    const kept = overlay ? before.filter(path => !replaced.has(path) && existsSync(path)) : [];
    paths = [...new Set([...kept, ...published])].sort((a, b) => a.localeCompare(b));
    if (!testFixtures) {
      writeFileSync(LEDGER, json({ revision, published: paths } satisfies Ledger));
      excludePublished(paths);
    }
  }
  if (failed > 0) process.exitCode = 1;
  if (!testFixtures && remoteSlugs.length > 0) await installSaves(remoteSlugs);
  if (full) pruneStale(root);
  if (source === 'staging') pruneStalePinProducts(root, pins.map(pin => pin.hash));
  // The manifest certifies these bytes only for the inputs the install read: a pin or source edited meanwhile changes the key.
  if (full && failed === 0 && pinsKey(root, shardfileValidationRevision(root)) === key) {
    writeManifest(root, key, Object.fromEntries(folderHashes), Object.fromEntries(mountHashes), {inputs, owners: Object.fromEntries(owners)});
  }
  if (full && failed === 0) clearLocalCandidates(root);
  const keptProducts = pins.length - toAdmit.length;
  if (keptProducts > 0) console.log(`pins: retained ${keptProducts} verified products`);
  console.log(`${pins.length - failed} of ${pins.length} pins admitted, ${paths.length} mounts published`);
  return pins;
}

const ringOf = (name: string): Ring => {
  const ring = (readJson(RINGS) as Record<string, Ring>)[name];
  if (ring === undefined) throw new Error(`No ring ${name}`);
  return ring;
};

/** What a server reads of a head, as a tarball of its own: a slice proves a host on real data with none of the art. It holds no
 *  receipt and isn't a product a page can open, so no build reads it. */
async function slice(check = false): Promise<void> {
  const { shards } = readJson(PINS) as PinFile, rows: Slice[] = [];
  const existing = existsSync(SLICES) ? (readJson(SLICES) as {slices: readonly Slice[]}).slices : [];
  for (const slug of ringOf('1').slices) {
    const pin = shards.find(row => row.slug === slug);
    if (pin === undefined) throw new Error(`Not pinned: ${slug}`);
    const {bytes, files} = await cutSlice(pin), hash = sha256(bytes);
    if (check) {
      const prior = existing.find(row => row.slug === slug);
      if (prior?.from !== pin.hash || prior.hash !== hash) throw new Error(`${slug}: slice differs from a fresh cook; re-cut with node scripts/pins.ts slice`);
    } else {
      mkdirSync(CACHE, { recursive: true });
      writeFileSync(join(CACHE, `${hash}.tar`), bytes);
    }
    rows.push({ slug, from: pin.hash, hash, bytes: bytes.length, files });
    console.log(`${slug}: ${(pin.bytes / 1e6).toFixed(1)} MB head, ${(bytes.length / 1e6).toFixed(1)} MB slice, ${files} files`);
  }
  if (!check) writeFileSync(SLICES, json({ slices: rows }));
  console.log(`${rows.length} slices, ${(rows.reduce((sum, row) => sum + row.bytes, 0) / 1e6).toFixed(1)} MB`);
}

/** A catalogue a build can bake with only the installed products. Dunes takes home if the pinned inputs omit the home shard.
 *  Uninstalled cells become Brasscap road cells (J434), preserving the grid's shape and playable crossings. */
function ringCatalogue(pins: readonly Pin[]): void {
  interface Cell { slug: string; instance: string; cell: readonly [number, number] }
  const catalogue = readJson(CATALOGUE) as { shards: { slug: string }[]; placements: { slug: string }[]; grid: { cells: Cell[] } };
  const kept = new Set(pins.map(({slug}) => slug));
  const filler = 'brasscap-mesa';
  if (!kept.has(filler)) throw new Error(`Ring catalogue fills its unkept cells with ${filler}, which this ring does not install`);
  const shards = catalogue.shards.filter(row => kept.has(row.slug));
  for (const row of shards) {
    const pin = pins.find(candidate => candidate.slug === row.slug);
    if (pin !== undefined) Object.assign(row, {hash: pin.hash, revision: pin.revision});
  }
  const home = catalogue.grid.cells.find(row => row.cell[0] === 0 && row.cell[1] === 0);
  const replaceHome = home === undefined || !kept.has(home.slug);
  const cells = catalogue.grid.cells.map(row => {
    if (replaceHome && row.instance === (home?.instance ?? 'home')) return { instance: 'sunscar-dunes', slug: 'sunscar-dunes', cell: row.cell };
    if (replaceHome && row.slug === 'sunscar-dunes') return { instance: home?.instance ?? 'home', slug: filler, cell: row.cell, speedClass: 'road' };
    return kept.has(row.slug) ? row : { instance: row.instance, slug: filler, cell: row.cell, speedClass: 'road' };
  });
  writeFileSync(RING_CATALOGUE, json({ ...catalogue, shards, placements: catalogue.placements.filter(row => kept.has(row.slug)), grid: { ...catalogue.grid, cells } }));
}

/** Materialize the same verified server slices for Ring 1 and the full-pin push gate. */
async function installRingSlices(slugs: readonly string[]): Promise<number> {
  const { readTar } = await import('@wildshard/format/tar');
  const { checkSlice } = await import('./slice-inputs.ts');
  const release = lockPins(process.cwd());
  try {
    rmSync(SLICED, { recursive: true, force: true });
    const { slices } = readJson(SLICES) as { slices: readonly Slice[] };
    const { shards } = readJson(PINS) as PinFile;
    let bytes = 0;
    for (const slug of slugs) {
      const row = slices.find(entry => entry.slug === slug);
      if (row === undefined) throw new Error(`${slug}: missing Ring 1 slice pin`);
      if (row.from !== shards.find(pin => pin.slug === row.slug)?.hash) throw new Error(`${row.slug}: slice belongs to another head; re-cut with node scripts/pins.ts slice`);
      const body = await tarball(row, false), target = join(SLICED, row.slug);
      checkSlice(body, row.slug);
      bytes += body.length;
      for (const [path, file] of readTar(body)) {
        if (path.endsWith('/')) continue;
        mkdirSync(dirname(join(target, path)), { recursive: true });
        writeFileSync(join(target, path), file);
      }
    }
    return bytes;
  } finally { release?.(); }
}

async function installRing(name: string, extra: readonly string[]): Promise<void> {
  const ring = ringOf(name), started = performance.now();
  const pins = await install([...new Set([...ring.products, ...extra])], 'ring');
  // A tree that held every head keeps none of the others: their mounts just left public/.
  const wanted = new Set(pins.map(row => row.hash));
  for (const folder of readdirSync('out')) {
    const receipt = join('out', folder, 'validation.json');
    if (existsSync(receipt) && !wanted.has((readJson(receipt) as { pin?: Pin }).pin?.hash ?? '')) rmSync(join('out', folder), { recursive: true });
  }
  const bytes = await installRingSlices(ring.slices);
  ringCatalogue(pins);
  await installSaves(ring.slices);
  const products = pins.reduce((sum, row) => sum + row.bytes, 0);
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
  const sources = existsSync('out') ? readdirSync('out').flatMap(name => {
    const file = join('out', name, 'validation.json');
    if (!existsSync(file)) return [];
    const receipt = readJson(file) as {source?: {kind: string; path: string; indexHash: string}};
    return receipt.source === undefined ? [] : [{slug: name, ...receipt.source}];
  }) : [];
  console.log(JSON.stringify({ pins: shards.length, installed: shards.length - missing.length, missing: missing.map(row => row.slug), stale: ledger !== undefined && ledger.revision !== shardfileValidationRevision(process.cwd()), sources }));
  if (missing.length > 0) process.exitCode = 1;
}

const [command = 'status', ...rest] = process.argv.slice(2);
if (command === 'refresh') {
  if (rest.length === 2 && rest[0] === '--channel' && rest[1] === 'staging') {
    const {refreshStaging} = await import('./pins-staging.ts');
    await refreshStaging(API);
  } else {
  if (rest.some((arg, at) => arg.startsWith('-') ? arg !== '--drop' : rest[at - 1] !== '--drop')) throw new Error('usage: pins.ts refresh [--drop slug[,slug]]...');
  await refresh(rest.flatMap((arg, at) => rest[at - 1] === '--drop' ? arg.split(',') : []));
  }
}
else if (command === 'install' && rest.length === 1 && rest[0] === '--staging') await install([], 'staging');
else if (command === 'install' && rest.length === 1 && rest[0] === '--for-tests') {
  await install([]);
  if (process.exitCode !== 1) await install([], 'tests');
}
else if (command === 'install' && rest[0] === '--ring') await installRing(rest[1] ?? '1', rest.slice(2));
else if (command === 'install' && rest.length === 2 && rest[0] === '--ring-slices') await installRingSlices(ringOf(rest[1] ?? '1').slices);
else if (command === 'install' && rest[0] === '--from-format') await install(rest.slice(1), 'format');
else if (command === 'install' && rest[0] === '--from-dir') {
  if (rest.length !== 2 || !rest[1]) throw new Error('usage: pins.ts install --from-dir <built out/slug directory>');
  await install([], 'local', rest[1]);
}
else if (command === 'install') await install(rest);
else if (command === 'slice') await slice();
else if (command === 'verify-slices') await slice(true);
else if (command === 'install-saves') await installSaves(rest);
else if (command === 'keep') await keep(rest[0] ?? 'tmp/pins-release');
else if (command === 'status') status();
else throw new Error('usage: pins.ts refresh [--drop slug] | install [slug...] | install --for-tests | install --staging | install --ring 1 [extra slug...] | install --ring-slices 1 | install-saves [slug...] | slice | verify-slices | keep <dir> | status');
