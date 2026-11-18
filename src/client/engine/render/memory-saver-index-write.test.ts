import { afterAll, expect, test, vi } from 'vitest';
import { BufferAttribute, BufferGeometry, Mesh, MeshBasicMaterial, PerspectiveCamera, Scene } from 'three';
import { textureUploadRenderer } from '../../../test/engine/textureUploadRenderer';
import { indexTurned, installMemorySaver, releaseDrawnGeometry, writeIndexTriangles } from './memorySaver';
import { arrayReleased } from './releasedArrays';
import { rotateTriangles } from './drawHooks';

// MG10 (mini-ninemem6): a phone slab chunk's faced tree lands after the boot let its index go to the GPU. Reading the
// index back to rewrite it kept a CPU copy for the session (and the place-tree job read positions back too); the landing
// now writes the new triangles into the GPU buffer, turned as the index draws (WebKit's first-vertex convention).
class FakeBuffer { readonly id = Symbol('buffer'); }
class FakeGL {
  readonly ARRAY_BUFFER = 0x8892; readonly ARRAY_BUFFER_BINDING = 0x8894; readonly COPY_READ_BUFFER = 0x8f36; readonly COPY_WRITE_BUFFER = 0x8f37;
  readonly ELEMENT_ARRAY_BUFFER = 0x8893; readonly ELEMENT_ARRAY_BUFFER_BINDING = 0x8895; readonly COPY_READ_BUFFER_BINDING = 0x8f36;
  readonly COPY_WRITE_BUFFER_BINDING = 0x8f37;
  readonly bindings = new Map<number, FakeBuffer | null>();
  readonly uploads = new Map<FakeBuffer, ArrayBufferView>();
  readbacks = 0;
  bufferData(target: number, data: ArrayBufferView): void {
    const buffer = this.bindings.get(target);
    if (buffer !== undefined && buffer !== null) this.uploads.set(buffer, new Uint8Array(new Uint8Array(data.buffer, data.byteOffset, data.byteLength)));
  }
  bufferSubData(target: number, offset: number, data: ArrayBufferView): void {
    const buffer = this.bindings.get(target), into = buffer === undefined || buffer === null ? undefined : this.uploads.get(buffer);
    if (into === undefined) throw new Error('No buffer bound');
    new Uint8Array(into.buffer, into.byteOffset + offset, data.byteLength).set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
  }
  getParameter(binding: number): FakeBuffer | null {
    const target = binding === this.ARRAY_BUFFER_BINDING ? this.ARRAY_BUFFER : binding === this.ELEMENT_ARRAY_BUFFER_BINDING ? this.ELEMENT_ARRAY_BUFFER : binding;
    return this.bindings.get(target) ?? null;
  }
  bindBuffer(target: number, buffer: FakeBuffer | null): void { this.bindings.set(target, buffer); }
  isBuffer(buffer: FakeBuffer): boolean { return this.uploads.has(buffer); }
  getBufferSubData(target: number, _offset: number, out: ArrayBufferView): void {
    this.readbacks++;
    const buffer = this.bindings.get(target), source = buffer === undefined || buffer === null ? undefined : this.uploads.get(buffer);
    if (source !== undefined) new Uint8Array(out.buffer, out.byteOffset, out.byteLength).set(new Uint8Array(source.buffer, source.byteOffset, source.byteLength));
  }
}
afterAll(() => { vi.unstubAllGlobals(); });

function setup(): { gl: FakeGL; draw: (geometry: BufferGeometry, turn: boolean) => void; release: () => number; done: () => void } {
  vi.stubGlobal('WebGL2RenderingContext', FakeGL);
  vi.stubGlobal('WebGLBuffer', FakeBuffer);
  const gl = new FakeGL(), renderer = Object.assign(textureUploadRenderer(), { getContext: () => gl });
  installMemorySaver(renderer, true);
  const material = new MeshBasicMaterial(), scene = new Scene(), camera = new PerspectiveCamera();
  return {
    gl,
    draw: (geometry, turn) => {
      const index = geometry.index;
      if (index === null) throw new Error('Expected an index');
      if (turn) rotateTriangles(index);
      gl.bindBuffer(gl.ARRAY_BUFFER, new FakeBuffer());
      gl.bufferData(gl.ARRAY_BUFFER, geometry.getAttribute('position').array);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, new FakeBuffer());
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, index.array);
      renderer.renderBufferDirect(camera, scene, geometry, material, new Mesh(geometry, material), { start: 0, count: index.count, materialIndex: 0 });
    },
    release: () => releaseDrawnGeometry(renderer),
    done: () => { material.dispose(); },
  };
}
const quad = (padded: number): BufferGeometry => {
  const geometry = new BufferGeometry().setAttribute('position', new BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]), 3));
  geometry.setIndex(new BufferAttribute(new Uint16Array([0, 1, 2, 0, 2, 3, ...Array.from({ length: padded }, () => 0)]), 1));
  geometry.computeBoundingSphere();
  return geometry;
};

test('a released index takes new triangles on the GPU, turned as it draws, and is never read back', () => {
  const { gl, draw, release, done } = setup();
  const geometry = quad(3), index = geometry.index;
  if (index === null) throw new Error('Expected an index');
  draw(geometry, true);
  expect(indexTurned(index)).toBe(true);
  expect(release()).toBeGreaterThan(0);
  expect(arrayReleased(index)).toBe(true);
  const version = index.version;
  // the tree's order and one far triangle after the chunk's own, sent unturned
  expect(writeIndexTriangles(index, [{ at: 0, triangles: Uint32Array.of(0, 2, 3, 0, 1, 2) }, { at: 6, triangles: Uint32Array.of(1, 2, 3) }], false)).toBe(true);
  expect(gl.readbacks).toBe(0);
  expect(arrayReleased(index)).toBe(true);
  expect(index.version).toBe(version);
  expect(indexTurned(index)).toBe(true);
  // what the GPU holds (a later reader brings it back): each triangle turned `a b c` -> `c a b`
  expect(Array.from(index.array)).toEqual([3, 0, 2, 2, 0, 1, 3, 1, 2]);
  expect(gl.readbacks).toBe(1);
  geometry.dispose(); done();
});

test('an index still on the CPU takes them in its array and keeps drawing turned', () => {
  const { draw, done } = setup();
  const geometry = quad(0), index = geometry.index;
  if (index === null) throw new Error('Expected an index');
  draw(geometry, true);
  const version = index.version;
  expect(writeIndexTriangles(index, [{ at: 0, triangles: Uint32Array.of(0, 2, 3, 0, 1, 2) }], false)).toBe(true);
  expect(arrayReleased(index)).toBe(false);
  expect(index.version).toBe(version + 1);
  expect(indexTurned(index)).toBe(true);
  expect(Array.from(index.array)).toEqual([3, 0, 2, 2, 0, 1]);
  geometry.dispose(); done();
});

test('an index never turned takes the triangles as sent; a disposed buffer takes nothing', () => {
  const { gl, draw, release, done } = setup();
  const geometry = quad(0), index = geometry.index;
  if (index === null) throw new Error('Expected an index');
  draw(geometry, false);
  release();
  expect(writeIndexTriangles(index, [{ at: 0, triangles: Uint32Array.of(0, 2, 3, 0, 1, 2) }], false)).toBe(true);
  expect(Array.from(index.array)).toEqual([0, 2, 3, 0, 1, 2]);
  const other = quad(0), otherIndex = other.index;
  if (otherIndex === null) throw new Error('Expected an index');
  draw(other, false);
  release();
  gl.uploads.clear();
  expect(writeIndexTriangles(otherIndex, [{ at: 0, triangles: Uint32Array.of(0, 2, 3, 0, 1, 2) }], false)).toBe(false);
  geometry.dispose(); other.dispose(); done();
});
