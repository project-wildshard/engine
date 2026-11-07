import { expect, test } from 'vitest';
import { CompressedTexture } from 'three';
import { assertCompressedMipmapsUnchanged, finalizeCompressedMipmaps, registerCompressedMipmaps } from './compressedMipmaps';

const samplers = ['wrapS', 'wrapT', 'wrapR', 'magFilter', 'minFilter', 'anisotropy', 'internalFormat',
  'format', 'type', 'generateMipmaps', 'premultiplyAlpha', 'flipY', 'unpackAlignment', 'colorSpace'] as const;
function retiredTexture(): CompressedTexture {
  const texture = new CompressedTexture([], 1, 1);
  registerCompressedMipmaps(texture, true); finalizeCompressedMipmaps(texture);
  return texture;
}

test.each(samplers)('retired compressed storage refuses a changed %s before native use', field => {
  const texture = retiredTexture();
  try {
    expect(() => { assertCompressedMipmapsUnchanged(texture); }).not.toThrow();
    const prior: unknown = Reflect.get(texture, field);
    const changed = typeof prior === 'number' ? prior + 1 : typeof prior === 'boolean' ? !prior : prior === null ? 'changed' : 1;
    Reflect.set(texture, field, changed);
    expect(() => { assertCompressedMipmapsUnchanged(texture); }).toThrow('changed after mip retirement');
  } finally { texture.dispose(); }
});

test.each(['texture', 'source'] as const)('retired compressed storage refuses a new %s version', target => {
  const texture = retiredTexture();
  try {
    if (target === 'texture') texture.needsUpdate = true;
    else texture.source.needsUpdate = true;
    expect(() => { assertCompressedMipmapsUnchanged(texture); }).toThrow('changed after mip retirement');
  } finally { texture.dispose(); }
});

test('preparation remains mutable and a known retired mutation short circuits later getters', () => {
  const preparing = new CompressedTexture([], 1, 1), retired = retiredTexture();
  try {
    preparing.flipY = !preparing.flipY;
    expect(() => { assertCompressedMipmapsUnchanged(preparing); }).not.toThrow();
    retired.wrapS++;
    Object.defineProperty(retired, 'minFilter', {get: () => {throw new Error('Read after known storage mutation');}});
    expect(() => { assertCompressedMipmapsUnchanged(retired); }).toThrow('changed after mip retirement');
  } finally { preparing.dispose(); retired.dispose(); }
});
