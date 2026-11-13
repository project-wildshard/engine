/** S12 (J330): cook-side tier masters, first slice. A shard holds one master per texture at the largest size any tier
 * wants; the cook gives each tier its own size by dropping the KTX2 mip levels above that tier's largest. No re-encode:
 * every level a tier keeps is the master's own bytes, so a phone draws the master's own pixels at every distance where
 * the master's top level was minified anyway, which is most of what a phone draws.
 *
 * Cuttable: UASTC (`vkFormat` 0) and raw ASTC, with Zstandard or no supercompression, whose levels stand alone.
 * BasisLZ (ETC1S) shares a codebook across levels, so it stays as it is until the cook re-encodes (S12b).
 *
 * GLBs carry their images inside (57 of Pine's 102 MB of `.glb`). `glbImages` takes them out, and `tierGlb` puts each
 * back at the tier's size, moving every other buffer view and meshopt stream by whole 16-byte steps so no alignment
 * changes. Pure bytes in, bytes out: no file system, no shardfile; `shardCook` wiring is S12a. */

const KTX2_ID = [0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a];
const LEVEL_INDEX = 80;
const BASIS_LZ = 1;
const GLB_MAGIC = 0x46546c67, JSON_CHUNK = 0x4e4f534a, BIN_CHUNK = 0x004e4942;

/** Vulkan ASTC formats (UNORM and SRGB pairs) to their block size. */
const ASTC_BLOCKS: Readonly<Record<number, readonly [number, number]>> = {
  157: [4, 4], 158: [4, 4], 159: [5, 4], 160: [5, 4], 161: [5, 5], 162: [5, 5], 163: [6, 5], 164: [6, 5],
  165: [6, 6], 166: [6, 6], 167: [8, 5], 168: [8, 5], 169: [8, 6], 170: [8, 6], 171: [8, 8], 172: [8, 8],
};

export interface Ktx2Info {
  readonly vkFormat: number;
  readonly width: number;
  readonly height: number;
  readonly levels: number;
  readonly scheme: number;
}

const viewOf = (bytes: Uint8Array): DataView => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

export function isKtx2(bytes: Uint8Array): boolean {
  return bytes.length >= LEVEL_INDEX && KTX2_ID.every((byte, at) => bytes[at] === byte);
}

export function ktx2Info(bytes: Uint8Array): Ktx2Info {
  if (!isKtx2(bytes)) throw new Error('Not a KTX2 file');
  const view = viewOf(bytes);
  return {vkFormat: view.getUint32(12, true), width: view.getUint32(20, true), height: view.getUint32(24, true), levels: view.getUint32(40, true), scheme: view.getUint32(44, true)};
}

/** The same texture with its largest side at most `maxSize`, or the same bytes when there is nothing it can cut. */
export function trimKtx2(bytes: Uint8Array, maxSize: number): Uint8Array {
  if (!isKtx2(bytes)) return bytes;
  const view = viewOf(bytes), info = ktx2Info(bytes);
  const depth = view.getUint32(28, true), layers = view.getUint32(32, true), faces = view.getUint32(36, true);
  if (info.scheme === BASIS_LZ || info.levels <= 1 || depth > 1 || layers > 1 || faces !== 1) return bytes;
  let drop = 0;
  while (drop < info.levels - 1 && Math.max(info.width >> drop, info.height >> drop) > maxSize) drop++;
  if (drop === 0) return bytes;

  const levels = info.levels - drop, dfdAt = view.getUint32(48, true), dfdLength = view.getUint32(52, true);
  const kvdAt = view.getUint32(56, true), kvdLength = view.getUint32(60, true);
  const sgdAt = Number(view.getBigUint64(64, true)), sgdLength = Number(view.getBigUint64(72, true));
  const kept = Array.from({length: levels}, (_, level) => {
    const entry = LEVEL_INDEX + 24 * (level + drop);
    const at = Number(view.getBigUint64(entry, true)), length = Number(view.getBigUint64(entry + 8, true));
    return {body: bytes.subarray(at, at + length), uncompressed: view.getBigUint64(entry + 16, true)};
  });
  // Unsupercompressed levels sit on 16 bytes (every cuttable block is 16 bytes, and 16 is a multiple of 4); compressed ones on 1.
  const levelAlign = info.scheme === 0 ? 16 : 1;
  const align = (at: number, to: number): number => Math.ceil(at / to) * to;
  const newDfd = LEVEL_INDEX + 24 * levels, newKvd = kvdLength === 0 ? 0 : newDfd + dfdLength;
  let at = newDfd + dfdLength + kvdLength;
  const newSgd = sgdLength === 0 ? 0 : align(at, 8);
  if (sgdLength > 0) at = newSgd + sgdLength;
  const offsets: number[] = [];
  for (let level = levels - 1; level >= 0; level--) { at = align(at, levelAlign); offsets[level] = at; at += kept[level]?.body.length ?? 0; }

  const out = new Uint8Array(at), write = viewOf(out);
  out.set(bytes.subarray(0, LEVEL_INDEX));
  write.setUint32(20, Math.max(1, info.width >> drop), true);
  write.setUint32(24, info.height === 0 ? 0 : Math.max(1, info.height >> drop), true);
  write.setUint32(40, levels, true);
  write.setUint32(48, newDfd, true);
  write.setUint32(56, newKvd, true);
  write.setBigUint64(64, BigInt(newSgd), true);
  out.set(bytes.subarray(dfdAt, dfdAt + dfdLength), newDfd);
  if (kvdLength > 0) out.set(bytes.subarray(kvdAt, kvdAt + kvdLength), newKvd);
  if (sgdLength > 0) out.set(bytes.subarray(sgdAt, sgdAt + sgdLength), newSgd);
  kept.forEach(({body, uncompressed}, level) => {
    const entry = LEVEL_INDEX + 24 * level, offset = offsets[level] ?? 0;
    write.setBigUint64(entry, BigInt(offset), true);
    write.setBigUint64(entry + 8, BigInt(body.length), true);
    write.setBigUint64(entry + 16, uncompressed, true);
    out.set(body, offset);
  });
  return out;
}

interface GltfView {buffer: number; byteOffset?: number; byteLength: number; extensions?: {EXT_meshopt_compression?: {buffer: number; byteOffset?: number; byteLength: number}}}
interface Gltf {bufferViews?: GltfView[]; buffers?: {byteLength: number; uri?: string}[]; images?: {bufferView?: number; mimeType?: string; uri?: string}[]}
interface Glb {readonly json: Gltf; readonly bin: Uint8Array}

function readGlb(bytes: Uint8Array): Glb | undefined {
  if (bytes.length < 20) return undefined;
  const view = viewOf(bytes);
  if (view.getUint32(0, true) !== GLB_MAGIC || view.getUint32(16, true) !== JSON_CHUNK) return undefined;
  const jsonLength = view.getUint32(12, true), json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength))) as Gltf;
  const binAt = 20 + jsonLength;
  if (binAt + 8 > bytes.length || view.getUint32(binAt + 4, true) !== BIN_CHUNK) return {json, bin: new Uint8Array()};
  return {json, bin: bytes.subarray(binAt + 8, binAt + 8 + view.getUint32(binAt, true))};
}

function writeGlb(json: Gltf, bin: Uint8Array): Uint8Array {
  const text = new TextEncoder().encode(JSON.stringify(json)), jsonLength = Math.ceil(text.length / 4) * 4, binLength = Math.ceil(bin.length / 4) * 4;
  const out = new Uint8Array(12 + 8 + jsonLength + (binLength > 0 ? 8 + binLength : 0)), view = viewOf(out);
  view.setUint32(0, GLB_MAGIC, true); view.setUint32(4, 2, true); view.setUint32(8, out.length, true);
  view.setUint32(12, jsonLength, true); view.setUint32(16, JSON_CHUNK, true);
  out.fill(0x20, 20, 20 + jsonLength); out.set(text, 20);
  if (binLength > 0) { view.setUint32(20 + jsonLength, binLength, true); view.setUint32(24 + jsonLength, BIN_CHUNK, true); out.set(bin, 28 + jsonLength); }
  return out;
}

export interface GlbImage {readonly index: number; readonly mimeType: string; readonly bytes: Uint8Array}

/** Every image a GLB carries in its own buffer, in image order. */
export function glbImages(bytes: Uint8Array): readonly GlbImage[] {
  const glb = readGlb(bytes);
  if (glb === undefined) return [];
  return (glb.json.images ?? []).flatMap((image, index) => {
    const view = image.bufferView === undefined ? undefined : glb.json.bufferViews?.[image.bufferView];
    if (view?.buffer !== 0) return [];
    const at = view.byteOffset ?? 0;
    return [{index, mimeType: image.mimeType ?? '', bytes: glb.bin.subarray(at, at + view.byteLength)}];
  });
}

/** The GLB with each embedded image swapped for `replace`'s answer (the same image when it answers the same bytes). Every
 *  other range of the buffer keeps its bytes and moves down by whole 16-byte steps. Overlapping or shared image views
 *  are left alone: the same bytes come back. */
export function withImages(bytes: Uint8Array, replace: (image: GlbImage) => Uint8Array): Uint8Array {
  const glb = readGlb(bytes);
  if (glb === undefined) return bytes;
  const views = glb.json.bufferViews ?? [];
  const cuts = new Map<number, Uint8Array>();
  for (const image of glbImages(bytes)) {
    const viewIndex = glb.json.images?.[image.index]?.bufferView;
    if (viewIndex === undefined) continue;
    const next = replace(image);
    if (next !== image.bytes && next.length < image.bytes.length) cuts.set(viewIndex, next);
  }
  if (cuts.size === 0) return bytes;
  // A cut view must be used by images alone and overlap nothing else in buffer 0, or moving the rest would tear it.
  const ranges = views.flatMap((view, index) => {
    const own = view.buffer === 0 ? [{index, at: view.byteOffset ?? 0, end: (view.byteOffset ?? 0) + view.byteLength}] : [];
    const meshopt = view.extensions?.EXT_meshopt_compression;
    return meshopt?.buffer === 0 ? [...own, {index: -1, at: meshopt.byteOffset ?? 0, end: (meshopt.byteOffset ?? 0) + meshopt.byteLength}] : own;
  });
  const imageViews = (glb.json.images ?? []).map(image => image.bufferView);
  for (const viewIndex of cuts.keys()) {
    const cut = ranges.find(range => range.index === viewIndex);
    const shared = imageViews.filter(view => view === viewIndex).length > 1;
    if (cut === undefined || shared || ranges.some(range => range !== cut && range.at < cut.end && cut.at < range.end)) cuts.delete(viewIndex);
  }
  if (cuts.size === 0) return bytes;

  const order = [...cuts.keys()].sort((a, b) => (views[a]?.byteOffset ?? 0) - (views[b]?.byteOffset ?? 0));
  const parts: Uint8Array[] = [];
  const moves: {at: number; shift: number}[] = [];
  let read = 0, shift = 0;
  for (const viewIndex of order) {
    const view = views[viewIndex], next = cuts.get(viewIndex);
    if (view === undefined || next === undefined) continue;
    const at = view.byteOffset ?? 0, end = at + view.byteLength;
    // Shrink by whole 16-byte steps, so every later range keeps its alignment; the tail of the last step is zeros.
    const removed = Math.floor((view.byteLength - next.length) / 16) * 16, padded = new Uint8Array(view.byteLength - removed);
    padded.set(next);
    parts.push(glb.bin.subarray(read, at), padded);
    view.byteOffset = at - shift;
    view.byteLength = next.length;
    shift += removed;
    moves.push({at: end, shift});
    read = end;
  }
  parts.push(glb.bin.subarray(read));
  const shiftAt = (offset: number): number => moves.reduce((total, move) => (offset >= move.at ? move.shift : total), 0);
  views.forEach((view, index) => {
    if (view.buffer === 0 && !cuts.has(index)) view.byteOffset = (view.byteOffset ?? 0) - shiftAt(view.byteOffset ?? 0);
    const meshopt = view.extensions?.EXT_meshopt_compression;
    if (meshopt?.buffer === 0) meshopt.byteOffset = (meshopt.byteOffset ?? 0) - shiftAt(meshopt.byteOffset ?? 0);
  });
  const bin = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let at = 0;
  for (const part of parts) { bin.set(part, at); at += part.length; }
  const buffer = glb.json.buffers?.[0];
  if (buffer !== undefined) buffer.byteLength = bin.length;
  return writeGlb(glb.json, bin);
}

/** A GLB at one tier: each embedded KTX2 image at most `maxSize` on its largest side. */
export function tierGlb(bytes: Uint8Array, maxSize: number): Uint8Array {
  return withImages(bytes, image => (image.mimeType === 'image/ktx2' ? trimKtx2(image.bytes, maxSize) : image.bytes));
}

/** GPU memory a KTX2 takes once transcoded, mips included: ASTC 4×4 or BC7 for UASTC (1 byte a texel), its own block
 *  size for raw ASTC, ETC2/BC1 for ETC1S (half a byte). An estimate for reports, never a gate's only input. */
export function ktx2GpuBytes(bytes: Uint8Array): number {
  const info = ktx2Info(bytes);
  const block = ASTC_BLOCKS[info.vkFormat];
  let total = 0;
  for (let level = 0; level < Math.max(1, info.levels); level++) {
    const width = Math.max(1, info.width >> level), height = Math.max(1, info.height >> level);
    total += block === undefined ? Math.ceil(width / 4) * Math.ceil(height / 4) * (info.scheme === BASIS_LZ ? 8 : 16) : Math.ceil(width / block[0]) * Math.ceil(height / block[1]) * 16;
  }
  return total;
}
