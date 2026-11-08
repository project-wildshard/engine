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

/** `shown` (LS6): what the receiving card names and paints when the page loads one place and plays another (the grid). */
export interface TravelRequest { to: ShardSlug; mode: 'enter' | 'explore' | 'arena'; arrive?: SpawnPose; shown?: { readonly name: string; readonly art: string } }
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
      const carry = source?.inventory.items.filter((line) => (source.rows.get(line.id)?.travels ?? ITEMS[line.id].travels) && line.count > 0).map(({ id, count }) => ({ id, count })) ?? [];
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
const service = travelService({ source: () => running, slot: travelSlot(), now: () => Date.now(), navigate: (request) => {
  navigate(request);
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
  setTitleArrival({ slug: request.to, mode: request.mode, name: request.shown?.name ?? findTitleManifest(request.to)?.name ?? request.to, tier: arrivalTier.current,
    ...(request.shown === undefined ? {} : { art: request.shown.art }) });
  const url = new URL(location.href);
  url.searchParams.set('chunk', request.to);
  for (const name of ['at', 'glreload', 'x', 'z', 'yaw', 'pitch', 'explore', 'cam', 'model', 'skipintro', 'tour', 'quest', 'drop']) url.searchParams.delete(name);
  if (request.mode === 'explore') url.searchParams.set('explore', 'hub');
  url.searchParams.delete('v');
  // The destination document owns any update adoption. A running world
  // neither changes controller nor waits for a worker before leaving (G898).
  // Replacing releases WebKit's previous page rather than parking its heap in the back/forward cache.
  leaveSaved(() => { markUnload(`shard switch to ${request.to} (fresh page)`); location.replace(url.toString()); });
}
export function travel(request: TravelRequest): void {
  const manifest = findTitleManifest(request.to);
  if (manifest === undefined) return;
  service.travel({ ...request, to: manifest.slug });
}
export function consumeTravelHandoff(to: ShardSlug): TravelHandoff | null { return service.consume(to); }
/** Arrival goes through the target shard's Bag rules, never writes another shard's inventory directly. */
export function applyTravelCarry(handoff: TravelHandoff | null, inventory: Inventory): void {
  if (handoff?.to !== inventory.chunkId) return;
  for (const line of handoff.carry) inventory.add(line.id, line.count);
}
