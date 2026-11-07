import type { HeadlessRuntimePreparation, HeadlessRuntimePlan } from '../../../src/server/host/headlessRuntime';
import { installPortableMath } from '../../fake/portableMath';
import { prepareProductRuntimePlan } from '../../../src/server/game/shardfile/nativePlan';

/** The same real Sky entry in the SDK worker, with the recorder's portable math installed before its imports. */
export function prepareHeadlessRuntime(preparation: HeadlessRuntimePreparation): Promise<HeadlessRuntimePlan> {
  installPortableMath();
  return prepareProductRuntimePlan(preparation.product, preparation.assets);
}
