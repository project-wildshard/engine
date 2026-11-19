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
