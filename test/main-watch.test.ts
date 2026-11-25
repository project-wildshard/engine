// LAND-SIMPLIFY LS5 (J258): the main watcher reports main's ci verdict. A cancelled run is superseded, never red;
// a red run gives one receipt with its range and landers, and a message to each lander's pane, however often it runs.
// oxlint-disable-next-line import/no-nodejs-modules -- The watcher's real state file in an owned scratch directory.
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Scratch paths.
import { join, resolve } from 'node:path';
import { afterAll, expect, test } from 'vitest';
import { attribute, blockingRun, cancelledJobs, failedNames, follow, fpsNight, judge, landers, type liveIo, paneFor, reached, sharedRuns, sweep, verdictFor } from '../scripts/main-watch.mjs';
import { audioAmberLine, audioLevel } from '../src/cook/game/audioReport';
import '../scripts/test/main-watch-red.test.mjs';

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

interface World { runs: ReturnType<typeof run>[]; receipts: string[]; sent: [string, string][]; builder?: string | null; dispatched: number; log: string; tip: string; ambers?: Record<number, string>; agents?: string[]; prompted?: [string, string][]; fixers?: string[]; native?: ReturnType<typeof run>[]; memoryQa?: Parameters<NonNullable<ReturnType<typeof liveIo>['memoryQa']>>[0] }
const fake = (name: string, world: World): ReturnType<typeof liveIo> => ({
  repo: 'project-wildshard/engine', state: join(scratch, `${name}.json`),
  runs: () => world.runs, failed: () => ({ names: ['tests (3)'], logs: [] }), annotations: id => world.ambers?.[id] ?? '', tip: () => world.tip,
  nativeRuns: () => world.native ?? [], memoryQa: rows => { (world.memoryQa ??= []).push(...rows); },
  commits: (from, to) => order.slice(from === null ? 0 : order.indexOf(from) + 1, order.indexOf(to) + 1).reverse(),
  changes: () => new Map(), agents: () => new Map(),
  contains, receipts: () => world.log, receipt: line => { world.receipts.push(line); },
  panes: () => [{ pane_id: 'w1:p2', label: 'engine plan/red-plan' }, { pane_id: 'w1:p3', cwd: '/x/engine/.worktrees/other' }],
  send: (pane, text) => { world.sent.push([pane, text]); return true; }, dispatch: () => { world.dispatched += 1; },
  builder: () => (world.builder === null ? undefined : world.builder ?? BUILDER),
  hcSend: (terminal, text) => { world.sent.push([`hc:${terminal}`, text]); return true; },
  prompt: (agent, text) => { if (!(world.agents ?? []).includes(agent)) return false; (world.prompted ??= []).push([agent, text]); return true; },
  fixers: () => world.fixers ?? [],
  quotaReset: () => Date.now(),
});
const BUILDER = 't21';
const world = (runs: ReturnType<typeof run>[], log = ''): World => ({ runs, receipts: [], sent: [], dispatched: 0, log, tip: runs.at(-1)?.head_sha ?? '' });

test('advisory failures preserve green blocking tests in both sweeps and follows', () => {
  for (const name of ['timings', 'quarantine', 'nine-ledger-diagnostic']) {
    const red = run(42970000021, 'aaaa1111', 'failure', 50);
    const normalized = blockingRun(red, [{ name: 'tests (1)', conclusion: 'success' }, { name, conclusion: 'failure' }]);
    const w = world(replay), io = fake(`advisory-${name}`, w);
    sweep(io); w.runs = [...replay, normalized]; w.tip = sha('aaaa1111');
    expect(sweep(io).map(row => row.kind)).toEqual(['green']);
    expect(w.sent).toEqual([]);
    expect(verdictFor(w.runs, sha('aaaa1111'), contains)?.state).toBe('green');
    expect(red.conclusion).toBe('failure');
  }
});

test('advisories never hide failed, unknown, incomplete or cancelled blocking work', () => {
  const red = run(42970000022, 'aaaa1111', 'failure', 50);
  for (const conclusion of ['failure', 'timed_out', 'cancelled', null]) {
    expect(blockingRun(red, [{ name: 'tests (1)', conclusion }, { name: 'timings', conclusion: 'failure' }]).conclusion).toBe('failure');
  }
  expect(blockingRun(red, [{ name: 'timings', conclusion: 'failure' }]).conclusion).toBe('failure');
  expect(blockingRun(red, [
    { name: 'memory-ledger-guard', conclusion: 'failure' },
    { name: 'nine-ledger-diagnostic', conclusion: 'failure' },
  ]).conclusion).toBe('failure');
  expect(blockingRun(red, []).conclusion).toBe('failure');
  for (const conclusion of [null, 'action_required', 'startup_failure']) {
    const unknown = run(42970000025, 'aaaa1111', conclusion, 50);
    expect(blockingRun(unknown, [{ name: 'tests (1)', conclusion: 'success' }, { name: 'timings', conclusion: 'failure' }])).toBe(unknown);
  }
  const cancelled = run(42970000023, 'aaaa1111', 'cancelled', 51);
  expect(blockingRun(cancelled, [{ name: 'tests (1)', conclusion: 'success' }, { name: 'timings', conclusion: 'failure' }])).toBe(cancelled);
  const pending = run(42970000024, 'aaaa1111', null, 52, 'in_progress');
  expect(blockingRun(pending, [{ name: 'tests (1)', conclusion: 'success' }, { name: 'timings', conclusion: null }])).toBe(pending);
});

test('44139343442: an unassigned advisory street runner preserves the twelve passed blocking jobs', () => {
  const red = run(44139343442, '9b016e2c', 'failure', 50);
  const blocking = [...Array.from({ length: 9 }, (_, index) => `tests (${index + 1})`),
    'boundaries', 'nine-ring1-build', 'nine-ring1 (load, ubuntu-latest)'];
  const jobs = blocking.map(name => ({ name, conclusion: 'success' as string | null }));
  const street = { name: 'nine-ring1 (street, macos-15)', conclusion: 'cancelled' };
  for (const conclusion of ['failure', 'timed_out', 'cancelled']) {
    const normalized = blockingRun(red, [...jobs, { ...street, conclusion }]);
    expect(normalized.conclusion).toBe('success');
    const w = world([...replay, normalized]), io = fake(`street-${conclusion}`, w);
    // An already-started watcher must not prompt the fixer for an advisory.
    w.runs = replay; sweep(io); w.runs = [...replay, normalized]; w.tip = red.head_sha;
    expect(sweep(io).map(row => row.kind)).toEqual(['green']);
    expect(w.sent).toEqual([]);
  }
  for (const name of blocking) for (const conclusion of ['failure', 'timed_out', 'cancelled', null]) {
    expect(blockingRun(red, [...jobs.map(row => row.name === name ? { ...row, conclusion } : row), street]).conclusion).toBe('failure');
  }
  expect(blockingRun(red, [street]).conclusion).toBe('failure');
  expect(blockingRun({ ...red, conclusion: 'cancelled' }, [...jobs, street]).conclusion).toBe('cancelled');
  expect(blockingRun(red, [...jobs, { ...street, name: 'nine-ring1 (unknown, macos-15)' }]).conclusion).toBe('failure');
});

test('J426 makes an armed footprint measurement failure red, including after a runner cancellation', () => {
  const red = run(44375696856, '4026d299', 'failure', 50);
  const jobs = [{ name: 'tests (1)', conclusion: 'success' }, { name: 'memory-ledger-guard', conclusion: 'success' }];
  const steps = [{ name: 'Check armed native footprints and report Template', conclusion: 'failure' }];
  for (const conclusion of ['failure', 'timed_out', 'cancelled']) {
    const measured = blockingRun(red, [...jobs, { name: 'memory-footprint-guard', conclusion, steps }]);
    expect(measured.conclusion).toBe('failure');
    expect(measured.nativeInfra).toBeUndefined();
  }
  expect(blockingRun(red, [...jobs, { name: 'memory-footprint-guard', conclusion: 'failure', runner_id: 42 }]).conclusion).toBe('failure');
});

test('J426 reports native runner infrastructure interruptions without hiding other reds', () => {
  const jobs = [{ name: 'tests (1)', conclusion: 'success' }, { name: 'memory-ledger-guard', conclusion: 'success' }];
  const cases = [
    { conclusion: 'timed_out', runner_id: 42, reason: 'runner timed out' },
    { conclusion: 'cancelled', runner_id: 42, reason: 'runner was canceled' },
    { conclusion: 'failure', runner_id: null, steps: [], reason: 'no xcode-27 runner assigned' },
    { conclusion: 'startup_failure', runner_id: 42, reason: 'runner failed to start' },
  ];
  for (const { reason, ...metadata } of cases) {
    const red = run(44375696856, 'aaaa1111', metadata.conclusion, 50);
    const native = { name: 'memory-footprint-guard', ...metadata };
    const normalized = blockingRun(red, [...jobs, native]);
    expect(normalized.conclusion).toBe('success');
    const w = world(replay), io = fake(`native-infra-${metadata.conclusion}`, w);
    sweep(io); w.runs = [...replay, normalized]; w.tip = red.head_sha;
    expect(sweep(io).map(row => row.kind)).toEqual(['green']);
    expect(w.receipts).toContain(`main advisory aaaa111100 memory-footprint-guard: ${reason} (run ${red.id})`);
    expect(w.sent).toEqual([]);
    const ledgerRed = blockingRun({ ...red, conclusion: 'failure' }, [{ name: 'memory-ledger-guard', conclusion: 'failure' }, native]);
    expect(ledgerRed.conclusion).toBe('failure');
    expect(ledgerRed.nativeInfra).toBe(reason);
  }
});

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

test('CIQ1 names replaced pending runs as skipped while started cancellations stay superseded', () => {
  const w = world(replay.slice(0, 1)), io = fake('pending-replaced', w);
  sweep(io);
  w.runs = replay.map(row => ({ ...row, started: row.id !== 42965336189 }));
  w.tip = sha('652afa6c');
  sweep(io); sweep(io);
  expect(w.receipts.filter(line => line.includes('never red'))).toEqual([
    'main 7257ca5300 skipped (pending, replaced) by 6363b3f300 (run 42965336189; never started; never red)',
    'main 6363b3f300 superseded by 652afa6c00 (run 42966114949 cancelled; never red)',
  ]);
  expect(w.dispatched).toBe(0);
  expect(w.sent).toEqual([]);
  expect(verdictFor(w.runs, sha('7257ca53'), contains)?.state).toBe('green');
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

test('J422: a started run cancelled with a blocking job red (a timeout) is MAIN RED, never superseded', () => {
  // Run 44361972035: tests (2) failed and nine-ring1-build hit its 5 min timeout, so GitHub called the run cancelled.
  const hidden = { ...run(42970000006, 'aaaa1111', 'cancelled', 50), started: true, blockingFailed: true };
  const newer = run(42970000007, 'bbbb2222', 'success', 70);
  const verdicts = judge([...replay, hidden, newer], { judged: replay.map(row => row.id), dispatched: [] }, sha('bbbb2222'));
  expect(verdicts.map(row => [row.kind, row.run.id])).toEqual([['red', 42970000006], ['green', 42970000007]]);
  expect(verdictFor([...replay, hidden], sha('aaaa1111'), contains)?.state).toBe('red');
  // A started cancel with every blocking job green stays superseded.
  const clean = { ...hidden, blockingFailed: false };
  expect(judge([...replay, clean, newer], { judged: replay.map(row => row.id), dispatched: [] }, sha('bbbb2222')).map(row => row.kind)).toEqual(['superseded', 'green']);
});

test('build-max A5: jobs a cancel stopped are not failures; a job that failed, timed out or never started is', () => {
  const job = (name: string, conclusion: string | null, started = true) => ({ name, conclusion, started_at: started ? '2026-11-20T16:00:00Z' : null });
  // Run 44768998830 (2026-11-20): only t1-e2e (B) unfinished, cancelled with its run; it was a MAIN RED with no failure.
  expect(cancelledJobs([job('tests (1)', 'success'), job('t1-e2e (B)', 'cancelled'), job('memory-client-build', 'cancelled')]))
    .toEqual({ started: true, blockingFailed: false });
  // Run 44797469058: tests (3) failed before the early-red cancel stopped the rest, so it stays red.
  expect(cancelledJobs([job('tests (3)', 'failure'), job('t1-e2e (J)', 'cancelled')])).toEqual({ started: true, blockingFailed: true });
  for (const conclusion of ['timed_out', 'startup_failure'])
    expect(cancelledJobs([job('tests (2)', conclusion)]).blockingFailed).toBe(true);
  // An advisory failure never makes a cancel red; a run that never started a job is neither started nor red.
  expect(cancelledJobs([job('timings', 'failure'), job('tests (1)', 'cancelled')]).blockingFailed).toBe(false);
  expect(cancelledJobs([job('tests (1)', 'cancelled', false)])).toEqual({ started: false, blockingFailed: false });
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

test('EV2: a pre-push follow waits for its SHA to reach main, and quits when the push never lands', async () => {
  let tip = sha('old');
  const io = { tip: () => tip, contains: (ancestor: string, descendant: string) => ancestor === descendant };
  const waiting = reached(io, sha('new'), 60, 5);
  tip = sha('new');
  expect(await waiting).toBe(true);
  expect(await reached({ tip: () => sha('old'), contains: () => false }, sha('lost'), 20, 5)).toBe(false);
  expect(await reached({ tip: () => { throw new Error('offline'); }, contains: () => true }, sha('x'), 10, 5)).toBe(false);
});

test('J295: a green run carrying AMBER files gives one main AMBER receipt per file; a red run or a clean green gives none', () => {
  const w = world(replay), io = fake('amber', w);
  sweep(io);
  w.runs = [...replay, run(42970000009, 'aaaa1111', 'success', 50), run(42970000010, 'bbbb2222', 'success', 52)];w.tip = sha('bbbb2222');
  // As the annotations come back: the tests job's warning and the timings job's copy of the same file.
  const line = 'AMBER file=test/slow.test.ts ms=61443 budget=60000 run=42970000009 streak=0 why=first_amber';
  w.ambers = { 42970000009: `${line}\n${line}\nAMBER file=test/other.test.ts ms=70000 budget=60000 run=42970000009 streak=2 why=x` };
  sweep(io);sweep(io);
  const amber = w.receipts.filter(row => row.startsWith('main AMBER'));
  expect(amber.map(row => row.split(' (')[0])).toEqual(['main AMBER aaaa111100 test/slow.test.ts 61443/60000', 'main AMBER aaaa111100 test/other.test.ts 70000/60000']);
  expect(amber[0]).toContain('run 42970000009; J295');
  expect(w.receipts.filter(row => row.startsWith('main green'))).toHaveLength(2);
  // Unreadable annotations never stop the sweep: the green is reported and the AMBER check says it couldn't look.
  w.runs = [...w.runs, run(42970000011, 'bbbb2222', 'success', 54)];w.receipts.length = 0;
  sweep({ ...io, annotations: () => { throw new Error('HTTP 502'); } });
  expect(w.receipts).toEqual([expect.stringMatching(/^main green bbbb222200/u), 'main AMBER bbbb222200 unknown (run 42970000011; its annotations were unreadable: HTTP 502)']);
});

test('AU6 (J303): a green run whose cook report has a shard over 6 MB gives a main AMBER audio receipt, never MAIN RED', () => {
  const w = world(replay), io = fake('audio', w);
  sweep(io);
  w.runs = [...replay, run(42970000012, 'aaaa1111', 'success', 50)];w.tip = sha('aaaa1111');
  // The cook report's own lines for synthetic shards over each line (the budget reporter annotates them in two jobs).
  const row = (shard: string, audioBytes: number) => audioAmberLine({ shard, tier: 'phone', files: 9, audioBytes, downloadBytes: 20e6, level: audioLevel(audioBytes) });
  w.ambers = { 42970000012: [row('pine-like', 7_250_000), row('pine-like', 7_250_000), row('huge', 12_000_000)].join('\n') };
  sweep(io);
  expect(w.receipts.filter(line => line.startsWith('main AMBER')).map(line => line.split(' (')[0])).toEqual([
    'main AMBER aaaa111100 audio pine-like phone 7.25 MB/6.00 MB', 'main AMBER aaaa111100 audio huge phone 12.00 MB/6.00 MB']);
  expect(w.receipts.find(line => line.includes('audio huge'))).toContain('over the 10.00 MB red line');
  expect(w.receipts.filter(line => line.startsWith('MAIN RED'))).toEqual([]);
  expect(w.receipts.filter(line => line.startsWith('main green'))).toHaveLength(1);
});

// MF12: a spent GitHub quota is waited out until its reset, past the deadline it would otherwise have hit.
test('a rate-limited sweep waits for the quota reset and still finds the verdict', async () => {
  const w = world([...replay, run(42970000007, 'aaaa1111', 'failure', 60)]), io = fake('rate-limit', w);
  w.tip = sha('aaaa1111');
  let calls = 0, resets = 0;
  const limited = Object.assign(new Error('Command failed: gh api'), { stderr: 'gh: API rate limit exceeded for user ID 1. (HTTP 403)' });
  const started = Date.now();
  await follow({ ...io, runs: () => { calls += 1; if (calls <= 2) throw limited; return w.runs; }, quotaReset: () => { resets += 1; return Date.now() + 300; } },
    { sha: sha('aaaa1111'), lane: 'opus-new', pollMs: 1, timeoutMs: 500 });
  expect(resets).toBe(2);
  expect(Date.now() - started).toBeGreaterThanOrEqual(2000);
  expect(w.receipts).toContain('MAIN RED 652afa6c00..aaaa111100 run 42970000007: landers opus-new; failed: tests (3)');
});

test('MF12: main-watches on one machine share one runs fetch for 45 s', () => {
  const cache = join(scratch, 'runs-cache.json');
  let fetches = 0;
  const fetch = () => { fetches += 1; return replay; };
  expect(sharedRuns(cache, fetch, 1_000)).toEqual(replay);
  expect(sharedRuns(cache, fetch, 40_000)).toEqual(replay);
  expect(fetches).toBe(1);
  sharedRuns(cache, fetch, 46_000);
  expect(fetches).toBe(2);
  // A clock that went backwards, or a cache someone broke, fetches again.
  sharedRuns(cache, fetch, 10_000);
  writeFileSync(cache, 'not json');
  sharedRuns(cache, fetch, 47_000);
  expect(fetches).toBe(4);
});

test('M2: a red also prompts the forward fixer by herdr agent name; a lander with no pane is prompted by its lane name', () => {
  const w = world(replay), io = fake('fixer', w);
  sweep(io);
  w.agents = ['codex-tc48', 'codex-pins'];w.fixers = ['codex-tc48'];
  w.runs = [...replay, run(42970000003, 'aaaa1111', 'failure', 50)];w.tip = sha('aaaa1111');
  sweep(io, { sha: sha('aaaa1111'), lane: 'codex-pins' });
  expect(w.sent).toEqual([]);
  expect(w.prompted?.map(([agent]) => agent)).toEqual(['codex-pins', 'codex-tc48']);
  expect(w.prompted?.[1]?.[1]).toContain('You are the forward fixer (M2)');
  expect(w.receipts).toContain('MAIN RED message to codex-tc48 prompted herdr agent codex-tc48');
  expect(w.receipts).toContain('MAIN RED message to codex-pins prompted herdr agent codex-pins');
});

// Meta QA 11-25 row 21: the builder's hc terminal takes the fallback (the coordinator's pane is gone).
test.each(['missing lander', 'unrecorded lander'])('A2: a red with %s reaches the builder\'s hc terminal once', mode => {
  const w = world(replay), io = fake(mode, w);
  sweep(io);
  w.runs = [...replay, run(42970000008, 'aaaa1111', 'failure', 50)];
  w.tip = sha('aaaa1111');
  const hint = mode === 'unrecorded lander' ? {} : { sha: w.tip, lane: 'gone-lander' };
  sweep(io, hint);
  sweep(io, hint);
  expect(w.prompted ?? []).toEqual([]);
  expect(w.sent.map(([pane]) => pane)).toEqual([`hc:${BUILDER}`]);
  expect(w.sent[0]?.[1]).toContain('fix forward now');
  expect(w.sent[0]?.[1]).toContain('tests (3)');
  expect(w.receipts).toContain(`main red fallback to builder sent to hc terminal ${BUILDER}`);
});

test('J431 writes each memory warning and gate-flake receipt once and queues QA with the SHA', () => {
  const w = world(replay), io = fake('memory-warning', w);
  sweep(io);
  w.receipts.length = 0;
  const ci = run(42970000044, 'aaaa1111', 'success', 44);
  const native = run(42970000045, 'aaaa1111', 'success', 45);
  w.runs.push(ci);
  w.native = [native];
  const margin = 'MEMORY WARNING kind=margin mode=ledger zone=brasscap-mesa metric=peak.loading arm=ratchet bytes=47712804 limit=47407792 delta=305012';
  const flake = 'MEMORY WARNING kind=gate-flake mode=footprint zone=pine-hollow metric=playing arm=absolute bytes=1010000000 limit=1000000000 delta=10000000 median=995000000';
  w.ambers = { [ci.id]: `${margin}\n${margin}`, [native.id]: flake };
  sweep(io);
  sweep(io);
  expect(w.receipts.filter(line => line.startsWith('main WARNING memory'))).toHaveLength(2);
  expect(w.receipts.filter(line => line.startsWith('gate-flake'))).toEqual([
    expect.stringContaining('pine-hollow footprint playing absolute +10000000 B'),
  ]);
  expect(w.memoryQa).toEqual([
    expect.objectContaining({ id: ci.id, sha: ci.head_sha, warnings: [expect.objectContaining({ zone: 'brasscap-mesa', delta: 305012 })] }),
    expect.objectContaining({ id: native.id, sha: native.head_sha, warnings: [expect.objectContaining({ median: 995000000 })] }),
  ]);
});

test('FS24: an early-red cancel names the failed jobs, not the ones it cancelled', () => {
  const job = (name: string, conclusion: string) => ({ name, conclusion });
  expect(failedNames([job('boundaries', 'failure'), job('tests (3)', 'cancelled'), job('timings', 'failure'), job('tests (1)', 'success')])).toEqual(['boundaries']);
  // Run 44361972035: a timeout concludes `cancelled`; with no outright failure it is still named.
  expect(failedNames([job('nine-ring1-build', 'cancelled'), job('tests (1)', 'success')])).toEqual(['nine-ring1-build']);
});

// FS19 (build-max 2026-11-18 A4): 26 of 52 reds in 24 h came through main-push and named no one.
test('FS19: a red pushed through main-push names its pusher and messages its pane', () => {
  // The receipt main-push writes (Cancún clock), here carrying two commits: the tip and the one under it.
  const log = '23:24 Cancún opus-of-m23 main-push pushed main bbbb222200: 2 commit(s) pane w4:p1';
  const w = world(replay, log), io = fake('main-push-red', w);
  sweep(io);
  w.runs = [...replay, run(42970000009, 'bbbb2222', 'failure', 52)];w.tip = sha('bbbb2222');w.receipts.length = 0;
  sweep(io);
  expect(w.receipts.filter(line => line.startsWith('MAIN RED ') && line.includes('..bbbb222200 run 42970000009'))).toEqual([expect.stringMatching(/: landers opus-of-m23; failed: tests \(3\)$/u)]);
  expect(w.sent[0]).toEqual(['w4:p1', expect.stringContaining('You landed bbbb222200')]);
  expect(w.receipts).toContain('MAIN RED message to opus-of-m23 sent to pane w4:p1');
});

test('FS19: main-push receipts parse with or without a pane; land wins a shared SHA; a push covers its count', () => {
  const map = landers('22:38 Cancún codex-ms main-push pushed main 7f961fe1b9: 1 commit(s)\n'
    + '23:24 Cancún opus-a main-push pushed main 2c18d3d9b5: 3 commit(s) pane w2:pV, 1 of them another lane\'s, carried along (M1): x\n'
    + '05:50 UTC opus-red land plan/red-plan landed 2c18d3d9b5 on main (a..b); push');
  expect(map.get('7f961fe1b9')).toEqual({ lane: 'codex-ms', slug: '', count: 1 });
  expect(map.get('2c18d3d9b5')).toEqual({ lane: 'opus-red', slug: 'red-plan' });
  const pushed = landers('23:24 Cancún opus-a main-push pushed main 2c18d3d9b5: 3 commit(s) pane w2:pV');
  expect(pushed.get('2c18d3d9b5')).toEqual({ lane: 'opus-a', slug: '', count: 3, pane: 'w2:pV' });
  // Newest first: the push's tip owns the two under it, but not a third, nor one with its own lander.
  const who = new Map([['c'.repeat(10), { lane: 'push', count: 3 }], ['a'.repeat(10), { lane: 'land' }]]);
  expect(attribute(['c', 'b', 'a', 'z'].map(row => row.repeat(40)), who).map(row => row.lander?.lane)).toEqual(['push', 'push', 'land', undefined]);
});

// FS22 (J443): the keeper (the builder's hc terminal since meta QA 11-25 row 21) keeps engine main when no pusher fixed a red in 20 minutes.
test('FS22: a delivered red with no green after 20 min goes to the keeper once; a green ends the span', () => {
  let clock = Date.parse('2026-11-19T05:00:00Z');
  const log = '05:50 UTC opus-red land plan/red-plan landed aaaa111100 on main (652afa6c00..aaaa111100); push';
  const w = world(replay, log), io = { ...fake('keeper', w), now: () => clock };
  sweep(io);
  w.runs = [...replay, run(42970000011, 'aaaa1111', 'failure', 50)];w.tip = sha('aaaa1111');
  sweep(io);
  expect(w.sent.map(([pane]) => pane)).toEqual(['w1:p2']);
  clock += 19 * 60_000;sweep(io);
  expect(w.sent).toHaveLength(1);
  clock += 2 * 60_000;sweep(io);sweep(io);
  expect(w.sent.slice(1).map(([pane, text]) => [pane, text.slice(0, 36)])).toEqual([[`hc:${BUILDER}`, 'main-watch: keeper (J443): engine ma']]);
  expect(w.receipts).toContain(`main red keeper: builder sent to hc terminal ${BUILDER} after 21 min red with no green (run 42970000011)`);
  // A green ends the span: the next red starts a fresh clock.
  w.runs = [...w.runs, run(42970000012, 'bbbb2222', 'success', 55)];w.tip = sha('bbbb2222');
  sweep(io);clock += 30 * 60_000;sweep(io);
  expect(w.sent).toHaveLength(2);
});

test('FS22: a red whose pusher has no pane reaches the keeper at once, and not again at 20 min', () => {
  let clock = Date.parse('2026-11-19T06:00:00Z');
  const w = world(replay), io = { ...fake('keeper-fallback', w), now: () => clock };
  sweep(io);
  w.runs = [...replay, run(42970000013, 'aaaa1111', 'failure', 50)];w.tip = sha('aaaa1111');
  sweep(io);
  expect(w.sent.map(([pane]) => pane)).toEqual([`hc:${BUILDER}`]);
  clock += 25 * 60_000;sweep(io);
  expect(w.sent).toHaveLength(1);
});

// Meta QA 11-25 row 21: engine run 45569694131 went red and no lander was reached: Agent-tool lanes have no pane and the
// coordinator pane was gone. Every lander now gets a NOTE RED receipt its background wait matches, and the builder's hc
// terminal gets the red when a lander has no pane or herdr agent.
test('row 21: a red whose subagent lander has no pane reaches it by NOTE RED and the builder by hc', () => {
  const log = '07:40 UTC opus-qa24 main-push pushed main aaaa111100: 1 commit(s)';
  const w = world(replay, log), io = fake('row21', w);
  sweep(io);
  w.runs = [...replay, run(42970000051, 'aaaa1111', 'failure', 50)];w.tip = sha('aaaa1111');
  sweep(io);
  expect(w.receipts).toContain('NOTE RED opus-qa24: run 42970000051 652afa6c00..aaaa111100 tests (3)');
  expect(w.receipts).toContain('MAIN RED message to opus-qa24 not delivered (no reachable pane or herdr agent)');
  expect(w.sent).toEqual([[`hc:${BUILDER}`, expect.stringContaining('Landers: opus-qa24')]]);
  expect(w.receipts).toContain(`main red fallback to builder sent to hc terminal ${BUILDER}`);
  // The same red again: no second NOTE and no second message.
  w.runs = [...w.runs, { ...run(42970000052, 'aaaa1111', 'failure', 51) }];
  sweep(io);
  expect(w.receipts.filter(line => line.startsWith('NOTE RED'))).toHaveLength(1);
  expect(w.sent).toHaveLength(1);
});

test('row 21: with no builder terminal the NOTE RED still goes out and the fallback says it was not delivered', () => {
  const log = '07:40 UTC opus-sub main-push pushed main aaaa111100: 1 commit(s)';
  const w = { ...world(replay, log), builder: null }, io = fake('row21-nobuilder', w);
  sweep(io);
  w.runs = [...replay, run(42970000053, 'aaaa1111', 'failure', 50)];w.tip = sha('aaaa1111');
  sweep(io);
  expect(w.receipts).toContain('NOTE RED opus-sub: run 42970000053 652afa6c00..aaaa111100 tests (3)');
  expect(w.sent).toEqual([]);
  expect(w.receipts).toContain('main red fallback to builder not delivered (no builder hc terminal reached)');
});

test('FM11: a red failure-mode proof is one fix-row receipt, never main red; green, cancelled and old runs are quiet', () => {
  const w = world(replay), io = { ...fake('failmodes', w), now: () => Date.parse('2026-11-11T06:00:00Z') };
  const nightly = { ...run(42970000031, '652afa6c', 'failure', 40), event: 'schedule' };
  const old = { ...run(42970000032, '652afa6c', 'failure', 40), created_at: '2026-11-09T05:00:00Z' };
  const failmodes = [nightly, old, run(42970000033, '652afa6c', 'success', 41), run(42970000034, '652afa6c', 'cancelled', 42), run(42970000035, '652afa6c', null, 43, 'in_progress')];
  const watched = { ...io, failmodeRuns: () => failmodes };
  expect(sweep(watched).map(row => row.kind)).not.toContain('red');
  sweep(watched);
  const lines = w.receipts.filter(line => line.includes('FAILMODES'));
  expect(lines).toEqual([`main FAILMODES 652afa6c00 run 42970000031 (schedule) failure: a fix row today, never main red (FM11, J229); receipt artifact failmodes-${sha('652afa6c')}`]);
  expect(w.sent).toEqual([]);
});

test('DF7: a red Driftwood floors night names the pushers since the last green night, never main red', () => {
  const log = ['05:50 UTC opus-red land plan/red-plan landed aaaa111100 on main (652afa6c00..aaaa111100); carried; rounds 1',
    '05:51 UTC opus-other land plan/other landed bbbb222200 on main (aaaa111100..bbbb222200); exact; rounds 1'].join('\n');
  const w = world(replay, log), io = fake('driftwood-fps', w);
  const night = (id: number, conclusion: string | null, build: string, since: string | null, status = 'completed') =>
    ({ ...run(id, '652afa6c', conclusion, 45, status), event: 'workflow_dispatch', display_title: `driftwood fps ${sha(build)} since ${since === null ? 'none' : sha(since)}` });
  const fps = [night(45000000001, 'success', '652afa6c', null), night(45000000002, 'failure', 'bbbb2222', '652afa6c'),
    night(45000000003, 'failure', 'aaaa1111', null, 'in_progress'), { ...night(45000000004, 'failure', 'x', null), display_title: 'driftwood fps no night since none' }];
  const watched = { ...io, fpsRuns: () => fps };
  expect(sweep(watched).map(row => row.kind)).not.toContain('red');
  sweep(watched);
  expect(w.receipts.filter(line => line.includes('DRIFTWOOD-FPS'))).toEqual([
    'main DRIFTWOOD-FPS bbbb222200 run 45000000002 failure: a floor miss or a p95 more than 10% over the last green night 652afa6c00; a fix row for opus-other, opus-red, never a red main (DF7, J444)',
    'main DRIFTWOOD-FPS run 45000000004 failed with no night in its name (see the run; DF7)',
  ]);
  expect(fpsNight({ display_title: `driftwood fps ${sha('aaaa1111')} since none` })).toEqual({ build: sha('aaaa1111'), since: null });
  expect(w.sent).toEqual([]);
});
