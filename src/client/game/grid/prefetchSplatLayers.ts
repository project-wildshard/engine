import { contentURL } from '@wildshard/engine/boot/contentBase';
import { readContentResponse } from '@wildshard/engine/boot/readContentResponse';
import { splatLayerFiles } from '@wildshard/engine/boot/splatLayerRows';
import { pageModeKtx2 } from '../shard/pageBoot';

/** A discovery document is tens of KB; anything near this is not one (as `readDiscovery`). */
const DISCOVERY_BYTES = 8_000_000;
type Row = Readonly<Record<string, unknown>>;
const isRow = (value: unknown): value is Row => typeof value === 'object' && value !== null && !Array.isArray(value);

/** SHARD-SOURCE S12f2b4: the cooked splat layers a neighbour's phone table names (blob hash to the cook's 6x6 file), read
 *  from its discovery document as the entry will register it (`pageModeKtx2`, this page's mode). A phone drawing the phone
 *  set reads those files by URL and never their blobs (S12f2b2), so the grid's prefetch leaves the blobs out. Undefined
 *  for a document with no such row (an older cook, a shard with no splat ground) or one this can't read: the blob is read. */
export function phoneSplatLayers(document: unknown): Readonly<Record<string, string>> | undefined {
  const ktx2 = isRow(document) && isRow(document['native']) ? document['native']['ktx2'] : undefined;
  if (!isRow(ktx2)) return undefined;
  let phone: unknown;
  try {
    const args = ktx2['args'];
    phone = ktx2['$call'] === 'pageModeKtx2' && Array.isArray(args) ? pageModeKtx2(args[0]).GPU_FILES.phone
      : !('$call' in ktx2) && isRow(ktx2['GPU_FILES']) ? ktx2['GPU_FILES']['phone'] : undefined;
  } catch { return undefined; }
  if (!isRow(phone)) return undefined;
  const rows = splatLayerFiles(Object.fromEntries(Object.entries(phone).filter((row): row is [string, string] => typeof row[1] === 'string')));
  return rows.size === 0 ? undefined : Object.fromEntries(rows);
}

/** `phoneSplatLayers` of a title row's served discovery document; undefined without one, or when its read fails (the
 *  prefetch then reads the blobs, as before S12f2b4). */
export async function readPhoneSplatLayers(discovery: string | undefined, signal?: AbortSignal): Promise<Readonly<Record<string, string>> | undefined> {
  if (discovery === undefined) return undefined;
  try {
    const response = await fetch(contentURL(discovery), signal === undefined ? {} : { signal });
    if (!response.ok) return undefined;
    return phoneSplatLayers(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await readContentResponse(response, DISCOVERY_BYTES))));
  } catch (error: unknown) {
    if (signal?.aborted === true) throw error;
    return undefined;
  }
}
