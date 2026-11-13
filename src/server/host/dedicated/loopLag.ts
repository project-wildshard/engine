// SERVER-CELLS SC1: one thread's event-loop lag, read and reset once per reading. A worker sends its own in its 10 s reading; the door's
// `/metrics` (serverMetrics.ts) reads the main thread's. Kept apart from the metrics module so a worker bundle carries no metrics client.
// oxlint-disable-next-line import/no-nodejs-modules -- Node's own event-loop delay histogram.
import { monitorEventLoopDelay } from 'node:perf_hooks';

/** One reading of a thread's loop, in ms past the sampling timer: what the loop was late by. */
export interface LoopLag { readonly p50: number; readonly p99: number; readonly max: number }
/** The sampling timer's period: Node records each period whole, so a loop on time reads this. */
const RESOLUTION_MS = 10;

/** Start sampling this thread's loop; each call answers the lag since the last one and starts the next window. */
export function loopLag(): () => LoopLag {
  const delay = monitorEventLoopDelay({ resolution: RESOLUTION_MS });
  delay.enable();
  const late = (ns: number): number => Math.max(0, ns / 1e6 - RESOLUTION_MS);
  return () => {
    const read = delay.count === 0 ? { p50: 0, p99: 0, max: 0 } : { p50: late(delay.percentile(50)), p99: late(delay.percentile(99)), max: late(delay.max) };
    delay.reset();
    return read;
  };
}
