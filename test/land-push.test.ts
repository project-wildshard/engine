// J422 (meta FLOW-SIMPLE FS2): land's default push mode, the one way onto main for every row.
// oxlint-disable-next-line import/no-nodejs-modules -- Inspect the owned fixture worktree.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { afterEach, describe, expect, test } from 'vitest';
import { cleanLandFixtures, fixture, prepushLines } from './fixtures/land-git';

afterEach(cleanLandFixtures);

describe('land (J422): push mode', () => {
  test('pushes main through the ordinary pre-push with the push marker, no plan push, keeps the worktree', () => {
    const f = fixture();
    f.env['WS_LAND_MODE'] = 'push';
    const wt = f.worktree('row');
    const tip = f.commit(wt, 'src/row.ts', 'export const row = 1;', 'feat: row');
    const result = f.land(wt, []);
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(f.remoteMain()).toBe(tip);
    expect(f.git(f.remote, ['for-each-ref', '--format=%(refname)', 'refs/heads/plan/'])).toBe('');
    expect(f.read(f.files.gh)).toBe('');
    expect(prepushLines(f)).toHaveLength(1);
    expect(prepushLines(f)[0]).toContain(`land=push:${tip}`);
    expect(result.stdout).not.toContain('full-gate');
    expect(result.stdout).not.toContain('one-row land');
    expect(f.read(f.files.receipts)).toMatch(/; push;.*finished=\S+; \d+ s$/mu);
    // The next row goes on the same worktree and branch.
    expect(existsSync(wt)).toBe(true);
    const next = f.commit(wt, 'src/row.ts', 'export const row = 2;', 'feat: next row');
    const again = f.land(wt, []);
    expect(again.status, again.stdout + again.stderr).toBe(0);
    expect(f.remoteMain()).toBe(next);
  }, 60_000);

  test('a lost race rebases and pushes again', () => {
    const f = fixture();
    f.env['WS_LAND_MODE'] = 'push';
    const wt = f.worktree('race');
    f.commit(wt, 'src/race.ts', 'export const race = 1;', 'feat: race');
    writeFileSync(f.files.raceScript, readFileSync(f.peerScript('src/peer.ts', null, 'export const peer = 1;'), 'utf8'));
    writeFileSync(f.files.race, '');
    const result = f.land(wt, []);
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.stdout).toContain('moved');
    expect(f.git(wt, ['log', '--format=%s', '-3', f.remoteMain()])).toContain('peer lands');
    expect(prepushLines(f).every(line => line.includes('land=push:'))).toBe(true);
  }, 60_000);

  test('an edit made while the gate runs stops the race round naming it, not a bare rebase failure', () => {
    const f = fixture();
    f.env['WS_LAND_MODE'] = 'push';
    const wt = f.worktree('dirty-race');
    const tip = f.commit(wt, 'src/race.ts', 'export const race = 1;', 'feat: race');
    const peer = readFileSync(f.peerScript('src/peer.ts', null, 'export const peer = 1;'), 'utf8');
    writeFileSync(f.files.raceScript, `${peer}\nprintf 'export const race = 2;\\n' > '${wt}/src/race.ts'\n`);
    writeFileSync(f.files.race, '');
    const result = f.land(wt, []);
    expect(result.status, result.stdout + result.stderr).toBe(1);
    expect(result.stdout).toMatch(/land STOP .*not clean before rebasing onto main/u);
    expect(result.stdout).toMatch(/ M src\/race\.ts: uncommitted change/u);
    expect(result.stdout).not.toContain('none reported');
    expect(f.git(wt, ['rev-parse', 'HEAD'])).toBe(tip);
    expect(readFileSync(`${wt}/src/race.ts`, 'utf8')).toBe('export const race = 2;\n');
  }, 60_000);

  test('--done removes the worktree after the last row', () => {
    const f = fixture();
    f.env['WS_LAND_MODE'] = 'push';
    const wt = f.worktree('last');
    const tip = f.commit(wt, 'src/last.ts', 'export const last = 1;', 'feat: last row');
    const result = f.land(wt, ['--done']);
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(f.remoteMain()).toBe(tip);
    expect(existsSync(wt)).toBe(false);
  }, 60_000);
});
