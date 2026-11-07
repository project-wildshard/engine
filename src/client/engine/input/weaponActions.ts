import { app } from '../app/runtime';
import type { Weapon } from '../../../shared/engine/combat/Weapon';

/** Additive contexts decide mode availability; equipment still owns holster/selection readiness. */
export function weaponActionGate(weapon: Weapon & { allowUnlocked: boolean }, player: { locked: boolean }): () => boolean {
  return () => weapon.enabled && (player.locked || weapon.allowUnlocked)
    && (weapon.row.ui.inputContext === undefined || app.input.active(weapon.row.ui.inputContext));
}
