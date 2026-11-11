// LAND-SIMPLIFY LS5 (J258): the main watcher reports main's ci verdict. A cancelled run is superseded, never red;
// a red run gives one receipt with its range and landers, and a message to each lander's pane, however often it runs.
// oxlint-disable-next-line import/no-nodejs-modules -- The watcher's real state file in an owned scratch directory.
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Scratch paths.
import { join, resolve } from 'node:path';
import { afterAll, expect, test } from 'vitest';
import { follow, judge, landers, liveIo, paneFor, sweep, verdictFor } from '../scripts/main-watch.mjs';

mkdirSync(resolve('tmp'), { recursive: true });
const scratch = mkdtempSync(resolve('tmp/main-watch-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const sha = (name: string): string => name.padEnd(40, '0');
const run = (id: number, head: string, conclusion: string | null, minute: number, status = 'completed') =>
  ({ id, head_sha: sha(head), status, conclusion, created_at: `2026-11-11T05:${String(minute).padStart(2, '0')}:00Z`, event: 'push' });
// The 2026-11-11 window: two packed-era lands whose main runs GitHub only cancelled, then a green newer push.
const replay = [
  run(42965108264, '0f24422e', 'success', 20), run(42965336189, '7257ca53', 'cancelled', 22),
  run(42966114949, '6363b3f3', 'cancelled', 29), run(42966259441, '652afa6c', 'success', 31),
];
const order = ['0f24422e', '7257ca53', '6363b3f3', '652afa6c', 'aaaa1111', 'bbbb2222'].map(sha);
const contains = (ancestor: string, descendant: string): boolean => order.indexOf(ancestor) <= order.indexOf(descendant);

interface World { runs: ReturnType<typeof run>[]; receipts: string[]; sent: [string, string][]; dispatched: number; log: string; tip: string }
const fake = (name: string, world: World): ReturnType<typeof liveIo> => ({
  repo: 'project-wildshard/engine', state: join(scratch, `${name}.json`),
  runs: () => world.runs, failed: () => ['tests (3)'], tip: () => world.tip,
  commits: (from, to) => order.slice(from === null ? 0 : order.indexOf(from) + 1, order.indexOf(to) + 1).reverse(),
  contains, receipts: () => world.log, receipt: line => { world.receipts.push(line); },
  panes: () => [{ pane_id: 'w1:p2', label: 'engine plan/red-plan' }, { pane_id: 'w1:p3', cwd: '/x/engine/.worktrees/other' }],
  send: (pane, text) => { world.sent.push([pane, text]); return true; }, dispatch: () => { world.dispatched += 1; },
});
const world = (runs: ReturnType<typeof run>[], log = ''): World => ({ runs, receipts: [], sent: [], dispatched: 0, log, tip: runs.at(-1)?.head_sha ?? '' });

test('replaying runs 42965336189 and 42966114949: cancelled by newer pushes is superseded, never MAIN RED', () => {
  const verdicts = judge(replay, { judged: [42965108264], dispatched: [] }, sha('652afa6c'));
  expect(verdicts.map(row => [row.kind, row.run.id])).toEqual([
    ['superseded', 42965336189], ['superseded', 42966114949], ['green', 42966259441]]);
  expect(verdicts.at(-1)?.from).toBe(sha('0f24422e'));
  // The verdict for each cancelled SHA is the newer green run that contains it.
  expect(verdictFor(replay, sha('7257ca53'), contains)?.run.id).toBe(42966259441);
  expect(verdictFor(replay, sha('6363b3f3'), contains)?.state).toBe('green');
  expect(verdictFor(replay.slice(0, 3), sha('7257ca53'), contains)).toBeNull();
});

test('a first run only records what is finished; later sweeps report each new run once', () => {
  const w = world(replay.slice(0, 1));
  const io = fake('first', w);
  expect(sweep(io)).toEqual([]);
  expect(w.receipts).toEqual(['started: 1 finished main runs taken as already judged']);
  w.runs = replay;w.tip = sha('652afa6c');
  expect(sweep(io).map(row => row.kind)).toEqual(['superseded', 'superseded', 'green']);
  expect(w.receipts.filter(line => line.includes('MAIN RED'))).toEqual([]);
  expect(sweep(io)).toEqual([]);
});

test('a real red gives exactly one receipt with its range and landers over two sweeps, and messages each lander', () => {
  const log = [
    '05:50 UTC opus-red land plan/red-plan landed aaaa111100 on main (652afa6c00..aaaa111100); carried; rounds 1',
    '05:51 UTC opus-other land plan/other landed bbbb222200 on main (aaaa111100..bbbb222200); exact; rounds 1',
  ].join('\n');
  // The first sweep is the baseline; the red appears after it, and two more sweeps report it once.
  const w3 = world(replay, log), io3 = fake('red3', w3);
  sweep(io3);
  w3.runs = [...replay, run(42970000001, 'bbbb2222', 'failure', 52)];w3.tip = sha('bbbb2222');w3.receipts.length = 0;
  sweep(io3);sweep(io3);
  const red = w3.receipts.filter(line => line.startsWith('MAIN RED 652afa6c00'));
  expect(red).toEqual(['MAIN RED 652afa6c00..bbbb222200 run 42970000001: landers opus-other, opus-red; failed: tests (3)']);
  expect(w3.sent.map(([pane]) => pane).sort()).toEqual(['w1:p2', 'w1:p3']);
  expect(w3.sent[0]?.[1]).toContain('fix forward now (J249)');
});

test('land\'s follow names its own pane, before its landed receipt exists', () => {
  const w = world(replay), io = fake('hint', w);
  sweep(io);
  w.runs = [...replay, run(42970000002, 'aaaa1111', 'failure', 50)];w.tip = sha('aaaa1111');
  sweep(io, { sha: sha('aaaa1111'), lane: 'opus-new', pane: 'w9:p9' });
  expect(w.receipts).toContain('MAIN RED 652afa6c00..aaaa111100 run 42970000002: landers opus-new; failed: tests (3)');
  expect(w.sent).toEqual([['w9:p9', expect.stringContaining('You landed aaaa111100')]]);
});

test('a cancelled run with nothing newer dispatches ci on main once', () => {
  const runs = [...replay, run(42970000003, 'aaaa1111', 'cancelled', 50)];
  const w = world(replay), io = fake('dispatch', w);
  sweep(io);
  w.runs = runs;w.tip = sha('aaaa1111');
  sweep(io);sweep(io);
  expect(w.dispatched).toBe(1);
  expect(w.receipts.some(line => line.includes('MAIN RED'))).toBe(false);
});

test('landers come from landed receipts; a pane is found by its worktree label or directory', () => {
  const map = landers('06:08 UTC opus-rescue land plan/rescue landed c51572839e on main (ad016fbd17..c51572839e); carried\n'
    + '05:00 UTC x land plan/y STOP plan push 1234567890 refused\n06:09 UTC opus-z land plan/z landed, MAIN RED 1234567890 on main (a..b)');
  expect([...map]).toEqual([['c51572839e', { lane: 'opus-rescue', slug: 'rescue' }], ['1234567890', { lane: 'opus-z', slug: 'z' }]]);
  const panes = [{ pane_id: 'a', label: 'engine plan/rescue' }, { pane_id: 'b', foreground_cwd: '/e/.worktrees/z' }];
  expect(paneFor(panes, 'rescue')).toBe('a');
  expect(paneFor(panes, 'z')).toBe('b');
  expect(paneFor(panes, 'gone')).toBeUndefined();
});

// J206 review MUSTs.
test('a first follow with no state still reports the followed SHA\'s red', async () => {
  const w = world([...replay, run(42970000004, 'aaaa1111', 'failure', 50)]), io = fake('fresh-follow', w);
  w.tip = sha('aaaa1111');
  await follow(io, { sha: sha('aaaa1111'), lane: 'opus-new', pane: 'w9:p9', pollMs: 1 });
  expect(w.receipts.filter(line => line.startsWith('MAIN RED 6'))).toEqual(['MAIN RED 652afa6c00..aaaa111100 run 42970000004: landers opus-new; failed: tests (3)']);
  expect(w.sent.map(([pane]) => pane)).toEqual(['w9:p9']);
});

test('a follow of a cancelled tip dispatches once, then ends on the dispatched run\'s verdict', async () => {
  const w = world(replay), io = fake('follow-dispatch', w);
  sweep(io);
  w.runs = [...replay, run(42970000005, 'aaaa1111', 'cancelled', 50)];w.tip = sha('aaaa1111');
  let polls = 0;
  const done = follow({ ...io, runs: () => { polls += 1; if (polls > 4) w.runs = [...w.runs.filter(row => row.id !== 42970000006), { ...run(42970000006, 'aaaa1111', 'failure', 55), event: 'workflow_dispatch' }]; return w.runs; } },
    { sha: sha('aaaa1111'), lane: 'opus-new', pollMs: 1, timeoutMs: 10_000 });
  await done;
  expect(w.dispatched).toBe(1);
  // The dispatched run re-tests the same SHA: its range starts at the last other SHA, so it still names the lander.
  expect(w.receipts).toContain('MAIN RED 652afa6c00..aaaa111100 run 42970000006: landers opus-new; failed: tests (3)');
});

test('each verdict is recorded as it is reported, so a later API failure never repeats it', () => {
  const w = world(replay), io = fake('partial', w);
  sweep(io);
  w.runs = [...replay, run(42970000007, 'aaaa1111', 'success', 50), run(42970000008, 'bbbb2222', 'failure', 52)];w.tip = sha('bbbb2222');
  let calls = 0;
  const flaky = { ...io, commits: (from: string | null, to: string) => { calls += 1; if (calls === 2) throw new Error('git broke'); return io.commits(from, to); } };
  expect(() => sweep(flaky)).toThrow('git broke');
  sweep(io);
  expect(w.receipts.filter(line => line.startsWith('main green aaaa111100'))).toHaveLength(1);
  expect(w.receipts.filter(line => line.startsWith('MAIN RED'))).toHaveLength(1);
});

test('a dead owner\'s lock is taken; a live one is waited for', () => {
  const w = world(replay), io = fake('lock', w);
  writeFileSync(`${io.state}.lock`, '999999');
  sweep(io);
  expect(existsSync(`${io.state}.lock`)).toBe(false);
  expect(w.receipts[0]).toMatch(/^started:/u);
});
