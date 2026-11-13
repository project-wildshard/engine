// oxlint-disable-next-line import/no-nodejs-modules -- The packer writes its parts into an owned ./tmp folder.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Paths for the owned fixture folder.
import { join, resolve } from 'node:path';
// oxlint-disable-next-line import/no-nodejs-modules -- The encoded parts are checked by decoding them.
import { brotliDecompressSync } from 'node:zlib';
// oxlint-disable-next-line import/no-nodejs-modules -- Part hashes.
import { createHash } from 'node:crypto';
import { afterAll, expect, test } from 'vitest';
import { PART_BYTES, PART_LIMITS, WHOLE_PART_LIMITS, createPartEncoder, packable, placeByKey, placementKey, spawnPartGroups, writeSpawnParts, type SpawnPartInput } from '../src/cook/game/spawnParts';
import { readSpawnManifest, type SpawnFile, type SpawnPart } from '../src/shared/game/shardfile/spawnManifest';
import { SERVER_PART_BYTES, cookServerPack, cookServerRows } from '../src/cook/game/shardCook';
import { serverPackFile, serverPackPart } from '../src/shared/game/shardfile/serverPack';

mkdirSync('tmp', { recursive: true });
const out = mkdtempSync(resolve('tmp/spawn-parts-'));
afterAll(() => rmSync(out, { recursive: true, force: true }));
const body = (url: string, bytes: number): Uint8Array => Uint8Array.from({ length: bytes }, (_, at) => (url.length * 31 + at) % 251);
const file = (url: string, bytes: number): SpawnFile => ({ url, bytes, hash: 'a'.repeat(64) });
const manifest = (rows: SpawnFile[], open = true): SpawnPartInput => ({ rows, public: open });
// Each test build encodes with its own kept-encoding folder and two lanes (never the user's cache).
const encoder = (cache = join(out, 'part-cache')) => createPartEncoder(cache, 2);
const decoded = (dir: string, url: string): Uint8Array => brotliDecompressSync(readFileSync(join(dir, url.slice(1))));

test('every manifest file is one aligned member of a shared part, with its exact bytes', async () => {
  const shared = file('/assets/code-aaaaaaaa.js', 1001), a = file('/shardfiles/a/blobs/glb/1.glb', 333), b = file('/shardfiles/b/blobs/glb/2.glb', 77);
  const inputs = [manifest([shared, a]), manifest([shared, b]), manifest([a, b], false)];
  const tables = await writeSpawnParts(out, inputs, url => body(url, [shared, a, b].find(row => row.url === url)?.bytes ?? 0), undefined, encoder());
  const packedAt = new Map<string, string>();
  tables.forEach((parts, index) => {
    const rows = inputs[index]?.rows ?? [];
    // The manifest grammar accepts the table as written.
    expect(readSpawnManifest({ version: 1, shard: 'a', tier: 'phone', flow: 'grid', files: rows, totalBytes: rows.reduce((sum, row) => sum + row.bytes, 0), parts }).parts).toEqual(parts);
    // Fetched files are members; JS modules stay loose (DL14).
    expect(parts.flatMap(part => part.members.map(([member]) => member)).sort((left, right) => left - right))
      .toEqual(rows.flatMap((row, at) => row.url.endsWith('.js') ? [] : [at]));
    for (const part of parts) {
      const bytes = decoded(out, part.url); // only the q11 body is written
      expect(bytes.length).toBe(part.bytes);
      for (const [member, offset] of part.members) {
        const row = rows[member]; if (row === undefined) throw new Error('Missing member row');
        expect(offset % 16).toBe(0);
        expect(new Uint8Array(bytes.subarray(offset, offset + row.bytes))).toEqual(body(row.url, row.bytes));
        // A file lives in exactly one part, whichever manifest names it.
        expect(packedAt.get(row.url) ?? part.url).toBe(part.url); packedAt.set(row.url, part.url);
      }
    }
  });
});

test('public entries steer the merge within the over-fetch cap; the grammar refuses broken tables', async () => {
  // Entry 0 needs a shared core and twelve small files; entry i needs the core and small file i. That is 13 groups
  // for entry 0, so small groups merge while each entry's added bytes stay within 10 % of its own.
  const rows = Array.from({ length: 12 }, (_, at) => file(`/shardfiles/s/blobs/bin/${at}.bin`, 1000));
  const setOf = (core: SpawnFile): SpawnPartInput[] => [manifest([core, ...rows]), ...rows.map(row => manifest([core, row]))];
  const parts = (groups: ReturnType<typeof spawnPartGroups>): number => groups.filter(group => group.members.has(0)).length;
  const roomy = spawnPartGroups(setOf(file('/shardfiles/s/blobs/bin/core.bin', 1_000_000)));
  expect(parts(roomy)).toBeLessThanOrEqual(10);
  expect(roomy.reduce((sum, group) => sum + group.bytes, 0)).toBe(1_012_000); // every file once, nothing copied
  // With a 5 KB core, any merge adds 1 KB to an entry of 6 KB (17 %): the cap holds and nothing merges.
  expect(parts(spawnPartGroups(setOf(file('/shardfiles/s/blobs/bin/core.bin', 5000))))).toBe(13);
  // A file larger than a part is refused: every part stays within 12 MB.
  const big = file('/shardfiles/s/blobs/bin/big.bin', PART_BYTES + 1);
  await expect(writeSpawnParts(out, [manifest([big])], () => new Uint8Array(PART_BYTES + 1), undefined, encoder())).rejects.toThrow('Spawn file larger than a part');
  // Shard images are fetched, so they pack; the shell's /assets/ images and code stay loose.
  expect(packable('/shardfiles/s/blobs/png/a.png')).toBe(true);
  expect(packable('/assets/title/hero-0123abcd.webp')).toBe(false); expect(packable('/assets/code-0123abcd.js')).toBe(false);
  const base = { version: 1, shard: 's', tier: 'phone', flow: 'grid', files: [rows[0], rows[1]], totalBytes: 2000 } as const;
  const part = (members: [number, number][]) => ({ url: `/assets/spawn/parts/${'b'.repeat(16)}.pack.br`, bytes: 4096, hash: 'b'.repeat(64), members });
  expect(() => readSpawnManifest({ ...base, parts: [part([[0, 0], [1, 1000]])] })).toThrow('Invalid spawn part member'); // overlap + misaligned
  expect(() => readSpawnManifest({ ...base, parts: [part([[0, 0]]), part([[0, 1008]])] })).toThrow('Invalid spawn part member'); // packed twice
  expect(() => readSpawnManifest({ ...base, parts: [part([[0, 0], [1, 3200]])] })).toThrow('Invalid spawn part member'); // past the end
  expect(readSpawnManifest({ ...base, parts: [part([[0, 0], [1, 1008]])] }).parts?.[0]?.members).toEqual([[0, 0], [1, 1008]]);
});

test('a resized named file changes only its own part', async () => {
  // Twelve 1 MB models in one group: more than one part. Model 3 is re-exported larger under a new content name.
  const named = (at: number, bytes: number, edit = ''): SpawnFile => file(`/shardfiles/s/blobs/glb/${at}${edit}.glb`, bytes);
  const before = Array.from({ length: 12 }, (_, at) => named(at, 1_000_000));
  const after = before.map((row, at) => at === 3 ? named(3, 1_400_000, '-edited') : row);
  const keyOf = (url: string): string => `models/${/\/(\d+)(?:-edited)?\.glb$/u.exec(url)?.[1] ?? url}.glb`;
  // Bodies differ per file (the shared helper only varies with URL length, which would make equal parts collide).
  const seed = (url: string): number => Array.from(url, char => char.codePointAt(0) ?? 0).reduce((sum, code) => sum + code, 0);
  const read = (rows: SpawnFile[]) => (url: string): Uint8Array => {
    const value = seed(url);
    return Uint8Array.from({ length: rows.find(row => row.url === url)?.bytes ?? 0 }, (_, at) => (value + at) % 251);
  };
  const pack = async (rows: SpawnFile[]): Promise<Map<string, string>> => {
    // The 12 MB rule: 4 MiB cuts every four models, and a forced cut moves with a resize (S12e measured that on Pine).
    const [parts] = await writeSpawnParts(out, [manifest(rows)], read(rows), keyOf, encoder(), new Map(), WHOLE_PART_LIMITS);
    return new Map((parts ?? []).flatMap(part => part.members.map(([member]) => [rows[member]?.url ?? '', part.url] as const)));
  };
  const first = await pack(before), second = await pack(after);
  expect(new Set(first.values()).size).toBeGreaterThan(1);
  const changed = new Set<string>();
  for (const [url, part] of second) if (first.get(url) !== part) changed.add(part);
  // Only the edited model's part has new bytes; every other part keeps its exact name.
  expect([...changed]).toEqual([second.get(named(3, 0, '-edited').url)]);
});

test('two builds that differ only in shard.json stamps keep every part name', async () => {
  // DL18: the product header (shard.json) carries the build's validator stamp; it stays loose, so parts depend only on
  // their content-named members.
  const members = Array.from({ length: 6 }, (_, at) => file(`/shardfiles/s/blobs/glb/${at}.glb`, 2_000_000));
  const header = (stamp: string): SpawnFile => file(`/shardfiles/s/shard.json?v=${stamp}`, 400);
  const parts = async (stamp: string): Promise<string[]> => {
    const rows = [header(stamp), ...members];
    const [table] = await writeSpawnParts(out, [manifest(rows)], url => url.includes('shard.json') ? body(`${url}${stamp}`, 400) : body(url, 2_000_000), undefined, encoder());
    expect((table ?? []).some(part => part.members.some(([member]) => member === 0))).toBe(false);
    return (table ?? []).map(part => part.url).sort();
  };
  expect(packable('/shardfiles/s/shard.json?v=aaaaaaaa')).toBe(false);
  expect(await parts('aaaaaaaa')).toEqual(await parts('bbbbbbbb'));
});

test('parts ship as q11 Brotli bodies, kept by content between builds', async () => {
  // DL15: only each part's q11 body is written (no raw part on disk, CI disk); a second build reuses the kept
  // encodings, and a kept encoding that no longer decodes to its body is made again.
  const root = mkdtempSync(resolve('tmp/spawn-parts-br-')), cache = join(root, 'cache');
  try {
    const rows = Array.from({length: 4}, (_, at) => file(`/shardfiles/s/blobs/bin/${at}.bin`, 5_000_000));
    const build = async (name: string) => {
      const dir = join(root, name), parts = encoder(cache), [table] = await writeSpawnParts(dir, [manifest(rows)], url => Uint8Array.from({length: 5_000_000}, (_, at) => ((url.codePointAt(url.length - 5) ?? 0) * 7 + at) % 251), undefined, parts);
      return {dir, table: table ?? [], result: parts.stats()};
    };
    const first = await build('one');
    expect(first.table.length).toBeGreaterThan(1);
    expect(first.result).toMatchObject({parts: first.table.length, encoded: first.table.length, rawBytes: first.table.reduce((sum, part) => sum + part.bytes, 0)});
    expect(first.result.wireBytes).toBeLessThan(first.result.rawBytes);
    expect(readdirSync(join(first.dir, 'assets/spawn/parts')).every(name => name.endsWith('.pack.br'))).toBe(true);
    for (const part of first.table) expect(part.wireBytes).toBe(readFileSync(join(first.dir, part.url.slice(1))).length);
    for (const part of first.table) {
      const raw = decoded(first.dir, part.url);
      expect(raw.length).toBe(part.bytes); expect(createHash('sha256').update(raw).digest('hex')).toBe(part.hash);
    }
    expect((await build('two')).result.encoded).toBe(0);
    const [kept] = readdirSync(cache); if (kept === undefined) throw new Error('Missing kept encoding');
    writeFileSync(join(cache, kept), 'not brotli');
    const third = await build('three');
    expect(third.result.encoded).toBe(1);
    expect(existsSync(join(third.dir, (third.table[0]?.url ?? '').slice(1)))).toBe(true);
  } finally { rmSync(root, {recursive: true, force: true}); }
});

test('DL18: an edit that rewrites one section\'s blobs changes only the parts that hold them', () => {
  // sp-x2's real pair (5adf2b0 -> fe210797ab): one Nine edit rewrote 41 bodies, and hashed placement scattered them over
  // 20 of 25 parts. Members now sit in key order (a section's blobs together) and parts end at key-defined boundaries.
  const scene = (at: number, edit = ''): SpawnFile => file(`/shardfiles/s/blobs/glb/${String(at).padStart(4, '0')}${edit}.glb`, 900_000 + at * 1000);
  const model = (at: number): SpawnFile => file(`/shardfiles/s/blobs/bin/m${at}.bin`, 1_200_000);
  const keyOf = (url: string): string => placementKey(url, /\/(\d{4})(?:-edited)?\.glb$/u.test(url)
    ? `world/scenes:libraries.24.tiles.0.files.${/\/(\d{4})/u.exec(url)?.[1] ?? ''}.file` : `models/${url.split('/').pop() ?? ''}`);
  const before = [...Array.from({ length: 40 }, (_, at) => scene(at)), ...Array.from({ length: 40 }, (_, at) => model(at))];
  // The edit rewrites scenes 10-17 (new content-named URLs, new sizes); every other file is byte-identical.
  const after = before.map(row => { const at = Number(/\/(\d{4})\.glb$/u.exec(row.url)?.[1] ?? -1); return at >= 10 && at < 18 ? { ...scene(at, '-edited'), bytes: row.bytes + 250_000 } : row; });
  const sizeOf = (rows: SpawnFile[]) => (url: string): number => rows.find(row => row.url === url)?.bytes ?? 0;
  const partsOf = (rows: SpawnFile[]): string[] => placeByKey(rows.map(row => row.url), sizeOf(rows), keyOf).map(part => part.join(','));
  const first = new Set(partsOf(before)), second = partsOf(after);
  const changed = second.filter(part => !first.has(part));
  // 8 rewritten files (about 9 MB) touch the parts that hold them and at most one neighbour on each side.
  expect(changed.length).toBeLessThanOrEqual(Math.ceil(9_200_000 / PART_BYTES) + 2);
  expect(second.length).toBeGreaterThan(changed.length * 2);
  // Volatile files (sections, build assets) never share a part with level content.
  const mixed = [...before.map(row => row.url), '/shardfiles/s/sections/look/map.json?v=aaaaaaaa', '/assets/boot-tables-0123abcd.json'];
  const volatileKey = (url: string): string => placementKey(url, url.includes('/sections/') ? 'section:look/map' : url.startsWith('/assets/') ? undefined : keyOf(url).split('|')[1]);
  const placed = placeByKey(mixed, url => url.endsWith('.json') || url.includes('.json?') ? 500 : sizeOf(before)(url), volatileKey);
  for (const part of placed) {
    expect(new Set(part.map(url => volatileKey(url).split('|')[0])).size).toBe(1);
  }
  // DL11 slice 4: a section never waits behind a build asset (Nine's sections sat 4.96 MB into its audio part)
  expect(placed.find(part => part.includes('/assets/boot-tables-0123abcd.json'))).not.toContain('/shardfiles/s/sections/look/map.json?v=aaaaaaaa');
});

test('DL18: a product-prefixed section or schema key is a section; a build asset is volatile; a model or scene key is content', () => {
  expect(placementKey('/shardfiles/s/sections/look/map.json?v=aaaaaaaa', '/shardfiles/s/section:look/map')).toBe('section|/shardfiles/s/section:look/map');
  expect(placementKey('/shardfiles/s/schemas/a.json', '/shardfiles/s/schema:schemas/a.json').startsWith('section|')).toBe(true);
  expect(placementKey('/assets/boot-tables-0123abcd.json', undefined)).toBe('volatile|/assets/boot-tables-.json');
  expect(placementKey('/b/a3e7ef2-mw3ukc3m/main-0123abcd.js', undefined)).toBe(placementKey('/b/0dbe219-mw3xxxxx/main-4567cdef.js', undefined));
  expect(placementKey('/shardfiles/s/blobs/glb/x.glb', '/shardfiles/s/world/scenes:libraries.24.tiles.0.files.3.file').startsWith('content|')).toBe(true);
  expect(placementKey('/shardfiles/s/blobs/glb/x.glb', '/shardfiles/s/models/section-gate.glb').startsWith('content|')).toBe(true);
});

// DL11 slice 4 / DL5: the reader fetches parts in table order on two lanes, so a manifest lists its section parts first,
// then the build assets, then level content, whatever order its rows name them in (Driftwood's sections sat sixth)
test('a manifest lists section parts, then build-asset parts, then content parts', async () => {
  const content = Array.from({ length: 3 }, (_, at) => file(`/shardfiles/s/blobs/glb/${at}.glb`, 2_000_000));
  const asset = file('/assets/boot-tables-aaaaaaaa.json', 300_000), section = file('/shardfiles/s/sections/world.json', 200_000);
  const rows = [...content, asset, section];
  const keyOf = (url: string): string | undefined => url.includes('/sections/') ? '/shardfiles/s/section:world/world' : undefined;
  // One 6 MB content part (the 12 MB rule): in 4 MiB parts a 2 MB run of this test's bodies compresses below the asset.
  const [table] = await writeSpawnParts(out, [manifest(rows)], url => body(url, rows.find(row => row.url === url)?.bytes ?? 0), keyOf, encoder(), new Map(), WHOLE_PART_LIMITS);
  const kindOf = (part: SpawnPart): string[] => part.members.map(([index]) => rows[index]?.url ?? '');
  const order = (table ?? []).map(part => kindOf(part).some(url => url.includes('/sections/')) ? 'section'
    : kindOf(part).some(url => url.startsWith('/assets/')) ? 'asset' : 'content');
  expect(order[0]).toBe('section'); expect(order[1]).toBe('asset');
  expect(order.slice(2).every(kind => kind === 'content')).toBe(true);
});

// sp-x2's DL5 gzip n=3: Pine's product data (a small content part) sat behind 58 MB of asset-pack parts; past the sections,
// parts go smallest wire first, so the small ones setup reads first never wait behind the big texture packs
test('past the section parts, a small content part comes before a big asset part', async () => {
  const noise = (url: string, bytes: number): Uint8Array => {
    const bytesOut = new Uint8Array(bytes);
    for (let at = 0; at < bytes; at += 32) bytesOut.set(createHash('sha256').update(`${url}:${String(at)}`).digest().subarray(0, Math.min(32, bytes - at)), at);
    return bytesOut;
  };
  const big = file('/assets/pine-hollow.phone-aaaaaaaa.ktx2', 3_000_000), small = file('/shardfiles/s/blobs/json/data.json', 100_000);
  const rows = [big, small];
  const [table] = await writeSpawnParts(out, [manifest(rows)], url => noise(url, rows.find(row => row.url === url)?.bytes ?? 0), undefined, encoder());
  const first = (table ?? []).map(part => rows[part.members[0]?.[0] ?? -1]?.url);
  expect(first).toEqual([small.url, big.url]);
});

test('C2: a shard\'s pack leads with its server class, and the rest fall in small parts a reader finds', async () => {
  const folder = mkdtempSync(resolve('tmp', 'server-pack-')), hash = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
  const filled = (fill: number, bytes: number): Uint8Array => new Uint8Array(bytes).fill(fill);
  const files = new Map([['shard.json', new TextEncoder().encode('{}')], ['server/class.bin', filled(1, 64)], ['sections/a.json', filled(2, 64)], ['blobs/bin/a.bin', filled(3, SERVER_PART_BYTES - 200)],
    ['blobs/bin/b.bin', filled(4, SERVER_PART_BYTES)], ['blobs/bin/c.bin', filled(5, 64)]]);
  const rows = [...files].map(([path, bytes]) => ({path, hash: hash(bytes), bytes: bytes.length}));
  try {
    const pack = await cookServerRows(rows, new Set(['server/class.bin']), path => files.get(path) ?? new Uint8Array(), folder, createPartEncoder(resolve(folder, 'cache'), 1));
    expect(pack.files.map(row => row[0])).toEqual(['server/class.bin']);
    for (const path of files.keys()) expect(serverPackPart(pack, path), path).toBeDefined();
    for (const part of pack.more ?? []) expect(part.bytes).toBeLessThanOrEqual(SERVER_PART_BYTES + 256);
    const part = serverPackPart(pack, 'blobs/bin/a.bin');
    if (part === undefined) throw new Error('No part');
    expect(serverPackFile(part, brotliDecompressSync(readFileSync(resolve(folder, part.url.slice(1)))), 'blobs/bin/a.bin')).toEqual(Buffer.from(files.get('blobs/bin/a.bin') ?? []));
  } finally { rmSync(folder, {recursive: true, force: true}); }
});

test('C2: a server pack holds the server class by content, and a reader finds each file', async () => {
  const folder = mkdtempSync(resolve('tmp', 'server-pack-')), one = new TextEncoder().encode('navmesh'), two = new Uint8Array(40).fill(7);
  const hash = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
  const files = new Map([['server/one.bin', one], ['server/two.bin', two]]);
  // Out of path order on purpose: the pack's padding follows its sorted order, not the index's.
  const rows = [...files].reverse().map(([path, bytes]) => ({path, bytes: bytes.length, hash: hash(bytes)}));
  try {
    const pack = await cookServerPack(rows, path => files.get(path) ?? new Uint8Array(), folder, createPartEncoder(resolve(folder, 'cache'), 1));
    if (pack === undefined) throw new Error('No pack');
    const unpacked = brotliDecompressSync(readFileSync(resolve(folder, pack.url.slice(1))));
    expect(hash(unpacked)).toBe(pack.hash);
    expect(serverPackFile(pack, unpacked, 'server/one.bin')).toEqual(Buffer.from(one));
    expect(serverPackFile(pack, unpacked, 'server/two.bin')).toEqual(Buffer.from(two));
    expect(serverPackFile(pack, unpacked, 'server/none.bin')).toBeUndefined();
    expect(await cookServerPack([], () => new Uint8Array(), folder, createPartEncoder(resolve(folder, 'cache'), 1))).toBeUndefined();
  } finally { rmSync(folder, {recursive: true, force: true}); }
});

test('the same bytes under two URLs of one manifest each keep a readable part', async () => {
  const size = PART_BYTES - 16, a = file('/shardfiles/s/blobs/glb/a.glb', size), b = file('/assets/s/baked/models.glb', size), same = new Uint8Array(size).fill(7);
  const [table] = await writeSpawnParts(out, [manifest([a, b])], () => same, undefined, encoder());
  expect(new Set(table?.map(part => part.url)).size).toBe(2);
  expect(() => readSpawnManifest({version: 1, shard: 's', tier: 'phone', flow: 'client', files: [a, b], totalBytes: size * 2, parts: table})).not.toThrow();
});

test('S3: a file a desktop list holds never shares a group with a phone\'s own, however many parts a phone needs', () => {
  const row = (name: string, bytes: number): SpawnFile => ({ url: `/shardfiles/a/${name}.bin`, bytes, hash: '0'.repeat(64) });
  const shared = row('shared', 100), own = Array.from({ length: 40 }, (_, at) => row(`own-${at}`, 11_000_000));
  const groups = spawnPartGroups([{ rows: [shared, ...own], public: true }, { rows: [shared], public: false, desktop: true }]);
  expect(groups.find(group => group.urls.includes(shared.url))?.urls).toEqual([shared.url]);
  expect(groups.find(group => group.urls.includes(own[0]?.url ?? ''))?.urls).toHaveLength(40);
});

test('S12e: a part stays within its cap; a file over the cap stands alone', async () => {
  const limits = PART_LIMITS, sizes = new Map<string, number>();
  const urls = Array.from({ length: 30 }, (_, at) => {
    const url = `/shardfiles/s/blobs/ktx2/${String(at).padStart(2, '0')}.ktx2`;
    sizes.set(url, at === 7 ? 5_100_000 : 900_000 + at * 10_000); return url;
  });
  const parts = placeByKey(urls, url => sizes.get(url) ?? 0, url => placementKey(url, undefined), limits);
  expect(parts.flat().sort()).toEqual([...urls].sort());
  for (const part of parts) {
    const bytes = part.reduce((sum, url) => Math.ceil(sum / 16) * 16 + (sizes.get(url) ?? 0), 0);
    if (part.length > 1) expect(bytes).toBeLessThanOrEqual(limits.max); else expect(bytes).toBeLessThanOrEqual(PART_BYTES);
  }
  expect(parts.find(part => part.includes(urls[7] ?? ''))).toEqual([urls[7]]);
  // A phone entry's files take the 4 MiB rule; files only a desktop list holds keep the 12 MB rule.
  const rows = urls.map(url => file(url, sizes.get(url) ?? 0));
  const [phone, desktop] = await writeSpawnParts(out, [manifest(rows.slice(0, 15)), { rows: rows.slice(15), public: false }],
    url => new Uint8Array(sizes.get(url) ?? 0).fill(url.length), undefined, encoder());
  for (const part of phone ?? []) if (part.members.length > 1) expect(part.bytes).toBeLessThanOrEqual(PART_LIMITS.max);
  expect(Math.max(...(desktop ?? []).map(part => part.bytes))).toBeGreaterThan(PART_LIMITS.max);
});
