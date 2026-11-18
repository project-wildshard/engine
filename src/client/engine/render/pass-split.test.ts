import { expect, test } from 'vitest';
import { installPassSplit, type PassSplitContext } from './passSplit';

const SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const CHROME = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

function fakeContext(): { gl: PassSplitContext; calls: string[] } {
  const calls: string[] = [];
  const draw = (name: string) => (...args: readonly number[]): void => { calls.push(`${name} ${args.join(',')}`); };
  const gl: PassSplitContext = {
    flush: () => { calls.push('flush'); },
    bindFramebuffer: (target, framebuffer) => { calls.push(`bind ${String(target)} ${framebuffer === null ? 'screen' : 'fb'}`); },
    drawArrays: draw('drawArrays'), drawElements: draw('drawElements'), drawArraysInstanced: draw('drawArraysInstanced'),
    drawElementsInstanced: draw('drawElementsInstanced'), drawRangeElements: draw('drawRangeElements'),
  };
  return { gl, calls };
}

test('a pass flushes before the draw that would carry it past the limit, counting instances', () => {
  const { gl, calls } = fakeContext();
  expect(installPassSplit(gl, SAFARI, 100)).toBe(true);
  gl.drawElements(4, 60, 5123, 0);
  gl.drawElementsInstanced(4, 10, 5123, 0, 4); // 40: exactly the limit, no flush
  gl.drawArrays(4, 0, 3); // 103: over, so the pass flushes first
  gl.drawArraysInstanced(4, 0, 30, 2);
  gl.drawRangeElements(4, 0, 9, 50, 5123, 0); // 63 + 50: over again
  expect(calls).toEqual(['drawElements 4,60,5123,0', 'drawElementsInstanced 4,10,5123,0,4', 'flush', 'drawArrays 4,0,3',
    'drawArraysInstanced 4,0,30,2', 'flush', 'drawRangeElements 4,0,9,50,5123,0']);
});

test('one draw over the limit draws whole, and a new draw framebuffer starts the count again', () => {
  const { gl, calls } = fakeContext();
  installPassSplit(gl, SAFARI, 100);
  const fb = {} as WebGLFramebuffer;
  gl.drawElements(4, 500, 5123, 0); // alone in its pass: never split, never flushed before
  gl.bindFramebuffer(0x8d40, fb); // a new target ends the pass by itself
  gl.drawElements(4, 90, 5123, 0);
  gl.bindFramebuffer(0x8ca8, null); // a read framebuffer moves no draw
  gl.drawElements(4, 20, 5123, 0);
  expect(calls).toEqual(['drawElements 4,500,5123,0', 'bind 36160 fb', 'drawElements 4,90,5123,0', 'bind 36008 screen', 'flush', 'drawElements 4,20,5123,0']);
});

test('a limit of 0 (the default slot) leaves the draws unwrapped', () => {
  const { gl } = fakeContext();
  const before = gl.drawElements;
  expect(installPassSplit(gl, SAFARI, 0)).toBe(false);
  expect(gl.drawElements).toBe(before);
});

test('Blink keeps its draws unwrapped', () => {
  const { gl } = fakeContext();
  const before = gl.drawElements;
  expect(installPassSplit(gl, CHROME)).toBe(false);
  expect(gl.drawElements).toBe(before);
});
