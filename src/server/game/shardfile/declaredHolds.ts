// ONE-FORMAT OF19b: a declared spawn's `hold`. The body's memory `field` reads 1 until the quest flag `until` is set, then
// 0, as a runtime plan's population `holds` row set it for the keeper's homes (retired by FORMAT-PRUNE FP53b): Dunes' first ray
// glides held until the player has met the scout. It runs before the brains (installed first), every step, from the
// host's flags, so it keeps no state of its own and a save needs nothing new. In a room the scout's flag is each player's
// own (a quest row's flag is claimed into its player's book, and only the lead's book is the host's), so any present
// player who has met the scout frees the body: a second player's talk freed nothing before (OF19d staging walk).
import type { Shardfile } from '@wildshard/format/shardSchema';
import type { SimHost } from '@wildshard/engine/sim';
import { questBooks } from '@wildshard/engine/quest/players';

type SpawnRow = Shardfile['creatures']['spawns'][number];
export const SPAWN_HOLD_STEP = 'data.spawn-hold';

/** Install the holds of the rows that declare one; nothing when none does, so older products step as before. */
export function installDeclaredHolds(host: SimHost, rows: readonly SpawnRow[]): void {
  const held = rows.flatMap(row => row.hold === undefined ? [] : [{ id: row.id, ...row.hold }]);
  if (held.length === 0) return;
  for (const row of held) if (!host.entities.has(row.id)) throw new Error(`Spawn hold ${row.id} names no body`);
  /** The world's flag, or any present player's own: alone in a room the lead's book is the host's, so one player reads as before. */
  const met = (flag: string): boolean => host.flags.has(flag) || (host.players.size > 1 && questBooks(host).each().some(book => book.flags.has(flag)));
  const settle = (): void => {
    for (const row of held) { const body = host.entities.get(row.id); if (body !== undefined) body.mem[row.field] = met(row.until) ? 0 : 1; }
  };
  settle();
  host.onStep(SPAWN_HOLD_STEP, () => { settle(); });
}
