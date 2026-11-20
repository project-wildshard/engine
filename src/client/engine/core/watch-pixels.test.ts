// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from 'vitest';
import { Scope } from '../../../shared/engine/app/scope';
import { watchPixelReader } from './watchPixels';

class Reader extends EventTarget {
  static current: Reader | undefined;
  readonly postMessage = vi.fn();
  readonly terminate = vi.fn();
  constructor() { super(); Reader.current = this; }
}

afterEach(() => { Reader.current = undefined; vi.unstubAllGlobals(); });

function fixture() {
  const owner = new Scope('world watch'), copy = document.createElement('canvas'), bitmap = { close: vi.fn() };
  copy.width = 2; copy.height = 1;
  vi.stubGlobal('Worker', Reader);
  vi.stubGlobal('createImageBitmap', vi.fn(() => Promise.resolve(bitmap)));
  return { owner, copy, bitmap };
}

test('the world watch reuses one thumbnail worker until its scope retires', async () => {
  const { owner, copy, bitmap } = fixture();
  try {
    const read = watchPixelReader(owner);
    const first = read(copy, 3000);
    await vi.waitFor(() => { expect(Reader.current?.postMessage).toHaveBeenCalledWith(bitmap, [bitmap]); });
    const reader = Reader.current;
    const pixels = new Uint8ClampedArray([5, 5, 5, 255, 150, 100, 90, 255]);
    reader?.dispatchEvent(new MessageEvent('message', { data: pixels }));
    expect(await first).toBe(pixels);
    const next = read(copy, 3000);
    await vi.waitFor(() => { expect(reader?.postMessage).toHaveBeenCalledTimes(2); });
    expect(Reader.current).toBe(reader);
    reader?.dispatchEvent(new MessageEvent('message', { data: pixels }));
    expect(await next).toBe(pixels);
    expect(reader?.terminate).not.toHaveBeenCalled();
    owner.dispose();
    expect(reader?.terminate).toHaveBeenCalledOnce();
  } finally { owner.dispose(); }
});

test('a retired watch settles and closes its late bitmap without starting a worker', async () => {
  const { owner, copy, bitmap } = fixture();
  const result = watchPixelReader(owner)(copy, 3000);
  owner.dispose();
  expect(await result).toBeNull();
  await vi.waitFor(() => { expect(bitmap.close).toHaveBeenCalledOnce(); });
  expect(Reader.current).toBeUndefined();
});

test('a failed worker permits the fallback and the next look starts a new worker', async () => {
  const { owner, copy } = fixture();
  try {
    const read = watchPixelReader(owner);
    const result = read(copy, 3000);
    await vi.waitFor(() => { expect(Reader.current).toBeDefined(); });
    const reader = Reader.current;
    reader?.dispatchEvent(new Event('messageerror'));
    expect(await result).toBeNull();
    expect(reader?.terminate).toHaveBeenCalledOnce();
    const next = read(copy, 3000);
    await vi.waitFor(() => { expect(Reader.current).not.toBe(reader); });
    const replacement = Reader.current;
    owner.dispose();
    expect(await next).toBeNull();
    expect(replacement?.terminate).toHaveBeenCalledOnce();
  } finally { owner.dispose(); }
});
