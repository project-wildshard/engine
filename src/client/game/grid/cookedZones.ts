import type {CookedPartMember} from '@wildshard/engine/boot/tables';
// Fix preview PV4 (meta docs/plans/MULTI-REPO-SAGA/2026-11-26-opus-fix-preview-PLAN.md; Jake, 2026-11-26: "preview should be getting the
// cooked packs from R2"): a page that bakes a zone table (PV2, `zoneTable.ts`) loads every zone from the cook. Each zone's index is read
// at `cooked.wildshard.io/<the table's key>` and checked against the table's row (slug, shard version, cook version, cook hash), never
// the page's own build (today's `placedContent.ts` `index.build` check): preview takes staging's cook. Its `objects` table, page path
// to object key under PV24's `common/` or `cooks/<cookVersion>/`, is installed in the content resolver (`contentBase.ts`), so the
// download, the title and the runtime keep their page paths and read the bytes where the cook stored them. Its manifests become the
// zone's spawn rows, as SA48 does for a placed slug. Anything else (no index, a 404, junk, another zone's index) gives nothing, and the
// zone's entry reports it (`COOKED_ZONE_MISSING`) for PV11's "Wildshard was updated" card instead of a silent 404.
import * as v from 'valibot';
import { installCookedMembers, installCookedObjects } from '@wildshard/engine/boot/contentBase';
import { readSpawnManifest, readSpawnManifestAddress, type SpawnManifestAddress } from '../../../shared/game/shardfile/spawnManifest';
import { COOKED_ORIGIN, cookedIndexKey, cookedMemberAddresses, cookedObjectKey, readCookedIndexAddress, type CookedShardRef } from '../../../shared/game/shardfile/cookedPackPaths';
import { cookedMapPath } from '../../../shared/game/shardfile/cookedMapPath';
import { readZoneTable, ZONE_TABLE_ELEMENT_ID, zoneRef, type ZoneTable, type ZoneTableRow } from '../../../shared/game/grid/zoneTable';
import { installPlacedContent, type PlacedContent, type PlacedHero } from './placedContent';

const INDEX_BYTES = 4 * 1024 * 1024, MANIFEST_BYTES = 2_000_000, DISCOVERY_BYTES = 256 * 1024;
const size = v.pipe(v.number(), v.safeInteger(), v.minValue(0));
const ManifestRow = v.object({ url: v.pipe(v.string(), v.regex(/^\/assets\/spawn\/[a-z0-9_-]+-(?:entry|whole)-(?:phone|desktop)-[a-f0-9]{16}\.json$/u)),
  tier: v.picklist(['phone', 'desktop']), set: v.picklist(['entry', 'whole']), files: size, totalBytes: size, wireBytes: size,
  code: v.optional(v.object({ url: v.string(), bytes: size })) });
/** What the page reads of a cooked index beyond its address (`readCookedIndexAddress`): its manifests, header and admission row. */
const IndexRest = v.object({ header: v.string(), manifests: v.pipe(v.array(ManifestRow), v.maxLength(8)),
  verdict: v.optional(v.looseObject({ revision: v.string() })) });
const DiscoveryCard = v.object({ data: v.object({ card: v.object({ thumb: v.string(), portrait: v.string(), landscape: v.string() }) }) });

/** The event a zone's entry dispatches when its cooked content is missing (PV11 owns the card it shows). */
export const COOKED_ZONE_MISSING = 'wildshard:cooked-zone-missing';

export interface CookedZonePorts {
  readonly fetch: typeof fetch;
  readonly signal: AbortSignal;
  /** The cooked bucket's origin (default `COOKED_ORIGIN`); a test serves its own. */
  readonly origin?: string;
  /** This page's validator revision; null admits by no row (as `placedContent.ts`). */
  readonly validator: string | null;
}
export interface CookedZone {
  readonly content: PlacedContent;
  /** Page path (leading `/`) to the absolute URL that holds it. */
  readonly objects: ReadonlyMap<string, string>;
  readonly members: readonly (readonly [string, CookedPartMember])[];
}

async function bounded(response: Response, cap: number): Promise<ArrayBuffer> {
  if (!response.ok) { await response.body?.cancel(); throw new Error(`HTTP ${String(response.status)}`); }
  const body = await response.arrayBuffer();
  if (body.byteLength > cap) throw new Error('Too large');
  return body;
}
const decode = (bytes: ArrayBuffer): unknown => JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
/** One cooked identity is another's when both name the same index key. */
const same = (a: CookedShardRef, b: CookedShardRef): boolean => cookedIndexKey(a) === cookedIndexKey(b);

/** The table a page carries inline (`#ws-zone-table`), or undefined for a page with none. Throws on a broken one. */
export function bakedZoneTable(root: Pick<Document, 'getElementById'> = document): ZoneTable | undefined {
  const text = root.getElementById(ZONE_TABLE_ELEMENT_ID)?.textContent;
  return text === undefined || text === null || text === '' ? undefined : readZoneTable(JSON.parse(text));
}

/** One zone's cooked content, or undefined for anything but the table's own index of it. Never throws. */
export async function cookedZone(table: ZoneTable, row: ZoneTableRow, ports: CookedZonePorts): Promise<CookedZone | undefined> {
  try {
    const ref = zoneRef(table, row), product = row.slug, at = (key: string): string => new URL(key, ports.origin ?? table.origin ?? COOKED_ORIGIN).href;
    // a detached call: `ports.fetch(…)` would run the browser's fetch with `ports` as its receiver (Illegal invocation)
    const read = ports.fetch, init: RequestInit = { credentials: 'omit', redirect: 'error', signal: ports.signal };
    const body = decode(await bounded(await read(at(row.index), init), INDEX_BYTES));
    const address = readCookedIndexAddress(body), rest = v.parse(IndexRest, body);
    if (!same(address, ref)) return undefined;
    if (ports.validator !== null && rest.verdict?.revision !== ports.validator) return undefined;
    const objects = new Map<string, string>();
    for (const path of Object.keys(address.objects)) {
      const key = cookedObjectKey(ref, address.objects, path);
      if (key !== undefined) objects.set(`/${path}`, at(key));
    }
    const object = (path: string): string => {
      const url = objects.get(path);
      if (url === undefined) throw new Error(`${row.slug}'s index maps no ${path}`);
      return url;
    };
    const addresses = await Promise.all(rest.manifests.map(async manifest => {
      const bytes = await bounded(await read(object(manifest.url), init), MANIFEST_BYTES);
      const parsed = readSpawnManifest(decode(bytes));
      // a row with a code list (OF5) counts the code rows the manifest keeps apart: only the shard and tier must agree then
      const whole = manifest.code === undefined && (parsed.files.length !== manifest.files || parsed.totalBytes !== manifest.totalBytes);
      if (parsed.shard !== product || parsed.tier !== manifest.tier || whole || parsed.files.length > manifest.files) throw new Error(`${manifest.url} is not its row`);
      return { manifest, address: readSpawnManifestAddress({ url: manifest.url, bytes: bytes.byteLength, totalBytes: manifest.totalBytes, files: manifest.files, wireBytes: manifest.wireBytes,
        ...(manifest.code === undefined ? {} : { code: manifest.code }) }) };
    }));
    const pick = (set: 'entry' | 'whole'): Partial<Record<'phone' | 'desktop', SpawnManifestAddress>> =>
      Object.fromEntries(addresses.filter(({ manifest }) => manifest.set === set).map(({ manifest, address: picked }) => [manifest.tier, picked]));
    const members = cookedMemberAddresses(address, at);
    const entry = pick('entry');
    if (entry.phone === undefined || entry.desktop === undefined) return undefined;
    const page = new URL('/', location.href).href;
    const card = await cookedCard(row.slug, objects, async url => bounded(await read(url, init), DISCOVERY_BYTES));
    const content: PlacedContent = { spawn: { slug: row.slug, entry, whole: pick('whole'), base: page, loose: page, listed: new Set([...objects.keys(), ...members.map(([path]) => path)]),
      programs: objects.has(`/programs/${row.slug}.json`),
      maps: objects.has(`/${cookedMapPath(row.slug, 'full')}`) && objects.has(`/${cookedMapPath(row.slug, 'cell')}`) },
    verdict: rest.verdict === undefined ? null : { ...rest.verdict, path: `/${rest.header}` }, ...(card === undefined ? {} : { card }) };
    return { content, objects, members };
  } catch { return undefined; }
}

/** HG4: the zone's hero, three images its discovery names and its index maps; undefined for anything less. Never throws. */
async function cookedCard(slug: string, objects: ReadonlyMap<string, string>, read: (url: string) => Promise<ArrayBuffer>): Promise<PlacedHero | undefined> {
  try {
    const discovery = objects.get(`/shardfiles/${slug}/discovery.json`);
    if (discovery === undefined) return undefined;
    const { card } = v.parse(DiscoveryCard, decode(await read(discovery))).data;
    const image = new RegExp(`^/shardfiles/${slug}/blobs/image/[a-f0-9]{64}\\.(?:jpe?g|png|webp)$`, 'u');
    const slot = (url: string): string | undefined => image.test(url) ? objects.get(url) : undefined;
    const thumb = slot(card.thumb), portrait = slot(card.portrait), landscape = slot(card.landscape);
    return thumb === undefined || portrait === undefined || landscape === undefined ? undefined : { thumb, portrait, landscape };
  } catch { return undefined; }
}

export interface CookedZonesRead { readonly installed: readonly string[]; readonly missing: readonly string[] }
/** Every zone of the table, read at once; each one found is installed (its objects, then its spawn rows), each one not is named. */
export async function learnCookedZones(table: ZoneTable, ports: CookedZonePorts): Promise<CookedZonesRead> {
  const read = await Promise.all(table.zones.map(async row => ({ row, zone: await cookedZone(table, row, ports) })));
  const installed: string[] = [], missing: string[] = [];
  for (const { row, zone } of read) {
    if (zone === undefined) { missing.push(row.slug); continue; }
    installCookedObjects(zone.objects);
    installCookedMembers(zone.members);
    installPlacedContent(zone.content);
    installed.push(row.slug);
  }
  if (missing.length > 0 && typeof dispatchEvent === 'function') dispatchEvent(new CustomEvent(COOKED_ZONE_MISSING, { detail: { slugs: missing, cook: `${table.cookVersion}/${table.cookHash.slice(0, 12)}` } }));
  return { installed, missing };
}
