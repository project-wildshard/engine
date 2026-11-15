import { nineHeadlessRuntime } from '../nine-headless';
import type { PrepareHeadlessRuntime } from '../../../src/server/host/headlessRuntime';
export const prepareHeadlessRuntime: PrepareHeadlessRuntime = nineHeadlessRuntime(false);
