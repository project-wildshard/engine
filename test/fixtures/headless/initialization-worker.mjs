import {runTickWorker} from '../../../src/server/host/tickWorkerLoop.ts';
await runTickWorker(async payload => {
  if (payload === null || typeof payload !== 'object' || typeof payload.snapshot !== 'string') throw new Error('Original payload refused');
  return {
    step: () => undefined,
    commit: () => ({tick: 0, snapshot: payload.snapshot, effects: []}),
    finish: () => ({ticks: 0, lanes: 0, steps: 0}),
    dispose: () => undefined,
  };
});
