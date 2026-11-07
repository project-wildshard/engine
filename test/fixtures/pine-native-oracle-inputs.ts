import * as v from 'valibot';
import { PopulationEnvironmentSchema, type PopulationEnvironmentRows } from '@wildshard/format/populationEnvironment';
import * as layout from '../../src/shards/pine-hollow/generators/layout';
import { pineGeographyRows } from '../../src/shards/pine-hollow/generators/geographyRows';
import { pinePhysics } from '../../src/shards/pine-hollow/generators/physics';
import TERRAIN from '../../src/shards/pine-hollow/data/terrainBindings.json' with {type:'json'};
import ENTRIES from '../../src/shards/pine-hollow/data/entryWalk.json' with {type:'json'};
import { canonicalNativeOracleInput } from './native-oracle';

/** G872 proof-only facts: preserve the original independent entry budget and
 * every habitat field. The production bake/worker never reads this oracle. */
export function pineNativeOracleInputs(): { terrain: typeof TERRAIN; entries: typeof ENTRIES; environment: PopulationEnvironmentRows } {
  const ground = pineGeographyRows().ground, physics = pinePhysics();
  return canonicalNativeOracleInput({ terrain: TERRAIN, entries: ENTRIES, environment: v.parse(PopulationEnvironmentSchema, {
    id: 'pine.habitat', seed: 1337, chunkHalf: 250, normalEpsilon: .6,
    sampling: 'bilinear', water: layout.POND.level, sea: false,
    trails: [layout.S_ROAD, layout.N_ROAD, layout.W_ROAD, layout.E_ROAD,
      ...Object.entries(layout.SPURS).map(([id, path]) => id === 'den' ? layout.DEN_TRAIL : id === 'lookout' ? layout.LOOKOUT_TRAIL : path)],
    cabins: layout.CABIN_SITES.map(({ x, z }) => ({ x, z })),
    pond: { x: layout.POND.x, z: layout.POND.z, r: layout.POND.r }, trees: physics.trees,
    stream: ground.bodies.find(body => body.kind === 'stream') ?? null,
  }) });
}
