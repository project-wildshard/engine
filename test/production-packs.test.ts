// @vitest-environment node
import { expect, test } from 'vitest';
import { missingProductionPacks, PRODUCTION_CATALOGUE, waitForPacks } from '../src/scripts/page-release/production-packs.mjs';

const build = 'a'.repeat(40);

// FR-A17: every head production advertises needs `index/<build>/<hash>.json`, read with play's Origin.
test('the production pack check names each advertised head whose exact-build index is not 200', async () => {
  const seen: string[] = [];
  const read = (url: string, init?: RequestInit): Promise<Response> => {
    seen.push(`${url} ${new Headers(init?.headers).get('origin') ?? ''}`.trim());
    if (url === PRODUCTION_CATALOGUE) return Promise.resolve(Response.json({shards: [{slug: 'driftwood-isle', hash: 'h1'}, {slug: 'nalati-grasslands', hash: 'h2'}, {slug: 'glowfen', hash: 'h3'}]}));
    if (url.endsWith('/h1.json')) return Promise.resolve(new Response('{}', {status: 200}));
    if (url.endsWith('/h2.json')) return Promise.resolve(new Response('', {status: 404}));
    return Promise.reject(new Error('reset'));
  };
  expect(await missingProductionPacks(build, read)).toEqual(['nalati-grasslands 404', 'glowfen unread']);
  expect(seen).toContain(`https://packs.wildshard.io/index/${build}/h1.json https://play.wildshard.io`);
  await expect(missingProductionPacks('75fd4b97', read)).rejects.toThrow(/full build SHA/u);
});

// FR-A19: a staging deploy waits, bounded, for the cook instead of touring a build into 404 packs.
test('the pack wait passes once every head is cooked, and holds with the missing heads after its limit', async () => {
  let clock = 0, cooked = 0;
  const read = (url: string): Promise<Response> => {
    if (url.includes('catalogue.json?channel=staging')) return Promise.resolve(Response.json({shards: [{slug: 'brasscap-mesa', hash: 'h1'}, {slug: 'glowfen', hash: 'h2'}]}));
    const done = url.endsWith('/h1.json') ? cooked >= 1 : cooked >= 2;
    return Promise.resolve(new Response('{}', {status: done ? 200 : 404}));
  };
  const lines: string[] = [];
  const sleep = (ms: number): Promise<void> => { clock += ms; cooked++; return Promise.resolve(); };
  await waitForPacks(build, 'staging', {log: line => lines.push(line), read, sleep, now: () => clock, everyMs: 60_000});
  expect(lines[0]).toMatch(/missing on 2 head\(s\): brasscap-mesa 404, glowfen 404/u);
  expect(lines.at(-1)).toBe(`PASS staging packs: every advertised head has index/${build} after 120 s`);
  cooked = -100; clock = 0;
  await expect(waitForPacks(build, 'staging', {log: () => undefined, read, sleep, now: () => clock, limitMs: 180_000}))
    .rejects.toThrow(/still missing on 2 head\(s\) after 3 min: brasscap-mesa 404, glowfen 404/u);
});

// PV25: v0.1.101's staging tour waited 45 min on index/<build> for heads the versioned cook had already written.
test('a build signed with a cook waits on each head\'s cooked index at that cook, by its raw version', async () => {
  const cook = {version: '1.19.0', hash: 'c'.repeat(64)}, at = `cooks/1.19.0/${cook.hash}/index.json`;
  const signed = (engineBuild: string, withCook = true): Response => Response.json({body: JSON.stringify({engineBuild, ...(withCook ? {cook} : {})}), signature: 'x'});
  let staging = signed(build), cooked = new Set([`pine-hollow/0.0.18/${at}`]);
  const seen: string[] = [];
  const read = (url: string, init?: RequestInit): Promise<Response> => {
    seen.push(`${url} ${new Headers(init?.headers).get('origin') ?? ''}`.trim());
    if (url.includes('/api/catalogue.json')) return Promise.resolve(Response.json({shards: [{slug: 'pine-hollow', hash: 'h1', shardVersion: '0.0.18'}, {slug: 'open-plot-sky-race', hash: 'h2', shardVersion: null}]}));
    if (url.endsWith('/api/shardfiles')) return Promise.resolve(Response.json({shardfiles: [{hash: 'h2', shard: 'open-plot-sky-race', shardVersion: '0.0.4'}]}));
    if (url === 'https://releases.wildshard.io/staging.json') return Promise.resolve(staging.clone());
    if (url === 'https://releases.wildshard.io/production.json') return Promise.resolve(signed('b'.repeat(40)));
    const key = url.replace('https://cooked.wildshard.io/shards/', '');
    return Promise.resolve(new Response('{}', {status: cooked.has(key) ? 200 : 404}));
  };
  const opts = {read, log: () => undefined, limitMs: 0};
  await expect(waitForPacks(build, 'staging', opts)).rejects.toThrow(/still missing on 1 head\(s\).*open-plot-sky-race 404/u);
  cooked.add(`open-plot-sky-race/0.0.4/${at}`);
  await waitForPacks(build, 'staging', opts);
  expect(seen).toContain(`https://cooked.wildshard.io/shards/open-plot-sky-race/0.0.4/${at} https://staging.wildshard.io`);
  // Production checks the build staging signed, and a build signed with no cook keeps the legacy index/<build> read.
  expect(await missingProductionPacks(build, read)).toEqual([]);
  staging = signed(build, false); cooked = new Set();
  expect(await missingProductionPacks(build, read)).toEqual(['pine-hollow 404', 'open-plot-sky-race 404']);
  expect(seen).toContain(`https://packs.wildshard.io/index/${build}/h1.json https://play.wildshard.io`);
});

test('RL10 staging lists the exact stale heads and still refuses other missing packs', async () => {
  const release = '37db5402c1c5f8424765e2383638bcd556c946b6';
  const nalati = 'b730599048b8a4a2797b3b2ad3a36d90c40870650a3002ca416a5fa09ad9b718';
  const nine = 'a38ee0a18e59d2e7860a7a6e9320bf1aa3d089ce5b39566a4a23f7b6f7f6689c';
  let second = nine, status = 404;
  const read = (url: string): Promise<Response> => Promise.resolve(url.includes('/api/catalogue.json')
    ? Response.json({shards: [{slug: 'nalati-grasslands', hash: nalati}, {slug: 'nine-dragon-stack', hash: second}]})
    : new Response('', {status}));
  const lines: string[] = [], opts = {read, log: (line: string) => lines.push(line), limitMs: 0};
  await waitForPacks(release, 'staging', opts);
  expect(lines[0]).toBe(`known stale staging head nalati-grasslands ${nalati} will be replaced by SF6`);
  expect(lines[1]).toBe(`known stale staging head nine-dragon-stack ${nine} will be replaced by SF7`);
  await expect(waitForPacks(release, 'production', opts)).rejects.toThrow(/still missing on 2 head\(s\)/u);
  await expect(waitForPacks(build, 'staging', opts)).rejects.toThrow(/still missing on 2 head\(s\)/u);
  second = 'new-head';
  await expect(waitForPacks(release, 'staging', opts)).rejects.toThrow(/still missing on 1 head\(s\).*nine-dragon-stack 404/u);
  status = 500;
  await expect(waitForPacks(release, 'staging', opts)).rejects.toThrow(/nalati-grasslands 500/u);
});
