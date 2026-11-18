// SHARD-SOURCE SS-GP2: a data cell's ledger facts inside the grid. A one-shard page records each fact the wire grants into the
// page's `Ledger` under the shard's identity and refreshes progress (`client.ts`, `recordWireFacts`); a grid copy recorded none,
// so a race finish or a quest fact filed on a grid cell never reached the progress view. While the feet stand in the copy a
// fact is recorded under that copy's instance and shard; mid-crossing the receipt is another cell's, so none is recorded.
import type { Scope } from '@wildshard/engine/app/scope';
import type { SaveStore } from '@wildshard/engine/saves/store';
import type { Shardfile } from '@wildshard/format/shardSchema';
import type { Ledger, LedgerCatalogueItem } from '../../../shared/game/ledger';
import { placementLedger, recordWireFacts } from '../shardfile/wireFacts';

/** The ledger the facts go into and what tells progress: the page's (`enterDataCellFacts`), or a test's. */
export interface DataCellFactPorts { readonly ledger: Pick<Ledger, 'record'>; readonly refresh: () => void }

const identityOf = (source: Pick<Shardfile, 'identity'>, instance: string): { instance: string; shard: string; revision: number } =>
  ({ instance, shard: source.identity.slug, revision: source.identity.revision });

/** Install a copy's facts for one stay in it. `here` says whether the wire is this cell's. */
export function installCellFacts(source: Pick<Shardfile, 'ledger' | 'identity'>, instance: string, stay: Scope, here: () => boolean, ports: DataCellFactPorts): void {
  recordWireFacts(source, identityOf(source, instance), ports.ledger, stay, { here, refresh: ports.refresh });
}

/** What the facts read off the page: its saves, the platform's catalogue and its progress view. */
export interface DataCellFactPage {
  readonly saves: SaveStore; readonly catalogue: readonly LedgerCatalogueItem[];
  readonly progress: () => { readonly refreshLedger: () => void } | undefined;
}

/** The page's install: the profile ledger for this copy's placement, for the stay. */
export function enterDataCellFacts(source: Pick<Shardfile, 'ledger' | 'identity'>, page: DataCellFactPage, stay: Scope, instance: string, here: () => boolean): void {
  const ledger = placementLedger(page.saves, source, identityOf(source, instance), page.catalogue);
  installCellFacts(source, instance, stay, here, { ledger, refresh: () => { page.progress()?.refreshLedger(); } });
}
