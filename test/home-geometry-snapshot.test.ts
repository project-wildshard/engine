import { expect, test } from 'vitest';
import { Box3, BufferAttribute, BufferGeometry, Float16BufferAttribute, InterleavedBuffer, InterleavedBufferAttribute, Matrix4, Sphere, Vector3 } from 'three';
import { homeGeometryBytes, restoreHomeGeometry, snapshotHomeGeometry } from '../src/client/game/shardfile/homeGeometrySnapshot';

test('a structured clone restores all native words, half semantics, topology, transforms and bounds', () => {
  const geometry = new BufferGeometry();
  // Include signed zero, non-canonical NaN payloads and a nontrivial half-float channel.
  const positions = new Float32Array(new Uint32Array([0x80000000, 0x7fc12345, 0x3f800000, 0, 0, 0, 0x3f800000, 0, 0]).buffer);
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('aPat', new Float16BufferAttribute(new Uint16Array([0x3800, 0x3c00, 0x4000]), 1));
  geometry.setAttribute('color', new BufferAttribute(new Uint8Array([128, 19, 255, 0, 1, 2, 3, 4, 5]), 3, true));
  geometry.setIndex(new BufferAttribute(new Uint32Array([2, 0, 1]), 1));
  geometry.name = 'exact draw'; geometry.addGroup(0, 3, 2); geometry.setDrawRange(0, Infinity);
  geometry.boundingBox = new Box3(new Vector3(-0, -3, -4), new Vector3(1.1234567891234, 2, 3));
  geometry.boundingSphere = new Sphere(new Vector3(-0, 2, 3), 7.1234567891234);
  const matrix = new Matrix4().makeTranslation(-0, 1.1234567891234, 3), source = new Map([['draw', { geometry, matrix }]]);
  const snapshot = snapshotHomeGeometry(source); if (snapshot === null) throw new Error('Missing supported snapshot');
  const clone: unknown = structuredClone(snapshot);
  // The real durable boundary structured-clones typed buffers, not JSON numbers.
  const restored = restoreHomeGeometry(structuredClone(snapshot)), view = restored.get('draw');
  if (view === undefined) throw new Error('Missing restored draw');
  expect(clone).toBeDefined();
  for (const [name, attribute] of Object.entries(geometry.attributes)) {
    const actual: unknown = view.geometry.getAttribute(name);
    if (!(actual instanceof BufferAttribute)) throw new Error('Missing plain native attribute');
    expect(new Uint8Array(actual.array.buffer)).toEqual(new Uint8Array(attribute.array.buffer));
    expect(actual.array.buffer).not.toBe(attribute.array.buffer);
    expect(actual.normalized).toBe(attribute.normalized); expect(actual.itemSize).toBe(attribute.itemSize);
  }
  expect(view.geometry.getAttribute('aPat')).toBeInstanceOf(Float16BufferAttribute);
  expect(view.geometry.getAttribute('aPat').getX(0)).toBe(0.5);
  expect(view.geometry.getIndex()?.array).toEqual(geometry.getIndex()?.array);
  expect(view.geometry.boundingBox).toEqual(geometry.boundingBox); expect(view.geometry.boundingSphere).toEqual(geometry.boundingSphere);
  expect(view.geometry.groups).toEqual(geometry.groups); expect(view.geometry.drawRange).toEqual(geometry.drawRange);
  expect(view.matrix.elements).toEqual(matrix.elements); expect(view.geometry.name).toBe(geometry.name);
  expect(homeGeometryBytes(snapshot)).toBeGreaterThan(positions.byteLength);
  view.geometry.dispose(); geometry.dispose();
});

test('custom, interleaved and morph geometry refuses this cache and keeps the original build path', () => {
  const geometry = new BufferGeometry(), matrix = new Matrix4(), source = new Map([['draw', { geometry, matrix }]]);
  geometry.setAttribute('position', new InterleavedBufferAttribute(new InterleavedBuffer(new Float32Array(9), 3), 3, 0));
  expect(snapshotHomeGeometry(source)).toBeNull();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(9), 3));
  geometry.morphAttributes.position = [new BufferAttribute(new Float32Array(9), 3)];
  expect(snapshotHomeGeometry(source)).toBeNull(); delete geometry.morphAttributes.position;
  geometry.userData['custom'] = 'keep original'; expect(snapshotHomeGeometry(source)).toBeNull(); geometry.dispose();
});
