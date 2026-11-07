import { createNativeHunt } from '../../src/server/game/plugin/brain';
import { admitNativeRosterServices } from '../../src/server/game/shardfile/homeKeeper';
import { populationEnvironment } from '../../src/server/game/population/environment';
import { flatPopulationEnvironment } from './population-environment';
import type { SimHost } from '../../src/server/engine/sim';
import type { Rng } from '../../src/shared/engine/core/rng';
import { BOAR } from '../../src/client/game/systems/species/boar';
/** Real scoped services for lifecycle tests, without structural callback admission. */
export function fixtureNativeRoster(host: SimHost, rng: Rng) {
  flatPopulationEnvironment(host);
  const { hunt } = createNativeHunt(host, { limit: 64, fight: {}, player: 'host', bands: { states: [], legacyKinds: [] },
    hit: { namespace: 'fixture', tags: [] } }, { rng, ground: populationEnvironment(host, 'fixture.habitat'), nav: null,
    species: new Map([[BOAR.kind, BOAR]]) });
  const services = admitNativeRosterServices(host, 'fixture.roster', hunt);
  return { hunt, services };
}
