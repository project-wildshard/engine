import type { LedgerFiling } from '@wildshard/engine/net/ledgerBook';
import type { SimHost } from '@wildshard/engine/sim';
import type { HeadlessEffect } from '../../../shared/host/tickProtocol';

/** What the durable ledger answers a fact with. */
interface DurableReceipt { readonly id: string; readonly status: 'granted' | 'duplicate' | 'pending' }
/** Whose grant an effect is. Coins name their player; a quest's fact is filed under `player:quest` for all but the first player (DeclaredQuests), and anything else stays with that first player. */
function ownerOf(host: SimHost, first: string, entity: string): string {
  if (host.players.has(entity)) return entity;
  for (const id of host.players.keys()) if (entity.startsWith(`${id}:`)) return id;
  return first;
}

/**
 * P1-E5.2c (M8): a tick's ledger effects as filings, one per grant, each to its own player (J105, J106). The first player's
 * declared facts go through the durable ledger, whose receipt id is the grant's identity: an entitled fact comes back
 * `duplicate` and files nothing, so a replayed tick pays no one twice. Other players' facts and all coins take their id from
 * the tick; coins and items are already capped where they are rolled. A store per player is the MMO plan's.
 */
export function ledgerFilings(host: SimHost, first: string, effects: readonly HeadlessEffect[], durable: ((name: string, entity: string) => DurableReceipt | null) | null): LedgerFiling[] {
  const out: LedgerFiling[] = [], tick = host.state.tick;
  effects.forEach((effect, ordinal) => {
    if (effect.kind !== 'fact' && effect.kind !== 'coins' && effect.kind !== 'item') return;
    const player = ownerOf(host, first, effect.actorId), id = `${String(tick)}.${String(ordinal)}.${effect.kind}`;
    if (effect.kind === 'coins') { out.push({ player, id, tick, grant: 'coins', name: 'coins', amount: effect.amount, pending: false }); return; }
    if (effect.kind === 'item') { out.push({ player, id, tick, grant: 'item', name: effect.item, amount: effect.count, pending: false }); return; }
    const receipt = player === first ? durable?.(effect.name, effect.actorId) ?? null : null;
    if (receipt?.status === 'duplicate') return;
    out.push({ player, id: receipt?.id ?? id, tick, grant: 'fact', name: effect.name, amount: 1, pending: receipt?.status === 'pending' });
  });
  return out;
}
