// Registered by test/main-watch.test.ts in the engine CI suite.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { expect, test } from 'vitest';
import { failurePaths, KEEPER_MS, readState, redMessage, redRecipients, redSuspect, sweep } from '../main-watch.mjs';

const older = 'a'.repeat(40), newer = 'b'.repeat(40), other = 'c'.repeat(40);
const testFile = 'test/host-ruler-roots.test.ts', sourceFile = 'scripts/host-ruler/roots.mjs';
const range = 'old..new', url = 'https://github.com/project-wildshard/engine/actions/runs/49', failed = 'tests (6)';

test('J473 groups commits and a named fixer at one physical pane', () => {
  const rows = [
    { sha: newer, lander: { lane: 'codex-fix', slug: '', pane: 'w1:p1' } },
    { sha: older, lander: { lane: 'opus-plan', slug: 'fix-plan' } },
    { sha: older, lander: { lane: 'opus-plan', slug: 'fix-plan' } },
    { sha: other, lander: { lane: 'other', slug: '', pane: 'w1:p2' } },
  ];
  const recipients = redRecipients(rows, [{ pane_id: 'w1:p1', label: 'engine plan/fix-plan' }],
    new Map([['coordinator', 'w1:p1']]), ['coordinator', 'coordinator']);
  expect(recipients.map(row => [row.key, [...row.commits], row.fixer])).toEqual([
    ['pane:w1:p1', [newer, older], true], ['pane:w1:p2', [other], false],
  ]);
  const text = redMessage(recipients[0], {
    range, url, failed, named: 'codex-fix, opus-plan, other', suspect: { sha: older, file: testFile },
  });
  expect(text).toMatch(/^main-watch: MAIN RED\. Suspect aaaaaaaaaa \(yours\) last changed test\/host-ruler-roots\.test\.ts/u);
  expect(text).toContain('You also landed bbbbbbbbbb');
  expect(text.match(/aaaaaaaaaa/gu)).toHaveLength(1);
  expect(text).not.toContain('cccccccccc');
});

test('J473 takes failure evidence from colored logs and picks the newest matching change in the range', () => {
  const logs = [
    `2026-11-19T22:34:03.8257769Z ✓ node test/passed.test.ts\n`
      + `2026-11-19T22:34:03.8259339Z \u001B[41m FAIL \u001B[0m node /home/runner/work/engine/engine/${testFile} > title\n`
      + `2026-11-19T22:34:03.8264015Z ❯ ${testFile}:45:47\n`,
    `##[error]${sourceFile}(9,1): error TS2322: bad type\n`,
  ];
  const files = failurePaths(logs);
  expect(files).toEqual([`home/runner/work/engine/engine/${testFile}`, testFile, sourceFile]);
  expect(redSuspect([other, newer, older], files, new Map([
    [other, ['test/passed.test.ts']], [newer, [sourceFile]], [older, [testFile]],
  ]))).toEqual({ sha: newer, file: sourceFile });
  expect(redSuspect([other, older], files, new Map([[older, [testFile]]]))).toEqual({ sha: older, file: testFile });
  expect(redSuspect([other], files, new Map([[other, ['test/passed.test.ts']]]))).toBeUndefined();
});

test('J473 remembers a delivered run across a rerun, a replay and the keeper tick', () => {
  mkdirSync(resolve('tmp'), { recursive: true });
  const scratch = mkdtempSync(resolve('tmp/main-watch-dedupe-'));
  const state = join(scratch, 'state.json');
  try {
    const green = { id: 48, created_at: '2026-11-19T22:00:00Z', head_sha: other, status: 'completed', conclusion: 'success', event: 'push' };
    const red = { ...green, id: 49, created_at: '2026-11-19T22:01:00Z', head_sha: newer, conclusion: 'failure' };
    let runs = [green], now = Date.parse(red.created_at);
    /** @type {string[]} */ const sent = [];
    /** @type {Parameters<typeof sweep>[0]} */ const io = {
      repo: 'project-wildshard/engine', state, runs: () => runs, tip: () => newer, contains: () => true,
      failed: () => ({ names: [failed], logs: [`FAIL ${testFile} > section host`] }), annotations: () => '',
      commits: () => [newer, older], changes: () => new Map([[older, [testFile]]]),
      receipts: () => '17:01 Cancún codex-fix main-push pushed main bbbbbbbbbb: 2 commit(s) pane w1:p1',
      receipt: () => undefined, now: () => now, fixers: () => ['coordinator'], panes: () => [],
      agents: () => new Map([['coordinator', 'w1:p1'], ['buddy-engine', 'w1:p1']]),
      send: (_pane, text) => { sent.push(text); return true; },
      prompt: (_lane, text) => { sent.push(text); return true; },
      dispatch: () => undefined, quotaReset: () => now,
    };
    sweep(io);
    runs = [green, red]; sweep(io);
    expect(sent).toEqual([expect.stringContaining('Suspect aaaaaaaaaa')]);
    runs = [green, { ...red, run_attempt: 2 }]; sweep(io);
    const saved = readState(state);
    expect(saved?.notified?.[red.id]).toContain('pane:w1:p1');
    // judged is bounded. Replay after a lost/aged-out verdict and still preserve per-recipient delivery history.
    writeFileSync(state, JSON.stringify({ ...saved, judged: [green.id], red: { ...saved?.red, keeper: false } }));
    sweep(io);
    now += KEEPER_MS + 1;
    sweep(io);
    expect(sent).toHaveLength(1);
  } finally { rmSync(scratch, { recursive: true, force: true }); }
});

const freshFile = 'test/spawn-cell.test.ts', incoming = 'd'.repeat(40);

/** @param {(fixture:ReturnType<typeof redSpanFixture>)=>void} verify */
function withRedSpan(verify) {
  mkdirSync(resolve('tmp'), { recursive: true });
  const scratch = mkdtempSync(resolve('tmp/main-watch-span-'));
  try { verify(redSpanFixture(join(scratch, 'state.json'))); }
  finally { rmSync(scratch, { recursive: true, force: true }); }
}

/** @param {string} state */
function redSpanFixture(state) {
  const green = { id: 60, created_at: '2026-11-19T22:00:00Z', head_sha: other, status: 'completed', conclusion: 'success', event: 'push' };
  const runs = [green], logs = new Map();
  /** @type {{to:string,text:string}[]} */ const sent = [];
  /** @type {string[]} */ const receipts = [];
  /** @type {Parameters<typeof sweep>[0]} */ const io = {
    repo: 'project-wildshard/engine', state, runs: () => runs, tip: () => runs.at(-1)?.head_sha ?? other, contains: () => true,
    failed: id => ({ names: [failed], logs: logs.get(id) ?? [] }), annotations: () => '',
    commits: (_from, to) => to === incoming ? [incoming, newer, older] : [newer, older],
    changes: () => new Map([[newer, [testFile]], [older, [freshFile]]]),
    receipts: () => [
      '17:01 Cancún first main-push pushed main bbbbbbbbbb: 1 commit(s) pane w1:p1',
      '17:02 Cancún second main-push pushed main aaaaaaaaaa: 1 commit(s) pane w1:p2',
      '17:03 Cancún incoming main-push pushed main dddddddddd: 1 commit(s) pane w1:p3',
    ].join('\n'),
    receipt: line => { receipts.push(line); }, panes: () => [], now: () => Date.parse(green.created_at),
    agents: () => new Map(), fixers: () => ['coordinator'],
    send: (to, text) => { sent.push({ to, text }); return true; },
    prompt: (to, text) => { sent.push({ to, text }); return true; }, dispatch: () => undefined,
  };
  /** @param {number} id @param {string[]} paths @param {string} [head] */
  const red = (id, paths, head = newer) => {
    logs.set(id, paths.map(path => `FAIL ${path} > proof`));
    runs.push({ ...green, id, head_sha: head, conclusion: 'failure' });
    sweep(io);
  };
  sweep(io);
  red(61, [`/home/runner/work/engine/engine/${testFile}`]);
  expect(sent.map(row => row.to)).toEqual(['w1:p1', 'w1:p2', 'coordinator']);
  sent.length = 0;
  return { red, runs, green, io, sent, receipts };
}

test('a repeat red with the same commits and failing test only writes a receipt', () => withRedSpan(({ red, sent, receipts }) => {
  red(62, [testFile]);
  expect(sent).toEqual([]);
  expect(receipts).toContainEqual(expect.stringMatching(/MAIN RED .* run 62: /u));
}));

test('a newly failing file prompts just its suspect lander and omits the earlier failure', () => withRedSpan(({ red, sent }) => {
  red(62, [testFile, freshFile]);
  expect(sent.map(row => row.to)).toEqual(['w1:p2']);
  expect(sent[0]?.text).toContain(`Suspect aaaaaaaaaa (yours) last changed ${freshFile}`);
  expect(sent[0]?.text).toContain(`failed: ${freshFile}.`);
  expect(sent[0]?.text).not.toContain(testFile);
  sent.length = 0;
  red(63, [testFile]);
  red(64, [freshFile]);
  expect(sent).toEqual([]);
}));

test('a new lander is the only recipient until a green ends the span', () => withRedSpan(({ red, runs, green, io, sent }) => {
  red(62, [testFile], incoming);
  expect(sent).toEqual([{ to: 'w1:p3', text: expect.stringContaining('You landed dddddddddd') }]);
  expect(sent[0]?.text).not.toContain(testFile);
  sent.length = 0;
  red(63, [testFile], incoming);
  expect(sent).toEqual([]);
  runs.push({ ...green, id: 64, head_sha: incoming });
  sweep(io);
  red(65, [testFile]);
  expect(sent.map(row => row.to)).toEqual(['w1:p1', 'w1:p2', 'coordinator']);
}));

test('a running span keeps its prior prompts after a watcher upgrade', () => withRedSpan(({ red, io, sent }) => {
  const saved = readState(io.state);
  if (saved?.red === undefined) throw new Error('expected an open red span');
  delete saved.red.history;
  writeFileSync(io.state, JSON.stringify(saved));
  red(62, [testFile]);
  expect(sent).toEqual([]);
  expect(readState(io.state)?.red?.history?.files).toEqual([testFile]);
}));
