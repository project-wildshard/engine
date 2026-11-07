import { expect, test, vi } from 'vitest';
import { CompressedArrayTexture, CompressedCubeTexture, CompressedTexture, RGBA_S3TC_DXT5_Format } from 'three';
import { gpuOnlyTexture } from './gpuOnly';
import { assertCompressedMipmapsUnchanged, compressedMipmapsUploaded, finalizeCompressedMipmaps } from '../render/compressedMipmaps';
import { realGc } from '../../../test/engine/realGc';

function compressed(array: boolean): CompressedTexture {
  const mips = [{ data: new Uint8Array(array ? 32 : 16), width: 4, height: 4 }];
  return array ? new CompressedArrayTexture(mips, 4, 4, 2, RGBA_S3TC_DXT5_Format) : new CompressedTexture(mips, 4, 4, RGBA_S3TC_DXT5_Format);
}

test.each([false, true])('GPU-only compressed array=%s keeps mips until the existing successful-draw fence', array => {
  const texture = compressed(array), original = texture.mipmaps, hook = vi.fn<() => void>();
  texture.onUpdate = hook; texture.needsUpdate = true;
  try {
    gpuOnlyTexture(texture, 'immutable compressed product');
    texture.onUpdate?.(texture); compressedMipmapsUploaded(texture);
    expect(texture.onUpdate).toBe(hook); expect(hook).toHaveBeenCalledOnce();
    expect(texture.mipmaps).toBe(original);
    finalizeCompressedMipmaps(texture);
    expect(texture.mipmaps).toHaveLength(0);
    expect(texture.image.width).toBe(4); expect(texture.image.height).toBe(4);
    expect(texture.format).toBe(RGBA_S3TC_DXT5_Format);
    const anisotropy = texture.anisotropy; texture.anisotropy = 4;
    expect(() => { assertCompressedMipmapsUnchanged(texture); }).toThrow('changed after mip retirement');
    texture.anisotropy = anisotropy;
  } finally { texture.dispose(); }
});

test('unmarked compressed textures and cube-face storage keep their independent CPU reader contracts', () => {
  const plain = compressed(false), faces = Array.from({ length: 6 }, () => compressed(false)), cube = new CompressedCubeTexture(faces, RGBA_S3TC_DXT5_Format);
  try {
    finalizeCompressedMipmaps(plain); expect(plain.mipmaps).toHaveLength(1);
    gpuOnlyTexture(cube, 'cube retains its face sources'); finalizeCompressedMipmaps(cube);
    for (const face of faces) expect(face.mipmaps).toHaveLength(1);
  } finally { plain.dispose(); cube.dispose(); for (const face of faces) face.dispose(); }
});

const gcName = 'drawn compressed mip backings collect while the GPU-only texture remains live';
test(gcName, async () => {
  await realGc('src/client/engine/core/gpu-only-compressed-lifetime.test.ts', gcName, async collect => {
    const make = () => {
      const bytes = new Uint8Array(1024 * 1024);
      const texture = new CompressedTexture([{ data: bytes, width: 1024, height: 1024 }], 1024, 1024, RGBA_S3TC_DXT5_Format);
      texture.needsUpdate = true; gpuOnlyTexture(texture, 'compressed backing'); finalizeCompressedMipmaps(texture);
      return { texture, backing: new WeakRef(bytes.buffer) };
    };
    const result = make();
    try {
      await collect(result.backing); expect(result.texture.mipmaps).toHaveLength(0);
      expect(result.texture.image.width).toBe(1024); expect(result.texture.image.height).toBe(1024);
    } finally { result.texture.dispose(); }
  });
});
