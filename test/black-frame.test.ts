// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from 'vitest';
import type { BrowserContext, Page } from 'playwright';
import { captureBootFrame, frameFailure, screenshotPixels, type BootFrameSample } from '../scripts/parity/black-frame.mjs';
import { registerCaptureTrace } from '../scripts/parity/capture-trace.mjs';
import type { captureViewportPng } from '../scripts/parity/fast-png.mjs';
import { legacyDouble } from '@wildshard/engine/test/FakeGame';
// oxlint-disable-next-line import/no-nodejs-modules -- Match Playwright's PNG Buffer without launching a browser.
import { Buffer } from 'node:buffer';

afterEach(() => { vi.restoreAllMocks(); });

test('the black-placeholder threshold includes 90%, refusing missing pixels', () => {
  const sample = { width:780, height:1688, pixels:100, darkShare:.89 };
  expect(frameFailure(sample)).toBeNull();
  expect(frameFailure({...sample,darkShare:.9})).toContain('90% near-black');
  expect(frameFailure({...sample,darkShare:1})).toContain('90% near-black');
  for (const invalid of [{pixels:0},{width:0},{darkShare:Number.NaN},{darkShare:-1},{darkShare:1.1}]) {
    expect(frameFailure({...sample,...invalid})).toBe('invalid screenshot sample');
  }
});

test('composited screenshot pixels are read on a detached canvas and the bitmap is closed', async () => {
  const close = vi.fn<() => void>(), drawImage = vi.fn((...args:unknown[]):void => { expect(args).toHaveLength(5); });
  const bitmap = {width:780,height:1688,close};
  const data = new Uint8ClampedArray(32);
  data.set([16,0,0,255],16); // Red at the threshold is a lit sample.
  const context = legacyDouble<CanvasRenderingContext2D>({drawImage,getImageData:()=>({data,width:8,height:1,colorSpace:'srgb'})});
  const getContext = vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue(context);
  const decode = vi.fn(() => Promise.resolve(bitmap));
  vi.stubGlobal('createImageBitmap',decode);
  try {
    const count = document.querySelectorAll('canvas').length;
    expect(await screenshotPixels([1,2,3])).toEqual({width:780,height:1688,pixels:2,darkShare:.5});
    expect(document.querySelectorAll('canvas')).toHaveLength(count);
    expect(drawImage).toHaveBeenCalledExactlyOnceWith(bitmap,0,0,192,416);
    expect(decode).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
    getContext.mockReturnValue(null);
    await expect(screenshotPixels([1])).rejects.toThrow('Missing screenshot analysis context');
    expect(close).toHaveBeenCalledTimes(2);
  } finally { getContext.mockRestore();vi.unstubAllGlobals(); }
});

test('a black boot frame fails with its checkpoint and retained observation', async () => {
  vi.spyOn(Date,'now').mockReturnValue(1000);
  const capture=vi.fn<typeof captureViewportPng>().mockResolvedValue(Buffer.from([1,2,3]));
  const screenshot=vi.fn();
  const evaluate=vi.fn(() => Promise.resolve({width:780,height:1688,pixels:100,darkShare:.95}));
  const context=legacyDouble<BrowserContext>({browser:()=>null});
  const page=legacyDouble<Page>({screenshot,evaluate,context:()=>context}), frames:BootFrameSample[]=[];
  await expect(captureBootFrame(page,'SHARD SELECT',Date.now()+30000,frames,capture)).rejects.toThrow('SHARD SELECT: frame is at least 90% near-black');
  expect(frames).toEqual([{label:'SHARD SELECT',width:780,height:1688,pixels:100,darkShare:.95}]);
  expect(capture).toHaveBeenCalledOnce();
  expect(capture.mock.calls[0]?.[0]).toBe(page);
  expect(capture.mock.calls[0]?.slice(1)).toEqual(['SHARD SELECT',11000]);
  expect(screenshot).not.toHaveBeenCalled();
  expect(evaluate).toHaveBeenCalledExactlyOnceWith(screenshotPixels,[1,2,3]);
});

test('an exhausted original deadline refuses before requesting a screenshot', async () => {
  const screenshot=vi.fn(), capture=vi.fn<typeof captureViewportPng>(), page=legacyDouble<Page>({screenshot});
  await expect(captureBootFrame(page,'grid HOME',Date.now()-1,[],capture)).rejects.toThrow('Boot deadline: grid HOME screenshot');
  expect(screenshot).not.toHaveBeenCalled();
  expect(capture).not.toHaveBeenCalled();
});

test('a screenshot timeout stays red after diagnostic cleanup with no second capture', async () => {
  const original=new Error('page.screenshot: Timeout 10000ms exceeded.');
  const capture=vi.fn<typeof captureViewportPng>().mockRejectedValue(original);
  const screenshot=vi.fn();
  const start=vi.fn().mockResolvedValue(undefined), stop=vi.fn().mockRejectedValue(new Error('trace lost'));
  const tracing=legacyDouble<BrowserContext['tracing']>({start,stop});
  const context=legacyDouble<BrowserContext>({tracing});
  const page=legacyDouble<Page>({context:()=>context,screenshot,evaluate:()=>Promise.resolve(true)});
  registerCaptureTrace(page,'unused','nine');
  const frames:BootFrameSample[]=[];
  await expect(captureBootFrame(page,'Nine title',Date.now()+30000,frames,capture)).rejects.toBe(original);
  expect(capture).toHaveBeenCalledOnce();
  expect(screenshot).not.toHaveBeenCalled();
  expect(start).toHaveBeenCalledExactlyOnceWith({screenshots:false,snapshots:false,sources:false});
  expect(stop).toHaveBeenCalledExactlyOnceWith({path:'unused/nine-capture-1.zip'});
  expect(frames).toEqual([]);
});
