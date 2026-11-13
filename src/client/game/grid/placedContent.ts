// SHARD-AUTHORING SA48 (meta SHARD-AUTHORING-PLAN): the content of a shard the API placed after this page was built. SA46 cards it, but
// entering reads its client product from the build's spawn rows, which no build has for a new author's upload. The cook does (MMO-SERVER
// MS2.4): for this build and the bytes the signed placement file names (`hash`, SA47 (1)) it writes `index/<build>/<hash>.json` beside
// its manifests, parts and header in the packs store. This reads that index and each manifest it names, and gives the rows a bake's
// `addCookedShards` would have written (the entry and whole-level addresses, the store as their home, whether it recorded programs),
// with the page's admission row for its header (`productVerdict`'s, believed only under this page's own validator revision). Any
// failure (no index yet, a 404, junk, another build's or slug's index, another validator) gives nothing, and the slug stays out.
import * as v from 'valibot';
import { bareSlug } from '../../../shared/game/grid/catalogueSlot';
import { readSpawnManifest, readSpawnManifestAddress, type SpawnManifestAddress } from '../../../shared/game/shardfile/spawnManifest';
import { cookIndexPath } from '../../../shared/game/shardfile/serverPack';
import { installPlacedSpawn, type PlacedSpawn } from '../boot/placedSpawn';

/** An index is a few KB; a manifest is at most `readSpawnManifestAddress`'s 2 MB. */
const INDEX_BYTES = 256 * 1024, MANIFEST_BYTES = 2_000_000;
const size = v.pipe(v.number(), v.safeInteger(), v.minValue(0));
const hex = v.pipe(v.string(), v.regex(/^[a-f0-9]{64}$/u));
const ManifestRow = v.object({ url: v.pipe(v.string(), v.regex(/^\/assets\/spawn\/[a-z0-9_-]+-(?:entry|whole)-(?:phone|desktop)-[a-f0-9]{16}\.json$/u)),
  tier: v.picklist(['phone', 'desktop']), set: v.picklist(['entry', 'whole']), files: size, totalBytes: size, wireBytes: size });
const IndexSchema = v.object({ version: v.literal(1), build: v.string(), slug: v.pipe(v.string(), v.regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u)), hash: hex, header: v.string(),
  manifests: v.pipe(v.array(ManifestRow), v.maxLength(8)), keys: v.pipe(v.array(v.string()), v.maxLength(100_000)), loose: v.string(),
  verdict: v.optional(v.looseObject({ revision: hex, sourceHash: v.string(), indexHash: hex, residentBytes: v.pipe(v.number(), v.safeInteger(), v.minValue(1)),
    postCost: v.looseObject({}), worst: v.optional(v.unknown()) })) });

/** What a placed slug needs to enter: its spawn rows and its header's admission row. */
export interface PlacedContent { readonly spawn: PlacedSpawn; readonly verdict: Readonly<Record<string, unknown>> | null }
export interface PlacedContentPorts {
  readonly fetch: typeof fetch;
  readonly signal: AbortSignal;
  /** The store's root: the placement file's origin (`https://packs.wildshard.io/`), where the cook writes. */
  readonly packs: string;
  /** This page's build (`__BUILD_ID__`), the cook's folder. */
  readonly build: string;
  /** This page's validator revision (`__WS_SHARDFILE_VALIDATOR__`); null on a page with none (the dev server), which admits by no row. */
  readonly validator: string | null;
}

async function bounded(response: Response, cap: number): Promise<Uint8Array<ArrayBuffer>> {
  if (!response.ok) { await response.body?.cancel(); throw new Error(`HTTP ${String(response.status)}`); }
  const body = new Uint8Array(await response.arrayBuffer());
  if (body.byteLength > cap) throw new Error('Too large');
  return body;
}
const decode = (bytes: Uint8Array): unknown => JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));

/** The cook's content for `slug` at `hash`, or undefined for anything but this build's index of these bytes. Never throws. */
export async function placedContent(slug: string, hash: string, ports: PlacedContentPorts): Promise<PlacedContent | undefined> {
  try {
    if (!/^[a-f0-9]{64}$/u.test(hash) || !/^[\w.-]{1,64}$/u.test(ports.build) || !ports.packs.endsWith('/')) return undefined;
    const read = ports.fetch, at = (path: string): string => new URL(path.replace(/^\//u, ''), ports.packs).href;
    // past the CDN's cached 404 (a query of its own, as the box reads it, SA47): an index missing now may be written a minute later
    // (to the minute, so the edge still takes a busy page's repeats)
    const indexAt = `${at(cookIndexPath(ports.build, hash))}?t=${String(Math.floor(Date.now() / 60_000))}`;
    const index = v.parse(IndexSchema, decode(await bounded(await read(indexAt, { cache: 'no-store', credentials: 'omit', redirect: 'error', signal: ports.signal }), INDEX_BYTES)));
    const product = index.slug;
    if (index.build !== ports.build || index.hash !== hash || product !== bareSlug(slug) || index.header !== `shardfiles/${product}/shard.json`
      || index.loose !== `loose/${hash}/`) return undefined;
    // a page that checks admission admits only a header its own validator's revision passed; a page with none asks nothing
    if (ports.validator !== null && index.verdict?.revision !== ports.validator) return undefined;
    // each manifest's own length is its address's (`readSpawnManifestAddress`); it is content-named, so this read is the download's
    const addresses = await Promise.all(index.manifests.map(async row => {
      const body = await bounded(await read(at(row.url), { credentials: 'omit', redirect: 'error', signal: ports.signal }), MANIFEST_BYTES);
      const manifest = readSpawnManifest(decode(body));
      if (manifest.shard !== product || manifest.tier !== row.tier || manifest.files.length !== row.files || manifest.totalBytes !== row.totalBytes) throw new Error(`${row.url} is not its row`);
      return { row, address: readSpawnManifestAddress({ url: row.url, bytes: body.byteLength, totalBytes: row.totalBytes, files: row.files, wireBytes: row.wireBytes }) };
    }));
    const pick = (set: 'entry' | 'whole'): Partial<Record<'phone' | 'desktop', SpawnManifestAddress>> =>
      Object.fromEntries(addresses.filter(({ row }) => row.set === set).map(({ row, address }) => [row.tier, address]));
    const entry = pick('entry');
    if (entry.phone === undefined || entry.desktop === undefined) return undefined;
    const verdict = index.verdict === undefined ? null : { ...index.verdict, path: `/${index.header}` };
    return { spawn: { slug: product, entry, whole: pick('whole'), base: ports.packs, loose: at(index.loose),
      programs: index.keys.includes(`${index.loose}programs/${product}.json`) }, verdict };
  } catch { return undefined; }
}

/** Make a placed slug's content this page's: its spawn rows for the download, and its admission row beside the build's own. */
export function installPlacedContent(content: PlacedContent): void {
  installPlacedSpawn(content.spawn);
  const verdicts: unknown = Reflect.get(globalThis, '__WS_SHARDFILE_VERDICTS__');
  if (content.verdict === null || !Array.isArray(verdicts)) return;
  // one row a path: a later learn of another upload replaces this page's earlier one (the build's own paths are never placed slugs)
  const at = verdicts.findIndex((row: unknown) => typeof row === 'object' && row !== null && Reflect.get(row, 'path') === content.verdict?.['path']);
  if (at === -1) verdicts.push(content.verdict); else verdicts.splice(at, 1, content.verdict);
}
