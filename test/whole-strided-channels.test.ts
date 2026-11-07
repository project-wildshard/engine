import { BufferAttribute, BufferGeometry, InterleavedBuffer, InterleavedBufferAttribute, Matrix4, Mesh } from 'three';
import { expect, test, vi } from 'vitest';
import { assembleWholeGeometryViews } from '../src/client/game/plugin/geometry';

const positions = [[0, 0, 0], [8, 0, 0], [0, 4, 0], [8, 4, 0]];
function partition(vertices: number[], triangle: number, gridded: boolean): Mesh {
  const geometry = new BufferGeometry(), integers = new Int16Array(vertices.length * 4), paint = new Uint8Array(vertices.length * 8), uv = new Float32Array(vertices.length * 4);
  for (const [local, vertex] of vertices.entries()) {
    integers.set(positions[vertex] ?? [], local * 4); integers[local * 4 + 3] = -1234;
    paint.set([239, vertex * 30, 42, 255, 77, 91, 17, 83], local * 8);
    uv.set([777, vertex / 4, -vertex / 8, 888], local * 4);
  }
  geometry.setAttribute('position', new InterleavedBufferAttribute(new InterleavedBuffer(integers, 4), 3, 0));
  geometry.setAttribute('color', new InterleavedBufferAttribute(new InterleavedBuffer(paint, 8), 4, 1, true));
  geometry.setAttribute('uv', new InterleavedBufferAttribute(new InterleavedBuffer(uv, 4), 2, 1));
  geometry.setAttribute('_half', new BufferAttribute(new Uint16Array(vertices.flatMap(vertex => [0x3c00 + vertex, 0x8000])), 2));
  geometry.setIndex([0, 1, 2]);
  const node = new Mesh(geometry);
  node.userData['nativeAttributes'] = {
    position: { semantic: 'POSITION', storage: 'Int16Array', normalized: false, itemSize: 3 },
    color: { semantic: 'COLOR_0', storage: 'Uint8Array', normalized: true, itemSize: 4 },
    uv: { semantic: 'TEXCOORD_0', storage: 'Float32Array', normalized: false, itemSize: 2 },
    half: { semantic: '_HALF', storage: 'Float16Array', normalized: false, itemSize: 2 },
  };
  node.userData['matrix64'] = new Matrix4().makeTranslation(3, 7, -8).elements;
  node.userData['wholePartition'] = { id: 'source', vertices, triangles: [triangle], vertexCount: 4, indexCount: 6, index: 'u16',
    ...(gridded ? { grid: { origin: [0.125, -1.75, 4.25], step: 0.0625 } } : {}) };
  return node;
}
function facts(geometry: BufferGeometry): unknown {
  return { attributes: Object.fromEntries(Object.entries(geometry.attributes).map(([name, attribute]) => [name, {
    storage: attribute.array.constructor.name, size: attribute.itemSize, normalized: attribute.normalized,
    bytes: new Uint8Array(attribute.array.buffer, attribute.array.byteOffset, attribute.array.byteLength),
  }])), index: geometry.index?.array, box: geometry.boundingBox, sphere: geometry.boundingSphere };
}

test.each([false, true])('owned strided assembly matches the complete borrowed result (grid=%s)', gridded => {
  const nodes = [partition([0, 1, 2], 0, gridded), partition([1, 3, 2], 1, gridded)];
  const originals = nodes.map(node => ({ attributes: { ...node.geometry.attributes }, words: facts(node.geometry) }));
  const borrowed = assembleWholeGeometryViews(nodes), owned = assembleWholeGeometryViews(nodes, 'take');
  try {
    const before = borrowed.get('source'), after = owned.get('source');
    if (before === undefined || after === undefined) throw new Error('Missing assembled source');
    expect(facts(after.geometry)).toEqual(facts(before.geometry)); expect(after.matrix).toEqual(before.matrix);
    for (const [index, node] of nodes.entries()) {
      const original = originals[index]; if (original === undefined) throw new Error('Missing original');
      expect(facts(node.geometry)).toEqual(original.words);
      for (const [name, attribute] of Object.entries(original.attributes)) expect(node.geometry.getAttribute(name)).toBe(attribute);
    }
  } finally {
    for (const view of [...borrowed.values(), ...owned.values()]) view.geometry.dispose();
    for (const node of nodes) node.geometry.dispose();
  }
});

test.each(['borrow', 'take'] as const)('strided shared vertices still refuse conflicting bytes (%s)', ownership => {
  const first = partition([0, 1, 2], 0, true), second = partition([1, 3, 2], 1, true);
  second.geometry.getAttribute('color').setX(0, 0);
  expect(() => assembleWholeGeometryViews([first, second], ownership)).toThrow('shared vertex differs');
  first.geometry.dispose(); second.geometry.dispose();
});


test.each(['borrow', 'take'] as const)('grid restoration writes final Float32 ordinals once and keeps rounded sharing (%s)', ownership => {
  const nodes = [partition([0, 1, 2], 0, true), partition([1, 3, 2], 1, true)];
  // Different double-precision grid results that round to the same original
  // Float32 vertex remain legal, exactly as the former temporary attribute.
  const second = nodes[1]; if (second === undefined) throw new Error('Missing shared grid node');
  second.userData['wholePartition'] = { id: 'source', vertices: [1, 3, 2], triangles: [1], vertexCount: 4, indexCount: 6, index: 'u16',
    grid: { origin: [0.125, -1.75, 4.25], step: 0.0625000001 } };
  const expected = Float32Array.from(positions.flatMap(point => [(point[0] ?? 0) * 0.0625 + 0.125, (point[1] ?? 0) * 0.0625 - 1.75, (point[2] ?? 0) * 0.0625 + 4.25]));
  const originals = nodes.map(node => facts(node.geometry)), assigned = vi.spyOn(BufferGeometry.prototype, 'setAttribute');
  const result = assembleWholeGeometryViews(nodes, ownership);
  try {
    const view = result.get('source'), position: unknown = view?.geometry.getAttribute('position');
    if (!(position instanceof BufferAttribute)) throw new Error('Missing restored positions');
    expect(result.size).toBe(1);
    expect(new Uint8Array(position.array.buffer, position.array.byteOffset, position.array.byteLength)).toEqual(new Uint8Array(expected.buffer));
    expect(position.normalized).toBe(false); expect(position.itemSize).toBe(3);
    expect(view?.geometry.index?.array).toEqual(Uint16Array.from([0, 1, 2, 1, 3, 2]));
    expect(view?.matrix).toEqual(new Matrix4().makeTranslation(3, 7, -8));
    const floats = assigned.mock.calls.filter(([name, attribute]) => name === 'position' && attribute instanceof BufferAttribute && attribute.array instanceof Float32Array);
    expect(floats).toHaveLength(1); // The final output, with no per-partition temporary.
    expect(nodes.map(node => facts(node.geometry))).toEqual(originals);
  } finally {
    assigned.mockRestore(); for (const view of result.values()) view.geometry.dispose(); for (const node of nodes) node.geometry.dispose();
  }
});

test.each(['borrow', 'take'] as const)('different restored shared grid words still refuse (%s)', ownership => {
  const first = partition([0, 1, 2], 0, true), second = partition([1, 3, 2], 1, true);
  second.userData['wholePartition'] = { id: 'source', vertices: [1, 3, 2], triangles: [1], vertexCount: 4, indexCount: 6, index: 'u16',
    grid: { origin: [0.125, -1.75, 4.25], step: 0.125 } };
  try { expect(() => assembleWholeGeometryViews([first, second], ownership)).toThrow('Whole shared vertex differs'); }
  finally { first.geometry.dispose(); second.geometry.dispose(); }
});

test.each(['storage', 'normalized', 'width'] as const)('invalid grid %s still refuses and disposes only temporary input', mode => {
  const node = partition([0, 1, 2], 0, true), storage = mode === 'storage' ? 'Float32Array' : 'Int16Array';
  const width = mode === 'width' ? 4 : 3, normalized = mode === 'normalized';
  node.geometry.setAttribute('position', new BufferAttribute(mode === 'storage' ? new Float32Array(12) : new Int16Array(12), width, normalized));
  node.userData['nativeAttributes'] = { position: { semantic: 'POSITION', storage, normalized, itemSize: width } };
  const before = facts(node.geometry), disposed = vi.spyOn(BufferGeometry.prototype, 'dispose');
  try {
    expect(() => assembleWholeGeometryViews([node], 'take')).toThrow('Whole grid needs Int16 positions');
    expect(disposed.mock.contexts).toHaveLength(1);
    expect(disposed.mock.contexts[0]).not.toBe(node.geometry);
    expect(facts(node.geometry)).toEqual(before);
  } finally { disposed.mockRestore(); node.geometry.dispose(); }
});


test.each(['borrow', 'take'] as const)('signed grid extremes retain the original Float32 write boundary (%s)', ownership => {
  const samples = [[-32768, -1, 32767], [12, 0, -23], [-237, 32767, 100], [32767, -32768, 5]] as const;
  const ordinals = [[0, 1, 2], [1, 3, 2]], origin = [0.1000000000003, -1 / 3, 4.25000000000001] as const;
  const step = 0.00031250000000000006, nodes = [partition([0, 1, 2], 0, true), partition([1, 3, 2], 1, true)];
  for (const [index, node] of nodes.entries()) {
    const attribute: unknown = node.geometry.getAttribute('position'), vertices = ordinals[index];
    if (!(attribute instanceof InterleavedBufferAttribute) || vertices === undefined) throw new Error('Missing signed grid fixture');
    for (const [local, vertex] of vertices.entries()) {
      const sample = samples[vertex]; if (sample === undefined) throw new Error('Missing signed grid vertex');
      attribute.setXYZ(local, sample[0], sample[1], sample[2]);
    }
    node.userData['wholePartition'] = { id: 'source', vertices, triangles: [index], vertexCount: 4, indexCount: 6, index: 'u16', grid: { origin, step } };
  }
  // Independent former temporary-array oracle, including non-binary scale and
  // origins at both signed Int16 limits; compare raw Float32 words, no tolerance.
  const expected = Float32Array.from(samples.flatMap(([x, y, z]) => [x * step + origin[0], y * step + origin[1], z * step + origin[2]]));
  const result = assembleWholeGeometryViews(nodes, ownership);
  try {
    const actual: unknown = result.get('source')?.geometry.getAttribute('position');
    if (!(actual instanceof BufferAttribute)) throw new Error('Missing signed grid output');
    expect(new Uint8Array(actual.array.buffer, actual.array.byteOffset, actual.array.byteLength)).toEqual(new Uint8Array(expected.buffer));
  } finally { for (const view of result.values()) view.geometry.dispose(); for (const node of nodes) node.geometry.dispose(); }
});


function completePartition(gridded: boolean, encoded: boolean): Mesh {
  const node = partition([0, 1, 2, 3], 0, gridded);
  node.geometry.setIndex([0, 1, 2, 1, 3, 2]);
  node.geometry.setAttribute('_seed', new BufferAttribute(new Float32Array([0, -0, 1e-20, 1 / 3]), 1));
  const native: unknown = node.userData['nativeAttributes'];
  if (native === null || typeof native !== 'object') throw new Error('Missing native channels');
  node.userData['nativeAttributes'] = { ...native, seed: { semantic: '_SEED', storage: 'Float32Array', normalized: false, itemSize: 1 } };
  if (gridded) {
    const position = node.geometry.getAttribute('position');
    for (const [i, words] of [[-32768, 32767, -1], [32766, -32767, 1], [12345, -23456, 0], [-1, 0, 32767]].entries()) position.setXYZ(i, words[0] ?? 0, words[1] ?? 0, words[2] ?? 0);
  }
  node.userData['wholePartition'] = { id: 'source', vertices: encoded ? { runs: [0, 4] } : [0, 1, 2, 3],
    triangles: { runs: [0, 2] }, vertexCount: 4, indexCount: 6, index: 'u16',
    ...(gridded ? { grid: { origin: [12345.678901234567, -0.0000123456789, 1e-20], step: 0.00031250000000000006 } } : {}) };
  return node;
}

function completeTriangles(kind: 'u16' | 'u32' | 'none', encoded: boolean): Mesh {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array([0, -0, 1, 1, 0, 0, -1, 2, 3, 4, 1, -2, 3, 0, 1, 2, 4, 1]), 3));
  geometry.setAttribute('color', new BufferAttribute(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18]), 3, true));
  if (kind !== 'none') geometry.setIndex(new BufferAttribute(kind === 'u16' ? new Uint16Array([5, 0, 3, 1, 4, 2]) : new Uint32Array([5, 0, 3, 1, 4, 2]), 1));
  const node = new Mesh(geometry);
  node.userData['nativeAttributes'] = {
    position: { semantic: 'POSITION', storage: 'Float32Array', normalized: false, itemSize: 3 },
    color: { semantic: 'COLOR_0', storage: 'Uint8Array', normalized: true, itemSize: 3 },
  };
  node.userData['matrix64'] = new Matrix4().makeTranslation(3, 7, -8).elements;
  node.userData['wholePartition'] = { id: 'triangles', vertices: { runs: [0, 6] }, triangles: encoded ? { runs: [0, 2] } : [0, 1], vertexCount: 6, indexCount: kind === 'none' ? 0 : 6, index: kind };
  return node;
}

test.each((['u16', 'u32', 'none'] as const).flatMap(kind => (['borrow', 'take'] as const).map(ownership => ({ kind, ownership }))))(
  'complete triangle runs retain every explicit index/channel/bounds byte ($kind, $ownership)', ({ kind, ownership }) => {
    const explicit = completeTriangles(kind, false), encoded = completeTriangles(kind, true), original = facts(encoded.geometry);
    const before = assembleWholeGeometryViews([explicit], ownership), after = assembleWholeGeometryViews([encoded], ownership);
    try {
      const a = before.get('triangles'), b = after.get('triangles');
      if (a === undefined || b === undefined) throw new Error('Missing complete triangles');
      expect(facts(b.geometry)).toEqual(facts(a.geometry)); expect(b.matrix.elements).toEqual(a.matrix.elements);
      expect(facts(encoded.geometry)).toEqual(original);
    } finally { for (const view of [...before.values(), ...after.values()]) view.geometry.dispose(); explicit.geometry.dispose(); encoded.geometry.dispose(); }
  });

test.each(['outside', 'fraction', 'nan', 'duplicate', 'missing'] as const)('complete triangle run keeps %s refusal', kind => {
  const node = completeTriangles('u32', true);
  if (kind === 'outside') node.geometry.setIndex(new BufferAttribute(new Uint32Array([6, 0, 3, 1, 4, 2]), 1));
  if (kind === 'fraction' || kind === 'nan') node.geometry.setIndex(new BufferAttribute(new Float32Array([kind === 'nan' ? Number.NaN : 0.5, 0, 3, 1, 4, 2]), 1));
  if (kind === 'duplicate' || kind === 'missing') node.userData['wholePartition'] = { id: 'triangles', vertices: { runs: [0, 6] }, triangles: { runs: kind === 'duplicate' ? [0, 1, 0, 1] : [0, 1] }, vertexCount: 6, indexCount: 6, index: 'u32' };
  try { expect(() => assembleWholeGeometryViews([node], 'take')).toThrow(kind === 'duplicate' ? 'Whole duplicate or invalid triangle' : kind === 'missing' ? 'Whole source triangles is incomplete' : 'Whole missing triangle vertex'); }
  finally { node.geometry.dispose(); }
});

test('a trailing source index outside the declared triangle list retains original fallback bytes', () => {
  const explicit = completeTriangles('u32', false), encoded = completeTriangles('u32', true);
  for (const node of [explicit, encoded]) {
    node.geometry.setIndex(new BufferAttribute(new Uint32Array([5, 0, 3, 1, 4, 2, 999]), 1));
    node.userData['wholePartition'] = { id: 'triangles', vertices: { runs: [0, 6] }, triangles: node === encoded ? { runs: [0, 2] } : [0, 1], vertexCount: 6, indexCount: 7, index: 'u32' };
  }
  const before = assembleWholeGeometryViews([explicit]), after = assembleWholeGeometryViews([encoded], 'take');
  try {
    const a = before.get('triangles'), b = after.get('triangles');
    if (a === undefined || b === undefined) throw new Error('Missing triangle fallback');
    expect(facts(b.geometry)).toEqual(facts(a.geometry));
    expect(b.geometry.index?.array).toEqual(new Uint32Array([5, 0, 3, 1, 4, 2, 0]));
  } finally { for (const view of [...before.values(), ...after.values()]) view.geometry.dispose(); explicit.geometry.dispose(); encoded.geometry.dispose(); }
});

test('caller metadata cannot supply a trusted dense triangle proof', () => {
  const node = completeTriangles('u32', true), row: unknown = node.userData['wholePartition'];
  if (typeof row !== 'object' || row === null) throw new Error('Missing triangle metadata');
  node.userData['wholePartition'] = { ...row, denseTriangles: true };
  try { expect(() => assembleWholeGeometryViews([node], 'take')).toThrow(); }
  finally { node.geometry.dispose(); }
});

test.each([false, true].flatMap(grid => [false, true].map(take => ({ grid, take }))))(
  'complete source runs retain explicit-list channel/index/bounds bytes (grid $grid, take $take)', ({ grid, take }) => {
    const explicit = completePartition(grid, false), encoded = completePartition(grid, true);
    const originals = [facts(explicit.geometry), facts(encoded.geometry)];
    const before = assembleWholeGeometryViews([explicit]), after = assembleWholeGeometryViews([encoded], take ? 'take' : 'borrow');
    try {
      const a = before.get('source'), b = after.get('source');
      if (a === undefined || b === undefined) throw new Error('Missing complete source');
      expect(facts(b.geometry)).toEqual(facts(a.geometry)); expect(b.matrix.elements).toEqual(a.matrix.elements);
      expect(facts(explicit.geometry)).toEqual(originals[0]); expect(facts(encoded.geometry)).toEqual(originals[1]);
    } finally {
      for (const view of [...before.values(), ...after.values()]) view.geometry.dispose();
      explicit.geometry.dispose(); encoded.geometry.dispose();
    }
  });

test.each(['partial', 'offset', 'shared', 'duplicate-triangle', 'spoofed-proof'])('encoded complete-source shortcut preserves %s refusal', kind => {
  const node = completePartition(true, true), other = completePartition(true, true);
  if (kind === 'partial') node.userData['wholePartition'] = { id: 'source', vertices: { runs: [0, 3] }, triangles: [0], vertexCount: 4, indexCount: 6, index: 'u16' };
  if (kind === 'offset') node.userData['wholePartition'] = { id: 'source', vertices: { runs: [1, 4] }, triangles: [0, 1], vertexCount: 4, indexCount: 6, index: 'u16' };
  if (kind === 'shared') other.geometry.getAttribute('position').setX(0, 99);
  if (kind === 'spoofed-proof') node.userData['wholePartition'] = { id: 'source', vertices: [0, 1, 2, 3], triangles: [0, 1], vertexCount: 4, indexCount: 6, index: 'u16', denseVertices: true };
  const error = kind === 'partial' ? 'Whole source source is incomplete' : kind === 'offset' ? 'Whole vertex ordinal outside source'
    : kind === 'shared' ? 'Whole shared vertex differs' : kind === 'duplicate-triangle' ? 'Whole duplicate or invalid triangle' : undefined;
  try {
    const read = () => assembleWholeGeometryViews(kind === 'shared' || kind === 'duplicate-triangle' ? [node, other] : [node], 'take');
    if (error === undefined) expect(read).toThrow(); else expect(read).toThrow(error);
    if (kind === 'partial') {
      // The predecessor explicit-list route refuses at the same original
      // completeness gate; no required triangle is consumed beyond its list.
      other.userData['wholePartition'] = { id: 'source', vertices: [0, 1, 2], triangles: [0], vertexCount: 4, indexCount: 6, index: 'u16' };
      expect(() => assembleWholeGeometryViews([other], 'take')).toThrow('Whole source source is incomplete');
    }
  } finally { node.geometry.dispose(); other.geometry.dispose(); }
});

test.each([false, true].flatMap(grid => (['borrow', 'take'] as const).map(ownership => ({ grid, ownership }))))(
  'private identity runs retain all bytes across shared nodes (grid $grid, $ownership)', ({ grid, ownership }) => {
    const build = (encoded: boolean): Mesh[] => [0, 1].map(triangle => {
      const node = completePartition(grid, encoded), row: unknown = node.userData['wholePartition'];
      if (typeof row !== 'object' || row === null) throw new Error('Missing partition');
      node.userData['wholePartition'] = { ...row, triangles: [triangle] };
      node.geometry.setIndex(triangle === 0 ? [0, 1, 2] : [1, 3, 2]); return node;
    });
    const plain = build(false), encoded = build(true), expected = assembleWholeGeometryViews(plain, ownership), actual = assembleWholeGeometryViews(encoded, ownership);
    try {
      const a = expected.get('source'), b = actual.get('source'); if (a === undefined || b === undefined) throw new Error('Missing shared result');
      expect(facts(b.geometry)).toEqual(facts(a.geometry)); expect(b.matrix.elements).toEqual(a.matrix.elements);
    } finally { for (const view of [...expected.values(), ...actual.values()]) view.geometry.dispose(); for (const node of [...plain, ...encoded]) node.geometry.dispose(); }
  });

test.each([[0], [0, -1], [0, 1.5], [0, (1 << 24) + 1]])('private vertex runs retain malformed bounded-pair refusal (%j)', (...runs) => {
  const node = completePartition(false, true), row: unknown = node.userData['wholePartition'];
  if (typeof row !== 'object' || row === null) throw new Error('Missing partition');
  node.userData['wholePartition'] = { ...row, vertices: { runs } };
  try { expect(() => assembleWholeGeometryViews([node], 'take')).toThrow(); }
  finally { node.geometry.dispose(); }
});

test('wire metadata cannot supply the private lazy vertex length', () => {
  const node = completePartition(false, true), row: unknown = node.userData['wholePartition'];
  if (typeof row !== 'object' || row === null) throw new Error('Missing partition');
  node.userData['wholePartition'] = { ...row, vertexLength: 0 };
  try { expect(() => assembleWholeGeometryViews([node], 'take')).toThrow(); }
  finally { node.geometry.dispose(); }
});

// The private identity mapping must not treat signed or fractional native
// indices as unsigned, even when a caller forges a public string tag.
test.each(['signed', 'fraction', 'nan', 'tagged-fraction'] as const)('compact ordinals retain %s native-index refusal', kind => {
  const node = completeTriangles('u32', true);
  const indices = kind === 'signed' ? new Int32Array([-1, 0, 3, 1, 4, 2])
    : new Float32Array([kind === 'nan' ? Number.NaN : 0.5, 0, 3, 1, 4, 2]);
  if (kind === 'tagged-fraction') Object.defineProperty(indices, Symbol.toStringTag, { value: 'Uint32Array' });
  node.geometry.setIndex(new BufferAttribute(indices, 1));
  try { expect(() => assembleWholeGeometryViews([node], 'take')).toThrow('Whole missing triangle vertex'); }
  finally { node.geometry.dispose(); }
});

test.each(['borrow', 'take'] as const)('whole assembly reads and admits native metadata once per node (%s)', ownership => {
  const node = completePartition(true, true), metadata: unknown = node.userData['nativeAttributes'];
  let reads = 0;
  Object.defineProperty(node.userData, 'nativeAttributes', { get: () => { reads++; return metadata; } });
  const result = assembleWholeGeometryViews([node], ownership);
  try { expect(reads).toBe(1); expect(result.size).toBe(1); }
  finally { for (const view of result.values()) view.geometry.dispose(); node.geometry.dispose(); }
});

test('non-monotonic triangle runs keep the explicit ordinal and complete channel bytes', () => {
  const explicit = completeTriangles('u32', false), encoded = completeTriangles('u32', true);
  const metadata = { id: 'triangles', vertices: { runs: [0, 6] }, vertexCount: 6, indexCount: 6, index: 'u32' };
  explicit.userData['wholePartition'] = { ...metadata, triangles: [1, 0] };
  encoded.userData['wholePartition'] = { ...metadata, triangles: { runs: [1, 1, 0, 1] } };
  const a = assembleWholeGeometryViews([explicit]), b = assembleWholeGeometryViews([encoded]);
  try {
    const before = a.get('triangles'), after = b.get('triangles');
    if (before === undefined || after === undefined) throw new Error('Missing assembled triangles');
    expect(facts(after.geometry)).toEqual(facts(before.geometry));
  }
  finally { for (const view of [...a.values(), ...b.values()]) view.geometry.dispose(); explicit.geometry.dispose(); encoded.geometry.dispose(); }
});

test.each(['outside', 'spoofed-length'] as const)('lazy triangle runs keep %s refusal', kind => {
  const node = completeTriangles('u32', true), row: unknown = node.userData['wholePartition'];
  if (typeof row !== 'object' || row === null) throw new Error('Missing triangle metadata');
  node.userData['wholePartition'] = kind === 'outside' ? { ...row, triangles: { runs: [0, 3] } } : { ...row, triangleLength: 0 };
  try { expect(() => assembleWholeGeometryViews([node], 'take')).toThrow(); }
  finally { node.geometry.dispose(); }
});
