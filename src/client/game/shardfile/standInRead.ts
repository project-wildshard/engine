/**
 * Standalone shardfiles SF28: an image blob a material reads through the KTX2 table (`tableTextureRefs`) whose KTX2 this
 * page's download lists, and not the image, is a stand-in: the cook left the image out because a phone that loads KTX2 never
 * decodes it. Admission leaves it unread (`FolderOptions.standIn`), and the material reads it as it compiles, when the page's
 * texture mode is known (`cookedBlobBytes`): the cook's KTX2, checked against the sha256 the download lists for it, or, on a
 * page that reads images (a GPU the probe vetoed), the image by its product URL, checked against its own hash.
 */
import { contentHash } from '../../../shared/game/shardfile/contentHash';

/** What a page's download says about an image blob's stand-in (`spawnDownload.ts`). */
export interface StandInPort {
  /** the download lists the cook's KTX2 for image blob `hash` and not the image itself (its product URL `url`) */
  readonly listed: (hash: string, url: string) => boolean;
  /** the sha256 the download lists for `url` (a cooked KTX2), undefined when it lists none */
  readonly hash: (url: string) => string | undefined;
}

/** The reads a material makes for a stand-in admission left unread (`clientMaterials` `standIns`). */
export interface StandInReads {
  /** the image blob `hash` by its product URL; the caller checks its bytes against `hash` */
  readonly image: (hash: string) => Promise<Uint8Array>;
  /** the sha256 this page's download lists for a cooked KTX2's `url` */
  readonly hash?: (url: string) => string | undefined;
}

/** The download's stand-in rule from its two lookups: the listed blob KTX2 for a hash, and whether a URL is listed. */
export function standInPort(ktx2: (hash: string) => string | undefined, listed: (url: string) => boolean, hash: (url: string) => string | undefined): StandInPort {
  return { listed: (blob, url) => ktx2(blob) !== undefined && !listed(url), hash };
}

/** A stand-in KTX2's bytes, refused unless they are the file the download lists (when it lists a sha256 for it). */
export async function checkedStandIn(url: string, bytes: Uint8Array, hash: StandInReads['hash']): Promise<Uint8Array> {
  const expected = hash?.(url);
  if (expected !== undefined && await contentHash(bytes) !== expected) throw new Error(`Stand-in KTX2 digest differs: ${url}`);
  return bytes;
}

/** A stand-in image's bytes, refused unless their sha256 is the blob's hash. */
export async function checkedImage(hash: string, bytes: Uint8Array): Promise<Uint8Array> {
  if (await contentHash(bytes) !== hash) throw new Error(`Stand-in image differs from its hash: ${hash}`);
  return bytes;
}
