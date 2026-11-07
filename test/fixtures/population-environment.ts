import type { SimHost } from '../../src/server/engine/sim';
import { installPopulationEnvironment } from '../../src/server/game/population/environment';
/** Flat habitat for native population tests; no callback fixtures bypass admission. */
export function flatPopulationEnvironment(host: SimHost): void {
  installPopulationEnvironment(host, { res: 2, size: 500, heights: new Float32Array(4) }, {
    id: 'fixture.habitat', seed: 1, chunkHalf: 250, normalEpsilon: .6, sampling: 'bilinear',
    water: -10, sea: false, trails: [], cabins: [], pond: null, trees: [], stream: null,
  });
}
