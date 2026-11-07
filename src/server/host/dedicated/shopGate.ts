import type { NetTickInput } from '@wildshard/engine/net/room';
import { nativeQuestPrompts } from '@wildshard/engine/game/quest/nativeComposition';
import type { SimHost } from '@wildshard/engine/sim';
import { actRoutes } from '@wildshard/engine/sim/actRoutes';

/** How far a shopper may step from their seller before the panel shuts, as a multiple of the prompt's reach. */
const PANEL_REACH = 2;
const away = (a: { readonly x: number; readonly z: number }, b: { readonly x: number; readonly z: number }): number => Math.hypot(a.x - b.x, a.z - b.z);

/**
 * E7.7: a phone may buy only at a seller, with that seller's panel open, because `buy` alone names no seller and a client could spend from
 * anywhere (flip audit N8). A page opens its panel at the seller's prompt and shuts it on walking off, and neither is on the wire, so the
 * server keeps the same rule from the feet it holds. The seller is the shard's one unnamed prompt. A world with goods and no such prompt
 * sells nothing: every shard fails closed.
 */
export class ShopGate {
  private readonly host: SimHost;
  private readonly open = new Set<string>();
  constructor(host: SimHost) {
    this.host = host;
    const routes = actRoutes(host), { buy } = routes;
    if (buy !== null) routes.buy = (player, good) => { if (this.open.has(player)) buy(player, good); else routes.refused++; };
  }
  /** Before a tick's purchases: who has come to the seller, and who has walked off. */
  step(inputs: readonly NetTickInput[]): void {
    const unnamed = nativeQuestPrompts(this.host).filter(prompt => prompt.id === null), [seller] = unnamed;
    if (seller === undefined || unnamed.length !== 1) return;
    for (const { player } of inputs) {
      const feet = this.host.players.get(player)?.position;
      if (feet === undefined) continue;
      const from = away(feet, seller.position);
      if (from <= seller.radius) this.open.add(player); else if (from > seller.radius * PANEL_REACH) this.open.delete(player);
    }
    for (const player of this.open) if (!this.host.players.has(player)) this.open.delete(player);
  }
}
