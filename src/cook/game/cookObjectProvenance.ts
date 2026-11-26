// oxlint-disable-next-line import/no-nodejs-modules -- The bounded cook child checks its own output files.
import {createHash} from 'node:crypto';
// oxlint-disable-next-line import/no-nodejs-modules -- The bounded cook child checks its own output files.
import {existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- The bounded cook child resolves its own output files.
import {dirname, join, relative} from 'node:path';
import {readSpawnManifest, type SpawnManifest} from '../../shared/game/shardfile/spawnManifest';
import {readServerPack} from '../../shared/game/shardfile/serverPack';

export interface CookObjectProvenance {
  readonly common: readonly string[];
  readonly mounts: readonly string[];
}

const hash = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const equal = (a: Uint8Array, b: Uint8Array): boolean => a.byteLength === b.byteLength && Buffer.from(a.buffer, a.byteOffset, a.byteLength).equals(b);
const json = (at: string): unknown => JSON.parse(readFileSync(at, 'utf8'));
const logicalPath = (url: string): string => url.replace(/^\//u, '').split('?')[0] ?? '';
const safePath = (path: string): boolean => path.split('/').every(part => /^[\w-][\w.-]*$/u.test(part));

/** Manifest members can be projected from the same part by two tiers. Reconstruct the part from the union of those
 * members and its zero padding. The full digest accounts for even the over-fetch that neither projection lists. */
export function sourceOnlyParts(manifests: readonly SpawnManifest[], source: (url: string) => Uint8Array | undefined): string[] {
  interface Part {
    readonly size: number;
    readonly digest: string;
    readonly members: Map<number, Uint8Array>;
    generated: boolean;
  }
  const parts = new Map<string, Part>();
  for (const manifest of manifests) for (const part of manifest.parts ?? []) {
    const sample = parts.get(part.url) ?? {size: part.bytes, digest: part.hash, members: new Map(), generated: false};
    parts.set(part.url, sample);
    for (const [at, offset] of part.members) {
      const file = manifest.files[at];
      const bytes = file === undefined ? undefined : source(file.url);
      if (bytes === undefined || file === undefined || bytes.length !== file.bytes || hash(bytes) !== file.hash) {
        sample.generated = true;
        continue;
      }
      sample.members.set(offset, bytes);
    }
  }
  const common: string[] = [];
  for (const [url, part] of parts) {
    if (part.generated) continue;
    const rebuilt = new Uint8Array(part.size);
    for (const [offset, bytes] of part.members) rebuilt.set(bytes, offset);
    if (hash(rebuilt) === part.digest) common.push(logicalPath(url));
  }
  return common;
}

/** Record pass-through objects in the bounded child. The publisher gets paths and its own output bytes only. */
export function classifyCookObjects(raw: ReadonlyMap<string, Uint8Array>, out: string, slug: string, manifestUrls: readonly string[],
  serverIndex: string, mounts: readonly {readonly url: string; readonly path: string}[]): CookObjectProvenance {
  const client = join(out, 'client'), prefix = `shardfiles/${slug}/`;
  const mountPaths = new Map(mounts.map(mount => [logicalPath(mount.url), mount.path]));
  const original = (url: string): Uint8Array | undefined => {
    const path = logicalPath(url), mount = mountPaths.get(path);
    if (mount !== undefined) return raw.get(mount);
    return path.startsWith(prefix) ? raw.get(path.slice(prefix.length)) : undefined;
  };
  const manifests = manifestUrls.map(url => readSpawnManifest(json(join(client, logicalPath(url)))));
  const common = new Set(sourceOnlyParts(manifests, original));
  const server = readServerPack(json(join(client, logicalPath(serverIndex))));
  for (const part of [server, ...server.more ?? []]) common.add(logicalPath(part.url));
  for (const file of readdirSync(client, {recursive: true, withFileTypes: true})) {
    if (!file.isFile()) continue;
    const path = relative(client, join(file.parentPath, file.name)), source = original(path);
    if (source !== undefined && equal(readFileSync(join(client, path)), source)) common.add(path);
  }
  const publishedMounts: string[] = [];
  for (const [url, source] of mountPaths) {
    if (!safePath(url)) throw new Error(`Invalid cooked mount URL: ${url}`);
    const bytes = raw.get(source);
    if (bytes === undefined) {
      if (existsSync(join(client, url))) publishedMounts.push(url);
      continue;
    }
    const file = join(client, url);
    // A produced stand-in at this URL keeps its own bytes. Unchanged mount bytes are kept even when also in a part.
    if (!existsSync(file)) { mkdirSync(dirname(file), {recursive: true}); writeFileSync(file, bytes); common.add(url); }
    publishedMounts.push(url);
  }
  return {common: [...common].sort(), mounts: publishedMounts.sort()};
}
