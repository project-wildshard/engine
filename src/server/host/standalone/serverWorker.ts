import { installWorkerBootTiming } from '@wildshard/engine/boot/workerTiming';
import { bootTask } from '@wildshard/engine/boot/timing';

// DL21/J198: this entry has no physics, products or sim imports. The page hears
// its actual first body before the heavy graph is even requested.
installWorkerBootTiming('standalone-server');
const worker = globalThis as typeof globalThis & { postMessage: (message: unknown) => void };
const post = worker.postMessage.bind(worker);
post({ __engineWorkerBoot: 1 });
async function start(event: MessageEvent<unknown>): Promise<void> {
  try {
    const runtime = await bootTask('server:worker-runtime-import', () => import('./serverRuntime'));
    runtime.runServerWorker(event);
  } catch (error) {
    // Import refusal uses the existing failure channel, never a page fallback.
    event.ports[0]?.postMessage({ kind: 'failed', reason: error instanceof Error ? error.message : String(error) });
  }
}
self.onmessage = (event: MessageEvent<unknown>): void => {
  self.onmessage = null;
  void start(event);
};
