// @vitest-environment happy-dom
import { expect, test, vi } from 'vitest';
import { ContentReadError, readContent } from './contentRead';
import { loadingWaitState } from '../../../shared/engine/boot/loadingWaits';

const url = 'https://example.test/shardfiles/island/shape.bin';

test('a dropped connection retries once with cache reload and returns exact bytes', async () => {
  const calls: RequestInit[] = [];
  const bytes = await readContent(url, 3, { fetch: (_url, init) => {
    calls.push(init);
    return calls.length === 1 ? Promise.reject(new TypeError('Synthetic connection lost')) : Promise.resolve(new Response(new Uint8Array([1, 2, 3])));
  } });
  expect(bytes).toEqual(new Uint8Array([1, 2, 3]));
  expect(calls.map(call => call.cache)).toEqual([undefined, 'reload']);
});

test('an interrupted body is discarded before retrying the complete file', async () => {
  let calls = 0, pulls = 0;
  const progress: number[] = [];
  const bytes = await readContent(url, 3, { fetch: () => {
    calls++;
    return Promise.resolve(calls === 1 ? new Response(new ReadableStream<Uint8Array>({ pull(controller) {
      if (++pulls === 1) controller.enqueue(new Uint8Array([9]));
      else controller.error(new TypeError('Synthetic body disconnected'));
    } }, { highWaterMark: 0 })) : new Response(new Uint8Array([1, 2, 3])));
  }, read: size => { progress.push(size); } });
  expect(bytes).toEqual(new Uint8Array([1, 2, 3])); expect(calls).toBe(2);
  expect(progress).toEqual([1, 3]);
});

test.each(['text/html;charset=utf-8', 'application/octet-stream'])('HTML missing-file answers (%s) never reach the parser', async type => {
  let calls = 0;
  const failure = await readContent(url, 256, { fetch: () => {
    calls++; return Promise.resolve(new Response('\uFEFF <!doctype html><html>Missing</html>', { headers: { 'content-type': type } }));
  }, retry: error => { throw error; } }).catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(ContentReadError);
  expect(failure).toHaveProperty('message', expect.stringContaining('/shardfiles/island/shape.bin'));
  expect(failure).toHaveProperty('message', expect.stringContaining('HTML')); expect(calls).toBe(2);
});

test('exhausted transport stays pending on the existing RETRY and resumes in place', async () => {
  let calls = 0;
  let retryOffered = (): void => { throw new Error('Missing retry observer'); };
  const offered = new Promise<void>(resolve => { retryOffered = resolve; });
  const pending = readContent(url, 3, { fetch: () => {
    calls++;
    if (calls === 2) retryOffered();
    return Promise.resolve(calls <= 2 ? new Response(null, { status: 503 }) : new Response(new Uint8Array([1, 2, 3])));
  } });
  await offered;
  await vi.waitFor(() => { expect([...loadingWaitState().pending.values()].some(row => row.resource === url)).toBe(true); });
  const wait = [...loadingWaitState().pending.values()].find(row => row.resource === url);
  expect(wait?.retry).toBeTypeOf('function'); expect(wait?.label).toContain('HTTP 503');
  if (wait?.retry === null || wait?.retry === undefined) throw new Error('Missing existing loading-card RETRY');
  wait.retry(); expect(await pending).toEqual(new Uint8Array([1, 2, 3]));
  expect(calls).toBe(3); expect(loadingWaitState().pending.has(wait.id)).toBe(false);
});

test('cancellation and oversized content keep their original refusal without retry', async () => {
  const controller = new AbortController(), reason = new Error('Original owner retired'); controller.abort(reason);
  let calls = 0;
  const fetch = (): Promise<Response> => { calls++; return Promise.resolve(new Response(new Uint8Array([1, 2]))); };
  await expect(readContent(url, 2, { fetch, signal: controller.signal })).rejects.toBe(reason);
  expect(calls).toBe(0);
  await expect(readContent(url, 1, { fetch })).rejects.toThrow('wire size exceeds cap');
  expect(calls).toBe(1);
});

test('cancelling a suspended RETRY drains its wait without restarting transport', async () => {
  const controller = new AbortController(), reason = new Error('Read owner retired');
  let offered = (): void => { throw new Error('Missing retry observer'); };
  const ready = new Promise<void>(resolve => { offered = resolve; });
  let calls = 0;
  const pending = readContent(url, 2, { fetch: () => {
    calls++; if (calls === 2) offered(); return Promise.reject(new TypeError('Connection absent'));
  }, signal: controller.signal });
  await ready;
  await vi.waitFor(() => { expect([...loadingWaitState().pending.values()].some(row => row.resource === url)).toBe(true); });
  controller.abort(reason); await expect(pending).rejects.toBe(reason);
  expect(calls).toBe(2); expect([...loadingWaitState().pending.values()].some(row => row.resource === url)).toBe(false);
});

test('one loading-card RETRY resumes all failed content reads, excluding retired owners', async () => {
  const retired = new AbortController(), reason = new Error('Sibling read retired'), counts = new Map<string, number>();
  const read = (file: string, signal?: AbortSignal) => readContent(file, 1, {
    ...(signal === undefined ? {} : {signal}), fetch: address => {
      const calls = (counts.get(address) ?? 0) + 1; counts.set(address, calls);
      return Promise.resolve(calls <= 2 ? new Response(null, {status: 503}) : new Response(new Uint8Array([1])));
    },
  });
  const paths = ['one', 'two', 'retired'].map(file => `${url}/${file}`);
  const [one, two, old] = paths;
  if (one === undefined || two === undefined || old === undefined) throw new Error('Missing retry fixture');
  const first = read(one), second = read(two), cancelled = read(old, retired.signal);
  const refusal = expect(cancelled).rejects.toBe(reason);
  await vi.waitFor(() => {expect([...loadingWaitState().pending.values()].filter(row => paths.includes(row.resource ?? ''))).toHaveLength(3);});
  retired.abort(reason); await refusal;
  const row = [...loadingWaitState().pending.values()].find(wait => wait.resource === one);
  if (row?.retry === undefined || row.retry === null) throw new Error('Missing retry action');
  row.retry(); expect(await Promise.all([first, second])).toEqual([new Uint8Array([1]), new Uint8Array([1])]);
  expect(counts.get(one)).toBe(3); expect(counts.get(two)).toBe(3); expect(counts.get(old)).toBe(2);
  expect([...loadingWaitState().pending.values()].some(wait => paths.includes(wait.resource ?? ''))).toBe(false);
});

test.each([new Uint8Array([9]), new Uint8Array([9, 9, 9, 9])])('stale first-party lengths reload the same URL once', async stale => {
  const requests: { url: string; cache: RequestCache | undefined }[] = [];
  const result = await readContent(url, 3, { expectedBytes: 3, fetch: (path, init) => {
    requests.push({ url: path, cache: init.cache });
    return Promise.resolve(new Response(requests.length === 1 ? stale : new Uint8Array([1, 2, 3])));
  } });
  expect(result).toEqual(new Uint8Array([1, 2, 3]));
  expect(requests).toEqual([{ url, cache: undefined }, { url, cache: 'reload' }]);
});

test('a repeated stale length offers the original RETRY without accepting bytes', async () => {
  let calls = 0, retries = 0;
  const result = await readContent(url, 2, { expectedBytes: 2, fetch: () => {
    calls++; return Promise.resolve(new Response(new Uint8Array(calls <= 2 ? [9] : [1, 2])));
  }, retry: error => {
    expect(error).toBeInstanceOf(ContentReadError); expect(error.message).toContain('byte length'); retries++;
    return Promise.resolve();
  } });
  expect(result).toEqual(new Uint8Array([1, 2])); expect(calls).toBe(3); expect(retries).toBe(1);
});

test('response observers see admitted native responses before their bodies are read', async () => {
  const first = new Response(null, { status: 503 }), second = new Response(new Uint8Array([1]), { headers: { 'content-type': 'application/octet-stream' } });
  const responses: Response[] = [], unread: boolean[] = [];
  let calls = 0;
  const bytes = await readContent(url, 1, { expectedBytes: 1,
    fetch: () => Promise.resolve(++calls === 1 ? first : second), response: response => {
      responses.push(response); unread.push(!response.bodyUsed);
    },
  });
  expect(bytes).toEqual(new Uint8Array([1])); expect(responses).toEqual([second]);
  expect(unread).toEqual([true]); expect(second.headers.get('content-type')).toBe('application/octet-stream');
});

test('HTML is refused before a response observer can clone its body', async () => {
  let observed = 0;
  await expect(readContent(url, 256, { fetch: () => Promise.resolve(new Response('<html>Missing</html>', { headers: { 'content-type': 'text/html' } })),
    response: response => { observed++; response.clone(); }, retry: error => { throw error; },
  })).rejects.toBeInstanceOf(ContentReadError);
  expect(observed).toBe(0);
});

test('time alone never retries pending transport and confirmed failure adds no timer', async () => {
  vi.useFakeTimers();
  let fail = (_error: Error): void => { throw new Error('Transport not started'); };
  const pendingTransport = new Promise<Response>((_resolve, reject) => { fail = reject; });
  const fetch = vi.fn((_url: string, _init: RequestInit) => fetch.mock.calls.length === 1
    ? pendingTransport : Promise.resolve(new Response(new Uint8Array([1]))));
  try {
    const result = readContent(url, 1, { fetch });
    await vi.advanceTimersByTimeAsync(180_000); expect(fetch).toHaveBeenCalledTimes(1);
    const timers = vi.getTimerCount();
    fail(new TypeError('Confirmed transport failure'));
    expect(await result).toEqual(new Uint8Array([1]));
    expect(fetch).toHaveBeenCalledTimes(2); expect(vi.getTimerCount()).toBe(timers);
    expect(fetch.mock.calls[1]?.[1].cache).toBe('reload');
  } finally { vi.useRealTimers(); }
});

test('QA 11-12 row 36: at START, before Loading owns the card, an unreachable read shows the shell\'s RETRY and names the file', async () => {
  document.body.innerHTML = '<div class="ws-load"><div class="ws-load-foot"><span data-el="foot"></span><button type="button" class="ws-load-retry" data-el="retry" hidden>Retry</button></div></div>';
  let offline = true;
  const pending = readContent(url, 3, { fetch: () => offline ? Promise.reject(new TypeError('Failed to fetch')) : Promise.resolve(new Response(new Uint8Array([1, 2, 3]))) });
  const button = document.querySelector<HTMLButtonElement>('.ws-load-retry');
  await vi.waitFor(() => { expect(button?.hidden).toBe(false); });
  expect(document.querySelector('[data-el="foot"]')?.textContent).toContain('/shardfiles/island/shape.bin');
  offline = false; button?.click();
  expect(await pending).toEqual(new Uint8Array([1, 2, 3]));
  document.body.innerHTML = '';
});
