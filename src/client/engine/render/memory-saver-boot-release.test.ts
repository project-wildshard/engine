import { afterEach, expect, test, vi } from 'vitest';
import { BufferAttribute, BufferGeometry, Mesh, MeshBasicMaterial, PerspectiveCamera, Scene } from 'three';
import { textureUploadRenderer } from '../../../test/engine/textureUploadRenderer';
import { installMemorySaver, releaseDrawnGeometry } from './memorySaver';
import { arrayReleased } from './releasedArrays';
import { installFrameCounter } from './frameCounter';

// Mini QA 2026-11-17 row 19: the boot draws the world a handful of times, never the 240 renders a geometry waits before its
// CPU copy goes, so Nine's phone boot held 88-147 MB of attribute arrays beside their GPU copies through its peak.
class FakeBuffer { readonly id = Symbol('buffer'); }
class FakeGL {
  readonly ARRAY_BUFFER = 0x8892; readonly ARRAY_BUFFER_BINDING = 0x8894; readonly COPY_READ_BUFFER = 0x8f36;
  bound: FakeBuffer | null = new FakeBuffer();
  readonly uploads = new Map<FakeBuffer, ArrayBufferView>();
  bufferData(_target: number, data: ArrayBufferView): void { if (this.bound !== null) this.uploads.set(this.bound, data); }
  getParameter(): FakeBuffer | null { return this.bound; }
  bindBuffer(_target: number, buffer: FakeBuffer | null): void { this.bound = buffer; }
  isBuffer(buffer: FakeBuffer): boolean { return this.uploads.has(buffer); }
  getBufferSubData(_target: number, _offset: number, out: Float32Array): void {
    const source = this.bound === null ? undefined : this.uploads.get(this.bound);
    if (source instanceof Float32Array) out.set(source);
  }
}
afterEach(() => { vi.unstubAllGlobals(); });

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
