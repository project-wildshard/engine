import { expect, test } from 'vitest';
import { decode, encode, installVertexPack, packFormat, vertexPackStats, vertexPackWanted } from './vertexPack';

const ARRAY_BUFFER = 0x8892, STATIC = 0x88e4, DYNAMIC = 0x88e8;
const BYTE = 0x1400, UNSIGNED_BYTE = 0x1401, SHORT = 0x1402, UNSIGNED_SHORT = 0x1403, FLOAT = 0x1406;

/** a GL stand-in: each buffer's bytes, one program's attribute names, and the pointer calls by vertex array */
function fakeContext(attributes: readonly string[]) {
  const store = new Map<object, Uint8Array>(), bound = new Map<number, object | null>(), pointers: string[] = [];
  let vao: object | null = null;
  const bytes = (data: ArrayBufferView): Uint8Array => new Uint8Array(data.buffer, data.byteOffset, data.byteLength).slice();
  const gl = {
    bindBuffer: (target: number, buffer: object | null) => { bound.set(target, buffer); },
    deleteBuffer: (buffer: object | null) => { if (buffer !== null) store.delete(buffer); },
    bufferData: (target: number, data: ArrayBufferView, _usage?: number) => { const b = bound.get(target); if (b) store.set(b, bytes(data)); },
    bufferSubData: (target: number, offset: number, data: ArrayBufferView, _from?: number, _count?: number) => { const b = bound.get(target); if (b) store.get(b)?.set(bytes(data), offset); },
    getBufferSubData: (target: number, offset: number, data: ArrayBufferView) => {
      const from = store.get(bound.get(target) ?? {}) ?? new Uint8Array(0);
      new Uint8Array(data.buffer, data.byteOffset, data.byteLength).set(from.subarray(offset, offset + data.byteLength));
    },
    copyBufferSubData: () => undefined,
    vertexAttribPointer: (index: number, size: number, type: number, normalized: boolean, stride: number, offset: number) => {
      pointers.push(`${vao === null ? '-' : 'vao'} ${String(index)} ${String(size)}x${String(type)}${normalized ? 'n' : ''} stride ${String(stride)} at ${String(offset)}`);
    },
    vertexAttribIPointer: () => undefined,
    useProgram: (_program: object | null) => undefined,
    bindVertexArray: (array: object | null) => { vao = array; },
    deleteVertexArray: () => undefined,
    getProgramParameter: () => attributes.length,
    getActiveAttrib: (_program: object, i: number) => ({ name: attributes[i] }),
    getAttribLocation: (_program: object, name: string) => attributes.indexOf(name),
  };
  return { gl, store, pointers };
}

const floats = (values: readonly number[]): Float32Array => {
  // the pack leaves a channel shorter than 96 floats alone: repeat the values past that
  const out = new Float32Array(Math.ceil(96 / values.length) * values.length);
  for (let i = 0; i < out.length; i++) out[i] = values[i % values.length] ?? 0;
  return out;
};

test('the layout follows the channel name and its range; positions, instances and unknown ranges stay Float32', () => {
  expect(packFormat('normal', floats([0, 1, 0, 0.6, 0, -0.8]), 3)).toEqual({ type: BYTE, size: 3, lanes: 4, stride: 4 });
  expect(packFormat('color', floats([0.2, 0.5, 1, 0, 0.1, 0.3]), 3)).toEqual({ type: UNSIGNED_BYTE, size: 3, lanes: 4, stride: 4 });
  expect(packFormat('color', floats([1]), 3)).toEqual({ type: UNSIGNED_BYTE, size: 3, lanes: 4, stride: 4 });
  expect(packFormat('uv', floats([0, 0.25, 1, 0.75]), 2)).toEqual({ type: UNSIGNED_SHORT, size: 2, lanes: 2, stride: 4 });
  expect(packFormat('skinWeight', floats([1, 0, 0, 0, 0.5, 0.5, 0, 0]), 4)).toEqual({ type: UNSIGNED_SHORT, size: 4, lanes: 4, stride: 8 });
  expect(packFormat('aOff', floats([-0.5, 0.25, 1, -1]), 2)).toEqual({ type: SHORT, size: 2, lanes: 2, stride: 4 });
  expect(packFormat('uv', floats([-3, 0, 7, 1]), 2)).toBeNull();
  expect(packFormat('position', floats([0, 0.5, 1]), 3)).toBeNull();
  expect(packFormat('instanceColor', floats([0, 0.5, 1]), 3)).toBeNull();
  expect(packFormat('aSeed', floats([0.5]), 2)).toBeNull();
  expect(packFormat('color', floats([0]), 3)).toBeNull();
  expect(packFormat('aWind', floats([0.1, 0.2]), 1)).toBeNull();
  expect(packFormat('uv', floats([0, Number.NaN]), 2)).toBeNull();
});

test('packed values read back within the format step', () => {
  const source = [0, 1, -1, 0.5, -0.25, 0.123], f = packFormat('normal', floats(source), 3);
  if (f === null) throw new Error('no format');
  const { bytes, fits } = encode(f, 0, 2, source);
  expect(fits).toBe(true);
  expect(bytes.byteLength).toBe(8);
  const back: number[] = [];
  decode(f, bytes, 0, (e, value) => { back[e] = value; });
  back.forEach((value, i) => { expect(Math.abs(value - (source[i] ?? 0))).toBeLessThanOrEqual(0.5 / 127 + 1e-7); });
  expect(encode(f, 0, 1, [1.5, 1.5, 1.5]).fits).toBe(false);
});

test('a static channel uploads once, packed, when a draw names it; the position and an unread channel stay Float32', () => {
  const { gl, store, pointers } = fakeContext(['position', 'normal', 'uv']);
  const flushes: (() => void)[] = [];
  expect(installVertexPack(gl, () => true, flush => { flushes.push(flush); })).toBe(true);
  const positions = floats([0, 5, -3]), normals = floats([0, 1, 0]), uvs = floats([0.25, 0.75]);
  const pb = {}, nb = {}, ub = {}, program = {}, vao = {};
  gl.bindBuffer(ARRAY_BUFFER, pb); gl.bufferData(ARRAY_BUFFER, positions, STATIC);
  gl.bindBuffer(ARRAY_BUFFER, nb); gl.bufferData(ARRAY_BUFFER, normals, STATIC);
  gl.bindBuffer(ARRAY_BUFFER, ub); gl.bufferData(ARRAY_BUFFER, uvs, STATIC);
  // nothing is on the GPU until a draw points at it
  expect(store.size).toBe(0);
  gl.useProgram(program); gl.bindVertexArray(vao);
  gl.bindBuffer(ARRAY_BUFFER, pb); gl.vertexAttribPointer(0, 3, FLOAT, false, 12, 0);
  gl.bindBuffer(ARRAY_BUFFER, nb); gl.vertexAttribPointer(1, 3, FLOAT, false, 12, 0);
  expect(store.get(pb)?.byteLength).toBe(positions.byteLength);
  expect(store.get(nb)?.byteLength).toBe((normals.length / 3) * 4);
  expect([...(store.get(nb) ?? new Uint8Array(0)).subarray(0, 4)]).toEqual([0, 127, 0, 0]);
  expect(pointers).toEqual([`vao 0 3x${String(FLOAT)} stride 12 at 0`, `vao 1 3x${String(BYTE)}n stride 4 at 0`]);
  // the uv never drawn this task goes up as it came
  expect(store.has(ub)).toBe(false);
  flushes.forEach(flush => { flush(); });
  expect(store.get(ub)?.byteLength).toBe(uvs.byteLength);
  // a read back comes back as floats
  const back = new Float32Array(6);
  gl.bindBuffer(ARRAY_BUFFER, nb); gl.getBufferSubData(ARRAY_BUFFER, 12, back);
  expect([...back]).toEqual([0, 1, 0, 0, 1, 0]);
});

test('a later write packs in range and turns the buffer back to Float32 out of it, re-pointing its vertex arrays', () => {
  const { gl, store, pointers } = fakeContext(['color']);
  installVertexPack(gl, () => true, () => undefined);
  const colours = floats([0.5, 0.5, 0.5]), cb = {}, vao = {};
  gl.useProgram({}); gl.bindVertexArray(vao);
  gl.bindBuffer(ARRAY_BUFFER, cb); gl.bufferData(ARRAY_BUFFER, colours, STATIC);
  gl.vertexAttribPointer(0, 3, FLOAT, false, 0, 0);
  expect(store.get(cb)?.byteLength).toBe((colours.length / 3) * 4);
  colours[3] = 1; colours[4] = 0; colours[5] = 0.2;
  gl.bufferSubData(ARRAY_BUFFER, 12, colours, 3, 3);
  expect([...(store.get(cb) ?? new Uint8Array(0)).subarray(4, 8)]).toEqual([255, 0, 51, 0]);
  const reverted = vertexPackStats.reverted;
  colours[0] = 2;
  gl.bindVertexArray(null);
  gl.bufferSubData(ARRAY_BUFFER, 0, colours, 0, 3);
  expect(vertexPackStats.reverted).toBe(reverted + 1);
  const wide = new Float32Array((store.get(cb) ?? new Uint8Array(0)).slice().buffer);
  expect(wide.length).toBe(colours.length);
  expect([wide[0], wide[1], wide[3], wide[4]]).toEqual([2, 0.5, 1, 0]);
  expect(pointers.at(-1)).toBe(`vao 0 3x${String(FLOAT)} stride 12 at 0`);
});

test('dynamic, small, off or interleaved channels pass straight through', () => {
  const { gl, store, pointers } = fakeContext(['normal']);
  let on = false;
  installVertexPack(gl, () => on, () => undefined);
  const a = {}, b = {}, c = {}, d = {};
  gl.useProgram({});
  gl.bindBuffer(ARRAY_BUFFER, a); gl.bufferData(ARRAY_BUFFER, floats([0, 1, 0]), STATIC);
  expect(store.has(a)).toBe(true);
  on = true;
  gl.bindBuffer(ARRAY_BUFFER, b); gl.bufferData(ARRAY_BUFFER, floats([0, 1, 0]), DYNAMIC);
  gl.bindBuffer(ARRAY_BUFFER, c); gl.bufferData(ARRAY_BUFFER, new Float32Array([0, 1, 0]), STATIC);
  expect(store.has(b) && store.has(c)).toBe(true);
  gl.bindBuffer(ARRAY_BUFFER, d); gl.bufferData(ARRAY_BUFFER, floats([0, 1, 0, 1, 0, 0]), STATIC);
  gl.vertexAttribPointer(0, 3, FLOAT, false, 24, 0);
  expect(store.get(d)?.byteLength).toBe(96 * 4);
  expect(pointers).toEqual([`- 0 3x${String(FLOAT)} stride 24 at 0`]);
});

test('the switch is the phone tier unless debug.vertexPack holds false', () => {
  expect(vertexPackWanted(true, null)).toBe(true);
  expect(vertexPackWanted(true, false)).toBe(false);
  expect(vertexPackWanted(true, 'off')).toBe(false);
  expect(vertexPackWanted(false, true)).toBe(false);
});

test('the typed encode writes what the per-element DataView encode wrote, for every lane type and a shifted source', () => {
  // DW3 (mini-driftwood13e): the reference is the old closure and DataView loop
  const reference = (f: NonNullable<ReturnType<typeof packFormat>>, from: number, to: number, read: (e: number) => number): number[] => {
    const scale = { 0x1400: 127, 0x1401: 255, 0x1402: 32767, 0x1403: 65535 }[f.type], lo = f.type === 0x1400 || f.type === 0x1402 ? -1 : 0, out: number[] = [];
    for (let v = 0; v < to - from; v++) for (let c = 0; c < f.lanes; c++) {
      const value = c < f.size ? read((from + v) * f.size + c) : 0;
      out.push(Math.round(Math.min(1, Math.max(lo, Number.isFinite(value) ? value : 0)) * scale));
    }
    return out;
  };
  let seed = 7; const random = (): number => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const cases: [string, number, (x: number) => number][] = [['normal', 3, x => x * 2 - 1], ['color', 3, x => x], ['uv', 2, x => x], ['aSigned', 4, x => x * 2 - 1]];
  for (const [name, size, map] of cases) {
    const source = floats(Array.from({ length: size * 50 }, () => map(random())));
    const f = packFormat(name, source, size);
    if (f === null) throw new Error(`no format for ${name}`);
    const { bytes, fits } = encode(f, 3, 40, source);
    expect(fits).toBe(true);
    const words = f.stride / f.lanes === 2 ? (f.type === 0x1402 ? new Int16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2) : new Uint16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2))
      : (f.type === 0x1400 ? new Int8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength) : bytes);
    expect(Array.from(words)).toEqual(reference(f, 3, 40, e => source[e] ?? Number.NaN));
    const shifted = floats([9, 9, ...source]);
    expect(Array.from(encode(f, 3, 40, shifted, 2).bytes)).toEqual(Array.from(encode(f, 3, 40, source).bytes));
  }
});
