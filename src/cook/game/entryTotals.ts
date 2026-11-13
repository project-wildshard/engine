/// <reference types="node" />
import * as v from 'valibot';
// oxlint-disable-next-line import/no-nodejs-modules -- The cook is a Node process (J28).
import {existsSync, readFileSync, mkdirSync, readdirSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- The cook is a Node process (J28).
import {join, relative, resolve, sep} from 'node:path';
import {PickupCatalogueSchema} from '@wildshard/format/specimenCatalogue';
import {parseOutputIndex} from '@wildshard/format/outputIndex';
// oxlint-disable-next-line import/no-nodejs-modules -- The cook is a Node process (J28).
import {createHash} from 'node:crypto';
import {readSpawnManifest, type SpawnFile, type SpawnManifest, type SpawnManifestAddress} from '../../shared/game/shardfile/spawnManifest';
import {assetIdentities, audioTableRefs, bundlerSources as manifestSources, identityFiles, joinRefs, standInRefs, packMembers, readFenceReads, resolveFenceReads, sectionRefs, type PackPart} from './fenceReads';
import {createPartEncoder, writeSpawnManifestFiles, writeSpawnParts, type CookedMember, type SpawnPartEncoding} from './spawnParts';
import {cookParts, cookShardServerPack, openShardfile, servedAsIs, shardHalf, stalePreparationLine, type PreparationState} from './shardCook';
import type {ServerPack} from '../../shared/game/shardfile/serverPack';
import {contentNamed} from './contentNamed';
// oxlint-disable-next-line import/no-nodejs-modules -- The cook is a Node process (J28).
import {homedir} from 'node:os';
import {productTarball} from './productTarball';
import {BrotliSizeCache} from './brotliSizeCache.mjs';
import {defaultBootAudio, ENGINE_MUSIC_STYLE, missingEngineMusic, musicDir} from '@wildshard/engine/audio/bootAudio';
import {withAssetTables, type AssetTables} from '@wildshard/engine/boot/tables';
import type {AudioData} from '@wildshard/format/audio';

const size = v.pipe(v.number(), v.safeInteger(), v.minValue(0));
const files = v.array(v.tuple([v.string(), size]));
const schema = v.object({common: files, client: files, grid: files,
  optional: v.object({files, groups: v.record(v.string(), v.array(size))}),
  products: v.record(v.string(), v.union([v.strictTuple([size, size, size, size]), v.strictTuple([size, size])])),
  extras: v.record(v.string(), v.tuple([v.string(), size, size, v.string()])),
});
interface Address {readonly url: string; readonly bytes: number}
const AUDIO_URL = /^\/assets\/(?:music|sfx)\/[^?]+\.(?:m4a|mp3|ogg|opus|wav|webm|flac)(?:\?|$)/u;
/** AUDIO AU1 (J299): the recordings a shard's LOAD reads, so DOWNLOAD fetches, counts and caches them: a new player's
 *  boot set (the default music style and sound-effect set, through the client's own selection) and the audio its
 *  recorded fence names. `tables` is the build's common boot table, the one the page installs. */
export function shardBootAudio(sections: ReadonlyMap<string, unknown>, tables: AssetTables, fenceMounts: readonly string[], shard = 'shard'): readonly string[] {
  const row = sections.get('audio/audio'), data = typeof row === 'object' && row !== null && 'audio' in row ? row.audio as AudioData : undefined;
  // A level with no music or sample rows boots with no recordings (NO_AUDIO); anything else must select, as on the page.
  let boot: readonly string[] = [];
  // AU18 (J304): the rows name the engine music they play; a name this build's style lacks fails the cook, never drops.
  const music = data?.music, missing = music === undefined ? [] : withAssetTables(tables, () => missingEngineMusic(music));
  if (missing.length > 0) throw new Error(`${shard}: its audio rows name engine music the ${ENGINE_MUSIC_STYLE} style lacks: ${missing.join(', ')}`);
  if (data !== undefined && data.music !== undefined && data.samples !== undefined) {
    try { boot = withAssetTables(tables, () => defaultBootAudio(data)); }
    catch (error) { throw new Error(`${shard}: its boot audio does not select (${error instanceof Error ? error.message : String(error)})`, {cause: error}); }
  }
  const shipped = (url: string): boolean => Object.hasOwn(tables.bytes, url.split('?')[0] ?? url);
  return [...new Set([...boot, ...fenceMounts.filter(url => AUDIO_URL.test(url)).map(url => url.split('?')[0] ?? url)])].filter(shipped);
}
/** AU18: the build log's line for a shard's derived engine music (its boot set's files under the engine style). */
export function engineMusicLine(shard: string, bootAudio: readonly string[], tables: AssetTables): string {
  const dir = musicDir(ENGINE_MUSIC_STYLE), music = bootAudio.filter(url => url.startsWith(dir));
  const bytes = music.reduce((sum, url) => sum + (tables.bytes[url] ?? 0), 0);
  return `${shard}: engine music: ${music.length} files, ${(bytes / 1e6).toFixed(2)} MB${music.length === 0 ? '' : ` (${music.map(url => url.slice(dir.length)).join(', ')})`}`;
}
/** What a build's half of the manifests needs from the app: the page's own tables and names, which no cook owns. */
export interface BuildHalf {
  readonly preparationOnly?: boolean;
  /** AUDIO AU19: write each manifest's file list alone: no part or server pack is cooked, and a row's wire size is its
   *  raw size. The lists are the build's own (the rows don't depend on packing); a test reads them without the
   *  minutes the parts' q11 encode takes over every product. Tests only: a build never sets it. */
  readonly filesOnly?: boolean;
  readonly rendererRevision?: string;
  readonly cacheName: string;
  readonly gpuFiles: Parameters<typeof standInRefs>[0];
  /** The boot tables' common and pack sources, as `assetTables.mjs` bakes them. */
  readonly tables: (root: string) => {readonly common: {readonly source: string}; readonly all: {readonly source: string}; readonly packs: Readonly<Record<string, {readonly source: string}>>};
  readonly tableAddresses: (root: string) => {readonly common: Address; readonly all: Address; readonly packs: Readonly<Record<string, Address>>};
  /** The certified grid seams' address (`gridSeams.mjs`). */
  readonly seams: (root: string) => Address & {readonly plans?: Address | undefined};
}
/** S3: a fence read is a phone's: on a desktop each `.phone` file is its desktop copy, by name, and a phone pack is nothing.
 *  S4: a shard's 6×6 overlay (`/assets/<shard>/astc6/<the path under /assets/gpu>`) is a phone file whatever its name says. */
export function desktopFence(reads: readonly string[], urls: readonly string[]): readonly string[] {
  const overlay = /^\/assets\/[^/]+\/astc6\//u, phoneOnly = (url: string): boolean => /\.phone[.-]/u.test(url) || overlay.test(url);
  const plain = (url: string): string => (url.split('?')[0] ?? url).replace(overlay, '/assets/gpu/').replace(/-[a-f0-9]{8}(?=\.[a-z0-9]+$)/u, '').replace(/\.(?:phone|desktop)(?=\.[a-z0-9]+$)/u, '');
  // Content-named last, so the emitted file wins over its public source.
  const named = (url: string): number => Number(/-[a-f0-9]{8}\.[a-z0-9]+$/u.test(url));
  const desktop = new Map(urls.filter(url => !phoneOnly(url)).sort((a, b) => named(a) - named(b)).map(url => [plain(url), url]));
  return [...new Set(reads.flatMap(url => { if (!phoneOnly(url)) return [url]; const own = desktop.get(plain(url)); return own === undefined ? [] : [own]; }))];
}
/** S4: a shard's phone stand-ins laid over the engine's table (`data/astc6.generated.json`). A phone reads the overlay's
 *  file under the same served URL, so its fence read keeps the identity it had. */
function phoneOverlay(root: string, directory: string): Readonly<Record<string, string>> {
  const path = join(root, 'src/shards', directory, 'data/astc6.generated.json');
  if (existsSync(path)) return v.parse(v.record(v.string(), v.string()), JSON.parse(readFileSync(path, 'utf8')));
  // Any other shard's overlay is in its product: the discovery's phone table, the rows that name a 6×6 file.
  const discovery = join(root, 'out', directory, 'mounts/shardfiles', directory, 'discovery.json');
  if (!existsSync(discovery)) return {};
  const table = v.safeParse(v.looseObject({native: v.looseObject({ktx2: v.looseObject({GPU_FILES: v.looseObject({phone: v.record(v.string(), v.string())})})})}), JSON.parse(readFileSync(discovery, 'utf8')));
  return table.success ? Object.fromEntries(Object.entries(table.output.native.ktx2.GPU_FILES.phone).filter(([, url]) => url.includes('/astc6/'))) : {};
}
/** DL5: a shard's packs set, `src/shards/<slug>/packs-set.json` (`{"version": 1, "set": "fence"}`): 'fence' packs the
 *  default set (what the boot reads before control), absent packs the whole level. Anything else fails the build. */
export function readPacksSet(path: string): 'whole' | 'fence' {
  if (!existsSync(path)) return 'whole';
  return v.parse(v.strictObject({version: v.literal(1), set: v.literal('fence')}), JSON.parse(readFileSync(path, 'utf8'))).set;
}
export interface SpawnManifestBook {
  readonly cacheName: string;
  readonly client: Readonly<Record<string, Readonly<Record<'phone' | 'desktop', SpawnManifestAddress>>>>;
  readonly grid: Readonly<Record<string, Readonly<Record<string, Readonly<Record<'phone' | 'desktop', SpawnManifestAddress>>>>>>;
  /** DL16: the whole level with its parts, read only with Debug > Level download > Runtime packs. */
  readonly packs: {readonly client: SpawnManifestBook['client']; readonly grid: SpawnManifestBook['grid']};
  /** C2: each product's server class, one part each; only the server worker reads this. */
  readonly serverPacks: Readonly<Record<string, ServerPack>>;
}

/** Write the complete ordered spawn IO, rather than estimating a number from
 * a full product. This is the only list the new loader and bar consume. */
export async function writeSpawnManifests(outDir: string, input: unknown,
  strips: Readonly<Record<string, Readonly<Record<string, readonly Address[]>>>>, root: string, build: BuildHalf,
  report?: (parts: SpawnPartEncoding) => void): Promise<SpawnManifestBook> {
  const bank = v.parse(schema, input), publicRoot = resolve(root, 'public'), output = resolve(outDir), assets = new Map<string, SpawnFile>();
  const encoded = new BrotliSizeCache(process.env['WILDSHARD_WIRE_SIZE_CACHE'] ?? resolve(homedir(), '.cache/wildshard/gen/served-bytes/1'));
  const precompressed = new BrotliSizeCache(process.env['WILDSHARD_WIRE_SIZE_CACHE'] ?? resolve(homedir(), '.cache/wildshard/gen/served-bytes/1'), 'precompressed');
  const wireSizes = new Map<string, number>();
  const wireBytes = (url: string, bytes: Uint8Array, hash: string): number => {
    if (build.filesOnly === true) return bytes.length;
    const key = `${hash}:${url}`, previous = wireSizes.get(key); if (previous !== undefined) return previous;
    // Match the deployed/preview representation; Rapier retains its precompressed native body.
    const length = servedAsIs(url, bytes) ? bytes.length
      : url === '/assets/physics/rapier.wasm' ? precompressed.bytes(bytes) : encoded.bytes(bytes);
    wireSizes.set(key, length); return length;
  };
  const bytesFor = (url: string): Uint8Array => {
    if (!/^\/(?:assets|b|basis|fonts)\/(?:[a-zA-Z0-9_.-]+\/)*[a-zA-Z0-9_.-]+$/u.test(url) || url.split('/').includes('..')) throw new Error('Unsafe spawn asset URL');
    const emitted = join(output, url.slice(1)), authored = join(publicRoot, url.slice(1));
    return readFileSync(existsSync(emitted) ? emitted : authored);
  };
  // DL5: each listed URL's own bytes, read again only when its part is written.
  const sources = new Map<string, () => Uint8Array>();
  // DL5: a product file's stable name (model or section), so an edit keeps its part placement.
  const stableKeys = new Map<string, string>();
  const asset = (url: string, declared?: number): SpawnFile => {
    const previous = assets.get(url); if (previous !== undefined) {
      if (declared !== undefined && previous.bytes !== declared) throw new Error('Spawn asset size differs'); return previous;
    }
    const bytes = bytesFor(url), hash = createHash('sha256').update(bytes).digest('hex');
    if (declared !== undefined && declared !== bytes.length) throw new Error(`Spawn asset size differs: ${url}`);
    const versioned = contentNamed(url) || /[-_][a-zA-Z0-9_-]{8}\.(?:js|css)$/u.test(url) || url.startsWith('/basis/r');
    const row = {url: versioned ? url : `${url}?v=${hash.slice(0, 8)}`, bytes: bytes.length, hash, wireBytes: wireBytes(url, bytes, hash)};
    assets.set(url, row); sources.set(row.url, () => bytesFor(url)); return row;
  };
  // DL22: this build's /assets and /b files (emitted and authored) and its pack parts, for the fence lists' /assets entries.
  let assetsSeen: readonly string[] | undefined, partsSeen: ReadonlyMap<string, PackPart> | undefined;
  const publicAssets = (): readonly string[] => {
    if (assetsSeen !== undefined) return assetsSeen;
    const urls = new Set<string>();
    for (const [base, name] of [[output, 'assets'], [output, 'b'], [publicRoot, 'assets']] as const) {
      const folder = join(base, name);
      if (!existsSync(folder)) continue;
      for (const entry of readdirSync(folder, {recursive: true, withFileTypes: true})) {
        if (entry.isFile()) urls.add(`/${relative(base, join(entry.parentPath, entry.name)).split(sep).join('/')}`);
      }
    }
    assetsSeen = [...urls]; return assetsSeen;
  };
  // A name's hash is stripped only when the file's bytes match it (sha1 or sha256): `forest-2` is a name (sp-x1).
  const digestsSeen = new Map<string, readonly string[]>();
  const assetDigests = (path: string): readonly string[] => {
    const seen = digestsSeen.get(path); if (seen !== undefined) return seen;
    let found: readonly string[] = [];
    try { const bytes = bytesFor(path); found = [createHash('sha1').update(bytes).digest('hex'), createHash('sha256').update(bytes).digest('hex')]; }
    catch { /* not a file of this build: nothing is stripped */ }
    digestsSeen.set(path, found); return found;
  };
  // The bundler's own /assets files by their source module (its manifest: source -> emitted file).
  let sourcesSeen: ReadonlyMap<string, readonly string[]> | undefined;
  const bundlerSources = (): ReadonlyMap<string, readonly string[]> => {
    if (sourcesSeen !== undefined) return sourcesSeen;
    const manifest = join(output, '.vite/manifest.json');
    sourcesSeen = existsSync(manifest) ? manifestSources(JSON.parse(readFileSync(manifest, 'utf8'))) : new Map(); return sourcesSeen;
  };
  const packParts = (): ReadonlyMap<string, PackPart> => {
    if (partsSeen !== undefined) return partsSeen;
    const banks = build.tables(root), parts = new Map<string, PackPart>();
    for (const table of [banks.all, ...Object.values(banks.packs)]) for (const [url, part] of packMembers((JSON.parse(table.source) as {packs?: unknown}).packs)) parts.set(url, part);
    partsSeen = parts; return parts;
  };
  const common: SpawnFile[] = [];
  if (existsSync(join(publicRoot, 'assets/physics/rapier.wasm'))) common.push(asset('/assets/physics/rapier.wasm'));
  if (existsSync(join(publicRoot, 'basis'))) for (const directory of readdirSync(join(publicRoot, 'basis'))) {
    if (!/^r[0-9]+$/u.test(directory)) continue;
    for (const name of ['basis_transcoder.js', 'basis_transcoder.wasm']) if (existsSync(join(publicRoot, 'basis', directory, name))) common.push(asset(`/basis/${directory}/${name}`));
  }
  const pickupPath = join(root, 'src/client/game/data/pickupCatalogue.json');
  if (existsSync(pickupPath)) {
    const pickups = v.parse(PickupCatalogueSchema, JSON.parse(readFileSync(pickupPath, 'utf8')));
    const packed = new Set(pickups.banks?.flatMap(row => row.members.map(member => member.file)));
    for (const row of pickups.banks ?? []) common.push(asset(row.file));
    for (const row of pickups.geometries) if ('file' in row && !packed.has(row.file)) common.push(asset(row.file));
  }
  const tables = existsSync(join(root, 'out/.app/boot-tables.json')) ? build.tableAddresses(root) : undefined;
  const assetTables = tables === undefined ? undefined : JSON.parse(build.tables(root).common.source) as AssetTables;
  const seams = existsSync(join(root, 'out/.app/grid-seams.json')) ? build.seams(root) : undefined;
  const client: Record<string, Record<'phone' | 'desktop', SpawnManifestAddress>> = {}, grid: Record<string, Record<string, Record<'phone' | 'desktop', SpawnManifestAddress>>> = {};
  mkdirSync(join(output, 'assets/spawn'), {recursive: true});
  const pending: {manifest: Omit<SpawnManifest, 'parts'>; public: boolean; packed: boolean}[] = [];
  const clientAt: Record<string, {phone: number; desktop: number}> = {}, gridAt: Record<string, Record<string, {phone: number; desktop: number}>> = {};
  const packsClientAt: typeof clientAt = {}, packsGridAt: typeof gridAt = {};
  const encoder = createPartEncoder(), cooked = new Map<string, CookedMember>(), serverPacks: Record<string, ServerPack> = {};
  // C3: a grid page reads every primary neighbour's discovery document before it enters.
  const discoveries = Object.keys(bank.products).flatMap(prefix => {
    const directory = prefix.split('/')[2] ?? '', url = `/shardfiles/${directory}/discovery.json`, file = join(root, 'out', directory, 'mounts', url);
    if (!existsSync(file)) return [];
    const bytes = readFileSync(file), hash = createHash('sha256').update(bytes).digest('hex'), row = {url: `${url}?v=${hash.slice(0, 8)}`, bytes: bytes.length, hash, wireBytes: wireBytes(url, bytes, hash)};
    sources.set(row.url, () => bytes);
    return [row];
  });
  const preparations: Partial<Record<PreparationState, string[]>> = {};
  for (const prefix of Object.keys(bank.products)) {
    const directory = prefix.split('/')[2]; if (directory === undefined || !/^[a-z0-9_-]+$/u.test(directory)) throw new Error('Invalid spawn shard');
    const product = join(root, 'out', directory), index = parseOutputIndex(JSON.parse(readFileSync(join(product, 'shard.json'), 'utf8')));
    if (index.runtime !== null && (!('kind' in index.runtime) || index.runtime.kind !== 'client-plan')) continue;
    // C1: the shard half comes from the shardfile alone, one tarball per product, and its parts from the shard's own cook.
    const half = shardHalf(openShardfile(productTarball(product), {preparationOnly: build.preparationOnly === true,
      ...(build.rendererRevision === undefined ? {} : {renderer: build.rendererRevision})}), wireBytes, undefined, directory), {sections} = half.shard;
    // J262 (SP1a): a preparation from another renderer cooks as it is, and the build says which shards took that path.
    (preparations[half.shard.preparation] ??= []).push(directory);
    if (half.shard.preparation === 'stale') console.warn(stalePreparationLine(directory));
    const shardRows = {phone: {entry: half.productRows('phone', 'entry'), whole: half.productRows('phone', 'whole')},
      desktop: {entry: half.productRows('desktop', 'entry'), whole: half.productRows('desktop', 'whole')}};
    if (build.filesOnly !== true) {
      for (const [url, member] of await cookParts(output, half, [{tier: 'phone', rows: shardRows.phone.whole}, {tier: 'desktop', rows: shardRows.desktop.whole}], encoder)) cooked.set(url, member);
      serverPacks[directory] = await cookShardServerPack(half.shard, output, encoder);
    }
    for (const table of [shardRows.phone, shardRows.desktop]) for (const row of [...table.entry, ...table.whole]) {
      const stable = half.stableKey(row.url); if (stable !== undefined) stableKeys.set(row.url, stable);
    }
    // DL22: the shard's recorded pre-control reads (scripts/record-fence-reads.mjs), mapped to this product's hashes.
    const fencePath = join(root, 'src/shards', directory, 'fence-reads.json');
    let fenceAssets: readonly string[] = [];
    if (existsSync(fencePath)) {
      const reads = readFenceReads(JSON.parse(readFileSync(fencePath, 'utf8')));
      const resolved = resolveFenceReads({version: 1, files: reads.files.filter(row => !row.startsWith('asset'))}, index.files, sections);
      // `/assets` entries, and a section reference that names an /assets file rather than a product file.
      // A shard's own images are its product's now (`shardHalf`'s card rows): a record from before C3 still names their sources.
      const shell = [...reads.files.filter(row => row.startsWith('asset') && !row.startsWith('asset-source:src/shards/')), ...resolved.unresolved.filter(row => row.startsWith('ref:'))];
      // `/assets` reads (Pine's asset packs, gpu models, sfx, music): this build's emitted files and pack tables.
      const urls = publicAssets(), members = [...packParts().values()].flatMap(part => part.members);
      // Section references, then the boot tables' audio slots (Pine's colliding sfx revisions).
      const refs = joinRefs(sectionRefs(sections, new Set([...urls, ...members].map(url => url.split('?')[0] ?? url))),
        audioTableRefs(JSON.parse(build.tables(root).common.source) as {sfx?: unknown; music?: unknown}), standInRefs({...build.gpuFiles, phone: {...build.gpuFiles['phone'], ...phoneOverlay(root, directory)}}));
      // An identity is one file or none: one naming two distinct files (two vendor versions, sp-x9) refuses, never the first.
      const owners = identityFiles(assetIdentities(urls, packParts(), refs, {digests: assetDigests, sources: bundlerSources()}));
      const ambiguous = shell.filter(identity => (owners.get(identity)?.length ?? 0) > 1);
      if (ambiguous.length > 0) throw new Error(`${fencePath} lists ${ambiguous.length} identities naming more than one file of this build `
        + `(${ambiguous.slice(0, 3).join(', ')}); re-record with scripts/record-fence-reads.mjs`);
      const byIdentity = new Map<string, string>();
      for (const [identity, named] of owners) { const only = named[0]; if (named.length === 1 && only !== undefined) byIdentity.set(identity, only); }
      fenceAssets = [...new Set(shell.flatMap(identity => { const url = byIdentity.get(identity); return url === undefined ? [] : [url]; }))];
      const unresolved = [...resolved.unresolved.filter(row => !row.startsWith('ref:')), ...shell.filter(identity => !byIdentity.has(identity))];
      // A stale entry fails the build (sp-x8's review): skipping it would quietly bring back an on-demand fetch.
      if (unresolved.length > 0) throw new Error(`${fencePath} lists ${unresolved.length} files this build no longer has `
        + `(${unresolved.slice(0, 3).join(', ')}); re-record with scripts/record-fence-reads.mjs`);
    }
    // AUDIO AU1: the same recordings on every tier and flow: LOAD reads them before control on all of them.
    const bootAudio = assetTables === undefined ? [] : shardBootAudio(sections, assetTables, half.mountRows('phone', 'entry').map(row => row.url), directory);
    if (assetTables !== undefined && sections.has('audio/audio')) console.info(engineMusicLine(directory, bootAudio, assetTables));
    const write = (tier: 'phone' | 'desktop', flow: 'client' | 'grid', addresses: readonly Address[] = [], mode = '000', whole = false): number => {
      const selected = new Map<string, SpawnFile>(), add = (row: SpawnFile): void => {selected.set(row.url, row);};
      for (const row of shardRows[tier][whole ? 'whole' : 'entry']) add(row);
      for (const url of tier === 'phone' ? fenceAssets : desktopFence(fenceAssets, publicAssets())) add(asset(url));
      // S3: the desktop's own packs. A one-file pack is read by its member's URL (texturePack.ts), so that member is the row.
      if (whole && tier === 'desktop' && tables !== undefined) for (const [url, part] of packParts()) {
        if (url.startsWith(`/assets/packs/${directory}.desktop-`)) add(asset(part.members.length === 1 && part.members[0] !== undefined ? part.members[0] : url));
      }
      for (const row of common) add(row);
      for (const [url, bytes] of [...bank.common, ...bank[flow]]) add(asset(url, bytes));
      for (const url of bootAudio) add(asset(url));
      if (flow === 'grid') for (const row of discoveries) add(row);
      for (const member of bank.optional.groups[`home:${prefix}`] ?? []) {
        const row = bank.optional.files[member]; if (row === undefined) throw new Error('Invalid spawn module index'); add(asset(row[0], row[1]));
      }
      if (tables !== undefined) {
        add(asset(tables.common.url, tables.common.bytes));
        const table = flow === 'grid' || tier === 'desktop' ? tables.all : tables.packs[directory];
        if (table !== undefined) add(asset(table.url, table.bytes));
      }
      if (flow === 'grid' && seams !== undefined) {
        add(asset(seams.url, seams.bytes));
        // The compiled page owns its plans; only native fallback reads the
        // separate plan wire. Neither path declares the other one's payload.
        if (addresses.length === 0 && seams.plans !== undefined) add(asset(seams.plans.url, seams.plans.bytes));
      }
      for (const row of addresses) add(asset(row.url, row.bytes));
      const extra = bank.extras[prefix];
      if (extra !== undefined) {
        const inventory = bytesFor(extra[0]);
        if (inventory.length !== extra[1] || createHash('sha256').update(inventory).digest('hex') !== extra[3]) throw new Error('Spawn public inventory differs');
        // S4 on Sky: this inventory names a page's image sources on every tier. A phone with an overlay reads the 6×6 file in
        // their place, and one with no ASTC reads them loose, so they stay off the phone's list.
        const overlay = tier === 'phone' ? phoneOverlay(root, directory) : {};
        for (const [url, bytes] of v.parse(files, JSON.parse(new TextDecoder().decode(inventory)))) if (!Object.hasOwn(overlay, url.split('?')[0] ?? url)) add(asset(url, bytes));
      }
      // Required code can resolve while bulk content downloads. Keep each
      // partition's original order, every row and the full download barrier.
      const original = [...selected.values()], code = (row: SpawnFile): boolean => /\.(?:js|wasm)(?:\?|$)/u.test(row.url);
      const rows = [...original.filter(code), ...original.filter(row => !code(row))];
      const totalBytes = rows.reduce((sum, row) => sum + row.bytes, 0), wire = rows.reduce((sum, row) => {if (row.wireBytes === undefined) throw new Error('Missing spawn wire size'); return sum + row.wireBytes;}, 0);
      // The public phone entries (client, and grid mode 000) steer how files share parts.
      pending.push({manifest: {version: 1, shard: directory, tier, flow, files: rows, totalBytes, wireBytes: wire}, public: tier === 'phone' && (flow === 'client' || mode === '000'), packed: whole});
      return pending.length - 1;
    };
    // DL16: the default book is today's entry set (Shardfile, what every player gets); the packs book is the whole
    // level in parts, read only with Debug > Level download > Runtime packs until a memory reading backs it.
    clientAt[directory] = {phone: write('phone', 'client'), desktop: write('desktop', 'client')};
    packsClientAt[directory] = {phone: write('phone', 'client', [], '000', true), desktop: write('desktop', 'client', [], '000', true)};
    for (const [mode, homes] of Object.entries(strips)) {
      (gridAt[mode] ??= {})[directory] = {phone: write('phone', 'grid', homes[directory], mode), desktop: write('desktop', 'grid', homes[directory], mode)};
      (packsGridAt[mode] ??= {})[directory] = {phone: write('phone', 'grid', homes[directory], mode, true), desktop: write('desktop', 'grid', homes[directory], mode, true)};
    }
  }
  if (Object.keys(preparations).length > 0) console.info(`cook preparation: ${(['current', 'stale', 'none'] as const).map(state => `${preparations[state]?.length ?? 0} ${state}`).join(', ')}`);
  // DL5: every manifest is known, so pack their files into shared parts, then write each manifest with its own table.
  const packed = pending.flatMap((row, index) => row.packed ? [index] : []);
  const packedTables = build.filesOnly === true ? [] : await writeSpawnParts(output, packed.map(index => ({rows: pending[index]?.manifest.files ?? [], public: pending[index]?.public === true, desktop: pending[index]?.manifest.tier === 'desktop'})), url => {
    const read = sources.get(url); if (read === undefined) throw new Error(`Spawn file has no source: ${url}`); return read();
  }, url => stableKeys.get(url), encoder, cooked);
  // DL15: each part's q11 body is written before the manifests, so every part row carries its exact wire size.
  report?.(encoder.stats());
  const written: SpawnManifestAddress[] = [];
  for (const [index, {manifest: base}] of pending.entries()) {
    const at = packed.indexOf(index);
    // OVERNIGHT 6e: the code rows go in a list of their own, so a code change renames that list and no manifest.
    written.push(writeSpawnManifestFiles(output, readSpawnManifest(at === -1 ? base : {...base, parts: packedTables[at] ?? []})));
  }
  const at = (index: number): SpawnManifestAddress => { const address = written[index]; if (address === undefined) throw new Error('Missing spawn manifest'); return address; };
  for (const [directory, pair] of Object.entries(clientAt)) client[directory] = {phone: at(pair.phone), desktop: at(pair.desktop)};
  for (const [mode, shards] of Object.entries(gridAt)) for (const [directory, pair] of Object.entries(shards)) (grid[mode] ??= {})[directory] = {phone: at(pair.phone), desktop: at(pair.desktop)};
  const packs: {client: typeof client; grid: typeof grid} = {client: {}, grid: {}};
  for (const [directory, pair] of Object.entries(packsClientAt)) packs.client[directory] = {phone: at(pair.phone), desktop: at(pair.desktop)};
  for (const [mode, shards] of Object.entries(packsGridAt)) for (const [directory, pair] of Object.entries(shards)) (packs.grid[mode] ??= {})[directory] = {phone: at(pair.phone), desktop: at(pair.desktop)};
  return {cacheName: build.cacheName, client, grid, packs, serverPacks};
}
