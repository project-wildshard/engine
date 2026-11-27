/**
 * SF15: the cook's encoder lanes, bounded by memory as well as count. Each lane is a worker thread holding its own
 * WebAssembly heap, and a heap never shrinks: it keeps the size of the largest encode it ran. A 2048 ASTC 6x6 encode grows
 * a heap by about 1.9 GB (a 2048 UASTC one by about 230 MB), so three lanes on Pine Hollow's kept 2048 rows passed a cook
 * job's 6 GB. A lane takes a job only while every lane's held heap, its own grown to that job's, stays within `budget`
 * (the lone lane always may, so a job above the budget still runs, by itself), and a lane that ran a job above
 * `recycleAbove` is ended so the next job starts on a small heap.
 */
const MB = 1 << 20;
/** A fresh lane's heap: the encoder loaded, nothing encoded. */
export const LANE_BASE_HEAP: number = 64 * MB;
/** The heap a lane may hold after a job before it is ended (the next job gets a fresh one). */
export const RECYCLE_ABOVE: number = 512 * MB;

/** The encoder heaps' budget: `COOK_ENCODE_MB`, else 4 GB, which leaves a 6 GB cook job room for its own maps. */
export function encodeBudget(env: Readonly<Record<string, string | undefined>> = process.env): number {
  const asked = Number(env['COOK_ENCODE_MB']);
  return Number.isSafeInteger(asked) && asked > 0 ? asked * MB : 4096 * MB;
}

/** One encode for a lane: its cache key, what the worker is sent, and the heap it grows the lane to. */
export interface LaneJob<T> {readonly key: string; readonly input: T; readonly heap: number}

/** A worker thread as the lanes use it (`node:worker_threads` `Worker`). */
export interface LaneWorker {
  readonly postMessage: (message: unknown) => void;
  readonly once: {
    (event: 'message', listener: (value: unknown) => void): unknown;
    (event: 'error', listener: (error: Error) => void): unknown;
    (event: 'exit', listener: (code: number) => void): unknown;
  };
  readonly terminate: () => Promise<number>;
}

export interface LaneOptions<T> {
  readonly lanes: number; readonly budget: number; readonly recycleAbove?: number;
  /** A new worker; it posts once when ready, then answers each message once. */
  readonly spawn: () => LaneWorker;
  /** The message a job's worker is sent; its id is the lane's count of jobs. */
  readonly message: (job: LaneJob<T>, id: number) => unknown;
  /** A job's answer (`out` undefined: the lane refused it, and the real pass encodes it on the main thread). */
  readonly done: (job: LaneJob<T>, out: Uint8Array | undefined) => void;
}

interface Lane {readonly worker: LaneWorker; held: number; state: 'starting' | 'idle' | 'running'; jobs: number}

/** Run `jobs` on up to `lanes` workers, largest first, every lane's held heap within `budget`. A lane that dies leaves its
 *  job to the main thread; a worker error rejects, as the pools did before. */
export async function runLanes<T>(jobs: readonly LaneJob<T>[], options: LaneOptions<T>): Promise<void> {
  const queue = [...jobs].sort((left, right) => right.heap - left.heap);
  if (queue.length === 0) return;
  const recycleAbove = options.recycleAbove ?? RECYCLE_ABOVE, lanes = Math.max(1, options.lanes), live = new Set<Lane>();
  const held = (except?: Lane): number => [...live].reduce((sum, lane) => (lane === except ? sum : sum + lane.held), 0);
  const count = (state: Lane['state']): number => [...live].filter(lane => lane.state === state).length;
  const ended: LaneWorker[] = [];
  let failure: Error | undefined;
  await new Promise<void>(resolve => {
    let settled = false;
    // The lanes call back into the pump, which starts them: one slot, filled below.
    const lanesPump = {run: (): void => undefined};
    const end = (error?: Error): void => {
      if (settled) return;
      settled = true; failure = error;
      ended.push(...[...live].map(lane => lane.worker));
      live.clear();
      resolve();
    };
    const dispatch = (lane: Lane, job: LaneJob<T>): void => {
      lane.state = 'running'; lane.held = Math.max(lane.held, job.heap); lane.jobs += 1;
      lane.worker.once('message', value => {
        const {out} = value as {out?: Uint8Array};
        options.done(job, out === undefined ? undefined : new Uint8Array(out));
        lane.state = 'idle';
        // A heap this big is ended, so the next job starts on a fresh one.
        if (job.heap > recycleAbove && queue.length > 0) { live.delete(lane); void lane.worker.terminate(); }
        lanesPump.run();
      });
      // oxlint-disable-next-line unicorn/require-post-message-target-origin -- a worker_threads port has no origin.
      lane.worker.postMessage(options.message(job, lane.jobs));
    };
    const start = (): void => {
      const lane: Lane = {worker: options.spawn(), held: LANE_BASE_HEAP, state: 'starting', jobs: 0};
      live.add(lane);
      lane.worker.once('message', () => { lane.state = 'idle'; lanesPump.run(); });
      lane.worker.once('error', error => { end(error instanceof Error ? error : new Error(String(error))); });
      // A lane that dies leaves its job to the main thread.
      lane.worker.once('exit', () => { if (live.delete(lane)) lanesPump.run(); });
    };
    lanesPump.run = (): void => {
      if (settled) return;
      for (const lane of live) {
        const job = queue[0];
        if (job === undefined) break;
        if (lane.state !== 'idle') continue;
        // The lone running lane always may, so a job above the budget still runs, by itself.
        if (held(lane) + Math.max(lane.held, job.heap) <= options.budget || count('running') === 0) { queue.shift(); dispatch(lane, job); }
      }
      // A new lane while the count allows, a job waits for it, and that job fits beside the held heaps.
      for (;;) {
        const waiting = count('starting') + count('idle'), job = queue[waiting];
        if (job === undefined || live.size >= lanes) break;
        if (live.size > 0 && held() + Math.max(LANE_BASE_HEAP, job.heap) > options.budget) break;
        start();
      }
      if (queue.length === 0 && count('running') === 0) end();
    };
    lanesPump.run();
  });
  await Promise.all(ended.map(async worker => { await worker.terminate(); }));
  if (failure !== undefined) throw failure;
}
