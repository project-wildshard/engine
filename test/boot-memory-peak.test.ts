import { expect, test } from 'vitest';
import { CRASH_LINE, MEMORY_AMBER } from '../src/client/game/grid/budgetOverlay';
import { CHROMIUM_TO_PHONE, MEMORY_LINE_BYTES, PHONE_MODEL, bootMemoryLine, chromiumToPhone, bootMemoryVerdict, bootPageURL, processDumps } from '../scripts/boot-memory-peak.mjs';

const name = (pid: number, role: string): unknown => ({ pid, ph: 'M', name: 'process_name', args: { name: role } });
const dump = (pid: number, id: string, bytes: number): unknown => ({ pid, id, ph: 'v', args: { dumps: { process_totals: { private_footprint_bytes: bytes.toString(16) } } } });
const MB = 1e6;

test('MG1: the line is engine MEMORY_AMBER (J408)', () => {
  expect(MEMORY_LINE_BYTES).toBe(MEMORY_AMBER);
});

test('MG1: each dump sums its processes by role; renderers add up', () => {
  const events = [name(1, 'Browser'), name(2, 'Renderer'), name(3, 'GPU Process'), name(4, 'Renderer'), name(5, 'Utility'),
    dump(1, 'a', 90 * MB), dump(2, 'a', 300 * MB), dump(3, 'a', 200 * MB), dump(4, 'a', 20 * MB), dump(5, 'a', 999 * MB),
    dump(2, 'b', 400 * MB), { pid: 2, ph: 'v', id: 'c', args: {} }];
  const dumps = processDumps(events);
  expect(dumps.get('a')).toEqual({ browser: 90 * MB, renderer: 320 * MB, gpu: 200 * MB });
  expect(dumps.get('b')).toEqual({ browser: 0, renderer: 400 * MB, gpu: 0 });
  expect(dumps.has('c')).toBe(false);
});

test('MG1: the peak is the largest renderer + GPU dump, named by its loading step; the phone estimate goes red over the line', () => {
  const dumps = new Map([['a', { browser: 50 * MB, renderer: 300 * MB, gpu: 200 * MB }], ['b', { browser: 50 * MB, renderer: 900 * MB, gpu: 700 * MB }],
    ['c', { browser: 50 * MB, renderer: 1200 * MB, gpu: 600 * MB }]]);
  const samples = [{ atMs: 0, step: 'page', dump: null, heapBytes: 1 * MB }, { atMs: 250, step: 'props', dump: 'a', heapBytes: 100 * MB },
    { atMs: 500, step: 'shaders', dump: 'b', heapBytes: 300 * MB }, { atMs: 750, step: 'ready', dump: 'c', heapBytes: 400 * MB }];
  const red = bootMemoryVerdict(samples, dumps, { factor: 2 });
  // the raw peak is after the card (ready), but the phone estimate is the renderer under the card: 900 MB x2
  expect(red).toMatchObject({ peakBytes: 1800 * MB, peak: { step: 'ready', renderer: 1200 * MB, gpu: 600 * MB, heapBytes: 400 * MB }, heapPeakBytes: 400 * MB,
    rendererPeak: { bytes: 900 * MB, step: 'shaders' }, samples: 3, factor: 2, phoneBytes: 1800 * MB, budgetBytes: 1.5e9, pass: false });
  expect(red.steps.map(step => [step.step, step.peakBytes])).toEqual([['props', 500 * MB], ['shaders', 1600 * MB], ['ready', 1800 * MB]]);
  // EM11's bar scales with the factor in use
  const bar = PHONE_MODEL.chromium.loadingPerRenderer as { low: number; central: number; high: number };
  expect(red).toMatchObject({ phoneLowBytes: Math.round(1800 * MB * bar.low / bar.central), phoneHighBytes: Math.round(1800 * MB * bar.high / bar.central) });
  expect(bootMemoryLine('nine', red)).toBe(`BOOT MEMORY nine: RED phone 1800 MB (${(red.phoneLowBytes / MB).toFixed(0)}-${(red.phoneHighBytes / MB).toFixed(0)} MB) / 1500 MB (loading renderer 900 MB at shaders x2.00, EM11); Chromium peak 1800 MB = renderer 1200 MB + GPU 600 MB at ready; JS heap peak 400 MB; 3 dumps`);
  expect(bootMemoryVerdict(samples, dumps, { factor: 1.5 })).toMatchObject({ phoneBytes: 1350 * MB, pass: true });
  expect(bootMemoryVerdict(samples, dumps, { factor: 2, budgetBytes: 1800 * MB }).pass).toBe(true);
  // the GPU process does not move the phone estimate (Mac ANGLE Metal read 1.3-4.5 GB on one build)
  const noisy = new Map([...dumps].map(([id, row]) => [id, { ...row, gpu: row.gpu * 5 }]));
  expect(bootMemoryVerdict(samples, noisy, { factor: 2 }).phoneBytes).toBe(red.phoneBytes);
});

test('MG2 / EM11: the factor puts staging v0.1.36, which killed Jake\'s iPhone 17 Pro, over the crash line, and over the 1.5 GB refusal', () => {
  // mini-memcal 2026-11-17: v0.1.36 + Nine rev 2, Low, at "boot plan complete / compile:after", renderer 1029-1063 MB (GPU 1.7-2.3 GB)
  for (const renderer of [1029, 1061, 1063]) {
    const verdict = bootMemoryVerdict([{ atMs: 0, step: 'finish', dump: 'a', heapBytes: 0 }], new Map([['a', { browser: 0, renderer: renderer * MB, gpu: 1700 * MB }]]));
    expect(verdict.phoneBytes).toBeGreaterThan(CRASH_LINE - 0.06e9); // a floor from one crash: within ~3% of the line at the lowest run
    expect(verdict.pass).toBe(false);
  }
  // the old 0.87 x (renderer + GPU) put the phone's "reading" at 1.845 GB, under the line the phone crossed
  expect(0.87 * 2124e6).toBeLessThan(CRASH_LINE);
});

test('MG2: the renderer-to-phone factor is the same on Metal and Linux (the renderer is CPU memory)', () => {
  expect(chromiumToPhone('darwin')).toBe(CHROMIUM_TO_PHONE.darwin);
  expect(chromiumToPhone('linux')).toBe(CHROMIUM_TO_PHONE.linux);
  // EM11: no longer a flat 2.0, the chain's fitted ratio, with a bar around it
  const bar = PHONE_MODEL.chromium.loadingPerRenderer as { low: number; central: number; high: number };
  expect(CHROMIUM_TO_PHONE).toEqual({ darwin: bar.central, linux: bar.central });
  expect(bar.low).toBeLessThan(bar.central);
  expect(bar.central).toBeLessThan(bar.high);
});

test('MG1: a run no dump measured refuses rather than passing', () => {
  expect(() => bootMemoryVerdict([{ atMs: 0, step: 'page', dump: null, heapBytes: 0 }], new Map())).toThrow('the boot was not measured');
  expect(() => bootMemoryVerdict([], new Map(), { factor: 0 })).toThrow('Invalid memory verdict');
});

test('MG1: the boot page enters the shard straight in, muted, with no service worker', () => {
  const page = new URL(bootPageURL('http://127.0.0.1:4401/?x=1', 'nine-dragon-stack'));
  expect(Object.fromEntries(page.searchParams)).toEqual({ x: '1', chunk: 'nine-dragon-stack', mute: '1', skipintro: '1', nolock: '1', sw: '0' });
});
