import { roadTileCache } from './roadTileArchive';
import { captureJobTiles } from './roadTileCaptureJob';
import type { CaptureJob } from './roadTileCaptureWorker';
import { installWorkerBootTiming } from '@wildshard/engine/boot/workerTiming';

installWorkerBootTiming('road-tile-capture');

/** DL11: the road tile capture worker: each job's tiles (roadTileCaptureJob.ts) into this origin's Cache Storage. */
async function answer(job: CaptureJob): Promise<void> {
  try { self.postMessage({ id: job.id, ok: true, ...await captureJobTiles(job, roadTileCache(caches, job.origin)) }, { transfer: [] }); }
  catch (error: unknown) { self.postMessage({ id: job.id, ok: false, error: error instanceof Error ? error.message : String(error) }, { transfer: [] }); }
}
self.onmessage = (event: MessageEvent<CaptureJob>): void => { void answer(event.data); };
self.postMessage({ ready: true }, { transfer: [] });
