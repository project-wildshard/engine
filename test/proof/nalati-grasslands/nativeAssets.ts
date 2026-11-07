// oxlint-disable-next-line import/no-nodejs-modules -- The native witnesses read Nalati's committed native inputs.
import { readFileSync } from 'node:fs';
import type { Shardfile } from '../../../src/shared/host/shardfile';
import { nalatiQueryTerrain } from '../../../src/shards/nalati-grasslands/generators/terrain';

const root = new URL('../../../', import.meta.url);
const read = (path: string): Uint8Array => new Uint8Array(readFileSync(new URL(path, root)));
/** Nalati's declared shardfile assets by hash: the admitted navigation row's original WSNM bytes, from their retained
 *  source copy (generators/navigation.ts), and the query terrain's sampling file, re-encoded from the retained bare WSTR
 *  lattice exactly as its generator does (generators/terrain.ts, G384). */
export function nalatiDeclaredAssets(source: Pick<Shardfile, 'navigation' | 'terrain'>): Map<string, Uint8Array> {
  const result = new Map(source.navigation === null ? [] : [[source.navigation.file, read(`src/shards/nalati-grasslands/assets/navigation-${source.navigation.file}`)]]);
  if (source.terrain?.sampling !== undefined) {
    const sampling = nalatiQueryTerrain(read('public/assets/baked/nalati-grasslands/terrain.bin')).assets.get(source.terrain.sampling.file);
    if (sampling === undefined) throw new Error('Nalati query terrain differs from its declared sampling file');
    result.set(source.terrain.sampling.file, sampling);
  }
  return result;
}
/** Nalati's native inputs: its declared assets, unless the host handed them over. */
export function nalatiNativeAssets(source: Pick<Shardfile, 'navigation' | 'terrain'>, assets: ReadonlyMap<string, Uint8Array> = new Map()): Map<string, Uint8Array> {
  return new Map([...nalatiDeclaredAssets(source), ...assets]);
}
