// oxlint-disable-next-line import/no-nodejs-modules -- Admit the complete original inert PNG through the real product reader.
import { readFileSync } from 'node:fs';
import { expect, test, vi } from 'vitest';
import { Scope } from '../src/shared/engine/app/scope';
import { parseStillImage } from '@wildshard/format/stillImage';
import { shardfileSource } from '../src/client/game/shardfile/clientSource';
import type { ShardfileClientBindings } from '../src/client/game/shardfile/client';
import type { FolderOptions } from '../src/client/game/shardfile/folder';
import { emptyShardfile } from '../src/shared/host/author';
import { encodeCanonicalJson, hashImmutableBytes } from '../src/shared/host/immutable';
import { OUTPUT_SECTIONS, outputSectionPayloads } from '@wildshard/format/outputFields';
import { parseOutputIndex } from '@wildshard/format/outputIndex';
import { toLevelSpec } from '../src/client/game/shard/spec';
import { bakedMapUrl } from '../src/client/game/shard/manifest';

const original = Uint8Array.from(readFileSync('test/fixtures/world-source/image.png'));
function fixture() {
  const source = emptyShardfile({ slug: 'image-owner', name: 'Images', author: 'Test', seed: 1, revision: 1 });
  const hash = hashImmutableBytes(original), image = parseStillImage(original);
  source.files.push({ hash, kind: 'image', compressed: original.length, decoded: image.decoded, gpu: image.gpu,
    triangles: 0, draws: 0, dependencies: [], critical: false });
  source.library.push(hash);
  source.budgets.library = { compressed: original.length, resident: image.decoded + image.gpu };
  source.presentation = { biome: 'Image biome', blurb: 'Original image card', card: { thumb: hash, portrait: hash, landscape: hash } };
  source.map = { image: hash, tilesHash: hash };
  const wires = new Map<string, Uint8Array>();
  const encode = (value: unknown): Uint8Array => new TextEncoder().encode(encodeCanonicalJson(value));
  const sections = [...outputSectionPayloads(source)].map(([name, payload]) => {
    if (!OUTPUT_SECTIONS.some(row => row.name === name)) throw new Error('Missing section mapping');
    const bytes = encode(payload), path = `sections/${name}.json`;
    wires.set(path, bytes);
    return { name, path, schema: `wildshard:${name}@1`, hash: hashImmutableBytes(bytes), bytes: bytes.length };
  });
  const file = source.files[0];
  if (file === undefined) throw new Error('Missing image file');
  const path = `blobs/image/${hash}.png`;
  wires.set(path, original);
  const index = parseOutputIndex({ format: 'wildshard.shardfile', formatVersion: 2, sdk: '0.2', version: source.version,
    identity: source.identity, build: { sourceHash: hashImmutableBytes(encode(source)), validator: 'test' }, requires: source.requires,
    admission: { budgets: source.budgets, serverBudget: source.serverBudget, authorCaps: source.authorCaps, critical: source.critical, library: source.library },
    sections, schemas: [], files: [{ ...file, path }], runtime: null });
  return { index, wires };
}
function bindings(imageOwner?: Scope): ShardfileClientBindings {
  return { instance: 'image-fixture', recipes: new Map(), items: new Map(), catalogue: [],
    voices: () => new Map(), icon: () => { throw new Error('No fixture items'); },
    ...(imageOwner === undefined ? {} : { imageOwner }) };
}
function options(wires: ReadonlyMap<string, Uint8Array>, fetch?: FolderOptions['fetch']): FolderOptions {
  return { base: 'https://example.test/', offline: false, firstParty: true, fetch: fetch ?? (url => {
    const bytes = wires.get(url.slice('https://example.test/'.length));
    return Promise.resolve(bytes === undefined ? new Response(null, { status: 404 }) : new Response(Uint8Array.from(bytes)));
  }),
    hash: bytes => Promise.resolve(hashImmutableBytes(bytes)) };
}

test('real admitted client hydration shares image URLs and releases them with its explicit owner', async () => {
  const owner = new Scope('hydration'), create = vi.spyOn(URL, 'createObjectURL');
  const f = fixture(), manifest = await shardfileSource(f.index, options(f.wires), bindings(owner));
  try {
    expect(manifest.card.thumb).toMatch(/^blob:/u);
    expect(manifest.minimap?.image).toBe(manifest.card.thumb);
    expect(create).toHaveBeenCalledTimes(1);
    expect(new Uint8Array(await (await fetch(manifest.card.thumb)).arrayBuffer())).toEqual(original);
  } finally { owner.dispose(); }
  await expect(fetch(manifest.card.thumb)).rejects.toThrow();
});

test('image-bearing client hydration requires an explicit owner before creating URLs', async () => {
  const create = vi.spyOn(URL, 'createObjectURL');
  const f = fixture();
  await expect(shardfileSource(f.index, options(f.wires), bindings())).rejects.toThrow('Image owner required');
  expect(create).not.toHaveBeenCalled();
});

test('admitted blob maps survive level projection and build versioning', async () => {
  const owner = new Scope('hydration'), f = fixture();
  const manifest = await shardfileSource(f.index, options(f.wires), bindings(owner));
  const priorBuild = Object.getOwnPropertyDescriptor(globalThis, '__BUILD_ID__');
  Object.defineProperty(globalThis, '__BUILD_ID__', { configurable: true, value: 'image-owner-proof' });
  try {
    const compiled = { ...manifest, shardfile: '/fixture/shard.json' };
    expect(bakedMapUrl(manifest.minimap?.image)).toBe(manifest.minimap?.image);
    expect(toLevelSpec(compiled).minimap?.image).toBe(manifest.minimap?.image);
    expect(toLevelSpec({ ...compiled, minimap: { image: '/unadmitted/map.webp' } }).minimap?.image).toBeUndefined();
  } finally {
    if (priorBuild === undefined) Reflect.deleteProperty(globalThis, '__BUILD_ID__');
    else Object.defineProperty(globalThis, '__BUILD_ID__', priorBuild);
    owner.dispose();
  }
});

test('owner retirement during asset admission prevents image publication', async () => {
  const owner = new Scope('hydration'), create = vi.spyOn(URL, 'createObjectURL');
  let release: ((response: Response) => void) | undefined, reached: (() => void) | undefined;
  const waiting = new Promise<void>(resolve => { reached = resolve; });
  const response = new Promise<Response>(resolve => { release = resolve; });
  const f = fixture(), ordinary = options(f.wires);
  const pending = shardfileSource(f.index, options(f.wires, url => {
    if (!url.endsWith('.png')) return ordinary.fetch(url);
    reached?.(); return response;
  }), bindings(owner));
  try {
    await Promise.race([waiting, pending.then(() => { throw new Error('Hydration finished before its image read'); })]);
    owner.dispose();
    if (release === undefined) throw new Error('Fixture response missing');
    release(new Response(Uint8Array.from(original)));
    await expect(pending).rejects.toThrow('Image owner retired');
    expect(create).not.toHaveBeenCalled();
  } finally { owner.dispose(); }
});
