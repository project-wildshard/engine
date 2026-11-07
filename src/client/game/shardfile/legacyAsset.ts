import { readContentResponse } from '@wildshard/engine/boot/readContentResponse';
import { SHARDFILE_ADMISSION_LIMITS as limits } from '@wildshard/format/admissionLimits';

interface LegacyStorage {
  keys: () => Promise<string[]>;
  open: (name: string) => Promise<Pick<Cache, 'match'>>;
}
/** Inert pre-MF8 storage is read only after a native miss. No old cache is
 * created, indexed, hashed or written, and no whole-cache inventory is read. */
export async function legacyAsset(storage: LegacyStorage, url: string, hash: string): Promise<Response | undefined> {
  if (!/^[a-f0-9]{64}$/u.test(hash)) return undefined;
  const names = new Set(await storage.keys()), address = new URL(url);
  if (names.has('ws-content-v0')) {
    const response = await (await storage.open('ws-content-v0')).match(new URL(`/__ws_content__/v0/${hash}`, address.origin).href);
    if (response?.status === 200) return response;
    void response?.body?.cancel().catch(() => undefined);
  }
  if (!address.pathname.endsWith('/shard.json')) return undefined;
  for (const name of ['ws-shardfile-products-v2', 'ws-shardfile-products-v0']) {
    if (!names.has(name)) continue;
    const response = await (await storage.open(name)).match(new URL('__visited_shardfile__', new URL('.', address)).href);
    if (response?.status !== 200) { void response?.body?.cancel().catch(() => undefined); continue; }
    const value: unknown = JSON.parse(new TextDecoder().decode(await readContentResponse(response, limits.sourceBytes)));
    if (typeof value !== 'object' || value === null || !('firstParty' in value) || value.firstParty !== true
      || !('validation' in value) || typeof value.validation !== 'object' || value.validation === null
      || !('indexHash' in value.validation) || value.validation.indexHash !== hash || !('source' in value)) continue;
    return Response.json(value.source);
  }
  return undefined;
}
