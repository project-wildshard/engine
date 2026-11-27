// @ts-check
/** SF20 (J525): a shardfile carries images (PNG, JPEG, and GLBs holding them) and the cook makes their KTX2, so a tile
 * budget counts an image as the cooked KTX2 the runtime reads, not as the image file the cook replaces.
 *
 * The cook (`imageKtx2Wasm.ts`) writes each PNG or JPEG whose sides are whole 4x4 blocks as a UASTC LDR 4x4 KTX2 with its
 * full mip chain, Zstandard-supercompressed. So the cooked cost of one such image is:
 *
 *   decoded     0: a KTX2 uploads its blocks, nothing is kept decoded (the format's `parseKtx2`)
 *   gpu         every level at four bytes a texel, `parseKtx2`'s charge with no GPU support claimed
 *   compressed  the cooked file's exact size when the caller passes the cook's encoder (`ktx2Bytes`); without one, the
 *               image's own bytes. Zstandard folds UASTC by 11 to 57% on the open plots' images, so no formula stands in
 *               for the encode: `cookedKtx2Cost` gives the bound (the levels' 16-byte blocks before Zstandard), never a count.
 *
 * An image the cook leaves alone (WebP, off the block grid) keeps its own cost. Pure: bytes in, numbers out. */

const KTX2_FIXED = 80, LEVEL_ROW = 24, KTX2_DESCRIPTORS = 256;
const GLB_MAGIC = 0x46546c67, JSON_CHUNK = 0x4e4f534a;

/** A PNG's or a JPEG's size from its header, or undefined for anything else (WebP, KTX2, a torn file).
 * @param {Uint8Array} bytes @returns {{width:number,height:number}|undefined} */
export function imageSize(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length >= 24 && view.getUint32(0) === 0x89504e47 && view.getUint32(4) === 0x0d0a1a0a) return { width: view.getUint32(16), height: view.getUint32(20) };
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return undefined;
  for (let at = 2; at + 9 < bytes.length;) {
    if (bytes[at] !== 0xff) return undefined;
    const marker = bytes[at + 1] ?? 0, length = view.getUint16(at + 2);
    // SOF0 to SOF15, less DHT (C4), JPG (C8) and DAC (CC): the frame header holds the size.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return { width: view.getUint16(at + 7), height: view.getUint16(at + 5) };
    at += 2 + length;
  }
  return undefined;
}

/** What the cook's KTX2 of a width x height image costs, or undefined when the cook leaves the image as it is.
 * @param {{width:number,height:number}|undefined} size @returns {{decoded:number,gpu:number,compressed:number}|undefined} */
export function cookedKtx2Cost(size) {
  if (size === undefined || size.width < 1 || size.height < 1 || size.width % 4 !== 0 || size.height % 4 !== 0) return undefined;
  let gpu = 0, blocks = 0, levels = 0;
  for (let w = size.width, h = size.height; ; w = Math.max(1, w >> 1), h = Math.max(1, h >> 1)) {
    gpu += w * h * 4; blocks += Math.ceil(w / 4) * Math.ceil(h / 4) * 16; levels++;
    if (w === 1 && h === 1) break;
  }
  return { decoded: 0, gpu, compressed: KTX2_FIXED + levels * LEVEL_ROW + KTX2_DESCRIPTORS + blocks };
}

/** The format's charge for a still image: decoded is its RGBA plus four times its bytes (`stillImage.ts`), gpu its RGBA.
 * @param {{width:number,height:number}} size @param {number} bytes @param {boolean} mips */
function imageCharge(size, bytes, mips) {
  let gpu = 0;
  for (let w = size.width, h = size.height; ; w = Math.max(1, Math.floor(w / 2)), h = Math.max(1, Math.floor(h / 2))) {
    gpu += w * h * 4;
    if (!mips || (w === 1 && h === 1)) break;
  }
  return { decoded: size.width * size.height * 4 + bytes * 4, gpu };
}

/** The cook's KTX2 of one image, as its byte length; undefined keeps the image's own bytes.
 * @typedef {(image: Uint8Array, as: {standalone: boolean}) => number|undefined} Ktx2Bytes */

/** A shardfile file row's cost once the cook has made its KTX2: a standalone image, or a GLB with every embedded PNG and JPEG
 * swapped for its KTX2. Undefined when the cook changes nothing in it.
 * @param {{kind?:string,decoded:number,gpu:number,compressed:number}} row @param {Uint8Array} bytes @param {Ktx2Bytes} [ktx2Bytes]
 * @returns {{decoded:number,gpu:number,compressed:number}|undefined} */
export function cookedFileCost(row, bytes, ktx2Bytes) {
  if (row.kind === 'image') {
    const size = imageSize(bytes), cooked = cookedKtx2Cost(size);
    if (size === undefined || cooked === undefined) return undefined;
    const own = imageCharge(size, bytes.length, false);
    const file = ktx2Bytes?.(bytes, { standalone: true });
    return { decoded: Math.max(0, row.decoded - own.decoded), gpu: row.gpu - own.gpu + cooked.gpu, compressed: file === undefined ? row.compressed : row.compressed - bytes.length + file };
  }
  if (row.kind !== 'glb' || bytes.length < 20) return undefined;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== GLB_MAGIC || view.getUint32(16, true) !== JSON_CHUNK) return undefined;
  const length = view.getUint32(12, true), bin = 20 + length + 8;
  /** @type {{images?:{bufferView?:number,mimeType?:string}[],bufferViews?:{byteOffset?:number,byteLength:number}[]}} */
  const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + length)));
  let decoded = row.decoded, gpu = row.gpu, compressed = row.compressed, changed = false;
  for (const image of json.images ?? []) {
    if (image.mimeType !== 'image/png' && image.mimeType !== 'image/jpeg') continue;
    const view = image.bufferView === undefined ? undefined : json.bufferViews?.[image.bufferView];
    if (view === undefined) continue;
    const start = bin + (view.byteOffset ?? 0), body = bytes.subarray(start, start + view.byteLength);
    const size = imageSize(body), cooked = cookedKtx2Cost(size);
    if (size === undefined || cooked === undefined) continue;
    const own = imageCharge(size, body.length, true);
    const file = ktx2Bytes?.(body, { standalone: false });
    decoded -= own.decoded; gpu += cooked.gpu - own.gpu; compressed += file === undefined ? 0 : file - body.length; changed = true;
  }
  return changed ? { decoded: Math.max(0, decoded), gpu, compressed } : undefined;
}
