import { expect, test, vi } from 'vitest';
import { BufferAttribute, BufferGeometry, InterleavedBuffer, InterleavedBufferAttribute, Matrix4, Mesh, MeshBasicMaterial, Vector3 } from 'three';
import { identitySpaceGeometry } from './ownedGeometry';

/** The original two-pass result: the Float32 store between normalization and
 * matrix multiplication is part of the shipped decoder's numerical contract. */
function original(mesh: Mesh): BufferGeometry {
  const geometry = mesh.geometry.clone(), position = geometry.getAttribute('position');
  const values = new Float32Array(position.count * 3);
  for (let i = 0; i < position.count; i++) { values[i * 3] = position.getX(i); values[i * 3 + 1] = position.getY(i); values[i * 3 + 2] = position.getZ(i); }
  geometry.setAttribute('position', new BufferAttribute(values, 3)); geometry.applyMatrix4(mesh.matrixWorld);
  for (const [name, attribute] of Object.entries(geometry.attributes)) {
    if (name === 'position' || (attribute instanceof BufferAttribute && attribute.array instanceof Float32Array && !attribute.normalized)) continue;
    const out = new Float32Array(attribute.count * attribute.itemSize);
    for (let i = 0; i < attribute.count; i++) for (let c = 0; c < attribute.itemSize; c++) out[i * attribute.itemSize + c] = attribute.getComponent(i, c);
    geometry.setAttribute(name, new BufferAttribute(out, attribute.itemSize));
  }
  return geometry;
}

test.each([1, 0.00037, 3.141592653589793].flatMap(scale => [false, true].flatMap(interleaved => [false, true].flatMap(tangent => [3, 4].map(normalWidth => ({ scale, interleaved, tangent, normalWidth }))))))(
  'fused grid decode retains original channels/bounds ($scale, stride $interleaved, tangent $tangent, normal $normalWidth)', ({ scale, interleaved, tangent, normalWidth }) => {
    const geometry = new BufferGeometry(), material = new MeshBasicMaterial();
    const values = new Int16Array([-32768, -32767, -16384, -1, 0, 1, 16383, 16384, 32766, 32767, 12345, -23456]);
    if (interleaved) {
      const padded = new Int16Array(16);
      for (let i = 0; i < 4; i++) { padded.set(values.subarray(i * 3, i * 3 + 3), i * 4); padded[i * 4 + 3] = 1234; }
      geometry.setAttribute('position', new InterleavedBufferAttribute(new InterleavedBuffer(padded, 4), 3, 0, true));
    } else geometry.setAttribute('position', new BufferAttribute(values, 3, true));
    const normals = Int8Array.from([[127, 3, 0], [0, -128, 4], [3, 4, 126], [-50, 60, 100]]
      .flatMap((row, index) => normalWidth === 4 ? row.concat(index * 31 - 50) : row));
    let normalSource: BufferAttribute | InterleavedBufferAttribute;
    if (interleaved) {
      const stride = normalWidth + 2, padded = new Int8Array(4 * stride);
      for (let i = 0; i < 4; i++) { padded.set(normals.subarray(i * normalWidth, (i + 1) * normalWidth), i * stride + 1); padded[i * stride] = 99; padded[i * stride + stride - 1] = -88; }
      normalSource = new InterleavedBufferAttribute(new InterleavedBuffer(padded, stride), normalWidth, 1, true);
    } else normalSource = new BufferAttribute(normals, normalWidth, true);
    geometry.setAttribute('normal', normalSource);
    const originalNormals = new Int8Array(normalSource instanceof InterleavedBufferAttribute ? normalSource.data.array : normalSource.array);
    if (tangent) geometry.setAttribute('tangent', new BufferAttribute(new Int16Array([32767, 0, 0, -32767, 0, 32767, 1, 32767, 1, 0, 32767, -32767, 20000, 21000, 22000, 32767]), 4, true));
    geometry.setAttribute('colour', new BufferAttribute(new Uint8Array([1, 2, 3, 255, 128, 127, 0, 254]), 2, true));
    geometry.setIndex([0, 1, 2, 1, 3, 2]); geometry.computeBoundingBox(); geometry.computeBoundingSphere();
    const mesh = new Mesh(geometry, material); mesh.scale.setScalar(scale); mesh.position.set(123.456789, -0.000037, -76.54321); mesh.updateMatrixWorld(true);
    const expected = original(mesh), actual = identitySpaceGeometry(mesh);
    try {
      expect(actual).not.toBeNull(); if (actual === null) throw new Error('Missing quantized result');
      expect(actual.index?.array).toEqual(expected.index?.array);
      expect(Object.keys(actual.attributes)).toEqual(Object.keys(expected.attributes));
      for (const name of Object.keys(expected.attributes)) {
        const a = actual.getAttribute(name), b = expected.getAttribute(name);
        expect(a.itemSize).toBe(b.itemSize); expect(a.normalized).toBe(b.normalized);
        if (!(a instanceof BufferAttribute) || !(b instanceof BufferAttribute)) throw new Error('Decoded channels must be plain');
        expect(a.version).toBe(b.version);
        expect(new Uint8Array(a.array.buffer, a.array.byteOffset, a.array.byteLength)).toEqual(new Uint8Array(b.array.buffer, b.array.byteOffset, b.array.byteLength));
      }
      expect(actual.boundingBox).toEqual(expected.boundingBox); expect(actual.boundingSphere).toEqual(expected.boundingSphere);
      expect(geometry.getAttribute('position').normalized).toBe(true); expect(values[0]).toBe(-32768);
      expect(geometry.getAttribute('normal')).toBe(normalSource);
      expect(normalSource instanceof InterleavedBufferAttribute ? normalSource.data.array : normalSource.array).toEqual(originalNormals);
    } finally { actual?.dispose(); expected.dispose(); geometry.dispose(); material.dispose(); }
  });

test('ordinary float geometry keeps the original non-grid refusal', () => {
  const geometry = new BufferGeometry(), material = new MeshBasicMaterial();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array([0, 0, 0]), 3));
  try { expect(identitySpaceGeometry(new Mesh(geometry, material))).toBeNull(); }
  finally { geometry.dispose(); material.dispose(); }
});

function boundedMesh(): Mesh {
  const geometry = new BufferGeometry().setAttribute('position', new BufferAttribute(new Int16Array([
    -32768, 0, 32767, 1000, -2000, 3000, 32767, -32768, 0,
  ]), 3, true));
  const mesh = new Mesh(geometry, new MeshBasicMaterial());
  mesh.scale.setScalar(0.00037); mesh.position.set(1.23456789, -0.12345678, 98.7654321); mesh.updateMatrixWorld(true);
  return mesh;
}
function closeMesh(mesh: Mesh): void {
  mesh.geometry.dispose();
  for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) material.dispose();
}

test.each([[false, false], [false, true], [true, false], [true, true]])('retains original optional bounds (box %s, sphere %s)', (box, sphere) => {
  const mesh = boundedMesh();
  if (box) mesh.geometry.computeBoundingBox();
  if (sphere) mesh.geometry.computeBoundingSphere();
  const expected = original(mesh), actual = identitySpaceGeometry(mesh);
  try {
    if (actual === null) throw new Error('Missing quantized result');
    expect(actual.boundingBox).toEqual(expected.boundingBox); expect(actual.boundingSphere).toEqual(expected.boundingSphere);
    expect(actual.getAttribute('position').array).toEqual(expected.getAttribute('position').array);
  } finally { expected.dispose(); actual?.dispose(); closeMesh(mesh); }
});

test.each([false, true])('morph positions keep the original bounds pass (relative %s)', relative => {
  const mesh = boundedMesh();
  mesh.geometry.morphAttributes.position = [new BufferAttribute(new Float32Array([2, -3, 4, -5, 6, -7, 8, -9, 10]), 3)];
  mesh.geometry.morphTargetsRelative = relative;
  mesh.geometry.computeBoundingBox(); mesh.geometry.computeBoundingSphere();
  const expected = original(mesh), actual = identitySpaceGeometry(mesh);
  try {
    if (actual === null) throw new Error('Missing quantized result');
    expect(actual.boundingBox).toEqual(expected.boundingBox); expect(actual.boundingSphere).toEqual(expected.boundingSphere);
    expect(actual.morphAttributes).toEqual(expected.morphAttributes);
  } finally { expected.dispose(); actual?.dispose(); closeMesh(mesh); }
});

test('custom position accessors retain their normalized read and bounds semantics', () => {
  const mesh = boundedMesh(), getX: unknown = Reflect.get(BufferAttribute.prototype, 'getX');
  if (typeof getX !== 'function') throw new Error('Missing original position getter');
  mesh.geometry.computeBoundingBox(); mesh.geometry.computeBoundingSphere();
  const read = vi.spyOn(BufferAttribute.prototype, 'getX').mockImplementation(function readPosition(this: BufferAttribute, index: number) {
    const value: unknown = Reflect.apply(getX, this, [index]);
    if (typeof value !== 'number') throw new Error('Position getter must return a number');
    return value + 0.00001;
  });
  let expected: BufferGeometry | undefined, actual: BufferGeometry | null = null;
  try {
    expected = original(mesh); actual = identitySpaceGeometry(mesh);
    if (actual === null) throw new Error('Missing quantized result');
    expect(actual.getAttribute('position').array).toEqual(expected.getAttribute('position').array);
    expect(actual.boundingBox).toEqual(expected.boundingBox); expect(actual.boundingSphere).toEqual(expected.boundingSphere);
  } finally { read.mockRestore(); expected?.dispose(); actual?.dispose(); closeMesh(mesh); }
});

test.each(['empty', 'overflow'])('keeps native bounds and diagnostics for %s positions', mode => {
  const mesh = boundedMesh();
  if (mode === 'empty') mesh.geometry.setAttribute('position', new BufferAttribute(new Int16Array(0), 3, true));
  mesh.geometry.computeBoundingBox(); mesh.geometry.computeBoundingSphere();
  if (mode === 'overflow') { mesh.scale.setScalar(1e308); mesh.updateMatrixWorld(true); }
  const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  let expected: BufferGeometry | undefined, actual: BufferGeometry | null = null;
  try {
    expected = original(mesh);
    const messages = errors.mock.calls.map(call => String(call[0])); errors.mockClear();
    actual = identitySpaceGeometry(mesh);
    if (actual === null) throw new Error('Missing quantized result');
    expect(actual.getAttribute('position').array).toEqual(expected.getAttribute('position').array);
    expect(actual.boundingBox).toEqual(expected.boundingBox); expect(actual.boundingSphere).toEqual(expected.boundingSphere);
    expect(errors.mock.calls.map(call => String(call[0]))).toEqual(messages);
  } finally { errors.mockRestore(); expected?.dispose(); actual?.dispose(); closeMesh(mesh); }
});


test.each(['getX', 'setXYZ'] as const)('custom compact-normal %s retains Three byte semantics', method => {
  const mesh = boundedMesh();
  mesh.geometry.setAttribute('normal', new InterleavedBufferAttribute(new InterleavedBuffer(new Int8Array([
    99, 127, 3, 0, -88, 99, 0, -128, 4, -88, 99, -50, 60, 100, -88,
  ]), 5), 3, 1, true));
  const native: unknown = Reflect.get(InterleavedBufferAttribute.prototype, method);
  if (typeof native !== 'function') throw new Error('Missing original normal operation');
  const custom = method === 'getX'
    ? vi.spyOn(InterleavedBufferAttribute.prototype, 'getX').mockImplementation(function readNormal(this: InterleavedBufferAttribute, index: number) {
      const value: unknown = Reflect.apply(native, this, [index]);
      if (typeof value !== 'number') throw new Error('Normal getter must return a number');
      return value + 0.125;
    })
    : vi.spyOn(InterleavedBufferAttribute.prototype, 'setXYZ').mockImplementation(function writeNormal(this: InterleavedBufferAttribute, index: number, x: number, y: number, z: number) {
      Reflect.apply(native, this, [index, x + 0.125, y, z]);
      return this;
    });
  let expected: BufferGeometry | undefined, actual: BufferGeometry | null = null;
  try {
    expected = original(mesh); actual = identitySpaceGeometry(mesh);
    if (actual === null) throw new Error('Missing quantized result');
    const a = actual.getAttribute('normal'), b = expected.getAttribute('normal');
    expect(new Uint8Array(a.array.buffer, a.array.byteOffset, a.array.byteLength)).toEqual(new Uint8Array(b.array.buffer, b.array.byteOffset, b.array.byteLength));
    expect(actual.getAttribute('position').array).toEqual(expected.getAttribute('position').array);
  } finally { custom.mockRestore(); expected?.dispose(); actual?.dispose(); closeMesh(mesh); }
});


test.each(['projective', 'signed-zero'] as const)('scalar position transform keeps full original bytes for %s matrices', mode => {
  const mesh = boundedMesh(), gate = mesh.matrixWorld.clone();
  if (mode === 'signed-zero') mesh.geometry.setAttribute('position', new BufferAttribute(new Int16Array(9), 3, true));
  mesh.geometry.computeBoundingBox(); mesh.geometry.computeBoundingSphere();
  const transform = mode === 'projective' ? new Matrix4().set(
    .37, -.21, .11, 1.23456789, .17, 2.1, -.13, -.987654321, -.25, .09, 3.7, 9.87654321, .125, -.0625, .25, 1)
    : new Matrix4().set(-0, -0, -0, -0, 0, 1, 0, -0, 0, 0, 1, -0, 0, 0, 0, 1);
  mesh.matrixWorld.copy(transform); const expected = original(mesh); mesh.matrixWorld.copy(gate);
  // The public door accepts the grid first; a clone completion can change its still-mutable transform.
  const clone = mesh.geometry.clone.bind(mesh.geometry);
  const copied = vi.spyOn(mesh.geometry, 'clone').mockImplementation(() => { const geometry = clone(); mesh.matrixWorld.copy(transform); return geometry; });
  let actual: BufferGeometry | null = null;
  try {
    actual = identitySpaceGeometry(mesh);
    if (actual === null) throw new Error('Missing quantized result');
    const a = actual.getAttribute('position').array, b = expected.getAttribute('position').array;
    expect(new Uint8Array(a.buffer, a.byteOffset, a.byteLength)).toEqual(new Uint8Array(b.buffer, b.byteOffset, b.byteLength));
    expect(actual.boundingBox).toEqual(expected.boundingBox); expect(actual.boundingSphere).toEqual(expected.boundingSphere);
    if (mode === 'signed-zero') expect(Object.is(a[0], -0)).toBe(true);
  } finally { copied.mockRestore(); actual?.dispose(); expected.dispose(); closeMesh(mesh); }
});

test('custom matrix element accessors retain their original reads and position bytes', () => {
  const mesh = boundedMesh(), scale = mesh.matrixWorld.elements[0]; let calls = 0;
  const clone = mesh.geometry.clone.bind(mesh.geometry);
  const copied = vi.spyOn(mesh.geometry, 'clone').mockImplementation(() => {
    const geometry = clone(); Object.defineProperty(mesh.matrixWorld.elements, '0', { configurable: true, get: () => { calls++; return scale; } }); return geometry;
  });
  let expected: BufferGeometry | undefined, actual: BufferGeometry | null = null;
  try {
    expected = original(mesh); const expectedCalls = calls;
    Object.defineProperty(mesh.matrixWorld.elements, '0', { configurable: true, writable: true, value: scale }); calls = 0;
    actual = identitySpaceGeometry(mesh);
    if (actual === null) throw new Error('Missing quantized result');
    const a = actual.getAttribute('position').array, b = expected.getAttribute('position').array;
    expect(new Uint8Array(a.buffer, a.byteOffset, a.byteLength)).toEqual(new Uint8Array(b.buffer, b.byteOffset, b.byteLength));
    expect(calls).toBe(expectedCalls);
  } finally { copied.mockRestore(); actual?.dispose(); expected?.dispose(); closeMesh(mesh); }
});

test('custom Vector3 matrix transforms retain the original complete position bytes', () => {
  const mesh = boundedMesh(), apply: unknown = Reflect.get(Vector3.prototype, 'applyMatrix4');
  if (typeof apply !== 'function') throw new Error('Missing original matrix transform');
  const changed = vi.spyOn(Vector3.prototype, 'applyMatrix4').mockImplementation(function transform(this: Vector3, matrix: Matrix4) {
    Reflect.apply(apply, this, [matrix]); this.x += .00000001; return this;
  });
  let expected: BufferGeometry | undefined, actual: BufferGeometry | null = null;
  try {
    expected = original(mesh); actual = identitySpaceGeometry(mesh);
    if (actual === null) throw new Error('Missing quantized result');
    const a = actual.getAttribute('position').array, b = expected.getAttribute('position').array;
    expect(new Uint8Array(a.buffer, a.byteOffset, a.byteLength)).toEqual(new Uint8Array(b.buffer, b.byteOffset, b.byteLength));
  } finally { changed.mockRestore(); actual?.dispose(); expected?.dispose(); closeMesh(mesh); }
});
