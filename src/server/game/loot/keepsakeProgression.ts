// SERVER-PARITY SS3b (meta docs/plans/SERVER-PARITY-PLAN.md): the server half of `quest.continuation`'s keepsakes. The page's
// keepsakes (client/game/compendium/keepsakes.ts) grant each progression state's rewards (Driftwood's sea glass charms: +10 max
// health at 5 glass) as the flags count up; a room's player held only what the page granted itself, so the server's owned book,
// the one its effects read, never had them. The room now pays each seated player off their own book's flags, by the same law.
import * as v from 'valibot';
import { LootProgressionSchema } from '@wildshard/format/lootBag';
import type { Shardfile } from '@wildshard/format/shardSchema';
import type { SimHost } from '@wildshard/engine/sim';
import { questBooks } from '@wildshard/engine/quest/players';
import { progressionState } from '../../../shared/game/compendium/keepsakeProgression';
import { isOwnedId, type Owned, type OwnedId } from '../../../shared/game/loot/Owned';
import { registerInstalled } from '../shardfile/installedSides';

/**
 * Each step, grant every seated player (`seated`: the players whose goods are already open) the progression rewards their
 * book's flags have earned, whenever that book moved: a flag, a restore or an imported save each move it. It never opens a
 * seat itself, so a room's parked lead body is paid only once someone sits in it. Returns a player's release (they left: the
 * next occupant is paid afresh), or null on a shard with no progression.
 */
export function installKeepsakeProgression(host: SimHost, source: Shardfile, seated: () => Iterable<readonly [string, Owned]>): ((player: string) => void) | null {
  // a barter economy (Pine's) has no progression; a loot economy's is read by its own admitted schema
  const raw = source.rows.loot.find(row => row.economy !== undefined)?.economy, declared = raw === undefined || !('progression' in raw) ? undefined : raw.progression;
  const rows = declared === undefined ? undefined : v.parse(LootProgressionSchema, declared);
  if (rows === undefined || rows.flags.length === 0) return null;
  // the page's declaredLootEconomy refuses an unknown reward id; so does the room, at install
  const states = rows.states.map(state => state.earned.map(reward => { if (!isOwnedId(reward.id)) throw new Error(`Unknown progression reward ${reward.id}`); return reward.id; }));
  const progression: { readonly flags: readonly string[]; readonly states: readonly (readonly OwnedId[])[] } = { flags: rows.flags, states };
  const books = questBooks(host), paid = new Map<string, number>();
  host.onStep('owned.keepsakes', () => {
    for (const [player, owned] of seated()) {
      if (!host.players.has(player)) continue;
      const book = books.of(player);
      if (paid.get(player) === book.version) continue;
      paid.set(player, book.version);
      for (const id of progressionState(progression, flag => book.flags.has(flag))) owned.grant(id);
    }
  });
  registerInstalled(host, 'keepsakes');
  return player => { paid.delete(player); };
}
