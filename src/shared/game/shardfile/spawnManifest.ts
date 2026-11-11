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
/** `code`: the manifest's code list (6e), read beside it from the build's own origin. The totals count both files. */
export interface SpawnManifestAddress {readonly url: string; readonly bytes: number; readonly totalBytes: number; readonly files: number; readonly wireBytes?: number; readonly code?: SpawnCodeAddress}
export interface SpawnCodeAddress {readonly url: string; readonly bytes: number}
/** OVERNIGHT 6e: a manifest's code rows (`.js`, `.mjs`, `.css`: never a part member, see `packable`) live in a list of their
 * own, `at` holding each row's place in the whole manifest. Every manifest lists the build's chunks by their content
 * names, so with them inline one leaf change renamed all 231 manifests (13 MB a deploy, ~25 kB a returning player's
 * shard); apart, a code change renames only the code lists, and a manifest keeps its name until its content changes. */
export interface SpawnCodeList {readonly version: 1; readonly files: readonly SpawnFile[]; readonly at: readonly number[]}
export const spawnCode = (url: string): boolean => /\.(?:js|mjs|css)(?:\?|$)/u.test(url);
const CODE_LIST = /^\/assets\/spawn\/code\/[a-f0-9]{16}\.json$/u;
export const spawnCodeListPath = (hash: string): string => `assets/spawn/code/${hash.slice(0, 16)}.json`;
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
    const row = spawnFile(file, seen); files.push(row); total += row.bytes; wire += row.wireBytes ?? 0;
  }
  if (!Number.isSafeInteger(total) || total !== input['totalBytes']) throw new Error('Spawn manifest total differs');
  if (input['wireBytes'] !== undefined && (!size(input['wireBytes']) || !Number.isSafeInteger(wire) || wire !== input['wireBytes'] || files.some(file => file.wireBytes === undefined))
    || input['wireBytes'] === undefined && files.some(file => file.wireBytes !== undefined)) throw new Error('Spawn manifest wire total differs');
  const parts = input['parts'] === undefined ? undefined : readSpawnParts(input['parts'], files);
  return {version: 1, shard: input['shard'], tier: input['tier'], flow: input['flow'], files, totalBytes: total, ...(input['wireBytes'] === undefined ? {} : {wireBytes: input['wireBytes']}),
    ...(parts === undefined ? {} : {parts})};
}
function spawnFile(file: unknown, seen: Set<string>): SpawnFile {
  if (!object(file) || !path(file['url']) || !size(file['bytes']) || typeof file['hash'] !== 'string' || !/^[a-f0-9]{64}$/u.test(file['hash'])
    || seen.has(file['url']) || file['wireBytes'] !== undefined && !size(file['wireBytes'])) throw new Error('Invalid spawn file');
  seen.add(file['url']);
  return {url: file['url'], bytes: file['bytes'], hash: file['hash'], ...(file['wireBytes'] === undefined ? {} : {wireBytes: file['wireBytes']})};
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
  const code = input['code'];
  if (code !== undefined && (!object(code) || typeof code['url'] !== 'string' || !CODE_LIST.test(code['url']) || !size(code['bytes']) || code['bytes'] > 2_000_000)) throw new Error('Invalid spawn manifest address');
  return {url: input['url'], bytes: input['bytes'], totalBytes: input['totalBytes'], files: input['files'], ...(input['wireBytes'] === undefined ? {} : {wireBytes: input['wireBytes']}),
    ...(object(code) ? {code: {url: String(code['url']), bytes: Number(code['bytes'])}} : {})};
}
/** A code list's grammar: code rows only, each at its own ascending place. */
export function readSpawnCodeList(input: unknown): SpawnCodeList {
  if (!object(input) || input['version'] !== 1 || !Array.isArray(input['files']) || !Array.isArray(input['at']) || input['files'].length > 8192
    || input['at'].length !== input['files'].length) throw new Error('Invalid spawn code list');
  const seen = new Set<string>(), files = input['files'].map(file => spawnFile(file, seen)), at: number[] = [];
  for (const place of input['at']) {
    if (!size(place) || place > 8192 || at.length > 0 && place <= (at.at(-1) ?? -1)) throw new Error('Invalid spawn code list');
    at.push(place);
  }
  if (files.some(file => !spawnCode(file.url))) throw new Error('Invalid spawn code list');
  return {version: 1, files, at};
}
/** The build writes a manifest as its content and its code list; the content keeps its own indices and totals. */
export function splitSpawnManifest(manifest: SpawnManifest): {content: SpawnManifest; code?: SpawnCodeList} {
  const local = new Map<number, number>(), content: SpawnFile[] = [], code: SpawnFile[] = [], at: number[] = [];
  manifest.files.forEach((file, index) => {
    if (spawnCode(file.url)) { code.push(file); at.push(index); } else { local.set(index, content.length); content.push(file); }
  });
  if (code.length === 0) return {content: manifest};
  const parts = manifest.parts?.map(part => ({...part, members: part.members.map(([index, offset]) => {
    const moved = local.get(index); if (moved === undefined) throw new Error('A spawn part holds code'); return [moved, offset] as const;
  })}));
  const wired = manifest.wireBytes !== undefined;
  return {code: {version: 1, files: code, at}, content: readSpawnManifest({version: 1, shard: manifest.shard, tier: manifest.tier, flow: manifest.flow, files: content,
    totalBytes: content.reduce((sum, file) => sum + file.bytes, 0), ...(wired ? {wireBytes: content.reduce((sum, file) => sum + (file.wireBytes ?? 0), 0)} : {}),
    ...(parts === undefined ? {} : {parts})})};
}
/** The whole manifest again, exactly as the build had it before the split: every row in its place, every part member's
 *  index into the whole list, the totals of both. */
export function joinSpawnManifest(content: SpawnManifest, code: SpawnCodeList | undefined): SpawnManifest {
  if (code === undefined || code.files.length === 0) return content;
  const count = content.files.length + code.files.length, files: SpawnFile[] = [], whole = new Map<number, number>();
  if ((code.at.at(-1) ?? 0) >= count) throw new Error('Spawn code list differs from its manifest');
  let next = 0, own = 0;
  for (let index = 0; index < count; index++) {
    const row = code.at[next] === index ? code.files[next++] : (whole.set(own, index), content.files[own++]);
    if (row === undefined) throw new Error('Spawn code list differs from its manifest');
    files.push(row);
  }
  const parts = content.parts?.map(part => ({...part, members: part.members.map(([index, offset]) => [whole.get(index) ?? -1, offset] as const)}));
  const wired = content.wireBytes !== undefined;
  if (wired !== code.files.every(file => file.wireBytes !== undefined)) throw new Error('Spawn code list differs from its manifest');
  return readSpawnManifest({version: 1, shard: content.shard, tier: content.tier, flow: content.flow, files, totalBytes: files.reduce((sum, file) => sum + file.bytes, 0),
    ...(wired ? {wireBytes: files.reduce((sum, file) => sum + (file.wireBytes ?? 0), 0)} : {}), ...(parts === undefined ? {} : {parts})});
}
