import { roadTileCache } from './roadTileArchive';
import { captureJobTiles } from './roadTileCaptureJob';
import type { CaptureJob } from './roadTileCaptureWorker';
import { installWorkerBootTiming } from '@wildshard/engine/boot/workerTiming';
import { setCacheChannel } from '@wildshard/engine/pwa/cacheNames';

installWorkerBootTiming('road-tile-capture');

/** DL11: the road tile capture worker: each job's tiles (roadTileCaptureJob.ts) into this origin's Cache Storage. */
async function answer(job: CaptureJob): Promise<void> {
  try { self.postMessage({ id: job.id, ok: true, ...await captureJobTiles(job, roadTileCache(caches, job.origin)) }, { transfer: [] }); }
  catch (error: unknown) { self.postMessage({ id: job.id, ok: false, error: error instanceof Error ? error.message : String(error) }, { transfer: [] }); }
}
// OF12: this worker has no document stamp; each job names the page's cache channel
self.onmessage = (event: MessageEvent<CaptureJob>): void => { setCacheChannel(Reflect.get(event.data, 'channel')); void answer(event.data); };
self.postMessage({ ready: true }, { transfer: [] });
