import type { Scope } from '@wildshard/engine/app/scope';
import { whenControl } from '@wildshard/engine/boot/prefetch';
import { pageScope } from '@wildshard/engine/app/resources';
import { runtimePacksOn } from '@wildshard/engine/boot/loadingPacks';
import { beginLoadingWait, finishLoadingWait, reportLoadingWait } from '@wildshard/engine/boot/loadingWaits';
import { currentLoadingTimeline } from '@wildshard/engine/boot/timeline';
import { observeReads } from '@wildshard/engine/boot/waits';
import { streamingDistance, streamingVisible, type StreamingPoint, type StreamingView } from './streamingView';

type Point = StreamingPoint;
interface Job {
  readonly id: string; readonly at: Point; readonly order: number; readonly run: () => Promise<void>;
  readonly resolve: (published: boolean) => void; readonly reject: (error: Error) => void;
}

/** MF5 / NT8: the loader awaits spatial jobs within a 3-D radius before reveal, in every direction (DL17, G1000: the level
 * is complete at control, so a job behind the camera is not left to after it); the camera only orders them. Camera-less
 * owners retain their original viewer-distance order. 221 m retains the former 5 x 5 ring reach. */
export const SPAWN_VIEW_M = 221;
/** The fence's default radius: the 5 x 5 ring's reach, or the whole level once Debug ▸ Loading & memory ▸ Level download
 *  is Runtime packs (the level is downloaded whole, so all of it is attached before control). */
export function spawnViewRadius(): number { return runtimePacksOn() ? Infinity : SPAWN_VIEW_M; }
let spawnView: { readonly radius: number; readonly reference: 'camera' | 'player' } | null = null;
/** DL21: before control a queue runs this many spawn-view jobs at once (no frame is drawn under the loader, so the one-job
 *  pacing of play only cost time: Pine's cold phone-link fence fetched 143 files the spawn set lacks); after control, one. */
export const FENCE_LANES = 4;
/** Spawn-view jobs finished since the fence opened (the card's count). */
let fenceDone = 0;
const queues = new Set<ControlRefinement>();
/** The first boot fence precedes camera posing and explicitly keeps the player
 * reference. Later fences and controlled streaming use the real camera. */
export function spawnViewUsesCamera(): boolean { return spawnView?.reference !== 'player'; }
/** Run every queue's spawn-view jobs now and resolve once none is left (a failure rejects, as the job's own promise does). */
export async function prepareSpawnView(radius: number = spawnViewRadius(), settle?: () => void | Promise<void>, reference: 'camera' | 'player' = 'camera',
  tiles?: () => { readonly done: number; readonly total: number; readonly stages: number; readonly stagesTotal: number } | null): Promise<void> {
  spawnView = { radius, reference };
  // DL17: a queue whose refinement failed refuses the fence (the job's error, not an incomplete level at control)
  const refused = (): void => { for (const queue of queues) { const failure = queue.refusal(); if (failure !== undefined) throw failure; } };
  // DL21 (E526): the fence names its wait and counts it: jobs done of jobs known, and the level bytes they fetched
  // (resource timing of /shardfiles/ reads since the fence opened), so the card never sits unchanged on it. It counts from
  // the fence's opening, the tile settle included: the DL23 recording of Nine on 2477dc4 held 3.8 s on the settle's bare
  // name while its fence jobs ran
  fenceDone = 0;
  // The card lists only its current step's waits (Loading.paintWaiting): the wait carries that step and owner.
  const timeline = currentLoadingTimeline();
  const wait = beginLoadingWait('Spawn view', { kind: 'work', step: timeline?.snapshot().current ?? null, owner: timeline?.waitOwner ?? null });
  const reads = observeReads(name => name.includes('/shardfiles/'));
  let known = 0;
  const report = (): void => {
    const waiting = [...queues].reduce((sum, queue) => sum + queue.fenceWaiting(), 0);
    // The total never goes back within the fence (sp-x2's review): jobs leave the queue's count as each one finishes.
    known = Math.max(known, fenceDone + waiting);
    // DL21: the settle's tiles count too ('tiles 31 of 48'): with packs on the whole cell attaches here while the fence
    // holds one job, and Nine's cold Simulator card sat 2.5 s on 'Spawn view · 1 of 1' (8985b4e)
    const settled = tiles?.() ?? null;
    // the tiles' content stages count first (a tile completes at its last one): 'tiles 0 of 64 · stages 37 of 192'
    const stageCount = settled === null || settled.stagesTotal <= settled.total ? '' : ` · stages ${String(settled.stages)} of ${String(settled.stagesTotal)}`;
    const tileCount = settled === null || settled.total === 0 ? '' : ` · tiles ${String(settled.done)} of ${String(settled.total)}${stageCount}`;
    const counted = `${fenceDone} of ${known}${tileCount} · ${(reads.bytes() / 1e6).toFixed(1)} MB`;
    reportLoadingWait(wait, { label: `Spawn view · ${counted}`, progress: counted });
  };
  const ticker = pageScope.child('spawn-view.count'); ticker.interval(250, report);
  try {
    if (settle !== undefined) {
      // the content a frame asks for while the fence is open (the tile driver attaches only ready content) queues its jobs
      // a few tasks after it: let them arrive before the queues are read
      await settle();
      for (let turn = 0; turn < 3; turn++) await new Promise<void>(resolve => { pageScope.timeout(0, resolve); });
      performance.mark('wildshard.spawn-view.settled', { detail: [...queues].map(queue => queue.describe()) });
    }
    // what the fence saw, for the loading rulers (a viewer far from its jobs runs nothing)
    performance.mark('wildshard.spawn-view', { detail: [...queues].map(queue => queue.describe()) });
    for (const queue of queues) queue.wake();
    for (;;) {
      refused(); report();
      const open = [...queues].filter(queue => queue.spawnViewOpen());
      if (open.length === 0) break;
      await Promise.all(open.map(queue => queue.spawnViewIdle()));
    }
    refused();
    // what the fence left (DL17's complete-at-control gate refuses a level whose queues still wait here)
    performance.mark('wildshard.spawn-view.done', { detail: [...queues].map(queue => queue.describe()) });
  } finally { ticker.dispose(); reads.stop(); finishLoadingWait(wait); spawnView = null; }
}

/** One resident's low-priority refinement cursor. Outside the loader fence,
 * controlled paint precedes reads; visible jobs lead, then 3-D eye distance.
 * Retirement drains the started job and cancels queued publication. */
export class ControlRefinement {
  private readonly waiting = new Map<string, Job>();
  private readonly known = new Set<string>();
  private readonly owner: Scope;
  private readonly position: () => Point;
  private readonly pause: () => Promise<void>;
  private active = false;
  private scheduled = false;
  private busy = false;
  private sequence = 0;
  private running = 0;
  private failure: Error | undefined;
  private idle: (() => void)[] = [];
  constructor(owner: Scope, level: Scope | undefined, position: () => Point, pause: () => Promise<void>, private readonly view?: () => StreamingView | null) {
    this.owner = owner; this.position = position; this.pause = pause;
    queues.add(this);
    owner.onDispose(() => { queues.delete(this); for (const job of this.waiting.values()) job.resolve(false); this.waiting.clear(); this.known.clear(); this.settle(); });
    if (level === undefined) this.active = true;
    else whenControl(level, owner, () => { owner.raf(() => { owner.raf(() => { this.active = true; this.kick(); }); }); });
  }
  /** Whether the first controlled paint has completed, or the loader's spawn-view fence is open (MF5): either way the
   *  tile driver may attach this queue's content, and its jobs queue (only in-view ones run before control). */
  get ready(): boolean { return (this.active || spawnView !== null) && !this.owner.disposed && !this.owner.disposing; }
  add(id: string, at: Point, run: () => Promise<void>): Promise<boolean> {
    if (this.owner.disposed || this.owner.disposing) return Promise.resolve(false);
    if (this.failure !== undefined) return Promise.reject(this.failure);
    if (id.length === 0 || this.known.has(id) || !Number.isFinite(at.x) || !Number.isFinite(at.z) || (at.y !== undefined && !Number.isFinite(at.y))
      || (at.bounds !== undefined && (!at.bounds.min.every(Number.isFinite) || !at.bounds.max.every(Number.isFinite)
        || at.bounds.min.some((n, i) => n > (at.bounds?.max[i] ?? -Infinity))))) return Promise.reject(new Error('Invalid or duplicate refinement job'));
    const order = this.sequence++; this.known.add(id);
    const result = new Promise<boolean>((resolve, reject) => { this.waiting.set(id, { id, at: { ...at }, order, run, resolve, reject }); });
    this.kick(); return result;
  }
  /** The viewer, the queue's size and its nearest waiting job's distance (prepareSpawnView's mark). */
  describe(): { readonly at: Point; readonly waiting: number; readonly nearest: number | null; readonly active: boolean } {
    const view = spawnViewUsesCamera() ? this.view?.() ?? null : null, from = view?.eye ?? this.position(); let nearest: number | null = null;
    for (const job of this.waiting.values()) {
      const d = view === null ? Math.hypot(job.at.x - from.x, job.at.z - from.z) : Math.sqrt(streamingDistance(job.at, view));
      if (nearest === null || d < nearest) nearest = d;
    }
    return { at: { x: Math.round(from.x), z: Math.round(from.z), ...(from.y === undefined ? {} : { y: Math.round(from.y) }) },
      waiting: this.waiting.size, nearest: nearest === null ? null : Math.round(nearest), active: this.active };
  }
  /** The error a refinement job failed with (it refused the rest of the queue), if one did. */
  refusal(): Error | undefined { return this.failure; }
  /** The spawn-view fence opened: run what is in view (prepareSpawnView). */
  wake(): void { this.kick(); }
  /** Spawn-view jobs waiting or running in this queue before control (the fence's count). */
  fenceWaiting(): number {
    if (this.active || spawnView === null) return 0;
    let waiting = this.running;
    for (const job of this.waiting.values()) if (this.inFence(job)) waiting++;
    return waiting;
  }
  /** A spawn-view job waits or runs before control. */
  spawnViewOpen(): boolean { return !this.active && !this.owner.disposed && !this.owner.disposing && (this.busy || this.inView() !== undefined); }
  /** Resolves once this queue has no spawn-view job waiting or running. */
  spawnViewIdle(): Promise<void> {
    if (!this.spawnViewOpen()) return Promise.resolve();
    return new Promise(resolve => { this.idle.push(resolve); });
  }
  private settle(): void { const waiters = this.idle; this.idle = []; for (const resolve of waiters) resolve(); }
  /** Before control, the nearest waiting job inside the open spawn-view fence. */
  private inView(): Job | undefined { return this.select(true); }
  private inFence(job: Job): boolean {
    const view = spawnViewUsesCamera() ? this.view?.() ?? null : null, from = view?.eye ?? this.position();
    const distance = view === null ? (job.at.x - from.x) ** 2 + (job.at.z - from.z) ** 2 : streamingDistance(job.at, view);
    return distance <= (spawnView?.radius ?? 0) ** 2;
  }
  private select(beforeControl: boolean): Job | undefined {
    if (this.waiting.size === 0 || (beforeControl && spawnView === null)) return undefined;
    const view = spawnViewUsesCamera() ? this.view?.() ?? null : null, from = view?.eye ?? this.position();
    if (!Number.isFinite(from.x) || !Number.isFinite(from.z)) throw new Error('Invalid refinement viewer');
    let best: Job | undefined, bestSeen = false, bestDistance = Infinity;
    for (const job of this.waiting.values()) {
      const distance = view === null ? (job.at.x - from.x) ** 2 + (job.at.z - from.z) ** 2 : streamingDistance(job.at, view);
      const seen = view !== null && streamingVisible(job.at, view);
      // Before control the fence takes every job within its radius, seen or not (DL17); seen jobs run first.
      if (beforeControl && distance > (spawnView?.radius ?? 0) ** 2) continue;
      if (best === undefined || (seen && !bestSeen) || (seen === bestSeen && (distance < bestDistance || (distance === bestDistance && job.order < best.order)))) {
        best = job; bestSeen = seen; bestDistance = distance;
      }
    }
    return best;
  }
  private kick(): void {
    if (this.busy || this.scheduled || this.owner.disposed || this.owner.disposing || this.waiting.size === 0) return;
    if (!this.active && this.inView() === undefined) return;
    this.scheduled = true;
    queueMicrotask(() => { this.scheduled = false; void this.drain(); });
  }
  private async drain(): Promise<void> {
    if (this.busy || this.owner.disposed || this.owner.disposing) return;
    this.busy = true;
    try {
      while (this.waiting.size > 0 && !this.owner.disposed && !this.owner.disposing) {
        // The current camera is sampled again after every yielded batch. Before control the fence runs FENCE_LANES jobs
        // at once (DL21); after control one, paced by frames.
        const batch: Job[] = [];
        const lanes = this.active ? 1 : FENCE_LANES;
        while (batch.length < lanes) {
          const job = this.active ? this.select(false) : this.inView();
          if (job === undefined) break;
          this.waiting.delete(job.id); batch.push(job);
        }
        if (batch.length === 0) break;
        const fence = !this.active;
        // Each job leaves the running count as it finishes, so the fence's 'n of m' counts a finished one once.
        this.running = batch.length;
        const results = await Promise.allSettled(batch.map(async job => {
          try { await job.run(); if (fence) fenceDone++; } finally { this.running--; }
        }));
        let refusal: Error | undefined;
        results.forEach((result, at) => {
          const job = batch[at]; if (job === undefined) return;
          if (result.status === 'fulfilled') { this.known.delete(job.id); job.resolve(!this.owner.disposed && !this.owner.disposing); return; }
          if (this.owner.disposed || this.owner.disposing) { job.resolve(false); return; }
          const error: unknown = result.reason;
          refusal ??= error instanceof Error ? error : new Error('Refinement failed', { cause: error });
          job.reject(refusal);
        });
        if (this.owner.disposed || this.owner.disposing) break;
        if (refusal !== undefined) {
          this.failure = refusal;
          for (const queued of this.waiting.values()) queued.reject(refusal);
          this.waiting.clear(); this.known.clear(); break;
        }
        if (this.waiting.size > 0) await this.pause();
      }
    } catch (error) {
      const refusal = error instanceof Error ? error : new Error('Refinement failed', { cause: error });
      this.failure = refusal;
      for (const queued of this.waiting.values()) queued.reject(refusal);
      this.waiting.clear(); this.known.clear();
    } finally { this.busy = false; this.settle(); if (this.active) this.kick(); }
  }
}
