import type { ItemId } from '../../../client/game/Inventory';
import type { ItemRow } from './items';
import type { IconId } from '@wildshard/engine/ui/icons';

/** Each shard registers its own catalogue for the level lifetime. */
export const ITEMS = {} as Record<ItemId, { label: string; icon: IconId; travels: boolean }>;
export function isItemId(id: string): id is ItemId { return Object.hasOwn(ITEMS, id); }

/** A catalog entry follows the row's level scope; starter registrations may be replaced by a level. */
export function registerItemRow(row: ItemRow): () => void {
  if (row.label === undefined || row.icon === undefined) return () => undefined;
  const id = row.id as ItemId;
  const had = Object.hasOwn(ITEMS, id);
  const previous = ITEMS[id];
  const value = { label: row.label, icon: row.icon, travels: row.travels ?? false };
  ITEMS[id] = value;
  return () => { if (ITEMS[id] === value) { if (had) ITEMS[id] = previous; else Reflect.deleteProperty(ITEMS, id); } };
}
