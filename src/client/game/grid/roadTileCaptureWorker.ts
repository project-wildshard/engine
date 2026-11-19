import { pageCacheChannel } from '@wildshard/engine/pwa/cacheNames';
/** DL11: the road tile capture's worker, owned by the backing's scope. A source's compaction, coarse merge and
 * archive writes run there on a copy of its arrays, so the page publishes (and uploads) the source at once and
 * only the references come back. Until the worker says it is running, and whenever it cannot start, the backing
 * keeps its original page-thread capture. */
import { BufferAttribute, type BufferGeometry, type Mesh, type TypedArray } from 'three';
import type { Scope } from '@wildshard/engine/app/scope';
import type { CullPlan } from './roadCull';
import type { RoadTileReference } from './roadTileArchive';

export interface CaptureJob {
  readonly id: number; readonly origin: string;
  readonly attributes: readonly { readonly name: string; readonly array: TypedArray; readonly itemSize: number; readonly normalized: boolean }[];
  readonly source: Uint32Array; readonly lod: number[];
  readonly bins: readonly (Omit<CullPlan['bins'][number], 'sphere' | 'visibility'> & { readonly sphere: readonly [number, number, number, number] })[];
  readonly parents: readonly { readonly x: number; readonly z: number }[];
}
export interface CaptureResult { readonly fine: readonly RoadTileReference[]; readonly coarse: readonly RoadTileReference[] }

/** The bytes a job copies to the worker (one tight copy of each array, transferred: `jobMessage`): the backpressure
 *  the page capture's scratch had. */
export function captureJobBytes(job: CaptureJob): number {
  return job.attributes.reduce((sum, row) => sum + row.array.byteLength, 0) + job.source.byteLength;
}
/** The job for one source, or null when its attributes are not plain (the page path keeps those). */
export function captureJob(id: number, origin: string, geometry: BufferGeometry, plan: CullPlan, parents: readonly { x: number; z: number }[]): CaptureJob | null {
  const attributes: CaptureJob['attributes'][number][] = [];
  for (const name of Object.keys(geometry.attributes)) {
    const attribute = geometry.getAttribute(name);
    if (!(attribute instanceof BufferAttribute)) return null;
    attributes.push({ name, array: attribute.array, itemSize: attribute.itemSize, normalized: attribute.normalized });
  }
  const bins = plan.bins.map(({ sphere, visibility: _visibility, ...bin }) => ({ ...bin, sphere: [sphere.center.x, sphere.center.y, sphere.center.z, sphere.radius] as const }));
  return { id, origin, attributes, source: plan.source, lod: [...plan.lod], bins, parents };
}

/** ENGINE-MEMORY EM25 (design rule 4, transfer, never clone): the message for a job carries a tight copy of each of
 *  its arrays (the view's bytes, not its whole buffer) and transfers those copies. A structured clone of the arrays
 *  made a serialized copy beside the worker's, so a 20 MB source (the T1 phone boot) held three copies at once; now it
 *  holds two, the page's own and the one the worker receives. The job keeps the page's arrays for a refused retry. */
export function jobMessage(job: CaptureJob, channel: string): { message: CaptureJob & { channel: string }; transfer: ArrayBuffer[] } {
  const transfer: ArrayBuffer[] = [];
  const copy = <T extends TypedArray>(array: T): T => { const own = array.slice() as T; transfer.push(own.buffer as ArrayBuffer); return own; };
  const attributes = job.attributes.map(row => ({ ...row, array: copy(row.array) }));
  return { message: { ...job, attributes, source: copy(job.source), channel }, transfer };
}

/** TR-4b: how long the worker may go without answering while it holds a job. Past it the worker is retired and every job it
 *  holds is captured on the page (the `refused` path), so a lost reply never holds the road: hosted T1's B, E and I sat 60 s
 *  at `wait:Road tile capture worker` on a second boot until the boot watchdog. A job answers in well under a second on the
 *  Mac and a few seconds on hosted SwiftShader, so only a silent worker reaches it. */
export const CAPTURE_REPLY_DEADLINE_MS = 8000;

export class RoadTileCaptureWorker {
  private worker: Worker | undefined;
  private ready = false;
  private next = 0;
  private readonly waiting = new Map<number, { job: CaptureJob; resolve: (result: CaptureResult) => void; reject: (error: Error) => void;
    refused: (job: CaptureJob) => Promise<CaptureResult> }>();
  private readonly listeners: (() => void)[] = [];
  private deadline: ReturnType<Scope['timeout']> | undefined;
  constructor(private readonly scope: Scope) {
    scope.onDispose(() => { this.stop(new Error('Road tile capture owner retired')); });
    if (typeof Worker !== 'function') return;
    try {
      const worker = new Worker(new URL('roadTileCapture.worker.ts', import.meta.url), { type: 'module', name: 'grid-road-capture' });
      this.listeners.push(scope.listen(worker, 'message', event => { this.message(event.data); }));
      this.listeners.push(scope.listen(worker, 'error', event => { event.preventDefault(); this.stop(new Error('Road tile capture worker failed')); }));
      this.listeners.push(scope.listen(worker, 'messageerror', () => { this.stop(new Error('Road tile capture reply failed')); }));
      this.worker = worker;
    } catch { this.worker = undefined; }
  }
  /** The worker runs and can take a job now. */
  usable(): boolean { return this.ready && this.worker !== undefined && !this.scope.disposed && !this.scope.disposing; }
  /** A source's job (null: not plain, the page captures it). */
  job(origin: string, mesh: Mesh, plan: CullPlan, parents: readonly { x: number; z: number }[]): CaptureJob | null {
    return this.usable() ? captureJob(this.next++, origin, mesh.geometry, plan, parents) : null;
  }
  /** The worker receives transferred copies of the arrays (`jobMessage`): the page's own stay with its mesh for upload,
   *  and the job keeps referencing them until it is answered, so a job the worker refuses (ok: false) runs again on the
   *  page (`refused`). */
  run(job: CaptureJob, refused: (job: CaptureJob) => Promise<CaptureResult>): Promise<CaptureResult> | null {
    const worker = this.worker; if (!this.usable() || worker === undefined) return null;
    return new Promise<CaptureResult>((resolve, reject) => {
      this.waiting.set(job.id, { job, resolve, reject, refused });
      if (this.deadline === undefined) this.arm();
      const { message, transfer } = jobMessage(job, pageCacheChannel()); // OF12: the worker's cache channel
      worker.postMessage(message, { transfer });
    });
  }
  private message(reply: unknown): void {
    if (typeof reply !== 'object' || reply === null) { this.stop(new Error('Invalid road tile capture reply')); return; }
    if (Reflect.get(reply, 'ready') === true) { this.ready = true; return; }
    const id: unknown = Reflect.get(reply, 'id'), row = typeof id === 'number' ? this.waiting.get(id) : undefined;
    if (typeof id !== 'number' || row === undefined) { this.stop(new Error('Unknown road tile capture reply')); return; }
    this.waiting.delete(id);
    this.arm();
    const fine: unknown = Reflect.get(reply, 'fine'), coarse: unknown = Reflect.get(reply, 'coarse');
    if (Reflect.get(reply, 'ok') === true && Array.isArray(fine) && Array.isArray(coarse) && [...fine, ...coarse].every(reference))
      row.resolve({ fine, coarse });
    // the worker refused this source (its cache put or a capture step threw): the page captures it as before
    else if (Reflect.get(reply, 'ok') === false) void this.retry(row);
    else row.reject(new Error('Invalid road tile capture result'));
  }
  private async retry(row: { job: CaptureJob; resolve: (result: CaptureResult) => void; reject: (error: Error) => void; refused: (job: CaptureJob) => Promise<CaptureResult> }): Promise<void> {
    try { row.resolve(await row.refused(row.job)); }
    catch (error: unknown) { row.reject(error instanceof Error ? error : new Error('Road tile capture failed', { cause: error })); }
  }
  /** The reply deadline runs while a job waits and restarts at each answer. */
  private arm(): void {
    if (this.deadline !== undefined) this.scope.cancelTimer(this.deadline);
    this.deadline = this.waiting.size === 0 ? undefined : this.scope.timeout(CAPTURE_REPLY_DEADLINE_MS, () => { this.deadline = undefined; this.silent(); });
  }
  /** The worker stopped answering: retire it (later sources take the page path) and capture what it held on the page, in order. */
  private silent(): void {
    const rows = [...this.waiting.values()]; this.waiting.clear();
    console.warn(`[grid] road tile capture worker silent for ${String(CAPTURE_REPLY_DEADLINE_MS)} ms with ${String(rows.length)} jobs: capturing them on the page`);
    this.retire();
    void (async () => { for (const row of rows) await this.retry(row); })();
  }
  private retire(): void {
    if (this.deadline !== undefined) { this.scope.cancelTimer(this.deadline); this.deadline = undefined; }
    for (const forget of this.listeners.splice(0)) forget();
    this.worker?.terminate(); this.worker = undefined; this.ready = false;
  }
  private stop(error: Error): void {
    this.retire();
    for (const row of this.waiting.values()) row.reject(error);
    this.waiting.clear();
  }
}
function reference(value: unknown): value is RoadTileReference {
  if (typeof value !== 'object' || value === null) return false;
  const hash: unknown = Reflect.get(value, 'hash');
  return typeof hash === 'string' && /^[a-f0-9]{64}$/u.test(hash)
    && ['wireBytes', 'x', 'z', 'jsBytes', 'gpuBytes'].every(key => Number.isSafeInteger(Reflect.get(value, key)));
}
