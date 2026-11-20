import { RGFormat, UnsignedByteType, type DataTexture } from 'three';
import type { Scope } from '@wildshard/engine/app/scope';
import { nextDrawnFrame } from '@wildshard/engine/core/framePacing';
import type { Renderer } from '@wildshard/engine/render/renderer';

const BAND_BYTES = 256 * 1024;

/** Allocate the normal Three texture and upload one RG8 band between draws.
 * The caller owns the detached texture and publishes it only after this resolves. */
export async function stageRoadSignAtlas(renderer: Renderer, atlas: DataTexture, owner: Scope): Promise<void> {
  if (atlas.format !== RGFormat || atlas.type !== UnsignedByteType) return;
  const image: unknown = atlas.image;
  if (typeof image !== 'object' || image === null || !('data' in image)
    || !('width' in image) || typeof image.width !== 'number' || !('height' in image) || typeof image.height !== 'number') return;
  const { data, width, height } = image;
  if (!(data instanceof Uint8Array) || data.byteLength !== width * height * 2 || data.byteLength <= BAND_BYTES) return;
  const gl = renderer.getContext(), { state } = renderer;
  if (!(gl instanceof WebGL2RenderingContext) || Math.max(width, height) > renderer.capabilities.maxTextureSize) return;
  const rowsPerBand = Math.max(1, Math.floor(BAND_BYTES / (width * 2)));
  const wait = async (): Promise<void> => {
    await nextDrawnFrame(owner);
    if (owner.disposed || owner.disposing || gl.isContextLost()) throw new Error('Road sign atlas upload was interrupted');
  };

  // Preserve Three's format, sampler and mip allocation while skipping its single large base-level transfer.
  await wait();
  atlas.source.dataReady = false;
  try { renderer.initTexture(atlas); }
  finally { atlas.source.dataReady = true; }
  const properties: unknown = renderer.properties.get(atlas);
  const handle: unknown = typeof properties === 'object' && properties !== null ? Reflect.get(properties, '__webglTexture') : null;
  if (!(handle instanceof WebGLTexture)) throw new Error('Road sign atlas has no WebGL allocation');

  for (let row = 0; row < height; row += rowsPerBand) {
    await wait();
    state.bindTexture(gl.TEXTURE_2D, handle);
    try {
      state.pixelStorei(gl.UNPACK_ALIGNMENT, atlas.unpackAlignment);
      state.pixelStorei(gl.UNPACK_ROW_LENGTH, 0);
      state.pixelStorei(gl.UNPACK_SKIP_PIXELS, 0);
      state.pixelStorei(gl.UNPACK_SKIP_ROWS, 0);
      state.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      state.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, row, width, Math.min(rowsPerBand, height - row), gl.RG, gl.UNSIGNED_BYTE, data, row * width * 2);
    } finally { state.unbindTexture(); }
  }

  await wait();
  state.bindTexture(gl.TEXTURE_2D, handle);
  try { gl.generateMipmap(gl.TEXTURE_2D); }
  finally { state.unbindTexture(); }
  image.data = new Uint8Array(0);
}
