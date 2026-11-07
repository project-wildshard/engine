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

/** The bytes a job copies to the worker (its arrays, each its own whole buffer: `captureJob` copies views tight, so
 *  structured clone copies exactly these): the backpressure the page capture's scratch had. */
export function captureJobBytes(job: CaptureJob): number {
  return job.attributes.reduce((sum, row) => sum + row.array.byteLength, 0) + job.source.byteLength;
}
/** The job for one source, or null when its attributes are not plain (the page path keeps those). */
export function captureJob(id: number, origin: string, geometry: BufferGeometry, plan: CullPlan, parents: readonly { x: number; z: number }[]): CaptureJob | null {
  const attributes: CaptureJob['attributes'][number][] = [];
  for (const name of Object.keys(geometry.attributes)) {
    const attribute = geometry.getAttribute(name);
    if (!(attribute instanceof BufferAttribute)) return null;
    attributes.push({ name, array: tight(attribute.array), itemSize: attribute.itemSize, normalized: attribute.normalized });
  }
  const bins = plan.bins.map(({ sphere, visibility: _visibility, ...bin }) => ({ ...bin, sphere: [sphere.center.x, sphere.center.y, sphere.center.z, sphere.radius] as const }));
  return { id, origin, attributes, source: tight(plan.source), lod: [...plan.lod], bins, parents };
}

/** An array that owns its whole buffer: structured clone copies a view's entire backing buffer, so a view is copied
 *  tight first (the copy is the view's bytes, not the buffer's). */
function tight<T extends TypedArray>(array: T): T {
  return array.byteOffset === 0 && array.byteLength === array.buffer.byteLength ? array : array.slice() as T;
}

export class RoadTileCaptureWorker {
  private worker: Worker | undefined;
  private ready = false;
  private next = 0;
  private readonly waiting = new Map<number, { job: CaptureJob; resolve: (result: CaptureResult) => void; reject: (error: Error) => void;
    refused: (job: CaptureJob) => Promise<CaptureResult> }>();
  private readonly listeners: (() => void)[] = [];
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
  /** Structured clone copies the arrays: the page's own stay with its mesh for upload, and the job keeps referencing
   *  them until it is answered, so a job the worker refuses (ok: false) runs again on the page (`refused`). */
  run(job: CaptureJob, refused: (job: CaptureJob) => Promise<CaptureResult>): Promise<CaptureResult> | null {
    const worker = this.worker; if (!this.usable() || worker === undefined) return null;
    return new Promise<CaptureResult>((resolve, reject) => {
      this.waiting.set(job.id, { job, resolve, reject, refused });
      worker.postMessage(job, { transfer: [] });
    });
  }
  private message(reply: unknown): void {
    if (typeof reply !== 'object' || reply === null) { this.stop(new Error('Invalid road tile capture reply')); return; }
    if (Reflect.get(reply, 'ready') === true) { this.ready = true; return; }
    const id: unknown = Reflect.get(reply, 'id'), row = typeof id === 'number' ? this.waiting.get(id) : undefined;
    if (typeof id !== 'number' || row === undefined) { this.stop(new Error('Unknown road tile capture reply')); return; }
    this.waiting.delete(id);
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
  private stop(error: Error): void {
    for (const forget of this.listeners.splice(0)) forget();
    this.worker?.terminate(); this.worker = undefined; this.ready = false;
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
