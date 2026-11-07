import type { SaveStore } from '@wildshard/engine/saves/store';
import type { Shardfile } from '@wildshard/format/shardSchema';
import { Ledger, LedgerEmitter, type LedgerReceipt } from '../ledger';
import type { RuntimeFacts } from '../plugin/runtimeRows';

/** Check the profile slot without invoking its fresh-state fallback or granting a fact. */
export function admittedQuestLedger(saves: SaveStore): boolean { return new Ledger(saves, [], [], []).admitted; }

/** One declared ledger over the caller's original SaveStore and placement.
 * Runtime adapters and native page features share this exact grant owner. */
export function createQuestLedger(saves: SaveStore, source: Pick<Shardfile, 'identity' | 'ledger'>, instance: string): RuntimeFacts {
  const identity = { instance, shard: source.identity.slug, revision: source.identity.revision };
  const ledger = new Ledger(saves, [{ id: instance, shard: identity.shard }], [{ shard: identity.shard, revision: identity.revision, rules: source.ledger }], []);
  const emit = (name: string, entity: string): LedgerReceipt => {
    const rule = source.ledger.find((row) => row.fact === name);
    if (rule === undefined) throw new Error(`Undeclared ledger fact ${name}`);
    return new LedgerEmitter(ledger, { ...identity }, rule.origin, () => 0, []).emit(name, entity);
  };
  return Object.assign(emit, { flush: () => ledger.flush(), achievement: (id: string) => {
    const row = ledger.state().achievements[JSON.stringify([identity.shard, id])];
    return row === undefined ? undefined : { count: row.count, earned: row.earned };
  } });
}
