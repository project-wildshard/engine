/** Build-owned spawn IO, in fetch order. Later streaming is a different set. */
export interface SpawnFile {readonly url: string; readonly bytes: number; readonly hash: string; readonly wireBytes?: number}
/** DL5: a content-named concatenation of spawn files (DL15: served as q11 Brotli, `.pack.br`), shared by every manifest that lists it. `members` are
 * `[file index in this manifest, byte offset in the part]`; each body starts on a 16-byte boundary. A part may also
 * hold bytes another manifest needs (bounded over-fetch); its loose files stay deployed as the fallback. `bytes` is the
 * decoded part; `wireBytes` its q11 body as served (the bar's wire facts on the Runtime packs path). */
export interface SpawnPart {readonly url: string; readonly bytes: number; readonly hash: string; readonly members: readonly (readonly [number, number])[]; readonly wireBytes?: number}
export interface SpawnManifest {
  readonly version: 1; readonly shard: string; readonly tier: 'phone' | 'desktop'; readonly flow: 'client' | 'grid';
  readonly files: readonly SpawnFile[]; readonly totalBytes: number; readonly wireBytes?: number;
  readonly parts?: readonly SpawnPart[];
}
export const SPAWN_PART_ALIGN = 16;
/** DL16: the packs book (spawnManifests' whole-level books with parts) of one build, outside index.html. */
export const packsBookPath = (build: string): string => `assets/spawn/packs-${build}.json`;
export interface SpawnManifestAddress {readonly url: string; readonly bytes: number; readonly totalBytes: number; readonly files: number; readonly wireBytes?: number}
const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const size = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const path = (value: unknown): value is string => typeof value === 'string' && /^\/(?:[a-zA-Z0-9_-][a-zA-Z0-9_.-]*\/)*[a-zA-Z0-9_-][a-zA-Z0-9_.-]*(?:\?v=[a-f0-9]{8,64})?$/u.test(value)
  && !value.split('/').some(part => part === '.' || part === '..');
/** Decode only the small transport grammar. No hashing or product admission. */
export function readSpawnManifest(input: unknown): SpawnManifest {
  if (!object(input) || input['version'] !== 1 || typeof input['shard'] !== 'string' || !/^[a-z0-9_-]+$/u.test(input['shard'])
    || input['tier'] !== 'phone' && input['tier'] !== 'desktop' || input['flow'] !== 'client' && input['flow'] !== 'grid'
    || !size(input['totalBytes']) || !Array.isArray(input['files']) || input['files'].length > 8192) throw new Error('Invalid spawn manifest');
  const files: SpawnFile[] = [], seen = new Set<string>(); let total = 0, wire = 0;
  for (const file of input['files']) {
    if (!object(file) || !path(file['url']) || !size(file['bytes']) || typeof file['hash'] !== 'string' || !/^[a-f0-9]{64}$/u.test(file['hash'])
      || seen.has(file['url']) || file['wireBytes'] !== undefined && !size(file['wireBytes'])) throw new Error('Invalid spawn file');
    seen.add(file['url']); files.push({url: file['url'], bytes: file['bytes'], hash: file['hash'], ...(file['wireBytes'] === undefined ? {} : {wireBytes: file['wireBytes']})}); total += file['bytes'];
    if (size(file['wireBytes'])) wire += file['wireBytes'];
  }
  if (!Number.isSafeInteger(total) || total !== input['totalBytes']) throw new Error('Spawn manifest total differs');
  if (input['wireBytes'] !== undefined && (!size(input['wireBytes']) || !Number.isSafeInteger(wire) || wire !== input['wireBytes'] || files.some(file => file.wireBytes === undefined))
    || input['wireBytes'] === undefined && files.some(file => file.wireBytes !== undefined)) throw new Error('Spawn manifest wire total differs');
  const parts = input['parts'] === undefined ? undefined : readSpawnParts(input['parts'], files);
  return {version: 1, shard: input['shard'], tier: input['tier'], flow: input['flow'], files, totalBytes: total, ...(input['wireBytes'] === undefined ? {} : {wireBytes: input['wireBytes']}),
    ...(parts === undefined ? {} : {parts})};
}
/** Every member names one of this manifest's files once, in ascending aligned order, wholly inside its part. */
function readSpawnParts(input: unknown, files: readonly SpawnFile[]): SpawnPart[] {
  if (!Array.isArray(input) || input.length > 128) throw new Error('Invalid spawn parts');
  const parts: SpawnPart[] = [], packed = new Set<number>();
  for (const part of input) {
    if (!object(part) || !path(part['url']) || !/^\/assets\/spawn\/parts\/[a-f0-9]{16}\.pack\.br$/u.test(part['url']) || !size(part['bytes']) || part['bytes'] > 64_000_000
      || typeof part['hash'] !== 'string' || !/^[a-f0-9]{64}$/u.test(part['hash']) || !part['url'].includes(part['hash'].slice(0, 16))
      || !Array.isArray(part['members']) || part['members'].length === 0 || part['members'].length > 8192
      || part['wireBytes'] !== undefined && (!size(part['wireBytes']) || part['wireBytes'] > 64_000_000)) throw new Error('Invalid spawn part');
    const members: [number, number][] = []; let end = 0;
    for (const member of part['members']) {
      if (!Array.isArray(member) || member.length !== 2) throw new Error('Invalid spawn part member');
      const [index, offset]: unknown[] = member, file = typeof index === 'number' ? files[index] : undefined;
      if (!size(index) || !size(offset) || file === undefined || packed.has(index) || offset % SPAWN_PART_ALIGN !== 0 || offset < end
        || offset + file.bytes > part['bytes']) throw new Error('Invalid spawn part member');
      packed.add(index); members.push([index, offset]); end = offset + file.bytes;
    }
    parts.push({url: part['url'], bytes: part['bytes'], hash: part['hash'], members, ...(size(part['wireBytes']) ? {wireBytes: part['wireBytes']} : {})});
  }
  return parts;
}
export function readSpawnManifestAddress(input: unknown): SpawnManifestAddress {
  if (!object(input) || !path(input['url']) || !size(input['bytes']) || input['bytes'] > 2_000_000
    || !size(input['totalBytes']) || input['wireBytes'] !== undefined && !size(input['wireBytes']) || !size(input['files']) || input['files'] > 8192) throw new Error('Invalid spawn manifest address');
  return {url: input['url'], bytes: input['bytes'], totalBytes: input['totalBytes'], files: input['files'], ...(input['wireBytes'] === undefined ? {} : {wireBytes: input['wireBytes']})};
}
