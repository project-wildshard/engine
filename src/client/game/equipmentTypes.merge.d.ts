// The game's weapon slots, merged into the engine's equipment vocabulary (E434: a merge-only declaration file; the kit
// and shard projects include src/game/**/*.merge.d.ts, so every layer above sees the slot names).
import type { IconId } from '@wildshard/engine/ui/icons';

declare module '@wildshard/engine/combat/Equipment' {
  interface EquipmentSlotMap { crossbow: true; sword: true; rifle: true; 'sword-iron': true; bow: true; sabre: true; spear: true; empty: true }
  // oxlint-disable-next-line typescript/no-empty-object-type, typescript/no-empty-interface -- This declaration merges the icon library vocabulary into the engine extension point.
  interface EquipmentIconMap extends Record<IconId, true> {}
  interface EquipmentTouchMap { throwing: true }
}
