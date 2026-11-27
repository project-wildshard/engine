/**
 * SF17 (J525): a data map is read byte for byte (Sunscar Dunes' sand grain, trail and key-shadow maps), so a lossy encode
 * would change what the shader reads. A shardfile carries it as a PNG (8-bit grey for an R8 map, RGB or RGBA for RGBA8), and
 * the cook writes it as a single-level KTX2, R8 or RGBA8 UNORM, linear, its level zstd-supercompressed: decoded, the PNG's
 * texels exactly, which three's KTX2 loader hands the page as a DataTexture (the shape `sand.ts` `rawKtx2` made by hand).
 */
// oxlint-disable-next-line import/no-nodejs-modules -- the cook runs in Node.
import {constants, inflateSync, zstdCompressSync} from 'node:zlib';

/** The level the maps are supercompressed at (`sand.ts` `SAND_ZSTD_LEVEL`). */
const DATA_ZSTD_LEVEL = 19;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;
const KTX2_IDENTIFIER = [0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a] as const;
const VK_R8_UNORM = 9, VK_R8G8B8A8_UNORM = 37, ZSTD_SCHEME = 2, HEADER_BYTES = 104;
const GREY = 0, RGB = 2, RGBA = 6;

/** A PNG's texels: one byte a channel, `channels` 1 (grey) or 4 (RGB gains an opaque alpha). */
export interface DataTexels {readonly width: number; readonly height: number; readonly channels: 1 | 4; readonly texels: Uint8Array}

const paeth = (left: number, up: number, corner: number): number => {
  const guess = left + up - corner, toLeft = Math.abs(guess - left), toUp = Math.abs(guess - up), toCorner = Math.abs(guess - corner);
  if (toLeft <= toUp && toLeft <= toCorner) return left;
  return toUp <= toCorner ? up : corner;
};

/** Undo each scanline's filter in place (PNG's five filter types). */
function unfilter(raw: Uint8Array, width: number, height: number, stride: number): Uint8Array | undefined {
  const row = width * stride, out = new Uint8Array(row * height);
  for (let y = 0; y < height; y++) {
    const kind = raw[y * (row + 1)], from = y * (row + 1) + 1, at = y * row;
    for (let x = 0; x < row; x++) {
      const value = raw[from + x] ?? 0, left = x >= stride ? out[at + x - stride] ?? 0 : 0, up = y > 0 ? out[at - row + x] ?? 0 : 0;
      const corner = y > 0 && x >= stride ? out[at - row + x - stride] ?? 0 : 0;
      if (kind === 0) out[at + x] = value;
      else if (kind === 1) out[at + x] = value + left;
      else if (kind === 2) out[at + x] = value + up;
      else if (kind === 3) out[at + x] = value + ((left + up) >> 1);
      else if (kind === 4) out[at + x] = value + paeth(left, up, corner);
      else return undefined;
    }
  }
  return out;
}

/** A PNG's texels, or undefined for one this map path doesn't take (not a PNG, not 8-bit grey, RGB or RGBA, interlaced). */
export function pngTexels(png: Uint8Array): DataTexels | undefined {
  if (!PNG_SIGNATURE.every((byte, at) => png[at] === byte)) return undefined;
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength), data: Uint8Array[] = [];
  let width = 0, height = 0, type = -1, at = PNG_SIGNATURE.length;
  while (at + 8 <= png.length) {
    const length = view.getUint32(at), name = String.fromCodePoint(...png.subarray(at + 4, at + 8)), body = png.subarray(at + 8, at + 8 + length);
    if (name === 'IHDR') {
      width = view.getUint32(at + 8); height = view.getUint32(at + 12); type = body[9] ?? -1;
      if (body[8] !== 8 || body[12] !== 0 || ![GREY, RGB, RGBA].includes(type)) return undefined;
    } else if (name === 'IDAT') data.push(body);
    else if (name === 'IEND') break;
    at += 12 + length;
  }
  if (width === 0 || height === 0 || data.length === 0) return undefined;
  const stride = type === GREY ? 1 : type === RGB ? 3 : 4;
  const joined = new Uint8Array(data.reduce((sum, part) => sum + part.length, 0));
  data.reduce((offset, part) => { joined.set(part, offset); return offset + part.length; }, 0);
  const texels = unfilter(new Uint8Array(inflateSync(joined)), width, height, stride);
  if (texels === undefined) return undefined;
  if (stride !== 3) return {width, height, channels: stride === 1 ? 1 : 4, texels};
  const rgba = new Uint8Array(width * height * 4);
  for (let texel = 0; texel < width * height; texel++) { rgba.set(texels.subarray(texel * 3, texel * 3 + 3), texel * 4); rgba[texel * 4 + 3] = 255; }
  return {width, height, channels: 4, texels: rgba};
}

/** The texels as a single-level zstd R8 or RGBA8 KTX2 (linear BT.709 DFD, one byte a channel). */
export function rawDataKtx2({width, height, channels, texels}: DataTexels): Uint8Array {
  const packed = new Uint8Array(zstdCompressSync(texels, {params: {[constants.ZSTD_c_compressionLevel]: DATA_ZSTD_LEVEL}}));
  const dfdSize = 28 + 16 * channels, at = HEADER_BYTES + dfdSize, out = new Uint8Array(at + packed.length), view = new DataView(out.buffer);
  out.set(KTX2_IDENTIFIER);
  // vkFormat, typeSize, width, height, depth, layers, faces, levels, supercompression, dfd offset and size (no key/values)
  for (const [index, value] of [channels === 1 ? VK_R8_UNORM : VK_R8G8B8A8_UNORM, 1, width, height, 0, 0, 1, 1, ZSTD_SCHEME, HEADER_BYTES, dfdSize].entries()) view.setUint32(12 + index * 4, value, true);
  view.setBigUint64(80, BigInt(at), true); view.setBigUint64(88, BigInt(packed.length), true); view.setBigUint64(96, BigInt(texels.length), true);
  // the basic descriptor: RGBSDA model, BT.709 primaries, linear transfer; bytesPlane0 stays 0 under supercompression
  view.setUint32(HEADER_BYTES, dfdSize, true); view.setUint16(HEADER_BYTES + 8, 2, true); view.setUint16(HEADER_BYTES + 10, dfdSize - 4, true);
  out.set([1, 1, 1, 0], HEADER_BYTES + 12);
  for (let channel = 0; channel < channels; channel++) {
    const sample = HEADER_BYTES + 28 + channel * 16;
    view.setUint16(sample, channel * 8, true); out[sample + 2] = 7; out[sample + 3] = channel === 3 ? 15 : channel; view.setUint32(sample + 12, 255, true);
  }
  out.set(packed, at);
  return out;
}

/** A data map PNG as its lossless KTX2, or undefined when the PNG isn't one `pngTexels` takes. */
export function dataKtx2(png: Uint8Array): Uint8Array | undefined {
  const texels = pngTexels(png);
  return texels === undefined ? undefined : rawDataKtx2(texels);
}
