import { expect, test, vi } from 'vitest';
import { emptyShardfile } from '../src/shared/host/author';
import { encodeCanonicalJson as canonicalJson, hashImmutableBytes } from '../src/shared/host/immutable';
import { parseOutputIndex } from '@wildshard/format/outputIndex';
import { OUTPUT_SECTIONS, outputSectionPayloads } from '@wildshard/format/outputFields';
import { outputIndexEnvelope } from '@wildshard/format/version';
import { admitFolder, readFolderDescriptor, standInHashes, type FolderOptions } from '../src/client/game/shardfile/folder';
import { ClientAssets } from '../src/client/game/shardfile/clientAssets';
import { cookedBlobBytes } from '../src/client/game/shardfile/blobTextures';
import { standInPort, type StandInPort } from '../src/client/game/shardfile/standInRead';
import { blobKtx2Hash } from '../src/shared/game/shardfile/tableTextureRefs';
import { installCatalogueFixture } from './fixtures/bootSetup';

// Standalone shardfiles SF28: an image a material reads through the KTX2 table, whose KTX2 the page's download lists and not
// the image, is never read by admission (Pine's 42 images were 12.6 MB read and never drawn). The material reads it as it
// compiles: the KTX2 checked against the download's sha256, or the image by product URL, checked against its hash, on a page
// that reads images. Every other image reads as before.
const table = vi.hoisted(() => ({ refs: new Set<string>() }));
vi.mock('../src/shared/game/shardfile/tableTextureRefs', async importOriginal => ({
  ...await importOriginal<typeof import('../src/shared/game/shardfile/tableTextureRefs')>(),
  tableTextureRefs: () => table.refs,
}));
await installCatalogueFixture();

const base = 'https://example.test/shardfiles/stand-in-fixture/';
const encode = (value: unknown): Uint8Array => new TextEncoder().encode(canonicalJson(value));
const cookedKtx2 = new Uint8Array([0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9, 9, 9]);

/** A built product with one image blob, served by a build reader that records every path it reads. */
function product(): { image: string; imagePath: string; options: FolderOptions; requests: string[] } {
  const source = emptyShardfile({ slug: 'stand-in-fixture', name: 'Stand-in', author: 'Test', revision: 1, seed: 1 });
  const image = hashImmutableBytes(pngBytes), imagePath = `blobs/image/${image}.png`;
  source.files.push({ hash: image, kind: 'image', compressed: pngBytes.length, decoded: 3, gpu: 0, triangles: 0, draws: 0, dependencies: [], critical: false });
  source.library.push(image); source.budgets.library = { resident: 3, compressed: pngBytes.length };
  const wires = new Map<string, Uint8Array>([[imagePath, pngBytes]]);
  const sections = [...outputSectionPayloads(source)].map(([name, payload]) => {
    if (OUTPUT_SECTIONS.find(row => row.name === name) === undefined) throw new Error('Missing section mapping');
    const body = encode(payload), path = `sections/${name}.json`;
    wires.set(path, body);
    return { name, path, schema: `wildshard:${name}@1`, hash: hashImmutableBytes(body), bytes: body.length };
  });
  const index = parseOutputIndex(outputIndexEnvelope({ format: 'wildshard.shardfile', formatVersion: 2, sdk: '0.2', version: source.version,
    identity: source.identity, build: { sourceHash: hashImmutableBytes(encode(source)), validator: 'test' }, requires: source.requires,
    admission: { budgets: source.budgets, serverBudget: source.serverBudget, authorCaps: source.authorCaps, critical: source.critical, library: source.library },
    sections, schemas: [], files: source.files.map(file => ({ ...file, kind: 'image', path: imagePath })), runtime: null }));
  wires.set('shard.json', encode(index));
  const requests: string[] = [];
  const options: FolderOptions = { base, offline: false, tier: 'phone', hash: body => Promise.resolve(hashImmutableBytes(body)),
    fetch: () => Promise.reject(new Error('A built-in product reads through its build reader')),
    buildRead: (url, expected, read) => {
      const path = new URL(url).pathname.slice(new URL(base).pathname.length), body = wires.get(path); requests.push(path);
      if (body === undefined || (expected !== undefined && expected !== body.length)) throw new Error('Missing build file');
      read?.(body.length); return Promise.resolve(Uint8Array.from(body));
    } };
  return { image, imagePath, options, requests };
}
const ktx2Url = (image: string): string => `/assets/stand-in-fixture/blobs/${image}.t512-89abcdef.ktx2`;
/** The download lists `image`'s KTX2, and the image too when `imageListed`. */
const port = (image: string, imageListed = false): StandInPort => standInPort(hash => hash === image ? ktx2Url(image) : undefined,
  url => imageListed && url.endsWith(`${image}.png`), url => url === ktx2Url(image) ? hashImmutableBytes(cookedKtx2) : undefined);

test('admission leaves a material image unread when the download lists its KTX2 and not the image', async () => {
  const f = product(); table.refs = new Set([f.image]);
  const options = { ...f.options, standIn: port(f.image) };
  const loaded = await admitFolder(await readFolderDescriptor(options), options);
  expect(f.requests).not.toContain(f.imagePath);
  expect(loaded.assets.has(f.image)).toBe(false);
  // nothing to release or read back
  expect(await loaded.releaseTransport?.([f.image], 'cache-or-fetch')).toEqual([]);
  expect(f.requests).not.toContain(f.imagePath);
  // the material's reader knows it stands in, so it is never read through `read`
  const reader = new ClientAssets(loaded.source, loaded.assets, options);
  expect(reader.standsIn(f.image)).toBe(true);
});

test('a stand-in is kept out of GC9\'s warm and its unread list', async () => {
  const f = product(); table.refs = new Set([f.image]);
  const warmed: string[] = [];
  const options: FolderOptions = { ...f.options, standIn: port(f.image), deferred: source => Promise.resolve(source.files.map(file => file.hash)),
    backgroundFetch: url => { warmed.push(url); return Promise.resolve(new Response(new Uint8Array(0))); } };
  const loaded = await admitFolder(await readFolderDescriptor(options), options);
  expect(loaded.unread).toEqual([]);
  expect(warmed).toEqual([]);
  expect(f.requests).not.toContain(f.imagePath);
});

test('an image off the table, listed by the download, or with no listed KTX2 is read as before', async () => {
  for (const [refs, standIn] of [[new Set<string>(), (image: string) => port(image)], [undefined, (image: string) => port(image, true)],
    [undefined, () => port('f'.repeat(64))]] as const) {
    const f = product(); table.refs = refs ?? new Set([f.image]);
    const options = { ...f.options, standIn: standIn(f.image) };
    const loaded = await admitFolder(await readFolderDescriptor(options), options);
    expect(f.requests).toContain(f.imagePath);
    expect(loaded.assets.get(f.image)?.[0]).toBe(0x89);
    expect(new ClientAssets(loaded.source, loaded.assets, options).standsIn(f.image)).toBe(false);
  }
  expect([...standInHashes([{ hash: 'a' }, { hash: 'b' }, { hash: 'a' }], new Set(['a', 'b']), hash => hash, port('a'))]).toEqual(['a']);
  expect(standInHashes([{ hash: 'a' }], new Set(['a']), hash => hash, undefined).size).toBe(0);
});

test('the material reads a stand-in\'s KTX2 checked against the download\'s sha256, and refuses a tampered one', async () => {
  const image = hashImmutableBytes(pngBytes), url = ktx2Url(image), hash = port(image).hash;
  const read = vi.fn(() => Promise.resolve(Uint8Array.from(cookedKtx2))), images = vi.fn(() => Promise.resolve(pngBytes));
  const cooked = await cookedBlobBytes([image], new Map(), () => url, read, { image: images, hash });
  expect(cooked.get(image)).toStrictEqual(cookedKtx2);
  expect(read.mock.calls).toEqual([[url]]); expect(images).not.toHaveBeenCalled();
  const tampered = Uint8Array.from(cookedKtx2); tampered[13] = 7;
  await expect(cookedBlobBytes([image], new Map(), () => url, () => Promise.resolve(tampered), { image: images, hash })).rejects.toThrow('Stand-in KTX2 digest differs');
});

test('a page that reads images reads a stand-in\'s image by product URL, checked against its hash', async () => {
  const image = hashImmutableBytes(pngBytes), read = vi.fn(() => Promise.resolve(cookedKtx2));
  const cooked = await cookedBlobBytes([image], new Map(), () => undefined, read, { image: () => Promise.resolve(Uint8Array.from(pngBytes)) });
  expect(cooked.get(image)).toStrictEqual(pngBytes); expect(read).not.toHaveBeenCalled();
  const tampered = Uint8Array.from(pngBytes); tampered[9] = 0;
  await expect(cookedBlobBytes([image], new Map(), () => undefined, read, { image: () => Promise.resolve(tampered) })).rejects.toThrow('Stand-in image differs from its hash');
  // without the reads, a missing texture is left for `clientMaterials` to refuse by name, as before
  expect((await cookedBlobBytes([image], new Map(), () => undefined, read)).size).toBe(0);
});

test('a blob KTX2 path names the image it stands in for, desktop and phone', () => {
  const image = 'a'.repeat(64);
  expect(blobKtx2Hash(`/assets/z/blobs/${image}-0123abcd.ktx2`)).toBe(image);
  expect(blobKtx2Hash(`/assets/z/blobs/${image}.t512-89abcdef.ktx2?v=1`)).toBe(image);
  expect(blobKtx2Hash(`/assets/z/splat/${image}.t512-89abcdef.ktx2`)).toBeUndefined();
  expect(blobKtx2Hash(`/shardfiles/z/blobs/image/${image}.png`)).toBeUndefined();
});
