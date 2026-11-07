import { Equipment } from './Equipment';
import type { Action } from '../../../client/engine/input/InputService';

export type EquipmentAction = 'bolt.cycle' | 'attack' | 'reload' | 'aim' | 'heavy' | 'hover' | 'lock' | 'jump' | 'swap' | 'swap.next' | 'swap.prev' | 'swap.ui' | `swap.slot.${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9}` | `swap.weapon.${string}`;
export abstract class Tool extends Equipment {
  abstract readonly slot: 'tool' | 'offhand';
  abstract readonly actions: readonly Action[];
}
