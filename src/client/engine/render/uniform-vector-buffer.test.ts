import { expect, test } from 'vitest';
import { Color, Vector3 } from 'three';
import { WebGLUniforms } from 'three/src/renderers/webgl/WebGLUniforms.js';
import type { WebGLProgram } from 'three/src/renderers/webgl/WebGLProgram.js';
import { installUniformCacheKinds } from './uniformCaches';

/** Actual Three uniform construction/setters over a recorder of native float32
 * uploads. Each call records a copy, so reuse cannot overwrite its predecessor. */
function fixture(buffered: boolean, array = false) {
  const uploads: number[][] = [], buffers: Float32Array[] = [];
  const location: unknown = {}, program: unknown = {};
  const native: unknown = {
    ACTIVE_UNIFORMS: 0x8b86,
    getProgramParameter: () => 1,
    getActiveUniform: () => ({ name: array ? 'value[0]' : 'value', type: 0x8b51, size: array ? 2 : 1 }),
    getUniformLocation: () => location,
    uniform3f: (addr: unknown, x: number, y: number, z: number) => {
      expect(addr).toBe(location); uploads.push([Math.fround(x), Math.fround(y), Math.fround(z)]);
    },
    uniform3fv: (addr: unknown, value: Float32Array | number[]) => {
      expect(addr).toBe(location); uploads.push(Array.from(value, Math.fround));
      if (value instanceof Float32Array) buffers.push(value);
    },
  };
  const gl = native as WebGLRenderingContext;
  const uniforms = new WebGLUniforms(gl, program as WebGLProgram);
  if (buffered) {
    const target = { getUniforms: () => uniforms };
    installUniformCacheKinds({ info: { programs: [target] } }); target.getUniforms();
  }
  const setter: unknown = Reflect.get(uniforms, 'setValue');
  if (typeof setter !== 'function') throw new Error('Missing native Three setter');
  return { uploads, buffers, set: (value: unknown) => { Reflect.apply(setter, uniforms, [gl, 'value', value]); } };
}

test('buffered native vector/color uploads retain every original float32 value and cache skip', () => {
  const before = fixture(false), after = fixture(true);
  const values = [new Vector3(0.1, -0.2, 0.3), new Vector3(0.1, -0.2, 0.3),
    new Color().setRGB(0.125, 0.5, 0.875), new Color().setRGB(0.125, 0.5, 0.875),
    new Vector3(-0, 0, Number.MIN_VALUE), new Vector3(1 + Number.EPSILON, 1e30, -1e30),
    new Vector3(Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY),
    new Vector3(Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY)];
  for (const value of values) { before.set(value); after.set(value); }
  expect(after.uploads).toEqual(before.uploads);
  expect(after.uploads).toHaveLength(6);
  expect(after.buffers).toHaveLength(6);
  expect(new Set(after.buffers).size).toBe(1);
});

test('array/vector transitions keep the actual native length and unrounded double cache', () => {
  const before = fixture(false), after = fixture(true);
  const values = [new Vector3(0.1, 0.2, 0.3), [0.1, 0.2, 0.3], new Float32Array([0.1, 0.2, 0.3]),
    new Vector3(0.1, 0.2, 0.3), [0.1, 0.2], [0.1, 0.2, 0.3, 0.4], new Vector3(0.1, 0.2, 0.3),
    [0.1, 0.2, 0.3], [0.1, 0.2, 0.3], new Vector3(0.1 + Number.EPSILON, 0.2, 0.3)];
  for (const value of values) { before.set(value); after.set(value); }
  expect(after.uploads).toEqual(before.uploads);
  // The native array setter retains its input and validation path.
  expect(after.buffers.some(buffer => buffer === values[2])).toBe(true);
});

test('pure vector arrays keep native flattening and their complete upload', () => {
  const before = fixture(false, true), after = fixture(true, true);
  for (const value of [[new Vector3(0.1, 0.2, 0.3), new Vector3(0.4, 0.5, 0.6)],
    new Float32Array([0.1, 0.2, 0.3, 0.4, 0.5, 0.6])]) {
    before.set(value); after.set(value);
  }
  expect(after.uploads).toEqual(before.uploads);
  expect(after.uploads[0]).toHaveLength(6);
});

test('incomplete vector values keep native cache and upload behavior across numeric values', () => {
  const before = fixture(false), after = fixture(true);
  for (const value of [new Vector3(0.1, 0.2, 0.3), { x: 1 }, { x: 1 }, { r: 0.2, g: 0.3 },
    new Vector3(0.1, 0.2, 0.3), new Vector3(0.1, 0.2, 0.3)]) {
    before.set(value); after.set(value);
  }
  expect(after.uploads).toEqual(before.uploads);
});
