// The game's equipment vocabulary, merged into the engine's (E434: a merge-only declaration file; the kit and shard
// projects include src/game/**/*.merge.d.ts, so every layer above sees it). Weapon ids are declared items (FP22e).
import type { EquipmentId } from '@wildshard/engine/combat/Equipment';
import type { IconId } from '@wildshard/engine/ui/icons';

declare module '@wildshard/engine/combat/Equipment' {
  // oxlint-disable-next-line typescript/no-empty-object-type, typescript/no-empty-interface -- Merge-only: every weapon id is a declared item.
  interface EquipmentSlotMap extends Record<`declared.${EquipmentId}`, true> {}
  // oxlint-disable-next-line typescript/no-empty-object-type, typescript/no-empty-interface -- This declaration merges the icon library vocabulary into the engine extension point.
  interface EquipmentIconMap extends Record<IconId, true> {}
  interface EquipmentTouchMap { throwing: true }
}
