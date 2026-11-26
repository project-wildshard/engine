/** LL4: snapshot and admit an unpublished product before changing any installed bytes. */
import {createHash} from 'node:crypto';
import {existsSync, readFileSync, readdirSync, realpathSync} from 'node:fs';
import {join} from 'node:path';
import {parseOutputIndex} from '@wildshard/format/outputIndex';
import {prepareAssetDecoders} from '@wildshard/format/shardfileAssets';
import {validateShardfileFolder} from '@wildshard/format/shardfileValidation';
import {writeTar} from '@wildshard/format/tar';
import {assertKtx2TableTargets} from '../shared/game/shardfile/ktx2Targets.ts';
import {folderName, insideTree, mountPath} from './pins-reuse.mjs';
import {trackedPublic} from './tracked-public.mjs';
import { saveRevision } from '../shared/game/shardfile/saveRevision.ts';

const hash = (body: Uint8Array): string => createHash('sha256').update(body).digest('hex');
const discovery = /^mounts\/shardfiles\/([^/]+)\/discovery\.json$/u;
interface Mount {readonly url: string; readonly path: string}
interface LocalProduct {
  readonly pin: {readonly slug: string; readonly revision: number; readonly hash: string; readonly bytes: number};
  readonly bytes: Uint8Array;
  readonly folder: string;
  readonly preservedMounts: readonly string[];
  readonly source: {readonly kind: string; readonly path: string; readonly indexHash: string};
}

function snapshot(root: string): Map<string, Uint8Array> {
  const files = new Map<string, Uint8Array>();
  const visit = (directory: string, prefix = ''): void => {
    for (const entry of readdirSync(directory, {withFileTypes: true}).sort((a, b) => a.name.localeCompare(b.name))) {
      const name = `${prefix}${entry.name}`, path = join(directory, entry.name);
      if (entry.name.includes('\\')) throw new Error(`Local product has an invalid path: ${name}`);
      if (entry.isDirectory()) visit(path, `${name}/`);
      else if (entry.isFile()) files.set(name, readFileSync(path));
      else throw new Error(`Local product contains a non-regular entry: ${name}`);
    }
  };
  visit(root);
  return files;
}

function mounts(files: ReadonlyMap<string, Uint8Array>): Map<string, Uint8Array> {
  const result = new Map<string, Uint8Array>();
  const add = (path: string, body: Uint8Array): void => {
    if (!mountPath(path)) throw new Error(`Local product publishes outside public/: ${path}`);
    const previous = result.get(path);
    if (previous !== undefined && hash(previous) !== hash(body)) throw new Error(`Local product has conflicting mount: ${path}`);
    result.set(path, body);
  };
  for (const [path, body] of files) {
    const mounted = /^mounts\/((?:assets|programs)\/.+)$/u.exec(path)?.[1];
    if (mounted !== undefined) add(`public/${mounted}`, body);
  }
  const cook = files.get('cook.json');
  const rows = cook === undefined ? [] : (JSON.parse(new TextDecoder().decode(cook)) as {mounts?: readonly Mount[]}).mounts ?? [];
  for (const row of rows) if (/^\/(?:assets|programs)\//u.test(row.url)) {
    const body = files.get(row.path);
    if (body === undefined) throw new Error(`Local product has no mount body: ${row.path}`);
    add(`public${row.url}`, body);
  }
  return result;
}

/** Refuse overwriting tracked or other products' mounts, including a shared URL owned by both products. */
function ownedMounts(folder: string): Set<string> {
  const result = new Set<string>();
  for (const top of ['assets', 'programs']) {
    const base = join(folder, 'mounts', top);
    for (const entry of existsSync(base) ? readdirSync(base, {recursive: true, withFileTypes: true}) : []) {
      if (entry.isFile()) result.add(`public/${top}/${join(entry.parentPath, entry.name).slice(base.length + 1)}`);
    }
  }
  const cook = join(folder, 'cook.json');
  const rows = existsSync(cook) ? (JSON.parse(readFileSync(cook, 'utf8')) as {mounts?: readonly Mount[]}).mounts ?? [] : [];
  for (const row of rows) if (/^\/(?:assets|programs)\//u.test(row.url)) result.add(`public${row.url}`);
  return result;
}

function conflicts(root: string, folder: string, local: ReadonlyMap<string, Uint8Array>): readonly string[] {
  const others = new Set<string>(trackedPublic(undefined, root));
  const out = join(root, 'out');
  for (const entry of existsSync(out) ? readdirSync(out, {withFileTypes: true}) : []) {
    if (!entry.isDirectory() || entry.name === folder || !existsSync(join(out, entry.name, 'shard.json'))) continue;
    for (const path of ownedMounts(join(out, entry.name))) others.add(path);
  }
  const own = ownedMounts(join(out, folder));
  for (const [path, body] of local) {
    insideTree(root, path);
    const target = join(root, path);
    if (!others.has(path) && !own.has(path) && existsSync(target)) throw new Error(`Local product conflicts with an unowned existing mount: ${path}`);
    if (others.has(path) && (!existsSync(target) || hash(readFileSync(target)) !== hash(body))) {
      throw new Error(`Local product conflicts with another owner: ${path}`);
    }
  }
  return [...others];
}

export async function localProduct(path: string, root: string): Promise<LocalProduct> {
  const {CI: continuousIntegration} = process.env;
  if (continuousIntegration === 'true' || continuousIntegration === '1') throw new Error('--from-dir is local only; CI installs published pins');
  const canonical = realpathSync(path), files = snapshot(canonical);
  const read = (name: string): Uint8Array => {
    const body = files.get(name);
    if (body === undefined) throw new Error(`Local product has no ${name}`);
    return body;
  };
  const indexBytes = read('shard.json'), index = parseOutputIndex(JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(indexBytes)));
  await prepareAssetDecoders();
  validateShardfileFolder({read: (name, maximum) => {
    const body = read(name);
    if (body.length > maximum) throw new Error(`${name} is over its cap`);
    return body;
  }, paths: () => files.keys()}, {hash});
  const receipt = JSON.parse(new TextDecoder().decode(read('validation.json'))) as {indexHash: string};
  if (receipt.indexHash !== hash(indexBytes)) throw new Error('Local receipt names another index');
  const discoveries = [...files.keys()].filter(name => discovery.test(name));
  const folder = discovery.exec(discoveries[0] ?? '')?.[1];
  if (discoveries.length !== 1 || folder === undefined || !folderName(folder)) throw new Error('Local product needs one safe discovery folder');
  const slug = index.identity.slug;
  const pins = JSON.parse(readFileSync(join(root, 'test/pins/shardfiles.json'), 'utf8')) as {shards: readonly {slug: string}[]};
  if (!pins.shards.some(pin => pin.slug === slug)) throw new Error(`Local product is not pinned: ${slug}`);
  const existing = join(root, 'out', folder, 'shard.json');
  if (existsSync(existing) && parseOutputIndex(JSON.parse(readFileSync(existing, 'utf8'))).identity.slug !== slug) throw new Error(`Local product conflicts with installed folder: ${folder}`);
  const shared = trackedPublic(undefined, root);
  assertKtx2TableTargets({paths: () => files.keys(), read}, url => shared.has(`public${url}`));
  insideTree(root, `out/${folder}`);
  const preservedMounts = conflicts(root, folder, mounts(files));
  const bytes = writeTar(files);
  return {pin: {slug, revision: saveRevision(index.identity), hash: hash(bytes), bytes: bytes.length}, bytes, folder, preservedMounts,
    source: {kind: 'local-directory', path: canonical, indexHash: hash(indexBytes)}};
}
