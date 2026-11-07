// Declared content uses stable namespaced equipment slots, independently of authored item ordering.
import type { EquipmentId } from '@wildshard/engine/combat/Equipment';

declare module '@wildshard/engine/combat/Equipment' {
  // oxlint-disable-next-line typescript/no-empty-object-type, typescript/no-empty-interface -- Merge-only extension vocabulary for declared equipment slots.
  interface EquipmentSlotMap extends Record<`declared.${EquipmentId}`, true> {}
}
