import type { AmmoRow } from '@wildshard/engine/combat/ammo';
import type { EquipmentRow } from '@wildshard/engine/combat/Equipment';
import { parseItems } from '@wildshard/format/items';

/** One admitted item catalogue for equipment, ammunition and native inventory.
 * Pine, Driftwood, Nalati and Nine share this metadata reader; no state, clock or callback is installed. */
export class ItemCatalogue {
  private readonly items: ReturnType<typeof parseItems>;
  constructor(input: unknown) { this.items = parseItems(input); }
  /** Resolve admitted equipment metadata without factories, callbacks or a second state owner.
   * Native constructors keep their profile and pickup service; this supplies only portable presentation. */
  equipment(id: string): EquipmentRow {
    const item = this.items.rows.find(row => row.id === id);
    if (item?.equipment === undefined) throw new Error(`Missing declared equipment presentation: ${id}`);
    const { id: equipmentId, cues, ...presentation } = item.equipment;
    const cueId = (value: string): `cue.${string}` => `cue.${value.slice(4)}`;
    return { ...presentation, id: item.kind === 'weapon' ? `weapon.${equipmentId.slice(7)}` : `tool.${equipmentId.slice(5)}`,
      ...(cues === undefined ? {} : { cues: { fire: cueId(cues.fire), reload: cueId(cues.reload), impact: cueId(cues.impact),
        ...(cues.dry === undefined ? {} : { dry: cueId(cues.dry) }), ...(cues.hit === undefined ? {} : { hit: cueId(cues.hit) }),
        ...(cues.heavy === undefined ? {} : { heavy: cueId(cues.heavy) }),
        ...(cues.charge === undefined ? {} : { charge: Object.fromEntries(Object.entries(cues.charge).map(([phase, value]) => [phase, cueId(value)])) }) } }) };
  }

  /** Page ammunition borrows the same admitted flight/target coefficients as native projectiles.
   * The returned rows retain the weather convention (absolute wet multipliers) and carry no effects or clocks. */
  ammunition(id: string): ReadonlyMap<string, { row: AmmoRow; damage: { readonly default: number; readonly kinds: Readonly<Record<string, number>> } }> {
    const item = this.items.rows.find(row => row.id === id);
    if (item?.kind !== 'weapon' || item.ranged === undefined) throw new Error('Missing declared ammunition');
    return new Map(item.ranged.ammunition.map(ammo => {
      if (ammo.presentation === undefined) throw new Error('Missing declared ammunition presentation');
      const ammoId = `ammo.${ammo.id}` as const;
      return [ammo.id, { row: { id: ammoId, ...ammo.presentation, flight: { ...ammo.flight }, tags: [ammoId],
        ...(ammo.wet === undefined ? {} : { wet: { gravity: 1 + ammo.wet.gravity, drag: 1 + ammo.wet.drag } }) },
      damage: { default: 1, kinds: Object.fromEntries(ammo.targets.map(kind => [kind, ammo.damage])) } }];
    }));
  }

  /** Read the admitted saved-pack policy; NativeInventory remains the only stacking/trade state owner. */
  get inventory(): NonNullable<ReturnType<typeof parseItems>['loadout']['inventory']> {
    const profile = this.items.loadout.inventory;
    if (profile === undefined) throw new Error('Missing declared inventory policy');
    return profile;
  }
}
