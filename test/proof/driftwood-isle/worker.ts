import type { HeadlessRuntimePreparation, HeadlessRuntimePlan } from '../../../src/server/host/headlessRuntime';
import { installPortableMath } from '@wildshard/engine/core/portableMath';

/** The same real entry in the SDK worker, with the witness's portable transcendental math installed before its imports. */
export async function prepareHeadlessRuntime(preparation: HeadlessRuntimePreparation): Promise<HeadlessRuntimePlan> {
  installPortableMath();
  const { prepareFolderPlan } = await import('../../fixtures/headless-native');
  return prepareFolderPlan(preparation);
}
