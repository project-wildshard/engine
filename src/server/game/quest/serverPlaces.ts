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
 * Every authored discovery. Scene-relative places have no server position, but remain valid names.
 * Only those authored names may use the page's distance assertion.
 */
export async function serverDiscoveries(product: Pick<ShardProduct, 'hasFile' | 'json'>): Promise<readonly { readonly id: string; readonly area: PlaceArea | null }[]> {
  for (const name of PLACE_FILES) {
    if (!product.hasFile(name)) continue;
    const { places } = v.parse(File, await product.json<unknown>(name));
    if (places === undefined) continue;
    return places.map(({ id, label, r, x, z, at }) => {
      const area = x !== undefined && z !== undefined ? { x, z } : at?.poi === 'world' ? { x: at.x, z: at.z } : null;
      return { id, area: area === null ? null : { id, label, r, ...area } };
    });
  }
  return [];
}

/** Positioned discoveries used for respawn; scene-relative discoveries remain in the admission allowlist. */
export async function serverPlaces(product: Pick<ShardProduct, 'hasFile' | 'json'>): Promise<readonly PlaceArea[]> {
  return (await serverDiscoveries(product)).flatMap(row => row.area === null ? [] : [row.area]);
}
