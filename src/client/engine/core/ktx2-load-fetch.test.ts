import { expect, test, vi } from 'vitest';
import { CompressedTexture, LoadingManager } from 'three';
import { loadKtx2 } from './ktx2';
import { bootWaits } from '../../../shared/engine/boot/waits';


// T10: KTX2 files are read with fetch, not three's FileLoader (whose progress re-stream cost ~200 ms of a Pine cold entry):
// the same URL resolution, one shared read per file in flight (so one transcode and one texture) and the same status rule.
function fixture() {
  const manager = new LoadingManager(), parsed: ArrayBuffer[] = [], textures = new Map<ArrayBuffer, CompressedTexture>();
  manager.setURLModifier(url => `${url}?v=7`);
  const target = { manager, path: '/assets/', requestHeader: { 'x-lane': 'sp-o3' }, withCredentials: false,
    parse(buffer: ArrayBuffer, onLoad?: (texture: CompressedTexture) => void): void {
      parsed.push(buffer);
      let texture = textures.get(buffer);
      if (texture === undefined) { texture = new CompressedTexture([], 4, 4); textures.set(buffer, texture); }
      onLoad?.(texture);
    } };
  return { target, parsed };
}

test('a KTX2 file is read once per resolved URL while in flight, through the page modifier, and parsed by its loader', async () => {
  const f = fixture(), requests: { url: string; init: RequestInit | undefined }[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation((url: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: typeof url === 'string' ? url : url instanceof URL ? url.href : url.url, init });
    return Promise.resolve(new Response(new Uint8Array([1, 2, 3]), { status: 200 }));
  });
  const [a, b] = await Promise.all([loadKtx2(f.target, 'rock.ktx2'), loadKtx2(f.target, 'rock.ktx2')]);
  expect(requests).toEqual([{ url: '/assets/rock.ktx2?v=7', init: { headers: { 'x-lane': 'sp-o3' }, credentials: 'same-origin' } }]);
  expect(a).toBe(b); expect(f.parsed).toHaveLength(2); expect(f.parsed[0]).toBe(f.parsed[1]);
  expect([...new Uint8Array(f.parsed[0] ?? new ArrayBuffer(0))]).toEqual([1, 2, 3]);
  await loadKtx2(f.target, 'rock.ktx2');
  expect(requests).toHaveLength(2); // a finished read is not kept
});

test('a KTX2 read refuses a failed status and is read again after', async () => {
  const f = fixture();
  let status = 404;
  vi.spyOn(globalThis, 'fetch').mockImplementation(() => Promise.resolve(new Response(new Uint8Array([9]), { status, statusText: 'Not Found' })));
  await expect(loadKtx2(f.target, 'gone.ktx2')).rejects.toThrow('responded with 404: Not Found');
  status = 200;
  await expect(loadKtx2(f.target, 'gone.ktx2')).resolves.toBeInstanceOf(CompressedTexture);
});

test('NB13: parallel KTX2 bodies and decoder replies each name their original file while pending', async () => {
  const f = fixture(), replies = new Map<string, ReadableStreamDefaultController<Uint8Array>>();
  const spans: {operation: string; result: string}[] = [];
  const previousTiming = Object.getOwnPropertyDescriptor(globalThis, '__bootTiming');
  Object.defineProperty(globalThis, '__bootTiming', {configurable: true, writable: true, value: {version: 1,
    begin(operation: string): number { spans.push({operation, result: 'pending'}); return spans.length; },
    end(id: number, result: string): void { const row = spans[id - 1]; if (row !== undefined) row.result = result; },
    mark: (): void => undefined,
  }});
  try {
  const decoded: ((texture: CompressedTexture) => void)[] = [], refused: ((error: Error) => void)[] = [];
  const target = {...f.target, parse(_buffer: ArrayBuffer, done?: (texture: CompressedTexture) => void, fail?: (error: Error) => void): void {
    if (done !== undefined) decoded.push(done);
    if (fail !== undefined) refused.push(fail);
  }};
  vi.spyOn(globalThis, 'fetch').mockImplementation(input => {
    const path = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    return Promise.resolve(new Response(new ReadableStream<Uint8Array>({start(controller) { replies.set(path, controller); }})));
  });
  const jobs = Array.from({length: 7}, (_, index) => loadKtx2(target, `map-${index}.ktx2`));
  const paths = Array.from({length: 7}, (_, index) => `/assets/map-${index}.ktx2?v=7`);
  expect(spans.filter(row => row.operation.startsWith('texture:read '))).toEqual(paths.map(path => ({operation: `texture:read ${path}`, result: 'pending'})));
  expect(bootWaits().filter(row => row.label === 'Reading texture').map(row => row.resource ?? '').sort((a, b) => a < b ? -1 : a > b ? 1 : 0)).toEqual(paths);
  expect(bootWaits().filter(row => row.label === 'Reading texture').every(row => row.kind === 'file')).toBe(true);
  for (const reply of replies.values()) { reply.enqueue(Uint8Array.of(1, 2, 3)); reply.close(); }
  await vi.waitFor(() => { expect(decoded).toHaveLength(7); });
  expect(spans.filter(row => row.operation.startsWith('texture:read ')).every(row => row.result === 'complete')).toBe(true);
  expect(spans.filter(row => row.operation.startsWith('texture:decode '))).toEqual(paths.map(path => ({operation: `texture:decode ${path}`, result: 'pending'})));
  expect(bootWaits().filter(row => row.label === 'Reading texture')).toEqual([]);
  expect(bootWaits().filter(row => row.label === 'Preparing texture').map(row => row.resource ?? '').sort((a, b) => a < b ? -1 : a > b ? 1 : 0)).toEqual(paths);
  const results = Promise.allSettled(jobs);
  decoded.slice(0, 6).forEach(done => { done(new CompressedTexture([], 4, 4)); });
  refused[6]?.(new Error('Broken map'));
  const settled = await results;
  expect(settled.map(row => row.status)).toEqual(['fulfilled', 'fulfilled', 'fulfilled', 'fulfilled', 'fulfilled', 'fulfilled', 'rejected']);
  for (const row of settled) if (row.status === 'fulfilled') row.value.dispose();
  expect(bootWaits().filter(row => row.label === 'Reading texture' || row.label === 'Preparing texture')).toEqual([]);
  expect(spans.filter(row => row.operation.startsWith('texture:decode ')).map(row => row.result)).toEqual(['complete', 'complete', 'complete', 'complete', 'complete', 'complete', 'failed']);
  } finally {
    if (previousTiming === undefined) Reflect.deleteProperty(globalThis, '__bootTiming');
    else Object.defineProperty(globalThis, '__bootTiming', previousTiming);
    vi.restoreAllMocks();
  }
});

test('an owned cancellable read never joins or aborts the shared wave', async () => {
  const f = fixture(), controller = new AbortController(), signals: (AbortSignal | null | undefined)[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation((_url, init) => {
    signals.push(init?.signal);
    if (init?.signal) return new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => { reject(new Error('owned read aborted')); }, {once: true});
    });
    return Promise.resolve(new Response(new Uint8Array([1]), {status: 200}));
  });
  const owned = loadKtx2(f.target, 'owned.ktx2', controller.signal);
  const rejected = expect(owned).rejects.toThrow('owned read aborted');
  const shared = loadKtx2(f.target, 'owned.ktx2');
  controller.abort(); await rejected;
  await expect(shared).resolves.toBeInstanceOf(CompressedTexture);
  expect(signals).toEqual([controller.signal, undefined]);
  expect(bootWaits().filter(row => row.label === 'Reading texture' || row.label === 'Preparing texture')).toEqual([]);
});

test('a cancelled decode disposes the texture when parsing finishes late', async () => {
  const f = fixture(), controller = new AbortController();
  let finish: ((texture: CompressedTexture) => void) | undefined, disposed = 0;
  let entered = (): void => { /* Set by the promise executor. */ };
  const parsed = new Promise<void>(resolve => { entered = resolve; });
  f.target.parse = (_buffer, onLoad) => { finish = onLoad; controller.abort(); entered(); };
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(new Uint8Array([1]), {status: 200}));
  const read = loadKtx2(f.target, 'late.ktx2', controller.signal);
  const rejected = expect(read).rejects.toThrow('KTX2 read aborted');
  await parsed;
  const texture = new CompressedTexture([], 4, 4); texture.addEventListener('dispose', () => { disposed++; });
  expect(finish).toBeTypeOf('function'); finish?.(texture);
  await rejected; expect(disposed).toBe(1);
  expect(bootWaits().filter(row => row.label === 'Reading texture' || row.label === 'Preparing texture')).toEqual([]);
});
