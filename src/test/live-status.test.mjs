// Meta MINI-AUTONOMY MA3: live-status reads public release files, version.json, health and npm, and answers per channel.
import {expect, test} from 'vitest';
import {SOURCES, readLive, releaseServed, render, whereIs} from '../scripts/live-status.mjs';

const STAGED = '5e0fb5efb35358fc88f8b8f34fd27ba445d90828';
const NEXT = '1288674288946e831f2f923d3ec92d0169af453c';
const release = (/** @type {Record<string, unknown>} */ body) => ({body: JSON.stringify(body), signature: 'sig'});

/** Fixed replies, as the live hosts gave them on 2026-11-16 ~20:15 Cancún. @type {Record<string, unknown>} */
const replies = {
  [SOURCES.staging.release]: release({channel: 'staging', serial: 96, engineBuild: NEXT, bundle: {name: `server-staging-${NEXT}/engine-server-${NEXT}.tar.gz`}}),
  [SOURCES.staging.page]: {build: STAGED, clientVersion: '0.1.31'},
  [SOURCES.staging.box]: {build: STAGED, serial: 95, cells: 28},
  [SOURCES.production.release]: release({channel: 'production', serial: 24, engineBuild: STAGED, bundle: {name: `v0.1.31/engine-server-${STAGED}.tar.gz`}}),
  [SOURCES.production.page]: {build: STAGED, clientVersion: '0.1.31'},
  [SOURCES.preview.page]: {build: '7d7c9d48a8c3df60fc63a76698dd413cebfc29ca', clientVersion: '0.1.31'},
  [SOURCES.api]: {ok: true, version: '67de927', shardFormat: '0.12.0'},
  'https://registry.npmjs.org/@wildshard%2fengine': {'dist-tags': {latest: '0.1.31'}, versions: {'0.1.31': {gitHead: STAGED}}},
  'https://registry.npmjs.org/@wildshard%2fsdk': {'dist-tags': {latest: '0.3.6'}, versions: {'0.3.6': {}}},
  'https://registry.npmjs.org/@wildshard%2fshard-format': {'dist-tags': {latest: '0.13.0'}, versions: {}},
};
const get = async (/** @type {string} */ url) => {
  if (!(url in replies)) throw new Error(`${url} answered 404`);
  return replies[url];
};

test('a release file gives serial and build, and the version only for a tagged bundle', () => {
  expect(releaseServed(replies[SOURCES.production.release])).toEqual({build: STAGED, serial: 24, version: 'v0.1.31'});
  expect(releaseServed(replies[SOURCES.staging.release])).toEqual({build: NEXT, serial: 96});
});

test('prints what each channel serves and whether a SHA is inside each', async () => {
  const live = await readLive(get);
  expect(live.errors).toEqual([]);
  const inside = async (/** @type {string} */ _sha, /** @type {string} */ build) => build === NEXT;
  const report = render(live, {sha: NEXT, answers: await whereIs(live, NEXT, inside)});
  expect(report.split('\n')).toEqual([
    'staging    page v0.1.31 5e0fb5ef  server 12886742 serial 96 (release)  box 5e0fb5ef serial 95 (behind the release)',
    'production page v0.1.31 5e0fb5ef  server v0.1.31 5e0fb5ef serial 24 (release)',
    'preview    page v0.1.31 7d7c9d48',
    'api        67de927 shard-format 0.12.0',
    'npm        @wildshard/engine 0.1.31 (5e0fb5ef), @wildshard/sdk 0.3.6, @wildshard/shard-format 0.13.0',
    '12886742 in staging: page no, server yes, box no',
    '12886742 in production: page no, server no',
    '12886742 in preview: page no',
  ]);
});

test('an unreadable source is named, and the box off the tailnet is unreachable, not an error', async () => {
  const live = await readLive(async url => {
    if (url === SOURCES.api || url === SOURCES.staging.box) throw new Error(`${url} answered 503`);
    return get(url);
  });
  expect(live.errors).toEqual([`${SOURCES.api} answered 503`]);
  const report = render(live);
  expect(report).toContain('box unreachable (tailnet)');
  expect(report).toContain('api        unread');
  expect(report).toContain(`unread: ${SOURCES.api} answered 503`);
});
