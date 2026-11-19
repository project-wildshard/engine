/**
 * SHARD-SOURCE S12f2b2: a phone drawing a splat ground's phone set reads the cook's own 6×6 file for each layer the
 * discovery's phone tables name, in the blob's place. Loaded on that path only (`clientMaterials`), so the session bundle
 * every other device boots does not carry it.
 */
import { DefaultLoadingManager } from 'three';
import { waitFor } from '@wildshard/engine/boot/waits';
import { ownedArray } from '@wildshard/engine/core/ownedBuffer';
import { contentHash } from '../../../shared/game/shardfile/contentHash';
import type { SplatTerrain } from '@wildshard/format/splatTerrain';

/** S12f2b2: a splat phone layer's cooked file (`/assets/<folder>/splat/<hash>.t<max>-<hash8>.ktx2`), read as three's loaders
 *  read a URL (the page's modifier: its version and content base; a phone part answers it), checked against its name. */
export async function readSplatLayer(url: string, resolve: (url: string) => string = path => DefaultLoadingManager.resolveURL(path)): Promise<Uint8Array> {
  const resolved = resolve(url);
  const response = await waitFor('Reading splat layer', fetch(resolved), 'file', resolved);
  if (!response.ok) throw new Error(`Splat layer ${url} answered ${String(response.status)}`);
  // a layer is copied into its texture array (clientSplatTerrain), so its file is wire bytes the transcode lets go
  const chunks: Uint8Array[] = [], reader = response.body?.getReader();
  for (let read = await reader?.read(); read !== undefined && !read.done; read = await reader?.read()) chunks.push(read.value);
  const bytes = ownedArray(Uint8Array, chunks.reduce((sum, chunk) => sum + chunk.length, 0), { owner: 'splat-layer', asset: url, kind: 'wire' });
  chunks.reduce((at, chunk) => { bytes.set(chunk, at); return at + chunk.length; }, 0);
  if (/-([a-f0-9]{8})\.ktx2$/u.exec(url)?.[1] !== (await contentHash(bytes)).slice(0, 8)) throw new Error(`Splat layer ${url} differs from its name`);
  return bytes;
}

/** S12f2b2: the cooked file of each splat layer this device draws that has one (`layer`), read by URL (`read`), by the
 *  layer's hash; none when it draws the desktop set or the shard has no phone set. Its blob was never admitted here. */
export async function cookedSplatBytes(splat: SplatTerrain | undefined, drawn: ReadonlySet<string>, tier: 'phone' | 'desktop', layer: (hash: string) => string | undefined,
  read: (url: string) => Promise<Uint8Array> = readSplatLayer): Promise<ReadonlyMap<string, Uint8Array>> {
  const cooked = new Map<string, Uint8Array>();
  if (splat?.phone === undefined || tier !== 'phone') return cooked;
  await Promise.all([...drawn].map(async ref => { const url = layer(ref); if (url !== undefined) cooked.set(ref, await read(url)); }));
  return cooked;
}
