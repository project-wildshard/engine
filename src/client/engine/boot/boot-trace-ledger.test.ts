// @vitest-environment happy-dom
// ENGINE-MEMORY EM9 (b): each boot checkpoint carries the ledger's totals by kind, so the "Abrupt previous page" report of
// a page the phone killed says what the engine held at its last step.
import { beforeEach, expect, test, vi } from 'vitest';
import { saveStorage } from '../saves/slots';
import { createBootTrace, ledgerTotals, PROGRESS_WRITE_MS, type BootTraceTransports } from './bootTrace';
import type { ProgressView } from './plan';

const MB = 1e6;

beforeEach(() => { localStorage.clear(); saveStorage('device').removeItem('boot.trace'); saveStorage('device').removeItem('boot.reports'); vi.stubGlobal('__BUILD_ID__', 'test-build'); });

test('the ledger flattens to <domain>/<kind> in MB to 0.1, small kinds dropped, workers summed', () => {
  expect(ledgerTotals({ gpu: { texture: 17.88 * MB, renderbuffer: 0.04 * MB }, ram: { 'array-buffer': 25.45 * MB },
    workers: { 'server/wasm': 3.2 * MB, 'server/wire': 0.6 * MB, 'decode/isolate': 0 } }))
    .toEqual({ 'gpu/texture': 17.9, 'ram/array-buffer': 25.5, workers: 3.8 });
});

test('a killed boot reports its last checkpoints with the ledger at each', async () => {
  let held = 100 * MB;
  const sent: string[] = [];
  const transports = (): BootTraceTransports => ({
    inbox: (_error, _build, diagnostic) => { sent.push(diagnostic); return Promise.resolve('ok'); },
    deliver: () => Promise.resolve(true),
    ledger: () => ({ gpu: { texture: held }, ram: { 'array-buffer': held / 2 } }),
  });
  const first = createBootTrace(transports());
  first.startBoot({ id: 'nine-dragon-stack', name: 'Nine Dragon Stack' });
  first.recordBootCheckpoint('world:sky');
  held = 400 * MB;
  first.recordBootCheckpoint('world:props', { members: 12 });
  // the page dies here: no handler runs; the next document reads the breadcrumb
  const stored = JSON.parse(saveStorage('device').getItem('boot.trace') ?? 'null') as { checkpoints: { operation: string; ledger?: Record<string, number> }[] };
  expect(stored.checkpoints.map((c) => [c.operation, c.ledger])).toEqual([
    ['world:sky', { 'gpu/texture': 100, 'ram/array-buffer': 50 }],
    ['world:props', { 'gpu/texture': 400, 'ram/array-buffer': 200 }],
  ]);

  const next = createBootTrace(transports());
  next.inspectPreviousBoot();
  await vi.waitFor(() => { expect(sent).toHaveLength(1); });
  expect(next.previousBootLine()).toContain('Abrupt previous page: Nine Dragon Stack');
  const diagnostic = JSON.parse(sent[0] ?? '{}') as { checkpoints: { operation: string; ledger?: Record<string, number> }[] };
  expect(diagnostic.checkpoints.at(-1)).toMatchObject({ operation: 'world:props', ledger: { 'gpu/texture': 400, 'ram/array-buffer': 200 } });
});

test('a ledger that throws leaves the checkpoint without one', () => {
  const trace = createBootTrace({ inbox: () => Promise.resolve('ok'), deliver: () => Promise.resolve(true), ledger: () => { throw new Error('no counters'); } });
  trace.startBoot({ id: 'template', name: 'Template' });
  trace.recordBootCheckpoint('world:data');
  const stored = JSON.parse(saveStorage('device').getItem('boot.trace') ?? 'null') as { checkpoints: Record<string, unknown>[] };
  expect(stored.checkpoints[0]).toEqual({ atMs: expect.any(Number), operation: 'world:data', facts: {} });
});

test('MG10: a detail-only change persists at most once per PROGRESS_WRITE_MS; a stage or checkpoint writes at once', () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  try {
    vi.setSystemTime(1_000_000);
    const trace = createBootTrace({ inbox: () => Promise.resolve('ok'), deliver: () => Promise.resolve(true) });
    trace.startBoot({ id: 'nine-dragon-stack', name: 'Nine Dragon Stack' });
    const view = (step: string, detail: string): ProgressView => ({ download: 0.5, setup: 0.5, done: false, error: null, step: step as ProgressView['step'], label: step, detail,
      bytes: null, bytesRead: 0, bytesTotal: 0, filesDone: 0, filesTotal: 0, worldBytesReady: true, doneCount: 0, rows: [], gaps: [] });
    const stored = (): { stage: string; detail: string } => JSON.parse(saveStorage('device').getItem('boot.trace') ?? 'null') as { stage: string; detail: string };
    trace.recordBootProgress(view('shaders', 'Shaders · 1 of 60'));
    expect(stored()).toMatchObject({ stage: 'shaders', detail: 'Shaders · 1 of 60' });
    vi.setSystemTime(1_000_000 + PROGRESS_WRITE_MS / 2);
    trace.recordBootProgress(view('shaders', 'Shaders · 2 of 60'));
    expect(stored().detail).toBe('Shaders · 1 of 60');
    trace.recordBootCheckpoint('compile:before');
    expect(stored().detail).toBe('Shaders · 2 of 60');
    trace.recordBootProgress(view('shaders', 'Shaders · 3 of 60'));
    vi.setSystemTime(1_000_000 + PROGRESS_WRITE_MS);
    trace.recordBootProgress(view('shaders', 'Shaders · 4 of 60'));
    expect(stored().detail).toBe('Shaders · 4 of 60');
    trace.recordBootProgress(view('firstFrame', 'First frame'));
    expect(stored()).toMatchObject({ stage: 'firstFrame', detail: 'First frame' });
  } finally { vi.useRealTimers(); }
});
