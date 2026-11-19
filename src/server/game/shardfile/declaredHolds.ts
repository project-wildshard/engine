// ONE-FORMAT OF19b: a declared spawn's `hold`. The body's memory `field` reads 1 until the quest flag `until` is set, then
// 0, as a runtime plan's population `holds` row sets it before the keeper steps (`installSpeciesHomes`): Dunes' first ray
// glides held until the player has met the scout. It runs before the brains (installed first), every step, from the
// host's flags, so it keeps no state of its own and a save needs nothing new.
import type { Shardfile } from '@wildshard/format/shardSchema';
import type { SimHost } from '@wildshard/engine/sim';

type SpawnRow = Shardfile['creatures']['spawns'][number];
export const SPAWN_HOLD_STEP = 'data.spawn-hold';

/** Install the holds of the rows that declare one; nothing when none does, so older products step as before. */
export function installDeclaredHolds(host: SimHost, rows: readonly SpawnRow[]): void {
  const held = rows.flatMap(row => row.hold === undefined ? [] : [{ id: row.id, ...row.hold }]);
  if (held.length === 0) return;
  for (const row of held) if (!host.entities.has(row.id)) throw new Error(`Spawn hold ${row.id} names no body`);
  const settle = (): void => {
    for (const row of held) { const body = host.entities.get(row.id); if (body !== undefined) body.mem[row.field] = host.flags.has(row.until) ? 0 : 1; }
  };
  settle();
  host.onStep(SPAWN_HOLD_STEP, () => { settle(); });
}
