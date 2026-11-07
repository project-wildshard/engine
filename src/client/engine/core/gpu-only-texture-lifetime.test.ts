import { expect, test } from 'vitest';
import { DataTexture, FloatType, HalfFloatType, RGBAFormat, UnsignedByteType } from 'three';
import { gpuOnlyTexture } from './gpuOnly';
import { installTextureUploadEvents, type TextureUploadRenderer } from '../render/textureUploadEvents';
import { realGc } from '../../../test/engine/realGc';

function renderer(): TextureUploadRenderer {
  const versions = new WeakMap<object, { __version: number }>();
  const made: TextureUploadRenderer = {
    properties: { get: object => typeof object === 'object' && object !== null ? versions.get(object) : undefined },
    initTexture: texture => {
      made.properties.get(texture); texture.onUpdate?.(texture);
      versions.set(texture, { __version: texture.version });
      versions.set(texture.source, { __version: texture.source.version });
    }, render: () => undefined,
  };
  installTextureUploadEvents(made); return made;
}

const variants = [
  { name: 'float32', make: () => new Float32Array(16), type: FloatType },
  { name: 'half-float', make: () => new Uint16Array(16), type: HalfFloatType },
  { name: 'clamped bytes', make: () => new Uint8ClampedArray(16), type: UnsignedByteType },
];
test.each(variants)('GPU-only $name pixels release after upload without changing their interpretation', ({ make, type }) => {
  const data = make(), texture = new DataTexture(data, 2, 2, RGBAFormat, type), native = renderer();
  texture.needsUpdate = true; gpuOnlyTexture(texture, 'typed raw texture');
  try {
    expect(texture.image.data).toBe(data);
    native.initTexture(texture);
    const empty = texture.image.data;
    expect(empty?.constructor).toBe(data.constructor); expect(empty?.byteLength).toBe(0);
    expect(empty?.buffer).not.toBe(data.buffer);
    expect(texture.image.width).toBe(2); expect(texture.image.height).toBe(2);
    expect(texture.format).toBe(RGBAFormat); expect(texture.type).toBe(type);
    native.initTexture(texture); expect(texture.image.data).toBe(empty);
  } finally { texture.dispose(); }
});

const mipName = 'uploaded raw mip backings collect while the GPU-only texture remains live';
test(mipName, async () => {
  await realGc('src/client/engine/core/gpu-only-texture-lifetime.test.ts', mipName, async collect => {
    const native = renderer();
    const make = () => {
      const level0 = new Uint8Array(1024 * 1024), level1 = new Uint8Array(256 * 1024);
      const texture = new DataTexture(level0, 512, 512);
      texture.mipmaps = [{ data: level0, width: 512, height: 512 }, { data: level1, width: 256, height: 256 }];
      texture.needsUpdate = true; gpuOnlyTexture(texture, 'raw mip chain'); native.initTexture(texture);
      return { texture, zero: new WeakRef(level0.buffer), one: new WeakRef(level1.buffer) };
    };
    const result = make();
    try {
      await collect(result.zero); await collect(result.one);
      expect(result.texture.image.data?.byteLength).toBe(0); expect(result.texture.mipmaps).toHaveLength(0);
      expect(result.texture.image.width).toBe(512); expect(result.texture.image.height).toBe(512);
    } finally { result.texture.dispose(); }
  });
});
