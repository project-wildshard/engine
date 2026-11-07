import type { ShardProduct } from '../../../shared/game/shardfile/shardProduct';
import { declaredForestQueries, declaredGround, declaredPondClip, defineAuthoredShard, type ShardManifest } from './manifest';
import type { keyedSkyRender } from '../looks/keyedSky';
import type { postGraphLook } from '../looks/postGraphLook';
import type { heldArmsGear } from '../models/heldGear';
import type { declaredClientPlanEntry } from './declaredEntry';
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
  toon: async (product: ShardProduct) => (await import('../looks/toonLook')).toonLook(product),
  painted: async (product: ShardProduct) => (await import('../looks/paintedLook')).productPaintedLook(product),
};
/** The styles a client plan's entry names, as text in its document: the page adds each once, when the entry loads. */
function addStyles(styles: readonly string[]): void {
  for (const text of styles) {
    if (typeof document === 'undefined' || [...document.head.querySelectorAll('style[data-shard]')].some(row => row.textContent === text)) continue;
    const style = document.createElement('style');
    style.dataset['shard'] = ''; style.textContent = text;
    document.head.append(style);
  }
}
const CALLS: Readonly<Record<string, (...args: readonly never[]) => unknown>> = {
  forestFixed: (row: Parameters<typeof declaredForestQueries>[0]) => declaredForestQueries(row),
  pondDeclared: (rows: unknown) => declaredPondClip(rows),
  groundDeclared: (rows: Parameters<typeof declaredGround>[0], extra: Row) => ({...declaredGround(rows), ...extra}),
  pageModeBoot: (rows: unknown) => pageModeBoot(rows),
  pageModeKtx2: (rows: unknown) => () => Promise.resolve(pageModeKtx2(rows)),
  swordGraph: (slug: string, file: string) => async () => (await (await held()).HeldView.fromProduct(slug, file)).sword(),
  swordRows: (rows: {readonly look: Row}) => async () => (await held()).HeldView.admit({kind: 'toon', ...rows.look}).sword(),
  renderToon: () => looks.toon,
  renderPainted: () => looks.painted,
  renderPost: (options: Parameters<typeof postGraphLook>[1]) => async (product: ShardProduct) => (await import('../looks/postGraphLook')).postGraphLook(product, options),
  renderKeyed: (options: Parameters<typeof keyedSkyRender>[1]) => async (product: ShardProduct) => (await import('../looks/keyedSky')).keyedSkyRender(product, options),
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

/** The manifest of a title row, read from its product. */
export async function readDiscovery(row: Pick<TitleManifest, 'slug' | 'discovery'>, read: typeof fetch = fetch): Promise<ShardManifest> {
  if (row.discovery === undefined) throw new Error(`${row.slug} has no discovery document`);
  const response = await read(row.discovery);
  if (!response.ok) throw new Error(`Discovery of ${row.slug} answered ${response.status}`);
  const manifest = shardFromDiscovery(JSON.parse(await response.text()), /^https?:\/\/[^/]+/u.exec(row.discovery)?.[0]);
  if (!new Set([row.slug]).has(manifest.slug)) throw new Error('Selected discovery identity differs');
  return manifest;
}
