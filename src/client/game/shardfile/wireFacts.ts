// SHARD-SOURCE SS-GP2: the declared facts the wire grants this player, into the page's profile `Ledger`, one function for a
// one-shard page (`client.ts`) and a grid data cell (`grid/dataCellFacts.ts`), so the grid cannot miss them again. The
// server's ledger decides, and a page keeps its word where Progress reads: a feat counts and tells once, off its receipt.
import type { Scope } from '@wildshard/engine/app/scope';
import type { SaveStore } from '@wildshard/engine/saves/store';
import type { Shardfile } from '@wildshard/format/shardSchema';
import { Ledger, type LedgerCatalogueItem } from '../../../shared/game/ledger';
import { wirePage } from './wirePage';

/** Where a fact was filed: the placement, its shard and that shard's revision. */
export interface FactIdentity { readonly instance: string; readonly shard: string; readonly revision: number }

/** Whether a source maps any fact to a reward. */
export const hasLedger = (source: Pick<Shardfile, 'ledger'>): boolean => source.ledger.length > 0;

/** The page's profile ledger for one placement of `source`. */
export function placementLedger(saves: SaveStore, source: Pick<Shardfile, 'ledger'>, identity: FactIdentity, catalogue: readonly LedgerCatalogueItem[]): Ledger {
  return new Ledger(saves, [{ id: identity.instance, shard: identity.shard }], [{ shard: identity.shard, revision: identity.revision, rules: source.ledger }], catalogue);
}

/** Record each fact the wire grants while `here` holds, under `identity`, until `scope` ends; `refresh` tells progress. */
export function recordWireFacts(source: Pick<Shardfile, 'ledger'>, identity: FactIdentity, ledger: Pick<Ledger, 'record'>, scope: Scope,
  ports: { readonly here: () => boolean; readonly refresh: () => void }): void {
  wirePage.facts(scope, (name, id) => {
    if (!ports.here()) return;
    const rule = source.ledger.find(row => row.fact === name);
    if (rule === undefined) return;
    ledger.record({ ...identity, origin: rule.origin, tick: 0, ordinal: 0, name, entity: id });
    ports.refresh();
  });
}
