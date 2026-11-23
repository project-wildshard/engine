// oxlint-disable-next-line import/no-nodejs-modules -- The dedicated MMO door's public HTTP route.
import type { IncomingMessage, ServerResponse } from 'node:http';
import * as v from 'valibot';
import { catalogueDocument } from '@wildshard/engine/game/grid/catalogueDocument';
import { offPlayerLists, type ZoneSelectCard, type ZoneSelectDocument } from '@wildshard/engine/game/grid/zoneSelectRows';
import { originAllowed } from './doorTrust';
import type { ZoneEntryTotal } from './saves/zoneEntries';
import { within } from './saves/saveStore';

const PATH = '/zone-select';
const REFRESH_MS = 30_000;
const CATALOGUE_MS = 1_000;
interface Upload {
  readonly slug: string;
  readonly name: string;
  readonly listedNew?: boolean | undefined;
  readonly firstUploadedAt?: string | undefined;
}
const Uploads: v.GenericSchema<{ readonly shards: readonly Upload[] }> = v.object({ shards: v.array(v.object({
  slug: v.string(), name: v.pipe(v.string(), v.trim(), v.maxLength(128)), listedNew: v.optional(v.boolean()),
  firstUploadedAt: v.optional(v.pipe(v.string(), v.isoTimestamp())),
})) });
/** `featured`: the placement file's order (OF31i, world data); without one Featured lists every visible zone by name (OF31i4). */
interface LiveZones { readonly serial: number; readonly slugs: readonly string[]; readonly featured?: readonly string[] | undefined }
interface ZoneSelectOptions {
  readonly channel: ZoneSelectDocument['channel'];
  readonly allowedOrigins: readonly string[] | null;
  readonly world: () => LiveZones;
  readonly uploads: () => Promise<readonly Upload[]>;
  readonly totals: () => Promise<readonly ZoneEntryTotal[]>;
  readonly log: (line: Record<string, unknown>) => void;
}

/**
 * Where the door reads upload metadata (J471: api-server owns it). The box's PLACEMENT_URL is the signed file on
 * packs.wildshard.io, which has no `/api/catalogue` (ZS14: staging logged `Catalogue HTTP 404` and New stayed empty), so
 * only a loopback placement source (a local API in dev) names the catalogue's origin too.
 */
export function zoneCatalogueUrl(placementAt: string | undefined): URL {
  const local = placementAt !== undefined && /^http:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?\//u.test(placementAt);
  return new URL('/api/catalogue', local ? placementAt : 'https://api.wildshard.io');
}

/** Per-upload metadata can be cached independently of room arrivals or channel placement. */
export async function readZoneUploads(at: URL): Promise<readonly Upload[]> {
  const response = await fetch(at, { redirect: 'error', signal: AbortSignal.timeout(CATALOGUE_MS) });
  if (!response.ok) { await response.body?.cancel(); throw new Error(`Catalogue HTTP ${String(response.status)}`); }
  return v.parse(Uploads, await response.json()).shards;
}

const readable = (slug: string): string => slug.split(/[-_]+/u).filter(Boolean)
  .map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');

function cards(slugs: readonly string[], uploads: readonly Upload[], entries: readonly ZoneEntryTotal[]): ZoneSelectCard[] {
  const heads = new Map(uploads.map(row => [row.slug, row]));
  const human = new Map(entries.map(row => [row.slug, row.humans]));
  const catalogue = catalogueDocument();
  const status = new Map(catalogue.placements.map(row => [row.slug, row.status]));
  const names = new Map(catalogue.shards?.map(row => [row.slug, row.name]));
  return [...new Set(slugs)].map(slug => {
    const bare = slug.replace(/^_/u, ''), head = heads.get(bare);
    const name = head?.name ?? names.get(bare) ?? '';
    const hidden = slug.startsWith('_') || name === bare || bare.startsWith('proof-');
    return { slug, name: name === '' || name === bare ? readable(slug) : name, status: hidden ? 'hidden' : status.get(slug) ?? null,
      heroHash: null, firstUploadedAt: head?.firstUploadedAt ?? null, enters: human.get(slug) ?? 0 };
  });
}

export function zoneSelectTabs(channel: ZoneSelectOptions['channel'], live: LiveZones, uploads: readonly Upload[], counts: readonly ZoneEntryTotal[]): ZoneSelectDocument {
  const name = (a: ZoneSelectCard, b: ZoneSelectCard): number => a.name.localeCompare(b.name, 'en') || a.slug.localeCompare(b.slug, 'en');
  const all = cards(live.slugs, uploads, counts).sort(name);
  // QA 11-23-b row 4 (Jake ~12:20 Cancun: "one plot thin ice should not show up in popular lol"; J498): Featured, Popular and
  // New list only real zones, never a placeholder open plot or a test shard (row 26: even one placed on the grid); All, the
  // Developer's list, still names them.
  const visible = all.filter(card => !offPlayerLists(card));
  const bySlug = new Map(visible.map(card => [card.slug, card]));
  const featured = live.featured === undefined ? visible : live.featured.flatMap(slug => { const card = bySlug.get(slug); return card === undefined ? [] : [card]; });
  const order = new Map(featured.map((card, index) => [card.slug, index]));
  const unique = new Map(counts.map(row => [row.slug, row.uniqueHumans]));
  const popular = [...visible].sort((a, b) => b.enters - a.enters ||
    (a.enters === 0 ? 0 : (unique.get(b.slug) ?? 0) - (unique.get(a.slug) ?? 0)) ||
    (order.get(a.slug) ?? featured.length) - (order.get(b.slug) ?? featured.length) || name(a, b));
  const optedOut = new Set(uploads.filter(row => row.listedNew === false).map(row => row.slug));
  const fresh = visible.filter(card => card.firstUploadedAt !== null && !optedOut.has(card.slug))
    .sort((a, b) => Date.parse(b.firstUploadedAt ?? '') - Date.parse(a.firstUploadedAt ?? '') || name(a, b));
  return { channel, serial: live.serial, all, featured, popular, new: fresh };
}

/** One refresh per process. The last good uploads and totals survive a transient failure independently. */
export function zoneSelectRoute(options: ZoneSelectOptions): (request: IncomingMessage, response: ServerResponse) => boolean {
  let uploads: readonly Upload[] = [], totals: readonly ZoneEntryTotal[] = [];
  let renewAt = 0, refresh: Promise<void> | undefined;
  const update = (): Promise<void> => {
    if (refresh !== undefined) return refresh;
    if (Date.now() < renewAt) return Promise.resolve();
    refresh = Promise.allSettled([options.uploads(), within(CATALOGUE_MS, options.totals)]).then(([catalogue, arrivals]) => {
      if (catalogue.status === 'fulfilled') uploads = catalogue.value;
      else options.log({ at: 'zone-select.catalogue-failed', error: String(catalogue.reason) });
      if (arrivals.status === 'fulfilled') totals = arrivals.value;
      else options.log({ at: 'zone-select.arrivals-failed', error: String(arrivals.reason) });
      renewAt = Date.now() + REFRESH_MS;
      refresh = undefined;
      return undefined;
    });
    return refresh;
  };
  async function send(response: ServerResponse): Promise<void> {
    try {
      await update();
      const body = zoneSelectTabs(options.channel, options.world(), uploads, totals);
      response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'public, max-age=30' }).end(JSON.stringify(body));
    } catch (error) {
      options.log({ at: 'zone-select.read-failed', error: String(error) });
      response.writeHead(503).end();
    }
  }
  return (request, response) => {
    if (request.url?.split('?')[0] !== PATH) return false;
    const origin = request.headers.origin;
    response.setHeader('Vary', 'Origin');
    if (!originAllowed(origin, options.allowedOrigins)) { response.writeHead(403).end(); return true; }
    if (origin !== undefined) response.setHeader('Access-Control-Allow-Origin', origin);
    if (request.method !== 'GET') { response.writeHead(405, { Allow: 'GET' }).end(); return true; }
    void send(response);
    return true;
  };
}
