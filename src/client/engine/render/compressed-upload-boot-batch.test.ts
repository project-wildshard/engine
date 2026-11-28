// QA 11-25 row 151 (opus-boot151): the grid boot draws frames while it loads, so its compressed uploads are presenting and
// skipped the GL error read; a refused upload there was a blank texture nobody heard of. While the boot runs, uploads queued
// back to back are one batch: a drain as it opens and one read as it closes, which names the batch's last texture. The boot
// trace runs only on traced phone boots, so the batch follows the loading card that covers the world (ui/Loading.ts).
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { CompressedTexture, RGBA_S3TC_DXT5_Format, WebGLRenderer } from 'three';
import { pageScope } from '../../../shared/engine/app/resources';
import { noteFrameDrawn } from '../../../shared/engine/core/framePacing';
import { BOOT_BATCH_UPLOADS, holdLoadingUploadChecks, uploadCompressedTexture } from './compressedUpload';

/** a renderer whose GL error queue the test scripts: `refuse` names the upload (1-based) the driver refuses */
function renderer(refuse = 0) {
  const target: unknown = Object.create(WebGLRenderer.prototype);
  if (!(target instanceof WebGLRenderer)) throw new Error('Missing native renderer fixture');
  const records = new WeakMap<object, Record<string, unknown>>(), errors: number[] = [];
  const get = (value: object): Record<string, unknown> => { let row = records.get(value); if (row === undefined) { row = {}; records.set(value, row); } return row; };
  let uploads = 0, reads = 0;
  const fields: Record<string, unknown> = {
    properties: { get }, renderBufferDirect: () => undefined,
    initTexture: () => { uploads++; if (uploads === refuse) errors.push(1280); },
    getContext: () => ({ isContextLost: () => false, NO_ERROR: 0, getError: () => { reads++; return errors.shift() ?? 0; } }),
  };
  for (const [name, value] of Object.entries(fields)) Reflect.set(target, name, value);
  return { target, reads: () => reads };
}
const texture = (name: string): CompressedTexture => {
  const made = new CompressedTexture([{ data: new Uint8Array(16), width: 4, height: 4 }], 4, 4, RGBA_S3TC_DXT5_Format);
  made.name = name;
  return made;
};
let card = (): void => undefined;
beforeEach(() => {
  card = holdLoadingUploadChecks(); // the grid boot's loading card covers the world
  vi.spyOn(pageScope, 'raf').mockImplementation(run => { setTimeout(() => { noteFrameDrawn(); run(0); }, 0); return 0; });
  vi.spyOn(pageScope, 'timeout').mockImplementation((_ms, run) => { setTimeout(run, 0); return 0; });
  noteFrameDrawn(); // the grid boot is presenting
});
afterEach(() => { card(); vi.restoreAllMocks(); });

test('a refused upload in a presenting boot fails the batch, naming its last texture', async () => {
  const gl = renderer(2), textures = ['a', 'b', 'c'].map(texture);
  const results = await Promise.allSettled(textures.map(tex => { noteFrameDrawn(); return uploadCompressedTexture(gl.target, tex); }));
  expect(results.slice(0, 2).map(result => result.status)).toEqual(['fulfilled', 'fulfilled']);
  const last = results[2];
  expect(last?.status === 'rejected' ? String(last.reason) : 'resolved').toContain(`Graphics error 1280 after compressed texture c (#${String(textures[2]?.id)}, 4x4, 1 mips), the last of 3 boot uploads checked together`);
  // one drain as the batch opens (its NO_ERROR) and one read as it closes: not one round trip an upload
  expect(gl.reads()).toBe(2);
  for (const tex of textures) tex.dispose();
});

test('a clean boot batch costs one drain and one read, whatever its size', async () => {
  const gl = renderer(), textures = ['a', 'b', 'c', 'd', 'e'].map(texture);
  await Promise.all(textures.map(tex => { noteFrameDrawn(); return uploadCompressedTexture(gl.target, tex); }));
  expect(gl.reads()).toBe(2);
  for (const tex of textures) tex.dispose();
});

test('uploads awaited one by one are a batch each', async () => {
  const gl = renderer(2), first = texture('a'), second = texture('b');
  await uploadCompressedTexture(gl.target, first);
  noteFrameDrawn();
  await expect(uploadCompressedTexture(gl.target, second)).rejects.toThrow('Graphics error 1280 after compressed texture b');
  expect(gl.reads()).toBe(4);
  first.dispose(); second.dispose();
});

test('in play, with no card over the world, a presenting upload still reads no error', async () => {
  card(); // the card is gone: play
  const gl = renderer(1), tex = texture('a');
  await expect(uploadCompressedTexture(gl.target, tex)).resolves.toBeUndefined();
  expect(gl.reads()).toBe(0);
  tex.dispose();
});

test('a queue that never drains (the grid streams tiles under its card) still reads once every full batch', async () => {
  const gl = renderer(3), textures = Array.from({ length: BOOT_BATCH_UPLOADS + 4 }, (_, index) => texture(`t${String(index + 1)}`));
  const results = await Promise.allSettled(textures.map(tex => { noteFrameDrawn(); return uploadCompressedTexture(gl.target, tex); }));
  const refused = results.flatMap((result, index) => result.status === 'rejected' ? [{ index, reason: String(result.reason) }] : []);
  expect(refused).toEqual([{ index: BOOT_BATCH_UPLOADS - 1, reason: expect.stringContaining(`compressed texture t${String(BOOT_BATCH_UPLOADS)} `) as unknown as string }]);
  expect(refused[0]?.reason).toContain(`the last of ${String(BOOT_BATCH_UPLOADS)} boot uploads checked together`);
  expect(gl.reads()).toBe(4); // a drain and a read for each of the two batches
  for (const tex of textures) tex.dispose();
});
