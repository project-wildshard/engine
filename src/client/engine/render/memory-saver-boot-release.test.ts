import { afterAll, expect, test, vi } from 'vitest';
import { BufferAttribute, BufferGeometry, Mesh, MeshBasicMaterial, PerspectiveCamera, Raycaster, Scene, Sphere, Sprite, SpriteMaterial, Vector3 } from 'three';
import { textureUploadRenderer } from '../../../test/engine/textureUploadRenderer';
import { ChangedBatchedMesh, prepareBatchGeometryRetirement } from './changedTextureUploads';
import { installMemorySaver, releaseDrawnGeometry } from './memorySaver';
import { arrayReleased, retainGeometryForCpuReads } from './releasedArrays';
import { installFrameCounter } from './frameCounter';
import { noteFrameDrawn } from '../../../shared/engine/core/framePacing';

// Mini QA 2026-11-17 row 19: the boot draws the world a handful of times, never the 240 renders a geometry waits before its
// CPU copy goes, so Nine's phone boot held 88-147 MB of attribute arrays beside their GPU copies through its peak.
class FakeBuffer { readonly id = Symbol('buffer'); }
class FakeGL {
  readonly ARRAY_BUFFER = 0x8892; readonly ARRAY_BUFFER_BINDING = 0x8894; readonly COPY_READ_BUFFER = 0x8f36;
  readonly ELEMENT_ARRAY_BUFFER = 0x8893; readonly ELEMENT_ARRAY_BUFFER_BINDING = 0x8895; readonly COPY_READ_BUFFER_BINDING = 0x8f36;
  readonly bindings = new Map<number, FakeBuffer | null>();
  readonly uploads = new Map<FakeBuffer, ArrayBufferView>();
  bufferData(target: number, data: ArrayBufferView): void {
    const buffer = this.bindings.get(target);
    if (buffer !== undefined && buffer !== null) this.uploads.set(buffer, data);
  }
  getParameter(binding: number): FakeBuffer | null {
    const target = binding === this.ARRAY_BUFFER_BINDING ? this.ARRAY_BUFFER
      : binding === this.ELEMENT_ARRAY_BUFFER_BINDING ? this.ELEMENT_ARRAY_BUFFER : this.COPY_READ_BUFFER;
    return this.bindings.get(target) ?? null;
  }
  bindBuffer(target: number, buffer: FakeBuffer | null): void { this.bindings.set(target, buffer); }
  isBuffer(buffer: FakeBuffer): boolean { return this.uploads.has(buffer); }
  getBufferSubData(target: number, _offset: number, out: ArrayBufferView): void {
    const buffer = this.bindings.get(target), source = buffer === undefined || buffer === null ? undefined : this.uploads.get(buffer);
    if (source !== undefined) new Uint8Array(out.buffer, out.byteOffset, out.byteLength).set(new Uint8Array(source.buffer, source.byteOffset, source.byteLength));
  }
}
afterAll(() => { vi.unstubAllGlobals(); });

test('QA19: the boot lets every drawn, unchanged geometry go at once; position stays and a changed one waits', () => {
  vi.stubGlobal('WebGL2RenderingContext', FakeGL);
  vi.stubGlobal('WebGLBuffer', FakeBuffer);
  const gl = new FakeGL(), base = textureUploadRenderer();
  const renderer = Object.assign(base, { getContext: () => gl });
  installFrameCounter(renderer); installMemorySaver(renderer);
  const scene = new Scene(), camera = new PerspectiveCamera(), material = new MeshBasicMaterial();
  const make = (): BufferGeometry => new BufferGeometry()
    .setAttribute('position', new BufferAttribute(new Float32Array([1, 2, 3]), 3))
    .setAttribute('normal', new BufferAttribute(new Float32Array([0, 1, 0]), 3));
  // three's upload of each attribute (WebGLAttributes.createBuffer): bound, then bufferData
  const upload = (geometry: BufferGeometry): void => {
    for (const attribute of Object.values(geometry.attributes)) {
      gl.bindBuffer(gl.ARRAY_BUFFER, new FakeBuffer());
      gl.bufferData(gl.ARRAY_BUFFER, (attribute as BufferAttribute).array);
    }
  };
  const draw = (geometry: BufferGeometry): void => {
    upload(geometry);
    renderer.renderBufferDirect(camera, scene, geometry, material, new Mesh(geometry, material), { start: 0, count: 3, materialIndex: 0 });
  };
  const still = make(), changing = make();
  draw(still); draw(changing);
  changing.getAttribute('normal').needsUpdate = true;
  expect(releaseDrawnGeometry(renderer)).toBe(12);
  expect(arrayReleased(still.getAttribute('normal'))).toBe(true);
  expect(arrayReleased(still.getAttribute('position'))).toBe(false);
  expect(arrayReleased(changing.getAttribute('normal'))).toBe(false);
  // a later read brings the released array back from the GPU
  expect(Array.from(still.getAttribute('normal').array)).toEqual([0, 1, 0]);
  // nothing left to let go: a second call releases nothing
  expect(releaseDrawnGeometry(renderer)).toBe(0);
  still.dispose(); changing.dispose(); material.dispose();
});

test('phone retires draw-only shape data and an unexpected raycast reads back the original triangles', () => {
  vi.stubGlobal('WebGL2RenderingContext', FakeGL);
  vi.stubGlobal('WebGLBuffer', FakeBuffer);
  const gl = new FakeGL(), renderer = Object.assign(textureUploadRenderer(), { getContext: () => gl });
  installMemorySaver(renderer, true);
  const material = new MeshBasicMaterial(), scene = new Scene(), camera = new PerspectiveCamera();
  const draw = (keep: boolean): Mesh => {
    const geometry = new BufferGeometry().setIndex([0, 1, 2])
      .setAttribute('position', new BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 0, 1, 0]), 3));
    geometry.computeBoundingSphere();
    if (keep) retainGeometryForCpuReads(geometry);
    gl.bindBuffer(gl.ARRAY_BUFFER, new FakeBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, geometry.getAttribute('position').array);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, new FakeBuffer());
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, geometry.index?.array ?? new Uint16Array());
    const mesh = new Mesh(geometry, material);
    renderer.renderBufferDirect(camera, scene, geometry, material, mesh, { start: 0, count: 3, materialIndex: 0 });
    return mesh;
  };
  const drawOnly = draw(false), registered = draw(true);
  expect(releaseDrawnGeometry(renderer)).toBe(42);
  expect(arrayReleased(drawOnly.geometry.getAttribute('position'))).toBe(true);
  expect(arrayReleased(drawOnly.geometry.index ?? {})).toBe(true);
  expect(arrayReleased(registered.geometry.getAttribute('position'))).toBe(false);
  expect(arrayReleased(registered.geometry.index ?? {})).toBe(false);
  const ray = new Raycaster(new Vector3(0, 0, 1), new Vector3(0, 0, -1));
  expect(ray.intersectObject(drawOnly)[0]?.distance).toBe(1);
  expect(Array.from(drawOnly.geometry.index?.array ?? [])).toEqual([0, 1, 2]);
  expect(arrayReleased(drawOnly.geometry.getAttribute('position'))).toBe(false);
  drawOnly.geometry.dispose(); registered.geometry.dispose(); material.dispose();
});

test('phone keeps the sprite quad readable for the next renderer', () => {
  vi.stubGlobal('WebGL2RenderingContext', FakeGL);
  vi.stubGlobal('WebGLBuffer', FakeBuffer);
  const gl = new FakeGL(), renderer = Object.assign(textureUploadRenderer(), { getContext: () => gl });
  installMemorySaver(renderer, true);
  const material = new SpriteMaterial(), sprite = new Sprite(material), geometry = sprite.geometry;
  const index = geometry.index;
  if (index === null) throw new Error('Expected an indexed sprite');
  const expected = Array.from(index.array);
  try {
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, new FakeBuffer());
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, index.array);
    renderer.renderBufferDirect(new PerspectiveCamera(), new Scene(), geometry, material, sprite, { start: 0, count: 6, materialIndex: 0 });
    expect(releaseDrawnGeometry(renderer)).toBe(0);
    geometry.dispose();
    expect(new Sprite(material).geometry).toBe(geometry);
    expect(Array.from(index.array)).toEqual(expected);
  } finally { material.dispose(); }
});

test('a prepared fixed batch retires vertex arrays and keeps the multi-draw index', () => {
  vi.stubGlobal('WebGL2RenderingContext', FakeGL);
  vi.stubGlobal('WebGLBuffer', FakeBuffer);
  const gl = new FakeGL(), renderer = Object.assign(textureUploadRenderer(), { getContext: () => gl });
  installFrameCounter(renderer);
  installMemorySaver(renderer, true);
  const material = new MeshBasicMaterial(), scene = new Scene(), camera = new PerspectiveCamera();
  const triangle = new BufferGeometry().setIndex([0, 1, 2])
    .setAttribute('position', new BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 0, 1, 0]), 3));
  const draw = (fixed: boolean): ChangedBatchedMesh => {
    const batch = new ChangedBatchedMesh(1, 6, 6, material);
    const near = batch.addGeometry(triangle), far = batch.addGeometry(triangle);
    batch.addInstance(near);
    if (fixed) prepareBatchGeometryRetirement(batch, [near, far]);
    gl.bindBuffer(gl.ARRAY_BUFFER, new FakeBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, batch.geometry.getAttribute('position').array);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, new FakeBuffer());
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, batch.geometry.index?.array ?? new Uint16Array());
    renderer.renderBufferDirect(camera, scene, batch.geometry, material, batch, { start: 0, count: 3, materialIndex: 0 });
    return batch;
  };
  const changing = draw(false), fixed = draw(true);
  expect(releaseDrawnGeometry(renderer)).toBe(0);
  expect(arrayReleased(fixed.geometry.getAttribute('position'))).toBe(false);
  try {
    for (let frame = 0; frame < 240; frame++) renderer.render(scene, camera);
    noteFrameDrawn();
    renderer.renderBufferDirect(camera, scene, fixed.geometry, material, fixed, { start: 0, count: 3, materialIndex: 0 });
  } finally {
    noteFrameDrawn(Number.NEGATIVE_INFINITY);
  }
  expect(arrayReleased(changing.geometry.getAttribute('position'))).toBe(false);
  expect(arrayReleased(changing.geometry.index ?? {})).toBe(false);
  fixed.setGeometryIdAt(0, 1);
  fixed.computeBoundingSphere();
  expect(fixed.getBoundingSphereAt(1, new Sphere())?.radius).toBeCloseTo(Math.sqrt(2));
  expect(arrayReleased(fixed.geometry.getAttribute('position'))).toBe(true);
  expect(arrayReleased(fixed.geometry.index ?? {})).toBe(false);
  const ray = new Raycaster(new Vector3(0, 0, 1), new Vector3(0, 0, -1));
  expect(ray.intersectObject(fixed)[0]?.distance).toBe(1);
  expect(Array.from(fixed.geometry.index?.array ?? [])).toEqual([0, 1, 2, 3, 4, 5]);
  changing.dispose(); fixed.dispose(); triangle.dispose(); material.dispose();
});
