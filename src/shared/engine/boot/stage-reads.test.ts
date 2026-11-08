// @vitest-environment node
import { afterEach, expect, test, vi } from 'vitest';
import { LoadingTimeline, installLoadingTimeline } from './timeline';
import { bootWaits, loadingStage, loadingStepWaits } from './waits';

afterEach(() => { vi.restoreAllMocks(); });

// DL21 (E526): Pine's cold phone-link boot fetched 143 level files inside setup steps (edge, animals, spawn detail) while
// the card only said 'Now working on: Spawn detail' for 32 s. A step that reads files now names them on the card.
test('a loading stage names its own reads as a counted wait of its step, and drops it when the stage ends', async () => {
  const timeline = new LoadingTimeline({ id: 'fixture', steps: [{ key: 'spawnDetail', label: 'Spawn detail', weight: 1 }] }, 0, () => 100);
  const restore = installLoadingTimeline(timeline);
  const entry = (name: string, startTime: number, transferSize: number): PerformanceResourceTiming =>
    Object.defineProperties(Object.create(PerformanceResourceTiming.prototype) as PerformanceResourceTiming, {
      name: { value: name }, startTime: { value: startTime }, transferSize: { value: transferSize },
      encodedBodySize: { value: transferSize }, initiatorType: { value: 'fetch' } });
  // A resource-timing observer sees every entry, whatever the timeline buffer holds (sp-x2's review: a full 250-entry
  // buffer froze a getEntriesByType count).
  const observers: ((list: { getEntries: () => PerformanceResourceTiming[] }) => void)[] = [];
  // oxlint-disable-next-line promise/prefer-await-to-callbacks -- the observer API delivers entries through its callback.
  vi.stubGlobal('PerformanceObserver', class { constructor(callback: (list: { getEntries: () => PerformanceResourceTiming[] }) => void) { observers.push(callback); }
    observe(): void { /* entries arrive through the callback */ } disconnect(): void { observers.length = 0; } });
  let release = (): void => undefined;
  try {
    const stage = loadingStage('spawnDetail', () => new Promise<void>(resolve => { release = resolve; }));
    const entries = [entry(`${location.origin}/shardfiles/pine/blobs/glb/a.glb`, 1, 1_500_000),
      entry(`${location.origin}/shardfiles/pine/blobs/glb/b.glb`, 2, 2_600_000), entry('https://elsewhere.test/x.js', 3, 9_000_000)];
    for (const deliver of observers) deliver({ getEntries: () => entries });
    await vi.waitFor(() => {
      const waits = loadingStepWaits(bootWaits(), null, 'spawnDetail', timeline.waitOwner);
      expect(waits.map(wait => wait.label)).toEqual(['Reading 2 files · 4.1 MB']);
    });
    release(); await stage;
    expect(loadingStepWaits(bootWaits(), null, 'spawnDetail', timeline.waitOwner)).toEqual([]);
    expect(observers).toHaveLength(0); // disconnected at the stage's end
  } finally { restore(); vi.unstubAllGlobals(); }
});
