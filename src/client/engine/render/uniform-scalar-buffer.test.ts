import { expect, test } from 'vitest';
import { WebGLUniforms } from 'three/src/renderers/webgl/WebGLUniforms.js';
import type { WebGLProgram } from 'three/src/renderers/webgl/WebGLProgram.js';
import { installUniformCacheKinds } from './uniformCaches';

/** Record the complete float32 payload of actual Three scalar setters. */
function fixture(buffered: boolean, array = false, prewarm?: number) {
  const uploads: Uint8Array[] = [], buffers: Float32Array[] = [], address: unknown = {}, program: unknown = {};
  const record = (values: readonly number[]): void => { uploads.push(new Uint8Array(Float32Array.from(values).buffer)); };
  const native: unknown = {
    ACTIVE_UNIFORMS: 0x8b86,
    getProgramParameter: () => 1,
    getActiveUniform: () => ({ name: array ? 'value[0]' : 'value', type: 0x1406, size: array ? 3 : 1 }),
    getUniformLocation: () => address,
    uniform1f: (at: unknown, value: number): void => { expect(at).toBe(address); record([Math.fround(value)]); },
    uniform1fv: (at: unknown, values: Float32Array | number[]): void => {
      expect(at).toBe(address); record(Array.from(values, Math.fround));
      if (values instanceof Float32Array) buffers.push(values);
    },
  };
  const gl = native as WebGLRenderingContext, uniforms = new WebGLUniforms(gl, program as WebGLProgram);
  const setter: unknown = Reflect.get(uniforms, 'setValue');
  if (typeof setter !== 'function') throw new Error('Missing actual native uniform setter');
  const set = (value: unknown): void => { Reflect.apply(setter, uniforms, [gl, 'value', value]); };
  if (prewarm !== undefined) set(prewarm);
  if (buffered) { const target = { getUniforms: () => uniforms }; installUniformCacheKinds({ info: { programs: [target] } }); target.getUniforms(); }
  return { uploads, buffers, set };
}

test('scalar buffering preserves every native float32 byte and unrounded cache skip', () => {
  const old = fixture(false), now = fixture(true);
  for (const value of [.1, .1, Math.fround(.1), -0, 0, Number.MIN_VALUE, 1 + Number.EPSILON,
    1 + 2 * Number.EPSILON, 1e30, -1e30, Infinity, -Infinity, Number.NaN, Number.NaN]) { old.set(value); now.set(value); }
  expect(now.uploads).toEqual(old.uploads); expect(now.buffers).toHaveLength(now.uploads.length);
  expect(new Set(now.buffers).size).toBe(1);
});

test('native scalar coercion and throwing inputs retain their original cache and recovery', () => {
  const old = fixture(false), now = fixture(true), oldLog: string[] = [], newLog: string[] = [];
  const a = { valueOf: () => { oldLog.push('coerce'); return .125; } }, b = { valueOf: () => { newLog.push('coerce'); return .125; } };
  const values: [unknown, unknown][] = [[.1, .1], [false, false], [true, true], [null, null], [undefined, undefined], ['.25', '.25'], [a, b], [a, b], [.5, .5]];
  for (const [before, after] of values) { old.set(before); now.set(after); }
  const failure = new Error('Original native scalar refusal'), bad = { valueOf: (): number => { throw failure; } };
  expect(() => old.set(bad)).toThrow(failure); expect(() => now.set(bad)).toThrow(failure);
  for (const value of [1n, Symbol('invalid')]) { expect(() => old.set(value)).toThrow(TypeError); expect(() => now.set(value)).toThrow(TypeError); }
  old.set(.5); now.set(.5); old.set(.75); now.set(.75);
  expect(newLog).toEqual(oldLog); expect(now.uploads).toEqual(old.uploads);
});

test('float arrays retain the original direct native array path and complete payload', () => {
  const old = fixture(false, true), now = fixture(true, true), typed = new Float32Array([.1, .2, .3]);
  for (const value of [typed, [.5, .25, .125], typed]) { old.set(value); now.set(value); }
  expect(now.uploads).toEqual(old.uploads); expect(now.buffers[0]).toBe(typed);
});

test('an already-uploaded scalar retains its original first-use skip', () => {
  const old = fixture(false, false, .1), now = fixture(true, false, .1);
  old.set(.1); now.set(.1); expect(now.uploads).toHaveLength(1);
  old.set(.2); now.set(.2); expect(now.uploads).toEqual(old.uploads);
});
