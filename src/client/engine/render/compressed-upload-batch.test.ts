// STAGING-BUGBASH SB32b (opus-pineload): under the loader nothing is on show, so consecutive compressed uploads share one
// painted frame until their slice is spent. Pine's arrival paid two painted frames for each of ~180 uploads (6 s of a 16 s
// load, its shaders step 2.4 s for 63 programs), which also marked a Metal GPU as a software one (finish.ts slowGpu).
import { afterEach, expect, test, vi } from 'vitest';
import { CompressedTexture, RGBA_S3TC_DXT5_Format, WebGLRenderer } from 'three';
import { LOADING_UPLOAD_SLICE_MS, uploadCompressedTexture } from './compressedUpload';
import { pageScope } from '../../../shared/engine/app/resources';
import { noteFrameDrawn } from '../../../shared/engine/core/framePacing';

function renderer(onUpload: () => void = () => undefined) {
  const target: unknown = Object.create(WebGLRenderer.prototype);
  if (!(target instanceof WebGLRenderer)) throw new Error('Missing native renderer fixture');
  const records = new WeakMap<object, Record<string, unknown>>();
  const get = (value: object): Record<string, unknown> => { let row = records.get(value); if (row === undefined) { row = {}; records.set(value, row); } return row; };
  const fields: Record<string, unknown> = {
    properties: { get }, initTexture: onUpload, renderBufferDirect: () => undefined,
    getContext: () => ({ isContextLost: () => false, NO_ERROR: 0, getError: () => 0 }),
  };
  for (const [name, value] of Object.entries(fields)) Reflect.set(target, name, value);
  return target;
}
const texture = (): CompressedTexture => new CompressedTexture([{ data: new Uint8Array(16), width: 4, height: 4 }], 4, 4, RGBA_S3TC_DXT5_Format);
/** Painted frames, counted: each runs its callback a task later. */
function frames(): { readonly count: () => number } {
  let count = 0;
  vi.spyOn(pageScope, 'raf').mockImplementation(run => { count++; setTimeout(() => { run(0); }, 0); return 0; });
  vi.spyOn(pageScope, 'timeout').mockImplementation((_ms, run) => { setTimeout(run, 0); return 0; });
  return { count: () => count };
}
afterEach(() => { vi.restoreAllMocks(); });

test('under the loader six queued uploads share one painted frame on each side while their slice lasts', async () => {
  const painted = frames(), textures = Array.from({ length: 6 }, texture), target = renderer();
  await Promise.all(textures.map(tex => uploadCompressedTexture(target, tex)));
  expect(painted.count()).toBe(2);
  for (const tex of textures) tex.dispose();
});

test('under the loader a spent slice ends with a painted frame before the next upload', async () => {
  const painted = frames(), textures = Array.from({ length: 4 }, texture);
  // each upload spends the whole slice: every upload after the first waits for a paint
  let now = 1_000_000; vi.spyOn(performance, 'now').mockImplementation(() => now);
  const target = renderer(() => { now += LOADING_UPLOAD_SLICE_MS; });
  await Promise.all(textures.map(tex => uploadCompressedTexture(target, tex)));
  expect(painted.count()).toBeGreaterThanOrEqual(4);
  for (const tex of textures) tex.dispose();
});

test('under the loader a failed upload fails alone: the batch after it still uploads and paints', async () => {
  const painted = frames(), textures = Array.from({ length: 3 }, texture);
  let calls = 0;
  const target = renderer(() => { calls++; if (calls === 2) throw new Error('upload refused'); });
  const results = await Promise.allSettled(textures.map(tex => uploadCompressedTexture(target, tex)));
  expect(results.map(result => result.status)).toEqual(['fulfilled', 'rejected', 'fulfilled']);
  expect(calls).toBe(3);
  expect(painted.count()).toBe(2);
  for (const tex of textures) tex.dispose();
});

test('an upload that resolves has a painted frame that started after it', async () => {
  const order: string[] = [], textures = Array.from({ length: 3 }, texture);
  vi.spyOn(pageScope, 'raf').mockImplementation(run => { setTimeout(() => { order.push('paint'); run(0); }, 0); return 0; });
  vi.spyOn(pageScope, 'timeout').mockImplementation((_ms, run) => { setTimeout(run, 0); return 0; });
  const target = renderer(() => { order.push('upload'); });
  await Promise.all(textures.map(async tex => { await uploadCompressedTexture(target, tex); order.push('resolved'); }));
  expect(order.lastIndexOf('upload')).toBeLessThan(order.lastIndexOf('paint'));
  expect(order.indexOf('resolved')).toBeGreaterThan(order.lastIndexOf('paint'));
});

test('the loading slice stays well under the worst-frame bar of an arrival', () => {
  expect(LOADING_UPLOAD_SLICE_MS).toBeGreaterThanOrEqual(16);
  expect(LOADING_UPLOAD_SLICE_MS).toBeLessThanOrEqual(48);
});

// last: noting a drawn frame leaves the page presenting for the tests after it
test('in play each upload keeps a painted frame on each side', async () => {
  const painted = frames(), textures = Array.from({ length: 3 }, texture), target = renderer();
  noteFrameDrawn();
  await Promise.all(textures.map(tex => { noteFrameDrawn(); return uploadCompressedTexture(target, tex); }));
  expect(painted.count()).toBe(6);
  for (const tex of textures) tex.dispose();
});
