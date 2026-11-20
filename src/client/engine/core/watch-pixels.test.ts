// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from 'vitest';
import { Scope } from '../../../shared/engine/app/scope';
import { readWatchPixels } from './watchPixels';

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

test('the world watch gets its thumbnail pixels from a worker that retires after the reply', async () => {
  const { owner, copy, bitmap } = fixture();
  try {
    const result = readWatchPixels(copy, owner, 3000);
    await vi.waitFor(() => { expect(Reader.current?.postMessage).toHaveBeenCalledWith(bitmap, [bitmap]); });
    const reader = Reader.current;
    const pixels = new Uint8ClampedArray([5, 5, 5, 255, 150, 100, 90, 255]);
    reader?.dispatchEvent(new MessageEvent('message', { data: pixels }));
    expect(await result).toBe(pixels);
    expect(reader?.terminate).toHaveBeenCalledOnce();
  } finally { owner.dispose(); }
});

test('a retired watch settles and closes its late bitmap without starting a worker', async () => {
  const { owner, copy, bitmap } = fixture();
  const result = readWatchPixels(copy, owner, 3000);
  owner.dispose();
  expect(await result).toBeNull();
  await vi.waitFor(() => { expect(bitmap.close).toHaveBeenCalledOnce(); });
  expect(Reader.current).toBeUndefined();
});

test('a failed worker settles and permits the canvas readback fallback', async () => {
  const { owner, copy } = fixture();
  try {
    const result = readWatchPixels(copy, owner, 3000);
    await vi.waitFor(() => { expect(Reader.current).toBeDefined(); });
    const reader = Reader.current;
    reader?.dispatchEvent(new Event('messageerror'));
    expect(await result).toBeNull();
    expect(reader?.terminate).toHaveBeenCalledOnce();
  } finally { owner.dispose(); }
});
