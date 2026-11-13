import { parseOutputIndex } from '@wildshard/format/outputIndex';
import { expect, test, vi } from 'vitest';
import { emptyShardfile } from '@wildshard/engine/host/author';
import { outputSectionPayloads } from '@wildshard/format/outputFields';
import { encodeCanonicalJson, hashImmutableBytes } from '../src/shared/host/immutable';
import { readGridProductEdges, readGridProductFar, readGridProductNear } from '../src/client/game/grid/products';
import type { ProductCache } from '../src/client/game/shardfile/product';

function fixture(slug = 'edge-fixture') {
  const source = emptyShardfile({ slug, name: 'Edges', author: 'Test', revision: 1, seed: 9 });
  const encode = (value: unknown) => new TextEncoder().encode(encodeCanonicalJson(value));
  const payloads = outputSectionPayloads(source), url = `https://game.test/shardfiles/${slug}/shard.json`;
  const sectionBytes = new Map([...payloads].map(([name, value]) => [name, encode(value)]));
  const index = { format: 'wildshard.shardfile', formatVersion: 2, sdk: '0.2', version: source.version, identity: source.identity, requires: source.requires,
    build: { sourceHash: '0'.repeat(64), validator: 'test' }, admission: { budgets: source.budgets, serverBudget: source.serverBudget, authorCaps: source.authorCaps, critical: source.critical, library: source.library },
    sections: [...sectionBytes].map(([name, bytes]) => ({ name, path: `sections/${name}.json`, schema: `wildshard:${name}@1`, hash: hashImmutableBytes(bytes), bytes: bytes.length })), schemas: [], files: [], runtime: null };
  const edgeUrl = new URL('sections/world/edge.json', url).href;
  const edge = sectionBytes.get('world/edge'); if (edge === undefined) throw new Error('Missing test edges');
  const wires = new Map([[url, encode(index)], [edgeUrl, edge]]);
  const fetch = vi.fn((path: string): Promise<Response> => {
    const bytes = wires.get(path); if (bytes === undefined) return Promise.reject(new Error(`Full admission attempted: ${path}`));
    return Promise.resolve(new Response(Uint8Array.from(bytes)));
  });
  return { source, url, edgeUrl, sectionBytes, wires, fetch, options: { base: new URL('.', url).href, offline: false, firstParty: false, fetch, hash: (bytes: Uint8Array) => Promise.resolve(hashImmutableBytes(bytes)) } };
}

test('a build-owned grid index skips grammar but keeps identity and section hashes', async () => {
  const f = fixture('built-edge-fixture'), wire = f.wires.get(f.url);
  if (wire === undefined) throw new Error('Missing index fixture');
  const stale = vi.fn(() => Promise.resolve()), options = { ...f.options, firstParty: true, built: { indexes: new Set([hashImmutableBytes(wire)]), stale } };
  const grammar = vi.spyOn(await import('@wildshard/format/outputIndex'), 'parseOutputIndex');
  try {
    expect(await readGridProductEdges(f.url, f.source.identity.slug, options)).toEqual({ edge: f.source.edge, entryways: f.source.entryways });
    expect(grammar).not.toHaveBeenCalled(); expect(stale).not.toHaveBeenCalled();
    await expect(readGridProductEdges(f.url, 'wrong-cell', options)).rejects.toThrow('identity');
    f.wires.set(f.edgeUrl, new TextEncoder().encode('{}'));
    await expect(readGridProductEdges(f.url, f.source.identity.slug, options)).rejects.toThrow('hash or size');
  } finally { grammar.mockRestore(); }
});

test('native first-party grid metadata reads canonical URLs with declared hashes, without rehashing',async()=>{
  const f=fixture('native-edge-fixture'),digest=vi.fn<(bytes:Uint8Array)=>Promise<string>>(()=>{throw new Error('No client digest');});
  const identities:({path:string;hash:string|undefined})[]=[],rootHash='a'.repeat(64);
  const options={...f.options,firstParty:true,descriptorHash:rootHash,hash:digest,
    firstPartyRead:(url:string,size:number|undefined,_read?:((bytes:number)=>void),hash?:string)=>{
      const address=new URL(url);identities.push({path:address.pathname,hash});address.search='';
      const bytes=f.wires.get(address.href);if(bytes===undefined||(size!==undefined&&size!==bytes.length))throw new Error('Missing emitted file');
      return Promise.resolve(bytes);
    }};
  expect(await readGridProductEdges(f.url,f.source.identity.slug,options)).toStrictEqual({edge:f.source.edge,entryways:f.source.entryways});
  expect(digest).not.toHaveBeenCalled();expect(f.fetch).not.toHaveBeenCalled();
  expect(identities).toEqual([{path:new URL(f.url).pathname,hash:rootHash},{path:new URL(f.edgeUrl).pathname,hash:hashImmutableBytes(f.wires.get(f.edgeUrl)??new Uint8Array())}]);
  await expect(readGridProductEdges(f.url,'wrong-cell',options)).rejects.toThrow('identity');
});

test.each(['third-party', 'unbundled'] as const)('%s grid metadata still loads checked grammar', async mode => {
  const f = fixture(`${mode}-edge-fixture`), wire = f.wires.get(f.url);
  if (wire === undefined) throw new Error('Missing index fixture');
  const options = mode === 'third-party'
    ? { ...f.options, built: { indexes: new Set([hashImmutableBytes(wire)]), stale: () => Promise.resolve() } }
    : { ...f.options, firstParty: true };
  const grammar = vi.spyOn(await import('@wildshard/format/outputIndex'), 'parseOutputIndex');
  try {
    expect(await readGridProductEdges(f.url, f.source.identity.slug, options)).toEqual({ edge: f.source.edge, entryways: f.source.entryways });
    expect(grammar).toHaveBeenCalledOnce();
  } finally { grammar.mockRestore(); }
});

test('grid edge preparation reads only the index and edge section, never the other product sections or assets', async () => {
  const f = fixture();
  expect(await readGridProductEdges(f.url, f.source.identity.slug, f.options)).toEqual({ edge: f.source.edge, entryways: f.source.entryways });
  expect(f.fetch.mock.calls.map(([url]) => url)).toEqual([f.url, f.edgeUrl]);
});

test('grid edge metadata keeps identity, byte count and immutable hash checks', async () => {
  const f = fixture();
  await expect(readGridProductEdges(f.url, 'other-cell', f.options)).rejects.toThrow('identity');
  expect(f.fetch).toHaveBeenCalledExactlyOnceWith(f.url);
  f.wires.set(f.edgeUrl, new TextEncoder().encode('{}'));
  await expect(readGridProductEdges(f.url, f.source.identity.slug, f.options)).rejects.toThrow('hash or size');
});

test('a newer first-party index still takes stale-client recovery before reading its edge section', async () => {
  const f = fixture(), stale = vi.fn(() => Promise.resolve());
  await expect(readGridProductEdges(f.url, f.source.identity.slug, { ...f.options, firstParty: true, built: { indexes: new Set(), stale } })).rejects.toThrow('older');
  expect(stale).toHaveBeenCalledOnce(); expect(f.fetch).toHaveBeenCalledExactlyOnceWith(f.url);
});

test('hidden catalogue names keep the authored product identity, like ordinary first-party entry', async () => {
  const f = fixture();
  expect(await readGridProductEdges(f.url, `_${f.source.identity.slug}`, f.options)).toEqual({ edge: f.source.edge, entryways: f.source.entryways });
  expect(f.fetch.mock.calls.map(([url]) => url)).toEqual([f.url, f.edgeUrl]);
});

test('warm edge sections use exact cached bytes without another network revalidation', async () => {
  const f = fixture(), bytes = f.wires.get(f.edgeUrl);
  if (bytes === undefined) throw new Error('Missing edge fixture');
  const cachedResponse = vi.fn(async (_url: string, _hash: string, _maximum: number) => {
    await Promise.resolve(); return bytes;
  });
  expect(await readGridProductEdges(f.url, f.source.identity.slug, { ...f.options, cachedResponse }))
    .toEqual({ edge: f.source.edge, entryways: f.source.entryways });
  expect(cachedResponse).toHaveBeenCalledExactlyOnceWith(f.edgeUrl, hashImmutableBytes(bytes), bytes.length);
  expect(f.fetch.mock.calls.map(([url]) => url)).toEqual([f.url]);
  await expect(readGridProductEdges(f.url, f.source.identity.slug, { ...f.options,
    cachedResponse: async () => { await Promise.resolve(); return new Uint8Array(bytes.length); } })).rejects.toThrow('hash or size');
});

test.each(['pending', 'rejected', 'throws'] as const)('verified grid render bytes do not wait for %s background persistence', async kind => {
  const f = fixture(`background-${kind}`);
  let writing = (): void => { throw new Error('Missing write observer'); }, release = (): void => { throw new Error('Missing write release'); };
  const started = new Promise<void>(resolve => { writing = resolve; }), stored = new Promise<boolean>(resolve => { release = () => { resolve(true); }; });
  const durable = vi.fn(() => { writing(); return stored; }), publish = vi.fn(() => Promise.resolve());
  const cache: ProductCache = { product: () => Promise.resolve(null), asset: () => Promise.resolve(null), putAsset: durable, putProduct: publish,
    putAssetBackground: () => { writing(); if (kind === 'throws') throw new Error('Disk unavailable'); return kind === 'pending' ? stored : Promise.reject(new Error('Disk unavailable')); } };
  const wire = f.wires.get(f.url); if (wire === undefined) throw new Error('Missing index');
  let complete = false;
  const reading = readGridProductEdges(f.url, f.source.identity.slug, { ...f.options, cache, firstParty: true,
    built: { indexes: new Set([hashImmutableBytes(wire)]), stale: () => Promise.resolve() } }).then(value => { complete = true; return value; });
  try {
    await started;
    // All transport/hash work finished before persistence started. Drain its
    // microtasks in one Node turn while the disk promise remains unresolved.
    await new Promise<void>(resolve => { setImmediate(resolve); });
    expect(complete).toBe(true);
    expect(await reading).toEqual({ edge: f.source.edge, entryways: f.source.entryways });
    expect(durable).not.toHaveBeenCalled(); expect(publish).not.toHaveBeenCalled();
  } finally { release(); await reading.catch(() => undefined); }
});

test('O26: a world without mesh collision reads only the index and its collision section for its far proxy', async () => {
  const f = fixture(), collision = new URL('sections/world/collision.json', f.url).href;
  const payload = outputSectionPayloads(f.source).get('world/collision');
  if (payload === undefined) throw new Error('Missing collision fixture');
  f.wires.set(collision, new TextEncoder().encode(encodeCanonicalJson(payload)));
  expect(await readGridProductFar(f.url, f.source.identity.slug, f.options)).toBeNull();
  expect(f.fetch.mock.calls.map(([url]) => url)).toEqual([f.url, collision]);
});

test('G608: a product without near content reads only the index and its tiles section for its near view', async () => {
  const f = fixture(), tiles = new URL('sections/world/tiles.json', f.url).href, payload = outputSectionPayloads(f.source).get('world/tiles');
  if (payload === undefined) throw new Error('Missing tiles fixture');
  f.wires.set(tiles, new TextEncoder().encode(encodeCanonicalJson(payload)));
  expect(await readGridProductNear(f.url, f.source.identity.slug, f.options)).toBeNull();
  expect(f.fetch.mock.calls.map(([url]) => url)).toEqual([f.url, tiles]);
});

test('G608: a near view reads its index, tiles and look sections and only its declared near files, never the product', async () => {
  const glb = new Uint8Array([1, 2, 3, 4]), hash = hashImmutableBytes(glb), encode = (value: unknown) => new TextEncoder().encode(encodeCanonicalJson(value));
  const file = { hash, kind: 'glb' as const, compressed: 4, decoded: 4, gpu: 0, triangles: 1, draws: 1, dependencies: [], critical: false };
  const base = emptyShardfile({ slug: 'near-fixture', name: 'Near', author: 'Test', revision: 1, seed: 9 });
  const source = { ...base, files: [file], near: { version: 1 as const, terrain: [], content: [hash] } }, url = 'https://game.test/shardfiles/near-fixture/shard.json';
  const sections = new Map([...outputSectionPayloads(source)].map(([name, value]) => [name, encode(value)]));
  const index = { format: 'wildshard.shardfile', formatVersion: 2, sdk: '0.2', version: source.version, identity: source.identity, requires: source.requires,
    build: { sourceHash: '0'.repeat(64), validator: 'test' }, admission: { budgets: source.budgets, serverBudget: source.serverBudget, authorCaps: source.authorCaps, critical: source.critical, library: source.library },
    sections: [...sections].map(([name, bytes]) => ({ name, path: `sections/${name}.json`, schema: `wildshard:${name}@1`, hash: hashImmutableBytes(bytes), bytes: bytes.length })), schemas: [],
    files: [{ ...file, path: `blobs/glb/${hash}.glb` }], runtime: null };
  const at = (path: string) => new URL(path, url).href, wires = new Map([[url, encode(index)], [at(`blobs/glb/${hash}.glb`), glb], ...[...sections].map(([name, bytes]) => [at(`sections/${name}.json`), bytes] as const)]);
  const fetch = vi.fn((path: string): Promise<Response> => {
    const bytes = wires.get(path); if (bytes === undefined) return Promise.reject(new Error(`Unexpected read: ${path}`));
    return Promise.resolve(new Response(Uint8Array.from(bytes)));
  });
  const near = await readGridProductNear(url, 'near-fixture', { base: new URL('.', url).href, offline: false, firstParty: false, fetch, hash: (bytes: Uint8Array) => Promise.resolve(hashImmutableBytes(bytes)) });
  if (near === null) throw new Error('Missing near view');
  expect(near.rows.near.content).toEqual([hash]); expect(near.rows.inventory.files.map(row => row.kind)).toEqual(['glb']);
  expect(await near.read(hash)).toEqual(glb);
  await expect(near.read('0'.repeat(64))).rejects.toThrow('Undeclared grid near file');
  expect(fetch.mock.calls.map(([path]) => path)).toEqual([url, at('sections/world/tiles.json'), at('sections/look/look.json'), at(`blobs/glb/${hash}.glb`)]);
});


function packedGridFixture(slug: string, corruptMember = false) {
  const f = fixture(slug), encode = (value: unknown) => new TextEncoder().encode(encodeCanonicalJson(value));
  const indexWire = f.wires.get(f.url);
  if (indexWire === undefined) throw new Error('Missing packed index');
  const index = parseOutputIndex(JSON.parse(new TextDecoder().decode(indexWire)));
  const members = new Map([...f.sectionBytes.values()].map(body => [hashImmutableBytes(body), body]));
  const wire = new Uint8Array([...members.values()].reduce((sum, body) => sum + body.length, 0));
  let offset = 0;
  const entries = [...members].map(([hash, body]) => { const entry = { hash, offset, bytes: body.length }; wire.set(body, offset); offset += body.length; return entry; });
  if (corruptMember) {
    const edge = index.sections.find(section => section.name === 'world/edge'), entry = entries.find(row => row.hash === edge?.hash);
    if (entry === undefined) throw new Error('Missing packed edge');
    wire[entry.offset] = 99;
  }
  const hash = hashImmutableBytes(wire), pack = { path: `blobs/pack/${hash}.pack`, hash, bytes: wire.length, entries };
  const packUrl = new URL(pack.path, f.url).href;
  f.wires.set(f.url, encode({ ...index, packs: [pack] })); f.wires.set(packUrl, wire);
  return { ...f, packUrl, wire };
}

test('neighbour section waves use one verified whole pack instead of section GETs', async () => {
  const f = packedGridFixture('packed-neighbour');
  expect(await readGridProductEdges(f.url, f.source.identity.slug, f.options)).toEqual({ edge: f.source.edge, entryways: f.source.entryways });
  expect(await readGridProductNear(f.url, f.source.identity.slug, f.options)).toBeNull();
  expect(await readGridProductEdges(f.url, f.source.identity.slug, f.options)).toEqual({ edge: f.source.edge, entryways: f.source.entryways });
  expect(f.fetch.mock.calls.map(([url]) => url)).toEqual([f.url, f.packUrl, f.url, f.url]);
});

test('neighbour pack hash refusal can retry, and member hashes remain independent', async () => {
  const f = packedGridFixture('packed-neighbour-retry'), wrong = Uint8Array.from(f.wire); wrong[0] = 99;
  f.wires.set(f.packUrl, wrong);
  await expect(readGridProductEdges(f.url, f.source.identity.slug, f.options)).rejects.toThrow('pack hash or size');
  f.wires.set(f.packUrl, f.wire);
  expect(await readGridProductEdges(f.url, f.source.identity.slug, f.options)).toEqual({ edge: f.source.edge, entryways: f.source.entryways });
  const corrupt = packedGridFixture('packed-neighbour-member', true);
  await expect(readGridProductEdges(corrupt.url, corrupt.source.identity.slug, corrupt.options)).rejects.toThrow('file sections/world/edge.json hash or size');
});

test('offline neighbour sections never fall through to a network pack', async () => {
  const f = packedGridFixture('packed-neighbour-offline');
  await expect(readGridProductEdges(f.url, f.source.identity.slug, { ...f.options, offline: true })).rejects.toThrow('Missing cached grid product file');
  expect(f.fetch).toHaveBeenCalledExactlyOnceWith(f.url);
});

/** OFFLINE OF8: the far charge, the far proxy and the near proxy read a neighbour's sections at once; one URL is one read. */
test('OF8: two concurrent reads of one section URL make one fetch', async () => {
  const f = fixture('of8-shared-section');
  let open = (): void => { throw new Error('Missing gate'); };
  const gate = new Promise<void>(resolve => { open = resolve; });
  const fetch = vi.fn(async (path: string): Promise<Response> => {
    if (path === f.edgeUrl) await gate;
    return f.fetch(path);
  });
  const options = { ...f.options, fetch };
  const reads = [readGridProductEdges(f.url, f.source.identity.slug, options), readGridProductEdges(f.url, f.source.identity.slug, options)];
  // both readers are past their index before the section read may finish
  await vi.waitFor(() => { expect(fetch.mock.calls.filter(([url]) => url === f.url)).toHaveLength(2); });
  await new Promise<void>(resolve => { setImmediate(resolve); });
  open();
  expect(await Promise.all(reads)).toEqual([{ edge: f.source.edge, entryways: f.source.entryways }, { edge: f.source.edge, entryways: f.source.entryways }]);
  expect(fetch.mock.calls.filter(([url]) => url === f.edgeUrl)).toHaveLength(1);
  // settled reads are not kept: a later read asks again (the service worker's cache answers it)
  await readGridProductEdges(f.url, f.source.identity.slug, options);
  expect(fetch.mock.calls.filter(([url]) => url === f.edgeUrl)).toHaveLength(2);
});

test('OF8: a first-party section URL carries ?v= from the hash its index declares, and is read once a load', async () => {
  const f = fixture('of8-versioned-section'), edgeHash = hashImmutableBytes(f.wires.get(f.edgeUrl) ?? new Uint8Array());
  let open = (): void => { throw new Error('Missing gate'); };
  const gate = new Promise<void>(resolve => { open = resolve; });
  const reads: string[] = [];
  const options = { ...f.options, firstParty: true, descriptorHash: 'a'.repeat(64), firstPartyRead: async (url: string, size: number | undefined, _read?: (bytes: number) => void, hash?: string) => {
    reads.push(url);
    const address = new URL(url); address.search = '';
    if (address.href === f.edgeUrl) { expect(hash).toBe(edgeHash); await gate; }
    const bytes = f.wires.get(address.href); if (bytes === undefined || (size !== undefined && size !== bytes.length)) throw new Error('Missing emitted file');
    return bytes;
  } };
  const both = Promise.all([readGridProductEdges(f.url, f.source.identity.slug, options), readGridProductEdges(f.url, f.source.identity.slug, options)]);
  await vi.waitFor(() => { expect(reads.filter(url => new URL(url).pathname === new URL(f.url).pathname)).toHaveLength(2); });
  await new Promise<void>(resolve => { setImmediate(resolve); });
  open();
  await both;
  expect(reads.filter(url => new URL(url).pathname === new URL(f.edgeUrl).pathname)).toEqual([`${f.edgeUrl}?v=${edgeHash.slice(0, 8)}`]);
  // a later reader in the same load (the far and near proxies after the far charge) reads none: the bytes were kept
  expect(await readGridProductEdges(f.url, f.source.identity.slug, options)).toEqual({ edge: f.source.edge, entryways: f.source.entryways });
  expect(reads.filter(url => new URL(url).pathname === new URL(f.edgeUrl).pathname)).toHaveLength(1);
});
