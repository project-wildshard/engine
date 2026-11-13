// SHARD-AUTHORING SA33 to SA35, the page half (meta SHARD-AUTHORING-PLAN): a released page (staging, production) learns the cells the API
// placed after its build, at runtime, from the same signed placement file the MMO reads (`releases/<channel>-placements.json`, SA33a).
// Its build bakes the pinned grid (`catalogue.json`, C3); the MMO's grid is that plus this file, so without it a placed shard had no
// Shard Select card and `?chunk=<slug>` landed on the deck. The file is believed only under the API's placement key, as the box and
// SA35's preview bake believe it. A missing, late, unreadable or refused file keeps the build's grid: boot never waits past
// `PLACED_DEADLINE_MS` and never fails here. The bucket sends it `no-store`, the read asks `no-store`, and the service worker leaves
// `/releases/` to the network (sw.js `isContentRead`), so no page keeps an old file.
import * as v from 'valibot';
import { Scope } from '@wildshard/engine/app/scope';
import { GRID_RADIUS } from '@wildshard/format/contentBounds';
import { PLACEMENT_PUBLIC_KEY, PlacementSchema, SignedPlacementSchema, placementsURL, type PlacementFile } from '../../../shared/game/grid/placementRows';
import { installCatalogue, installedCatalogue, type CatalogueDocument } from '../../../shared/game/grid/catalogueSlot';
import { findTitleManifest } from '../shard/titleList';
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
 * (`known` false: an upload after the build) is left out too, as today: the page can't load it. `placed` names the slugs the file
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

/** What a page's read of its placement file did, for the console and the tests. */
export type PlacedRead = { readonly added: readonly Cell[]; readonly left: readonly string[]; readonly serial: number } | { readonly kept: string };
export interface PlacedPorts {
  readonly fetch?: typeof fetch;
  readonly publicKey?: string;
  readonly deadlineMs?: number;
  /** The page's own deadline: once it fires the boot has gone on, so a late answer installs nothing (the deck and the one way in read
   *  the grid once). */
  readonly signal?: AbortSignal;
  /** Whether this build can show and load a slug (default: it has a title row, `titleList.ts`). */
  readonly known?: (slug: string) => boolean;
}
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
    const response = await (ports.fetch ?? fetch)(url, { cache: 'no-store', credentials: 'omit', redirect: 'error', signal: abort.signal });
    if (response.status === 404) return { kept: 'no placement file (404): nothing placed on this channel' };
    if (!response.ok) return { kept: `placement file ${String(response.status)}` };
    const file = await readSignedPlacement(await response.text(), ports.publicKey);
    const channel = /\/releases\/(staging|production)-placements\.json$/u.exec(new URL(url).pathname)?.[1];
    if (channel !== undefined && file.channel !== channel) return { kept: `a ${file.channel} placement file at the ${channel} address` };
    const placed = addPlacedCells(document, file, ports.known ?? (slug => findTitleManifest(slug) !== undefined));
    if (ports.signal?.aborted === true) return { kept: 'the page went on before the placement file was read' };
    if (placed.added.length > 0) installCatalogue(placed.document);
    return { added: placed.added, left: placed.left, serial: file.serial };
  } catch (error) { return { kept: error instanceof Error ? error.message : String(error) }; } finally { scope.dispose(); }
}
