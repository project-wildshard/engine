// @vitest-environment node
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { DOWN_AFTER, ROOMS, SENTRY_OK, emptyState, readOutages, step, watchPlist } from '../src/scripts/rooms-watch.mjs';

// FR-A15 part 3 (meta QA 11-25 row 31): both rooms hosts answered 521 from 10:11 UTC 11-25 and no agent heard of it.
const [prod = '', staging = ''] = ROOMS, start = Date.parse('2026-11-25T10:11:00Z'), minute = 60_000;
const reads = (prodStatus: number, stagingStatus = 200) => ({rooms: [{url: prod, status: prodStatus}, {url: staging, status: stagingStatus}]});

test('a host is red on its second failed read, once per span, and back once', () => {
  expect(DOWN_AFTER).toBe(2);
  let state = emptyState();
  const first = step(state, reads(521), start);
  expect(first.lines).toEqual([]);
  const second = step(first.state, reads(521), start + minute);
  expect(second.lines).toEqual([`NOTE RED builder: rooms ${prod} answered 521 on 2 reads since 10:11 UTC (FR-A15; box: systemctl status caddy, journalctl -u caddy)`]);
  state = second.state;
  for (let read = 2; read < 50; read++) {
    const next = step(state, reads(521), start + read * minute);
    expect(next.lines).toEqual([]);
    state = next.state;
  }
  expect(step(state, reads(200), start + 50 * minute).lines).toEqual([`rooms back ${prod} 200 after 50 min down`]);
});

test('one flap is not an outage, and an unreachable host reads as nothing', () => {
  const flap = step(step(emptyState(), reads(521), start).state, reads(200), start + minute);
  expect(flap.lines).toEqual([]);
  expect(flap.state.fails).toEqual({});
  const gone = step(step(emptyState(), reads(200, 0), start).state, reads(200, 0), start + minute);
  expect(gone.lines[0]).toContain(`rooms ${staging} answered nothing on 2 reads`);
});

test('each newly open Sentry outage issue is red once; without a token the issues are left alone', () => {
  const issue = {id: '86', shortId: 'WILDSHARD-GAME-86', title: 'Downtime detected for https://rooms.wildshard.io/up'};
  const opened = step(emptyState(), {...reads(200), outages: [issue]}, start);
  expect(opened.lines).toEqual(['NOTE RED builder: Sentry outage WILDSHARD-GAME-86 open: Downtime detected for https://rooms.wildshard.io/up']);
  expect(step(opened.state, {...reads(200), outages: [issue]}, start + minute).lines).toEqual([]);
  expect(step(opened.state, reads(200), start + minute).state.outages).toEqual(['86']);
  expect(step(opened.state, {...reads(200), outages: []}, start + minute).state.outages).toEqual([]);
});

// Meta QA 11-25 row 32: the Sentry half went quietly off (no token, then nothing said when a read failed).
test('a failing Sentry read is red once, names why without the token, and is back once', () => {
  const failed = step(emptyState(), {...reads(200), sentry: 'HTTP 401'}, start);
  expect(failed.lines).toEqual(['NOTE RED builder: rooms-watch cannot read Sentry outage issues: HTTP 401 (read-only token: ~/.config/wildshard/sentry-auth-token; QA 11-25 row 32)']);
  expect(step(failed.state, {...reads(200), sentry: 'HTTP 401'}, start + minute).lines).toEqual([]);
  const back = step(failed.state, {...reads(200), outages: [], sentry: SENTRY_OK}, start + 2 * minute);
  expect(back.lines).toEqual(['rooms-watch reads Sentry outage issues again']);
  expect(step(back.state, {...reads(200), outages: [], sentry: SENTRY_OK}, start + 3 * minute).lines).toEqual([]);
});

test('the Sentry read sends the token only in its header and maps each issue', async () => {
  const token = 'fixture-token';
  const calls: {url: string, auth: string}[] = [];
  const answer = (body: unknown, status = 200) => (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({url: `${url}`, auth: `${(init?.headers as Record<string, string>)['authorization']}`});
    return new Response(JSON.stringify(body), {status});
  }) as typeof fetch;
  const issue = {id: 86, shortId: 'WILDSHARD-GAME-86', title: 'Downtime detected', status: 'unresolved'};
  expect(await readOutages(token, {fetcher: answer([issue])})).toEqual({sentry: SENTRY_OK, outages: [{id: '86', shortId: 'WILDSHARD-GAME-86', title: 'Downtime detected', status: 'unresolved'}]});
  expect(calls[0]?.url).toBe('https://sentry.io/api/0/organizations/wildshard/issues/?statsPeriod=24h&query=is%3Aunresolved%20issue.category%3Aoutage');
  expect(calls[0]?.auth).toBe(`Bearer ${token}`);
  const refused = await readOutages(token, {fetcher: answer({detail: 'bad'}, 401)});
  expect(refused).toEqual({sentry: 'HTTP 401'});
  expect(JSON.stringify(refused)).not.toContain(token);
  expect((await readOutages(token, {fetcher: answer({detail: 'x'})})).sentry).toBe('an answer that is not an issue list');
  expect((await readOutages(undefined)).sentry).toBe('no token at ~/.config/wildshard/sentry-auth-token');
});

test('the LaunchAgent runs one read every 60 s from the canonical checkout', () => {
  const plist = watchPlist('/w/engine', '/Users/me');
  expect(plist).toContain('<string>/w/engine/src/scripts/rooms-watch.mjs</string><string>--once</string>');
  expect(plist).toContain('<key>StartInterval</key><integer>60</integer>');
});

// 11-25 11:45 UTC: Caddy's `rewrite * /health` keeps the query and the server answers `/health?agent=` with 404, so a
// `?agent=` marker read both healthy hosts as 503. The rooms reads carry the marker in the user agent only.
test('the rooms reads never add the ?agent= query', () => {
  for (const file of ['src/scripts/rooms-watch.mjs', 'src/scripts/page-release.mjs']) expect(readFileSync(file, 'utf8'), file).not.toContain('agentUrl(');
});
