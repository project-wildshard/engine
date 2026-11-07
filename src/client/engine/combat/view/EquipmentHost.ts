import type { Game } from '../../core/Game';
import type { Player } from '../../player/Player';
import type { Physics } from '../../../../shared/engine/physics/Physics';
import type { SwordArms } from './melee';
import type { LockOnSystem } from '../../player/LockOnTarget';
import type { Group } from 'three';

/** Live scene ports available after the loadout, before a plugin's play hook. */
export interface EquipmentHost {
  /** Camera-space models; the engine owns their shared depth-clear pass. */
  viewmodel: Group;
  game: Game; player: Player; physics: Physics; arms: SwordArms | null; lock: LockOnSystem;
  toast: (message: string) => void;
  enabled: () => boolean;
}
