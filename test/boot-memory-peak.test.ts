import { expect, test, vi } from 'vitest';
import { runInNewContext } from 'node:vm';
import { CRASH_LINE, MEMORY_AMBER } from '../src/client/game/grid/budgetOverlay';
import { CHROMIUM_TO_PHONE, MEMORY_LINE_BYTES, PHONE_MODEL, alignProcessDumps, bootMemoryLine, TRACE_BUFFER_KB, chromiumToPhone, bootMemoryVerdict, bootPageURL, installBootMemoryProbe, processDumps } from '../src/scripts/boot-memory-peak.mjs';
import type { BootSample } from '../src/scripts/boot-memory-peak.mjs';
import { phoneFromLedger } from '../src/scripts/memory/phoneModel.mjs';

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

test('MG1: the largest renderer + GPU dump is separate from a historical renderer-only estimate', () => {
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
  expect(bootMemoryLine('nine', red)).toBe(`BOOT MEMORY nine: RED phone 1800 MB (${(red.phoneLowBytes / MB).toFixed(0)}-${(red.phoneHighBytes / MB).toFixed(0)} MB) / 1500 MB (loading renderer 900 MB at shaders x2.00, legacy EM11 ratio); Chromium peak 1800 MB = renderer 1200 MB + GPU 600 MB at ready; JS heap peak 400 MB; 3 dumps`);
  expect(bootMemoryVerdict(samples, dumps, { factor: 1.5 })).toMatchObject({ phoneBytes: 1350 * MB, pass: true });
  expect(bootMemoryVerdict(samples, dumps, { factor: 2, budgetBytes: 1800 * MB }).pass).toBe(true);
  // the GPU process does not move the phone estimate (Mac ANGLE Metal read 1.3-4.5 GB on one build)
  const noisy = new Map([...dumps].map(([id, row]) => [id, { ...row, gpu: row.gpu * 5 }]));
  expect(bootMemoryVerdict(samples, noisy, { factor: 2 }).phoneBytes).toBe(red.phoneBytes);
});

test('MG2: a loading ledger uses the live fit and includes worker bytes without multiplying the boot transient', () => {
  const process = { browser: 50 * MB, renderer: 900 * MB, gpu: 1200 * MB };
  const dumps = new Map([['report', process]]);
  const ledger = { ram: { owned: 120 * MB }, workers: { wasm: 30 * MB }, gpu: { texture: 150 * MB } };
  const first = { atMs: 0, step: 'modules', dump: 'report', heapBytes: 0 };
  const samples = [
    { ...first, ledger: { ram: {}, gpu: {}, workers: {} } },
    { atMs: 5, step: 'shaders', dump: null, heapBytes: 0, ledger },
    { atMs: 8, step: 'ready', dump: null, heapBytes: 0, ledger: { ...ledger, ram: { owned: 900 * MB } } },
  ];
  const range = phoneFromLedger(ledger, PHONE_MODEL);
  const verdict = bootMemoryVerdict(samples, dumps);
  expect(verdict).toMatchObject({ factor: null, phoneStep: 'shaders', phoneBytes: Math.round(range.central),
    phoneLowBytes: Math.round(range.low), phoneHighBytes: Math.round(range.high), pass: true });
  expect(bootMemoryLine('nine', verdict)).toContain('EM11 ledger at shaders');
  expect(bootMemoryVerdict(samples, dumps, { budgetBytes: verdict.phoneBytes - 1 }).pass).toBe(false);
  expect(bootMemoryVerdict(samples, new Map([['report', { ...process, renderer: 2500 * MB, gpu: 50 * MB }]])).phoneBytes).toBe(verdict.phoneBytes);
  expect(() => bootMemoryVerdict([{ ...first, ledger: null }], dumps)).toThrow('No loading ledger');
});

test('MG2: the first request joins the first trace dump even when ids start one apart', () => {
  const a = { browser: 0, renderer: 100 * MB, gpu: 0 }, b = { ...a, renderer: 900 * MB };
  const samples = [
    { atMs: 0, step: 'page', dump: '0x1', heapBytes: 0 },
    { atMs: 5, step: 'loading', dump: null, heapBytes: 0 },
    { atMs: 8, step: 'shaders', dump: '0x2', heapBytes: 0 },
  ];
  expect([...alignProcessDumps(samples, new Map([['0x1', b], ['0x0', a]]))]).toEqual([['0x1', a], ['0x2', b]]);
  expect(() => alignProcessDumps(samples, new Map([['0x1', b]]))).toThrow('does not match');
});

test('MG2: the page samples the load even if Chromium process dumps stop at page start', async () => {
  const page = new EventTarget();
  let step = 'modules', ram = 80 * MB;
  const samples: BootSample[] = [{ atMs: 0, step: 'page', dump: 'start', heapBytes: 0 }];
  const counters = () => ({ ram: { 'array-buffer': ram }, gpu: {}, workers: {} });
  vi.useFakeTimers();
  const document = Object.assign(page, { querySelector: () => ({ dataset: { step }, querySelector: () => null }) });
  const window = {
    __wildshardMemory: { counters },
    __recordBootMemoryLedger: (row: { at: number; step: string; counters: ReturnType<typeof counters> }) => {
      samples.push({ atMs: row.at, step: row.step, ledger: row.counters, dump: null, heapBytes: 0 });
    },
  };
  try {
    runInNewContext(`(${installBootMemoryProbe.toString()})(250)`, { document, window, Date, setInterval, clearInterval });
    await vi.advanceTimersByTimeAsync(250);
    step = 'shaders';
    ram = 360 * MB;
    await vi.advanceTimersByTimeAsync(250);
    ram = 120 * MB;
    page.dispatchEvent(new Event('ws:control-ready'));
    await vi.advanceTimersByTimeAsync(1000);
    expect(samples.map(row => row.step)).toEqual(['page', 'modules', 'shaders', 'control']);
    const dumps = new Map([['start', { browser: 0, renderer: 122 * MB, gpu: 0 }]]);
    const measured = bootMemoryVerdict(samples, dumps);
    expect(measured).toMatchObject({ phoneStep: 'shaders', pass: false, rendererThroughControl: false });
    expect(bootMemoryLine('pine', measured)).toContain('Chromium partial peak');
    expect(() => bootMemoryVerdict(samples, dumps, { factor: chromiumToPhone() })).toThrow('Renderer dumps did not cover loading through control');
    expect(() => bootMemoryVerdict(samples.filter(row => row.step === 'page' || row.step === 'control'), dumps)).toThrow('No loading ledger');
  } finally {
    vi.useRealTimers();
  }
});

test('MG2: the historical factor replays the v0.1.36 crash anchor', () => {
  // mini-memcal 2026-11-17: v0.1.36 + Nine rev 2, Low, at "boot plan complete / compile:after", renderer 1029-1063 MB (GPU 1.7-2.3 GB)
  for (const renderer of [1029, 1061, 1063]) {
    const verdict = bootMemoryVerdict([{ atMs: 0, step: 'finish', dump: 'a', heapBytes: 0 }], new Map([['a', { browser: 0, renderer: renderer * MB, gpu: 1700 * MB }]]), { factor: chromiumToPhone() });
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

test('MG1: the boot page is muted, with no service worker, and names no zone (J522: bootPage enters it)', () => {
  const page = new URL(bootPageURL('http://127.0.0.1:4401/?x=1'));
  expect([page.pathname, Object.fromEntries(page.searchParams)]).toEqual(['/', { x: '1', mute: '1', skipintro: '1', nolock: '1', sw: '0' }]);
});

test('QA 11-25 row 40: the trace holds a slow boot\'s every dump', () => {
  // software GL on hosted Linux asked 186 dumps; the default buffer dropped the last ones and the count refused
  expect(TRACE_BUFFER_KB).toBeGreaterThanOrEqual(64 * 1024);
});
