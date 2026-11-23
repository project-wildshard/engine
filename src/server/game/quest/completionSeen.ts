import type { CompletionRows } from '@wildshard/format/completion';
import type { Shardfile } from '@wildshard/format/shardSchema';
import type { SimHost } from '@wildshard/engine/sim';
import { actRoutes } from '@wildshard/engine/sim/actRoutes';
import { questBooks } from '@wildshard/engine/quest/players';
import { defaultCompletionRows } from '../../../shared/game/quest/defaultCard';
import type { ShardFolder } from '../../../shared/game/shardfile/shardFolder';

/** The card a shard's page opens: its declared `ui/completion`, else the engine's default card (SHARD-COMPAT CP6). */
export function completionCardRows(product: Pick<ShardFolder, 'has' | 'section'> | undefined, shard: Pick<Shardfile, 'identity' | 'quests'>): Pick<CompletionRows, 'doneFlag' | 'seenFlag'> | undefined {
  if (product?.has('ui/completion') === true) return product.section('ui/completion');
  return defaultCompletionRows(shard.identity.slug, shard.identity.name, shard.quests.quests);
}

/**
 * A completion card writes its seen flag on the page, and the page sends it as `story:<flag>` (meta QA 2026-11-22, the card
 * re-opened on every entry: only the chapters answered `story`, for a flag a nearby talk sets, so the server dropped it and
 * the page's write lapsed). The server takes the seen flag from a player who holds the card's done flag, as that player's
 * own, so it lands in their save; every other story flag goes on to the chapters as before.
 */
export function bindCompletionSeen(host: SimHost, rows: Pick<CompletionRows, 'doneFlag' | 'seenFlag'> | undefined): void {
  if (rows === undefined) return;
  const books = questBooks(host), routes = actRoutes(host), story = routes.story;
  books.claim([rows.seenFlag]);
  routes.story = (player, flag) => {
    if (flag !== rows.seenFlag) { story?.(player, flag); return; }
    const book = books.of(player);
    if (book.flags.has(rows.doneFlag)) book.flags.set(flag);
  };
}
