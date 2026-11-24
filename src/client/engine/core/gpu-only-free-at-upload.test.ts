// QA 11-23-b row 17 (free at upload): a released channel that is the whole of its own buffer is detached in a microtask after
// its upload callback, so an upload wrapper still holding the array (vertexPack.ts defers a Float32 bufferData to the draw's
// vertexAttribPointer, or to the microtask it queued before the callback) uploads the real bytes. A held buffer (heldBytes.ts)
// and a view of part of a file are never detached.
import { expect, test } from 'vitest';
import { BufferAttribute, BufferGeometry } from 'three';
import { gpuOnlyAttributes } from './gpuOnly';
import { holdBytes } from './heldBytes';

function geometry(normal: Float32Array): { geometry: BufferGeometry; normal: BufferAttribute } {
  const attribute = new BufferAttribute(normal, 3);
  return { geometry: new BufferGeometry().setAttribute('position', new BufferAttribute(new Float32Array(9), 3)).setAttribute('normal', attribute), normal: attribute };
}

test('a whole-buffer channel is detached after a deferred upload queued before its callback', async () => {
  const bytes = new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0]), made = geometry(bytes);
  gpuOnlyAttributes(made.geometry, 'free-at-upload');
  let uploaded: number[] = [];
  queueMicrotask(() => { uploaded = Array.from(bytes); }); // vertexPack's flush, queued by its bufferData
  made.normal.onUploadCallback();
  expect(bytes.buffer.byteLength).toBe(36);
  await Promise.resolve();
  expect(uploaded).toEqual([0, 1, 0, 0, 1, 0, 0, 1, 0]);
  expect(bytes.buffer.byteLength).toBe(0);
});

test('held bytes and part-of-a-file views are left to the collector', async () => {
  const held = new Float32Array(9); holdBytes(held);
  const file = new ArrayBuffer(4096), part = new Float32Array(file, 64, 9);
  const a = geometry(held), b = geometry(part);
  gpuOnlyAttributes(a.geometry, 'free-at-upload'); gpuOnlyAttributes(b.geometry, 'free-at-upload');
  a.normal.onUploadCallback(); b.normal.onUploadCallback();
  await Promise.resolve();
  expect(held.buffer.byteLength).toBe(36); expect(file.byteLength).toBe(4096);
});
