// SHARD-AUTHORING SA33 to SA35, the page half (meta SHARD-AUTHORING-PLAN): a released page (staging, production) learns the cells the API
// placed after its build, at runtime, from the same signed placement file the MMO reads (`releases/<channel>-placements.json`, SA33a).
// Its build bakes the pinned grid (`catalogue.json`, C3); the MMO's grid is that plus this file, so without it a placed shard had no
// Shard Select card and `?chunk=<slug>` landed on the deck. The file is believed only under the API's placement key, as the box and
// SA35's preview bake believe it. A missing, late, unreadable or refused file keeps the build's grid: boot never waits past
// `PLACED_DEADLINE_MS` and never fails here. The bucket sends it `no-store`, the read asks `no-store`, and the service worker leaves
// `/releases/` to the network (sw.js `isContentRead`), so no cache serves an old file.
// OFFLINE OF20: the device keeps the last file it believed (its text, in OF0's `gridRoute` slot, beside the world's kept word), and
// the next page installs it at once, its signature checked again: offline, or on a link that hangs past the deadline, Shard Select
// still has the cells this device last saw. A fresh file read in time replaces it, from the build's own catalogue; a 404 drops it.
import * as v from 'valibot';
import { Scope } from '@wildshard/engine/app/scope';
import { jsonSlot, type Json } from '@wildshard/engine/saves/slots';
import { GRID_RADIUS } from '@wildshard/format/contentBounds';
import { PLACEMENT_PUBLIC_KEY, PlacementSchema, SignedPlacementSchema, placementsURL, type PlacementFile } from '../../../shared/game/grid/placementRows';
import { installCatalogue, installedCatalogue, type CatalogueDocument } from '../../../shared/game/grid/catalogueSlot';
import { findTitleManifest, installTitleManifests, titleManifests } from '../shard/titleList';
import { catalogueCards } from './placedCards';
import { installPlacedContent, placedContent, type PlacedContent } from './placedContent';
import { parseGridCatalogue } from '../../../shared/game/grid/catalogue';

/** How long a page's boot waits for the file: GO4's 3 s, the world word's own deadline. A slower answer leaves the build's grid. */
export const PLACED_DEADLINE_MS = 3000;

type Cell = PlacementFile['cells'][number];
const hexBytes = (hex: string): Uint8Array<ArrayBuffer> => Uint8Array.from(hex.match(/../gu) ?? [], pair => Number.parseInt(pair, 16));

/** The file's text as what it says: WebCrypto's Ed25519 under `publicKey` (SPKI DER in hex), then the box's own schema. It throws on a
 *  bad signature, before a byte of the body is believed, and where a browser has no Ed25519. */
export async function readSignedPlacement(text: string, publicKey: string = PLACEMENT_PUBLIC_KEY): Promise<PlacementFile> {
  const signed = v.parse(SignedPlacementSchema, JSON.parse(text));
  const key = await crypto.subtle.importKey('spki', hexBytes(publicKey), { name: 'Ed25519' }, false, ['verify']);
  if (!await crypto.subtle.verify({ name: 'Ed25519' }, key, hexBytes(signed.signature), new TextEncoder().encode(signed.body))) throw new Error('A placement file has a bad signature');
  return v.parse(PlacementSchema, JSON.parse(signed.body));
}

/** Where this page reads its placed cells: its world's channel's placement file, or null for a page with no world (preview bakes
 *  staging's cells at deploy, SA35; a solo build has none). `__WS_PLACEMENTS__`, a proof's own address, wins when set. */
export function placementsOf(scope: { readonly __WS_WORLD__?: unknown; readonly __WS_PLACEMENTS__?: unknown }): string | null {
  if (typeof scope.__WS_PLACEMENTS__ === 'string') return scope.__WS_PLACEMENTS__;
  const world = scope.__WS_WORLD__;
  const release = typeof world === 'object' && world !== null && 'release' in world && typeof world.release === 'string' ? world.release : null;
  return release === null ? null : placementsURL(release);
}

/** What adding a file's cells to a catalogue gave: the catalogue to install, the cells it took, and why any was left out. */
export interface Placed { readonly document: CatalogueDocument; readonly added: readonly Cell[]; readonly left: readonly string[] }
/**
 * The catalogue with the file's cells after the build's own. A cell is left out as the MMO's `placeCell` (`gridCells.ts`) refuses it, rule
 * for rule: an instance placed elsewhere, off the 7 × 7, a slug that already has a cell (or names a cell), an instance that is a placed
 * shard's slug, a taken spot. A cell the build already places the same way is kept once. A slug this build has no card or product for
 * (`known` false: an upload after the build the API's catalogue does not card, SA46) is left out too. `placed` names the slugs the file
 * added, which Shard Select cards (`titleDeck.ts`).
 */
export function addPlacedCells(document: CatalogueDocument, file: PlacementFile, known: (slug: string) => boolean = () => true): Placed {
  const added: Cell[] = [], left: string[] = [];
  const shards = new Map<string, string>(), cells = new Map<string, string>(), spots = new Map<string, string>();
  for (const row of document.grid.cells as readonly Cell[]) { shards.set(row.instance, row.slug); cells.set(row.slug, row.instance); spots.set(row.cell.join(','), row.instance); }
  for (const row of file.cells) {
    const [x, z] = row.cell, spot = `${String(x)},${String(z)}`;
    if (shards.has(row.instance) && cells.get(row.slug) === row.instance && spots.get(spot) === row.instance) continue;
    const refused = shards.has(row.instance) ? `${row.instance} is already placed elsewhere`
      : Math.abs(x) > GRID_RADIUS || Math.abs(z) > GRID_RADIUS ? 'off the 7 × 7'
      : cells.has(row.slug) || shards.has(row.slug) ? `${row.slug} already has a cell`
      : cells.has(row.instance) ? `${row.instance} is a placed shard's name`
      : spots.has(spot) ? `${spot} is ${spots.get(spot) ?? ''}'s`
      : known(row.slug) ? '' : `${row.slug} is not in this build`;
    if (refused !== '') { left.push(`${row.instance} (${row.slug}) at (${spot}): ${refused}`); continue; }
    shards.set(row.instance, row.slug); cells.set(row.slug, row.instance); spots.set(spot, row.instance);
    added.push({ instance: row.instance, slug: row.slug, cell: [x, z] });
  }
  if (added.length === 0) return { document, added, left };
  const grid = { ...document.grid, cells: [...document.grid.cells, ...added] };
  // the grid's own admission (radius, unique spots and instances): a grid it refuses is never installed
  parseGridCatalogue(grid);
  return { document: { ...document, grid, placed: [...document.placed ?? [], ...added.map(row => row.slug)] }, added, left };
}

/** What a page's read of its placement file did, for the console and the tests: `carded` names the added slugs whose card came
 *  from the API's catalogue (SA46). */
export type PlacedRead = { readonly added: readonly Cell[]; readonly left: readonly string[]; readonly serial: number; readonly carded: readonly string[];
  /** OF20: the device's kept file, because the fresh one did not come (why) */ readonly cached?: string } | { readonly kept: string };
/** OF20: the last placement file this device believed, by its address. */
export interface PlacedKeep { readonly read: (url: string) => string | null; readonly write: (url: string, text: string | null) => void }
/** OF20: in OF0's device slot `gridRoute` (oneWayIn.ts `deviceRouteMemory`), as `placed: { url, text }`: one store for the world's
 *  last word and its last layout. */
export function devicePlacedKeep(): PlacedKeep {
  const slot = (): ReturnType<typeof jsonSlot> => jsonSlot('gridRoute', 'device');
  const row = (): Record<string, Json> => { const value = slot().read(); return typeof value === 'object' && value !== null && !Array.isArray(value) ? value : {}; };
  return {
    read: url => {
      try {
        const placed = row()['placed'];
        return typeof placed === 'object' && placed !== null && !Array.isArray(placed) && placed['url'] === url && typeof placed['text'] === 'string' ? placed['text'] : null;
      } catch { return null; }
    },
    write: (url, text) => {
      try { const { placed: _old, ...rest } = row(); slot().write(text === null ? rest : { ...rest, placed: { url, text } }); }
      catch { /* a device that keeps nothing reads the network only, as before */ }
    },
  };
}
export interface PlacedPorts {
  readonly fetch?: typeof fetch;
  readonly publicKey?: string;
  readonly deadlineMs?: number;
  /** The page's own deadline: once it fires the boot has gone on, so a late answer installs nothing (the deck and the one way in read
   *  the grid once). */
  readonly signal?: AbortSignal;
  /** Whether this build cards a slug (default: it has a title row, `titleList.ts`). A slug it lacks may be carded from the API's
   *  catalogue (SA46); whether its product loads is the product's own question. */
  readonly known?: (slug: string) => boolean;
  /** The API origin a slug the build lacks is carded from (SA46, `placedCards.ts`; default `VITE_API_ORIGIN`). */
  readonly api?: string;
  /** The catalogue lookups' own deadline (`placedCards.ts` `CARD_DEADLINE_MS`). */
  readonly cardDeadlineMs?: number;
  /** SA48: a carded slug's content from the cook (`placedContent.ts`), by the hash its cell names; default: this page's build's index in
   *  the store at the placement file's origin. A slug with none stays out. */
  readonly content?: (slug: string, hash: string | undefined, signal: AbortSignal) => Promise<PlacedContent | undefined>;
  /** OF20: where the last believed file is kept (default: the device, `devicePlacedKeep`) */
  readonly keep?: PlacedKeep;
}
/** The cook's content for a placed slug, from the store the placement file is in, for this page's build under its own validator. */
const cookContent = (url: string, read: typeof fetch): NonNullable<PlacedPorts['content']> => (slug, hash, signal) => {
  const build: unknown = Reflect.get(globalThis, '__WS_BUILD_ID__'), validator: unknown = Reflect.get(globalThis, '__WS_SHARDFILE_VALIDATOR__');
  return hash === undefined || typeof build !== 'string' ? Promise.resolve(undefined)
    : placedContent(slug, hash, { fetch: read, signal, packs: new URL('/', url).href, build, validator: typeof validator === 'string' ? validator : null });
};
/** After every row's `order`, so a carded shard is last in the deck. */
const nextOrder = (rows: readonly { readonly order?: number }[]): number => rows.reduce((top, row) => Math.max(top, row.order ?? 0), rows.length) + 1;
/** Read the file at `url` and install the build's catalogue with its cells. Never throws: anything but a believed file keeps the build's
 *  grid and says why (a 404 is a channel the API has placed nothing on). */
export async function learnPlacedCells(url: string, ports: PlacedPorts = {}): Promise<PlacedRead> {
  const scope = new Scope('grid.placed-cells');
  try {
    const document = installedCatalogue();
    if (document === undefined) return { kept: 'no installed catalogue' };
    // one signal for both deadlines, without `AbortSignal.any` (Safari 17.4): Safari 17's Ed25519 reads this file too
    const abort = new AbortController(), stop = (): void => { abort.abort(); };
    scope.timeout(ports.deadlineMs ?? PLACED_DEADLINE_MS, stop);
    if (ports.signal?.aborted === true) stop(); else if (ports.signal !== undefined) scope.listen(ports.signal, 'abort', stop);
    const channel = /\/releases\/(staging|production)-placements\.json$/u.exec(new URL(url).pathname)?.[1];
    const believe = async (text: string): Promise<PlacementFile> => {
      const read = await readSignedPlacement(text, ports.publicKey);
      if (channel !== undefined && read.channel !== channel) throw new Error(`a ${read.channel} placement file at the ${channel} address`);
      return read;
    };
    const known = ports.known ?? (slug => findTitleManifest(slug) !== undefined);
    // the page's own deadline, read afresh after each wait: once it fires the boot has gone on
    const wentOn = (): boolean => ports.signal?.aborted === true;
    // OF20: the kept file first, so a page whose read never comes still has the layout this device last saw
    const keep = ports.keep ?? devicePlacedKeep(), held = keep.read(url);
    let cached: { readonly added: readonly Cell[]; readonly left: readonly string[]; readonly serial: number } | undefined;
    if (held !== null) {
      try {
        const file = await believe(held), kept = addPlacedCells(document, file, known);
        if (!wentOn() && kept.added.length > 0) { installCatalogue(kept.document); cached = { added: kept.added, left: kept.left, serial: file.serial }; }
      } catch { keep.write(url, null); } // a kept file this build no longer believes is dropped
    }
    const fallBack = (why: string): PlacedRead => cached === undefined ? { kept: why } : { ...cached, carded: [], cached: why };
    let response: Response;
    try { response = await (ports.fetch ?? fetch)(url, { cache: 'no-store', credentials: 'omit', redirect: 'error', signal: abort.signal }); }
    catch (error) { return fallBack(error instanceof Error ? error.message : String(error)); }
    if (response.status === 404) {
      // nothing placed on this channel now: the kept cells leave too
      keep.write(url, null);
      if (cached !== undefined && !wentOn()) installCatalogue(document);
      return { kept: 'no placement file (404): nothing placed on this channel' };
    }
    if (!response.ok) return fallBack(`placement file ${String(response.status)}`);
    let text: string, file: PlacementFile;
    try { text = await response.text(); file = await believe(text); }
    catch (error) { return fallBack(error instanceof Error ? error.message : String(error)); }
    const placed = addPlacedCells(document, file, known);
    keep.write(url, text); // only a file that places cleanly is kept
    if (wentOn()) return fallBack('the page went on before the placement file was read');
    // from the build's own catalogue, so the fresh file replaces the kept one's cells
    if (placed.added.length > 0 || cached !== undefined) installCatalogue(placed.document);
    // SA46: a cell the box would open whose slug this build has no card for (an upload after the build) is carded from its catalogue
    // entry, after the build's own cells are in, so a slow or absent API costs them nothing; a slug it does not card stays out
    const unknown = addPlacedCells(placed.document, file).added.map(cell => cell.slug);
    const built = { added: placed.added, left: placed.left, serial: file.serial, carded: [] };
    if (unknown.length === 0) return built;
    // SA48: its content from the cook beside its card, so ENTER WORLD loads it; a card with no content would only fail at the door
    const hashes = new Map(file.cells.map(cell => [cell.slug, cell.hash])), content = ports.content ?? cookContent(url, ports.fetch ?? fetch);
    const [cards, contents] = await Promise.all([
      catalogueCards(unknown, { fetch: ports.fetch ?? fetch, signal: abort.signal, order: nextOrder(titleManifests()), ...(ports.api === undefined ? {} : { api: ports.api }),
        ...(ports.cardDeadlineMs === undefined ? {} : { deadlineMs: ports.cardDeadlineMs }) }),
      Promise.all(unknown.map(slug => content(slug, hashes.get(slug), abort.signal).catch(() => undefined))),
    ]);
    const cooked = new Map<string, PlacedContent>();
    unknown.forEach((slug, n) => { const found = contents[n]; if (found !== undefined) cooked.set(slug, found); });
    if (cards.length === 0 || wentOn()) return built;
    const carded = new Set(cards.filter(row => cooked.has(row.slug)).map(row => row.slug)), more = addPlacedCells(placed.document, file, slug => carded.has(slug));
    const opened = new Set(more.added.map(cell => cell.slug)), rows = cards.filter(row => opened.has(row.slug));
    for (const slug of opened) { const found = cooked.get(slug); if (found !== undefined) installPlacedContent(found); }
    if (more.added.length > 0) installCatalogue(more.document);
    if (rows.length > 0) installTitleManifests([...titleManifests(), ...rows]);
    return { added: [...placed.added, ...more.added], left: more.left, serial: file.serial, carded: rows.map(row => row.slug) };
  } catch (error) { return { kept: error instanceof Error ? error.message : String(error) }; } finally { scope.dispose(); }
}
