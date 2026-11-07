// Frozen raw-loader oracle from 8811fdc97f. Production never imports this fixture.
import * as v from 'valibot';
import { HeldBowBaseSchema, HeldBowRowsSchema } from '@wildshard/format/weaponProfiles';
import { createModelLibrary } from '../../src/client/game/plugin/geometry';
import { bindHeldBow } from '../../src/client/game/weapons/heldLauncher';

const names = v.pipe(v.array(v.pipe(v.string(), v.maxLength(256))), v.maxLength(32));
const PoolSchema = v.strictObject({ url: v.pipe(v.string(), v.maxLength(512)), parts: names, channels: v.exactOptional(v.pipe(v.array(v.strictObject({
  name: v.string(), source: v.string(), width: v.picklist([1, 2, 3, 4]), parts: v.exactOptional(names) })), v.maxLength(8))) });
const HeldBowFileSchema = v.strictObject({ pool: PoolSchema, bow: HeldBowRowsSchema, base: HeldBowBaseSchema });
const bowLoads = new Map<string, Promise<ReturnType<typeof bindHeldBow>>>();
/** A baked bow from its rows file (a shard's bake writes it: the pool GLB's url, parts and paint channels, and the bow's
 *  rows), fetched once per url, parsed strictly (an unknown or missing field refuses) and its parts preloaded. */
export function loadHeldBow(url: string): Promise<ReturnType<typeof bindHeldBow>> {
  const known = bowLoads.get(url);
  if (known !== undefined) return known;
  const load = (async () => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Held bow: ${url} did not load`);
    const json: unknown = await response.json(), { pool, ...definition } = v.parse(HeldBowFileSchema, json);
    const library = createModelLibrary({ meshes: [], meshUrls: {}, hd: [], hdUrls: {}, aoFloor: 1, hdLooks: {}, geometryPools: [pool] }, `[held bow ${url}]`);
    await library.preload();
    return bindHeldBow(definition, library);
  })();
  bowLoads.set(url, load);
  return load;
}
