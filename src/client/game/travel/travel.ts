import * as v from 'valibot';
import { saves } from '@wildshard/engine/saves/runtime';
import { leaveSaved, markUnload } from '@wildshard/engine/boot/lastEnd';
import { arrivalTier, freshPageArrival, setTitleArrival } from '@wildshard/engine/boot/titleArrival';
import type { SaveKeyDef, SaveSlot } from '@wildshard/engine/saves/store';
import { findTitleManifest, titleManifests } from '../shard/titleList';
import type { ShardSlug } from '../../../shared/game/shard/slug';
import type { SpawnPose } from '../shard/manifest';
import type { Inventory, ItemId } from '../Inventory';
import { isItemId, ITEMS } from '../../../shared/game/bag/itemCatalog';
import type { ItemRow } from '../../../shared/game/bag/items';
import { replaceFresh } from '@wildshard/engine/boot/freshPage';

/** `shown` (LS6): what the receiving card names and paints when the page loads one place and plays another (the grid). */
/** `inPage` (ZONE-ENTRY ZE10a3): enter in this page, without a navigation, when the app installed a same-page entry
 *  (`setInPageEntry`); called once that entry settles. Without one the request navigates as before. */
export interface TravelRequest { to: ShardSlug; mode: 'enter' | 'explore' | 'arena'; arrive?: SpawnPose; shown?: { readonly name: string; readonly art: string }; inPage?: () => void }
export interface TravelHandoff {
  v: 1; from: ShardSlug | null; to: ShardSlug; mode: TravelRequest['mode'];
  arrive: SpawnPose | null; carry: readonly { id: ItemId; count: number }[]; at: number;
}
const finite = v.pipe(v.number(), v.finite());
const slug = v.custom<ShardSlug>((value) => typeof value === 'string' && titleManifests().map((entry) => entry.slug).includes(value));
const item = v.custom<ItemId>((value) => typeof value === 'string' && isItemId(value));
const schema: v.GenericSchema<unknown, TravelHandoff | null> = v.nullable(v.object({
  v: v.literal(1), from: v.nullable(slug), to: slug, mode: v.picklist(['enter', 'explore', 'arena']),
  arrive: v.nullable(v.object({ x: finite, z: finite, yaw: finite, y: v.exactOptional(finite) })),
  carry: v.array(v.object({ id: item, count: v.pipe(finite, v.integer(), v.minValue(1)) })), at: finite,
}));
export interface TravelSource { shard: ShardSlug; inventory: Inventory; rows: ReadonlyMap<string, ItemRow> }
interface TravelPorts {
  source: () => TravelSource | null;
  slot: SaveSlot<TravelHandoff | null>;
  now: () => number;
  navigate: (request: TravelRequest) => void;
}
/** Per-tab handoff. The injectable ports exercise a real write/read/delete round trip in node tests. */
export function travelService(ports: TravelPorts): { travel: (request: TravelRequest) => void; consume: (to: ShardSlug) => TravelHandoff | null } {
  return {
    travel: (request: TravelRequest): void => {
      const source = ports.source();
      const carry = source?.inventory.items.filter((line) => (source.rows.get(line.id)?.travels ?? ITEMS[line.id]?.travels ?? false) && line.count > 0).map(({ id, count }) => ({ id, count })) ?? [];
      const handoff: TravelHandoff = { v: 1, from: source?.shard ?? null, to: request.to, mode: request.mode, arrive: request.arrive ?? null, carry, at: ports.now() };
      // Carry is removed together, only once the receiving page has a durable handoff.
      if (ports.slot.write(handoff)) source?.inventory.takeTravel(source.rows);
      ports.navigate(request);
    },
    consume: (to: ShardSlug): TravelHandoff | null => {
      const handoff = ports.slot.read();
      ports.slot.reset();
      if (handoff === null || handoff.to !== to) return null;
      return freshPageArrival(handoff.at, ports.now()) ? handoff : null;
    },
  };
}
const handoffDefinition: SaveKeyDef<TravelHandoff | null> = { key: 'travel.handoff', scope: 'session', version: 1, schema, initial: () => null };
export function travelSlot(store: typeof saves = saves): SaveSlot<TravelHandoff | null> { return store.define(handoffDefinition); }
let running: TravelSource | null = null;
/** The composition root binds the live Bag and rows; the cold title has no running shard. */
export function bindTravelInventory(source: TravelSource): () => void {
  running = source;
  return () => { if (running === source) running = null; };
}
let inPageEntry: ((request: TravelRequest, url: URL) => Promise<void>) | null = null;
/** GO5b: who waits for the same-page entry (`whenEntersInPage`). */
const entryHeard: (() => void)[] = [];
/** ZE10a3: the app's same-page entry (`app/entry.ts`): the level and its Game go, then the page's start runs again and reads the
 *  handoff, the title arrival and the address (`url`, the fresh page's) this travel wrote. */
export function setInPageEntry(enter: (request: TravelRequest, url: URL) => Promise<void>): void { inPageEntry = enter; for (const heard of entryHeard.splice(0)) heard(); }
/** GO5b: run `heard` once this page has its same-page entry (now, if it has). */
export function whenEntersInPage(heard: () => void): void { if (inPageEntry !== null) heard(); else entryHeard.push(heard); }
/** True when an `inPage` request enters without a navigation (a read-ahead then waits for the old world to go). */
export function entersInPage(): boolean { return inPageEntry !== null; }
/** An `inPage` request on a page with a same-page entry: the arrival and the address the fresh page would get, then that entry. */
function enterInPage(request: TravelRequest): boolean {
  const enter = inPageEntry, settled = request.inPage;
  if (enter === null || settled === undefined) return false;
  arriveAt(request);
  const url = travelAddress(request);
  leaveSaved(() => { void enter(request, url).finally(settled); });
  return true;
}
const service = travelService({ source: () => running, slot: travelSlot(), now: () => Date.now(), navigate: (request) => {
  if (!enterInPage(request)) navigate(request);
} });
function navigate(request: TravelRequest): void {
  const ready = running === null ? window.__ws_sw?.ready : undefined;
  if (ready !== undefined) {
    const leaveTitle = (): void => { if (running === null) navigateNow(request); };
    // Registration failure is unavailable caching, never a refused journey.
    void ready.then(leaveTitle, leaveTitle);
    return;
  }
  navigateNow(request);
}
function navigateNow(request: TravelRequest): void {
  arriveAt(request);
  const url = travelAddress(request);
  // The destination document owns any update adoption. A running world
  // neither changes controller nor waits for a worker before leaving (G898).
  // Replacing releases WebKit's previous page rather than parking its heap in the back/forward cache.
  leaveSaved(() => { markUnload(`shard switch to ${request.to} (fresh page)`); replaceFresh(url); });
}
function arriveAt(request: TravelRequest): void {
  setTitleArrival({ slug: request.to, mode: request.mode, name: request.shown?.name ?? findTitleManifest(request.to)?.name ?? request.to, tier: arrivalTier.current,
    ...(request.shown === undefined ? {} : { art: request.shown.art }) });
}
/** CHUNK-PARAM CP1 (J522): the next page's address is `/` with the harness flags this one keeps; the zone rides in the tap
 *  (`arriveAt`, written first), never in the address. */
function travelAddress(request: Pick<TravelRequest, 'mode'>, href: string = location.href): URL {
  const here = new URL(href), url = new URL(`/${here.search}`, here.origin);
  for (const name of ['chunk', 'at', 'glreload', 'x', 'z', 'yaw', 'pitch', 'explore', 'cam', 'model', 'skipintro', 'tour', 'quest', 'drop']) url.searchParams.delete(name);
  if (request.mode === 'explore') url.searchParams.set('explore', 'hub');
  url.searchParams.delete('v');
  return url;
}
export function travel(request: TravelRequest): void {
  const manifest = findTitleManifest(request.to);
  if (manifest === undefined) return;
  service.travel({ ...request, to: manifest.slug });
}
/** CP1: the bare address a travel leaves for (test/navigation-arrival.test.ts). */
export { travelAddress };
export function consumeTravelHandoff(to: ShardSlug): TravelHandoff | null { return service.consume(to); }
/** Arrival goes through the target shard's Bag rules, never writes another shard's inventory directly. */
export function applyTravelCarry(handoff: TravelHandoff | null, inventory: Inventory): void {
  if (handoff?.to !== inventory.chunkId) return;
  for (const line of handoff.carry) inventory.add(line.id, line.count);
}
/** WIRE-STABILITY WR7: this file's save keys, for saves.lock.json (test/saves-lock.test.ts). */
export const travelSaves: readonly SaveKeyDef<unknown>[] = [handoffDefinition];
