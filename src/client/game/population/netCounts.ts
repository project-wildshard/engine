import type { NetClient } from '@wildshard/engine/net/client';
import { ANIMAL_CLASS } from '@wildshard/engine/net/netSchemas';

/** How many living creatures of `kind` a client's rows hold: what `PopulationProjection.placed` counts on a page. A row
 * beyond its relevance radius is not on this client, so this counts what is near the player. */
export function netCreatureCount(client: NetClient, kind: string): number {
  const frame = client.latest;
  let count = 0;
  if (frame === null) return count;
  for (const [handle, info] of client.entities) if (info.cls.cls === ANIMAL_CLASS.cls && info.initial['kind'] === kind && client.fields(frame, handle)?.['alive'] === true) count++;
  return count;
}
