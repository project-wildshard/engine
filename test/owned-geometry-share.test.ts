import { expect, test } from 'vitest';
import { BufferAttribute, BufferGeometry, Float16BufferAttribute, InterleavedBuffer, InterleavedBufferAttribute } from 'three';
import { createOwnedGeometry, shareOwnedGeometry } from '../src/client/engine/models/ownedGeometry';

// MG11 (mini-webcontent2): a draw-only view over an owned template shares its arrays, never its attribute objects.
const shell = (): BufferGeometry => {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0]), 3));
  g.setAttribute('color', new BufferAttribute(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]), 3, true));
  g.setIndex(new BufferAttribute(new Uint16Array([0, 1, 2, 2, 1, 3]), 1));
  g.addGroup(0, 6, 0); g.computeBoundingBox();
  return g;
};

test('a shared view reads the template arrays through its own attributes', async () => {
  const intake = createOwnedGeometry('fixture.glb'), template = shell();
  intake.adopt(template);
  const view = intake.share?.();
  expect(view).toBeInstanceOf(BufferGeometry);
  if (view === undefined) return;
  for (const name of ['position', 'color']) {
    expect(view.getAttribute(name)).not.toBe(template.getAttribute(name));
    expect(view.getAttribute(name).array).toBe(template.getAttribute(name).array);
    expect(view.getAttribute(name).normalized).toBe(template.getAttribute(name).normalized);
  }
  expect(view.getIndex()).not.toBe(template.getIndex());
  expect(view.getIndex()?.array).toBe(template.getIndex()?.array);
  expect(view.groups).toEqual(template.groups);
  expect(view.boundingBox?.equals(template.boundingBox ?? view.boundingBox)).toBe(true);
  expect(view.boundingBox).not.toBe(template.boundingBox);
  // a view's CPU copy going after upload leaves the template whole
  Object.assign(view.getAttribute('position'), { array: new Float32Array(0) });
  expect(template.getAttribute('position').array.length).toBe(12);
  // the template is still the loader's: a deep copy stays available
  expect(intake.copy().getAttribute('position').array).not.toBe(template.getAttribute('position').array);
});

test('storage a view cannot share falls back to undefined', () => {
  const half = shell(); half.setAttribute('normal', new Float16BufferAttribute(new Uint16Array(12), 3));
  expect(shareOwnedGeometry(half)).toBeUndefined();
  const interleaved = shell(); interleaved.setAttribute('uv', new InterleavedBufferAttribute(new InterleavedBuffer(new Float32Array(8), 2), 2, 0));
  expect(shareOwnedGeometry(interleaved)).toBeUndefined();
  const morphed = shell(); morphed.morphAttributes['position'] = [new BufferAttribute(new Float32Array(12), 3)];
  expect(shareOwnedGeometry(morphed)).toBeUndefined();
  const released = shell(), position = released.getAttribute('position');
  Object.defineProperty(position, 'array', { configurable: true, get: () => new Float32Array(12) });
  expect(shareOwnedGeometry(released)).toBeUndefined();
});
