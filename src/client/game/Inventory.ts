import { ITEMS } from '../../shared/game/bag/itemCatalog';
import { WeightedTable, type WeightedRow } from '@wildshard/engine/ai/weighted';
import type { IconId } from '@wildshard/engine/ui/icons';
import { findTitleManifest } from './shard/titleList';
import { findShard } from './shard/registry';
import { inventorySave, saveSlug } from '../../shared/game/saves';
import type { ItemRow } from '../../shared/game/bag/items';
import { DEFAULT_PACK_SLOTS, addInventory, takeInventory } from '../../shared/game/inventoryLaw';
/**
 * Inventory — the pack: what harvesting a carcass leaves you with (venison, hides, tusks, antlers; on Driftwood Isle
 * crab claws and coconuts — the drowned sailor and captain fade, nothing to harvest, E318). Counts
 * only, 12 slots, one slot per item kind; persisted per shard ('ws.inventory.v1'). Weapons and ammo are not
 * here — the menu's Inventory tab reads those live from Weapons.
 *
 * Nalati has no pack at all (E314, Jake's pick C, art/loot/round-3-other-shards/board-2-nalati.jpg): its 12 kinds (wolf
 * pelt / fang, horsehair, balbal shard, grave dust, marmot fur, the 5 elites' trophies, the Golden King's plaque) were
 * never read by anything, so they are gone — an old save's copies are dropped on load (an id not in ITEMS), `slots` is 0
 * there and the Bag shows no PACK tab (src/client/engine/ui/Menu.ts). Nine Dragon Stack neither (E314 A): nothing can ever enter it.
 *
 * Pine Hollow's pack (E314, Jake's pick C, art/loot/round-3-other-shards/) holds only the 7 kinds Mott trades for
 * (PINE_PACK_KINDS): everything else a Pine kill or reward used to hand out (boar / elk meat, elk hide, bear claw,
 * antlers, amber heartwood, the elites' trophies) never enters it, and an old save's copies are dropped on load. With
 * one slot per kept kind the pack can never be full; the unlocks that used to ride in it ('warden-longbow') live in
 * Owned (src/shared/game/loot/Owned.ts) — `had(id)` lets the loadout move an old save's flag across.
 *
 *   inventory.add('venison', 1);   inventory.items → [{ id, count }] in the order first picked up
 *   inventory.harvest('elk', 'bull')   → what this shard's pack takes from that carcass (Pine Hollow: nothing)
 *   inventory.onChange = () => menu.refresh();
 */


export type ItemId = 'venison' | 'deer-hide' | 'boar-meat' | 'boar-hide' | 'boar-tusk' | 'antlers' | 'elk-meat' | 'elk-hide' | 'bear-pelt' | 'bear-claw'
  | 'crab-meat' | 'crab-claw' | 'crab-shell' | 'coconut' | 'monkey-fur' | 'silver-fur' | 'doubloon'
  // Pine Hollow's elite + boss trophies (PH-C2 / PH-C3, src/shards/pine-hollow/); 'warden-longbow' is the King's drop as a flag
  // until the longbow itself (Nalati's Bow.ts) is ported
  | 'ironhide-tusk' | 'ghost-antler' | 'blackpaw-claw' | 'imperial-crown' | 'amber-heartwood' | 'warden-longbow'
  // Pine Hollow's collectibles and the lodge (PH-C6 / C8, src/shards/pine-hollow/quest/): resin is the trader's currency-free swap
  // good, a ribbon is what a lodge contract pays
  | 'amber-resin' | 'lodge-ribbon';

/** Every eligible harvest row drops once, in the original pack order. */
const HARVEST: Readonly<Record<string, readonly WeightedRow<ItemId, string>[]>> = {
  deer: [{ item: 'venison', weight: 1 }, { item: 'deer-hide', weight: 1 }, { item: 'antlers', weight: 1, when: (v) => /stag|ghost/.test(v) }],
  boar: [{ item: 'boar-meat', weight: 1 }, { item: 'boar-hide', weight: 1 }, { item: 'boar-tusk', weight: 1, when: (v) => v !== 'sow' }],
  elk: [{ item: 'elk-meat', weight: 1 }, { item: 'elk-hide', weight: 1 }, { item: 'antlers', weight: 1, when: (v) => /bull|imperial/.test(v) }],
  bear: [{ item: 'bear-pelt', weight: 1 }, { item: 'bear-claw', weight: 1 }],
  crab: [{ item: 'crab-meat', weight: 1 }, { item: 'crab-claw', weight: 1 }, { item: 'crab-shell', weight: 1, when: (v) => v === 'big' }],
  monkey: [{ item: 'coconut', weight: 1 }, { item: 'silver-fur', weight: 1, when: (v) => v === 'elder' }, { item: 'monkey-fur', weight: 1, when: (v) => v !== 'elder' }],
};
/** what a carcass of (kind, variant) yields when harvested */
export function harvestOf(kind: string, variant?: string): ItemId[] {
  return new WeightedTable({ mode: 'each', rows: HARVEST[kind] ?? [] }).roll(variant ?? '', () => 0).flatMap((drop) => Array.from({ length: drop.count }, () => drop.item));
}

export const PACK_SLOTS: 12 = DEFAULT_PACK_SLOTS;
const inventoryManifest=(slug:string)=>findShard(slug)??findTitleManifest(slug);
/** Nalati (E314 C) and Nine Dragon (E314 A): no pack — nothing enters it, the Bag has no PACK tab */
const isNoPackChunk = (chunkId: string): boolean => inventoryManifest(saveSlug(chunkId))?.bag?.pack.slots === 0; // a level with no pack declares 0 slots (its manifest's bag)

export class Inventory {
  private counts: Partial<Record<ItemId, number>>;
  private order: ItemId[];
  /** kinds an older save held that this shard's pack no longer keeps (read once by the loadout's migration) */
  private legacy = new Set<ItemId>();
  onChange?: () => void;
  /** False once the server owns the pack (J130): a page shows it and saves none of it. */
  writes = true;

  readonly chunkId: string;
  constructor(chunkId: string) {
    this.chunkId = chunkId;
    const saved = inventorySave.read(saveSlug(chunkId)) as { counts: Partial<Record<ItemId, number>>; order: ItemId[] };
    this.counts = saved.counts;
    this.order = [];
    for (const id of saved.order) {
      if (!(id in ITEMS)) { delete this.counts[id]; continue; } // a kind the game no longer has (Nalati's, E314 C)
      if (this.keeps(id)) this.order.push(id);
      else { if ((this.counts[id] ?? 0) > 0) this.legacy.add(id); delete this.counts[id]; }
    }
  }

  /** does this shard's pack take `id` at all? (Pine Hollow: only PINE_PACK_KINDS; Nalati, Nine Dragon: nothing) */
  keeps(id: ItemId): boolean { return !isNoPackChunk(this.chunkId) && (inventoryManifest(saveSlug(this.chunkId))?.bag?.pack.keeps?.includes(id) ?? true); }
  /** what this shard's pack takes from a carcass: harvestOf, less the kinds it does not keep (empty = no [E] Harvest) */
  harvest(kind: string, variant?: string): ItemId[] { return harvestOf(kind, variant).filter((id) => this.keeps(id)); }
  /** did the save this pack loaded hold `id`, a kind the pack no longer keeps? ('warden-longbow' → Owned) */
  /** Legacy ownership reads accept row identities, including items absent from the live pack catalogue. */
  had(id: string): boolean { const legacy: ReadonlySet<string> = this.legacy; return legacy.has(id); }

  private save() { if (this.writes) inventorySave.write({ counts: this.counts, order: this.order }, saveSlug(this.chunkId)); }
  /** Confirm the current pack is durable before leaving its live cell; failed storage remains retryable. */
  checkpoint(): boolean { return !this.writes || inventorySave.write({ counts: this.counts, order: this.order }, saveSlug(this.chunkId)); }
  /** Take the pack from who owns it (J130): it tells who listens. */
  mirror(counts: ReadonlyMap<string, number>): void {
    const known = [...counts.keys()].filter((id): id is ItemId => id in ITEMS);
    this.counts = Object.fromEntries(known.map(id => [id, counts.get(id) ?? 0]));
    this.order = [...this.order.filter(id => counts.has(id)), ...known.filter(id => !this.order.includes(id))];
    this.onChange?.();
  }

  /** false, and nothing added, for a kind this shard does not keep or a new kind with every slot taken */
  add(id: ItemId, n = 1): boolean {
    if (!addInventory({ counts: this.counts, order: this.order }, { has: (kind) => kind in ITEMS, keeps: (kind) => this.keeps(kind), slots: () => this.slots }, id, n)) return false;
    this.save(); this.onChange?.();
    return true;
  }
  /** this shard's pack size (0: no pack, no PACK tab — Nalati, Nine Dragon) */
  get slots(): number { return inventoryManifest(saveSlug(this.chunkId))?.bag?.pack.slots ?? (isNoPackChunk(this.chunkId) ? 0 : PACK_SLOTS); }
  /** how many of `id` the pack holds */
  count(id: ItemId): number { return this.counts[id] ?? 0; }
  /** take `n` of `id` out of the pack (a trade); false, and nothing taken, when there are fewer. At 0 the slot frees up. */
  take(id: ItemId, n = 1): boolean {
    const state = { counts: this.counts, order: this.order };
    if (!takeInventory(state, id, n)) return false;
    if (n <= 0) return true;
    this.order = state.order;
    this.save(); this.onChange?.();
    return true;
  }
  get items(): { id: ItemId; count: number; label: string; icon: IconId }[] { return this.order.map((id) => ({ id, count: this.counts[id] ?? 0, ...ITEMS[id] })); }
  /** Move all travel-enabled lines together; one save write, preserving local lines and order. */
  takeTravel(rows: ReadonlyMap<string, ItemRow>): { id: ItemId; count: number }[] {
    const carry = this.items.filter((line) => (rows.get(line.id)?.travels ?? ITEMS[line.id].travels) && line.count > 0).map(({ id, count }) => ({ id, count }));
    if (carry.length === 0) return carry;
    const moved = new Set(carry.map((line) => line.id));
    for (const { id } of carry) delete this.counts[id];
    this.order = this.order.filter((id) => !moved.has(id));
    this.save(); this.onChange?.();
    return carry;
  }
  get total(): number { return this.order.reduce((s, id) => s + (this.counts[id] ?? 0), 0); }
}
