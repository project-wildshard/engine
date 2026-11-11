// J240 / DEV-SPEED DS21: scripts/land.mjs against real git. A bare repo stands
// in for GitHub (with protect-main's no-force, no-delete rule as an update
// hook), a post-receive hook records every pushed tip, and a fake `gh` on PATH
// answers Actions queries only for SHAs that were really pushed.
// oxlint-disable-next-line import/no-nodejs-modules -- Real git repositories, hooks and the land CLI.
import { execFile, execFileSync, spawnSync } from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- Fixture repositories stay in the repository scratch root.
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- A local Actions API double for the main-run reuse check.
import { createServer } from 'node:http';
// oxlint-disable-next-line import/no-nodejs-modules -- Evaluate ci.yml's real concurrency-key expressions.
import { runInNewContext } from 'node:vm';
// oxlint-disable-next-line import/no-nodejs-modules -- Fixture paths.
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { exactBranchProof } from '../scripts/ci-exact-reuse.mjs';
import { failedJobs, mainPushArgs, parseArgs, shaVerdict } from '../scripts/land.mjs';

const LAND = resolve('scripts/land.mjs');
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

const FAKE_GH = `#!/usr/bin/env node
// Answers the two Actions queries land makes, from the remote's pushed-tip log.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
const state = JSON.parse(fs.readFileSync(process.env.FAKE_GH_STATE, 'utf8'));
fs.appendFileSync(state.log, process.argv.slice(2).join(' ') + '\\n');
const path = process.argv[3] ?? '';
const pushed = fs.existsSync(state.pushed) ? fs.readFileSync(state.pushed, 'utf8').trim().split('\\n').filter(Boolean).map(line => line.split(' ')) : [];
const runId = (sha, name) => parseInt(sha.slice(0, 6), 16) * 10 + (name === 'ci' ? 1 : 2);
const sha = /head_sha=([a-f0-9]{40})/.exec(path)?.[1];
if (sha !== undefined) {
  if (state.once !== undefined && !fs.existsSync(state.once.marker)) {
    fs.writeFileSync(state.once.marker, '');
    execFileSync(state.once.command[0], state.once.command.slice(1), { stdio: 'ignore' });
  }
  const onMain = pushed.some(([ref, tip]) => ref === 'refs/heads/main' && tip === sha);
  if (state.onMain !== undefined && onMain && !fs.existsSync(state.onMain.marker)) {
    fs.writeFileSync(state.onMain.marker, '');
    execFileSync(state.onMain.command[0], state.onMain.command.slice(1), { stdio: 'ignore' });
  }
  const after = fs.existsSync(state.pushed) ? fs.readFileSync(state.pushed, 'utf8').trim().split('\\n').filter(Boolean).map(line => line.split(' ')) : [];
  const mainTip = after.filter(([ref]) => ref === 'refs/heads/main').at(-1)?.[1];
  // GitHub cancels a main run when a newer main push replaces it ('superseded'), or for any reason ('always').
  const cancelled = branch => branch === 'main' && (state.cancelMain === 'always' || (state.cancelMain === 'superseded' && sha !== mainTip));
  const branches = [...new Set(after.filter(([, tip]) => tip === sha).map(([ref]) => ref.replace('refs/heads/', '')))];
  const workflow_runs = branches.flatMap(branch => ['ci', 'ring-1'].map(name => {
    const red = state.red?.[branch]?.[name];
    return { id: runId(sha, name), name, event: 'push', head_sha: sha, head_branch: branch, status: 'completed', conclusion: cancelled(branch) ? 'cancelled' : red === undefined ? 'success' : 'failure', html_url: '' };
  }));
  process.stdout.write(JSON.stringify({ workflow_runs }));
} else {
  const id = Number(/runs\\/(\\d+)\\/jobs/.exec(path)?.[1]);
  const jobs = [];
  for (const [branch, names] of Object.entries(state.red ?? {})) for (const [name, job] of Object.entries(names)) jobs.push({ name: job, conclusion: 'failure', run: name, branch });
  process.stdout.write(JSON.stringify({ jobs: jobs.filter(job => id % 10 === (job.run === 'ci' ? 1 : 2)).map(({ name, conclusion }) => ({ name, conclusion })) }));
}
`;

const PROTECT_MAIN = `#!/bin/sh
# GitHub's protect-main ruleset: no deletion and no non-fast-forward on main.
[ "$1" = refs/heads/main ] || exit 0
zero=0000000000000000000000000000000000000000
[ "$2" = $zero ] && exit 0
[ "$3" = $zero ] && { echo "protect-main: deletion refused"; exit 1; }
git merge-base --is-ancestor "$2" "$3" || { echo "protect-main: non-fast-forward refused"; exit 1; }
`;

const POST_RECEIVE = `#!/bin/sh
while read old new ref; do echo "$ref $new" >> "$PUSHED_LOG"; done
`;

// The fixture pre-push records what land asked for and can fail or race on demand.
const PRE_PUSH = `#!/bin/sh
refs=$(cat)
echo "land=\${WS_LAND_MAIN_PUSH:-0} $refs" >> "$PREPUSH_LOG"
[ -f "$PREPUSH_FAIL" ] && { echo "pre-push: planted red check"; exit 1; }
case "$refs" in *refs/heads/main*) if [ -f "$PREPUSH_RACE" ]; then rm "$PREPUSH_RACE"; sh "$RACE_SCRIPT"; fi ;; esac
exit 0
`;

type Fixture = ReturnType<typeof fixture>;

function fixture() {
  mkdirSync('tmp', { recursive: true });
  const root = mkdtempSync(resolve('tmp', 'land-'));
  roots.push(root);
  const remote = join(root, 'remote.git'), repo = join(root, 'engine'), peer = join(root, 'peer'), bin = join(root, 'bin'), hooks = join(root, 'hooks');
  const files = { pushed: join(root, 'pushed.log'), gh: join(root, 'gh.log'), prepush: join(root, 'prepush.log'), receipts: join(root, 'receipts.log'), state: join(root, 'gh-state.json'), fail: join(root, 'prepush-fail'), race: join(root, 'prepush-race'), raceScript: join(root, 'race.sh') };
  const env: NodeJS.ProcessEnv = {
    ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 'Land', GIT_AUTHOR_EMAIL: 'land@example.test', GIT_COMMITTER_NAME: 'Land', GIT_COMMITTER_EMAIL: 'land@example.test',
    PATH: `${bin}:${process.env['PATH'] ?? ''}`, FAKE_GH_STATE: files.state, PUSHED_LOG: files.pushed, PREPUSH_LOG: files.prepush,
    PREPUSH_FAIL: files.fail, PREPUSH_RACE: files.race, RACE_SCRIPT: files.raceScript,
    WS_LAND_REPO: 'project-wildshard/fixture', WS_LANE_RECEIPTS: files.receipts, WS_LANE_NAME: 'fixture-lane', HERDR_PANE_ID: 'w0:p9',
  };
  for (const key of Object.keys(env)) if (key.startsWith('GIT_') && !['GIT_CONFIG_GLOBAL', 'GIT_CONFIG_NOSYSTEM', 'GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL'].includes(key)) Reflect.deleteProperty(env, key);
  const git = (cwd: string, args: readonly string[]): string => execFileSync('git', args, { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const write = (path: string, text: string, mode?: number) => { mkdirSync(resolve(path, '..'), { recursive: true }); writeFileSync(path, text); if (mode !== undefined) chmodSync(path, mode); };

  git(root, ['init', '--quiet', '--bare', '--initial-branch=main', remote]);
  write(join(remote, 'hooks/update'), PROTECT_MAIN, 0o755);
  write(join(remote, 'hooks/post-receive'), POST_RECEIVE, 0o755);
  write(join(bin, 'gh'), FAKE_GH, 0o755);
  write(join(hooks, 'pre-push'), PRE_PUSH, 0o755);
  writeFileSync(files.state, JSON.stringify({ log: files.gh, pushed: files.pushed }));

  git(root, ['clone', '--quiet', remote, repo]);
  const lines = Array.from({ length: 12 }, (_, index) => `export const line${index} = ${index};`).join('\n');
  write(join(repo, 'src/shared.ts'), `${lines}\n`);
  write(join(repo, 'src/a.ts'), 'export const a = 1;\n');
  git(repo, ['add', 'src']);
  git(repo, ['commit', '--quiet', '-m', 'seed']);
  git(repo, ['push', '--quiet', 'origin', 'main']);
  git(repo, ['config', 'core.hooksPath', hooks]);
  git(root, ['clone', '--quiet', remote, peer]);

  const worktree = (slug: string) => {
    const path = join(repo, '.worktrees', slug);
    git(repo, ['fetch', '--quiet', 'origin']);
    git(repo, ['worktree', 'add', '--quiet', '-b', `plan/${slug}`, path, 'origin/main']);
    return path;
  };
  const commit = (cwd: string, path: string, text: string, message: string) => { write(join(cwd, path), text); git(cwd, ['add', path]); git(cwd, ['commit', '--quiet', '-m', message]); return git(cwd, ['rev-parse', 'HEAD']); };
  const edit = (cwd: string, path: string, from: string, to: string, message: string) => commit(cwd, path, readFileSync(join(cwd, path), 'utf8').replace(from, to), message);
  /** A peer lands on main: the script a hook runs to move main mid-landing. */
  const peerScript = (path: string, from: string | null, to: string) => {
    const script = join(root, `peer-${Math.random().toString(16).slice(2)}.sh`);
    const change = from === null
      ? `mkdir -p "$(dirname '${path}')" && printf '%s\\n' '${to}' > '${path}'`
      : `node -e "const fs=require('fs');fs.writeFileSync('${path}',fs.readFileSync('${path}','utf8').replace('${from}','${to}'))"`;
    write(script, `set -e\nunset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_PREFIX GIT_COMMON_DIR\ncd '${peer}'\ngit pull --quiet --ff-only origin main\n${change}\ngit add '${path}'\ngit commit --quiet -m 'peer lands'\ngit push --quiet origin HEAD:main\n`);
    return script;
  };
  const state = (extra: Record<string, unknown>) => writeFileSync(files.state, JSON.stringify({ log: files.gh, pushed: files.pushed, ...extra }));
  const land = (cwd: string, args: readonly string[] = []) => spawnSync(process.execPath, [LAND, '--poll=0.05', '--appear=0.05', ...args], { cwd, env, encoding: 'utf8', timeout: 60_000 });
  const landAsync = (cwd: string) => new Promise<{ code: number | null; stdout: string }>(done => {
    const child = execFile(process.execPath, [LAND, '--poll=0.05', '--appear=0.05'], { cwd, env, encoding: 'utf8', timeout: 60_000 }, (error, stdout) => { done({ code: error === null ? 0 : (typeof error.code === 'number' ? error.code : 1), stdout }); });
    child.stdin?.end();
  });
  const remoteMain = () => git(remote, ['rev-parse', 'main']);
  const read = (path: string) => (existsSync(path) ? readFileSync(path, 'utf8') : '');
  return { root, remote, repo, peer, env, files, git, worktree, commit, edit, peerScript, state, land, landAsync, remoteMain, read };
}

const prepushLines = (f: Fixture) => f.read(f.files.prepush).trim().split('\n').filter(Boolean);

describe('land (J240): fast-forward main from a plan worktree after its branch CI is green', () => {
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
    expect(f.read(f.files.receipts)).toMatch(new RegExp(`^\\d\\d:\\d\\d UTC fixture-lane land plan/foo landed ${tip.slice(0, 10)} on main .*; exact; rounds 1; hosted reruns 0;`, 'mu'));
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

  test('main moved to disjoint paths: rebase, carry the hosted proof, split pre-push, then watch main', () => {
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
    // The rebased SHA reached main only, under the split gate; plan/foo still holds the tested SHA.
    expect(prepushLines(f).at(-1)).toMatch(new RegExp(`^land=carried:${landed} ${landed} ${landed} refs/heads/main [a-f0-9]{40}$`, 'u'));
    expect(f.git(f.remote, ['rev-parse', 'plan/foo'])).toBe(tested);
    expect(f.read(f.files.gh)).toContain(`head_sha=${landed}`);
    expect(f.read(f.files.receipts)).toMatch(/landed .*; carried; rounds 1; hosted reruns 0; .*main ci green/u);
  }, 60_000);

  test('a main run cancelled by a newer main push is superseded, not red: land watches the newer run', () => {
    const f = fixture();
    const wt = f.worktree('foo');
    f.commit(wt, 'src/feature.ts', 'export const feature = true;', 'feat: add feature');
    // Main moves once during the branch CI (so the landing is carried and main's run is watched), then a peer lands
    // on top of it while land watches, and GitHub cancels the landed SHA's run in favour of the peer's.
    f.state({ once: { marker: join(f.root, 'once'), command: ['sh', f.peerScript('src/other.ts', null, 'export const other = 2;')] },
      onMain: { marker: join(f.root, 'on-main'), command: ['sh', f.peerScript('src/later.ts', null, 'export const later = 3;')] }, cancelMain: 'superseded' });
    const result = f.land(wt);
    expect(result.status, result.stdout).toBe(0);
    const newer = f.remoteMain();
    const landed = f.git(f.remote, ['rev-parse', 'main~1']);
    expect(f.git(f.remote, ['log', '--format=%s', '-1', 'main~1'])).toBe('feat: add feature');
    expect(result.stdout).toMatch(new RegExp(`superseded main's run for ${landed.slice(0, 10)} was cancelled by a newer main push; ${newer.slice(0, 10)} contains it`, 'u'));
    expect(result.stdout).not.toMatch(/ red /u);
    expect(f.read(f.files.gh)).toContain(`head_sha=${newer}`);
    expect(f.read(f.files.receipts)).toMatch(new RegExp(`landed ${landed.slice(0, 10)} on main .*main ci superseded by ${newer.slice(0, 10)}, green`, 'u'));
    expect(f.read(f.files.receipts)).not.toMatch(/MAIN RED/u);
  }, 60_000);

  test('a cancelled main run with nothing newer on main is still red', () => {
    const f = fixture();
    const wt = f.worktree('foo');
    f.commit(wt, 'src/feature.ts', 'export const feature = true;', 'feat: add feature');
    f.state({ once: { marker: join(f.root, 'once'), command: ['sh', f.peerScript('src/other.ts', null, 'export const other = 2;')] }, cancelMain: 'always' });
    const result = f.land(wt);
    expect(result.status, result.stdout).toBe(3);
    expect(result.stdout).not.toMatch(/superseded/u);
    expect(result.stdout).toMatch(new RegExp(`red +main's hosted run is red for ${f.remoteMain().slice(0, 10)}: fix forward now`, 'u'));
    expect(f.read(f.files.receipts)).toMatch(/landed, MAIN RED .*main ci RED: ci run \d+ cancelled/u);
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
    expect(f.read(f.files.receipts)).toMatch(/landed .*; carried; rounds 1; hosted reruns 0;/u);
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

  test('a rebase conflict only in a generated stamp is regenerated for the landed tree, not a stop', () => {
    const f = fixture();
    // gen.mjs here writes the real renderer stamp of the checkout (engine's rendererRevision over committed inputs),
    // so DS1's stamp check after the rebase judges it exactly as in engine.
    const GEN = `import {writeFileSync} from 'node:fs';import {rendererRevision} from '${resolve('scripts/renderer-revision.mjs')}';\n`
      + "writeFileSync('scripts/renderer-revision.json',JSON.stringify({revision:rendererRevision(process.cwd())})+'\\n');\n";
    mkdirSync(join(f.repo, 'scripts'), { recursive: true });
    mkdirSync(join(f.repo, 'src/shared'), { recursive: true });
    writeFileSync(join(f.repo, 'scripts/gen.mjs'), GEN);
    writeFileSync(join(f.repo, 'pnpm-lock.yaml'), "lockfileVersion: '9.0'\n");
    writeFileSync(join(f.repo, 'package.json'), '{"name":"fixture","private":true}\n');
    writeFileSync(join(f.repo, 'src/shared/base.ts'), 'export const base = 1;\n');
    writeFileSync(join(f.repo, 'scripts/renderer-revision.json'), '{}\n');
    f.git(f.repo, ['add', 'scripts', 'pnpm-lock.yaml', 'package.json', 'src/shared']);
    f.git(f.repo, ['commit', '--quiet', '-m', 'chore: stamps']);
    const gen = (cwd: string) => execFileSync(process.execPath, ['scripts/gen.mjs', '--inputs-only'], { cwd, env: f.env });
    gen(f.repo);
    f.git(f.repo, ['commit', '--quiet', '-m', 'chore: stamp', '--', 'scripts/renderer-revision.json']);
    f.git(f.repo, ['push', '--quiet', 'origin', 'main']);
    const wt = f.worktree('foo');
    // The plan adds a new input file: mid-rebase, HEAD's file list would not have it yet.
    writeFileSync(join(wt, 'src/shared/feature.ts'), 'export const feature = true;\n');
    f.git(wt, ['add', 'src/shared/feature.ts']);
    f.git(wt, ['commit', '--quiet', '-m', 'feat: add feature']);
    gen(wt);
    f.git(wt, ['commit', '--quiet', '-m', 'feat: stamp feature', '--', 'scripts/renderer-revision.json']);
    // Main moves mid-landing with its own input and its own regenerated stamp: the stamp line conflicts.
    const peer = join(f.root, 'peer-stamp.sh');
    writeFileSync(peer, `set -e\nunset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_PREFIX GIT_COMMON_DIR\ncd '${f.peer}'\ngit pull --quiet --ff-only origin main\nprintf 'export const other = 2;\\n' > src/shared/other.ts\ngit add src/shared/other.ts\ngit commit --quiet -m 'peer lands'\n'${process.execPath}' scripts/gen.mjs --inputs-only\ngit commit --quiet -m 'peer stamp' -- scripts/renderer-revision.json\ngit push --quiet origin HEAD:main\n`);
    f.state({ once: { marker: join(f.root, 'once'), command: ['sh', peer] } });
    const result = f.land(wt);
    expect(result.status, result.stdout).toBe(0);
    expect(result.stdout).toContain("took main's scripts/renderer-revision.json for a stamp-only conflict");
    expect(result.stdout).toMatch(/stamps\s+regenerated scripts\/renderer-revision\.json into [0-9a-f]{10}/u);
    expect(result.stdout).toMatch(/carried\s+clean rebase onto/u);
    expect(f.git(f.remote, ['log', '--format=%s', '-4', 'main']).split('\n')).toEqual(['feat: add feature', 'peer stamp', 'peer lands', 'chore: stamp']);
    // The stamp-only plan commit emptied out under main's stamp and was dropped; the regenerated stamp joined the tip.
    // The landed stamp is exactly the one gen.mjs makes for the landed tree.
    f.git(wt, ['fetch', '--quiet', 'origin']);
    expect(f.git(wt, ['rev-parse', 'HEAD'])).toBe(f.remoteMain());
    gen(wt);
    expect(f.git(wt, ['status', '--porcelain'])).toBe('');
  }, 90_000);

  test('a modify/delete conflict on a stamp, or a stamp conflict beside a source conflict, still stops', () => {
    const f = fixture();
    mkdirSync(join(f.repo, 'scripts'), { recursive: true });
    writeFileSync(join(f.repo, 'scripts/renderer-revision.json'), '{"revision":"a"}\n');
    f.git(f.repo, ['add', 'scripts']);
    f.git(f.repo, ['commit', '--quiet', '-m', 'chore: stamp']);
    f.git(f.repo, ['push', '--quiet', 'origin', 'main']);
    const wt = f.worktree('foo');
    f.git(wt, ['rm', '--quiet', 'scripts/renderer-revision.json']);
    f.git(wt, ['commit', '--quiet', '-m', 'chore: drop the stamp']);
    f.state({ once: { marker: join(f.root, 'once'), command: ['sh', f.peerScript('scripts/renderer-revision.json', '"a"', '"b"')] } });
    const deleted = f.land(wt);
    expect(deleted.status, deleted.stdout).toBe(1);
    expect(deleted.stdout).toMatch(/conflicts in: scripts\/renderer-revision\.json/u);
    const g = fixture();
    mkdirSync(join(g.repo, 'scripts'), { recursive: true });
    writeFileSync(join(g.repo, 'scripts/renderer-revision.json'), '{"revision":"a"}\n');
    g.git(g.repo, ['add', 'scripts']);
    g.git(g.repo, ['commit', '--quiet', '-m', 'chore: stamp']);
    g.git(g.repo, ['push', '--quiet', 'origin', 'main']);
    const both = g.worktree('bar');
    writeFileSync(join(both, 'scripts/renderer-revision.json'), '{"revision":"plan"}\n');
    g.git(both, ['add', 'scripts/renderer-revision.json']);
    g.edit(both, 'src/shared.ts', 'line5 = 5', 'line5 = 50', 'feat: plan line 5 and stamp');
    const peer = join(g.root, 'peer-both.sh');
    writeFileSync(peer, `set -e\nunset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_PREFIX GIT_COMMON_DIR\ncd '${g.peer}'\ngit pull --quiet --ff-only origin main\nprintf '{"revision":"main"}\\n' > scripts/renderer-revision.json\nsed -i.bak 's/line5 = 5;/line5 = 55;/' src/shared.ts && rm src/shared.ts.bak\ngit add scripts/renderer-revision.json src/shared.ts\ngit commit --quiet -m 'peer lands'\ngit push --quiet origin HEAD:main\n`);
    g.state({ once: { marker: join(g.root, 'once'), command: ['sh', peer] } });
    const mixed = g.land(both);
    expect(mixed.status, mixed.stdout).toBe(1);
    expect(mixed.stdout).toMatch(/conflicts in: .*src\/shared\.ts/u);
    expect(g.git(both, ['status', '--porcelain'])).toBe('');
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

  test('a red pre-push on the plan push stops before any CI wait', () => {
    const f = fixture();
    const wt = f.worktree('foo');
    f.commit(wt, 'src/feature.ts', 'export const feature = true;', 'feat: add feature');
    writeFileSync(f.files.fail, '');
    const result = f.land(wt);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('push of plan/foo');
    expect(f.read(f.files.gh)).toBe('');
  }, 60_000);

  test('refuses the canonical checkout and non-plan branches', () => {
    const f = fixture();
    const canonical = f.land(f.repo);
    expect(canonical.status).toBe(1);
    expect(canonical.stdout).toContain('plan/<slug> branch');
    f.git(f.repo, ['worktree', 'add', '--quiet', '-b', 'feature/x', join(f.repo, '.worktrees', 'x'), 'origin/main']);
    expect(f.land(join(f.repo, '.worktrees', 'x')).stdout).toContain('this checkout is on feature/x');
  }, 60_000);

  test('a commit made while hosted CI runs stops the landing; it never rides along unchecked', () => {
    const f = fixture();
    const wt = f.worktree('foo');
    f.commit(wt, 'src/feature.ts', 'export const feature = true;', 'feat: add feature');
    const before = f.remoteMain();
    f.state({ once: { marker: join(f.root, 'once'), command: ['git', '-C', wt, 'commit', '--quiet', '--allow-empty', '-m', 'sneaky'] } });
    const result = f.land(wt);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('HEAD moved while hosted CI ran');
    expect(f.remoteMain()).toBe(before);
  }, 60_000);

  // LAND-SIMPLIFY LS4 (J258): the local branch's reflog decides who may rewrite the plan branch, and the push
  // carries an explicit lease. No record of land's own is read or written.
  test('a plan branch someone else pushed is refused by git, fetched or not', () => {
    for (const fetched of [false, true]) {
      const f = fixture();
      const wt = f.worktree('foo');
      f.commit(wt, 'src/feature.ts', 'export const feature = true;', 'feat: add feature');
      f.git(f.peer, ['commit', '--quiet', '--allow-empty', '-m', 'someone else']);
      f.git(f.peer, ['push', '--quiet', 'origin', 'HEAD:refs/heads/plan/foo']);
      const theirs = f.git(f.remote, ['rev-parse', 'plan/foo']);
      if (fetched) f.git(wt, ['fetch', '--quiet', 'origin']);
      const result = f.land(wt);
      expect(result.status, `fetched=${fetched}: ${result.stdout}`).toBe(1);
      expect(result.stdout).toContain("which this worktree's branch never reached");
      expect(f.git(f.remote, ['rev-parse', 'plan/foo'])).toBe(theirs);
      expect(f.read(f.files.receipts)).toMatch(/STOP plan push [0-9a-f]{10} refused \(origin has commits this worktree never had\)/u);
    }
  }, 90_000);

  test('the worktree\'s own hand push, then a local rebase, rewrites cleanly and lands', () => {
    const f = fixture();
    const wt = f.worktree('foo');
    f.commit(wt, 'src/feature.ts', 'export const feature = 1;', 'feat: add feature');
    f.git(wt, ['push', '--quiet', 'origin', 'HEAD:refs/heads/plan/foo']);
    f.git(wt, ['commit', '--quiet', '--amend', '-m', 'feat: add feature, amended']);
    const result = f.land(wt);
    expect(result.status, result.stdout).toBe(0);
    expect(result.stdout).toMatch(/replaces its own [0-9a-f]{10} under a lease/u);
    expect(f.git(f.remote, ['log', '--format=%s', '-1', 'main'])).toBe('feat: add feature, amended');
    expect(existsSync(join(f.git(wt, ['rev-parse', '--path-format=absolute', '--git-dir']), 'wildshard-land-tip'))).toBe(false);
  }, 60_000);

  test('a hand push by URL leaves the tracking ref stale; land refreshes it and still lands its own rewrite', () => {
    const f = fixture();
    const wt = f.worktree('foo');
    f.commit(wt, 'src/feature.ts', 'export const feature = 1;', 'feat: add feature');
    f.git(wt, ['push', '--quiet', f.remote, 'HEAD:refs/heads/plan/foo']);
    // Some git versions update the tracking ref for a URL that matches origin's; drop it so the stale case is real.
    spawnSync('git', ['update-ref', '-d', 'refs/remotes/origin/plan/foo'], { cwd: wt, env: f.env });
    f.git(wt, ['commit', '--quiet', '--amend', '-m', 'feat: add feature, amended']);
    const result = f.land(wt);
    expect(result.status, result.stdout).toBe(0);
    expect(f.git(f.remote, ['log', '--format=%s', '-1', 'main'])).toBe('feat: add feature, amended');
  }, 60_000);

  test('a foreign push fetched from a sibling worktree (shared refs) is still refused', () => {
    const f = fixture();
    const wt = f.worktree('foo');
    const sibling = f.worktree('bar');
    f.commit(wt, 'src/feature.ts', 'export const feature = true;', 'feat: add feature');
    f.git(f.peer, ['commit', '--quiet', '--allow-empty', '-m', 'someone else']);
    f.git(f.peer, ['push', '--quiet', 'origin', 'HEAD:refs/heads/plan/foo']);
    const theirs = f.git(f.remote, ['rev-parse', 'plan/foo']);
    f.git(sibling, ['fetch', '--quiet', 'origin']);
    const result = f.land(wt);
    expect(result.status, result.stdout).toBe(1);
    expect(result.stdout).toContain("which this worktree's branch never reached");
    expect(f.git(f.remote, ['rev-parse', 'plan/foo'])).toBe(theirs);
  }, 60_000);

  test('land\'s own earlier push, then a rebase after a red, rewrites under the lease', () => {
    const f = fixture();
    const wt = f.worktree('foo');
    f.commit(wt, 'src/feature.ts', 'export const feature = 1;', 'feat: add feature');
    f.state({ red: { 'plan/foo': { ci: 'tests (1)' } } });
    expect(f.land(wt).status).toBe(1);
    f.state({});
    f.git(wt, ['commit', '--quiet', '--amend', '-m', 'feat: add feature, fixed']);
    const result = f.land(wt);
    expect(result.status, result.stdout).toBe(0);
    expect(f.git(f.remote, ['log', '--format=%s', '-1', 'main'])).toBe('feat: add feature, fixed');
  }, 60_000);

  test('the reflog rule: a foreign tip the local branch once held counts as seen, so land may replace it', () => {
    // As with --force-if-includes, a tip reachable from the local branch's reflog was seen: the agent reset onto their
    // commit, so discarding it is the agent's call. Recorded here so the rule is deliberate (LS4 swapped records for it).
    const f = fixture();
    const wt = f.worktree('foo');
    const base = f.git(wt, ['rev-parse', 'HEAD']);
    f.git(f.peer, ['commit', '--quiet', '--allow-empty', '-m', 'someone else']);
    f.git(f.peer, ['push', '--quiet', 'origin', 'HEAD:refs/heads/plan/foo']);
    const theirs = f.git(f.remote, ['rev-parse', 'plan/foo']);
    f.git(wt, ['fetch', '--quiet', 'origin']);
    f.git(wt, ['reset', '--quiet', '--hard', theirs]);
    f.git(wt, ['reset', '--quiet', '--hard', base]);
    f.commit(wt, 'src/feature.ts', 'export const feature = true;', 'feat: add feature');
    const result = f.land(wt);
    expect(result.status, result.stdout).toBe(0);
    expect(f.git(f.remote, ['rev-parse', 'plan/foo'])).not.toBe(theirs);
  }, 60_000);

  test('J206 review: a commit that slips in during the rebase or the stamp regeneration never rides to main', () => {
    const f = fixture();
    const wt = f.worktree('foo');
    // This plan's gen.mjs commits a file of its own when land regenerates the stamps after the rebase.
    f.commit(wt, 'scripts/gen.mjs', "import {execSync} from 'node:child_process';import {writeFileSync} from 'node:fs';writeFileSync('src/sneak.ts','export {};\\n');execSync('git add src/sneak.ts && git commit -q -m sneak');", 'build: a generator');
    const tested = f.commit(wt, 'src/feature.ts', 'export const feature = true;', 'feat: add feature');
    f.state({ once: { marker: join(f.root, 'once'), command: ['sh', f.peerScript('src/other.ts', null, 'export const other = 2;')] } });
    const result = f.land(wt);
    expect(result.status, result.stdout).toBe(1);
    expect(result.stdout).toMatch(/is not main [0-9a-f]{10} plus the hosted-green [0-9a-f]{10} \(stamps aside\)/u);
    // Main holds the peer's commit and nothing of this plan, the sneaked file least of all.
    expect(f.git(f.remote, ['ls-tree', '--name-only', 'main', 'src/']).split('\n')).toEqual(expect.arrayContaining(['src/other.ts']));
    expect(f.git(f.remote, ['ls-tree', '--name-only', 'main', 'src/'])).not.toMatch(/sneak|feature/u);
    expect(f.git(f.remote, ['rev-parse', 'plan/foo'])).toBe(tested);
    expect(f.read(f.files.receipts)).toMatch(/STOP rebased [0-9a-f]{10} is not main/u);
  }, 60_000);

  test('a harness change carries too: J249 has no harness rule, main\'s own run checks it', () => {
    const f = fixture();
    const wt = f.worktree('foo');
    f.commit(wt, 'vitest.config.ts', 'export default {};', 'test: add a vitest config');
    f.state({ once: { marker: join(f.root, 'once'), command: ['sh', f.peerScript('src/other.ts', null, 'export const other = 2;')] } });
    const result = f.land(wt);
    expect(result.status, result.stdout).toBe(0);
    expect(result.stdout).toMatch(/carried\s+clean rebase onto/u);
    expect(f.read(f.files.receipts)).toMatch(/landed .*; carried; rounds 1; hosted reruns 0;/u);
  }, 60_000);

  test('a plan that changes hosted CI carries after a clean rebase too (J249)', () => {
    const f = fixture();
    const wt = f.worktree('foo');
    f.commit(wt, '.github/workflows/x.yml', 'name: x', 'ci: add x');
    f.state({ once: { marker: join(f.root, 'once'), command: ['sh', f.peerScript('src/other.ts', null, 'export const other = 2;')] } });
    const result = f.land(wt);
    expect(result.status, result.stdout).toBe(0);
    expect(result.stdout).toMatch(/carried\s+clean rebase onto/u);
    expect(f.read(f.files.receipts)).toMatch(/landed .*; carried; rounds 1; hosted reruns 0;/u);
  }, 60_000);

  test('two worktrees land at once with no shared lock; both reach main', async () => {
    const f = fixture();
    const foo = f.worktree('foo'), bar = f.worktree('bar');
    f.commit(foo, 'src/foo.ts', 'export const foo = 1;', 'feat: foo');
    f.commit(bar, 'src/bar.ts', 'export const bar = 1;', 'feat: bar');
    const [one, two] = await Promise.all([f.landAsync(foo), f.landAsync(bar)]);
    expect(one.code, one.stdout).toBe(0);
    expect(two.code, two.stdout).toBe(0);
    const subjects = f.git(f.remote, ['log', '--format=%s', 'main']).split('\n');
    expect(subjects).toEqual(expect.arrayContaining(['feat: foo', 'feat: bar', 'seed']));
    expect(subjects).toHaveLength(3);
  }, 60_000);
});

describe('failedJobs', () => {
  test('splits non-blocking quarantine jobs from blocking reds', () => {
    const jobs = [['tests (4)', 'failure'], ['quarantine (1)', 'failure'], ['quarantine', 'timed_out'], ['static', 'success'], ['e2e', 'cancelled'], ['quarantine-check', 'failure']]
      .map(([name, conclusion]) => ({ name, conclusion }));
    expect(failedJobs({ jobs })).toEqual({ blocking: ['tests (4) (failure)', 'e2e (cancelled)', 'quarantine-check (failure)'], nonblocking: ['quarantine (1) (failure)', 'quarantine (timed_out)'] });
    expect(failedJobs(null)).toEqual({ blocking: [], nonblocking: [] });
  });
});

describe('shaVerdict', () => {
  const sha = 'a'.repeat(40);
  const run = (name: string, id: number, status: string, conclusion: string | null) => ({ id, name, event: 'push', head_sha: sha, head_branch: 'plan/x', status, conclusion });
  test('needs the one ci workflow complete; its newest run decides (CI-JOB-PACKING: ring-1 is part of ci)', () => {
    expect(shaVerdict({ workflow_runs: [run('ci', 1, 'completed', 'success')] }, sha).state).toBe('green');
    expect(shaVerdict({ workflow_runs: [run('ci', 1, 'in_progress', null)] }, sha).state).toBe('pending');
    expect(shaVerdict({ workflow_runs: [run('ci', 1, 'completed', 'failure'), run('ci', 2, 'completed', 'success')] }, sha).state).toBe('green');
    expect(shaVerdict({ workflow_runs: [run('ci', 2, 'completed', 'cancelled'), run('ring-1', 3, 'completed', 'success')] }, sha).state).toBe('red');
    expect(shaVerdict({ workflow_runs: [{ ...run('ci', 2, 'completed', 'success'), event: 'pull_request' }] }, sha).state).toBe('pending');
  });
});

describe('main reuses the exact SHA\'s green plan-branch run (no double run)', () => {
  const sha = 'b'.repeat(40);
  const ciJobs = ['changes', 'static', 'plan', 'e2e', 'tests (1)', 'tests (2)'].map(name => ({ name, status: 'completed', conclusion: 'success' }));
  const packedStep = (conclusion = 'success') => [{ name: "Run this job's packed share", status: 'completed', conclusion }];
  const withApi = async (runs: unknown[], jobs: unknown[], check: (api: string) => Promise<void>) => {
    const server = createServer((request, response) => {
      response.setHeader('content-type', 'application/json');
      const url = request.url ?? '';
      response.end(JSON.stringify(url.includes('/jobs') ? { jobs } : url.includes(`head_sha=${sha}`) ? { workflow_runs: runs } : { workflow_runs: [] }));
    });
    await new Promise<void>(done => { server.listen(0, '127.0.0.1', () => { done(); }); });
    const address = server.address();
    try { if (address !== null && typeof address !== 'string') await check(`http://127.0.0.1:${address.port}`); } finally { server.close(); }
  };
  const env = (api: string, extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => ({ GITHUB_EVENT_NAME: 'push', GITHUB_REF: 'refs/heads/main', GITHUB_SHA: sha, GITHUB_REPOSITORY: 'project-wildshard/engine', GH_TOKEN: 'fixture', GITHUB_RUN_ID: '9', GITHUB_API_URL: api, ...extra });
  const run = (extra: Record<string, unknown> = {}) => ({ id: 5, head_sha: sha, event: 'push', status: 'completed', conclusion: 'success', head_branch: 'plan/foo', head_repository: { full_name: 'project-wildshard/engine' }, run_started_at: '2026-11-10T20:00:00Z', ...extra });
  const steady: { scope: (at: number) => string; now: number } = { scope: () => 'same', now: Date.parse('2026-11-10T20:30:00Z') };
  const reused = async (runs: unknown[], jobs: unknown[], extra: NodeJS.ProcessEnv = {}, options = steady) => {
    let result = { reused: false, run: null as number | null, reason: '' };
    await withApi(runs, jobs, async api => { result = await exactBranchProof('ci.yml', env(api, extra), options); });
    return result;
  };
  test('a complete green plan/<slug> push run of this exact SHA is reused on main', async () => {
    expect(await reused([run()], ciJobs)).toMatchObject({ reused: true, run: 5 });
    // CI-JOB-PACKING: a packed run is its `tests (N)` shares; static, plan, e2e and Ring 1's products run inside them.
    const packed = ['tests (1)', 'tests (2)', 'tests (3)'].map(name => ({ name, status: 'completed', conclusion: 'success', steps: packedStep() }));
    expect(await reused([run()], packed)).toMatchObject({ reused: true, run: 5 });
    // A share that reused or skipped its packed step proves nothing, even when the job is green.
    expect((await reused([run()], packed.map(job => (job.name === 'tests (2)' ? { ...job, steps: packedStep('skipped') } : job)))).reused).toBe(false);
    expect((await reused([run()], packed.map(job => (job.name === 'tests (2)' ? { ...job, conclusion: 'skipped' } : job)))).reused).toBe(false);
    expect((await reused([run()], [{ name: 'quarantine', status: 'completed', conclusion: 'success' }])).reused).toBe(false);
    // A legacy job in the list makes it the older shape, which needs all of them.
    expect((await reused([run()], [...packed, { name: 'static', status: 'completed', conclusion: 'success' }])).reused).toBe(false);
  });
  test('anything less runs main in full', async () => {
    for (const extra of [{ head_branch: 'main' }, { head_branch: 'feature/x' }, { conclusion: 'failure' }, { head_sha: 'c'.repeat(40) }, { head_repository: { full_name: 'fork/engine' } }, { id: 9 }, { run_started_at: 'never' }]) expect((await reused([run(extra)], ciJobs)).reused, JSON.stringify(extra)).toBe(false);
    expect((await reused([run()], ciJobs, { GITHUB_REF: 'refs/heads/plan/foo' })).reused).toBe(false);
    // A docs-only or skip-propagated green run: the blocking jobs did not all run.
    expect((await reused([run()], ciJobs.map(job => (job.name.startsWith('tests') ? { ...job, conclusion: 'skipped' } : job)))).reused).toBe(false);
    expect((await reused([run()], ciJobs.filter(job => !job.name.startsWith('tests')))).reused).toBe(false);
    expect((await reused([run()], ciJobs.filter(job => job.name !== 'e2e'))).reused).toBe(false);
    // The suite's exclusions changed since the branch run started (a quarantine or lift deadline passed).
    expect((await reused([run()], ciJobs, {}, { scope: (at: number) => String(at > Date.parse('2026-11-10T20:10:00Z')), now: steady.now })).reason).toMatch(/predates a quarantine or lift-pending change/u);
    expect((await exactBranchProof('ci.yml', env('http://127.0.0.1:9'), steady)).reused).toBe(false);
  });
  test('main pushes get one concurrency group per SHA, so lands a minute apart never cancel each other\'s main run', () => {
    const text = readFileSync('.github/workflows/ci.yml', 'utf8');
    const top = text.split('\njobs:\n')[0] ?? '';
    const template = /^ {2}group: (.+)$/mu.exec(top)?.[1];
    const cancel = /^ {2}cancel-in-progress: (.+)$/mu.exec(top)?.[1];
    if (template === undefined || cancel === undefined) throw new Error('ci.yml has no top-level concurrency group');
    type Context = { event_name: string; ref: string; sha: string; run_id: string };
    const evaluate = (source: string, github: Context): unknown => source.replaceAll(/\$\{\{(.*?)\}\}/gu, (_match: string, expression: string) =>
      String(runInNewContext(expression.replaceAll(/\bstartsWith\(/gu, 'starts(').replaceAll("'", '"').replaceAll('==', '==='), {
        github, starts: (value: string, prefix: string) => value.startsWith(prefix), format: (pattern: string, argument: string) => pattern.replace('{0}', argument),
      })));
    const main = { event_name: 'push', ref: 'refs/heads/main', sha: 'a'.repeat(40), run_id: '1' };
    const next = { ...main, sha: 'b'.repeat(40), run_id: '2' };
    expect(evaluate(template, main)).not.toBe(evaluate(template, next));
    expect(evaluate(cancel, main)).toBe('false');
    // A plan branch keeps one group, and its newer push cancels the older run.
    const plan = { ...main, ref: 'refs/heads/plan/foo' };
    expect(evaluate(template, plan)).toBe(evaluate(template, { ...plan, sha: next.sha, run_id: '2' }));
    expect(evaluate(cancel, plan)).toBe('true');
  });

  test('ci runs on plan/** pushes; every job gates itself on the reuse check, and ring-1 is gone (CI-JOB-PACKING)', () => {
    const text = readFileSync('.github/workflows/ci.yml', 'utf8');
    expect(text).toMatch(/push:\n {4}branches: \[main, 'plan\/\*\*'\]/u);
    expect(text).toContain("startsWith(github.ref, 'refs/heads/plan/')");
    expect(existsSync('.github/workflows/ring-1.yml')).toBe(false);
    expect(readFileSync('.github/workflows/engine-boundaries.yml', 'utf8')).not.toMatch(/^ {2}push:/mu);
    const jobs = new Map([...text.slice(text.indexOf('\njobs:')).matchAll(/^ {2}([a-z0-9-]+):\n((?: {4}.*\n|\n)*)/gmu)].map(([, name, body]) => [name, body ?? '']));
    expect([...jobs.keys()]).toEqual(['tests', 'timings', 'quarantine']);
    // LS2: the one bookkeeping job saves main's measured timings after the tests; it never decides the run's verdict.
    const timings = jobs.get('timings') ?? '';
    jobs.delete('timings');
    expect(timings).toMatch(/^ {4}needs: tests$/mu);
    expect(timings).toMatch(/^ {4}continue-on-error: true$/mu);
    expect(timings).toContain("github.ref == 'refs/heads/main'");
    expect(timings).not.toMatch(/ci-pack|vitest|test-quarantine/u);
    for (const [name, body] of jobs) {
      // No job waits on another, and none is skipped wholesale: a failed reuse check is a red job, never a false green.
      expect(body, name).not.toMatch(/^ {4}(?:if|needs):/mu);
      const steps = body.slice(body.indexOf('    steps:\n')).split(/^ {6}- /mu).slice(1);
      const reuse = steps.findIndex(step => step.includes('node scripts/ci-exact-reuse.mjs ci.yml'));
      expect(reuse, name).toBeGreaterThan(0);
      const work = steps.filter(step => /scripts\/(?:ci-pack|test-quarantine)\.mjs --(?:jobs|shard)/u.test(step));
      expect(work.length, name).toBe(1);
      expect(work[0], name).toMatch(/if: steps\.code\.outputs\.run == 'true'/u);
      const code = steps.find(step => step.startsWith('id: code')) ?? '';
      expect(code, name).toContain("steps.reuse.outputs.reused != 'true' && steps.paths.outputs.docs != 'true'");
    }
    expect(jobs.get('tests')).toContain("name: Run this job's packed share");
    expect(jobs.get('tests')).toContain('--units=static,e2e,plan-proofs,tests,products,boundaries');
  });
});
