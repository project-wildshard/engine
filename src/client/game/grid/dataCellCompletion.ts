// SHARD-SOURCE SS-GP4a: a data cell's completion card inside the grid. A one-shard page installs its declared card
// (`client.ts`, `installCompletion`) when `ui/completion` triggers on the quest; a grid copy had none, so the Template's
// "A first adventure · complete" card (and its pause-menu row) never opened on a grid cell (GRID-CELL-PARITY row 35).
// While the feet stand in the copy the card reads the cell server's flags (the stay's wire book) and opens once the done
// flag is up; the card, its system and its menu row all leave with the stay.
import type { Scope } from '@wildshard/engine/app/scope';
import type { CompletionRows } from '@wildshard/format/completion';
import type { Flags } from '@wildshard/engine/world/interact/flags';
import type { Shardfile } from '@wildshard/format/shardSchema';
import { installCompletion, type Completion, type CompletionContext, type CompletionProgress } from '../complete/declared';
import { wirePage } from '../shardfile/wirePage';
import type { RegionalRuntimePage } from './regionalRuntime';
import { stayContext } from './stayContext';

/** The card rows a copy's folder declares, when they open on the quest (a toast-only card stays the one-shard page's). */
export function cellCompletionRows(folder: { has: (name: 'ui/completion') => boolean; section: (name: 'ui/completion') => CompletionRows }): CompletionRows | null {
  if (!folder.has('ui/completion')) return null;
  const rows = folder.section('ui/completion');
  return rows.trigger === 'quest' ? rows : null;
}

/** The page owners the card borrows: the page's (`enterDataCellCompletion`), or a test's. */
export interface DataCellCompletionPorts {
  readonly context: Omit<CompletionContext, 'scope' | 'product' | 'manifest'>;
  readonly progress: CompletionProgress | undefined;
}

/** Install a copy's card for one stay in it, on `flags` (the stay's book of the cell server's flags). */
export function installCellCompletion(source: Pick<Shardfile, 'identity'>, rows: CompletionRows, stay: Scope, flags: Flags, ports: DataCellCompletionPorts): Completion {
  const context: CompletionContext = { ...ports.context, scope: stay, manifest: { slug: source.identity.slug },
    product: { section: () => rows } as unknown as CompletionContext['product'] };
  return installCompletion(context, flags, ports.progress, undefined, undefined, rows);
}

/** The page's install: the card on the page's play owner, its system named for the cell, all bound to the stay. */
export function enterDataCellCompletion(source: Pick<Shardfile, 'identity'>, rows: CompletionRows, page: Pick<RegionalRuntimePage, 'context' | 'play'>, stay: Scope,
  instance: string, here: () => boolean): void {
  const at = stayContext(page.context, stay, instance);
  installCellCompletion(source, rows, stay, wirePage.book(source.identity.slug, stay, here()), { context: { system: at.system, game: at.game }, progress: page.play.progress });
}
