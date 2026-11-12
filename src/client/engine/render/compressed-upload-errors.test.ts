import { afterEach, expect, test, vi } from 'vitest';
import { CompressedTexture, RGBA_S3TC_DXT5_Format, WebGLRenderer } from 'three';
import { uploadCompressedTexture } from './compressedUpload';
import { pageScope } from '../../../shared/engine/app/resources';

/** a renderer whose GL error queue the test scripts: `queued` errors are pending before the upload, `upload` is what the
 *  upload itself raises */
function renderer(queued: number[], upload: number) {
  const target: unknown = Object.create(WebGLRenderer.prototype);
  if (!(target instanceof WebGLRenderer)) throw new Error('Missing native renderer fixture');
  const records = new WeakMap<object, Record<string, unknown>>(), errors = [...queued];
  const get = (value: object): Record<string, unknown> => { let row = records.get(value); if (row === undefined) { row = {}; records.set(value, row); } return row; };
  const fields: Record<string, unknown> = {
    properties: { get },
    initTexture: () => { if (upload !== 0) errors.push(upload); },
    getContext: () => ({ isContextLost: () => false, NO_ERROR: 0, getError: () => errors.shift() ?? 0 }),
    renderBufferDirect: () => undefined,
  };
  for (const [name, value] of Object.entries(fields)) Reflect.set(target, name, value);
  return target;
}
const texture = (): CompressedTexture => new CompressedTexture([{ data: new Uint8Array(16), width: 4, height: 4 }], 4, 4, RGBA_S3TC_DXT5_Format);

afterEach(() => { vi.restoreAllMocks(); });
const frames = (): void => {
  vi.spyOn(pageScope, 'raf').mockImplementation(run => { queueMicrotask(() => { run(0); }); return 0; });
  vi.spyOn(pageScope, 'timeout').mockImplementation((_ms, run) => { queueMicrotask(run); return 0; });
};

test('a side-effect-free GL error an earlier call left queued is drained and named, never fails the upload', async () => {
  // opus-tex1: headless Chromium's 'glGetProgramiv: Program object expected' (1281) failed Driftwood's first KTX2
  frames();
  const upload = texture(), warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  await expect(uploadCompressedTexture(renderer([1281, 1282], 0), upload, () => true, false)).resolves.toBeUndefined();
  expect(warn).toHaveBeenCalledWith(`Graphics error 1281, 1282 left queued before compressed texture ${String(RGBA_S3TC_DXT5_Format)} (#${String(upload.id)}, 4x4, 1 mips) by an earlier call; drained, upload continues`);
  upload.dispose();
});

test('out of memory queued before a loading upload still fails it and names that stage', async () => {
  frames();
  const upload = texture();
  await expect(uploadCompressedTexture(renderer([1281, 1285], 0), upload)).rejects.toThrow(`Graphics error 1285 before compressed texture ${String(RGBA_S3TC_DXT5_Format)} (#${String(upload.id)}, 4x4, 1 mips)`);
  upload.dispose();
});

test('a lost context queued before a loading upload fails it', async () => {
  frames();
  const upload = texture();
  await expect(uploadCompressedTexture(renderer([0x9242], 0), upload)).rejects.toThrow(`Graphics error ${String(0x9242)} before compressed texture`);
  upload.dispose();
});

test('an error the upload raises still fails it as before, with the texture named', async () => {
  frames();
  const upload = texture();
  await expect(uploadCompressedTexture(renderer([], 1280), upload)).rejects.toThrow(`Graphics error 1280 after compressed texture ${String(RGBA_S3TC_DXT5_Format)} (#${String(upload.id)}, 4x4, 1 mips)`);
  upload.dispose();
});

test('a clean queue uploads', async () => {
  frames();
  const upload = texture();
  await expect(uploadCompressedTexture(renderer([], 0), upload, () => true, false)).resolves.toBeUndefined();
  upload.dispose();
});
