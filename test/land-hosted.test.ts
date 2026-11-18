// J240 / DEV-SPEED DS21: scripts/land.mjs against real git. A bare repo stands
// in for GitHub (with protect-main's no-force, no-delete rule as an update
// hook), a post-receive hook records every pushed tip, and a fake `gh` on PATH
// answers Actions queries only for SHAs that were really pushed.
// oxlint-disable-next-line import/no-nodejs-modules -- Real git repositories, hooks and the land CLI.
import { execFileSync, spawn, spawnSync } from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- Fixture repositories stay in the repository scratch root.
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Fixture paths.
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { mainPushArgs, parseArgs } from '../scripts/land.mjs';
import { cleanLandFixtures, fixture, prepushLines } from './fixtures/land-git';

afterEach(cleanLandFixtures);

describe('land (J240): fast-forward main from a plan worktree after its branch CI is green', () => {
  test('MF12: a spent GitHub quota is waited out, not read as "no hosted ci run", and the plan lands', () => {
    const f = fixture(), wt = f.worktree('quota');
    const head = f.commit(wt, 'src/quota.ts', 'export const quota = 1;\n', 'quota');
    // Spent for longer than --appear (3 s): before MF12 land stopped with "no hosted ci run".
    f.state({ limitedUntil: Date.now() + 4_000 });
    const result = f.land(wt);
    expect(result.stdout).toMatch(/GitHub API quota spent .*waiting \d+ s for it to reset, then resuming/u);
    expect(result.stdout).not.toMatch(/no hosted ci run/u);
    expect(result.status).toBe(0);
    expect(f.remoteMain()).toBe(head);
    expect(f.read(f.files.gh)).toMatch(/^api rate_limit$/mu);
  });

  test('main has not moved: the exact hosted-green SHA fast-forwards main', () => {
    const f = fixture();
    const wt = f.worktree('foo');
    const tip = f.commit(wt, 'src/feature.ts', 'export const feature = true;', 'feat: add feature');
    const result = f.land(wt);
    expect(result.stdout).toContain('landed');
    expect(result.status).toBe(0);
    expect(f.remoteMain()).toBe(tip);
    expect(f.git(f.remote, ['rev-parse', 'plan/foo'])).toBe(tip);
    // The plan push came first, then main got the same SHA under the normal gate.
    const [plan, main, ...rest] = prepushLines(f);
    expect(plan).toMatch(new RegExp(`^land=0 \\S+ ${tip} refs/heads/plan/foo 0{40}$`, 'u'));
    expect(main).toMatch(new RegExp(`^land=exact:${tip} ${tip} ${tip} refs/heads/main [a-f0-9]{40}$`, 'u'));
    expect(rest).toEqual([]);
    expect(f.read(f.files.gh)).toContain(`head_sha=${tip}`);
    expect(f.read(f.files.receipts)).toMatch(new RegExp(`^\\d\\d:\\d\\d UTC fixture-lane land plan/foo landed ${tip.slice(0, 10)} on main .*; exact; rounds 1;`, 'mu'));
    expect(result.stdout).toContain('WARNING one-row land (J290): commit on main next time');
    expect(f.read(f.files.receipts)).toMatch(/land plan\/foo landed .*; one-row; \d+ s$/mu);
  }, 60_000);

  test('after landing, land starts main-watch to follow the SHA from the canonical checkout (LS5)', async () => {
    const f = fixture();
    const wt = f.worktree('foo');
    const marker = join(f.root, 'watch-args.json');
    f.commit(wt, 'scripts/main-watch.mjs', `import {writeFileSync} from 'node:fs';writeFileSync(${JSON.stringify(marker)},JSON.stringify({argv:process.argv.slice(2),cwd:process.cwd()}));`, 'build: a watcher');
    const tip = f.commit(wt, 'src/feature.ts', 'export const feature = true;', 'feat: add feature');
    const result = f.land(wt);
    expect(result.status, result.stdout).toBe(0);
    expect(result.stdout).toContain(`main-watch follows ${tip.slice(0, 10)}`);
    for (let tries = 0; tries < 100 && !existsSync(marker); tries++) await new Promise(done => setTimeout(done, 50));
    const seen = JSON.parse(readFileSync(marker, 'utf8')) as { argv: string[]; cwd: string };
    expect(seen.argv).toEqual([`--follow=${tip}`, '--lane=fixture-lane', '--pane=w0:p9']);
    expect(realpathSync(seen.cwd)).toBe(realpathSync(f.repo));
  }, 60_000);

  test('LS5: land returns at the main push, then removes its worktree, local branch and origin plan branch', () => {
    const f = fixture();
    const wt = f.worktree('foo');
    f.commit(wt, 'src/feature.ts', 'export const feature = true;', 'feat: add feature');
    // Main moves, so the land is carried: before LS5 it waited for main's own run here.
    f.state({ once: { marker: join(f.root, 'once'), command: ['sh', f.peerScript('src/other.ts', null, 'export const other = 2;')] } });
    const result = f.land(wt, []);
    expect(result.status, result.stdout).toBe(0);
    expect(result.stdout).toMatch(/carried\s+clean rebase/u);
    expect(result.stdout).not.toContain('ci        main ');
    expect(f.read(f.files.receipts)).toMatch(/landed .*; carried; .*main ci followed by main-watch/u);
    expect(result.stdout).toMatch(/cleaned\s+origin plan\/foo deleted; worktree and plan\/foo removed/u);
    expect(existsSync(wt)).toBe(false);
    expect(spawnSync('git', ['rev-parse', '--verify', '--quiet', 'refs/heads/plan/foo'], { cwd: f.repo, env: f.env }).status).not.toBe(0);
    expect(spawnSync('git', ['rev-parse', '--verify', '--quiet', 'refs/heads/plan/foo'], { cwd: f.remote, env: f.env }).status).not.toBe(0);
  }, 60_000);

  test('LS5: a worktree with untracked work is kept after landing; --keep keeps everything', () => {
    const f = fixture();
    const wt = f.worktree('foo');
    f.commit(wt, 'src/feature.ts', 'export const feature = true;', 'feat: add feature');
    // Written while hosted CI runs: an untracked file before the gate stops land up front (DS22).
    f.state({ once: { marker: join(f.root, 'once'), command: ['sh', '-c', `printf mine > '${join(wt, 'notes.txt')}'`] } });
    const result = f.land(wt, []);
    expect(result.status, result.stdout).toBe(0);
    expect(result.stdout).toMatch(/origin plan\/foo deleted; worktree kept: 1 uncommitted or untracked path/u);
    expect(existsSync(join(wt, 'notes.txt'))).toBe(true);
    const g = fixture();
    const kept = g.worktree('bar');
    g.commit(kept, 'src/feature.ts', 'export const feature = true;', 'feat: add feature');
    expect(g.land(kept, ['--keep']).stdout).not.toContain('cleaned');
    expect(existsSync(kept)).toBe(true);
    // J422: push mode is the default and keeps the plan worktree for the next row; --done removes it.
    expect(parseArgs([], {}, 'Jakes-Mac-Mini.local').mode).toBe('local');
    expect(parseArgs([], { WS_LAND_MODE: 'push' }, 'Jakes-Mac-Mini.local').mode).toBe('push');
    expect(parseArgs([], {}, 'macbook')).toEqual({ mode: 'push', pollSeconds: 60, timeoutMinutes: 60, appearMinutes: 5, rounds: 5, keep: true, done: false, preflight: true });
    expect(parseArgs(['--done'], {}, 'macbook')).toMatchObject({ mode: 'push', keep: false, done: true });
    expect(parseArgs([], { WS_LAND_MODE: 'local' })).toMatchObject({ mode: 'local', keep: false });
    expect(parseArgs(['--hosted'], {}).mode).toBe('hosted');
    expect(parseArgs(['--local'], { WS_LAND_MODE: 'hosted' }).mode).toBe('local');
    expect(parseArgs(['--no-preflight']).preflight).toBe(false);
  }, 60_000);

  test('J358: a failed copy keeps the landed worktree and local branch', () => {
    const f = fixture(), wt = f.worktree('copy-failure');
    const tip = f.commit(wt, 'src/feature.ts', 'export const feature = true;', 'feature');
    writeFileSync(join(f.root, 'session-keep'), 'not a directory');
    const result = f.land(wt, []);
    expect(result.status, result.stdout).toBe(0);
    expect(result.stdout).toContain('worktree kept: copy failed');
    expect(existsSync(wt)).toBe(true);
    expect(f.git(f.repo, ['rev-parse', 'plan/copy-failure'])).toBe(tip);
  }, 60_000);

  test('J358: generated changes are copied as a recoverable patch before removal', () => {
    const f = fixture(), wt = f.worktree('generated');
    f.commit(wt, 'src/bytes.generated.ts', 'export const bytes = 1;\n', 'generated');
    f.state({ once: { marker: join(f.root, 'once'), command: [process.execPath, '-e', `require('fs').writeFileSync(${JSON.stringify(join(wt, 'src/bytes.generated.ts'))}, 'export const bytes = 2;\\n')`] } });
    const result = f.land(wt, []);
    expect(result.status, result.stdout).toBe(0);
    expect(existsSync(wt)).toBe(false);
    const day = join(f.root, 'session-keep', readdirSync(join(f.root, 'session-keep'))[0]!);
    const copy = join(day, readdirSync(day)[0]!);
    expect(readFileSync(join(copy, 'tracked.patch'), 'utf8')).toContain('+export const bytes = 2;');
  }, 60_000);

  test('J358: a shutdown write after copying keeps the worktree', async () => {
    const f = fixture(), wt = f.worktree('shutdown');
    f.commit(wt, 'src/bytes.generated.ts', 'export const bytes = 1;\n', 'generated');
    const marker = join(f.root, 'ready');
    const child = spawn(process.execPath, ['-e', `const fs=require('fs');process.on('SIGTERM',()=>{fs.writeFileSync('src/bytes.generated.ts','export const bytes = 3;\\n');process.exit(0)});fs.writeFileSync(${JSON.stringify(marker)},'ready');setInterval(()=>{},1000)`], { cwd: wt, stdio: 'ignore' });
    try {
      for (let tries = 0; tries < 100 && !existsSync(marker); tries++) await new Promise(done => setTimeout(done, 20));
      expect(existsSync(marker)).toBe(true);
      const result = f.land(wt, []);
      expect(result.status, result.stdout).toBe(0);
      expect(result.stdout).toContain('worktree kept: changed during process cleanup');
      expect(readFileSync(join(wt, 'src/bytes.generated.ts'), 'utf8')).toContain('bytes = 3');
    } finally { if (child.exitCode === null) child.kill('SIGKILL'); }
  }, 60_000);

  test('after the main push, the canonical checkout fast-forwards to it (Jake: land into the main checkout)', () => {
    const f = fixture();
    const wt = f.worktree('foo');
    const tip = f.commit(wt, 'src/feature.ts', 'export const feature = true;', 'feat: add feature');
    const result = f.land(wt);
    expect(result.status, result.stdout).toBe(0);
    expect(result.stdout).toMatch(/canonical +canonical main fast-forwarded 1 commit\(s\)/u);
    expect(f.git(f.repo, ['rev-parse', 'HEAD'])).toBe(tip);
    expect(f.git(f.repo, ['rev-parse', 'HEAD'])).toBe(f.remoteMain());
  }, 60_000);

  test('a dirty or diverged canonical checkout is never moved: land warns and leaves a receipt', () => {
    for (const kind of ['dirty', 'diverged'] as const) {
      const f = fixture();
      const wt = f.worktree('foo');
      f.commit(wt, 'src/feature.ts', 'export const feature = true;', 'feat: add feature');
      if (kind === 'dirty') writeFileSync(join(f.repo, 'src/a.ts'), 'export const a = 2;\n');
      else f.commit(f.repo, 'src/local.ts', 'export const local = 1;', 'chore: a local commit');
      const before = f.git(f.repo, ['rev-parse', 'HEAD']);
      const result = f.land(wt);
      expect(result.status, `${kind}\n${result.stdout}`).toBe(0);
      expect(result.stdout, kind).toMatch(kind === 'dirty' ? /canonical +WARNING canonical main 1 behind; tracked edits; left alone/u : /canonical +WARNING CANONICAL MAIN DIVERGED: 1 ahead, 1 behind/u);
      expect(f.git(f.repo, ['rev-parse', 'HEAD']), kind).toBe(before);
      if (kind === 'dirty') expect(readFileSync(join(f.repo, 'src/a.ts'), 'utf8')).toBe('export const a = 2;\n');
      expect(f.read(f.files.receipts), kind).toMatch(/land plan\/foo canonical checkout not fast-forwarded after landing: /u);
      expect(f.read(f.files.receipts), kind).toMatch(/land plan\/foo landed /u);
    }
  }, 120_000);

  for (const carried of [false, true]) test(`QA14: narrow fetch refreshes stale red plan provenance before ${carried ? 'carried' : 'exact'} main push`, () => {
    const f = fixture(), wt = f.worktree('pin-refresh');
    const ref = 'refs/heads/plan/pin-refresh', tracking = 'refs/remotes/origin/plan/pin-refresh';
    f.git(f.repo, ['config', '--replace-all', 'remote.origin.fetch', '+refs/heads/main:refs/remotes/origin/main']);
    const stale = f.commit(wt, 'test/pins/rings.json', '{"ring":2}\n', 'test: update pins');
    f.git(wt, ['push', '--quiet', 'origin', `${ref}:${ref}`]);
    f.git(wt, ['update-ref', tracking, stale]);
    const tested = f.commit(wt, 'src/fix.ts', 'export const fixed = true;\n', 'fix: heal branch CI');
    // Exercise the production provenance decision with SHA-specific CI verdicts:
    // the earlier tip carries identical pins but is red; only tested is green.
    const hook = join(f.root, 'check-pins.mjs');
    writeFileSync(hook, `import { readFileSync } from 'node:fs';
import { checkPinPush } from ${JSON.stringify(new URL('../.githooks/pin-provenance.mjs', import.meta.url).href)};
const verdict = checkPinPush({ cwd: process.cwd(), refs: readFileSync(0, 'utf8'), env: {}, ciState: sha => sha === '${tested}' ? 'green' : 'red' });
console.error(JSON.stringify(verdict));
process.exit(verdict.ok ? 0 : 1);
`);
    writeFileSync(join(f.root, 'hooks/pre-push'), `#!/bin/sh
refs=$(cat)
echo "$refs" >> "$PREPUSH_LOG"
case "$refs" in *refs/heads/main*) printf '%s\\n' "$refs" | node '${hook}';; esac
`);
    chmodSync(join(f.root, 'hooks/pre-push'), 0o755);
    if (carried) f.state({ once: { marker: join(f.root, 'once'), command: ['sh', f.peerScript('src/other.ts', null, 'export const other = 2;')] } });
    const result = f.land(wt);
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(f.git(f.repo, ['rev-parse', tracking])).toBe(tested);
    expect(f.git(f.remote, ['rev-parse', ref])).toBe(tested);
    expect(f.git(f.remote, ['show', 'main:test/pins/rings.json'])).toBe('{"ring":2}');
    expect(f.remoteMain() === tested).toBe(!carried);
    expect(result.stdout + result.stderr).toContain(`origin/plan/pin-refresh ${tested.slice(0, 10)}, ci green`);
  }, 60_000);

  for (const removed of [false, true]) test(`QA14: a plan ${removed ? 'deleted' : 'replaced'} during hosted CI cannot land its old green tip`, () => {
    const f = fixture(), wt = f.worktree('changed-remote');
    const before = f.remoteMain(), ref = 'refs/heads/plan/changed-remote';
    f.commit(wt, 'test/pins/rings.json', '{"ring":2}\n', 'test: update pins');
    f.state({ once: { marker: join(f.root, 'once'), command: ['git', '--git-dir', f.remote, 'update-ref', ...(removed ? ['-d', ref] : [ref, before])] } });
    const result = f.land(wt);
    expect(result.status, result.stdout + result.stderr).toBe(1);
    expect(result.stdout).toContain(removed ? 'git fetch origin plan/changed-remote failed' : 'changed after hosted CI');
    expect(f.remoteMain()).toBe(before);
    expect(prepushLines(f).some(line => line.includes('refs/heads/main'))).toBe(false);
  }, 60_000);

  test('main moved to disjoint paths: rebase, carry the hosted proof, static pre-push, then return (main-watch follows)', () => {
    const f = fixture();
    const wt = f.worktree('foo');
    const tested = f.commit(wt, 'src/feature.ts', 'export const feature = true;', 'feat: add feature');
    f.state({ once: { marker: join(f.root, 'once'), command: ['sh', f.peerScript('src/other.ts', null, 'export const other = 2;')] } });
    const result = f.land(wt);
    expect(result.status, result.stdout).toBe(0);
    const landed = f.remoteMain();
    expect(landed).not.toBe(tested);
    expect(f.git(f.remote, ['log', '--format=%s', '-3', 'main']).split('\n')).toEqual(['feat: add feature', 'peer lands', 'seed']);
    expect(result.stdout).toMatch(/carried\s+clean rebase onto/u);
    // The rebased SHA reached main only, under the static gate; plan/foo still holds the tested SHA.
    expect(prepushLines(f).at(-1)).toMatch(new RegExp(`^land=carried:${landed} ${landed} ${landed} refs/heads/main [a-f0-9]{40}$`, 'u'));
    expect(f.git(f.remote, ['rev-parse', 'plan/foo'])).toBe(tested);
    // LS8: land never asks GitHub about main's own run; main-watch does.
    expect(f.read(f.files.gh)).not.toContain(`head_sha=${landed}`);
    expect(f.read(f.files.receipts)).toMatch(/landed .*; carried; rounds 1; .*main ci followed by main-watch/u);
  }, 60_000);

  test('main moved over the same file: a clean rebase lands on the branch run, no second branch CI (J249)', () => {
    const f = fixture();
    const wt = f.worktree('foo');
    const tested = f.edit(wt, 'src/shared.ts', 'line10 = 10', 'line10 = 100', 'feat: tune line 10');
    f.state({ once: { marker: join(f.root, 'once'), command: ['sh', f.peerScript('src/shared.ts', 'line1 = 1;', 'line1 = 11;')] } });
    const result = f.land(wt);
    expect(result.status, result.stdout).toBe(0);
    const landed = f.remoteMain();
    expect(landed).not.toBe(tested);
    expect(result.stdout).toMatch(/carried\s+clean rebase onto [0-9a-f]{10}: the branch's green run [0-9a-f]{10} carries \(J249\)/u);
    expect(f.git(f.remote, ['show', 'main:src/shared.ts'])).toMatch(/line1 = 11;[\s\S]*line10 = 100;/u);
    // The plan branch keeps the tested SHA: nothing went back to branch CI.
    expect(f.git(f.remote, ['rev-parse', 'plan/foo'])).toBe(tested);
    expect(prepushLines(f).filter(line => line.includes('refs/heads/plan/foo'))).toHaveLength(1);
    expect(result.stdout).toMatch(/rule +main's own CI runs on [0-9a-f]{10} now\. If it goes red, the lane that landed last fixes it forward or reverts it/u);
    expect(f.read(f.files.receipts)).toMatch(/landed .*; carried; rounds 1;/u);
  }, 60_000);

  test('main moves during the merge itself: the push loses the race, land rebases and retries', () => {
    const f = fixture();
    const wt = f.worktree('foo');
    f.commit(wt, 'src/feature.ts', 'export const feature = true;', 'feat: add feature');
    writeFileSync(f.files.raceScript, readFileSync(f.peerScript('src/racer.ts', null, 'export const racer = 3;'), 'utf8'));
    writeFileSync(f.files.race, '');
    const result = f.land(wt);
    expect(result.status, result.stdout).toBe(0);
    expect(result.stdout).toContain('main moved during the merge');
    expect(f.git(f.remote, ['log', '--format=%s', '-3', 'main']).split('\n')).toEqual(['feat: add feature', 'peer lands', 'seed']);
    expect(f.read(f.files.receipts)).toMatch(/landed .*; carried; rounds 2;/u);
  }, 60_000);

  test('red hosted CI stops and names the failed job; main is unchanged', () => {
    const f = fixture();
    const wt = f.worktree('foo');
    f.commit(wt, 'src/feature.ts', 'export const feature = true;', 'feat: add feature');
    const before = f.remoteMain();
    f.state({ red: { 'plan/foo': { ci: 'tests (3)' } } });
    const result = f.land(wt);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('land STOP hosted CI is red');
    expect(result.stdout).toMatch(/ci run \d+ failure: tests \(3\) \(failure\)/u);
    expect(f.remoteMain()).toBe(before);
    expect(f.read(f.files.receipts)).toMatch(/STOP hosted CI red .*tests \(3\)/u);
  }, 60_000);

  test('a red stop line names blocking failures and sets quarantine reds apart as non-blocking', () => {
    const f = fixture();
    const wt = f.worktree('bar');
    f.commit(wt, 'src/feature.ts', 'export const feature = true;', 'feat: add feature');
    const before = f.remoteMain();
    f.state({ red: { 'plan/bar': { ci: 'quarantine' } } });
    const stopped = f.land(wt);
    expect(stopped.status).toBe(1);
    // The run conclusion still decides: a red run whose only listed failure is a quarantine job stops too.
    expect(stopped.stdout).toMatch(/ci run \d+ failure: no blocking failed job listed \(non-blocking: quarantine \(failure\)\)/u);
    expect(f.remoteMain()).toBe(before);
  }, 60_000);

  test('TS15: a failed boundaries job blocks land and is not retried as a flaky test file', () => {
    const f = fixture(), wt = f.worktree('boundaries');
    f.commit(wt, 'src/feature.ts', 'export const feature = true;', 'feat: add feature');
    const before = f.remoteMain();
    f.state({ red: { 'plan/boundaries': { ci: 'boundaries' } } });
    const stopped = f.land(wt);
    expect(stopped.status).toBe(1);
    expect(stopped.stdout).toMatch(/ci run \d+ failure: boundaries \(failure\)/u);
    expect(stopped.stdout).not.toContain('non-blocking: boundaries');
    expect(f.remoteMain()).toBe(before);
    expect(f.read(f.files.receipts)).toMatch(/STOP hosted CI red .*boundaries/u);
  }, 60_000);

  test('LS1 (J250): a rebase across two main commits that each move the live revisions lands with no stamp conflict', () => {
    const f = fixture();
    // The real revision helpers over a real tree: a render file and the package's dependency specs are inputs of both.
    mkdirSync(join(f.repo, 'src/client/engine/render'), { recursive: true });
    writeFileSync(join(f.repo, 'pnpm-lock.yaml'), "lockfileVersion: '9.0'\n");
    writeFileSync(join(f.repo, 'package.json'), '{"name":"fixture","private":true,"dependencies":{"three":"1"}}\n');
    writeFileSync(join(f.repo, 'src/client/engine/render/look.ts'), 'export const look = 1;\n');
    f.git(f.repo, ['add', 'pnpm-lock.yaml', 'package.json', 'src/client']);
    f.git(f.repo, ['commit', '--quiet', '-m', 'chore: inputs']);
    f.git(f.repo, ['push', '--quiet', 'origin', 'main']);
    const revision = (cwd: string) => execFileSync(process.execPath, ['--input-type=module', '-e',
      `import {rendererRevision} from '${resolve('scripts/renderer-revision.mjs')}';console.log(rendererRevision(process.cwd()));`], { cwd, env: f.env, encoding: 'utf8' }).trim();
    const before = revision(f.repo);
    const wt = f.worktree('foo');
    f.commit(wt, 'src/client/engine/render/feature.ts', 'export const feature = true;', 'feat: add a render input');
    // Main moves twice mid-landing, each commit moving the renderer revision: before LS1 each regenerated a tracked stamp.
    const peer = join(f.root, 'peer-two.sh');
    writeFileSync(peer, `set -e\nunset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_PREFIX GIT_COMMON_DIR\ncd '${f.peer}'\ngit pull --quiet --ff-only origin main\n`
      + "printf 'export const look = 2;\\n' > src/client/engine/render/look.ts\ngit commit --quiet -m 'peer one' -- src/client/engine/render/look.ts\n"
      + "sed -i.bak 's/\"three\":\"1\"/\"three\":\"2\"/' package.json && rm package.json.bak\ngit commit --quiet -m 'peer two' -- package.json\ngit push --quiet origin HEAD:main\n");
    f.state({ once: { marker: join(f.root, 'once'), command: ['sh', peer] } });
    const result = f.land(wt);
    expect(result.status, result.stdout).toBe(0);
    expect(result.stdout).toMatch(/carried\s+clean rebase onto/u);
    expect(result.stdout).not.toMatch(/stamp/u);
    expect(f.git(f.remote, ['log', '--format=%s', '-3', 'main']).split('\n')).toEqual(['feat: add a render input', 'peer two', 'peer one']);
    expect(f.git(f.remote, ['ls-tree', '-r', '--name-only', 'main'])).not.toMatch(/revision\.json/u);
    // The landed tree's revision is computed live from it, and both peer commits moved it.
    f.git(f.repo, ['pull', '--quiet', '--ff-only', 'origin', 'main']);
    expect(revision(f.repo)).not.toBe(before);
  }, 90_000);

  test('a rebase conflict stops with the conflicting paths and leaves the worktree as it was', () => {
    const f = fixture();
    const wt = f.worktree('foo');
    const tested = f.edit(wt, 'src/shared.ts', 'line5 = 5', 'line5 = 50', 'feat: plan line 5');
    f.state({ once: { marker: join(f.root, 'once'), command: ['sh', f.peerScript('src/shared.ts', 'line5 = 5', 'line5 = 55')] } });
    const result = f.land(wt);
    expect(result.status).toBe(1);
    expect(result.stdout).toMatch(/conflicts in: src\/shared\.ts/u);
    expect(f.git(wt, ['rev-parse', 'HEAD'])).toBe(tested);
    expect(f.git(wt, ['status', '--porcelain'])).toBe('');
    expect(f.git(f.remote, ['log', '--format=%s', '-1', 'main'])).toBe('peer lands');
    expect(f.read(f.files.receipts)).toMatch(/STOP rebase conflict .*src\/shared\.ts/u);
  }, 60_000);

  test('a force push is refused: land refuses force flags, never forms one, and main rejects non-fast-forwards', () => {
    const f = fixture();
    const wt = f.worktree('foo');
    f.commit(wt, 'src/feature.ts', 'export const feature = true;', 'feat: add feature');
    const before = f.remoteMain(), pushed = f.read(f.files.pushed);
    for (const flag of ['--force', '-f', '--force-with-lease', '--force=1']) {
      const result = f.land(wt, [flag]);
      expect(result.status).toBe(1);
      expect(result.stdout).toContain(`refused ${flag}: land never force-pushes main`);
    }
    expect(f.read(f.files.pushed)).toBe(pushed);
    expect(mainPushArgs('a'.repeat(40))).toEqual(['push', '--porcelain', 'origin', `${'a'.repeat(40)}:refs/heads/main`]);
    expect(() => mainPushArgs('+HEAD')).toThrow(/exact SHA/u);
    // The remote's own protect-main rule backs it: a hand-forced main rewrite is refused.
    f.git(f.peer, ['commit', '--quiet', '--amend', '-m', 'rewritten seed']);
    expect(spawnSync('git', ['push', '--force', 'origin', 'HEAD:main'], { cwd: f.peer, env: f.env, encoding: 'utf8' }).status).not.toBe(0);
    expect(f.remoteMain()).toBe(before);
    expect(() => parseArgs(['--rounds=2', '--force'])).toThrow(/never force-pushes main/u);
  }, 60_000);

  // BUILD-MAX 2026-11-15: 14 of 22 stopped lands failed a check that runs locally. The preflight runs those first, here.
});
