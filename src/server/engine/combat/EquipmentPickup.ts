import type { Interactable } from '../../../shared/engine/world/interact/types';
import type { LoadoutSpec } from '../../../shared/engine/level/spec';
import type { EquipmentRow } from '../../../shared/engine/combat/Equipment';

/** A content-owned display. The equipment service owns its grant and lifetime. */
export interface EquipmentPickup {
  readonly interactable: Interactable;
  onPickup?: (() => void) | undefined;
  onNear?: ((inside: boolean) => void) | undefined;
  update: (dt: number, t: number) => void;
  dispose: () => void;
}
/** how a weapon lies in the world before it is owned: its prompt, its toast and how its pickup is built */
export interface EquipmentPickupSpec {
  owned: string;
  prompt: string;
  toast: string;
  create: (at: string, prompt: string) => EquipmentPickup | null;
}
export interface EquipmentPickupHost {
  prompts: Interactable[];
  owned: { has: (id: string) => boolean; grant: (id: string) => void };
  onNear: (inside: boolean) => void;
  onPickup: (row: EquipmentRow, toast: string) => void;
  /** A harness-selected slot is held immediately, without granting saved ownership. */
  hold?: string | undefined;
}
export type PickupLoadout = Pick<LoadoutSpec, 'pickups'>;
