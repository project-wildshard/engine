import {expect, test} from 'vitest';
// oxlint-disable-next-line import/no-nodejs-modules -- exercise the actual serialized diagnostic without a browser or GPU
import {runInNewContext} from 'node:vm';
// oxlint-disable-next-line import/no-nodejs-modules -- exercise the actual whole-drive sampler's diagnostic drains
import {readFileSync} from 'node:fs';
import {GL_TIMED, GL_TIMING_SCRIPT} from '../scripts/frame-floor-gl-time.mjs';

function fixture(cost = 1.25) {
  let now = 0;
  const returned = {}, refusal = new Error('native refusal'), calls: {receiver: unknown; args: unknown[]}[] = [];
  class Context {readonly fixture = true;}
  for (const method of GL_TIMED) Object.defineProperty(Context.prototype, method, {configurable: true, writable: true,
    value(this: unknown, ...args: unknown[]) {
      calls.push({receiver: this, args}); now += cost;
      if (args[0] === 'refuse') throw refusal;
      return returned;
    }});
  class Context2 extends Context {}
  const context = {window: {WebGLRenderingContext: Context, WebGL2RenderingContext: Context2}, performance: {now: () => now}};
  const read = (code: string): unknown => runInNewContext(code, context);
  read(GL_TIMING_SCRIPT);
  read('var gl = new window.WebGL2RenderingContext();');
  return {read, context, calls, returned, refusal};
}

test('times all upload/readback calls and the six previously missing sync/copy calls', () => {
  const f = fixture();
  const required = ['bufferData', 'bufferSubData', 'texImage2D', 'texSubImage2D', 'texImage3D', 'texSubImage3D',
    'compressedTexImage2D', 'compressedTexSubImage2D', 'compressedTexImage3D', 'compressedTexSubImage3D', 'texStorage2D', 'texStorage3D',
    'readPixels', 'getBufferSubData', 'getError', 'finish', 'clientWaitSync',
    'fenceSync', 'waitSync', 'getSyncParameter', 'flush', 'copyTexImage2D', 'copyTexSubImage2D'];
  for (const method of required) expect(GL_TIMED).toContain(method);
  for (const method of GL_TIMED) expect(f.read(`gl.${method}(0)`)).toBe(f.returned);
  const bank = f.read('window.__frameFloorGlTake()');
  expect(bank).toEqual(Object.fromEntries(GL_TIMED.map(method => [method, [1.3, 1]])));
  expect(f.calls).toHaveLength(GL_TIMED.length);
  expect(f.read('window.__frameFloorGlTake()')).toBeNull();
});

test('preserves arguments, receivers, native refusals and idempotent inherited wrapping', () => {
  const f = fixture(), receiver = f.read('gl');
  f.read(GL_TIMING_SCRIPT);
  expect(f.read('gl.waitSync(1, -0, 3)')).toBe(f.returned);
  expect(f.calls[0]).toEqual({receiver, args: [1, -0, 3]});
  expect(() => f.read('gl.fenceSync("refuse")')).toThrow(f.refusal);
  expect(f.read('window.__frameFloorGlTake()')).toEqual({waitSync: [1.3, 1], fenceSync: [1.3, 1]});
});

test('keeps slow program and image labels separate from the original method totals', () => {
  const f = fixture(4);
  f.read('gl.getProgramParameter({},0); gl.texImage2D(0,0,0,0,0,{width:8,height:4});');
  expect(f.read('window.__frameFloorGlTake()')).toEqual({getProgramParameter: [4,1],
    'slow getProgramParameter unobserved': [4,1], texImage2D: [4,1], 'slow texImage2D Object 8x4': [4,1]});
  expect(f.calls).toHaveLength(2);
});

test('counts typed source spans, element offsets, compressed lengths and allocation-only requests separately', () => {
  const f = fixture();
  f.read(`var bytes = new Uint8Array(100), words = new Float32Array(10);
    gl.bufferData(0, 4096, 0); gl.bufferData(0, words, 0, 2, 3);
    gl.bufferSubData(0, 99, new DataView(new ArrayBuffer(20)), 4, 5);
    gl.texImage2D(0,0,0,2,2,0,0,0,words,3);
    gl.texSubImage2D(0,0,0,0,2,2,0,0,bytes,10);
    gl.texImage3D(0,0,0,2,2,2,0,0,0,bytes,5);
    gl.texSubImage3D(0,0,0,0,0,2,2,2,0,0,bytes,7);
    gl.compressedTexImage2D(0,0,0,2,2,0,new Uint32Array(10),2,3);
    gl.compressedTexSubImage2D(0,0,0,0,2,2,0,bytes,3,5);
    gl.compressedTexImage3D(0,0,0,2,2,2,0,bytes,4,0);
    gl.compressedTexSubImage3D(0,0,0,0,0,2,2,2,0,bytes,5,6);
    var bank = window.__frameFloorGlUploadsTake();`);
  expect(f.read('bank.bufferData')).toEqual({calls: 2, sourceBytes: 12, allocationBytes: 4096, imagePixels: 0, unknownCalls: 0});
  expect(f.read('bank.bufferSubData.sourceBytes')).toBe(5);
  expect(f.read('Object.entries(bank).filter(([name]) => name.startsWith("tex") || name.startsWith("compressed")).map(([name,row]) => [name,row.sourceBytes,row.unknownCalls])'))
    .toEqual([['texImage2D',28,0], ['texSubImage2D',90,0], ['texImage3D',95,0], ['texSubImage3D',93,0],
      ['compressedTexImage2D',12,0], ['compressedTexSubImage2D',5,0], ['compressedTexImage3D',96,0], ['compressedTexSubImage3D',6,0]]);
  expect(f.read('window.__frameFloorGlUploadsTake()')).toBeNull();
  expect(f.read('window.__frameFloorGlTake().bufferData')).toEqual([2.5, 2]);
});

test('records image pixels without inventing bytes and leaves PBO/invalid metadata unknown', () => {
  const f = fixture();
  f.read(`gl.texImage2D(0,0,0,0,0,{naturalWidth:1024,naturalHeight:576});
    gl.texSubImage2D(0,0,0,0,0,0,{videoWidth:640,videoHeight:480});
    gl.texImage2D(0,0,0,2,2,0,0,0,null);
    gl.texImage2D(0,0,0,2,2,0,0,0,32);
    gl.bufferSubData(0,0,new Uint8Array(5),6);
    gl.texImage2D(0,0,0,0,0,{get width(){throw Error('metadata');}});
    var bank = window.__frameFloorGlUploadsTake();`);
  expect(f.read('bank.texImage2D')).toEqual({calls: 4, sourceBytes: 0, allocationBytes: 0, imagePixels: 589824, unknownCalls: 2});
  expect(f.read('bank.texSubImage2D.imagePixels')).toBe(307200);
  expect(f.read('bank.bufferSubData.unknownCalls')).toBe(1);
  f.read('bank.texImage2D.calls = 999; gl.texImage2D(0,0,0,2,2,0,0,0,new Uint8Array(16));');
  expect(f.read('window.__frameFloorGlUploadsTake().texImage2D')).toEqual({calls: 1, sourceBytes: 16, allocationBytes: 0, imagePixels: 0, unknownCalls: 0});
});

test('whole-drive samples retain upload banks beside GL time while short samples cannot drain them', async () => {
  const f = fixture(), callbacks: ((at: number) => void)[] = [];
  let now = 100;
  const game = {frameCount: 0, frameI: 1, frameMs: [33], workMs: [1], renderMs: [0.25], lastFrame: {calls: 1, triangles: 1},
    app: {cpu: {enabled: false, snapshot: () => ({enabled: true, frame: 0, owners: []})}}, renderer: {getContext: () => ({isContextLost: () => false})}};
  const source = readFileSync(new URL('../scripts/frame-floor.mjs', import.meta.url), 'utf8');
  const begin = source.indexOf('function sample(n, timeline = false) {'), end = source.indexOf('/** the whole-drive sampler', begin);
  if (begin === -1 || end <= begin) throw new Error('Real sampler not found');
  Object.assign(f.context.window, {__frameFloorDriveDone: true, __wildshard: {world: {game, player: {position: {x: 0,y: 0,z: 0}}},
    shard: {grid: {state: () => ({live: {runtimeTiming: {current: null}}})}}}});
  Object.assign(f.context, {performance: {now: () => now}, setTimeout: () => 1, clearTimeout: () => undefined, cancelAnimationFrame: () => undefined,
    // oxlint-disable-next-line promise/prefer-await-to-callbacks -- deliver the real sampler's rAF at controlled drawn-frame timestamps
    requestAnimationFrame: (callback: (at: number) => void) => {callbacks.push(callback); return callbacks.length;}});
  const whole: unknown = f.read(`(${source.slice(begin,end)})(0)`), short: unknown = f.read(`(${source.slice(begin,end)})(2)`);
  for (let i = 0; i <= 30; i++) {
    f.read('gl.bufferData(0, new Uint8Array(16), 0)');
    now += 33; game.frameCount++;
    // oxlint-disable-next-line promise/prefer-await-to-callbacks -- deliver the retained native rAF callbacks, not a Promise callback
    for (const callback of callbacks.splice(0)) callback(now);
  }
  expect(await short).not.toHaveProperty('glUploadFrames');
  const result = await whole;
  expect(result).toMatchObject({frames: 30, p95Ms: 33});
  if (typeof result !== 'object' || result === null) throw new Error('Sampler result missing');
  expect(Reflect.get(result, 'drawSamples')).toEqual(Array.from({length: 30}, (_, i) => ({drawnFrame: i + 2, draws: 1, renderMs: 0.25})));
  expect(Reflect.get(result, 'glUploadFrames')).toEqual(Array.from({length: 30}, (_, i) => [133 + i * 33,
    {bufferData: {calls: 1, sourceBytes: 16, allocationBytes: 0, imagePixels: 0, unknownCalls: 0}}]));
  expect(callbacks).toHaveLength(0);
});
