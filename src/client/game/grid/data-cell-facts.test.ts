// @vitest-environment node
// SHARD-SOURCE SS-GP2: a grid data cell's ledger facts. A one-shard page records each fact the wire grants (`wirePage.facts`)
// into the page's `Ledger` under the shard's identity and refreshes progress; a grid copy recorded none, so a race finish or a
// quest fact filed on a grid cell never reached the progress view. While the feet stand in the copy a fact its server grants is
// recorded once under that copy's instance and shard; mid-crossing the receipt is another cell's, and none is recorded.
import { afterEach, expect, test } from 'vitest';
import { Scope } from '@wildshard/engine/app/scope';
import type { NetClient } from '@wildshard/engine/net/client';
import type { NetLedger } from '@wildshard/engine/net/ledgerWire';
import { SaveStore, type SaveStorage } from '@wildshard/engine/saves/store';
import type { LedgerRule } from '@wildshard/format/ledger';
import type { Shardfile } from '@wildshard/format/shardSchema';
import { Ledger } from '../../../shared/game/ledger';
import { hasLedger } from '../shardfile/wireFacts';
import { wirePage } from '../shardfile/wirePage';
import { installCellFacts } from './dataCellFacts';

const SLUG = 'fixture-copy', INSTANCE = 'fixture-copy-2', origin = { kind: 'engine', source: 'quests' } as const;
const rules: LedgerRule[] = [{ fact: 'race.arch', origin, rewards: [{ kind: 'achievement', id: 'arch-runner', title: 'Arch Runner', threshold: 1 }] }];
const source = { identity: { slug: SLUG, revision: 2 }, ledger: rules } as unknown as Shardfile;

/** A browser's storage, in memory. */
class Memory implements SaveStorage {
  private readonly rows = new Map<string, string>();
  get length(): number { return this.rows.size; }
  key(index: number): string | null { return [...this.rows.keys()][index] ?? null; }
  getItem(key: string): string | null { return this.rows.get(key) ?? null; }
  setItem(key: string, value: string): void { this.rows.set(key, value); }
  removeItem(key: string): void { this.rows.delete(key); }
}
/** The cell server's receipts, as a client hears them. */
class Wire {
  readonly heard = new Set<(receipt: NetLedger) => void>();
  onLedger(listener: (receipt: NetLedger) => void): () => void { this.heard.add(listener); return () => { this.heard.delete(listener); }; }
  grant(name: string, id: string): void { for (const hear of this.heard) hear({ kind: 'ledger', serial: 0, tick: 0, id, grant: 'fact', name, amount: 0, pending: false }); }
}

afterEach(() => { wirePage.unbind(); });

test('a fact the cell\'s server grants while the feet stand in it is recorded once under that copy\'s instance and shard', () => {
  expect(hasLedger(source)).toBe(true);
  expect(hasLedger({ ledger: [] })).toBe(false);
  const wire = new Wire();
  wirePage.client = wire as unknown as NetClient;
  const ledger = new Ledger(new SaveStore({ local: new Memory(), session: null }), [{ id: INSTANCE, shard: SLUG }], [{ shard: SLUG, revision: 2, rules }], []);
  const stay = new Scope('grid.data-facts.fixture');
  let here = true, refreshed = 0;
  installCellFacts(source, INSTANCE, stay, () => here, { ledger, refresh: () => { refreshed++; } });
  wire.grant('race.arch', 'receipt-1');
  wire.grant('race.arch', 'receipt-1'); // the same receipt again: one fact
  wire.grant('race.other', 'receipt-2'); // a fact this copy declares no rule for
  const facts = Object.values(ledger.state().facts);
  expect(facts.map(fact => [fact.instance, fact.shard, fact.revision, fact.name, fact.entity])).toEqual([[INSTANCE, SLUG, 2, 'race.arch', 'receipt-1']]);
  expect(ledger.state().achievements[JSON.stringify([SLUG, 'arch-runner'])]?.earned).toBe(true);
  expect(refreshed).toBe(2); // the progress view is told after each recorded fact
  // mid-crossing the wire is another cell's: its receipts are not this copy's
  here = false;
  wire.grant('race.arch', 'receipt-3');
  expect(Object.keys(ledger.state().facts)).toHaveLength(1);
  expect(refreshed).toBe(2);
  // leaving the copy ends the stay: nothing is listening
  stay.dispose();
  expect(wire.heard.size).toBe(0);
});
