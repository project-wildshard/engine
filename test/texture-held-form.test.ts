// OFFLINE OF17 (meta docs/plans/OFFLINE-PLAN.md): one texture form per device and tier. Nine Dragon's grid page read
// `scroll.phone-<h>.ktx2` and its offline one-shard page asked for `scroll.phone.webp`, which nothing had cached, so the
// read parked LOAD on RETRY for good. A failed form gives way to the other one when the cache holds it, and a shard the
// device has read as KTX2 stays KTX2 on a page whose own rule says images.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ContentReadError, readContent } from '../src/client/engine/boot/contentRead';
import { gpuFile, registerGpuFiles, setDeviceTexForm, setTexturePolicy, texModeWhy } from '../src/client/engine/boot/gpuFiles';
import { heldForm, readHeldForm } from '../src/client/engine/core/ktx2';
import type { CompressedTexture } from 'three';
import type { Ktx2Probe } from '../src/client/engine/render/ktx2Probe';

const image = '/assets/nine-dragon/lab/organic/scroll.phone.webp';
const standIn = '/assets/gpu/nine-dragon/lab/organic/scroll.phone-580f21aa.ktx2';
registerGpuFiles({ phone: { [image]: standIn }, desktop: { [image]: standIn } });
const verdict = (probe: Partial<Ktx2Probe> = {}) => (): Ktx2Probe => ({ ran: true, note: '', families: { astc: true }, formats: [], veto: null, ...probe });
const holding = (...paths: string[]) => vi.fn((path: string) => Promise.resolve(paths.includes(path)));

afterEach(() => { setDeviceTexForm(null); });

describe('OF17: the held form', () => {
  it('reads the held KTX2 stand-in when the image fails, and the held image when the stand-in fails', async () => {
    const held = holding(standIn);
    expect(await heldForm(image, 'img', held, verdict())).toBe('ktx2');
    expect(held).toHaveBeenCalledWith(standIn);
    expect(await heldForm(image, 'ktx2', holding(image), verdict())).toBe('img');
  });
  it('waits on RETRY as before when the other form is not held, or the cache cannot say', async () => {
    expect(await heldForm(image, 'img', holding(image), verdict())).toBeUndefined();
    expect(await heldForm(image, 'ktx2', holding(standIn), verdict())).toBeUndefined();
    expect(await heldForm(image, 'img', () => Promise.reject(new DOMException('denied', 'SecurityError')), verdict())).toBeUndefined();
  });
  it('never turns to KTX2 on a GPU the capability probe turned to images, and a file with one form has nothing to hold', async () => {
    expect(await heldForm(image, 'img', holding(standIn), verdict({ veto: 'sRGB ASTC mips read as zeros' }))).toBeUndefined();
    const held = holding(standIn);
    expect(await heldForm('/assets/nine-dragon/lab/organic/lion.webp', 'img', held, verdict())).toBeUndefined();
    expect(held).not.toHaveBeenCalled();
  });
  it('a read that fails twice asks before it waits on RETRY, and throws when the caller has the other form', async () => {
    const fetch = vi.fn(() => Promise.reject(new TypeError('Failed to fetch')));
    const retry = vi.fn(() => Promise.reject(new Error('parked on RETRY')));
    await expect(readContent(image, 1000, { fetch, retry, instead: () => Promise.resolve(true) })).rejects.toBeInstanceOf(ContentReadError);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(retry).not.toHaveBeenCalled();
    await expect(readContent(image, 1000, { fetch, retry, instead: () => Promise.resolve(false) })).rejects.toThrow('parked on RETRY');
    expect(retry).toHaveBeenCalledOnce();
  });
});

describe('OF17: a texture read turns to its held form', () => {
  const ktx2Texture = { isCompressedTexture: true } as unknown as CompressedTexture;
  /** an image read that fails twice: it asks `instead`, then throws (or would wait on RETRY: a distinct error here) */
  const failingImage = vi.fn(async (instead?: (error: ContentReadError) => Promise<boolean>) => {
    const error = new ContentReadError(image, 'connection unavailable');
    if (instead !== undefined && await instead(error)) throw error;
    throw new Error('parked on RETRY');
  });
  it('an images page whose image fails reads the held KTX2 stand-in', async () => {
    setTexturePolicy('img', 'nine-dragon-stack');
    const ktx2 = vi.fn((tex?: 'img' | 'ktx2') => Promise.resolve(tex === 'ktx2' ? ktx2Texture : null));
    expect(await readHeldForm(image, ktx2, failingImage, holding(standIn))).toBe(ktx2Texture);
    expect(ktx2).toHaveBeenLastCalledWith('ktx2');
    await expect(readHeldForm(image, ktx2, failingImage, holding())).rejects.toThrow('parked on RETRY');
  });
  it('a KTX2 page whose stand-in fails reads the held image', async () => {
    setTexturePolicy('ktx2', 'nine-dragon-stack');
    const offline = (): Promise<CompressedTexture | null> => Promise.reject(new TypeError('Failed to fetch'));
    const bitmap = { width: 1024 };
    expect(await readHeldForm(image, offline, () => Promise.resolve(bitmap), holding(image))).toBe(bitmap);
    await expect(readHeldForm(image, offline, () => Promise.resolve(bitmap), holding())).rejects.toThrow('Failed to fetch');
  });
});

describe('OF17: one form per device and tier', () => {
  it('a shard this device read as KTX2 stays KTX2 where the page would pick images', () => {
    setDeviceTexForm({ read: slug => slug === 'nine-dragon-stack', keep: () => undefined });
    setTexturePolicy('img', 'nine-dragon-stack');
    expect(texModeWhy()).toEqual({ mode: 'ktx2', why: 'auto: this device read nine-dragon-stack as KTX2 (OF17)' });
    setTexturePolicy('img', 'pine-hollow');
    expect(texModeWhy().mode).toBe('img');
  });
  it('the device keeps a shard once a build reads one of its KTX2 stand-ins', () => {
    const keep = vi.fn();
    setDeviceTexForm({ read: () => false, keep });
    setTexturePolicy('ktx2', 'nine-dragon-stack');
    expect(gpuFile(image)).toBe(standIn);
    expect(gpuFile(image)).toBe(standIn);
    expect(keep).toHaveBeenCalledOnce();
    expect(keep).toHaveBeenCalledWith('nine-dragon-stack');
    setTexturePolicy('img', 'pine-hollow');
    expect(gpuFile(image)).toBeUndefined();
    expect(keep).toHaveBeenCalledOnce();
  });
});
