
import type { NetClient } from '@wildshard/engine/net/client';

/** Coins that are this player's, and where they fell. */
export interface LootPayout { readonly at: { readonly x: number; readonly y: number; readonly z: number }; readonly coins: number }
/**
 * E6 COMBAT, J105: the one thing the loot's views ask of the world: a server's `reward` events, which are already this
 * player's alone.
 */
export interface LootFeed {
  /** Call for each payout; returns the unsubscribe. */
  readonly onPayout: (pay: (payout: LootPayout) => void) => () => void;
  /** What the shard's debug handle shows of the law behind this feed. */
  readonly debug: Readonly<Record<string, unknown>>;
}
/** The server's payouts to this client: a body's coins, where the client last drew it. */
export function netLootFeed(client: Pick<NetClient, 'onCombat' | 'fields' | 'latest'>): LootFeed {
  return { debug: {}, onPayout: pay => client.onCombat(event => {
    if (event.kind !== 'reward') return;
    const row = client.latest === null ? null : client.fields(client.latest, event.body), { x, y, z } = row ?? {};
    pay({ at: { x: typeof x === 'number' ? x : 0, y: typeof y === 'number' ? y : 0, z: typeof z === 'number' ? z : 0 }, coins: event.coins });
  }) };
}
