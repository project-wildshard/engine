// Meta QA 11-25 row 142: GitHub fires nightly.yml's 07:17 UTC cron 7 to 11 hours late, so nightly-keeper.yml dispatches
// a release proof when none started in 20 h, and main-watch alarms once, as a receipt, when none started in 26 h.
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {afterAll, expect, test} from 'vitest';
import {KICK_MS, STALE_MS, kickDue, newestRelease, staleReceipt} from '../scripts/nightly-keeper.ts';
import {sweep} from '../scripts/main-watch.mjs';

mkdirSync(resolve('tmp'), {recursive: true});
const scratch = mkdtempSync(resolve('tmp/nightly-keeper-'));
afterAll(() => rmSync(scratch, {recursive: true, force: true}));

const now = Date.parse('2026-11-26T12:15:00Z');
const hoursAgo = (h) => new Date(now - h * 3_600_000).toISOString();
const nightly = (id, h, extra = {}) => ({id, head_sha: String(id).padEnd(40, 'a'), status: 'completed', conclusion: 'failure',
  event: 'schedule', created_at: hoursAgo(h), ...extra});
// The 11-26 shape: the last scheduled run 11-25 17:58 UTC (18.3 h before 12:15), and today's 07:17 cron not yet fired.
const scheduled = nightly(45670286813, 18.28);
const diagnostic = nightly(45301754503, 1, {event: 'workflow_dispatch', display_title: 'nightly', conclusion: 'success'});

test('the newest release nightly skips diagnostics and cancelled runs', () => {
  const cancelled = nightly(9, 2, {event: 'workflow_dispatch', display_title: 'nightly release proof', conclusion: 'cancelled'});
  expect(newestRelease([diagnostic, cancelled, scheduled, null])?.id).toBe(scheduled.id);
  const running = nightly(10, 0.5, {event: 'workflow_dispatch', display_title: 'nightly release proof', status: 'in_progress', conclusion: null});
  expect(newestRelease([scheduled, running])?.id).toBe(10);
  expect(newestRelease([diagnostic])).toBeNull();
});

test('the keeper dispatches only when no release nightly started in 20 h', () => {
  expect(KICK_MS).toBe(20 * 3_600_000);
  expect(kickDue([scheduled], now)).toEqual({due: false, why: 'release nightly 45670286813 (schedule, completed) started 18.3 h ago, within 20.0 h'});
  expect(kickDue([nightly(1, 20.5)], now).due).toBe(true);
  expect(kickDue([diagnostic], now)).toEqual({due: true, why: 'no release nightly on main'});
  // A running release proof counts: the next push's keeper never dispatches a second.
  const running = nightly(2, 0.1, {event: 'workflow_dispatch', display_title: 'nightly release proof', status: 'queued', conclusion: null});
  expect(kickDue([running, nightly(1, 30)], now).due).toBe(false);
});

test('the stale alarm fires past 26 h, once per newest run', () => {
  expect(STALE_MS).toBe(26 * 3_600_000);
  expect(staleReceipt([scheduled], now, '')).toBeNull();
  const old = nightly(45464478966, 26.5);
  const line = staleReceipt([old, diagnostic], now, '');
  expect(line).toMatch(/^main NIGHTLY STALE newest 45464478966 \(started 26\.5 h ago at .* on 4546447896\): no release nightly in the last 26\.0 h, so TC22 holds the next tag; .*Dispatch: gh workflow run nightly -R project-wildshard\/engine --ref main -f pins_channel=production$/u);
  expect(staleReceipt([old], now, `12:00 UTC main-watch ${line}\n`)).toBeNull();
  // A newer stale run alarms again; none at all alarms as "newest none".
  expect(staleReceipt([nightly(45464478967, 27)], now, `12:00 UTC main-watch ${line}\n`)).toMatch(/newest 45464478967 /u);
  expect(staleReceipt([], now, '')).toMatch(/^main NIGHTLY STALE newest none \(no release nightly on main\)/u);
});

test('main-watch writes the alarm as a receipt line, once', () => {
  const state = join(scratch, 'state.json');
  writeFileSync(state, '{"judged":[],"dispatched":[]}\n');
  const receipts = [];
  const io = {repo: 'project-wildshard/engine', state, runs: () => [], tip: () => 'f'.repeat(40), now: () => now,
    commits: () => [], changes: () => new Map(), contains: () => true, agents: () => new Map(), panes: () => [],
    send: () => true, prompt: () => false, fixers: () => [], dispatch: () => {}, failed: () => ({names: [], logs: []}), annotations: () => '',
    receipts: () => receipts.map(line => `12:00 UTC main-watch ${line}`).join('\n'), receipt: line => { receipts.push(line); },
    nightlyRuns: () => [nightly(45670286813, 30), diagnostic]};
  sweep(io);
  sweep(io);
  expect(receipts.filter(line => line.startsWith('main NIGHTLY STALE newest 45670286813 '))).toHaveLength(1);
  // A fresh release nightly ends the alarm; an unreadable list is a receipt too, never silence.
  sweep({...io, nightlyRuns: () => [scheduled]});
  expect(receipts).toHaveLength(1);
  sweep({...io, nightlyRuns: () => { throw new Error('HTTP 502'); }});
  expect(receipts.at(-1)).toBe('nightly status unavailable: HTTP 502');
});
