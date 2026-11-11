// oxlint-disable-next-line import/no-nodejs-modules -- Each fixture build writes into its own ./tmp folder.
import {mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Fixture paths under ./tmp.
import {join, relative, resolve} from 'node:path';
// oxlint-disable-next-line import/no-nodejs-modules -- Fixture hashes.
import {createHash} from 'node:crypto';
import {afterAll, expect, test} from 'vitest';
import {createPartEncoder, writeSpawnManifestFiles, writeSpawnParts} from '../src/cook/game/spawnParts';
import {readBuiltSpawnManifest} from '../src/cook/game/engineHalf';
import {downloadSpawnManifest} from '../src/client/game/boot/spawnDownload';
import {readSpawnManifest, readSpawnManifestAddress, type SpawnFile, type SpawnManifest, type SpawnManifestAddress} from '../src/shared/game/shardfile/spawnManifest';

// OVERNIGHT 6e (opus-ld6b's deploy probe, 2026-11-10): a one-line code change re-shipped all 231 spawn manifests,
// because each listed the build's chunks by their content names and was named by its whole text. Parts were already
// stable. These builds stand in for the app build's spawn step: parts, then each manifest as its content and code list.
mkdirSync('tmp', {recursive: true});
const root = mkdtempSync(resolve('tmp/spawn-stable-names-'));
afterAll(() => rmSync(root, {recursive: true, force: true}));
const sha = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const fill = (seed: string, bytes: number): Uint8Array => {
  const start = [...seed].reduce((sum, char) => sum + (char.codePointAt(0) ?? 0), 0);
  return Uint8Array.from({length: bytes}, (_, at) => (start + at * 7) % 251);
};

interface Tree {readonly chunk: string; readonly model: string}
/** One build of a two-shard tree: `chunk` is the entry chunk's source, `model` one model's. */
async function build(tree: Tree): Promise<{dir: string; addresses: SpawnManifestAddress[]; whole: SpawnManifest[]; bodies: Map<string, Uint8Array>}> {
  const dir = mkdtempSync(join(root, 'dist-')), bodies = new Map<string, Uint8Array>();
  const row = (url: (hash: string) => string, body: Uint8Array): SpawnFile => {
    const hash = sha(body), at = url(hash); bodies.set(at, body); return {url: at, bytes: body.length, hash};
  };
  // Vite names a chunk by its content, so a code change renames it; the vendor chunk and the wasm stay.
  const entry = row(hash => `/b/c/entry-${hash.slice(0, 8)}.js`, new TextEncoder().encode(tree.chunk));
  const vendor = row(hash => `/b/c/vendor-${hash.slice(0, 8)}.js`, fill('vendor', 300));
  const wasm = row(hash => `/b/c/physics-${hash.slice(0, 8)}.wasm`, fill('wasm', 500));
  const shard = (slug: string, models: readonly string[]): SpawnFile[] => [entry, vendor, wasm,
    ...models.map(seed => row(hash => `/shardfiles/${slug}/blobs/glb/${hash}.glb`, fill(seed, 700_000)))];
  const lists = [shard('a', [tree.model, 'rock', 'bush']), shard('b', ['cliff', 'dune'])];
  const tables = await writeSpawnParts(dir, lists.map(rows => ({rows, public: true})), url => bodies.get(url) ?? new Uint8Array(),
    undefined, createPartEncoder(join(root, 'part-cache'), 2));
  const whole = lists.map((files, at) => readSpawnManifest({version: 1, shard: ['a', 'b'][at], tier: 'phone', flow: 'client', files,
    totalBytes: files.reduce((sum, file) => sum + file.bytes, 0), parts: tables[at]}));
  return {dir, addresses: whole.map(manifest => readSpawnManifestAddress(writeSpawnManifestFiles(dir, manifest))), whole, bodies};
}
/** Every file under `assets/spawn`, by URL, as its sha256. */
const files = (dir: string): Map<string, string> => new Map(readdirSync(join(dir, 'assets/spawn'), {recursive: true, withFileTypes: true})
  .filter(entry => entry.isFile()).map(entry => {
    const path = join(entry.parentPath, entry.name);
    return [`/${relative(dir, path)}`, sha(readFileSync(path))] as const;
  }));
const moved = (before: Map<string, string>, after: Map<string, string>): string[] => [...after].filter(([url, hash]) => before.get(url) !== hash).map(([url]) => url).sort();

test('6e: two builds of one tree write byte-identical spawn files at the same URLs', async () => {
  const tree = {chunk: 'export const word = "Bag";', model: 'tree'};
  const first = await build(tree), second = await build(tree);
  expect(files(second.dir)).toEqual(files(first.dir));
  expect(second.addresses).toEqual(first.addresses);
  // the code rows left every manifest, and the page reads back exactly the manifest the build made
  for (const [at, address] of first.addresses.entries()) {
    expect(address.code).toBeDefined();
    expect(readFileSync(join(first.dir, address.url.slice(1)), 'utf8')).not.toMatch(/\.js"/u);
    expect(readBuiltSpawnManifest(first.dir, address)).toEqual(first.whole[at]);
  }
});

test('6e: a code change renames only the code lists; a changed part moves only that part and its manifest', async () => {
  const base = await build({chunk: 'export const word = "Bag";', model: 'tree'});
  const code = await build({chunk: 'export const word = "Bag!";', model: 'tree'});
  const art = await build({chunk: 'export const word = "Bag";', model: 'tree, edited'});
  const before = files(base.dir), isList = (url: string): boolean => url.startsWith('/assets/spawn/code/');
  // A one-line chunk change: every part and every manifest keeps its URL and bytes; only the code lists are new.
  const codeMoved = moved(before, files(code.dir));
  expect(codeMoved.length).toBeGreaterThan(0);
  expect(codeMoved.every(isList)).toBe(true);
  expect(code.addresses.map(address => address.url)).toEqual(base.addresses.map(address => address.url));
  // One model edited: its own part, and shard a's manifest that names it. Shard b, the other parts and the code stay.
  const artMoved = moved(before, files(art.dir));
  expect(artMoved.filter(url => url.startsWith('/assets/spawn/parts/'))).toHaveLength(1);
  expect(artMoved.filter(url => !url.startsWith('/assets/spawn/parts/'))).toEqual([art.addresses[0]?.url]);
  expect(art.addresses[1]).toEqual(base.addresses[1]);
  // Cache busting holds: new bytes are never served under an old URL.
  for (const after of [code, art]) for (const [url, hash] of files(after.dir)) if (before.has(url)) expect(hash).toBe(before.get(url));
});

test('6e: the page downloads a manifest and its code list as one list, code first', async () => {
  const built = await build({chunk: 'export const word = "Bag";', model: 'tree'}), address = built.addresses[0], manifest = built.whole[0];
  if (address?.code === undefined || manifest === undefined) throw new Error('Missing fixture manifest');
  const reads: string[] = [];
  const download = downloadSpawnManifest(address, {cached: () => Promise.resolve(undefined), fetch: url => {
    const path = new URL(url).pathname; reads.push(path);
    if (path.startsWith('/assets/spawn/')) return Promise.resolve(new Response(readFileSync(join(built.dir, path.slice(1)))));
    const body = built.bodies.get(path); if (body === undefined) throw new Error(`Unexpected read ${path}`);
    return Promise.resolve(new Response(body.slice()));
  }}, 'https://example.test/');
  await download.ready;
  expect(reads.slice(0, 2).sort()).toEqual([address.url, address.code.url].sort());
  expect(reads.slice(2)).toEqual(manifest.files.map(file => file.url));
  expect(download.snapshot()).toMatchObject({complete: true, filesDone: address.files, completedBytes: address.totalBytes, error: null});
});

test('6e: a failed code list fails the download at once, whatever the manifest read is still waiting on', async () => {
  const built = await build({chunk: 'export const word = "Bag";', model: 'tree'}), address = built.addresses[0];
  if (address?.code === undefined) throw new Error('Missing fixture manifest');
  const codeURL = address.code.url;
  const download = downloadSpawnManifest(address, {cached: () => Promise.resolve(undefined), fetch: (url, signal) => {
    if (new URL(url).pathname === codeURL) return Promise.resolve(new Response('{}'));
    // the manifest read stalls until the job aborts it
    return new Promise((_resolve, reject) => { signal?.addEventListener('abort', () => { reject(signal.reason); }); });
  }}, 'https://example.test/');
  await expect(download.ready).rejects.toThrow('Spawn manifest size differs');
});
