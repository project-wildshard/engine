import { expect, test, vi } from 'vitest';
import type { Page } from 'playwright';
import { legacyDouble } from '@wildshard/engine/test/FakeGame';
import { observeTitleCapture, TITLE_TRACE_CATEGORIES, TITLE_TRACE_MAX_RAW_BYTES, TITLE_TRACE_MAX_COMPRESSED_BYTES, type TitleTracePort, type TitleTraceWriter } from '../scripts/parity/title-trace.mjs';

function fixture() {
  const prefix = 'nine-title', files = new Map<string, string | Uint8Array>();
  const page = legacyDouble<Page>({});
  const write: TitleTraceWriter = (path, bytes) => { files.set(path, bytes); };
  const metadata = (): unknown => {
    const text = files.get(`${prefix}-chromium.meta.json`);
    if (typeof text !== 'string') throw new Error('Missing trace receipt');
    return JSON.parse(text);
  };
  return { prefix, page, files, write, metadata };
}

test('native title tracing wraps one unchanged capture and retains the exact bounded events', async () => {
  const f = fixture(), order: string[] = [], bytes = new TextEncoder().encode('{"traceEvents":[{"name":"ProgramLink","dur":9000000}]}');
  const start = vi.fn<TitleTracePort['start']>(() => { order.push('start'); return Promise.resolve(); });
  const stop = vi.fn<TitleTracePort['stop']>(() => { order.push('stop'); return Promise.resolve(bytes); });
  const capture = vi.fn(() => { order.push('capture'); return Promise.resolve('original pixels'); });
  expect(await observeTitleCapture(f.page, f.prefix, capture, () => ({ start, stop }), f.write)).toBe('original pixels');
  expect(order).toEqual(['start', 'capture', 'stop']); expect(start).toHaveBeenCalledOnce();
  expect(start.mock.calls[0]?.[0]).toBe(f.page);
  expect(start.mock.calls[0]?.[1]).toEqual({ categories: [...TITLE_TRACE_CATEGORIES], screenshots: false });
  expect(TITLE_TRACE_CATEGORIES).toEqual(['gpu', 'cc', 'viz', 'devtools.timeline', 'disabled-by-default-devtools.timeline']);
  expect(stop).toHaveBeenCalledOnce(); expect(capture).toHaveBeenCalledOnce();
  const packed = f.files.get(`${f.prefix}-chromium.json.gz`);
  if (!(packed instanceof Uint8Array)) throw new Error('Missing retained trace');
  const decoded = await new Response(new Blob([Uint8Array.from(packed)]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
  expect(decoded).toBe(new TextDecoder().decode(bytes));
  expect(f.metadata()).toMatchObject({ state: 'retained', rawBytes: bytes.byteLength });
});

test('capture refusal survives native trace cleanup failure without another capture', async () => {
  const f = fixture(), refused = new Error('Boot deadline: title native-capture');
  const capture = vi.fn(() => Promise.reject(refused));
  const stop = vi.fn<TitleTracePort['stop']>().mockRejectedValue(new Error('trace lost'));
  await expect(observeTitleCapture(f.page, f.prefix, capture, () => ({ start: () => Promise.resolve(), stop }), f.write)).rejects.toBe(refused);
  expect(capture).toHaveBeenCalledOnce(); expect(stop).toHaveBeenCalledOnce();
  expect(f.metadata()).toMatchObject({ state: 'unavailable', message: 'Error: trace lost', path: null });
});

test('unavailable native tracing does not skip or replace the capture', async () => {
  const f = fixture(), capture = vi.fn(() => Promise.resolve(17)), stop = vi.fn<TitleTracePort['stop']>();
  expect(await observeTitleCapture(f.page, f.prefix, capture, () => ({ start: () => Promise.reject(new Error('busy')), stop }), f.write)).toBe(17);
  expect(stop).not.toHaveBeenCalled(); expect(capture).toHaveBeenCalledOnce();
  expect(await observeTitleCapture(f.page, f.prefix, capture, () => null, f.write)).toBe(17);
  expect(capture).toHaveBeenCalledTimes(2);
});

test('oversized native trace is reported rather than uploaded or silently truncated', async () => {
  const f = fixture();
  expect(await observeTitleCapture(f.page, f.prefix, () => Promise.resolve(true), () => ({ start: () => Promise.resolve(),
    stop: () => Promise.resolve(new Uint8Array(TITLE_TRACE_MAX_RAW_BYTES + 1)) }), f.write)).toBe(true);
  expect(f.files.has(`${f.prefix}-chromium.json.gz`)).toBe(false);
  expect(f.metadata()).toMatchObject({ state: 'oversize', path: null,
    maxRawBytes: TITLE_TRACE_MAX_RAW_BYTES, maxCompressedBytes: TITLE_TRACE_MAX_COMPRESSED_BYTES,
    rawBytes: TITLE_TRACE_MAX_RAW_BYTES + 1 });
});

test('a trace the size of the first Nine receipt retains every byte within the compressed cap', async () => {
  const f = fixture(), header = '{"traceEvents":[]}', text = header + ' '.repeat(16_440_478 - header.length);
  const bytes = new TextEncoder().encode(text);
  expect(bytes.byteLength).toBe(16_440_478);
  await observeTitleCapture(f.page, f.prefix, () => Promise.resolve(true), () => ({ start: () => Promise.resolve(),
    stop: () => Promise.resolve(bytes) }), f.write);
  const packed = f.files.get(`${f.prefix}-chromium.json.gz`);
  if (!(packed instanceof Uint8Array)) throw new Error('Missing complete Nine-sized trace');
  const decoded = await new Response(new Blob([Uint8Array.from(packed)]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
  expect(decoded).toBe(text);
  expect(packed.byteLength).toBeLessThan(TITLE_TRACE_MAX_COMPRESSED_BYTES);
  expect(f.metadata()).toMatchObject({ state: 'retained', rawBytes: bytes.byteLength });
});

test('incompressible traces still refuse the unchanged eight MiB artifact cap', async () => {
  const f = fixture(), bytes = new Uint8Array(9 * 1024 * 1024);
  let state = 1;
  for (let i = 0; i < bytes.length; i++) {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    bytes[i] = state >>> 24;
  }
  await observeTitleCapture(f.page, f.prefix, () => Promise.resolve(true), () => ({ start: () => Promise.resolve(),
    stop: () => Promise.resolve(bytes) }), f.write);
  expect(f.files.has(`${f.prefix}-chromium.json.gz`)).toBe(false);
  expect(f.metadata()).toMatchObject({ state: 'oversize', path: null, rawBytes: bytes.byteLength,
    maxCompressedBytes: 8 * 1024 * 1024 });
});
