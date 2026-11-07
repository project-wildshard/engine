import type { PrepareHeadlessRuntime } from '../../../src/server/host/headlessRuntime';
import { prepareHeadlessRuntime as prepareStatic } from './trustedRuntime';
import { installDeferred } from '../sim-level/deferred';
export const prepareHeadlessRuntime: PrepareHeadlessRuntime = async preparation => {
  const plan = await prepareStatic(preparation);
  return { level: { ...plan.level, entities: [] }, install: (host, context) => { installDeferred(host, context.snapshot); } };
};
