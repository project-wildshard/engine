import { actRoutes } from '@wildshard/engine/sim/actRoutes';
import { questBooks } from '@wildshard/engine/quest/players';
import type { SimHost } from '@wildshard/engine/sim';
import { itemPickupFloor, ITEM_PICKUP_HOVER } from '@wildshard/engine/world/interact/pickup';
import { pickPrompt } from '@wildshard/engine/world/interact/prompts';
import type { EliteCore, EliteCoreActor, EliteCoreHooks, EliteCoreScript } from '../../../shared/game/eliteSystem';

/** The eye a press reaches from, over a player's feet. */
const REACH_EYE = 1.68;
/** The orb's prompt stands this far over its hover, and reaches this far: `WeaponPickup`'s defaults. */
const PROMPT_ABOVE = 0.5, PROMPT_RADIUS = 1.8;
type Body = EliteCoreActor & { readonly position: { readonly x: number; readonly y: number; readonly z: number } };

/** SC10: the flag in each player's own book that says they took this lair's skin, in a served world. */
export const eliteSkinFlag = (id: string): string => `elite.${id}.skin`;

/**
 * A first kill's orb on the server (J130). The rules say a lair's skin is untaken as it falls; this lays the orb out on the lair's
 * row, and a press in reach takes it. What the skin does to what's in hand is the page's, as a boss's is: the server keeps that it
 * went, so the next kill drops none.
 *
 * SERVER-CELLS SC10 (J328): a served world is never rebuilt, so there the skin is each player's own: a kill lays the orb out while a
 * player present has not taken it, a press takes it for the presser (a flag in their own book, which goes with their save), and an
 * owner's press is refused. The lair's world record (`skinTaken`) is a page's or a tape's alone.
 */
export function eliteDrops<S extends EliteCoreScript<Body>>(host: SimHost): { readonly hooks: EliteCoreHooks<S>; readonly bind: (core: EliteCore<S>) => void } {
  const routes = actRoutes(host);
  let core: EliteCore<S> | null = null;
  const owns = (player: string, id: string): boolean => { const books = questBooks(host), flag = eliteSkinFlag(id); books.claim([flag]); return books.of(player).flags.has(flag); };
  const lacking = (id: string): boolean => [...host.players.keys()].some(player => !host.parked.has(player) && !owns(player, id));
  return { bind: owner => { core = owner; host.events.on('world.slept', ({ seconds }) => { owner.slept(seconds); }, host.scope); }, hooks: { fell: (entry, first) => {
    const { animal, def } = entry.script, served = host.respawn.served;
    if (animal === null || def.drop === undefined || def.drop.skin === null || !(served ? lacking(def.id) : first)) return;
    const at = itemPickupFloor(host.physics, animal.position);
    entry.drop = { x: at.x, y: at.y + ITEM_PICKUP_HOVER, z: at.z };
    routes.claims.set(`${def.id}.reward`, player => {
      const feet = host.players.get(player)?.position, { drop } = entry;
      if (feet === undefined || drop === null || (served && owns(player, def.id))) return;
      if (pickPrompt([{ position: { x: drop.x, y: drop.y + PROMPT_ABOVE, z: drop.z }, radius: PROMPT_RADIUS }], { x: feet.x, y: feet.y + REACH_EYE, z: feet.z }, host.physics) === undefined) return;
      entry.drop = null;
      if (served) { questBooks(host).of(player).flags.set(eliteSkinFlag(def.id)); return; }
      const saved = core?.record(def.id);
      if (saved !== undefined) saved.skinTaken = true;
      core?.save();
    });
  } } };
}
