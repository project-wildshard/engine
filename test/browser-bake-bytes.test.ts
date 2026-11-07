import { expect, test } from 'vitest';
import { browserBakeBytes, type ByteRoute, type ByteSinkPage } from '../scripts/bake-output.mjs';

class Page implements ByteSinkPage {
  pattern = '';
  handler: ((route: ByteRoute) => Promise<void>) | undefined;
  route(pattern: string, handler: (route: ByteRoute) => Promise<void>): Promise<void> {
    this.pattern = pattern; this.handler = handler; return Promise.resolve();
  }
  unroute(pattern: string, handler: (route: ByteRoute) => Promise<void>): Promise<void> {
    expect(pattern).toBe(this.pattern); expect(handler).toBe(this.handler);
    this.handler = undefined; return Promise.resolve();
  }
  async send(url: string, bytes: Uint8Array | null, method = 'POST'): Promise<number> {
    const handler = this.handler;
    if (handler === undefined) throw new Error('No owned route');
    let status = 0;
    await handler({ request: () => ({ url: () => url, method: () => method, postDataBuffer: () => bytes }),
      fulfill: response => { status = response.status; return Promise.resolve(); } });
    return status;
  }
}

test('native bytes stay detached from request storage and are consumed once', async () => {
  const page = new Page(), sink = await browserBakeBytes(page), bytes = new Uint8Array([0, 128, 255]);
  expect(await page.send(`${sink.url}chunk-0`, bytes)).toBe(204);
  bytes.fill(1);
  expect(sink.take('chunk-0')).toEqual(new Uint8Array([0, 128, 255]));
  expect(() => sink.take('chunk-0')).toThrow('Missing');
  expect(await page.send(`${sink.url}chunk-0`, bytes)).toBe(400);
  await sink.dispose(); expect(page.handler).toBeUndefined();
});

test('one owned page route enforces method, identity and cumulative byte/file caps', async () => {
  const page = new Page(), sink = await browserBakeBytes(page, { maxBytes: 3, maxFiles: 2 });
  expect(await page.send(`${sink.url}first`, null, 'OPTIONS')).toBe(204);
  for (const [url, bytes, method] of [
    [`${sink.url}bad`, new Uint8Array([1]), 'GET'],
    ['https://elsewhere.invalid/first', new Uint8Array([1]), 'POST'],
    [`${sink.url}../escape`, new Uint8Array([1]), 'POST'],
    [`${sink.url}empty`, new Uint8Array(), 'POST'],
    [`${sink.url}missing`, null, 'POST'],
  ] as const) expect(await page.send(url, bytes, method)).toBe(400);
  expect(await page.send(`${sink.url}first`, new Uint8Array([1, 2]))).toBe(204);
  sink.take('first');
  expect(await page.send(`${sink.url}too-wide`, new Uint8Array([3, 4]))).toBe(400);
  expect(await page.send(`${sink.url}last`, new Uint8Array([3]))).toBe(204);
  await sink.dispose(); expect(() => sink.take('last')).toThrow('Missing');
  const capped = await browserBakeBytes(page, { maxBytes: 10, maxFiles: 1 });
  expect(await page.send(`${capped.url}first`, new Uint8Array([1]))).toBe(204);
  expect(await page.send(`${capped.url}second`, new Uint8Array([1]))).toBe(400);
  await capped.dispose();
});

test('invalid capture bounds refuse before registering a route', async () => {
  const page = new Page();
  for (const options of [{ maxBytes: 0 }, { maxFiles: -1 }, { maxFiles: 1.5 }, { maxBytes: Infinity }])
    await expect(browserBakeBytes(page, options)).rejects.toThrow('Invalid');
  expect(page.handler).toBeUndefined();
});
