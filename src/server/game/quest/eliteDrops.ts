import { actRoutes } from '@wildshard/engine/sim/actRoutes';
import type { SimHost } from '@wildshard/engine/sim';
import { itemPickupFloor, ITEM_PICKUP_HOVER } from '@wildshard/engine/world/interact/pickup';
import { pickPrompt } from '@wildshard/engine/world/interact/prompts';
import type { EliteCore, EliteCoreActor, EliteCoreHooks, EliteCoreScript } from '../../../shared/game/eliteSystem';

/** The eye a press reaches from, over a player's feet. */
const REACH_EYE = 1.68;
/** The orb's prompt stands this far over its hover, and reaches this far: `WeaponPickup`'s defaults. */
const PROMPT_ABOVE = 0.5, PROMPT_RADIUS = 1.8;
type Body = EliteCoreActor & { readonly position: { readonly x: number; readonly y: number; readonly z: number } };

/**
 * A first kill's orb on the server (J130). The rules say a lair's skin is untaken as it falls; this lays the orb out on the lair's
 * row, and a press in reach takes it. What the skin does to what's in hand is the page's, as a boss's is: the server keeps that it
 * went, so the next kill drops none.
 */
export function eliteDrops<S extends EliteCoreScript<Body>>(host: SimHost): { readonly hooks: EliteCoreHooks<S>; readonly bind: (core: EliteCore<S>) => void } {
  const routes = actRoutes(host);
  let core: EliteCore<S> | null = null;
  return { bind: owner => { core = owner; }, hooks: { fell: (entry, first) => {
    const { animal, def } = entry.script;
    if (!first || animal === null || def.drop === undefined || def.drop.skin === null) return;
    const at = itemPickupFloor(host.physics, animal.position);
    entry.drop = { x: at.x, y: at.y + ITEM_PICKUP_HOVER, z: at.z };
    routes.claims.set(`${def.id}.reward`, player => {
      const feet = host.players.get(player)?.position, { drop } = entry;
      if (feet === undefined || drop === null) return;
      if (pickPrompt([{ position: { x: drop.x, y: drop.y + PROMPT_ABOVE, z: drop.z }, radius: PROMPT_RADIUS }], { x: feet.x, y: feet.y + REACH_EYE, z: feet.z }, host.physics) === undefined) return;
      entry.drop = null;
      const saved = core?.record(def.id);
      if (saved !== undefined) saved.skinTaken = true;
      core?.save();
    });
  } } };
}
