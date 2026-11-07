import { afterEach, expect, test, vi } from 'vitest';
import type { Page } from 'playwright';
import { legacyDouble } from '@wildshard/engine/test/FakeGame';
import { captureViewportPng, type CaptureSession, type OpenCaptureSession } from '../scripts/parity/fast-png.mjs';
// oxlint-disable-next-line import/no-nodejs-modules -- Model the exact PNG transport returned by supported CDP.
import { Buffer } from 'node:buffer';

afterEach(() => { vi.useRealTimers(); });

function fixture() {
  const viewport={width:390,height:844};
  const visualViewport={offsetX:0,offsetY:0,pageX:12,pageY:25,clientWidth:390,clientHeight:844,scale:1};
  const layoutViewport={pageX:12,pageY:25,clientWidth:390,clientHeight:844};
  const contentSize={x:0,y:0,width:390,height:844};
  const metrics={visualViewport,layoutViewport,contentSize,cssVisualViewport:visualViewport,
    cssLayoutViewport:layoutViewport,cssContentSize:contentSize};
  const bytes=Buffer.from([137,80,78,71,13,10,26,10]);
  const layout=vi.fn<CaptureSession['layout']>().mockResolvedValue(metrics);
  const capture=vi.fn<CaptureSession['capture']>().mockResolvedValue({data:bytes.toString('base64')});
  const detach=vi.fn<CaptureSession['detach']>().mockResolvedValue(undefined);
  const newCDPSession=vi.fn<OpenCaptureSession>().mockResolvedValue({layout,capture,detach});
  const evaluate=vi.fn<Page['evaluate']>().mockResolvedValue(true), screenshot=vi.fn();
  const page=legacyDouble<Page>({viewportSize:()=>viewport,evaluate,screenshot});
  return {page,metrics,viewport,bytes,layout,capture,detach,newCDPSession,evaluate,screenshot};
}

test('title capture keeps script execution live through the same viewport port', async () => {
  const f=fixture(), events:string[]=[];
  f.evaluate.mockImplementation(()=>{events.push('ready');return Promise.resolve(true);});
  f.layout.mockImplementation(()=>{events.push('layout');return Promise.resolve(f.metrics);});
  f.capture.mockImplementation(()=>{events.push('capture');return Promise.resolve({data:f.bytes.toString('base64')});});
  f.detach.mockImplementation(()=>{events.push('detach');return Promise.resolve();});
  expect(await captureViewportPng(f.page,'title',Date.now()+10000,f.newCDPSession)).toEqual(f.bytes);
  expect(events).toEqual(['ready','ready','layout','capture','detach']);
  expect(f.capture).toHaveBeenCalledOnce();
  expect(f.screenshot).not.toHaveBeenCalled();
});

test('title native timeout detaches without retrying or accepting a late frame', async () => {
  vi.useFakeTimers();vi.setSystemTime(0);
  const f=fixture();
  f.capture.mockReturnValueOnce(new Promise<{data:string}>(()=>{ /* Native reply stays pending. */ }));
  const refused=expect(captureViewportPng(f.page,'title',10000,f.newCDPSession)).rejects.toThrow('Boot deadline: title native-capture');
  await vi.advanceTimersByTimeAsync(10000);await refused;
  expect(f.capture).toHaveBeenCalledOnce();
  expect(f.detach).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});

test('title layout consumes the original deadline with no late capture', async () => {
  vi.useFakeTimers();vi.setSystemTime(0);
  const f=fixture();f.layout.mockReturnValueOnce(new Promise<Awaited<ReturnType<CaptureSession['layout']>>>(()=>{ /* Layout acknowledgement stays pending. */ }));
  const refused=expect(captureViewportPng(f.page,'title',10000,f.newCDPSession)).rejects.toThrow('Boot deadline: title layout-metrics');
  await vi.advanceTimersByTimeAsync(10000);await refused;
  expect(f.capture).not.toHaveBeenCalled();
  expect(f.detach).toHaveBeenCalledOnce();
});

test('a refused title PNG cannot become success through ordinary cleanup', async () => {
  const f=fixture(), failure=new Error('Capture refused');
  f.capture.mockRejectedValueOnce(failure);
  await expect(captureViewportPng(f.page,'title',Date.now()+10000,f.newCDPSession)).rejects.toBe(failure);
  expect(f.capture).toHaveBeenCalledOnce();
  expect(f.detach).toHaveBeenCalledOnce();
});

test('font readiness precedes one fast lossless capture with the original device-scale viewport clip', async () => {
  vi.useFakeTimers(); vi.setSystemTime(0);
  const f=fixture(); let ready: (()=>void)|undefined;
  const fonts=new Promise<boolean>(resolve=>{ready=()=>resolve(true);});
  f.evaluate.mockReturnValueOnce(fonts).mockResolvedValue(true);
  const captured=captureViewportPng(f.page,'Nine title',10000,f.newCDPSession);
  await vi.advanceTimersByTimeAsync(140);
  expect(f.layout).not.toHaveBeenCalled();
  expect(f.capture).not.toHaveBeenCalled();
  if (ready===undefined) throw new Error('Missing fonts callback');
  ready(); expect(await captured).toEqual(f.bytes);
  expect(f.newCDPSession).toHaveBeenCalledOnce();
  expect(f.newCDPSession.mock.calls[0]?.[0]).toBe(f.page);
  expect(f.evaluate).toHaveBeenCalledTimes(2);
  expect(f.layout).toHaveBeenCalledOnce();
  expect(f.capture).toHaveBeenCalledExactlyOnceWith({
    format:'png',clip:{x:12,y:25,width:390,height:844,scale:1},
    fromSurface:true,captureBeyondViewport:false,optimizeForSpeed:true,
  });
  expect(f.screenshot).not.toHaveBeenCalled();
  expect(f.detach).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});

test('zoom uses the same viewport division and integer rounding as the existing Playwright path', async () => {
  const f=fixture(); f.metrics.visualViewport.scale=2;
  expect(await captureViewportPng(f.page,'title',Date.now()+10000,f.newCDPSession)).toEqual(f.bytes);
  expect(f.capture).toHaveBeenCalledExactlyOnceWith({
    format:'png',clip:{x:12,y:25,width:195,height:422,scale:2},
    fromSurface:true,captureBeyondViewport:false,optimizeForSpeed:true,
  });
});

test('a non-emulated page keeps the original inner viewport rather than the document extent', async () => {
  const f=fixture();
  const page=legacyDouble<Page>({viewportSize:()=>null,evaluate:f.evaluate});
  f.evaluate.mockResolvedValueOnce(true).mockResolvedValueOnce(true).mockResolvedValueOnce(f.viewport);
  expect(await captureViewportPng(page,'title',Date.now()+10000,f.newCDPSession)).toEqual(f.bytes);
  expect(f.capture).toHaveBeenCalledExactlyOnceWith({
    format:'png',clip:{x:12,y:25,width:390,height:844,scale:1},
    fromSurface:true,captureBeyondViewport:false,optimizeForSpeed:true,
  });
});

test('a native overrun refuses at ten seconds and never substitutes a late response or screenshot retry', async () => {
  vi.useFakeTimers(); vi.setSystemTime(0);
  const f=fixture(); let finish: (()=>void)|undefined;
  const late=new Promise<{data:string}>(resolve=>{finish=()=>resolve({data:f.bytes.toString('base64')});});
  f.capture.mockReturnValueOnce(late);
  const refused=expect(captureViewportPng(f.page,'Nine title',10000,f.newCDPSession)).rejects.toThrow('Boot deadline: Nine title native-capture');
  await vi.advanceTimersByTimeAsync(10000); await refused;
  expect(f.detach).toHaveBeenCalledOnce();
  if (finish===undefined) throw new Error('Missing capture callback');
  finish(); await Promise.resolve();
  expect(f.capture).toHaveBeenCalledOnce();
  expect(f.screenshot).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

test('a stalled font wait consumes the original shorter boot budget with no late capture', async () => {
  vi.useFakeTimers(); vi.setSystemTime(0);
  const f=fixture(); let ready: (()=>void)|undefined;
  const fonts=new Promise<boolean>(resolve=>{ready=()=>resolve(true);});
  f.evaluate.mockReturnValueOnce(fonts);
  const refused=expect(captureViewportPng(f.page,'grid HOME',1000,f.newCDPSession)).rejects.toThrow('Boot deadline: grid HOME fonts-ready');
  await vi.advanceTimersByTimeAsync(1000); await refused;
  if (ready===undefined) throw new Error('Missing fonts callback');
  ready(); await Promise.resolve();
  expect(f.layout).not.toHaveBeenCalled();
  expect(f.capture).not.toHaveBeenCalled();
  expect(f.detach).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});

test('native refusal stays red even when diagnostic session cleanup fails', async () => {
  const f=fixture(), original=new Error('Native capture refused');
  f.capture.mockRejectedValueOnce(original);
  f.detach.mockRejectedValueOnce(new Error('Target closed'));
  await expect(captureViewportPng(f.page,'title',Date.now()+10000,f.newCDPSession)).rejects.toBe(original);
  expect(f.capture).toHaveBeenCalledOnce();
  expect(f.screenshot).not.toHaveBeenCalled();
});

test.each([0,Number.NaN,Infinity])('invalid visual scale %s refuses without capturing another surface', async scale => {
  const f=fixture(); f.metrics.visualViewport.scale=scale;
  await expect(captureViewportPng(f.page,'title',Date.now()+10000,f.newCDPSession)).rejects.toThrow('Invalid screenshot viewport');
  expect(f.layout).toHaveBeenCalledOnce();
  expect(f.capture).not.toHaveBeenCalled();
  expect(f.detach).toHaveBeenCalledOnce();
});
