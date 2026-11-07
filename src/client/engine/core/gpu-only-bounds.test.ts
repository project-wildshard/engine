import { expect, test, vi } from 'vitest';
import { Box3, BufferAttribute, BufferGeometry, DynamicDrawUsage, Float16BufferAttribute, InterleavedBuffer, InterleavedBufferAttribute, Sphere, Vector3 } from 'three';
import { gpuOnlyAttributes } from './gpuOnly';

function ordinaryBounds(shape: BufferGeometry): void {
  if (shape.boundingBox === null) shape.computeBoundingBox();
  if (shape.boundingSphere === null) shape.computeBoundingSphere();
}

test.each(['neither', 'box', 'sphere', 'both'])('static upload keeps native bounds and existing %s identities', existing => {
  const positions = new Float32Array(32769 * 3);
  for (let i = 0; i < positions.length; i++) positions[i] = Math.sin(i) * 100;
  positions[0] = -0;
  const shape = new BufferGeometry(), position = new BufferAttribute(positions, 3);
  const normal = new BufferAttribute(new Float32Array(positions.length).fill(0.5), 3);
  const dynamic = new BufferAttribute(new Float32Array(positions.length), 3).setUsage(DynamicDrawUsage);
  shape.setAttribute('position', position); shape.setAttribute('normal', normal); shape.setAttribute('moving', dynamic); shape.setIndex([0, 1, 2]);
  if (existing === 'box' || existing === 'both') shape.boundingBox = new Box3(new Vector3(-999, -888, -777), new Vector3(999, 888, 777));
  if (existing === 'sphere' || existing === 'both') shape.boundingSphere = new Sphere(new Vector3(3, 4, 5), 789);
  const expected = shape.clone(), box = shape.boundingBox, sphere = shape.boundingSphere, original = positions.slice(), index = shape.index;
  try {
    ordinaryBounds(expected);
    expect(gpuOnlyAttributes(shape, 'bounds contract')).toBe(normal.array.byteLength);
    expect(shape.boundingBox).toEqual(expected.boundingBox); expect(shape.boundingSphere).toEqual(expected.boundingSphere);
    if (box !== null) expect(shape.boundingBox).toBe(box);
    if (sphere !== null) expect(shape.boundingSphere).toBe(sphere);
    normal.onUploadCallback(); dynamic.onUploadCallback(); position.onUploadCallback();
    expect(normal.array.byteLength).toBe(0); expect(normal.count).toBe(position.count);
    expect(position.array).toBe(positions); expect(positions).toEqual(original);
    expect(dynamic.array.byteLength).toBe(positions.byteLength); expect(shape.index).toBe(index);
  } finally { shape.dispose(); expected.dispose(); }
});

test.each(['normalized', 'half', 'interleaved', 'morph', 'missing'])('static upload retains native %s bounds fallback', kind => {
  const shape = new BufferGeometry();
  if (kind === 'normalized') shape.setAttribute('position', new BufferAttribute(new Int16Array([-32768, 1, 9, 32767, -99, 7]), 3, true));
  else if (kind === 'half') shape.setAttribute('position', new Float16BufferAttribute([0, 0x3c00, 0x4000, 0xbc00, 0x4200, 0], 3));
  else if (kind === 'interleaved') shape.setAttribute('position', new InterleavedBufferAttribute(new InterleavedBuffer(new Float32Array([99, -1, 2, 3, 99, 4, -5, 6]), 4), 3, 1));
  else if (kind === 'morph') {
    shape.setAttribute('position', new BufferAttribute(new Float32Array([-1, 2, 3, 4, -5, 6]), 3));
    shape.morphAttributes.position = [new BufferAttribute(new Float32Array([-10, 20, 30, 40, -50, 60]), 3)];
    shape.morphTargetsRelative = true;
  }
  const expected = shape.clone();
  try {
    ordinaryBounds(expected); gpuOnlyAttributes(shape, 'fallback contract');
    expect(shape.boundingBox).toEqual(expected.boundingBox); expect(shape.boundingSphere).toEqual(expected.boundingSphere);
  } finally { shape.dispose(); expected.dispose(); }
});

test.each([Number.NaN, Infinity, -Infinity])('invalid packed coordinate %s preserves bounds and diagnostic order', value => {
  const shape = new BufferGeometry();
  shape.setAttribute('position', new BufferAttribute(new Float32Array([value, 1, 2, 3, 4, 5]), 3));
  const expected = shape.clone(), errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  try {
    ordinaryBounds(expected); const messages = errors.mock.calls.map((call: readonly unknown[]) => call[0]); errors.mockClear();
    gpuOnlyAttributes(shape, 'invalid contract');
    expect(errors.mock.calls.map((call: readonly unknown[]) => call[0])).toEqual(messages);
    expect(shape.boundingBox).toEqual(expected.boundingBox); expect(shape.boundingSphere).toEqual(expected.boundingSphere);
  } finally { errors.mockRestore(); shape.dispose(); expected.dispose(); }
});

test('custom geometry methods and attribute readers retain their original calls', () => {
  const calls: string[] = [];
  class CustomGeometry extends BufferGeometry {
    override computeBoundingBox(): void { calls.push('box'); super.computeBoundingBox(); }
    override computeBoundingSphere(): void { calls.push('sphere'); super.computeBoundingSphere(); }
  }
  class CustomPosition extends BufferAttribute {
    override getX(index: number): number { calls.push(`x:${String(index)}`); return super.getX(index); }
  }
  class CustomAttributeLookup extends BufferGeometry {
    override getAttribute(name: string): BufferAttribute | InterleavedBufferAttribute { calls.push(`attribute:${name}`); return super.getAttribute(name); }
  }
  for (const shape of [new CustomGeometry(), new CustomAttributeLookup(), new BufferGeometry()]) {
    shape.setAttribute('position', new CustomPosition(new Float32Array([-1, 2, 3, 4, -5, 6]), 3));
    try {
      ordinaryBounds(shape); const expected = [...calls]; calls.length = 0;
      shape.boundingBox = null; shape.boundingSphere = null;
      gpuOnlyAttributes(shape, 'custom contract');
      expect(calls).toEqual(expected); calls.length = 0;
    } finally { shape.dispose(); }
  }
});
