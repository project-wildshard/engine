// @vitest-environment node
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { DOWN_AFTER, ROOMS, emptyState, step, watchPlist } from '../src/scripts/rooms-watch.mjs';

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
