import { expect, test } from 'vitest';
import { MEMORY_AMBER } from '../src/client/game/grid/budgetOverlay';
import { CHROMIUM_TO_PHONE, MEMORY_LINE_BYTES, bootMemoryLine, chromiumToPhone, bootMemoryVerdict, bootPageURL, processDumps } from '../scripts/boot-memory-peak.mjs';

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
    ['c', { browser: 50 * MB, renderer: 800 * MB, gpu: 600 * MB }]]);
  const samples = [{ atMs: 0, step: 'page', dump: null, heapBytes: 1 * MB }, { atMs: 250, step: 'props', dump: 'a', heapBytes: 100 * MB },
    { atMs: 500, step: 'shaders', dump: 'b', heapBytes: 300 * MB }, { atMs: 750, step: 'ready', dump: 'c', heapBytes: 400 * MB }];
  const red = bootMemoryVerdict(samples, dumps, { factor: 1 });
  expect(red).toMatchObject({ peakBytes: 1600 * MB, peak: { step: 'shaders', renderer: 900 * MB, gpu: 700 * MB, heapBytes: 300 * MB }, heapPeakBytes: 400 * MB,
    samples: 3, factor: 1, phoneBytes: 1600 * MB, budgetBytes: 1.5e9, pass: false });
  expect(red.steps.map(step => [step.step, step.peakBytes])).toEqual([['props', 500 * MB], ['shaders', 1600 * MB], ['ready', 1400 * MB]]);
  expect(bootMemoryLine('nine', red)).toBe('BOOT MEMORY nine: RED phone 1600 MB / 1500 MB (Chromium peak 1600 MB = renderer 900 MB + GPU 700 MB at shaders, x1); JS heap peak 400 MB; 3 dumps');
  const calibrated = bootMemoryVerdict(samples, dumps, { factor: 0.75 });
  expect(calibrated).toMatchObject({ phoneBytes: 1200 * MB, pass: true });
  expect(bootMemoryVerdict(samples, dumps, { factor: 1, budgetBytes: 1600 * MB }).pass).toBe(true);
});

test('MG2: the Chromium-to-phone factor is per platform: Metal calibrated, Linux the reading as is until measured', () => {
  expect(chromiumToPhone('darwin')).toBe(CHROMIUM_TO_PHONE.darwin);
  expect(chromiumToPhone('linux')).toBe(CHROMIUM_TO_PHONE.linux);
  expect(CHROMIUM_TO_PHONE).toEqual({ darwin: 0.87, linux: 1 });
});

test('MG1: a run no dump measured refuses rather than passing', () => {
  expect(() => bootMemoryVerdict([{ atMs: 0, step: 'page', dump: null, heapBytes: 0 }], new Map())).toThrow('the boot was not measured');
  expect(() => bootMemoryVerdict([], new Map(), { factor: 0 })).toThrow('Invalid memory verdict');
});

test('MG1: the boot page enters the shard straight in, muted, with no service worker', () => {
  const page = new URL(bootPageURL('http://127.0.0.1:4401/?x=1', 'nine-dragon-stack'));
  expect(Object.fromEntries(page.searchParams)).toEqual({ x: '1', chunk: 'nine-dragon-stack', mute: '1', skipintro: '1', nolock: '1', sw: '0' });
});
