import { expect, test } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readTar, writeTar } from '@wildshard/format/tar';
import { CHANNELS, belowLines, channelPointers, compareFormat, declaredFormat, originalFormat, pointersBelowFloor } from '../src/scripts/format-floor-pointers.mjs';
import { formatApiFailures } from '../src/scripts/format-api-gate.mjs';

// Meta QA 11-25 row 143: FP24's floor 0.1.0.1 shipped while production's open-plot-desert-ruin and open-plot-thin-ice
// pointers named their r1 originals (shard.json declares 0.1), and v0.1.96's server release refused production play.
// Made-up fixtures in that shape (J507: never a stored zone).
const hash = (name: string): string => createHash('sha256').update(name).digest('hex');
const RUIN_R1 = hash('ruin r1'), RUIN_R3 = hash('ruin r3'), ICE_R1 = hash('ice r1'), ICE_R4 = hash('ice r4'), PINE = hash('pine');
const pointer = (raw: string) => ({ raw, formatVersion: '0.1.0.6', migrations: [] });
const catalogue = { shards: [
  { slug: 'open-plot-desert-ruin', channels: { preview: pointer(RUIN_R3), staging: pointer(RUIN_R3), production: pointer(RUIN_R1) } },
  { slug: 'open-plot-thin-ice', channels: { preview: pointer(ICE_R4), staging: pointer(ICE_R4), production: pointer(ICE_R1) } },
  { slug: 'pine-hollow', channels: { preview: pointer(PINE), staging: pointer(PINE), production: pointer(PINE) } },
] };
const shardfiles = { shardfiles: [
  { hash: RUIN_R1, revisions: [{ shard: 'open-plot-desert-ruin', revision: 1 }] },
  { hash: RUIN_R3, revisions: [{ shard: 'open-plot-desert-ruin', revision: 3 }] },
  { hash: ICE_R1, revisions: [{ shard: 'open-plot-thin-ice', revision: 1 }] },
  { hash: ICE_R4, revisions: [{ shard: 'open-plot-thin-ice', revision: 4 }] },
  { hash: PINE, revisions: [{ shard: 'pine-hollow', revision: 18 }] },
] };
const declared: Record<string, string> = { [RUIN_R1]: '0.1', [ICE_R1]: '0.1', [RUIN_R3]: '0.1.0.4', [ICE_R4]: '0.1.0.4', [PINE]: '0.1.0.6' };

test('formats compare by part, the two-part spelling with zero counters', () => {
  expect(compareFormat('0.1', '0.1.0.1')).toBe(-1);
  expect(compareFormat('0.1.0.0', '0.1')).toBe(0);
  expect(compareFormat('0.1.0.10', '0.1.0.9')).toBe(1);
  expect(() => compareFormat('0.1.x', '0.1')).toThrow(/not a format version/u);
});

test('a shard.json declares its format, or the legacy version beside the layout marker', () => {
  expect(declaredFormat({ formatVersion: '0.1.0.4' })).toBe('0.1.0.4');
  expect(declaredFormat({ formatVersion: 2, version: '0.1' })).toBe('0.1');
  expect(() => declaredFormat({ formatVersion: 3 })).toThrow(/declares no format/u);
});

test('every production and staging pointer is listed with its revision; preview, which follows staging, never is', () => {
  const pointers = channelPointers(catalogue, shardfiles);
  expect(pointers).toHaveLength(6);
  expect(pointers).toContainEqual({ channel: 'production', slug: 'open-plot-desert-ruin', hash: RUIN_R1, revision: 1 });
  expect(pointers).toContainEqual({ channel: 'staging', slug: 'open-plot-thin-ice', hash: ICE_R4, revision: 4 });
  // meta QA 11-26 rows 9 and 10: preview's pointers are staging's, so a low one is listed once and its fix is staging's
  expect(CHANNELS).not.toContain('preview');
  expect(pointers.filter(row => row.channel === 'preview')).toEqual([]);
});

test('the desert-ruin and thin-ice shape: a floor of 0.1.0.1 lists production\'s r1 pointers, each original read once', async () => {
  const reads: string[] = [];
  const below = await pointersBelowFloor(channelPointers(catalogue, shardfiles), '0.1.0.1', raw => {
    reads.push(raw); return Promise.resolve(declared[raw] ?? '');
  });
  expect(belowLines(below)).toEqual([
    `production open-plot-desert-ruin r1 ${RUIN_R1.slice(0, 12)} (0.1)`,
    `production open-plot-thin-ice r1 ${ICE_R1.slice(0, 12)} (0.1)`,
  ]);
  expect(reads).toHaveLength(5);
  // once production points past the floor (the format move, or a flip), nothing is listed
  const moved = { shards: catalogue.shards.map(row => ({ ...row, channels: { ...row.channels, production: row.channels.staging } })) };
  expect(await pointersBelowFloor(channelPointers(moved, shardfiles), '0.1.0.1', raw => Promise.resolve(declared[raw] ?? ''))).toEqual([]);
});

test('an original\'s format is read from its bytes past the API\'s redirect, unmarked at storage, then cached', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'floor-pointers-'));
  try {
    const tar = writeTar(new Map([['shard.json', new TextEncoder().encode(JSON.stringify({ formatVersion: 2, version: '0.1' }))]]));
    const raw = createHash('sha256').update(tar).digest('hex');
    const seen: { url: string; marked: boolean }[] = [];
    const read = ((input: string | URL | Request, options?: RequestInit) => {
      const url = String(input);
      seen.push({ url, marked: new Headers(options?.headers).has('user-agent') });
      return Promise.resolve(url.startsWith('https://api.example.test/')
        ? new Response(null, { status: 302, headers: { location: `https://storage.example.test/${raw}.tar.br` } })
        : new Response(tar));
    }) as typeof fetch;
    const cache = join(dir, 'raw-formats.json');
    const formatOf = originalFormat({ api: 'https://api.example.test', read, cache, readTar });
    expect(await formatOf(raw)).toBe('0.1');
    expect(seen.map(row => row.url)).toEqual([`https://api.example.test/api/shardfiles/${raw}`, `https://storage.example.test/${raw}.tar.br`]);
    expect(seen[1]?.marked).toBe(false);
    expect(JSON.parse(readFileSync(cache, 'utf8'))).toEqual({ [raw]: '0.1' });
    expect(await formatOf(raw)).toBe('0.1');
    expect(seen).toHaveLength(2);
    await expect(originalFormat({ api: 'https://api.example.test', read, cache: join(dir, 'other.json'), readTar })(hash('not these bytes')))
      .rejects.toThrow(/differs from its hash/u);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

const lock = (version: string): string => `lockfileVersion: '9.0'

importers:

  .:
    dependencies:
      '@wildshard/format':
        specifier: npm:@wildshard/shard-format@${version}
        version: '@wildshard/shard-format@${version}(typescript@6.0.3)'

packages:

  '@wildshard/shard-format@${version}':
    resolution: {integrity: sha512-HbNtrUnsBQHq+q0y95b298kf4w3sQQ1Yef==}
    engines: {node: '>=24.18.0'}

snapshots:
`;
const apiAt = (version: string) => (): Promise<string> => Promise.resolve(version);

test('a pin move is refused while a pointer sits below its floor, naming each', async () => {
  const floor = () => Promise.resolve({ floor: '0.1.0.1', below: [
    { channel: 'production', slug: 'open-plot-desert-ruin', hash: RUIN_R1, revision: 1, format: '0.1' },
    { channel: 'production', slug: 'open-plot-thin-ice', hash: ICE_R1, revision: 1, format: '0.1' },
  ] });
  const failures = await formatApiFailures(lock('0.79.0'), lock('0.80.0'), { warn: () => undefined, env: {}, observe: apiAt('0.80.0'), floor });
  expect(failures).toHaveLength(1);
  expect(failures[0]).toContain('shard-format 0.80.0\'s floor 0.1.0.1 is above 2 API pointers');
  expect(failures[0]).toContain(`production open-plot-desert-ruin r1 ${RUIN_R1.slice(0, 12)} (0.1)`);
  expect(failures[0]).toContain('ALLOW_FLOOR_POINTERS=1');
  // no pointer below: passes; the escape hatch passes and says so; an unreadable API warns and passes
  expect(await formatApiFailures(lock('0.79.0'), lock('0.80.0'), { warn: () => undefined, env: {}, observe: apiAt('0.80.0'), floor: () => Promise.resolve({ floor: '0.1.0.1', below: [] }) })).toEqual([]);
  const lines: string[] = [];
  expect(await formatApiFailures(lock('0.79.0'), lock('0.80.0'), { warn: line => { lines.push(line); }, env: { ALLOW_FLOOR_POINTERS: '1' }, observe: apiAt('0.80.0'), floor })).toEqual([]);
  expect(await formatApiFailures(lock('0.79.0'), lock('0.80.0'), { warn: line => { lines.push(line); }, env: {}, observe: apiAt('0.80.0'), floor: () => Promise.reject(new Error('offline')) })).toEqual([]);
  expect(lines.join('\n')).toMatch(/ALLOW_FLOOR_POINTERS=1[\s\S]*offline/u);
  // a lock whose pin did not move is never judged
  expect(await formatApiFailures(lock('0.80.0'), lock('0.80.0'), { warn: () => undefined, env: {}, observe: apiAt('0.80.0'), floor })).toEqual([]);
});
