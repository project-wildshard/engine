/// <reference types="node" />
/** C1 (J28, J83, J84): `cook <shardfile> → <packs>`. A shard's half of the spawn download, from its tarball alone: no
 * bundle, no `src/shards`, no `public/`. The engine half (code, common files, boot tables) is per build and stays with
 * the app build, which calls this once per product and keeps today's grouping for what is left.
 *
 * What comes out: one manifest per tier and set (`entry`, what every player gets; `whole`, the level with its parts), the
 * q11 parts, and each mount at its public URL when it can't go in a part. Part bodies follow `placeByKey`, so a product's
 * sections and level files fall in the same parts whether one shard cooks or twenty-eight do (DL18). */
// oxlint-disable-next-line import/no-nodejs-modules -- The cook is a Node process (J28).
import {createHash} from 'node:crypto';
// oxlint-disable-next-line import/no-nodejs-modules -- The cook is a Node process (J28).
import {mkdirSync, writeFileSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- The cook is a Node process (J28).
import {dirname, join} from 'node:path';
import {COOK_DATA_PATH, readCookData, type CookData, type CookMount} from '@wildshard/format/cookData';
import {requireCookPreparation} from '@wildshard/format/cookPreparation';
import {cookPreparedLine, judgeSidecar, sidecarRefusedLine, type CookSidecar} from './cookSidecar';
import {rendererRevision} from '../../scripts/renderer-revision.mjs';
import {assembleOutputShardfile, parseOutputIndex, type OutputIndex} from '@wildshard/format/outputIndex';
import {checkEngineFloor} from './engineFloor';
import {SPAWN_PART_ALIGN, readSpawnManifest, type SpawnFile, type SpawnManifest, type SpawnPart} from '../../shared/game/shardfile/spawnManifest';
import type {Shardfile} from '@wildshard/format/shardSchema';
import {readTar} from '@wildshard/format/tar';
import type {ServerPack, ServerPackPart} from '../../shared/game/shardfile/serverPack';
import { serverReadsFile } from '@wildshard/format/serverReads';
import {serverSkinRigs} from '../../shared/game/shardfile/serverSkinRigs';
import { entryReadSet } from '@wildshard/format/entryReadSet';
import {phoneTier, splatPhoneTier, type Astc6Encode, type SplatPhoneLayer} from './tierTextures';
import {splatTerrainOf} from '@wildshard/format/splatTerrain';
import {blobKtx2, blobTextureUses, type TextureBlob} from './blobKtx2';
import {wasmAstc6} from './astc6Wasm';
import {desktopKtx2} from './cookedKtx2';
import {wasmImageKtx2, type ImageKtx2Encode} from './imageKtx2Wasm';
import {cookedKtx2TableOf, EMPTY_COOKED_KTX2_TABLE, type CookedKtx2Table} from '../../shared/game/shardfile/cookedKtx2Table';
import {createPartEncoder, packable, writeSpawnParts, type CookedMember, type PartEncoder} from './spawnParts';
import {cookedMapPngs, type CookedMapOptions, type CookedMapStats, type MapDrawn} from './cookedMap';
import {cookedMapPath} from '../../shared/game/shardfile/cookedMapPath';

export type CookTier = 'phone' | 'desktop';
export type CookSet = 'entry' | 'whole';
export const COOK_TIERS: readonly CookTier[] = ['phone', 'desktop'];
export const COOK_SETS: readonly CookSet[] = ['entry', 'whole'];
/** The size a served file has on the wire; the cook has no opinion on how a host compresses a loose file. */
export type WireBytes = (url: string, bytes: Uint8Array, hash: string) => number;

/** Bytes a host serves as they are: small files and formats that are already compressed (J84). */
export const servedAsIs = (url: string, bytes: Uint8Array): boolean => bytes.length < 1024 || /\.(?:png|jpe?g|webp|avif|gif|ico|woff2?|ttf|mp4|webm|mp3|ogg|m4a|wav)$/iu.test(url);

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const CONTENT_NAMED = /\/[a-f0-9]{64}\.[a-z0-9]+$/u;

/** J262 (SP1a): which author preparation a cook goes by. `current`: recorded on this renderer fingerprint, the fast path.
 *  `stale`: recorded on another one and used as it is (fence, fence policy, recorded programs): a stale list costs link
 *  hitches after control, never a wrong frame, and nobody re-uploads. `none`: no author preparation (no preparation spec),
 *  or a capture-only open. SHARD-COMPAT PR4 (J487): preparation spec 4 names no renderer, so any engine that reads the spec
 *  takes it as `current`; only spec 3 still compares the renderer fingerprint. A cook preparation made for this renderer
 *  (SP1b2): `cook`, the author's was stale and a cook preparation sidecar recorded on this renderer stood in for it. */
export type PreparationState = 'current' | 'stale' | 'cook' | 'none';
/** The line every entry point prints for a cook that took the stale path, so `grep 'stale preparation'` finds them all. */
export const stalePreparationLine = (slug: string): string => `stale preparation: ${slug}`;

/** A shardfile opened from its tarball, every read checked against its index. */
export interface OpenShardfile {
  readonly preparationOnly?: boolean;
  readonly preparation: PreparationState;
  readonly slug: string;
  readonly index: OutputIndex;
  readonly source: Shardfile;
  readonly sections: ReadonlyMap<string, unknown>;
  readonly cook: CookData | undefined;
  readonly header: Uint8Array;
  readonly read: (path: string) => Uint8Array;
}

/** This engine's renderer fingerprint, once per process: hashing the client inputs costs a git listing. A host that can't
 *  compute it (no checkout, no stamp) cooks anyway; it just can't call any preparation `current`. */
let ownRenderer: string | null | undefined;
function engineRenderer(): string | null {
  if (ownRenderer === undefined) { try { ownRenderer = rendererRevision(); } catch { ownRenderer = null; } }
  return ownRenderer;
}

function parsedCook(bytes: Uint8Array, slug: string): CookData {
  try { return readCookData(JSON.parse(new TextDecoder().decode(bytes))); }
  catch (cause) { throw new Error(`Invalid cook preparation for ${slug}: run wildshard prepare <product-dir> --base <exact-preview-url>`, {cause}); }
}
export function openShardfile(tarball: Uint8Array, options: Readonly<{preparationOnly?: boolean; renderer?: string; sidecar?: CookSidecar; warn?: (line: string) => void}> = {}): OpenShardfile {
  const files = new Map(readTar(tarball));
  const read = (path: string): Uint8Array => { const bytes = files.get(path); if (bytes === undefined) throw new Error(`No ${path} in the shardfile`); return bytes; };
  const header = read('shard.json'), raw: unknown = JSON.parse(new TextDecoder().decode(header)), index = parseOutputIndex(raw);
  checkEngineFloor(index);
  const sections = new Map<string, unknown>();
  for (const row of index.sections) {
    const bytes = read(row.path);
    if (bytes.length !== row.bytes || sha256(bytes) !== row.hash) throw new Error('Spawn section differs from index');
    sections.set(row.name, JSON.parse(new TextDecoder().decode(bytes)));
  }
  const cookBytes = index.cook === undefined ? undefined : files.get(COOK_DATA_PATH);
  if (index.cook !== undefined && cookBytes === undefined) throw new Error(`Missing cook preparation for ${index.identity.slug}: run wildshard prepare <product-dir> --base <exact-preview-url>`);
  if (cookBytes !== undefined && (cookBytes.length !== index.cook?.bytes || sha256(cookBytes) !== index.cook.hash)) {
    throw new Error(`Stale cook preparation bytes for ${index.identity.slug}: run wildshard prepare <product-dir> --base <exact-preview-url>`);
  }
  let cook = cookBytes === undefined ? undefined : parsedCook(cookBytes, index.identity.slug);
  for (const mount of cook?.mounts ?? []) {
    const bytes = files.get(mount.path);
    if (bytes === undefined || bytes.length !== mount.bytes || sha256(bytes) !== mount.hash) throw new Error(`Stale cook preparation mount ${mount.url}: run wildshard prepare <product-dir> --base <exact-preview-url>`);
  }
  let preparation: PreparationState = 'none';
  if (options.preparationOnly !== true) {
    // Checked whole against its own stored renderer and inputs: corrupt or forged preparation still refuses here.
    requireCookPreparation(index, cook, sha256);
    // J262: a renderer move no longer refuses. The cook goes by the author's lists and says so (SP1a).
    if (cook?.version === 3) preparation = cook.renderer === (options.renderer ?? engineRenderer()) ? 'current' : 'stale';
    if (cook?.version === 4) preparation = 'current';
    if (preparation === 'stale' && cook !== undefined && options.sidecar !== undefined) {
      const outcome = judgeSidecar(options.sidecar, cook, options.renderer ?? engineRenderer(), {index, read: path => files.get(path), hash: sha256});
      if (outcome.kind === 'hit') {
        for (const [path, bytes] of outcome.mounts) files.set(path, bytes);
        cook = outcome.cook; preparation = 'cook';
      } else options.warn?.(sidecarRefusedLine(index.identity.slug, outcome));
    }
  }
  return {slug: index.identity.slug, index, source: assembleOutputShardfile(raw, sections), sections, cook, header, read, preparationOnly: options.preparationOnly === true, preparation};
}

/** Each string's first place in the sections (`world/scenes:libraries.24.tiles.0.files.3.file`), in section order: a
 * blob with no name keeps its part by where a section names it, so an edit that renames it stays put (DL18). */
function namedPlaces(sections: ReadonlyMap<string, unknown>): ReadonlyMap<string, string> {
  const named = new Map<string, string>();
  const walk = (value: unknown, at: string): void => {
    if (typeof value === 'string') { if (!named.has(value)) named.set(value, at); return; }
    if (Array.isArray(value)) { value.forEach((item: unknown, row) => { walk(item, `${at}.${row}`); }); return; }
    if (typeof value === 'object' && value !== null) for (const [key, item] of Object.entries(value)) walk(item, `${at}.${key}`);
  };
  for (const [name, value] of sections) walk(value, `${name}:`);
  return named;
}

/** The mounts a boot's download can list. A shard's recorded programs (`/programs/<slug>.json`) ride in the tarball too, but
 *  a page reads them by their own fetch, so no manifest or part holds them and the cook writes them at their URL. */
const downloaded = (shard: OpenShardfile): readonly CookMount[] => (shard.cook?.mounts ?? []).filter(row => row.url.startsWith('/assets/'));

/** D5: a stale hint costs seconds; it never refuses a cook. A prepared cook (version 2 and up) records its fence as the
 *  content hashes a cold boot read before control; this shard's mounts with those hashes are the fence. FORMAT-PRUNE FP23:
 *  version 1's identity fence (resolved against the sections) is gone: no kept original carries one, and version 1 now
 *  means an unprepared build, which records no fence. */
function fenceHints(shard: OpenShardfile): {readonly hashes: ReadonlySet<string>; readonly mounts: readonly string[]} {
  const reads = shard.cook?.fence;
  if (shard.preparationOnly === true || reads === undefined || shard.cook?.version === 1) return {hashes: new Set(), mounts: []};
  const hashes = new Set(reads);
  return {hashes, mounts: downloaded(shard).filter(row => hashes.has(row.hash)).map(row => row.url)};
}

/** A mount's tier by its name: `.desktop`, `.phone` and a shard's `astc6/` overlay say so, and a file with a `.phone` sibling is the desktop's. */
function mountTiers(urls: ReadonlySet<string>): (url: string, tier: CookTier) => boolean {
  return (url, tier) => {
    if (/\.phone[.-]|\/astc6\//u.test(url)) return tier === 'phone';
    if (/\.desktop[.-]/u.test(url)) return tier === 'desktop';
    const dot = url.lastIndexOf('.');
    return tier === 'desktop' || !urls.has(`${url.slice(0, dot)}.phone${url.slice(dot)}`);
  };
}

export interface ShardHalf {
  readonly shard: OpenShardfile;
  /** The header row, kept loose: it carries the build's validator stamp, so it changes every build (DL18). */
  readonly header: SpawnFile;
  /** The product's rows of one manifest, in manifest order. */
  readonly folderRows: (tier: CookTier, set: CookSet) => readonly SpawnFile[];
  /** The mounts of one manifest. */
  readonly mountRows: (tier: CookTier, set: CookSet) => readonly SpawnFile[];
  readonly read: (url: string) => Uint8Array;
  /** S12d: the phone tier's own files (`phoneTier`), each at its content-named URL; none with the tiers off. */
  readonly tierFiles: readonly SpawnFile[];
  /** The discovery document as this cook serves it (the phone tier's table when the tiers are on), and its row. */
  readonly discovery: {readonly row: SpawnFile; readonly bytes: Uint8Array} | undefined;
  readonly stableKey: (url: string) => string | undefined;
  /** A mount's bytes as this cook serves it: the discovery document carries the phone tier's table (S12b). */
  readonly mountBytes: (row: CookMount) => Uint8Array;
  /** SF15: the KTX2 table this cook serves, as the cooked index carries it (`cookedKtx2Table.ts`). */
  readonly ktx2Table: CookedKtx2Table;
}

/** S12b: what the cook does with a shard's textures per tier. `phone`: give each phone row of the KTX2 table its own
 *  trimmed file (`phoneTier`), listed in the phone manifests in place of the file it stands in for. Off by default until
 *  the cook's own 6×6 encode (S12c) can replace the hand-made sets. `encode` (S12c): cook each phone row from its desktop
 *  master as ASTC 6×6 (`basisuAstc6`), what the phone reads once the hand-made sets are gone. */
export interface CookTiers {readonly phone?: boolean; readonly encode?: Astc6Encode
  /** SF15 (J525): encode every JPG and PNG mount as a desktop UASTC KTX2 (`desktopKtx2`), named in the table; the phone's
   *  6x6 files are then cooked from those. */
  readonly images?: ImageKtx2Encode
  /** S12d: run the encodes a cook will ask for on worker threads first (`wasmAstc6`'s `record` and `flush`; SF15's
   *  `images`, run before them, as the phone's encodes read their output). */
  readonly prepare?: {readonly record: Astc6Encode; readonly flush: () => Promise<void>; readonly images?: {readonly record: ImageKtx2Encode; readonly flush: () => Promise<void>}}}

/** S12d: the phone tier is on by default, 6×6 by basisu's WebAssembly build: no child process, nothing to install, so
 *  the box's cook job and CI's bake cook what `cook --phone-astc6` did. `cacheDir` keeps encodes between cooks; a cook
 *  job passes none (its files can't be relied on by the next job). */
export async function defaultCookTiers(cacheDir?: string): Promise<CookTiers> {
  const lanes = process.env['COOK_CPU_SLOTS'] === undefined ? undefined : Math.max(1, Number(process.env['COOK_CPU_SLOTS']) - 1);
  const options = {...(cacheDir === undefined ? {} : {cacheDir}), ...(lanes === undefined || !Number.isSafeInteger(lanes) ? {} : {lanes})};
  const [astc6, images] = await Promise.all([wasmAstc6(options), wasmImageKtx2(options)]);
  return {phone: true, encode: astc6.encode, images: images.encode, prepare: {record: astc6.record, flush: astc6.flush, images}};
}

/** `shardHalf` with its encodes run in parallel first, when the tiers can. */
export async function preparedShardHalf(shard: OpenShardfile, wireBytes: WireBytes, folder: string, tiers: CookTiers): Promise<ShardHalf> {
  // SF15: the images first, as the phone's 6x6 encodes read the desktop files they make.
  if (tiers.images !== undefined && tiers.prepare?.images !== undefined) {
    shardHalf(shard, () => 0, folder, {images: tiers.prepare.images.record});
    await tiers.prepare.images.flush();
  }
  if (tiers.phone === true && tiers.prepare !== undefined) {
    // Only the encodes' inputs matter here: no file of this pass is sized or kept.
    shardHalf(shard, () => 0, folder, {phone: true, encode: tiers.prepare.record, ...(tiers.images === undefined ? {} : {images: tiers.images})});
    await tiers.prepare.flush();
  }
  return shardHalf(shard, wireBytes, folder, tiers);
}

/** The shard half of every manifest: what the app build's `write` and the standalone cook share. `folder` is where the
 *  product is served; a catalogue names it by slug, and a `_` prototype's folder (`_proto`) differs from its slug (`proto`). */
export function shardHalf(shard: OpenShardfile, wireBytes: WireBytes, folder: string = shard.slug, tiers: CookTiers = {}): ShardHalf {
  const prefix = `/shardfiles/${folder}/`, {index, source, sections} = shard, named = namedPlaces(sections);
  // D5-4: a preparation-only preview lists the default set alone (no stored fence), so `wildshard prepare` sees the boot's
  // own reads beyond it. Listing the whole level there made every recorded fence the whole level (Pine, Nalati).
  const fence = fenceHints(shard), fenceSet = shard.preparationOnly === true || shard.cook?.packs === 'fence';
  // S3: a shard's `fence` set is a phone's recorded reads, so a desktop always lists its whole level.
  const wholeSet = (tier: CookTier, set: CookSet): boolean => set === 'whole' && (!fenceSet || tier === 'desktop');
  const sources = new Map<string, () => Uint8Array>(), stableKeys = new Map<string, string>(), rows = new Map<string, SpawnFile>();
  const folderFile = (path: string, bytes: number, hash: string, name?: string): SpawnFile => {
    const url = CONTENT_NAMED.test(path) ? `${prefix}${path}` : `${prefix}${path}?v=${hash.slice(0, 8)}`;
    const kept = rows.get(url); if (kept !== undefined) return kept;
    const body = shard.read(path);
    if (body.length !== bytes || sha256(body) !== hash) throw new Error('Spawn file differs from index');
    sources.set(url, () => shard.read(path));
    // DL18: an unnamed blob keeps its place by where a section names it (its rewritten version takes the same key).
    const at = name ?? named.get(hash) ?? named.get(path);
    if (at !== undefined) stableKeys.set(url, `${prefix}${at}`);
    const row = {url, bytes, hash, wireBytes: wireBytes(path, body, hash)}; rows.set(url, row); return row;
  };
  const headerHash = sha256(shard.header), headerURL = `${prefix}shard.json?v=${headerHash.slice(0, 8)}`;
  sources.set(headerURL, () => shard.header);
  const header = {url: headerURL, bytes: shard.header.length, hash: headerHash, wireBytes: wireBytes(`${prefix}shard.json`, shard.header, headerHash)};
  // C3: a page reads this before it knows the product, and a cold offline entry reads it too.
  const document = shard.cook?.mounts.find(row => row.url === `${prefix}discovery.json`), mounts = downloaded(shard);
  // S12b: the phone tier's files, made from the KTX2 table's own targets; the discovery document names them.
  const onTier = mountTiers(new Set(mounts.map(row => row.url))), mountByURL = new Map(mounts.map(row => [row.url, row])), mountOf = (url: string): Uint8Array | undefined => { const row = mountByURL.get(url); return row === undefined ? undefined : shard.read(row.path); };
  // SF15: the cook's desktop KTX2 of each image mount, named in the table; a mount row may keep its image (`keepImage`).
  const images = tiers.images !== undefined && document !== undefined ? desktopKtx2(shard.read(document.path), mounts.map(row => ({url: row.url, read: () => shard.read(row.path), ...(Reflect.get(row, 'keepImage') === true ? {keepImage: true} : {})})), tiers.images) : undefined;
  // SF16: the cook's KTX2 of each image blob a texture rule names (material maps, prop slots, splat layers), named in the table.
  const imageBytes = images?.discovery ?? (document === undefined ? undefined : shard.read(document.path));
  const blobs = tiers.images !== undefined && imageBytes !== undefined ? blobKtx2(imageBytes, folder, textureBlobs(shard, prefix), tiers.images) : undefined;
  const cooked = new Map([...images?.files ?? [], ...blobs?.files.values() ?? []].map(file => [file.url, file.bytes]));
  const ownBytes = blobs?.discovery ?? imageBytes;
  const phone = tiers.phone === true && ownBytes !== undefined ? phoneTier(ownBytes, url => cooked.get(url) ?? mountOf(url), undefined, tiers.encode) : undefined;
  const tieredBytes = phone?.discovery ?? ownBytes;
  // S12f2b1: a splat ground's own phone layers (product blobs) get 6×6 files too, named in the same table
  const layers = tiers.phone === true && tiers.encode !== undefined && tieredBytes !== undefined ? splatPhoneTier(tieredBytes, folder, splatPhoneLayers(shard, prefix), tiers.encode) : undefined;
  const documentBytes = layers?.discovery ?? tieredBytes;
  const discovery: readonly SpawnFile[] = document === undefined || documentBytes === undefined ? [] : [(() => {
    const hash = images === undefined && blobs === undefined && phone === undefined && layers === undefined ? document.hash : sha256(documentBytes);
    return {url: `${document.url}?v=${hash.slice(0, 8)}`, bytes: documentBytes.length, hash, wireBytes: wireBytes(document.url, documentBytes, hash)};
  })()];
  for (const row of discovery) if (documentBytes !== undefined) sources.set(row.url, () => documentBytes);
  const mountRow = new Map(mounts.map(row => {
    const url = CONTENT_NAMED.test(row.url) || /-[a-f0-9]{8}\.[a-z0-9]+$/u.test(row.url) ? row.url : `${row.url}?v=${row.hash.slice(0, 8)}`;
    sources.set(url, () => shard.read(row.path));
    return [row.url, () => ({url, bytes: row.bytes, hash: row.hash, wireBytes: wireBytes(row.url, shard.read(row.path), row.hash)})] as const;
  }));
  const tierRows = new Map([...phone?.files ?? []].map(([from, files]) => [from, files.map(file => {
    const hash = sha256(file.bytes);
    sources.set(file.url, () => file.bytes);
    return {url: file.url, bytes: file.bytes.length, hash, wireBytes: wireBytes(file.url, file.bytes, hash)};
  })]));
  // S12f2b1: the phone lists each cooked layer as a mount (the page reads it by URL) and never its blob
  const layerRows = new Map([...layers?.files ?? []].map(([hash, file]) => {
    const sum = sha256(file.bytes);
    sources.set(file.url, () => file.bytes);
    return [hash, {url: file.url, bytes: file.bytes.length, hash: sum, wireBytes: wireBytes(file.url, file.bytes, sum)}] as const;
  }));
  // SF15: the cook's desktop files; a phone reads one only where the phone tier made no 6x6 file of it.
  const cookedRows = new Map([...cooked].map(([url, bytes]) => {
    const hash = sha256(bytes);
    sources.set(url, () => bytes);
    return [url, {url, bytes: bytes.length, hash, wireBytes: wireBytes(url, bytes, hash)}] as const;
  }));
  /** A phone list names each trimmed target's phone files in its place, and the target too while a kept row still reads it. SF15:
   *  an image mount brings its cooked files, the desktop's KTX2 on the desktop and the phone's 6x6 files on the phone. */
  const tiered = (tier: CookTier, url: string): readonly string[] => {
    if (tier === 'desktop') return [url, ...(images?.desktopTargets.get(url) ?? []).map(target => `cooked:${target}`)];
    const own = !tierRows.has(url) ? [url] : phone?.kept.has(url) === true ? [url, `tier:${url}`] : [`tier:${url}`];
    return [...own, ...(images?.phoneTargets.get(url) ?? []).map(target => (tierRows.has(target) ? `tier:${target}` : `cooked:${target}`))];
  };
  /** SF16: the cooked files of the texture blobs a set reads (every one for a whole set): the desktop's KTX2, or the phone's 6x6. */
  const blobRows = (tier: CookTier, hashes: ReadonlySet<string> | undefined): SpawnFile[] => {
    const out: SpawnFile[] = [];
    for (const [hash, file] of blobs?.files ?? []) {
      if (hashes !== undefined && !hashes.has(hash)) continue;
      const cookedRow = cookedRows.get(file.url);
      if (tier === 'phone' && tierRows.has(file.url)) {
        out.push(...tierRows.get(file.url) ?? []);
        if (phone?.kept.has(file.url) === true && cookedRow !== undefined) out.push(cookedRow);
      } else if (cookedRow !== undefined) out.push(cookedRow);
    }
    return out;
  };
  const ktx2Table = documentBytes === undefined ? EMPTY_COOKED_KTX2_TABLE : cookedKtx2TableOf(JSON.parse(new TextDecoder().decode(documentBytes)));
  return {shard, header, ktx2Table, tierFiles: [...cookedRows.values(), ...[...tierRows.values()].flat(), ...layerRows.values()], discovery: discovery[0] === undefined || documentBytes === undefined ? undefined : {row: discovery[0], bytes: documentBytes},
    read: url => { const read = sources.get(url); if (read === undefined) throw new Error(`Spawn file has no source: ${url}`); return read(); },
    stableKey: url => stableKeys.get(url),
    mountBytes: row => (row.url === document?.url && documentBytes !== undefined ? documentBytes : shard.read(row.path)),
    folderRows: (tier, set) => {
      const selected: SpawnFile[] = [header, ...discovery];
      for (const row of index.sections) selected.push(folderFile(row.path, row.bytes, row.hash, `section:${row.name}`));
      for (const row of index.schemas ?? []) selected.push(folderFile(row.path, row.bytes, row.hash, `schema:${row.path}`));
      const wanted = entryReadSet(source, tier, index, sections, wholeSet(tier, set), fence.hashes);
      for (const row of index.files) if ((wanted.has(row.hash) || row.name?.startsWith('ui/images/card-') === true) && (tier !== 'phone' || !layerRows.has(row.hash))) selected.push(folderFile(row.path, row.compressed, row.hash, row.name));
      return selected;
    },
    mountRows: (tier, set) => {
      const urls = wholeSet(tier, set) ? mounts.map(row => row.url).filter(url => onTier(url, tier)) : fence.mounts;
      // A phone file whose target no phone list names (a fence shard's file read past its fence) rides in the phone's whole
      // set: no other tier's part holds it, and it costs less than the target a phone read from a desktop part before.
      const listed = new Set([...urls, ...urls.flatMap(url => images?.phoneTargets.get(url) ?? [])]), unlisted = tier === 'phone' && set === 'whole' ? [...tierRows.keys()].filter(url => !listed.has(url)).map(url => `tier:${url}`) : [];
      return [...[...urls.flatMap(url => tiered(tier, url)), ...unlisted].flatMap(url => {
        if (url.startsWith('tier:')) return tierRows.get(url.slice(5)) ?? [];
        if (url.startsWith('cooked:')) { const row = cookedRows.get(url.slice(7)); return row === undefined ? [] : [row]; }
        const row = mountRow.get(url); return row === undefined ? [] : [row()];
      }), ...tier === 'phone' ? layerRows.values() : [], ...blobRows(tier, wholeSet(tier, set) ? undefined : fence.hashes)];
    }};
}

/** SF16: each PNG or JPEG product blob a texture rule names, with how the page samples it (`blobTextureUses`). */
function textureBlobs(shard: OpenShardfile, prefix: string): readonly TextureBlob[] {
  const uses = blobTextureUses(shard.source.look, shard.source.props);
  return shard.index.files.flatMap(row => {
    const use = uses.get(row.hash);
    return use === undefined || row.kind !== 'image' || row.commons === true ? [] : [{hash: row.hash, url: `${prefix}${row.path}`, bytes: shard.read(row.path), use}];
  });
}

/** S12f2b1: the splat ground's phone colour and normal layers (`splat.phone`), as product blobs; a file the desktop set names
 *  too (Pine's phone masters are its desktop layers) is one a phone reads cooked and a desktop reads as it is. Its ARM
 *  layers stay as they are, as the hand-made 6×6 set had them. */
function splatPhoneLayers(shard: OpenShardfile, prefix: string): readonly SplatPhoneLayer[] {
  const splat = shard.source.props === null ? undefined : splatTerrainOf(shard.source.props);
  if (splat?.phone === undefined) return [];
  const byHash = new Map(shard.index.files.map(row => [row.hash, row]));
  return (['colour', 'normal'] as const).flatMap(role => [...new Set(splat.phone?.[role])].flatMap(hash => {
    const row = byHash.get(hash);
    return row === undefined || !row.path.endsWith('.ktx2') ? [] : [{hash, url: `${prefix}${row.path}`, bytes: shard.read(row.path), role}];
  }));
}

/** Cook the parts of a set of manifests and say where each packable URL landed, for the app build's own parts table. */
export async function cookParts(out: string, half: ShardHalf, tables: readonly {readonly tier: CookTier; readonly rows: readonly SpawnFile[]}[], encoder: PartEncoder): Promise<ReadonlyMap<string, CookedMember>> {
  const parts = await writeSpawnParts(out, tables.map(row => ({rows: row.rows, public: row.tier === 'phone', desktop: row.tier === 'desktop'})), half.read, half.stableKey, encoder);
  const placed = new Map<string, CookedMember>();
  parts.forEach((table, at) => {
    const rows = tables[at]?.rows ?? [];
    for (const part of table) for (const [member, offset] of part.members) {
      const row = rows[member]; if (row !== undefined) placed.set(row.url, {url: part.url, bytes: part.bytes, hash: part.hash, offset, wireBytes: part.wireBytes ?? 0});
    }
  });
  return placed;
}

interface ServerRow {readonly path: string; readonly hash: string; readonly bytes: number; readonly name?: string | undefined}
/** C2: a part of what the page can also read stays this small, so one file a page can't lend costs a few files, not a level. */
export const SERVER_PART_BYTES = 2_000_000;

/** What a server reads of a shard, in a product's own layout: everything but what only a page draws. */
export function serverRows(shard: OpenShardfile): readonly ServerRow[] {
  const {index, source} = shard, rows = new Map<string, ServerRow>();
  const add = (row: ServerRow): void => { if (!rows.has(row.path)) rows.set(row.path, row); };
  add({path: 'shard.json', hash: sha256(shard.header), bytes: shard.header.length});
  for (const row of [...index.sections, ...index.schemas ?? [], ...index.admission.server ?? []]) add({path: row.path, hash: row.hash, bytes: row.bytes});
  const rigs = serverSkinRigs(source); // AP36c: a spawned creature's skin rig, for its hit volumes and height
  for (const row of index.files) if (serverReadsFile(row, source.terrain?.collider) || rigs.has(row.commons === true ? `commons:${row.hash}` : row.hash)) add({path: row.path, hash: row.hash, bytes: row.compressed, name: row.name});
  return [...rows.values()];
}

/** Cut rows into parts in name order, so files a system reads together tend to land together. */
function serverParts(rows: readonly ServerRow[]): readonly (readonly ServerRow[])[] {
  const parts: ServerRow[][] = [];
  let bytes = 0;
  for (const row of [...rows].sort((left, right) => (left.name ?? left.path) < (right.name ?? right.path) ? -1 : 1)) {
    const open = parts.at(-1);
    if (open === undefined || bytes + row.bytes > SERVER_PART_BYTES) { parts.push([row]); bytes = row.bytes; }
    else { open.push(row); bytes += row.bytes; }
  }
  return parts;
}

/** C2: all a shard's server reads, so a host needs nothing else. The class leads, as no page holds it; the rest are files
 *  a page mostly holds too, which the worker asks it for first. */
export async function cookServerRows(rows: readonly ServerRow[], serverClass: ReadonlySet<string>, read: (path: string) => Uint8Array, out: string, encoder: PartEncoder): Promise<ServerPack> {
  const groups = [rows.filter(row => serverClass.has(row.path)), ...serverParts(rows.filter(row => !serverClass.has(row.path)))];
  const cooked: ServerPackPart[] = [];
  for (const group of groups) { const part = await cookServerPack(group, read, out, encoder); if (part !== undefined) cooked.push(part); }
  const [first, ...more] = cooked;
  if (first === undefined) throw new Error('A server pack needs a file');
  return more.length === 0 ? first : {...first, more};
}
export const cookShardServerPack = (shard: OpenShardfile, out: string, encoder: PartEncoder): Promise<ServerPack> =>
  cookServerRows(serverRows(shard), new Set((shard.index.admission.server ?? []).map(row => row.path)), shard.read, out, encoder);

/** C2: one part of a server pack, in its own folder: the download gates tell a server's reads from a page's by path. No
 *  rows, no part. */
export async function cookServerPack(rows: readonly {readonly path: string; readonly hash: string; readonly bytes: number}[], read: (path: string) => Uint8Array, out: string, encoder: PartEncoder): Promise<ServerPackPart | undefined> {
  if (rows.length === 0) return undefined;
  const align = (at: number): number => Math.ceil(at / SPAWN_PART_ALIGN) * SPAWN_PART_ALIGN;
  const sorted = [...rows].sort((left, right) => left.path < right.path ? -1 : 1);
  const length = sorted.reduce((at, row) => align(at) + row.bytes, 0), body = new Uint8Array(length), files: [string, number, number][] = [];
  let cursor = 0;
  for (const row of sorted) {
    const bytes = read(row.path);
    if (bytes.length !== row.bytes || sha256(bytes) !== row.hash) throw new Error('Server file differs from its index');
    cursor = align(cursor); body.set(bytes, cursor); files.push([row.path, cursor, bytes.length]); cursor += bytes.length;
  }
  const hash = sha256(body), wire = await encoder.encode(body, hash), url = `/assets/spawn/server/${hash.slice(0, 16)}.pack.br`;
  mkdirSync(join(out, 'assets/spawn/server'), {recursive: true}); writeFileSync(join(out, url.slice(1)), wire);
  return {url, bytes: body.length, hash, wireBytes: wire.length, files};
}

export interface CookReport {
  readonly slug: string;
  /** J262: which author preparation this cook went by. */
  readonly preparation: PreparationState;
  readonly seconds: number;
  readonly manifests: readonly {readonly url: string; readonly tier: CookTier; readonly set: CookSet; readonly files: number; readonly totalBytes: number; readonly wireBytes: number}[];
  readonly loose: readonly string[];
  readonly parts: {readonly count: number; readonly rawBytes: number; readonly wireBytes: number};
  readonly server: {readonly url: string; readonly index: string; readonly wireBytes: number; readonly files: number};
  /** SF15: the KTX2 table this cook serves, for the cooked index (`cookedKtx2Table.ts`). */
  readonly ktx2: CookedKtx2Table;
  /** J450: the top-down map the cook drew (`cookedMap.ts`), at `cookedMapPath`. */
  readonly map: {readonly full: number; readonly cell: number; readonly drawn: MapDrawn} & CookedMapStats;
}

export type CookShardPhase = 'textures' | 'client-packs' | 'server-packs';

export interface CookShardOptions {
  readonly wireBytes: WireBytes;
  readonly now: () => number;
  readonly encoder?: PartEncoder;
  readonly warn?: (line: string) => void;
  readonly onPhase?: (phase: CookShardPhase) => void;
  readonly versionedOutput?: boolean;
  /** The renderer fingerprint to cook for; this engine's own unless a build names it. */
  readonly renderer?: string;
  /** S12b: per-tier texture files; `defaultCookTiers()` (the phone tier, 6×6) unless a cook names its own. `{}` turns them off. */
  readonly tiers?: CookTiers;
  /** SP1b2: a cook preparation recorded on this renderer, taken in place of a stale author preparation. */
  readonly sidecar?: CookSidecar;
}

/** `cook <shardfile> → <packs>`: the shard's half of every manifest, its parts, and its loose mounts at their URLs. */
export async function cookShard(tarball: Uint8Array, out: string, options: CookShardOptions): Promise<CookReport> {
  if (options.encoder !== undefined) return cookWith(tarball, out, options, options.encoder);
  // An encoder this cook made is this cook's to close: a cache miss starts its workers, and an idle worker keeps the process alive.
  const encoder = createPartEncoder();
  try { return await cookWith(tarball, out, options, encoder); } finally { await encoder.close(); }
}

async function cookWith(tarball: Uint8Array, out: string, options: CookShardOptions, encoder: PartEncoder): Promise<CookReport> {
  options.onPhase?.('textures');
  const opened = {...(options.renderer === undefined ? {} : {renderer: options.renderer}), ...(options.sidecar === undefined ? {} : {sidecar: options.sidecar}), ...(options.warn === undefined ? {} : {warn: options.warn})};
  const started = options.now(), shard = openShardfile(tarball, opened);
  if (shard.preparation === 'stale') options.warn?.(stalePreparationLine(shard.slug));
  if (shard.preparation === 'cook') options.warn?.(cookPreparedLine(shard.slug));
  const half = await preparedShardHalf(shard, options.wireBytes, shard.slug, options.tiers ?? await defaultCookTiers());
  options.onPhase?.('client-packs');
  const before = encoder.stats();
  const table = COOK_TIERS.flatMap(tier => COOK_SETS.map(set => ({tier, set, rows: [...half.folderRows(tier, set), ...half.mountRows(tier, set)]})));
  const whole = table.filter(row => row.set === 'whole');
  // The title needs the UI images' URLs before it has a fetch layer.
  const ui = new Set(options.versionedOutput === true
    ? half.shard.index.files.filter(row => row.name?.startsWith('ui/images/') === true).map(row => row.hash)
    : []);
  const parts = await writeSpawnParts(out, whole.map(row => ({rows: row.rows, public: row.tier === 'phone', looseHashes: ui})), half.read, half.stableKey, encoder);
  const after = encoder.stats(), manifests: CookReport['manifests'][number][] = [];
  mkdirSync(join(out, 'assets/spawn'), {recursive: true});
  for (const row of table) {
    const at = whole.indexOf(row), partRows: readonly SpawnPart[] | undefined = at === -1 ? undefined : parts[at];
    const totalBytes = row.rows.reduce((sum, file) => sum + file.bytes, 0), wire = row.rows.reduce((sum, file) => sum + (file.wireBytes ?? 0), 0);
    const base: Omit<SpawnManifest, 'parts'> = {version: 1, shard: half.shard.slug, tier: row.tier, flow: 'client', files: row.rows, totalBytes, wireBytes: wire};
    const manifest = readSpawnManifest(partRows === undefined ? base : {...base, parts: partRows}), text = JSON.stringify(manifest);
    const name = `assets/spawn/${half.shard.slug}-${row.set}-${row.tier}-${sha256(new TextEncoder().encode(text)).slice(0, 16)}.json`;
    writeFileSync(join(out, name), text);
    manifests.push({url: `/${name}`, tier: row.tier, set: row.set, files: row.rows.length, totalBytes, wireBytes: wire});
  }
  options.onPhase?.('server-packs');
  const server = await cookShardServerPack(half.shard, out, encoder);
  // Content-named, so two revisions of a shard never share a name in the store (J29, J83).
  const serverText = JSON.stringify(server), serverIndex = `assets/spawn/server-${half.shard.slug}-${sha256(new TextEncoder().encode(serverText)).slice(0, 16)}.json`;
  writeFileSync(join(out, serverIndex), serverText);
  // What no part may hold still serves at its URL (DL14: `<img>` and module loads pass any fetch layer).
  const loose = (half.shard.cook?.mounts ?? []).filter(row => !packable(row.url) || !row.url.startsWith('/assets/'));
  for (const row of loose) {
    const file = join(out, row.url.slice(1));
    mkdirSync(dirname(file), {recursive: true}); writeFileSync(file, half.mountBytes(row));
  }
  // C3: a title or menu `<img>` reads a shard's images by the URLs its level manifest names, before any fetch layer exists.
  const images = half.shard.index.files.flatMap(row => row.name?.startsWith('ui/images/') === true ? [row.path] : []);
  // SHARD-SOURCE SA48: a file no whole set holds (a lazy GLB the entry read set never reaches) is still read at its
  // product URL, as an app build serves its whole shard file folder; without it a placed slug's page waits on a 404.
  // Per tier: a file one tier's whole set lacks (a phone fence) is that tier's 404 too, so it goes loose.
  const packed = whole.map(row => new Set(row.rows.map(file => file.hash)));
  const unpacked = half.shard.index.files.flatMap(row => packed.every(set => set.has(row.hash)) || row.name?.startsWith('ui/images/') === true ? [] : [row.path]);
  for (const path of [...images, ...unpacked]) {
    const file = join(out, 'shardfiles', half.shard.slug, path);
    mkdirSync(dirname(file), {recursive: true}); writeFileSync(file, half.shard.read(path));
  }
  // J450: write both maps before the worker can publish the checked upload.
  const map = await writeCookedMap(half.shard, out, options.warn === undefined ? {} : {warn: options.warn});
  return {slug: half.shard.slug, preparation: half.shard.preparation, seconds: (options.now() - started) / 1000, manifests, loose: loose.map(row => row.url), map, ktx2: half.ktx2Table, server: {url: server.url, index: `/${serverIndex}`, wireBytes: [server, ...server.more ?? []].reduce((sum, part) => sum + part.wireBytes, 0), files: [server, ...server.more ?? []].reduce((sum, part) => sum + part.files.length, 0)},
    parts: {count: after.parts - before.parts, rawBytes: after.rawBytes - before.rawBytes, wireBytes: after.wireBytes - before.wireBytes}};
}

/** J450: draw the shard's map from its own world and write both sizes beside its header.
 * The worker publishes them under the upload's loose folder. A failed write leaves the cook unqualified. MAP-NEXT MN5: a render
 * never does; `cookedMapPngs` falls back to the terrain map, then to the plain map with the zone's name (`options` are its seams). */
export async function writeCookedMap(shard: Pick<OpenShardfile, 'slug' | 'index' | 'sections' | 'read'>, out: string, options: Omit<CookedMapOptions, 'name'> = {}): Promise<CookReport['map']> {
  const named: unknown = Reflect.get(shard.index.identity, 'name');
  const name = typeof named === 'string' && named.trim() !== '' ? named : shard.slug.replace(/^_/u, '').replaceAll('-', ' ');
  const {full, cell, stats} = await cookedMapPngs({files: shard.index.files, sections: shard.sections, read: shard.read}, undefined, {...options, name});
  for (const [path, bytes] of [[cookedMapPath(shard.slug, 'full'), full], [cookedMapPath(shard.slug, 'cell'), cell]] as const) {
    const file = join(out, path);
    mkdirSync(dirname(file), {recursive: true});
    writeFileSync(file, bytes);
  }
  return {full: full.length, cell: cell.length, ...stats};
}
