import {retainRestoredWalkBodies} from './headless/ropeBodies';
import { prepareNativeCoinRecipe } from './native-coin-recipe';
import { driftwoodNativeInputs } from '../../src/shards/driftwood-isle/generators/nativeServer';
import * as v from 'valibot';
import type { PrepareHeadlessRuntime } from '../../src/server/host/headlessRuntime';

/** The ordinary native continuation plus the original coin/shop owners. */
export const prepareHeadlessRuntime: PrepareHeadlessRuntime = async preparation => {
  const base = await import('../proof/driftwood-isle/worker');
  const plan = await base.prepareHeadlessRuntime(preparation);
  const { installNativeEconomy } = await import('./native-hosts/loot/nativeEconomy');
  const { mixedPopulation } = await import('@wildshard/engine/game/population/mixedRoster');
  const { installCoinModel } = await import('../../src/client/game/loot/coinModel');
  const coinGeometry = await prepareNativeCoinRecipe();
  const payload = v.parse(v.object({ constants: v.object({ nativeQuest: v.object({ step: v.string(), acquisition: v.object({ population: v.string() }) }) }) }),
    { constants: driftwoodNativeInputs() });
  const trader = v.parse(v.object({ view: v.object({ closeDistance: v.pipe(v.number(), v.finite(), v.minValue(Number.MIN_VALUE)) }) }),
    await preparation.product.json('quests/stall.json'));
  return { ...plan, install: (host, context) => {
    plan.install(host, context);
    if(context.restoring)retainRestoredWalkBodies(host);
    installCoinModel(coinGeometry);
    const population = mixedPopulation(host, payload.constants.nativeQuest.acquisition.population);
    installNativeEconomy(host, preparation.product, population.bodies, payload.constants.nativeQuest.step, trader.view.closeDistance);
  } };
};
