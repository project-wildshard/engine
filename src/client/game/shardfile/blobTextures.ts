/**
 * SF16 (J525): a shard's textures named by hash (material maps, prop slots, splat layers) may be PNG or JPEG blobs. The
 * cook encodes each as KTX2 and names it in the discovery document's table under the blob's URL; the page reads that file
 * in the blob's place when it loads KTX2, and decodes the image itself when it doesn't (a GPU the probe vetoed, or a
 * product cooked before SF16: no row). A KTX2 blob, as every hand-made set is, reads as it always did.
 */
import { DefaultLoadingManager, Texture } from 'three';
import { waitFor } from '@wildshard/engine/boot/waits';
import { ownedArray } from '@wildshard/engine/core/ownedBuffer';
import { contentHash } from '../../../shared/game/shardfile/contentHash';
import { checkedImage, checkedStandIn, type StandInReads } from './standInRead';

const KTX2_MAGIC = [0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a] as const;
/** Whether the bytes are a KTX2 file (its 12-byte identifier). */
export const isKtx2Bytes = (bytes: Uint8Array): boolean => KTX2_MAGIC.every((byte, at) => bytes[at] === byte);

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const, JPEG_MAGIC = [0xff, 0xd8, 0xff] as const;
/** How the page decodes a texture's bytes: a KTX2 transcode, a PNG or JPEG image decode, or neither (undefined), which
 *  the page refuses by name rather than handing to a decoder (a test fixture of made-up bytes went red that way). */
export function textureKind(bytes: Uint8Array): 'ktx2' | 'image' | undefined {
  if (isKtx2Bytes(bytes)) return 'ktx2';
  return PNG_MAGIC.every((byte, at) => bytes[at] === byte) || JPEG_MAGIC.every((byte, at) => bytes[at] === byte) ? 'image' : undefined;
}

/** A cooked texture file (`…-<hash8>.ktx2`), read as three's loaders read a URL (the page's modifier: its version and
 *  content base), checked against its name. */
export async function readCookedTexture(url: string, resolve: (url: string) => string = path => DefaultLoadingManager.resolveURL(path)): Promise<Uint8Array> {
  const resolved = resolve(url);
  const response = await waitFor('Reading cooked texture', fetch(resolved), 'file', resolved);
  if (!response.ok) throw new Error(`Cooked texture ${url} answered ${String(response.status)}`);
  // the file is wire bytes the transcode lets go
  const chunks: Uint8Array[] = [], reader = response.body?.getReader();
  for (let read = await reader?.read(); read !== undefined && !read.done; read = await reader?.read()) chunks.push(read.value);
  const bytes = ownedArray(Uint8Array, chunks.reduce((sum, chunk) => sum + chunk.length, 0), { owner: 'cooked-texture', asset: url, kind: 'wire' });
  chunks.reduce((at, chunk) => { bytes.set(chunk, at); return at + chunk.length; }, 0);
  if (/-([a-f0-9]{8})\.ktx2$/u.exec(url)?.[1] !== (await contentHash(bytes)).slice(0, 8)) throw new Error(`Cooked texture ${url} differs from its name`);
  return bytes;
}

/** The cook's KTX2 of each image blob among `refs` that the table names (`file`: undefined when this page reads images or
 *  the blob has no row), read by URL, by the blob's hash. A KTX2 blob is never asked. SF28: a ref with no admitted bytes is a
 *  stand-in admission left unread: its KTX2 is checked against the sha256 the download lists (`standIns.hash`), and on a page
 *  that reads images its image is read by product URL (`standIns.image`) and checked against its hash. */
export async function cookedBlobBytes(refs: Iterable<string>, assets: ReadonlyMap<string, Uint8Array>, file: (hash: string) => string | undefined,
  read: (url: string) => Promise<Uint8Array> = readCookedTexture, standIns?: StandInReads): Promise<ReadonlyMap<string, Uint8Array>> {
  const cooked = new Map<string, Uint8Array>();
  await Promise.all([...refs].map(async ref => {
    const bytes = assets.get(ref);
    if (bytes !== undefined && isKtx2Bytes(bytes)) return;
    const url = file(ref);
    if (url !== undefined) cooked.set(ref, bytes === undefined ? await checkedStandIn(url, await read(url), standIns?.hash) : await read(url));
    else if (bytes === undefined && standIns !== undefined) cooked.set(ref, await checkedImage(ref, await standIns.image(ref)));
  }));
  return cooked;
}

/** An image blob the page decodes itself: unflipped, as the cook's KTX2 of it is, with three's generated mips. */
export async function imageTexture(bytes: Uint8Array): Promise<Texture> {
  const bitmap = await createImageBitmap(new Blob([Uint8Array.from(bytes)]), { imageOrientation: 'none', premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  const texture = new Texture(bitmap);
  texture.flipY = false;
  texture.needsUpdate = true;
  return texture;
}
