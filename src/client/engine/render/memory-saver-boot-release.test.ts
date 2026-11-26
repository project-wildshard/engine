import { afterAll, expect, test, vi } from 'vitest';
import { N8AOPostPass } from 'n8ao';
import { BufferAttribute, BufferGeometry, Group, Mesh, MeshBasicMaterial, PerspectiveCamera, Raycaster, Scene, Sphere, Sprite, SpriteMaterial, Vector3, WebGLRenderer } from 'three';
import { textureUploadRenderer } from '../../../test/engine/textureUploadRenderer';
import { ChangedBatchedMesh, prepareBatchGeometryRetirement } from './changedTextureUploads';
import { composerTriangle, installMemorySaver, releaseDrawnGeometry } from './memorySaver';
import { arrayReleased, retainGeometryForCpuReads } from './releasedArrays';
import { installFrameCounter } from './frameCounter';

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

test('fixed batches retire uploaded geometry at boot and keep native byte offsets', () => {
  vi.stubGlobal('WebGL2RenderingContext', FakeGL);
  vi.stubGlobal('WebGLBuffer', FakeBuffer);
  const gl = new FakeGL(), renderer = Object.assign(textureUploadRenderer(), { getContext: () => gl });
  installFrameCounter(renderer);
  installMemorySaver(renderer, true);
  const material = new MeshBasicMaterial(), scene = new Scene(), camera = new PerspectiveCamera();
  const triangle = new BufferGeometry().setIndex([0, 1, 2])
    .setAttribute('position', new BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 0, 1, 0]), 3));
  const draw = (fixed: boolean, wide = false): ChangedBatchedMesh => {
    const batch = new ChangedBatchedMesh(1, wide ? 65536 : 6, 6, material);
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
  const changing = draw(false), narrow = draw(true), wide = draw(true, true);
  expect(releaseDrawnGeometry(renderer)).toBeGreaterThan(0);
  expect(arrayReleased(changing.geometry.getAttribute('position'))).toBe(false);
  expect(arrayReleased(changing.geometry.index ?? {})).toBe(false);
  const native: unknown = Object.create(WebGLRenderer.prototype);
  if (!(native instanceof WebGLRenderer)) throw new Error('Missing native renderer port');
  for (const [batch, offset] of [[narrow, 6], [wide, 12]] as const) {
    const index = batch.geometry.getIndex();
    if (index === null) throw new Error('Fixed batch lost its index');
    batch.setGeometryIdAt(0, 1);
    batch.computeBoundingSphere();
    expect(batch.getBoundingSphereAt(1, new Sphere())?.radius).toBeCloseTo(Math.sqrt(2));
    expect(arrayReleased(batch.geometry.getAttribute('position'))).toBe(true);
    expect(arrayReleased(index)).toBe(true);
    batch.perObjectFrustumCulled = false;
    batch.sortObjects = false;
    batch.onBeforeRender(native, scene, camera, batch.geometry, material, new Group());
    expect(Reflect.get(batch, '_multiDrawStarts')).toMatchObject({ 0: offset });
    expect(arrayReleased(index)).toBe(true);
    const ray = new Raycaster(new Vector3(0, 0, 1), new Vector3(0, 0, -1));
    expect(ray.intersectObject(batch)[0]?.distance).toBe(1);
    expect(Array.from(index.array)).toEqual([0, 1, 2, 3, 4, 5]);
  }
  changing.dispose(); narrow.dispose(); wide.dispose(); triangle.dispose(); material.dispose();
});

// J451 (QA 11-19 row 17): postprocessing's fullscreen triangle is one module geometry shared by every composer on the page.
// A composer's dispose deletes its GPU buffers; a same-page zone entry's next composer uploads it again from its arrays. When
// the Memory saver had let those go, they came back zero-filled: the final pass drew nothing and the world read transparent.
test('phone keeps the composer fullscreen triangle readable for the next composer', () => {
  vi.stubGlobal('WebGL2RenderingContext', FakeGL);
  vi.stubGlobal('WebGLBuffer', FakeBuffer);
  const gl = new FakeGL(), renderer = Object.assign(textureUploadRenderer(), { getContext: () => gl });
  installMemorySaver(renderer, true);
  const geometry = composerTriangle();
  if (geometry === null) throw new Error('postprocessing no longer shares a fullscreen triangle');
  const material = new MeshBasicMaterial(), screen = new Mesh(geometry, material);
  geometry.computeBoundingSphere();
  const expected = Object.fromEntries(Object.entries(geometry.attributes).map(([name, a]) => [name, Array.from((a as BufferAttribute).array)]));
  try {
    for (const attribute of Object.values(geometry.attributes)) {
      gl.bindBuffer(gl.ARRAY_BUFFER, new FakeBuffer());
      gl.bufferData(gl.ARRAY_BUFFER, (attribute as BufferAttribute).array);
    }
    renderer.renderBufferDirect(new PerspectiveCamera(), new Scene(), geometry, material, screen, { start: 0, count: 3, materialIndex: 0 });
    expect(releaseDrawnGeometry(renderer)).toBe(0);
    // the composer's dispose deletes the GPU copies (the fake's buffers go with their uploads)
    gl.uploads.clear();
    geometry.dispose();
    for (const [name, values] of Object.entries(expected)) expect(Array.from(geometry.getAttribute(name).array)).toEqual(values);
  } finally { material.dispose(); }
});

// AT16 (meta ALPHA-2-TRAILER): n8ao's FullScreenTriangle is one module geometry shared by every AO pass's quads, and any
// quad's dispose disposes it. Nalati on the grid rebuilt its composer after the boot's release: the next AO pass uploaded
// the triangle's released uv zero-filled, every AO quad sampled one texel and the whole frame drew one flat colour.
for (const phone of [false, true]) test(`${phone ? 'phone' : 'desktop'} keeps n8ao's fullscreen triangle readable for the next AO pass`, () => {
  vi.stubGlobal('WebGL2RenderingContext', FakeGL);
  vi.stubGlobal('WebGLBuffer', FakeBuffer);
  const gl = new FakeGL(), renderer = Object.assign(textureUploadRenderer(), { getContext: () => gl });
  installFrameCounter(renderer); installMemorySaver(renderer, phone);
  const ao = new N8AOPostPass(new Scene(), new PerspectiveCamera(), 16, 16);
  const quad: unknown = Reflect.get(ao, 'copyQuad'), screen: unknown = typeof quad === 'object' && quad !== null ? Reflect.get(quad, '_mesh') : null;
  const shared: unknown = screen instanceof Mesh ? Reflect.get(screen, 'geometry') : null;
  if (!(screen instanceof Mesh) || !(shared instanceof BufferGeometry)) throw new Error('n8ao no longer draws a FullScreenTriangle mesh');
  const geometry: BufferGeometry = shared, material = new MeshBasicMaterial();
  geometry.computeBoundingSphere();
  const read = (name: string): number[] => { const a: unknown = geometry.getAttribute(name); return a instanceof BufferAttribute ? Array.from(a.array, Number) : []; };
  const expected = Object.fromEntries(Object.keys(geometry.attributes).map(name => [name, read(name)]));
  expect(expected['uv']).toEqual([0, 0, 2, 0, 0, 2]);
  try {
    for (const name of Object.keys(geometry.attributes)) {
      const attribute: unknown = geometry.getAttribute(name);
      if (!(attribute instanceof BufferAttribute)) continue;
      gl.bindBuffer(gl.ARRAY_BUFFER, new FakeBuffer());
      gl.bufferData(gl.ARRAY_BUFFER, attribute.array);
    }
    renderer.renderBufferDirect(new PerspectiveCamera(), new Scene(), geometry, material, screen, { start: 0, count: 3, materialIndex: 0 });
    expect(releaseDrawnGeometry(renderer)).toBe(0);
    // the AO pass's dispose deletes the triangle's GPU copies (the fake's buffers go with their uploads)
    gl.uploads.clear();
    ao.dispose();
    for (const [name, values] of Object.entries(expected)) expect(read(name)).toEqual(values);
  } finally { material.dispose(); }
});
