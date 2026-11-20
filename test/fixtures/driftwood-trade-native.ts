import {installPortableMath} from '../../src/shared/engine/core/portableMath';
import {retainRestoredWalkBodies} from '../../src/test/game/headless/ropeBodies';
import { prepareNativeCoinRecipe } from './native-coin-recipe';
import * as v from 'valibot';
import type { PrepareHeadlessRuntime } from '../../src/server/host/headlessRuntime';

/** The ordinary native continuation plus the original coin/shop owners. */
export const prepareHeadlessRuntime: PrepareHeadlessRuntime = async preparation => {
  installPortableMath();
  const {prepareFolderPlan} = await import('../../src/test/game/headlessNative');
  const plan = await prepareFolderPlan(preparation);
  const { installNativeEconomy } = await import('./native-hosts/loot/nativeEconomy');
  const { declaredQuestBodies } = await import('../../src/server/game/quest/declaredQuestBodies');
  const { installCoinModel } = await import('../../src/client/game/loot/coinModel');
  const coinGeometry = await prepareNativeCoinRecipe();
  const nativeQuest = v.parse(v.object({step:v.string()}),
    await preparation.product.json('server/quest-policy.json'));
  const trader = v.parse(v.object({ view: v.object({ closeDistance: v.pipe(v.number(), v.finite(), v.minValue(Number.MIN_VALUE)) }) }),
    await preparation.product.json('quests/stall.json'));
  return { ...plan, install: (host, context) => {
    plan.install(host, context);
    if(context.restoring)retainRestoredWalkBodies(host);
    installCoinModel(coinGeometry);
    // OF22c3: the island's creatures are declared spawns; the bounty counts and pays over those bodies
    installNativeEconomy(host, preparation.product, declaredQuestBodies(host, preparation.product.shardfile).bodies, nativeQuest.step, trader.view.closeDistance);
  } };
};
