import { expect, test, vi } from 'vitest';
import { BufferGeometry, CompressedArrayTexture, CompressedTexture, Mesh, MeshBasicMaterial, PerspectiveCamera, RGBA_S3TC_DXT5_Format, Scene, WebGLRenderer } from 'three';
import { gpuOnlyTexture } from './gpuOnly';
import { uploadCompressedTexture } from '../render/compressedUpload';
import { installCompressedTextureRetirement } from '../render/compressedTextureRetirement';
import { pageScope } from '../../../shared/engine/app/resources';

function nativeDraw(texture: CompressedTexture) {
  const renderer: unknown = Object.create(WebGLRenderer.prototype);
  if (!(renderer instanceof WebGLRenderer)) throw new Error('Missing native renderer fixture');
  const records = new WeakMap<object, Record<string, unknown>>(), flags = { uploaded: false, sourceComplete: true, fail: false };
  const get = (value: object): Record<string, unknown> => {
    let row = records.get(value); if (row === undefined) { row = {}; records.set(value, row); } return row;
  };
  const initTexture = (value: CompressedTexture): void => {
    renderer.properties.get(value);
    if (get(value)['__version'] === value.version && get(value.source)['__version'] === value.source.version) return;
    get(value)['__webglTexture'] ??= {};
    get(value)['__version'] = value.version;
    if (flags.sourceComplete) get(value.source)['__version'] = value.source.version;
  };
  const fields: Record<string, unknown> = {
    properties: { get }, initTexture, getContext: () => ({ isContextLost: () => false, NO_ERROR: 0, getError: () => 0 }),
    renderBufferDirect: () => {
      renderer.properties.get(texture);
      if (flags.uploaded) initTexture(texture);
      if (flags.fail) throw new Error('native draw failed');
    },
  };
  for (const [name, value] of Object.entries(fields)) Reflect.set(renderer, name, value);
  const geometry = new BufferGeometry(), material = new MeshBasicMaterial(), camera = new PerspectiveCamera(), scene = new Scene(), mesh = new Mesh();
  return { renderer, flags, draw: () => { renderer.renderBufferDirect(camera, scene, geometry, material, mesh, { start: 0, count: 0, materialIndex: 0 }); },
    close: () => { geometry.dispose(); material.dispose(); } };
}

test.each([false, true])('declared compressed array=%s retires at a successful native draw without its own warm-up', async array => {
  const mips = [{ data: new Uint8Array(array ? 32 : 16), width: 4, height: 4 }];
  const texture = array ? new CompressedArrayTexture(mips, 4, 4, 2, RGBA_S3TC_DXT5_Format) : new CompressedTexture(mips, 4, 4, RGBA_S3TC_DXT5_Format);
  const control = new CompressedTexture([{ data: new Uint8Array(16), width: 4, height: 4 }], 4, 4, RGBA_S3TC_DXT5_Format);
  const native = nativeDraw(texture);
  const raf = vi.spyOn(pageScope, 'raf').mockImplementation(run => { queueMicrotask(() => { run(0); }); return 0; });
  const timeout = vi.spyOn(pageScope, 'timeout').mockImplementation((_ms, run) => { queueMicrotask(run); return 0; });
  try {
    installCompressedTextureRetirement(native.renderer);
    const observed: unknown = Reflect.get(native.renderer, 'renderBufferDirect'); installCompressedTextureRetirement(native.renderer);
    expect(Reflect.get(native.renderer, 'renderBufferDirect')).toBe(observed); expect(raf).not.toHaveBeenCalled(); expect(timeout).not.toHaveBeenCalled();
    control.needsUpdate = true;
    // A different provisional loader input still keeps its original preparation fence.
    await uploadCompressedTexture(native.renderer, control, () => true, false);
    texture.needsUpdate = true; gpuOnlyTexture(texture, 'direct compressed draw');
    native.draw(); expect(texture.mipmaps).toBe(mips);
    native.flags.uploaded = true; native.flags.sourceComplete = false; native.draw(); expect(texture.mipmaps).toBe(mips);
    native.flags.sourceComplete = true; native.flags.fail = true;
    expect(native.draw).toThrow('native draw failed'); expect(texture.mipmaps).toBe(mips);
    native.flags.fail = false; native.draw();
    expect(texture.mipmaps).toHaveLength(0); expect(control.mipmaps).toHaveLength(1);
    const empty = texture.mipmaps; native.draw(); expect(texture.mipmaps).toBe(empty);
    expect(texture.image.width).toBe(4); expect(texture.image.height).toBe(4);
  } finally { raf.mockRestore(); timeout.mockRestore(); native.close(); texture.dispose(); control.dispose(); }
});
