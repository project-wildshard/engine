import type { AmmoRow } from '@wildshard/engine/combat/ammo';
import type { EquipmentRow } from '@wildshard/engine/combat/Equipment';
import { ItemCatalogue as FormatItemCatalogue } from '@wildshard/format/itemCatalogue';

/** One admitted item catalogue for equipment, ammunition and native inventory: format's reader (SDK-SPLIT SP5c, Q35), shared
 * with the build. Pine, Driftwood, Nalati and Nine share it; no state, clock or callback is installed. This types its rows as
 * the engine's `EquipmentRow` and `AmmoRow`, which shards widen by declaration merging. */
export class ItemCatalogue {
  private readonly catalogue: FormatItemCatalogue;
  constructor(input: unknown) { this.catalogue = new FormatItemCatalogue(input); }
  /** Resolve admitted equipment metadata without factories, callbacks or a second state owner. */
  equipment(id: string): EquipmentRow { return this.catalogue.equipment(id); }
  /** Page ammunition borrows the same admitted flight/target coefficients as native projectiles. */
  ammunition(id: string): ReadonlyMap<string, { row: AmmoRow; damage: { readonly default: number; readonly kinds: Readonly<Record<string, number>> } }> {
    return this.catalogue.ammunition(id);
  }
  /** Read the admitted saved-pack policy; NativeInventory remains the only stacking/trade state owner. */
  get inventory(): FormatItemCatalogue['inventory'] { return this.catalogue.inventory; }
}
