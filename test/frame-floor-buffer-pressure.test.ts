import {expect, test} from 'vitest';
// oxlint-disable-next-line import/no-nodejs-modules -- native realm-isolated probe regression, no browser
import {createContext, runInContext} from 'node:vm';
import {BUFFER_PRESSURE_SCRIPT} from '../scripts/frame-floor-buffer-pressure.mjs';

function fixture() {
  let now = 100;
  const context = createContext({window: {}, performance: {now: () => now}});
  const read = (code: string): unknown => runInContext(code, context);
  read('var nativeFloat = Float32Array, nativeSlice = Float32Array.prototype.slice;');
  read(BUFFER_PRESSURE_SCRIPT);
  return {read, at: (at: number) => {now = at;}};
}

test('preboot definition leaves native constructors and methods untouched until C', () => {
  const f = fixture();
  expect(f.read('nativeFloat === Float32Array && nativeSlice === Float32Array.prototype.slice')).toBe(true);
  f.read('window.__frameFloorBufferPressure.begin(); new Float32Array(4); var report = window.__frameFloorBufferPressure.take();');
  expect(f.read('report.rows.map(r => [r.api,r.calls,r.newBackingBytes,r.existingViews])')).toEqual([['Float32Array',1,16,0]]);
  expect(f.read('nativeFloat === Float32Array && nativeSlice === Float32Array.prototype.slice')).toBe(true);
  expect(f.read('report.errors + report.dropped')).toBe(0);
});

test('counts zero-threshold backing and existing views separately with correct native semantics', () => {
  const f = fixture();
  f.read(`var existing = new ArrayBuffer(64); window.__frameFloorBufferPressure.begin();
    var own = new Float32Array([1,2,3,4]); var view = new Float32Array(existing,0,4);
    var data = new DataView(existing,4,8); var empty = new Uint8Array(0);
    class Child extends Uint16Array {}; var child = new Child(3);
    var copied = own.slice(1,3), sub = own.subarray(1), mapped = own.map(x => x*2), filtered = own.filter(x => x>2);
    var from = Uint8Array.from([1,2]), of = Uint16Array.of(1,2,3), buffer = existing.slice(0,5);
    var report = window.__frameFloorBufferPressure.take();`);
  expect(f.read('view.buffer===existing && data.buffer===existing && child instanceof Child && child instanceof Uint16Array')).toBe(true);
  expect(f.read('Array.from(mapped)')).toEqual([2,4,6,8]);
  expect(f.read('report.rows.map(r => [r.api,r.calls,r.newBackingBytes,r.existingViews])')).toEqual([
    ['Float32Array',2,16,1],['DataView',1,0,1],['Uint8Array',2,2,0],['Uint16Array',2,12,0],
    ['TypedArray.slice',1,8,0],['TypedArray.subarray',1,0,1],['TypedArray.map',1,16,0],['TypedArray.filter',1,8,0],
    ['ArrayBuffer.slice',1,5,0],
  ]);
  expect(f.read('report.errors+report.dropped')).toBe(0);
  expect(f.read('report.stacks.every(r => typeof r.stack === "string" && r.stack.includes("Buffer creation"))')).toBe(true);
});

test('failed constructors preserve native refusal and count only successful creations by second', () => {
  const f = fixture(); f.read('window.__frameFloorBufferPressure.begin(); new ArrayBuffer(0);');
  expect(() => f.read('new Float32Array(-1)')).toThrow();
  expect(() => f.read('Float32Array.prototype.slice.call({})')).toThrow();
  f.at(1200); f.read('new ArrayBuffer(2); var report = window.__frameFloorBufferPressure.take();');
  expect(f.read('report.rows.map(r => [r.api,r.second,r.calls,r.newBackingBytes])')).toEqual([['ArrayBuffer',0,1,0],['ArrayBuffer',1,1,2]]);
  expect(f.read('report.errors+report.dropped')).toBe(0);
});

test('nested species constructors count one outer operation and preserve shared-buffer views', () => {
  const f = fixture(); f.read(`window.__frameFloorBufferPressure.begin(); var source = new Float32Array(3);
    source.constructor = { [Symbol.species]: Float32Array }; source.slice();
    var shared = new SharedArrayBuffer(12); new Uint8Array(shared); var report = window.__frameFloorBufferPressure.take();`);
  expect(f.read('report.rows.map(r => [r.api,r.calls,r.newBackingBytes,r.existingViews])')).toEqual([
    ['Float32Array',2,24,0], ['SharedArrayBuffer',1,12,0], ['Uint8Array',1,0,1],
  ]);
  expect(f.read('report.errors+report.dropped')).toBe(0);
});

test('method callback allocations stay visible alongside the method result', () => {
  const f = fixture(); f.read(`var source = new Float32Array(2); window.__frameFloorBufferPressure.begin();
    source.map(x => { new ArrayBuffer(7); return x; }); var report = window.__frameFloorBufferPressure.take();`);
  expect(f.read('report.rows.map(r => [r.api,r.calls,r.newBackingBytes])')).toEqual([['ArrayBuffer',2,14],['TypedArray.map',1,8]]);
});
