// MAP-NEXT MN4 and MN6 (J450): the cooked-map audit reads each channel's build, placed cells and catalogue heads, then each head's
// cook index, and names every head a page would draw without its map. It never touches the network here.
import {expect, test} from 'vitest';
import {auditCookedMaps, auditLines, mapKeys, MISSING} from '../src/scripts/cooked-map-audit.mjs';

const hash = (n: number): string => n.toString(16).padStart(64, '0');
const PACKS = 'https://packs.test/', API = 'https://api.test', origins = {production: 'https://play.test', staging: 'https://staging.test'} as const;

/** A store with one build a channel, three shards and their indexes; `drop` removes keys from one index, `unserved` paths 404. */
function world(options: {drop?: {hash: string; size: 'full' | 'cell'}; unserved?: string; noIndex?: string} = {}): typeof fetch {
  const shards = [
    {slug: 'glowfen', live: {hash: hash(1)}, channels: {staging: {raw: hash(2)}}},
    {slug: 'mossgate', channels: {staging: {raw: hash(3)}}},
    {slug: 'pine-hollow', live: {hash: hash(4)}, preview: {hash: hash(4)}},
  ];
  const placements = {staging: [{instance: 'mossgate', slug: 'mossgate', cell: [2, 3], hash: hash(3)}], production: [{instance: 't', slug: '_template', cell: [1, 1], hash: hash(5)}]};
  const slugOf = new Map([[hash(1), 'glowfen'], [hash(2), 'glowfen'], [hash(3), 'mossgate'], [hash(4), 'pine-hollow'], [hash(5), 'template']]);
  const cooked: Record<string, readonly string[]> = {'build-p': [hash(1), hash(4), hash(5)], 'build-s': [hash(1), hash(2), hash(3), hash(4)]};
  const json = (body: unknown): Response => new Response(JSON.stringify(body), {status: 200});
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url === `${API}/api/catalogue`) return json({shards});
    for (const [channel, origin] of Object.entries(origins)) {
      if (url === `${origin}/version.json`) return json({build: channel === 'production' ? 'build-p' : 'build-s'});
      if (url === `${PACKS}releases/${channel}-placements.json`) return json({body: JSON.stringify({cells: placements[channel as keyof typeof placements]}), signature: 'x'});
    }
    const index = /^https:\/\/packs\.test\/index\/([\w-]+)\/([a-f0-9]{64})\.json\?t=\d+$/u.exec(url);
    if (index !== null) {
      const [, build = '', head = ''] = index, slug = slugOf.get(head) ?? '';
      if (!(cooked[build] ?? []).includes(head) || head === options.noIndex) return new Response('', {status: 404});
      const loose = `loose/${head}/`, [full = '', cell = ''] = mapKeys(loose, slug);
      const keys = [`${loose}shardfiles/${slug}/shard.json`, ...options.drop?.hash === head ? [options.drop.size === 'full' ? cell : full] : [full, cell]];
      return json({version: 1, build, slug, hash: head, loose, keys});
    }
    if (init?.method === 'HEAD' && url.startsWith(`${PACKS}loose/`)) return new Response(null, {status: url === `${PACKS}${options.unserved ?? ''}` ? 404 : 200});
    throw new Error(`unexpected ${url}`);
  }) as typeof fetch;
}
const audit = (read: typeof fetch): ReturnType<typeof auditCookedMaps> => auditCookedMaps({fetch: read, origins, packs: PACKS, api: API, now: () => 0});

test('every cooked head with both keys served is mapped; a catalogue head no page of the build reads is only noted', async () => {
  const rows = await audit(world());
  expect(rows.filter(row => MISSING.includes(row.state))).toEqual([]);
  expect(rows.filter(row => row.state === 'uncooked').map(row => `${row.channel} ${row.slug}`).sort()).toEqual(['production glowfen', 'production mossgate']);
  expect(rows.find(row => row.channel === 'production' && row.slug === 'template')).toMatchObject({state: 'ok', from: ['placed']});
  expect(auditLines(rows).at(-1)).toBe('staging build build-s: 4 heads, 4 mapped, 0 missing a map, 0 not cooked for this build (no page of it reads them)');
});

test('an index that lacks either cooked-map-v1 key is missing its map, named by slug', async () => {
  for (const size of ['full', 'cell'] as const) {
    const rows = await audit(world({drop: {hash: hash(3), size}}));
    const missing = rows.filter(row => MISSING.includes(row.state));
    expect(missing).toMatchObject([{channel: 'staging', slug: 'mossgate', state: 'no-map'}]);
    expect(missing[0]?.detail).toContain(size === 'full' ? 'cooked-map-v1.png' : 'cooked-map-v1-cell.png');
    expect(auditLines(rows).some(line => line.startsWith('MISSING staging mossgate'))).toBe(true);
  }
});

test('a listed map the store does not serve, and a placed head with no index, are missing too', async () => {
  const [, cell = ''] = mapKeys(`loose/${hash(1)}/`, 'glowfen');
  expect((await audit(world({unserved: cell}))).filter(row => MISSING.includes(row.state)).map(row => `${row.channel} ${row.slug} ${row.state}`).sort())
    .toEqual(['production glowfen map-404', 'staging glowfen map-404']);
  expect((await audit(world({noIndex: hash(5)}))).filter(row => MISSING.includes(row.state))).toMatchObject([{channel: 'production', slug: 'template', state: 'no-index'}]);
});
