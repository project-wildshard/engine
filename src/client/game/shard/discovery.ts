import { contentURL } from '@wildshard/engine/boot/contentBase';
import type { ShardFolder } from '../../../shared/game/shardfile/shardFolder';
import { declaredForestQueries, declaredGround, declaredPondClip, defineAuthoredShard, type ShardManifest } from './manifest';
import type { keyedSkyRender } from '../looks/keyedSky';
import type { postGraphLook } from '../looks/postGraphLook';
import type { heldArmsGear } from '../models/heldGear';
import type { declaredClientPlanEntry } from './declaredEntry';
import { ContentReadError, readContent } from '@wildshard/engine/boot/contentRead';
import { addShardArt } from './list';
import { pageModeBoot, pageModeKtx2 } from './pageBoot';
import type { TitleManifest } from './titleList';

/** C3 (J61): a shard's discovery is data in its product (`src/sharddev/discoveryDocument.ts`), read at entry, so a page needs
 *  nothing compiled to run a shard the catalogue added after its build. A `{$call}` names a row of this table, which is every
 *  piece of a shard's composition that stays game code; JSON can name one of these and no other. */
type Row = Readonly<Record<string, unknown>>;
const isRow = (value: unknown): value is Row => typeof value === 'object' && value !== null && !Array.isArray(value);
const held = () => import('../systems/viewmodel/heldView');
const looks = {
  toon: async (product: ShardFolder) => (await import('../looks/toonLook')).toonLook(product),
  painted: async (product: ShardFolder) => (await import('../looks/paintedLook')).folderPaintedLook(product),
};
/** The styles a client plan's entry names, as text in its document: the page adds each once, when the entry loads. */
function addStyles(styles: readonly string[]): void {
  for (const text of styles) {
    if (typeof document === 'undefined' || [...document.head.querySelectorAll('style[data-declared]')].some(row => row.textContent === text)) continue;
    const style = document.createElement('style');
    style.dataset['declared'] = ''; style.textContent = text;
    document.head.append(style);
  }
}
const CALLS: Readonly<Record<string, (...args: readonly never[]) => unknown>> = {
  forestFixed: (row: Parameters<typeof declaredForestQueries>[0]) => declaredForestQueries(row),
  pondDeclared: (rows: unknown) => declaredPondClip(rows),
  groundDeclared: (rows: Parameters<typeof declaredGround>[0], extra: Row) => ({...declaredGround(rows), ...extra}),
  pageModeBoot: (rows: unknown) => pageModeBoot(rows),
  pageModeKtx2: (rows: unknown) => () => Promise.resolve(pageModeKtx2(rows)),
  swordGraph: (slug: string, file: string) => async () => (await (await held()).HeldView.fromFolder(slug, file)).sword(),
  swordRows: (rows: {readonly look: Row}) => async () => (await held()).HeldView.admit({kind: 'toon', ...rows.look}).sword(),
  renderToon: () => looks.toon,
  renderPainted: () => looks.painted,
  renderPost: (options: Parameters<typeof postGraphLook>[1]) => async (product: ShardFolder) => (await import('../looks/postGraphLook')).postGraphLook(product, options),
  renderKeyed: (options: Parameters<typeof keyedSkyRender>[1]) => async (product: ShardFolder) => (await import('../looks/keyedSky')).keyedSkyRender(product, options),
  rosterHeld: (rows: Parameters<typeof heldArmsGear>[0]) => async () => (await import('../models/heldGear')).heldArmsGear(rows),
  planEntry: (policy: Parameters<typeof declaredClientPlanEntry>[0], styles: readonly string[]) => async () => { addStyles(styles); return (await import('./declaredEntry')).declaredClientPlanEntry(policy); },
};
function revive(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(revive);
  if (!isRow(value)) return value;
  const name = value['$call'];
  if (typeof name === 'string') {
    const make = Object.hasOwn(CALLS, name) ? CALLS[name] : undefined, args = value['args'];
    if (make === undefined || !Array.isArray(args)) throw new Error(`Unknown discovery call ${name}`);
    return Reflect.apply(make, undefined, args);
  }
  return Object.fromEntries(Object.entries(value).map(([key, row]) => [key, revive(row)]));
}

/** One document as the manifest its bindings describe. A shard homed on another origin (J138) names its images there: a
 *  document's `<img>` passes no fetch layer. Its data keeps the page URLs the format admits; only what a page shows moves. */
export function shardFromDiscovery(input: unknown, home?: string): ShardManifest {
  if (!isRow(input) || input['version'] !== 1 || typeof input['slug'] !== 'string' || !isRow(input['rows']) || !isRow(input['native'])) throw new Error('Invalid discovery document');
  const {slug, data, rows, native} = input, ktx2 = native['ktx2'];
  const declared = revive(native), bindings = revive(rows);
  if (!isRow(declared) || !isRow(bindings)) throw new Error('Invalid discovery document');
  const art = isRow(input['art']) ? input['art'] : {}, images: Record<string, string> = {}, homed: Record<string, unknown> = {};
  if (home !== undefined) for (const [url, bytes] of Object.entries(art)) { images[url] = `${home}${url}`; homed[`${home}${url}`] = bytes; }
  addShardArt({...art, ...homed});
  return defineAuthoredShard(data, slug, bindings, {
    ...declared, ...(isRow(ktx2) && '$call' in ktx2 ? {} : ktx2 === undefined ? {} : {ktx2: () => Promise.resolve(ktx2)}),
  } as Parameters<typeof defineAuthoredShard>[3], images);
}

/** Where a row's art keys (page paths, `/shardfiles/<slug>/…`) are read: everything before the document's own `/shardfiles/`.
 *  A stored or placed cook keeps its loose files under its upload's folder (SA48, `…/loose/<hash>/shardfiles/…`); the origin
 *  alone dropped that folder, and every card and Explorer image 404'd on the cook's origin (meta QA 11-25 row 144). A page
 *  path has no home. */
export function discoveryHome(discovery: string): string | undefined {
  if (!/^https?:\/\//u.test(discovery)) return undefined;
  const at = discovery.indexOf('/shardfiles/', discovery.indexOf('//') + 2);
  return at === -1 ? /^https?:\/\/[^/]+/u.exec(discovery)?.[0] : discovery.slice(0, at);
}

/** SB28: off the boot path a read that failed twice throws instead of waiting on a RETRY nobody sees. */
const refuse = (error: ContentReadError): Promise<never> => { throw error; };

/** A discovery document is tens of KB; anything near this is not one. */
const DISCOVERY_BYTES = 8_000_000;

/** The manifest of a title row, read from its product. */
export async function readDiscovery(row: Pick<TitleManifest, 'slug' | 'discovery'>, read: typeof fetch = fetch,
  { wait = false }: { readonly wait?: boolean } = {}): Promise<ShardManifest> {
  if (row.discovery === undefined) throw new Error(`${row.slug} has no discovery document`);
  // STAGING-BUGBASH SB27: since PAGE-SIZE the document is shard content on the page's content base; the page's own
  // `/shardfiles/` answers 404 there. Its home stays the row's own (a page path has none): its art keys keep their page
  // URLs, so the explore compare images it names are still page paths (not yet read from the base; review note).
  // SB28: on the boot path (`wait`) a read the network can't answer waits on the loading card's RETRY (QA 11-12 row 36) and goes
  // again when the device is back online, never SOMETHING BROKE at `app:selected-discovery`; off it (the title's Settings, with
  // no loading card) a second failed read throws as before. A missing document always throws.
  const bytes = await readContent(contentURL(row.discovery), DISCOVERY_BYTES, { fetch: (url, init) => read(url, init), missingThrows: true,
    ...(wait ? {} : { retry: refuse }) })
    .catch((error: unknown) => {
      throw error instanceof ContentReadError && error.status !== null ? new Error(`Discovery of ${row.slug} answered ${String(error.status)}`, { cause: error }) : error;
    });
  const manifest = shardFromDiscovery(JSON.parse(new TextDecoder().decode(bytes)), discoveryHome(row.discovery));
  if (!new Set([row.slug]).has(manifest.slug)) throw new Error('Selected discovery identity differs');
  return manifest;
}
