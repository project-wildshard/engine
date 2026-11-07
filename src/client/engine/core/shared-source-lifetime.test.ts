import { textureUploadRenderer as uploadRenderer } from '../../../test/engine/textureUploadRenderer';
import { afterEach, expect, test, vi } from 'vitest';
import { RepeatWrapping, SRGBColorSpace, type Texture } from 'three';
import * as bytes from '../boot/bytes';
import * as gpuFiles from '../boot/gpuFiles';
import * as ktx2 from './ktx2';
import { loadTexture, loadImage } from './assets';
import { realGc } from '../../../test/engine/realGc';
import { installMemorySaver } from '../render/memorySaver';

class DecodedImage implements ImageBitmap {
  readonly width = 16;
  readonly height = 16;
  readonly bytes = new Uint8Array(1024 * 1024).fill(73);
  closes = 0;
  close(): void { this.closes++; }
}

const globals = ['ImageBitmap', 'WebGL2RenderingContext'].map(key => ({key, descriptor: Object.getOwnPropertyDescriptor(globalThis, key)}));
afterEach(() => {
  vi.restoreAllMocks();
  for (const {key, descriptor} of globals) {
    if (descriptor === undefined) Reflect.deleteProperty(globalThis, key);
    else Object.defineProperty(globalThis, key, descriptor);
  }
});

function images() {
  vi.stubGlobal('ImageBitmap', DecodedImage);
  vi.spyOn(gpuFiles, 'texMode').mockReturnValue('img');
  vi.spyOn(ktx2, 'ktx2Texture').mockResolvedValue(null);
  vi.spyOn(ktx2, 'linearKtx2Texture').mockResolvedValue(null);
  return vi.spyOn(bytes, 'fetchImage').mockImplementation(() => Promise.resolve(new DecodedImage()));
}


test('a texture retired before upload releases its shared source and decoded backing', async () => {
  await realGc('src/client/engine/core/shared-source-lifetime.test.ts', 'a texture retired before upload releases', async collect => {
    const read = images(), url = '/shared-source-lifetime/retired.image';
    const refs = await (async () => {
      const texture = await loadTexture(url, true), image: unknown = texture.image;
      if (!(image instanceof DecodedImage)) throw new Error('Missing decoded image');
      expect(image.bytes[0]).toBe(73);
      const result = { source: new WeakRef(texture.source), backing: new WeakRef(image.bytes.buffer) };
      texture.dispose();read.mockClear();
      return result;
    })();
    await collect(refs.source);await collect(refs.backing);
    const replacement = await loadTexture(url, true);
    try { expect(read).toHaveBeenCalledOnce();expect(replacement.image).toBeInstanceOf(DecodedImage); }
    finally { replacement.dispose(); }
  });
});

test('live colour-space sources share a decode and close it only after both upload', () =>
  realGc('src/client/engine/core/shared-source-lifetime.test.ts', 'live colour-space sources share', async collect => {
    const read = images(), url = '/shared-source-lifetime/live.image';
    vi.stubGlobal('WebGL2RenderingContext', EventTarget);
    const renderer = uploadRenderer();installMemorySaver(renderer);
    const colour = await loadTexture(url, true), same = await loadTexture(url, true), linear = await loadTexture(url, false);
    try {
      expect(colour.source).toBe(same.source);expect(linear.source).not.toBe(colour.source);
      const image: unknown = colour.image;
      if (!(image instanceof DecodedImage)) throw new Error('Missing shared decode');
      expect(linear.image).toBe(image);expect(read).toHaveBeenCalledOnce();
      read.mockClear();await collect(new WeakRef({}));
      expect(colour.image).toBe(image);expect(image.bytes[0]).toBe(73);expect(image.closes).toBe(0);
      expect(colour.wrapS).toBe(RepeatWrapping);expect(colour.colorSpace).toBe(SRGBColorSpace);
      renderer.initTexture(colour);
      expect(image.closes).toBe(0);expect(linear.image).toBe(image);
      renderer.initTexture(linear);
      expect(image.closes).toBe(1);expect(colour.source.data).toEqual({width: 16, height: 16});
      renderer.initTexture(same);expect(image.closes).toBe(1);
    } finally { colour.dispose();same.dispose();linear.dispose(); }
  }));

test('a collected unuploaded colour source does not pin the remaining bitmap user', () =>
  realGc('src/client/engine/core/shared-source-lifetime.test.ts', 'a collected unuploaded colour source', async collect => {
    const read = images(), url = '/shared-source-lifetime/partial.image';
    vi.stubGlobal('WebGL2RenderingContext', EventTarget);
    const renderer = uploadRenderer();installMemorySaver(renderer);
    const linear = await loadTexture(url, false), image: unknown = linear.image;
    if (!(image instanceof DecodedImage)) throw new Error('Missing shared decode');
    try {
      const retired = await (async () => {
        const colour = await loadTexture(url, true), source = new WeakRef(colour.source);
        expect(colour.image).toBe(image);colour.dispose();read.mockClear();
        return source;
      })();
      await collect(retired);expect(image.closes).toBe(0);
      renderer.initTexture(linear);
      expect(image.closes).toBe(1);
      const replacement = await loadTexture(url, true);
      try { expect(read).toHaveBeenCalledOnce();expect(replacement.image).not.toBe(image); }
      finally { replacement.dispose(); }
    } finally { linear.dispose(); }
  }));

test('concurrent texture requests share one source per colour space after decoding', async () => {
  const read = images(), url = '/shared-source-lifetime/concurrent.image';
  const textures = await Promise.all([loadTexture(url, true, 2), loadTexture(url, true, 3), loadTexture(url, false)]);
  try {
    const [first, second, linear] = textures;
    if (first === undefined || second === undefined || linear === undefined) throw new Error('Missing concurrent texture');
    expect(read).toHaveBeenCalledOnce();expect(first.source).toBe(second.source);expect(linear.source).not.toBe(first.source);
    expect(first.repeat.x).toBe(2);expect(second.repeat.x).toBe(3);expect(first.image).toBe(linear.image);
  } finally { for (const texture of textures) texture.dispose(); }
});

test.each([false, true])('concurrent decode preserves upload ownership with cached image %s', async cached => {
  images();vi.stubGlobal('WebGL2RenderingContext', EventTarget);
  const renderer = uploadRenderer();installMemorySaver(renderer);
  const seen: number[] = [], url = `/shared-source-lifetime/concurrent-upload-${String(cached)}.image`;
  if (cached) await loadImage(url);
  const upload = (texture: Texture): void => {
    const image: unknown = texture.image;
    if (!(image instanceof DecodedImage)) throw new Error('Missing concurrent image');
    seen.push(image.closes);renderer.initTexture(texture);
  };
  const textures = await Promise.all([loadTexture(url, true, 1, undefined, upload), loadTexture(url, false, 1, undefined, upload)]);
  try { expect(seen).toEqual([0, 0]); }
  finally { for (const texture of textures) texture.dispose(); }
});


test('a failed concurrent source load is forgotten before the next request', async () => {
  const read = images(), url = '/shared-source-lifetime/retry.image';
  read.mockRejectedValueOnce(new Error('Decode refused'));
  const results = await Promise.allSettled([loadTexture(url, true), loadTexture(url, true)]);
  expect(results.map(result => result.status)).toEqual(['rejected', 'rejected']);
  expect(read).toHaveBeenCalledOnce();
  const retry = await loadTexture(url, true);
  try { expect(read).toHaveBeenCalledTimes(2);expect(retry.image).toBeInstanceOf(DecodedImage); }
  finally { retry.dispose(); }
});
