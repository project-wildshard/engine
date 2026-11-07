import { Group } from 'three';
import { Weapon, type WeaponState } from '@wildshard/engine/combat/Weapon';

/** Inert, asset-free equipment satisfies the current session's mandatory primary port. */
export class EmptyEquipment extends Weapon {
  readonly model: Group = new Group();
  readonly state: WeaponState = { ammo: undefined, magazine: 0, reserve: 0, loaded: false, reloading: false, reloadProgress: 0, ads: false };
  adsHeld = false;
  aimInfo = null;
  holster = 0;
  enabled = false;
  constructor() {
    super({ id: 'weapon.empty', legacySlot: 'empty',
      ui: { name: 'Unarmed', icon: 'you', touch: 'melee', lockOn: false, melee: false, tracers: false, swapIcon: '' },
      meta: { name: 'Unarmed', icon: 'you', blurb: 'No equipment.', category: 'weapon' } });
  }
  tryFire(): void { /* No authored action in the minimal world. */ }
  update(): void { /* No simulation or view work. */ }
}
