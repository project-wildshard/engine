import { expect, test } from 'vitest';
import { installByteTriples, markByteTriples, padTriples, unpadTriples } from './byteTriples';

const SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const CHROME = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const ARRAY_BUFFER = 0x8892, COPY_READ_BUFFER = 0x8f36, BYTE = 0x1400, FLOAT = 0x1406, STATIC = 0x88e4;

interface FakeGl {
  bindBuffer: (target: number, buffer: object | null) => void;
  deleteBuffer: (buffer: object | null) => void;
  bufferData: (target: number, data: ArrayBufferView, usage: number) => void;
  bufferSubData: (target: number, offset: number, data: ArrayBufferView) => void;
  getBufferSubData: (target: number, offset: number, data: ArrayBufferView) => void;
  vertexAttribPointer: (index: number, size: number, type: number, normalized: boolean, stride: number, offset: number) => void;
  vertexAttribIPointer: (index: number, size: number, type: number, stride: number, offset: number) => void;
}

/** a GL stand-in that keeps each buffer's bytes and logs the pointer calls */
function fakeContext(): { gl: FakeGl; store: Map<object, Uint8Array>; pointers: string[] } {
  const store = new Map<object, Uint8Array>(), bound = new Map<number, object | null>(), pointers: string[] = [];
  const bytes = (data: ArrayBufferView): Uint8Array => new Uint8Array(data.buffer, data.byteOffset, data.byteLength).slice();
  const gl: FakeGl = {
    bindBuffer: (target, buffer) => { bound.set(target, buffer); },
    deleteBuffer: (buffer) => { if (buffer !== null) store.delete(buffer); },
    bufferData: (target, data) => { const b = bound.get(target); if (b) store.set(b, bytes(data)); },
    bufferSubData: (target, offset, data) => { const b = bound.get(target); if (b) store.get(b)?.set(bytes(data), offset); },
    getBufferSubData: (target, offset, data) => {
      const from = store.get(bound.get(target) ?? {}) ?? new Uint8Array(0);
      new Uint8Array(data.buffer, data.byteOffset, data.byteLength).set(from.subarray(offset, offset + data.byteLength));
    },
    vertexAttribPointer: (index, size, type, _normalized, stride, offset) => { pointers.push(`${String(index)} ${String(size)}x${String(type)} stride ${String(stride)} at ${String(offset)}`); },
    vertexAttribIPointer: (index, size, type, stride, offset) => { pointers.push(`I${String(index)} ${String(size)}x${String(type)} stride ${String(stride)} at ${String(offset)}`); },
  };
  return { gl, store, pointers };
}

test('pad and unpad keep every vertex', () => {
  const tight = new Int8Array([1, -2, 3, 4, 5, -6]);
  const wide = padTriples(tight);
  expect([...wide]).toEqual([1, 254, 3, 0, 4, 5, 250, 0]);
  const back = new Uint8Array(6); unpadTriples(wide, back);
  expect([...new Int8Array(back.buffer)]).toEqual([...tight]);
  expect([...padTriples(tight, 1, 1)]).toEqual([4, 5, 250, 0]);
});

test('a marked byte channel uploads at stride 4 and reads back tight; other uploads are untouched', () => {
  const { gl, store, pointers } = fakeContext();
  expect(installByteTriples(gl, SAFARI)).toBe(true);
  const normals = new Int8Array([10, 20, 30, 40, 50, 60, 70, 80, 90]);
  expect(markByteTriples(normals)).toBe(true);
  const nb = {} as WebGLBuffer, fb = {} as WebGLBuffer;
  gl.bindBuffer(ARRAY_BUFFER, nb); gl.bufferData(ARRAY_BUFFER, normals, STATIC);
  expect([...store.get(nb) ?? []]).toEqual([10, 20, 30, 0, 40, 50, 60, 0, 70, 80, 90, 0]);
  gl.vertexAttribPointer(1, 3, BYTE, true, 3, 0);
  // a plain float channel and an unmarked byte channel keep their layout
  gl.bindBuffer(ARRAY_BUFFER, fb); gl.bufferData(ARRAY_BUFFER, new Float32Array(9), STATIC);
  gl.vertexAttribPointer(0, 3, FLOAT, false, 12, 0);
  gl.bufferData(ARRAY_BUFFER, new Int8Array(9), STATIC);
  gl.vertexAttribPointer(2, 3, BYTE, true, 3, 0);
  expect(pointers).toEqual([`1 3x${String(BYTE)} stride 4 at 0`, `0 3x${String(FLOAT)} stride 12 at 0`, `2 3x${String(BYTE)} stride 3 at 0`]);
  // a sub-range write lands padded, a read comes back tight (the Memory saver's restore)
  gl.bindBuffer(ARRAY_BUFFER, nb); gl.bufferSubData(ARRAY_BUFFER, 3, new Int8Array([1, 2, 3]));
  expect([...store.get(nb) ?? []]).toEqual([10, 20, 30, 0, 1, 2, 3, 0, 70, 80, 90, 0]);
  const read = new Int8Array(9);
  gl.bindBuffer(COPY_READ_BUFFER, nb); gl.getBufferSubData(COPY_READ_BUFFER, 0, read);
  expect([...read]).toEqual([10, 20, 30, 1, 2, 3, 70, 80, 90]);
  // a whole unmarked upload into the same buffer ends its padding
  gl.bindBuffer(ARRAY_BUFFER, nb); gl.bufferData(ARRAY_BUFFER, new Int8Array([7, 8, 9]), STATIC);
  gl.vertexAttribPointer(1, 3, BYTE, true, 3, 0);
  expect(pointers.at(-1)).toBe(`1 3x${String(BYTE)} stride 3 at 0`);
});

test('only tight three-byte arrays qualify', () => {
  expect(markByteTriples(new Float32Array(3))).toBe(false);
  expect(markByteTriples(new Uint8Array(4))).toBe(false);
  expect(markByteTriples(new Uint8Array(0))).toBe(false);
  expect(markByteTriples(new Uint8Array(6))).toBe(true);
});

test('Blink keeps its calls unwrapped', () => {
  const { gl } = fakeContext();
  const before = gl.bufferData;
  expect(installByteTriples(gl, CHROME)).toBe(false);
  expect(gl.bufferData).toBe(before);
});
