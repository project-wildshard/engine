// SF15: the cook's encoder lanes are bounded by their WebAssembly heaps as well as their count. A heap never shrinks, so
// Pine Hollow's images-only cook died past 6 GB with three 6x6 lanes on its kept 2048 rows (1.9 GB a heap). A lane takes a
// job only while every lane's held heap stays within the budget, a job above it runs alone, and a lane that ran a big job
// is ended so the next starts small.
import {EventEmitter} from 'node:events';
import {expect, test} from 'vitest';
import {astc6Heap} from '../src/cook/game/astc6Wasm';
import {encodeBudget, LANE_BASE_HEAP, runLanes, type LaneJob, type LaneWorker} from '../src/cook/game/encodeLanes';
import {imageKtx2Heap} from '../src/cook/game/imageKtx2Wasm';

const MB = 1 << 20;

/** Fake workers: each answers after a tick, holds the largest heap it was sent, and the pool records the peak. */
function pool(dies?: (heap: number) => boolean) {
  const live = new Set<{held: number; running: boolean}>();
  const stats = {spawned: 0, ended: 0, peak: 0, peakRunning: 0, soloAbove: true};
  const spawn = (): LaneWorker => {
    const events = new EventEmitter(), me = {held: LANE_BASE_HEAP, running: false};
    live.add(me); stats.spawned++;
    setImmediate(() => events.emit('message', {ready: true}));
    return {
      postMessage: (message: unknown) => {
        const {heap, budget} = message as {heap: number; budget: number};
        me.held = Math.max(me.held, heap); me.running = true;
        const running = [...live].filter(lane => lane.running);
        const held = [...live].reduce((sum, lane) => sum + lane.held, 0);
        if (running.length > 1) stats.peak = Math.max(stats.peak, held);
        stats.peakRunning = Math.max(stats.peakRunning, running.length);
        if (heap > budget && running.length > 1) stats.soloAbove = false;
        setImmediate(() => {
          me.running = false;
          if (dies?.(heap) === true) { live.delete(me); events.emit('exit', 1); return; }
          events.emit('message', {out: new Uint8Array([heap / MB])});
        });
      },
      once: (event: string, listener: (value: never) => void): unknown => events.once(event, listener as (...args: unknown[]) => void),
      terminate: async () => { if (live.delete(me)) { stats.ended++; events.emit('exit', 0); } return 0; },
    };
  };
  return {spawn, stats, live};
}

const jobs = (sizes: readonly number[]): LaneJob<number>[] => sizes.map((size, at) => ({key: `job${at}`, input: size, heap: size * MB}));
const run = async (sizes: readonly number[], lanes: number, budget: number, dies?: (heap: number) => boolean) => {
  const fake = pool(dies), done: string[] = [];
  await runLanes(jobs(sizes), {lanes, budget: budget * MB, spawn: fake.spawn, message: (job: LaneJob<number>) => ({heap: job.heap, budget: budget * MB}), done: (job: LaneJob<number>) => { done.push(job.key); }});
  return {...fake.stats, done, left: fake.live.size};
};

test('every lane\'s held heap stays within the budget, and a big job\'s lane is ended after it', async () => {
  const out = await run([1900, 1900, 1900, 100, 100, 100, 100, 100, 100], 3, 4096);
  expect(out.done).toHaveLength(9);
  expect(out.peak).toBeLessThanOrEqual(4096 * MB);
  expect(out.peakRunning).toBe(3);
  expect(out.ended).toBeGreaterThanOrEqual(3);
  expect(out.left).toBe(0);
});

test('a job above the budget runs alone, and the count still caps the lanes', async () => {
  const big = await run([7600, 50, 50, 50], 3, 4096);
  expect(big.done).toHaveLength(4);
  expect(big.soloAbove).toBe(true);
  const small = await run(Array.from({length: 20}, () => 10), 3, 4096);
  expect(small.peakRunning).toBe(3);
  expect(small.spawned).toBe(3);
});

test('a lane that dies leaves its job to the main thread and the rest finish', async () => {
  const out = await run([300, 200, 100, 50], 2, 4096, heap => heap === 200 * MB);
  expect(out.done.sort()).toEqual(['job0', 'job2', 'job3']);
  expect(out.left).toBe(0);
});

test('the heap estimates and the budget', () => {
  const ktx2 = new Uint8Array(32); new DataView(ktx2.buffer).setUint32(20, 2048, true); new DataView(ktx2.buffer).setUint32(24, 2048, true);
  expect(astc6Heap(ktx2) / MB).toBeGreaterThan(1900);
  // a PNG header: 1024 x 1024
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 4, 0, 0, 0, 4, 0, 8, 2, 0, 0, 0]);
  expect(imageKtx2Heap(png) / MB).toBeGreaterThan(80);
  expect(encodeBudget({})).toBe(4096 * MB);
  expect(encodeBudget({COOK_ENCODE_MB: '2048'})).toBe(2048 * MB);
});
