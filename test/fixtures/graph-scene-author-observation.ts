import { POOL_GRAPHS } from '../../src/shards/driftwood-isle/generators/poolGraphs';
import { REEF_GRAPHS } from '../../src/shards/driftwood-isle/generators/reefGraphs';
import { OCEAN_GRAPHS } from '../../src/shards/driftwood-isle/generators/oceanGraphs';
import { CASCADE_GRAPHS } from '../../src/shards/driftwood-isle/generators/waterfallGraphs';
import { postChainRows } from '../../src/shards/nalati-grasslands/generators/postChain';
import { cargoModels } from '../../src/shards/driftwood-isle/generators/cargoCatalogue';
import { reefCatalogue } from '../../src/shards/driftwood-isle/generators/reefCatalogue';
import { DRIFTWOOD_SPAWNS } from '../../src/shards/driftwood-isle/generators/spawnTables';
import { DRIFTWOOD_EXCHANGE } from '../../src/shards/driftwood-isle/generators/economy';
import { DRIFTWOOD_LAYOUTS } from './driftwood-layout-source';
import { hashImmutableBytes } from '../../src/shared/host/immutable';

/** Every original graph, model-choice and spawning/economy declaration before runtime admission. */
export function graphSceneAuthorObservation() {
  return Object.entries({ pools: POOL_GRAPHS, reef: REEF_GRAPHS, ocean: OCEAN_GRAPHS, cascade: CASCADE_GRAPHS,
    post: postChainRows(), cargo: cargoModels(DRIFTWOOD_LAYOUTS.wreck), reefModels: reefCatalogue(),
    spawns: DRIFTWOOD_SPAWNS, exchange: DRIFTWOOD_EXCHANGE }).map(([name, row]) => {
      const bytes = new TextEncoder().encode(JSON.stringify(row)); return { name, bytes: bytes.length, hash: hashImmutableBytes(bytes) };
    });
}
