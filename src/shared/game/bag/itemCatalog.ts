import type { ItemRow } from './items';
import type { IconId } from '@wildshard/engine/ui/icons';

interface ItemInfo { label: string; icon: IconId; travels: boolean }
/** Each shard registers its own catalogue for the level lifetime. No inherited names are entries. */
export const ITEMS: Record<string, ItemInfo> = Object.create(null) as Record<string, ItemInfo>;
export function isItemId(id: string): boolean { return Object.hasOwn(ITEMS, id); }
interface Registration { readonly value: ItemInfo }
interface ItemOwners { readonly base: ItemInfo | undefined; readonly rows: Registration[] }
const owners = new Map<string, ItemOwners>();

/** Register a complete item for its owner's lifetime, preserving active prior owners. */
export function registerItemRow(row: ItemRow): () => void {
  if (row.label === undefined || row.icon === undefined) return () => undefined;
  if (Object.hasOwn(Object.prototype, row.id)) throw new Error('Reserved item identity');
  const id = row.id, state = owners.get(id) ?? { base: ITEMS[id], rows: [] };
  const registration: Registration = { value: { label: row.label, icon: row.icon, travels: row.travels ?? false } };
  state.rows.push(registration); owners.set(id, state); ITEMS[id] = registration.value;
  return () => {
    const index = state.rows.indexOf(registration); if (index === -1) return;
    state.rows.splice(index, 1);
    if (ITEMS[id] === registration.value) {
      const previous = state.rows[state.rows.length - 1]?.value ?? state.base;
      if (previous === undefined) Reflect.deleteProperty(ITEMS, id); else ITEMS[id] = previous;
    }
    if (state.rows.length === 0) owners.delete(id);
  };
}
