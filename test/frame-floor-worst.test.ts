import {expect, test} from 'vitest';
// oxlint-disable-next-line import/no-nodejs-modules -- exercise the real serialized sampler without starting a browser or Simulator
import {readFileSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- isolate the real page sampler with controlled drawn-frame timestamps
import {runInNewContext} from 'node:vm';

async function sampleIntervals(intervals: number[], options: {timeline?: boolean; frameDeltas?: number[]; draws?: number[]; renderMs?: number[]} = {}): Promise<unknown> {
  const source = readFileSync(new URL('../scripts/frame-floor.mjs', import.meta.url), 'utf8');
  const start = source.indexOf('function sample(n, timeline = false) {');
  const end = source.indexOf('/** the whole-drive sampler', start);
  if (start === -1 || end <= start) throw new Error('Serialized sampler not found');
  const callbacks: ((at: number) => void)[] = [];
  let now = 100;
  const game = {frameCount: 0, frameI: 1, frameMs: [33], workMs: [1], updateMs: [0.25], renderMs: [0.75], lastFrame: {calls: 1, triangles: 1},
    app: {cpu: {enabled: false, snapshot: () => ({enabled: true, frame: 0, owners: []})}},
    renderer: {getContext: () => ({isContextLost: () => false})}};
  const context = {window: {__wildshard: {world: {game, player: {position: {x: 0, y: 0, z: 0}}}}},
    performance: {now: () => now}, setTimeout: () => 1, clearTimeout: () => undefined,
    // oxlint-disable-next-line promise/prefer-await-to-callbacks -- the real sampler schedules native rAF callbacks, which the fixture must retain until a drawn frame
    cancelAnimationFrame: () => undefined, requestAnimationFrame: (callback: (at: number) => void) => {
      callbacks.push(callback); return callbacks.length;
    }};
  const result: unknown = runInNewContext(`(${source.slice(start, end)})(${intervals.length},${options.timeline === true})`, context);
  for (const [index, delta] of [0, ...intervals].entries()) {
    now += delta; game.frameCount += options.frameDeltas?.[index] ?? 1;
    game.lastFrame.calls = options.draws?.[index] ?? 1;
    game.renderMs[0] = options.renderMs?.[index] ?? 0.75;
    const callback = callbacks.shift();
    if (callback === undefined) throw new Error('Sampler stopped before every drawn frame');
    // oxlint-disable-next-line promise/prefer-await-to-callbacks -- deliver the retained native rAF callback at the controlled frame timestamp
    callback(now);
  }
  expect(callbacks).toHaveLength(0);
  return await result;
}

test('retains the six worst real cadence intervals without changing the measured sample', async () => {
  expect(await sampleIntervals([33.111, 80.222, 35.123, 70.123, 40.456, 60.789, 50.222, 45.123, 34.555]))
    .toMatchObject({frames: 9, skipped: 0, p50Ms: 45.123, p95Ms: 80.222, p99Ms: 80.222, maxMs: 80.222,
      worstFrameMs: [80.222, 70.123, 60.789, 50.222, 45.123, 40.456]});
});

test('pairs each whole-frame draw count with its own render CPU sample', async () => {
  expect(await sampleIntervals([33, 34], { draws: [999, 150, 100], renderMs: [99, 4.5, 3] }))
    .toMatchObject({ frames: 2, drawSamples: [{ draws: 150, renderMs: 4.5 }, { draws: 100, renderMs: 3 }] });
});

test('keeps ties and reports only existing intervals in samples shorter than six', async () => {
  expect(await sampleIntervals([34, 34, 34])).toMatchObject({frames: 3, worstFrameMs: [34, 34, 34]});
});

test('identifies both endpoint draws without inventing skipped-frame measurements', async () => {
  expect(await sampleIntervals([33, 67, 34], {timeline: true, frameDeltas: [1, 1, 2, 1]}))
    .toMatchObject({frames: 3, skipped: 1, worstFrameMs: [67, 34, 33], frameTimeline: {frames: [
      {drawnFrame: 2, priorDrawnFrame: 1, frameDelta: 1, intervalMs: 33},
      {drawnFrame: 4, priorDrawnFrame: 2, frameDelta: 2, intervalMs: 67},
      {drawnFrame: 5, priorDrawnFrame: 4, frameDelta: 1, intervalMs: 34},
    ]}});
  expect(await sampleIntervals([33])).not.toHaveProperty('frameTimeline');
});

test('attributes CPU samples on the native navigation clock after a delayed profiler start', () => {
  const source = readFileSync(new URL('../scripts/frame-floor.mjs', import.meta.url), 'utf8');
  const start = source.indexOf('function summarizeTravelProfile('), end = source.indexOf('\nfunction webkit(', start);
  if (start === -1 || end <= start) throw new Error('CPU attribution function missing');
  const profile = {startTime: 100_000_000, pageNavigationStartUs: 99_000_000,
    nodes: [{id: 1, callFrame: {functionName: '(root)', url: '', lineNumber: -1}, children: [2]},
      {id: 2, callFrame: {functionName: 'nativeLink', url: 'shader.js', lineNumber: 7}}],
    samples: [2, 2], timeDeltas: [1_400_000, 10_000]};
  const saved: string[] = [];
  const context = {profile, cpuProfileDir: 'unused', join: (dir: string, file: string) => `${dir}/${file}`,
    writeFileSync: (_path: string, bytes: string): void => { saved.push(bytes); }};
  // The page evaluate after Profiler.start arrives at 2400 ms. Sampling has
  // already started: using that as the profile origin shifts this task by 1400 ms.
  const result: unknown = runInNewContext(`(${source.slice(start, end)})(profile, 2400, [[2400, 15]], 'drive')`, context);
  expect(result).toMatchObject({longTasks: 1, tasks: [{start: 2400, ms: 15,
    self: ['10 ms nativeLink shader.js:8'], inclusive: ['10 ms nativeLink shader.js:8']}]});
  expect(saved).toEqual([JSON.stringify(profile)]);
});
