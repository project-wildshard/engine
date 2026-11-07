import * as v from 'valibot';
import type { PlaceArea } from '@wildshard/engine/quest/lastPlace';
import type { ShardProduct } from '../../../shared/game/shardfile/shardProduct';

/** The files a shard's named places are published in. */
const PLACE_FILES = ['quests/page-composition.json', 'quests/discovery.json', 'quests/content.json'];
const finite = v.pipe(v.number(), v.finite());
const Row = v.object({ id: v.string(), label: v.string(), r: finite, x: v.optional(finite), z: v.optional(finite),
  at: v.optional(v.object({ poi: v.string(), x: finite, z: finite })) });
const File = v.object({ places: v.optional(v.array(Row)) });

/**
 * A shard's named places, for the server's respawn (J107). A place the page resolves against a placed scene object has no
 * world position here, and is left out: a player who reaches only those goes back to the spawn.
 */
export async function serverPlaces(product: Pick<ShardProduct, 'hasFile' | 'json'>): Promise<readonly PlaceArea[]> {
  for (const name of PLACE_FILES) {
    if (!product.hasFile(name)) continue;
    const { places } = v.parse(File, await product.json<unknown>(name));
    if (places === undefined) continue;
    return places.flatMap(({ id, label, r, x, z, at }) => {
      const area = x !== undefined && z !== undefined ? { x, z } : at?.poi === 'world' ? { x: at.x, z: at.z } : null;
      return area === null ? [] : [{ id, label, r, ...area }];
    });
  }
  return [];
}
