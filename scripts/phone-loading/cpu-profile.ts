import type {CDPSession} from 'playwright';

export interface PageCpuCapture {
  /** CDP monotonic profile time translated to the native epoch clock. */
  epochStartMs: number;
  uncertaintyMs: number;
  epochOffsetMs: number;
  clock: 'CDP Performance.Timestamp';
  clockAligned: boolean;
  restartedOnNavigation: boolean;
  startHandshake: {before: number; after: number};
  stopHandshake: {before: number; after: number};
  pageOnly: true;
  profile: object;
}

/** Diagnostic only: sample the page across selected-entry navigation. The
 * original native controls/requests still determine the measured interval. */
export async function startPageCpuProfile(cdp: CDPSession): Promise<() => Promise<PageCpuCapture>> {
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', {interval: 1000});
  const before = Date.now();
  await cdp.send('Profiler.start');
  const after = Date.now();
  await cdp.send('Performance.enable');
  // Fixed clock handshakes, not readiness retries. Pick the narrowest interval;
  // Profiler.start itself can compile for hundreds of milliseconds.
  const clocks = await Promise.all([0, 1, 2].map(async () => {
    const start = Date.now();
    const {metrics} = await cdp.send('Performance.getMetrics');
    const end = Date.now(), stamp = metrics.find(metric => metric.name === 'Timestamp')?.value;
    if (stamp === undefined) throw new Error('Page CPU profile has no monotonic clock');
    return {epochOffsetMs: (start + end) / 2 - stamp * 1000, uncertaintyMs: (end - start) / 2};
  }));
  const clock = clocks.reduce((best, candidate) => candidate.uncertaintyMs < best.uncertaintyMs ? candidate : best);
  return async () => {
    try {
      const stopBefore = Date.now(), {profile} = await cdp.send('Profiler.stop'), stopAfter = Date.now();
      const epochStartMs = profile.startTime / 1000 + clock.epochOffsetMs;
      const epochEndMs = profile.endTime / 1000 + clock.epochOffsetMs;
      const clockAligned = epochEndMs >= stopBefore - clock.uncertaintyMs - 1 && epochEndMs <= stopAfter + clock.uncertaintyMs + 1;
      return {epochStartMs, ...clock, clock: 'CDP Performance.Timestamp', clockAligned,
        restartedOnNavigation: epochStartMs > after + clock.uncertaintyMs + 1,
        startHandshake: {before, after}, stopHandshake: {before: stopBefore, after: stopAfter}, pageOnly: true, profile};
    } finally {await cdp.send('Profiler.disable'); await cdp.send('Performance.disable');}
  };
}
