import type { NetClient } from '@wildshard/engine/net/client';
import { ANIMAL_CLASS } from '@wildshard/engine/net/netSchemas';

/** Fill the projection's requested kinds in one pass over the rows near the player. */
export function countNetCreatures(client: NetClient | null, counts: Map<string, number>): void {
  if (counts.size === 0) return;
  for (const kind of counts.keys()) counts.set(kind, 0);
  if (client === null || client.latest === null) return;
  const frame = client.latest;
  for (const info of client.entities.values()) {
    if (info.cls.cls !== ANIMAL_CLASS.cls) continue;
    const kind = info.initial['kind'];
    if (typeof kind !== 'string') continue;
    const count = counts.get(kind);
    if (count !== undefined && client.field(frame, info.handle, 'alive') === true) counts.set(kind, count + 1);
  }
}
