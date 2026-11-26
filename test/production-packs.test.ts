// @vitest-environment node
import { expect, test } from 'vitest';
import { missingProductionPacks, PRODUCTION_CATALOGUE } from '../src/scripts/page-release/production-packs.mjs';

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
  const { waitForPacks } = await import('../src/scripts/page-release/production-packs.mjs');
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
