import { Group } from 'three';
import type { SwordArms, SwordWorld } from '../../src/client/engine/combat/view/melee';
import { fakeWorld } from '@wildshard/engine/test/world';

/** Real native sword dependencies without a renderer or content model. */
export function heldSwordWorld(): {world: SwordWorld; arms: SwordArms; dispose: () => void} {
  const native = fakeWorld(), game = native.game.asGame();
  Object.defineProperty(game, 'level', {value:{camera:{portraitFov:78}}});
  const arms: SwordArms = { root:new Group(), play:()=>undefined, update:()=>undefined, blade:()=>undefined };
  return {world:{...native,game},arms,dispose:()=>{native.game.playerScope.dispose();}};
}
