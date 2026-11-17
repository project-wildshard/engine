// MEMORY-GATES MG10 (J410): channels read in place share their file's bytes (02aef688), so a kept channel that still viewed
// them held the whole file after every released channel went to the GPU. What gpuOnlyAttributes keeps gets its own bytes.
import { expect, test } from 'vitest';
import { BufferAttribute, BufferGeometry } from 'three';
import { gpuOnlyAttributes } from './gpuOnly';

function fileBacked(): { geometry: BufferGeometry; file: ArrayBuffer } {
  const file = new ArrayBuffer(4096);
  const position = new Float32Array(file, 0, 9), normal = new Float32Array(file, 64, 9), index = new Uint16Array(file, 1024, 3);
  position.set([0, 0, 0, 1, 0, 0, 0, 0, 1]); normal.set([0, 1, 0, 0, 1, 0, 0, 1, 0]); index.set([0, 1, 2]);
  const geometry = new BufferGeometry().setAttribute('position', new BufferAttribute(position, 3)).setAttribute('normal', new BufferAttribute(normal, 3));
  geometry.setIndex(new BufferAttribute(index, 1));
  return { geometry, file };
}

test('kept channels and the index stop viewing the file bytes; released ones still go on upload', () => {
  const { geometry, file } = fileBacked();
  expect(gpuOnlyAttributes(geometry, 'kept-bytes')).toBe(36);
  const position = geometry.getAttribute('position'), normal = geometry.getAttribute('normal');
  if (!(position instanceof BufferAttribute) || !(normal instanceof BufferAttribute) || geometry.index === null) throw new Error('Expected plain channels');
  expect(position.array.buffer).not.toBe(file); expect(position.array.buffer.byteLength).toBe(36);
  expect(Array.from(position.array)).toEqual([0, 0, 0, 1, 0, 0, 0, 0, 1]);
  expect(geometry.index.array.buffer).not.toBe(file); expect(Array.from(geometry.index.array)).toEqual([0, 1, 2]);
  expect(normal.array.buffer).toBe(file);
  normal.onUploadCallback(); expect(normal.array).toHaveLength(0);
});

test('nothing released: the kept channels keep viewing the file (no copy for nothing)', () => {
  const { geometry, file } = fileBacked();
  expect(gpuOnlyAttributes(geometry, 'kept-bytes', ['position', 'normal'])).toBe(0);
  expect(geometry.getAttribute('position').array.buffer).toBe(file); expect(geometry.index?.array.buffer).toBe(file);
});
