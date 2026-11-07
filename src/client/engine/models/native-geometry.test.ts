import { expect, test } from 'vitest';
import { BufferAttribute, BufferGeometry, InterleavedBuffer, InterleavedBufferAttribute, Mesh, type TypedArray } from 'three';
import { admitNativeWholeGeometry, nativeWholeGeometry, restoreDrawnChannels } from './nativeGeometry';

const constructors = [Float32Array, Uint16Array, Uint32Array, Int16Array, Int8Array, Uint8Array];
const bytes = (array: TypedArray): Uint8Array => new Uint8Array(array.buffer, array.byteOffset, array.byteLength);

test('drawn custom-channel intake keeps missing, width, normalization and storage refusals', () => {
  for (const mode of ['missing', 'width', 'normalized', 'storage'] as const) {
    const geometry = new BufferGeometry().setAttribute('position', new BufferAttribute(new Float32Array(9), 3));
    const mesh = new Mesh(geometry);
    mesh.userData['nativeAttributes'] = { aFace: { semantic: '_AFACE', storage: 'Float32Array', itemSize: 4, normalized: false } };
    if (mode !== 'missing') geometry.setAttribute('_aface', mode === 'storage'
      ? new BufferAttribute(new Uint16Array(12), 4) : new BufferAttribute(new Float32Array(12), mode === 'width' ? 3 : 4, mode === 'normalized'));
    expect(() => restoreDrawnChannels(mesh)).toThrow(mode === 'storage' ? 'storage mismatch' : 'missing typed channel');
    expect(geometry.hasAttribute('aFace')).toBe(false); geometry.dispose();
  }
  const mesh = new Mesh(new BufferGeometry().setAttribute('_aface', new BufferAttribute(new Float32Array(12), 4)));
  restoreDrawnChannels(mesh);
  expect(mesh.geometry.hasAttribute('_aface')).toBe(true); expect(mesh.geometry.hasAttribute('aFace')).toBe(false);
  mesh.geometry.dispose();
});

test('packed and padded native channels retain the original copy bits', () => {
  for (const Constructor of constructors) for (const size of [1, 2, 3, 4]) for (const padding of [0, 1, 3]) for (const normalized of [false, true]) {
    const stride = size + padding, offset = padding === 0 ? 0 : 1;
    const source = new Constructor(stride * 17);
    for (let i = 0; i < source.length; i++) source[i] = i % 5 === 0 ? -0 : (i * 731 - 193) / 17;
    const original = source.slice(), expected = new Constructor(17 * size);
    // Retain the previous general copy as an independent channel oracle.
    for (let i = 0; i < 17; i++) for (let c = 0; c < size; c++) expected[i * size + c] = source[i * stride + offset + c] ?? 0;
    const geometry = new BufferGeometry(), attribute = new InterleavedBufferAttribute(new InterleavedBuffer(source, stride), size, offset, normalized);
    geometry.setAttribute('position', attribute); geometry.setIndex([0, 1, 2]);
    const mesh = new Mesh(geometry);
    mesh.userData['nativeAttributes'] = { position: { semantic: 'POSITION', storage: Constructor.name, itemSize: size, normalized } };
    for (const ownership of ['borrow', 'take'] as const) {
      const result = nativeWholeGeometry(mesh, ownership), restored = result.getAttribute('position');
      expect(restored).toBeInstanceOf(BufferAttribute);
      expect(restored.array.constructor).toBe(Constructor); expect(restored.normalized).toBe(normalized);
      expect(bytes(restored.array)).toEqual(bytes(expected)); expect(bytes(source)).toEqual(bytes(original));
      expect(restored.array.buffer).not.toBe(source.buffer); expect(result.getIndex()?.array).toEqual(geometry.getIndex()?.array);
      result.dispose();
    }
    geometry.dispose();
  }
});

test('native channel copying retains missing-channel and metadata refusals', () => {
  const mesh = new Mesh(new BufferGeometry());
  mesh.userData['nativeAttributes'] = { position: { semantic: 'POSITION', storage: 'Float32Array', itemSize: 3, normalized: false } };
  expect(() => nativeWholeGeometry(mesh)).toThrow('missing typed channel');
  mesh.geometry.setAttribute('position', new BufferAttribute(new Uint16Array(9), 3));
  expect(() => nativeWholeGeometry(mesh)).toThrow('storage mismatch');
  mesh.userData['nativeAttributes'] = { position: { semantic: 'POSITION', storage: 'Uint16Array', itemSize: 5, normalized: false } };
  expect(() => nativeWholeGeometry(mesh)).toThrow(); mesh.geometry.dispose();
});

test('one restoration returns its detached admitted metadata and rechecks the next call', () => {
  const geometry = new BufferGeometry().setAttribute('position', new BufferAttribute(new Float32Array([0, -0, 0, 1, 0, 0, 0, 1, 0]), 3));
  const mesh = new Mesh(geometry), channel = { semantic: 'POSITION', storage: 'Float32Array', itemSize: 3, normalized: false };
  let reads = 0;
  Object.defineProperty(mesh.userData, 'nativeAttributes', { get: () => { reads++; return { position: channel }; } });
  const admitted = admitNativeWholeGeometry(mesh);
  try {
    expect(reads).toBe(1); expect(admitted.channels).toEqual({ position: channel });
    expect(bytes(admitted.geometry.getAttribute('position').array)).toEqual(bytes(geometry.getAttribute('position').array));
    expect(admitted.channels['position']).not.toBe(channel);
    channel.itemSize = 5;
    expect(admitted.channels['position']?.itemSize).toBe(3);
    expect(() => admitNativeWholeGeometry(mesh)).toThrow(); expect(reads).toBe(2);
  } finally { admitted.geometry.dispose(); geometry.dispose(); }
});
