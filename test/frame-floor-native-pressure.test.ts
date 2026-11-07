import {expect, test} from 'vitest';
// oxlint-disable-next-line import/no-nodejs-modules -- execute the actual pre-boot serialized probe without a browser
import {runInNewContext} from 'node:vm';
import {NATIVE_PRESSURE_SCRIPT} from '../scripts/frame-floor-native-pressure.mjs';

function fixture() {
  let now = 100;
  const result = {}, refusal = new Error('native refusal');
  class Memory {
    pages = 1;
    grow(n: number) {if (n < 0) throw refusal; const old = this.pages; this.pages += n; return old;}
  }
  class Module {kind = 'module';}
  class Instance {kind = 'instance';}
  class OffscreenCanvas {transferToImageBitmap() {return result;}}
  class ImageBitmap {width = 1;}
  const wasm = {Memory, Module, Instance, compile: () => result, instantiate: () => result};
  const context = {window: {}, performance: {timeOrigin: 1, now: () => now}, WebAssembly: wasm,
    ArrayBuffer, OffscreenCanvas, ImageBitmap, createImageBitmap: () => result};
  runInNewContext(NATIVE_PRESSURE_SCRIPT, context);
  const evaluate = (code: string): unknown => runInNewContext(code, context);
  return {evaluate, at: (at: number) => {now = at;}, result, refusal, context};
}

test('preserves native construction, growth receiver, return values and refusal identity', () => {
  const f = fixture();
  expect(f.evaluate('class Child extends WebAssembly.Memory {}; var memory = new Child(); memory instanceof Child && memory instanceof WebAssembly.Memory')).toBe(true);
  expect(f.evaluate('memory.grow(2)')).toBe(1);
  expect(() => f.evaluate('memory.grow(-1)')).toThrow(f.refusal);
  expect(f.evaluate('WebAssembly.compile(new Uint8Array(0))')).toBe(f.result);
  expect(f.evaluate('WebAssembly.instantiate(new Uint8Array(0))')).toBe(f.result);
  expect(f.evaluate('createImageBitmap({})')).toBe(f.result);
  expect(f.evaluate('new OffscreenCanvas().transferToImageBitmap()')).toBe(f.result);
  expect(f.evaluate('window.__frameFloorNativePressure.read().rows.map(r => [r.api,r.calls,r.failed])')).toEqual([
    ['WebAssembly.Memory',1,0],['WebAssembly.Memory.grow',2,1],['WebAssembly.compile',1,0],
    ['WebAssembly.instantiate',1,0],['createImageBitmap',1,0],['OffscreenCanvas',1,0],['OffscreenCanvas.transferToImageBitmap',1,0],
  ]);
});

test('filters actual large buffers, samples once per API/second and detaches scalar output', () => {
  const f = fixture();
  f.evaluate('new ArrayBuffer(10); new ArrayBuffer(1048576); new ArrayBuffer(2097152)');
  expect(f.evaluate('window.__frameFloorNativePressure.read().rows.map(r => [r.api,r.calls,r.second,typeof r.stack])')).toEqual([['ArrayBuffer>=1MiB',2,0,'string']]);
  f.at(1100); f.evaluate('new ArrayBuffer(1048576)');
  expect(f.evaluate('window.__frameFloorNativePressure.read().rows.length')).toBe(2);
  f.evaluate('var detached = window.__frameFloorNativePressure.read(); detached.rows[0].calls = 999');
  expect(f.evaluate('window.__frameFloorNativePressure.read().rows[0].calls')).toBe(2);
  expect(f.evaluate('window.__frameFloorNativePressure.read().support.find(r => r.api === "WebAssembly.compileStreaming")')).toEqual({api:'WebAssembly.compileStreaming',available:false,wrapped:false});
});

test('settled epochs exclude earlier/later calls while preserving a cumulative positive control', () => {
  const f = fixture(); f.evaluate('new WebAssembly.Memory()');
  f.evaluate('window.__frameFloorNativePressure.begin()');
  expect(() => f.evaluate('window.__frameFloorNativePressure.begin()')).toThrow('already active');
  f.evaluate('new WebAssembly.Instance(); new ImageBitmap()');
  expect(f.evaluate('window.__frameFloorNativePressure.take().rows.map(r => [r.api,r.calls])')).toEqual([['WebAssembly.Instance',1],['ImageBitmap',1]]);
  f.evaluate('new WebAssembly.Memory()');
  f.evaluate('window.__frameFloorNativePressure.begin()');
  expect(f.evaluate('var empty = window.__frameFloorNativePressure.take(); empty.rows')).toEqual([]);
  expect(f.evaluate('empty.cumulative.rows.map(r => [r.api,r.calls])')).toEqual([['WebAssembly.Memory',2],['WebAssembly.Instance',1],['ImageBitmap',1]]);
});

test('bounds retained seconds and reports drops rather than retaining targets', () => {
  const f = fixture();
  for (let i=0;i<2050;i++) {f.at(i*1000); f.evaluate('new WebAssembly.Memory()');}
  expect(f.evaluate('window.__frameFloorNativePressure.read().rows.length')).toBe(2048);
  expect(f.evaluate('window.__frameFloorNativePressure.read().dropped')).toBe(2);
  expect(f.evaluate('window.__frameFloorNativePressure.read().observerErrors')).toBe(0);
});
