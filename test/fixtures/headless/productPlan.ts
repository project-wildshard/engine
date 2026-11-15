import { prepareProductPlan } from '../../../src/test/game/headlessNative';
import type { PrepareHeadlessRuntime } from '../../../src/server/host/headlessRuntime';
export const prepareHeadlessRuntime: PrepareHeadlessRuntime = prepareProductPlan;
