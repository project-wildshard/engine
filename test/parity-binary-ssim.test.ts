import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { ssim } from '../scripts/parity/ssim.mjs';

const original = new Map<string, PropertyDescriptor | undefined>();
const upload = new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' });
const encode = vi.fn(() => Promise.resolve(upload));
const read = vi.fn<typeof fetch>();
const first = { width: 16, height: 16, close: vi.fn() };
const second = { width: 16, height: 16, close: vi.fn() };
let noCanvas = false;
let canvases = 0;
class Canvas {
  constructor(readonly width: number, readonly height: number) { canvases++; }
  getContext(): object | null {
    if (noCanvas) return null;
    return {
      drawImage: () => { /* Both fixture bitmaps have identical opaque pixels. */ },
      getImageData: () => ({ data: new Uint8ClampedArray(this.width * this.height * 4).fill(80) }),
      createImageData: () => ({ data: new Uint8ClampedArray(this.width * this.height * 4) }),
      putImageData: () => { /* The real-browser proof pins every actual diff pixel. */ },
    };
  }
  convertToBlob(): Promise<Blob> { return encode(); }
}
beforeEach(() => {
  noCanvas = false; canvases = 0; encode.mockClear(); second.width = 16; second.height = 16;
  first.close.mockClear(); second.close.mockClear(); read.mockReset();
  read.mockImplementation((input, init) => {
    if (init?.method === 'POST') return Promise.resolve(new Response(null, { status: 204 }));
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    return Promise.resolve(new Response(url.endsWith('/a') ? 'a' : 'b'));
  });
  const decode = async (blob: Blob): Promise<typeof first> => await blob.text() === 'a' ? first : second;
  for (const [name, value] of Object.entries({ fetch: read, createImageBitmap: decode, OffscreenCanvas: Canvas })) {
    original.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  }
});
afterEach(() => {
  for (const [name, descriptor] of original) {
    if (descriptor === undefined) Reflect.deleteProperty(globalThis, name); else Object.defineProperty(globalThis, name, descriptor);
  }
  original.clear();
});
const input = { a: 'https://parity.invalid/a', b: 'https://parity.invalid/b', diff: 'https://parity.invalid/diff' };

test('returns only score metadata and sends the native PNG body once', async () => {
  await expect(ssim(input)).resolves.toEqual({ hasDiff: true, ssim: 1, full: 1, masked: 0, note: null });
  expect(read.mock.calls).toEqual([[input.a], [input.b], [input.diff, { method: 'POST', body: upload }]]);
  expect(first.close).toHaveBeenCalledOnce(); expect(second.close).toHaveBeenCalledOnce();
});
test('retains the complete-mask refusal without admitting a replacement score', async () => {
  await expect(ssim({ ...input, mask: [[0, 0, 16, 16]] })).resolves.toEqual({ hasDiff: true, ssim: null, full: 1, masked: 1, note: 'the whole frame is masked' });
});
test('score-only mode keeps the same numbers without a diff canvas, encoder or upload', async () => {
  await expect(ssim({ a: input.a, b: input.b })).resolves.toEqual({ hasDiff: false, ssim: 1, full: 1, masked: 0, note: null });
  expect(canvases).toBe(2); expect(encode).not.toHaveBeenCalled();
  expect(read.mock.calls).toEqual([[input.a], [input.b]]);
  expect(first.close).toHaveBeenCalledOnce(); expect(second.close).toHaveBeenCalledOnce();
});
test('score-only mode keeps the complete-mask refusal without encoding a diff', async () => {
  await expect(ssim({ a: input.a, b: input.b, mask: [[0, 0, 16, 16]] })).resolves.toEqual({ hasDiff: false, ssim: null, full: 1, masked: 1, note: 'the whole frame is masked' });
  expect(canvases).toBe(2); expect(encode).not.toHaveBeenCalled(); expect(read).toHaveBeenCalledTimes(2);
});
test('a size mismatch produces no diff and closes both decoded bitmaps', async () => {
  second.width = 8;
  await expect(ssim(input)).resolves.toEqual({ hasDiff: false, ssim: 0, note: 'size 16×16 vs 8×16' });
  expect(read).toHaveBeenCalledTimes(2);
  expect(first.close).toHaveBeenCalledOnce(); expect(second.close).toHaveBeenCalledOnce();
});
test('a failed second image releases the first bitmap and refuses', async () => {
  read.mockResolvedValueOnce(new Response('a')).mockResolvedValueOnce(new Response(null, { status: 404 }));
  await expect(ssim(input)).rejects.toThrow('Parity image read refused');
  expect(first.close).toHaveBeenCalledOnce(); expect(second.close).not.toHaveBeenCalled();
});
test('a failed binary upload releases both bitmaps and refuses', async () => {
  read.mockImplementation((request, init) => {
    const url = typeof request === 'string' ? request : request instanceof URL ? request.href : request.url;
    return Promise.resolve(init?.method === 'POST' ? new Response(null, { status: 400 }) : new Response(url.endsWith('/a') ? 'a' : 'b'));
  });
  await expect(ssim(input)).rejects.toThrow('Parity diff handoff refused');
  expect(first.close).toHaveBeenCalledOnce(); expect(second.close).toHaveBeenCalledOnce();
});
test('a missing canvas releases both bitmaps and refuses', async () => {
  noCanvas = true;
  await expect(ssim(input)).rejects.toThrow('2D canvas unavailable');
  expect(read).toHaveBeenCalledTimes(2);
  expect(first.close).toHaveBeenCalledOnce(); expect(second.close).toHaveBeenCalledOnce();
});
