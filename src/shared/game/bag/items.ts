import type { IconId } from '@wildshard/engine/ui/icons';
/** Game-owned item registration contract. No shipped row enables travel yet. */
export interface ItemRow { id: string; travels?: boolean; label?: string; icon?: IconId }
export interface RegisteredItemRow extends ItemRow { travels: boolean }
export function normalizeItemRow(row: ItemRow): RegisteredItemRow { return { ...row, travels: row.travels ?? false }; }
