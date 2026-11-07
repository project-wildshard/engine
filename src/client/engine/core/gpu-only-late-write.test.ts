import { afterEach, expect, test, vi } from 'vitest';
import { BufferAttribute, BufferGeometry } from 'three';
import { gpuOnlyAttributes } from './gpuOnly';

afterEach(() => { vi.restoreAllMocks(); });

test('QS1: a write after the CPU copy went is dropped and named once, never a version bump over the empty array', () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  const geometry = new BufferGeometry();
  const position = new BufferAttribute(new Float32Array(9), 3);
  geometry.setAttribute('position', position);
  const color = new BufferAttribute(new Float32Array(9), 3);
  geometry.setAttribute('color', color);
  gpuOnlyAttributes(geometry, 'fixture.ground');
  // three's upload: WebGLAttributes.createBuffer records the size, then calls onUploadCallback
  const uploadedBytes = color.array.byteLength;
  color.onUploadCallback();
  expect(color.array.length).toBe(0);
  const version = color.version;
  color.needsUpdate = true; color.needsUpdate = true;
  // three's WebGLAttributes.update compares sizes only when the version moved: it stays put, so the draw goes on
  expect(color.version).toBe(version);
  expect(uploadedBytes).toBe(36);
  expect(warn).toHaveBeenCalledOnce();
  expect(String(warn.mock.calls[0]?.[0])).toContain('fixture.ground.color');
  // the kept attribute is untouched: its writes still upload
  const before = position.version;
  position.needsUpdate = true;
  expect(position.version).toBe(before + 1);
});
