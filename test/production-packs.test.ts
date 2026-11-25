// @vitest-environment node
import { expect, test } from 'vitest';
import { missingProductionPacks, PRODUCTION_CATALOGUE } from '../scripts/page-release/production-packs.mjs';

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
