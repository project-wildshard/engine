// J240 / DEV-SPEED DS21: scripts/land.mjs against real git. A bare repo stands
// in for GitHub (with protect-main's no-force, no-delete rule as an update
// hook), a post-receive hook records every pushed tip, and a fake `gh` on PATH
// answers Actions queries only for SHAs that were really pushed.
// oxlint-disable-next-line import/no-nodejs-modules -- Real git repositories, hooks and the land CLI.
import { execFile, execFileSync, spawn, spawnSync } from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- Fixture repositories stay in the repository scratch root.
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- A local Actions API double for the main-run reuse check.
import { createServer } from 'node:http';
// oxlint-disable-next-line import/no-nodejs-modules -- Evaluate ci.yml's real concurrency-key expressions.
import { runInNewContext } from 'node:vm';
// oxlint-disable-next-line import/no-nodejs-modules -- Fixture paths.
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { exactBranchProof } from '../scripts/ci-exact-reuse.mjs';
import { packUnits, runUnits } from '../scripts/ci-pack.mjs';
import { failedJobs, flakyFiles, mainPushArgs, parseArgs, prePushCause, quarantineFile, shaVerdict, STAMPS, strikePlans } from '../scripts/land.mjs';
const LAND = resolve('scripts/land.mjs');
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

const FAKE_GH = `#!/usr/bin/env node
// Answers the two Actions queries land makes, from the remote's pushed-tip log.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
const state = JSON.parse(fs.readFileSync(process.env.FAKE_GH_STATE, 'utf8'));
fs.appendFileSync(state.log, process.argv.slice(2).join(' ') + '\\n');
// TS10: \`run download\` writes the planted flaky file's failed shard report; \`run rerun\` turns the red run green (or not).
const args = process.argv.slice(2);
if (args[0] === 'run' && args[1] === 'download') {
  const dir = args[args.indexOf('-D') + 1];
  if (state.flaky !== undefined) {
    for (const job of state.flaky.jobs ?? [1]) {
      fs.mkdirSync(dir + '/engine-ci-' + job + '/engine-ci', { recursive: true });
      fs.mkdirSync(dir + '/engine-ci-' + job + '/ci-pack', { recursive: true });
      fs.writeFileSync(dir + '/engine-ci-' + job + '/ci-pack/job-' + job + '.json', JSON.stringify({ pinsCode: 0, units: [{ name: 'shard:' + job, blocking: true, code: 1 }, { name: 'static', blocking: true, code: state.flaky.staticRed === true ? 1 : 0 }] }));
      fs.writeFileSync(dir + '/engine-ci-' + job + '/engine-ci/shard-' + job + '-ordinary.json', JSON.stringify({ files: [{ file: state.flaky.file, state: 'failed', durationMs: 900 }, { file: 'test/fine.test.ts', state: 'passed', durationMs: 10 }] }));
      fs.writeFileSync(dir + '/engine-ci-' + job + '/engine-ci/shard-' + job + '-wall.json', JSON.stringify({ overBudget: false }));
    }
  }
  process.exit(0);
}
if (args[0] === 'run' && args[1] === 'rerun') {
  state.reran = [...(state.reran ?? []), Number(args[2])];
  if (state.flaky?.stillRed !== true) state.red = {};
  fs.writeFileSync(process.env.FAKE_GH_STATE, JSON.stringify(state));
  process.exit(0);
}
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
    return { id: runId(sha, name), run_attempt: (state.reran ?? []).includes(runId(sha, name)) ? 2 : 1, name, event: 'push', head_sha: sha, head_branch: branch, status: 'completed', conclusion: cancelled(branch) ? 'cancelled' : red === undefined ? 'success' : 'failure', html_url: '' };
  }));
  process.stdout.write(JSON.stringify({ workflow_runs }));
} else if (/actions\\/runs\\/\\d+$/.test(path)) {
  const id = Number(/runs\\/(\\d+)$/.exec(path)?.[1]);
  const red = Object.values(state.red ?? {}).some(names => Object.keys(names).includes(id % 10 === 1 ? 'ci' : 'ring-1'));
  process.stdout.write(JSON.stringify({ id, status: 'completed', conclusion: red ? 'failure' : 'success', run_attempt: (state.reran ?? []).includes(id) ? 2 : 1 }));
} else {
  const id = Number(/runs\\/(\\d+)\\/jobs/.exec(path)?.[1]);
  const jobs = [];
  for (const [branch, names] of Object.entries(state.red ?? {})) for (const [name, job] of Object.entries(names)) jobs.push({ name: job, conclusion: 'failure', run: name, branch });
  process.stdout.write(JSON.stringify({ jobs: jobs.filter(job => id % 10 === (job.run === 'ci' ? 1 : 2)).map(({ name, conclusion }) => ({ name, conclusion, steps: [{ name: "Run this job's packed share", conclusion: 'failure' }, ...(state.flaky?.wallRed === true ? [{ name: "Record every shard's wall-budget verdict", conclusion: 'failure' }] : [])] })) }));
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
    WS_LAND_REPO: 'project-wildshard/fixture', WS_FLAKE_STRIKES: join(root, 'strikes.jsonl'), WS_LANE_RECEIPTS: files.receipts, WS_LANE_NAME: 'fixture-lane', HERDR_PANE_ID: 'w0:p9',
    WS_STORE_USERS: join(root, 'store-users'), WS_STORE_RESERVATION: join(root, 'store-maintenance.lock'),
  };
  for (const key of Object.keys(env)) if (key.startsWith('GIT_') && !['GIT_CONFIG_GLOBAL', 'GIT_CONFIG_NOSYSTEM', 'GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL'].includes(key)) Reflect.deleteProperty(env, key);
  const git = (cwd: string, args: readonly string[]): string => execFileSync('git', args, { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const write = (path: string, text: string, mode?: number) => { mkdirSync(resolve(path, '..'), { recursive: true }); writeFileSync(path, text); if (mode !== undefined) chmodSync(path, mode); };

  git(root, ['init', '--quiet', '--bare', '--initial-branch=main', remote]);
  write(join(remote, 'hooks/update'), PROTECT_MAIN, 0o755);
  write(join(remote, 'hooks/post-receive'), POST_RECEIVE, 0o755);
  write(join(bin, 'gh'), FAKE_GH, 0o755);
  // A fixture never runs the real pnpm: from ./tmp it walks up to this checkout's workspace, and on CI (ci=true turns the
  // global store off) its install purged and relaid the live node_modules under the running suite (GVS G9).
  write(join(bin, 'pnpm'), '#!/bin/sh\nexit 0\n', 0o755);
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
  // Most tests look at the worktree after landing, so they keep it (the LS5 tests pass no flags).
  const KEPT = ['--keep'];
  const land = (cwd: string, args: readonly string[] = KEPT) => spawnSync(process.execPath, [LAND, '--poll=0.05', '--appear=0.05', ...args], { cwd, env, encoding: 'utf8', timeout: 60_000 });
  const landAsync = (cwd: string) => new Promise<{ code: number | null; stdout: string }>(done => {
    const child = execFile(process.execPath, [LAND, '--poll=0.05', '--appear=0.05', ...KEPT], { cwd, env, encoding: 'utf8', timeout: 60_000 }, (error, stdout) => { done({ code: error === null ? 0 : (typeof error.code === 'number' ? error.code : 1), stdout }); });
    child.stdin?.end();
  });
  const remoteMain = () => git(remote, ['rev-parse', 'main']);
  const read = (path: string) => (existsSync(path) ? readFileSync(path, 'utf8') : '');
  return { root, remote, repo, peer, env, files, git, worktree, commit, edit, peerScript, state, land, landAsync, remoteMain, read };
}

// DS22: a stand-in for gen:inputs. It writes the bytes stamp from the tree's own src/*.ts files, so a commit or a rebase
// that adds one makes the committed stamp stale, as a new public/assets file does for the real one.
const STAMP = 'src/client/game/boot/bytes.generated.ts';
const GEN_STAMPS = "import {mkdirSync,readdirSync,statSync,writeFileSync} from 'node:fs';"
  + "const rows=readdirSync('src').filter(name=>name.endsWith('.ts')).sort().map(name=>name+':'+statSync('src/'+name).size);"
  + "mkdirSync('src/client/game/boot',{recursive:true});writeFileSync('src/client/game/boot/bytes.generated.ts','export const bytes = '+JSON.stringify(rows)+';\\n');";

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
    expect(f.read(f.files.receipts)).toMatch(new RegExp(`^\\d\\d:\\d\\d UTC fixture-lane land plan/foo landed ${tip.slice(0, 10)} on main .*; exact; rounds 1;`, 'mu'));
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
    expect(parseArgs([])).toEqual({ pollSeconds: 30, timeoutMinutes: 60, appearMinutes: 5, rounds: 5, keep: false });
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

  test('a red pre-push on the plan push stops before any CI wait', () => {
    const f = fixture();
    const wt = f.worktree('foo');
    f.commit(wt, 'src/feature.ts', 'export const feature = true;', 'feat: add feature');
    writeFileSync(f.files.fail, '');
    const result = f.land(wt);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('push of plan/foo');
    expect(f.read(f.files.gh)).toBe('');
    // DS22: the receipt names the pre-push's own cause, not a bare "pre-push red".
    expect(f.read(f.files.receipts)).toMatch(/STOP plan push [0-9a-f]{10} refused by the pre-push: pre-push: planted red check$/mu);
  }, 60_000);

  test('DS22: a dirty bytes.generated.ts is regenerated after the rebase, committed on the plan branch, and lands', () => {
    const f = fixture();
    const wt = f.worktree('foo');
    f.commit(wt, 'scripts/gen.mjs', GEN_STAMPS, 'build: a stamp generator');
    const gen = () => execFileSync(process.execPath, ['scripts/gen.mjs', '--inputs-only'], { cwd: wt, env: f.env });
    gen();
    f.git(wt, ['add', STAMP]);
    f.git(wt, ['commit', '--quiet', '-m', 'chore: stamps']);
    f.commit(wt, 'src/feature.ts', 'export const feature = true;\n', 'feat: add feature');
    gen();
    expect(f.git(wt, ['status', '--porcelain'])).toBe(`M ${STAMP}`);
    // Main moves before land starts, so the stamp land commits must count main's new file as well as the plan's.
    execFileSync('sh', [f.peerScript('src/other.ts', null, 'export const other = 2;')], { env: f.env });
    const result = f.land(wt);
    expect(result.status, result.stdout).toBe(0);
    expect(result.stdout).toMatch(/rebased .*\n.*stamps +committed src\/client\/game\/boot\/bytes\.generated\.ts/u);
    const [subject = '', ...rest] = f.git(f.remote, ['log', '--format=%B', '-1', 'main']).split('\n');
    expect(subject).toBe('chore(gen): regenerate boot stamps');
    // The real commit-msg rule passes it, so land's commit goes through engine's own hook.
    const verdict = execFileSync(process.execPath, ['--input-type=module', '-e',
      `import {validate} from ${JSON.stringify(resolve('.githooks/check-commit-message.mjs'))};process.stdout.write(String(validate(${JSON.stringify([subject, ...rest].join('\n'))})));`], { encoding: 'utf8' });
    expect(verdict).toBe('null');
    expect(f.git(f.remote, ['diff', '--name-only', 'main^', 'main'])).toBe(STAMP);
    const stamp = f.git(f.remote, ['show', `main:${STAMP}`]);
    expect(stamp).toContain('feature.ts:');
    expect(stamp).toContain('other.ts:');
    expect(f.git(wt, ['status', '--porcelain'])).toBe('');
    // One plan push and one main push: no refusal on the way.
    expect(prepushLines(f)).toHaveLength(2);
    expect(f.read(f.files.receipts)).toMatch(/plan\/foo stamps committed [0-9a-f]{10}: src\/client\/game\/boot\/bytes\.generated\.ts/u);
    expect(STAMPS).toContain(STAMP);
  }, 60_000);

  test('DS22: an untracked file outside the pin set stops land before the gate, naming each path and its fix', () => {
    const f = fixture();
    const wt = f.worktree('foo');
    f.commit(wt, 'src/feature.ts', 'export const feature = true;', 'feat: add feature');
    writeFileSync(join(wt, 'stray.txt'), 'mine');
    writeFileSync(join(wt, 'src/a.ts'), 'export const a = 2;\n');
    const began = Date.now();
    const result = f.land(wt);
    expect(result.status, result.stdout).toBe(1);
    expect(Date.now() - began).toBeLessThan(15_000);
    expect(result.stdout).toMatch(/land STOP .*not clean/u);
    expect(result.stdout).toMatch(/\?\? stray\.txt: untracked: commit it/u);
    expect(result.stdout).toMatch(/ M src\/a\.ts: uncommitted change: commit it/u);
    // The gate never ran and nothing left this machine.
    expect(f.read(f.files.prepush)).toBe('');
    expect(f.read(f.files.gh)).toBe('');
    expect(spawnSync('git', ['rev-parse', '--verify', '--quiet', 'refs/heads/plan/foo'], { cwd: f.remote, env: f.env }).status).not.toBe(0);
    expect(f.read(f.files.receipts)).toMatch(/STOP tree not clean before the gate: src\/a\.ts, stray\.txt$/mu);
    expect(readFileSync(join(wt, 'stray.txt'), 'utf8')).toBe('mine');
  }, 60_000);

  test('DS22: the pre-push cause, read from its output', () => {
    expect(prePushCause('  - lint RED in 3.0 s\nerror: failed to push some refs to \'x\'\n')).toBe('lint RED in 3.0 s');
    expect(prePushCause('file:///x/run-checks.mjs:63\nError: Push target requires a clean checked tree; enqueue a committed immutable checkout\n    at capturePushTree (x)\nerror: failed to push some refs to \'x\'\n'))
      .toBe('Push target requires a clean checked tree; enqueue a committed immutable checkout');
    expect(prePushCause('To /remote.git\n!\trefs/heads/plan/x:refs/heads/plan/x\t[remote rejected] (hook declined)\nDone\nerror: failed to push some refs to \'x\'\n'))
      .toBe('!\trefs/heads/plan/x:refs/heads/plan/x\t[remote rejected] (hook declined)');
    // A passing check's logged Error never outranks the check that went RED.
    expect(prePushCause('  - tests green in 9 s\nError: expected in a passing test\n  - lint RED in 3.0 s\n')).toBe('lint RED in 3.0 s');
    expect(prePushCause('')).toBe('no output');
  });

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

  test('LS1: land runs no generator after the rebase, so a plan\'s gen.mjs can\'t slip a commit onto main', () => {
    const f = fixture();
    const wt = f.worktree('foo');
    // Before LS1 land ran this plan's gen.mjs after the rebase to regenerate the stamps; this one would commit a file. It
    // sneaks only once hosted CI has been asked (the marker), so DS22's up-front gen:inputs, before the gate, is clean.
    const marker = join(f.root, 'once');
    f.commit(wt, 'scripts/gen.mjs', `import {execSync} from 'node:child_process';import {existsSync,writeFileSync} from 'node:fs';if(existsSync(${JSON.stringify(marker)})){writeFileSync('src/sneak.ts','export {};\\n');execSync('git add src/sneak.ts && git commit -q -m sneak');}`, 'build: a generator');
    f.commit(wt, 'src/feature.ts', 'export const feature = true;', 'feat: add feature');
    f.state({ once: { marker: join(f.root, 'once'), command: ['sh', f.peerScript('src/other.ts', null, 'export const other = 2;')] } });
    const result = f.land(wt);
    expect(result.status, result.stdout).toBe(0);
    const main = f.git(f.remote, ['ls-tree', '--name-only', 'main', 'src/']).split('\n');
    expect(main).toEqual(expect.arrayContaining(['src/other.ts', 'src/feature.ts']));
    expect(main).not.toContain('src/sneak.ts');
  }, 60_000);

  test('DS22: a gen:inputs that commits on its own stops land before the gate; land commits only the stamps', () => {
    const f = fixture();
    const wt = f.worktree('foo');
    f.commit(wt, 'scripts/gen.mjs', "import {execSync} from 'node:child_process';import {writeFileSync} from 'node:fs';writeFileSync('src/sneak.ts','export {};\\n');execSync('git add src/sneak.ts && git commit -q -m sneak');", 'build: a generator');
    f.commit(wt, 'src/feature.ts', 'export const feature = true;', 'feat: add feature');
    const result = f.land(wt);
    expect(result.status, result.stdout).toBe(1);
    expect(result.stdout).toMatch(/land STOP scripts\/gen\.mjs --inputs-only made a commit/u);
    expect(f.read(f.files.prepush)).toBe('');
    expect(f.git(f.remote, ['ls-tree', '--name-only', 'main', 'src/'])).not.toMatch(/sneak|feature/u);
  }, 60_000);

  test('J206 review: a commit that slips in during the rebase never rides to main (verifyReplay)', () => {
    const f = fixture();
    const wt = f.worktree('foo');
    const tested = f.commit(wt, 'src/feature.ts', 'export const feature = true;', 'feat: add feature');
    // git runs post-rewrite after land's rebase: this one commits a file of its own on top of the rebased plan.
    writeFileSync(join(f.root, 'hooks/post-rewrite'), '#!/bin/sh\n[ "$1" = rebase ] || exit 0\nprintf "export {};\\n" > src/sneak.ts\ngit add src/sneak.ts\ngit commit -q -m sneak\n');
    chmodSync(join(f.root, 'hooks/post-rewrite'), 0o755);
    f.state({ once: { marker: join(f.root, 'once'), command: ['sh', f.peerScript('src/other.ts', null, 'export const other = 2;')] } });
    const result = f.land(wt);
    expect(result.status, result.stdout).toBe(1);
    expect(result.stdout).toMatch(/is not main [0-9a-f]{10} plus the hosted-green [0-9a-f]{10}: a commit or edit came in/u);
    expect(f.git(f.remote, ['ls-tree', '--name-only', 'main', 'src/'])).not.toMatch(/sneak|feature/u);
    expect(f.git(f.remote, ['rev-parse', 'plan/foo'])).toBe(tested);
    expect(f.read(f.files.receipts)).toMatch(/STOP rebased [0-9a-f]{10} is not main/u);
  }, 60_000);

  test('GVS G9: a fixture resolves pnpm to its own fake, never the real one that would reinstall this checkout', () => {
    const f = fixture();
    const found = execFileSync('sh', ['-c', 'command -v pnpm'], { cwd: f.repo, env: f.env, encoding: 'utf8' }).trim();
    expect(found).toBe(join(f.root, 'bin/pnpm'));
  });

  test('a rebase that brings in a lockfile change installs before the pushes; one that does not, does not', () => {
    const f = fixture();
    // A fake pnpm on the fixture's PATH logs each call, so the test sees exactly what land runs.
    const calls = join(f.root, 'pnpm-calls.log');
    writeFileSync(join(f.root, 'bin/pnpm'), `#!/bin/sh\necho "$*" >> '${calls}'\n`);
    chmodSync(join(f.root, 'bin/pnpm'), 0o755);
    const wt = f.worktree('foo');
    f.commit(wt, 'src/feature.ts', 'export const feature = true;', 'feat: add feature');
    f.state({ once: { marker: join(f.root, 'once'), command: ['sh', f.peerScript('pnpm-lock.yaml', null, 'lockfile with wire')] } });
    const result = f.land(wt);
    expect(result.status, result.stdout).toBe(0);
    expect(result.stdout).toMatch(/install\s+pnpm-lock\.yaml changed in the rebase; pnpm install --frozen-lockfile/u);
    expect(f.read(calls).trim().split('\n')).toEqual(['install --frozen-lockfile --config.confirmModulesPurge=false']);
    const g = fixture();
    writeFileSync(join(g.root, 'bin/pnpm'), `#!/bin/sh\necho "$*" >> '${calls}.g'\n`);
    chmodSync(join(g.root, 'bin/pnpm'), 0o755);
    const plain = g.worktree('bar');
    g.commit(plain, 'src/feature.ts', 'export const feature = true;', 'feat: add feature');
    g.state({ once: { marker: join(g.root, 'once'), command: ['sh', g.peerScript('src/other.ts', null, 'export const other = 2;')] } });
    const quiet = g.land(plain);
    expect(quiet.status, quiet.stdout).toBe(0);
    expect(quiet.stdout).not.toMatch(/frozen-lockfile/u);
    expect(existsSync(`${calls}.g`)).toBe(false);
  }, 90_000);

  test('GVS G9/G10: the rebase install survives a layout flip without a TTY, announces itself, and waits out a store prune', async () => {
    const f = fixture();
    const calls = join(f.root, 'pnpm-calls.log'), users = join(f.root, 'store-users');
    // The fake pnpm logs its arguments and whether land announced it in store-users/ while it ran.
    writeFileSync(join(f.root, 'bin/pnpm'), `#!/bin/sh\necho "$* users=$(ls '${users}' | wc -l | tr -d ' ')" >> '${calls}'\n`);
    chmodSync(join(f.root, 'bin/pnpm'), 0o755);
    const wt = f.worktree('foo');
    f.commit(wt, 'src/feature.ts', 'export const feature = true;', 'feat: add feature');
    f.state({ once: { marker: join(f.root, 'once'), command: ['sh', f.peerScript('pnpm-lock.yaml', null, 'lockfile with wire')] } });
    const result = f.land(wt);
    expect(result.status, result.stdout).toBe(0);
    expect(f.read(calls).trim().split('\n')).toEqual(['install --frozen-lockfile --config.confirmModulesPurge=false users=1']);
    expect(readdirSync(users)).toEqual([]);
    // A prune holds the store: land stops before installing, and says why.
    const g = fixture();
    writeFileSync(join(g.root, 'bin/pnpm'), `#!/bin/sh\necho "$*" >> '${calls}.g'\n`);
    chmodSync(join(g.root, 'bin/pnpm'), 0o755);
    const prune = spawn('python3', ['-c', 'import fcntl,sys,time\nf=open(sys.argv[1],"a+")\nfcntl.flock(f,fcntl.LOCK_EX)\nprint("held",flush=True)\ntime.sleep(60)', join(g.root, 'store-maintenance.lock')]);
    await new Promise(held => prune.stdout.once('data', held));
    try {
      const plain = g.worktree('bar');
      g.commit(plain, 'src/feature.ts', 'export const feature = true;', 'feat: add feature');
      g.state({ once: { marker: join(g.root, 'once'), command: ['sh', g.peerScript('pnpm-lock.yaml', null, 'lockfile with wire')] } });
      const stopped = g.land(plain);
      expect(stopped.status).not.toBe(0);
      expect(stopped.stdout + stopped.stderr).toMatch(/store prune is running/u);
      expect(existsSync(`${calls}.g`)).toBe(false);
      // J206 review: the rebase already moved HEAD, so the next land must still owe and run the install first.
      prune.kill();
      await new Promise(gone => prune.once('exit', gone));
      const again = g.land(plain);
      expect(again.status, again.stdout + again.stderr).toBe(0);
      expect(g.read(`${calls}.g`).trim().split('\n')).toEqual(['install --frozen-lockfile --config.confirmModulesPurge=false']);
    } finally { prune.kill(); }
    // A node_modules that links elsewhere (say the canonical checkout's) is never purged through.
    const h = fixture();
    writeFileSync(join(h.root, 'bin/pnpm'), `#!/bin/sh\necho "$*" >> '${calls}.h'\n`);
    chmodSync(join(h.root, 'bin/pnpm'), 0o755);
    const linked = h.worktree('baz');
    h.commit(linked, 'src/feature.ts', 'export const feature = true;', 'feat: add feature');
    mkdirSync(join(h.root, 'canonical-modules'));
    // Ignored as engine's .gitignore does (no trailing slash, so the link matches too): DS22's preflight passes it.
    writeFileSync(join(h.repo, '.git/info/exclude'), 'node_modules\n');
    symlinkSync(join(h.root, 'canonical-modules'), join(linked, 'node_modules'));
    h.state({ once: { marker: join(h.root, 'once'), command: ['sh', h.peerScript('pnpm-lock.yaml', null, 'lockfile with wire')] } });
    const refused = h.land(linked);
    expect(refused.status).not.toBe(0);
    expect(refused.stdout + refused.stderr).toMatch(/node_modules is a symlink/u);
    expect(existsSync(`${calls}.h`)).toBe(false);
  }, 180_000);

  test('a harness change carries too: J249 has no harness rule, main\'s own run checks it', () => {
    const f = fixture();
    const wt = f.worktree('foo');
    f.commit(wt, 'vitest.config.ts', 'export default {};', 'test: add a vitest config');
    f.state({ once: { marker: join(f.root, 'once'), command: ['sh', f.peerScript('src/other.ts', null, 'export const other = 2;')] } });
    const result = f.land(wt);
    expect(result.status, result.stdout).toBe(0);
    expect(result.stdout).toMatch(/carried\s+clean rebase onto/u);
    expect(f.read(f.files.receipts)).toMatch(/landed .*; carried; rounds 1;/u);
  }, 60_000);

  test('a plan that changes hosted CI carries after a clean rebase too (J249)', () => {
    const f = fixture();
    const wt = f.worktree('foo');
    f.commit(wt, '.github/workflows/x.yml', 'name: x', 'ci: add x');
    f.state({ once: { marker: join(f.root, 'once'), command: ['sh', f.peerScript('src/other.ts', null, 'export const other = 2;')] } });
    const result = f.land(wt);
    expect(result.status, result.stdout).toBe(0);
    expect(result.stdout).toMatch(/carried\s+clean rebase onto/u);
    expect(f.read(f.files.receipts)).toMatch(/landed .*; carried; rounds 1;/u);
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
    const jobs = [['tests (4)', 'failure'], ['quarantine (1)', 'failure'], ['quarantine', 'timed_out'], ['static', 'success'], ['e2e', 'cancelled'], ['quarantine-check', 'failure'], ['boundaries', 'failure']]
      .map(([name, conclusion]) => ({ name, conclusion }));
    // EV3b: J186's report-only boundaries job never blocks either.
    expect(failedJobs({ jobs })).toEqual({ blocking: ['tests (4) (failure)', 'e2e (cancelled)', 'quarantine-check (failure)'], nonblocking: ['quarantine (1) (failure)', 'quarantine (timed_out)', 'boundaries (failure)'] });
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
    expect([...jobs.keys()]).toEqual(['tests', 'timings', 'boundaries', 'quarantine']);
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
    expect(jobs.get('tests')).toContain('--units=static,e2e,plan-proofs,tests,products');
    // EV3b: boundaries (report-only, 223-338 s) is its own non-blocking job from t=0, never behind products.
    expect(jobs.get('tests')).not.toContain('boundaries');
    expect(jobs.get('boundaries')).toMatch(/^ {4}continue-on-error: true$/mu);
    expect(jobs.get('boundaries')).toContain('scripts/ci-pack.mjs --jobs=1 --job=1 --units=boundaries');
    // EV3: six shares, the last of them Ring 1's products alone.
    expect(jobs.get('tests')).toContain('job: [1, 2, 3, 4, 5, 6]');
  });

  test('products and boundaries start the last packed job; a heavy last job takes nothing else (EV3)', () => {
    const kinds = ['static', 'e2e', 'plan-proofs', 'tests', 'products', 'boundaries'];
    const names = (bins: { name: string }[][]) => bins.map(bin => bin.map(unit => unit.name));
    const six = names(packUnits(runUnits(15, kinds, index => 100 + index), 6));
    expect(six[5]).toEqual(['products', 'boundaries']);
    expect([...six.slice(0, 5).flat()].sort()).toEqual(['e2e', 'plan-proofs', 'static', ...Array.from({ length: 15 }, (_, i) => `shard:${i + 1}`)].sort());
    expect(six.slice(0, 5).every(bin => bin.length > 0)).toBe(true);
    // One job runs everything, products after the shards; a run without products packs over every job.
    expect(names(packUnits(runUnits(3, kinds), 1))[0]).toEqual(['static', 'e2e', 'plan-proofs', 'shard:1', 'shard:2', 'shard:3', 'products', 'boundaries']);
    expect(names(packUnits(runUnits(6, ['tests']), 6)).every(bin => bin.length === 1)).toBe(true);
    // EV3b: ci.yml runs boundaries alone in its own job; the planner weighs it at its measured 258-392 s (p50 320).
    expect(names(packUnits(runUnits(0, ['boundaries']), 1))).toEqual([['boundaries']]);
    expect(runUnits(0, ['boundaries'])[0]).toMatchObject({ seconds: 320, blocking: false });
  });

  test('products starts the last job and shards fill it once it is the least loaded (EV3b)', () => {
    // ci.yml's kinds (boundaries has its own job), at run 43315969089's measured shard seconds: alone, products left its
    // job 2-4 min short while one of jobs 1-5 ran four shards deep.
    const measured = [137, 155, 88, 157, 137, 135, 95, 146, 121, 161, 108, 74, 116, 126, 164];
    const units = runUnits(15, ['static', 'e2e', 'plan-proofs', 'tests', 'products'], index => measured[index - 1] ?? 0);
    const bins = packUnits(units, 6);
    const last = bins[5]?.map(unit => unit.name) ?? [];
    expect(last.at(-1)).toBe('products');
    expect(last.length).toBeGreaterThan(1);
    expect(last.slice(0, -1).every(name => name.startsWith('shard:'))).toBe(true);
    expect(bins.flat().map(unit => unit.name).sort()).toEqual(units.map(unit => unit.name).sort());
    const loads = bins.map(bin => bin.reduce((sum, unit) => sum + unit.seconds, 0));
    expect(Math.max(...loads)).toBeLessThan(450);
  });
});

// TEST-SPEED TS10 (J255): a flaky hosted red re-runs once; a green re-run strikes the file; strikes from two plans in
// 24 h quarantine it with no human; a red re-run blocks only its plan.
describe('TS10 flaky strikes', () => {
  test('the strike book, the shard reports and the quarantine entry', () => {
    const now = Date.parse('2026-11-11T12:00:00Z'), row = (at: string, plan: string, file = 'test/a.test.ts') => JSON.stringify({ at, plan, file });
    const book = [row('2026-11-11T11:00:00Z', 'plan/one'), row('2026-11-10T11:00:00Z', 'plan/old'), row('2026-11-11T10:00:00Z', 'plan/one'), row('2026-11-11T09:00:00Z', 'plan/two', 'test/b.test.ts'), 'torn{'].join('\n');
    expect(strikePlans(book, 'test/a.test.ts', now)).toEqual(['plan/one']);
    expect(strikePlans(`${book}\n${row('2026-11-11T11:30:00Z', 'plan/three')}`, 'test/a.test.ts', now)).toEqual(['plan/one', 'plan/three']);
    mkdirSync('tmp', { recursive: true });
    const root = mkdtempSync(resolve('tmp', 'land-strikes-')); roots.push(root);
    mkdirSync(join(root, 'engine-ci-2/engine-ci'), { recursive: true }); mkdirSync(join(root, 'engine-ci-2/ci-pack'), { recursive: true });
    const job = (units: unknown[]) => writeFileSync(join(root, 'engine-ci-2/ci-pack/job-2.json'), JSON.stringify({ pinsCode: 0, units }));
    writeFileSync(join(root, 'engine-ci-2/engine-ci/shard-3-native.json'), JSON.stringify({ files: [{ file: 'test/slow.test.ts', state: 'passed', durationMs: 61_000 }, { file: 'test/ok.test.ts', state: 'passed', durationMs: 5 }] }));
    writeFileSync(join(root, 'engine-ci-2/engine-ci/shard-3-ordinary.json'), JSON.stringify({ files: [{ file: 'test/red.test.ts', state: 'failed', durationMs: 5 }] }));
    writeFileSync(join(root, 'engine-ci-2/engine-ci/shard-3-wall.json'), JSON.stringify({ overBudget: false }));
    job([{ name: 'shard:3', blocking: true, code: 1 }, { name: 'boundaries', blocking: false, code: 1 }]);
    expect(flakyFiles(root, ['tests (2) (failure)'])).toEqual(['test/red.test.ts']);
    // Anything but test files keeps it red: another failed job, a red static unit, a shard over its wall, no report.
    expect(flakyFiles(root, ['tests (2) (failure)', 'quarantine-check (failure)'])).toBeNull();
    expect(flakyFiles(root, ['tests (5) (failure)'])).toBeNull();
    job([{ name: 'shard:3', blocking: true, code: 1 }, { name: 'static', blocking: true, code: 1 }]);
    expect(flakyFiles(root, ['tests (2) (failure)'])).toBeNull();
    job([{ name: 'shard:3', blocking: true, code: 1 }]);
    writeFileSync(join(root, 'engine-ci-2/engine-ci/shard-3-wall.json'), JSON.stringify({ overBudget: true }));
    expect(flakyFiles(root, ['tests (2) (failure)'])).toBeNull();
    writeFileSync(join(root, 'engine-ci-2/engine-ci/shard-3-wall.json'), JSON.stringify({ overBudget: false }));
    expect(flakyFiles(root, ['tests (2) (failure)'])).toEqual(['test/red.test.ts']);
    // J295: an amber file (61 s, passed) is green, never a flake; a file red on time is never re-run away.
    writeFileSync(join(root, 'engine-ci-2/engine-ci/shard-3-native.json'), JSON.stringify({ budget: { red: ['RED file=test/hang.test.ts ms=130000 budget=60000'] }, files: [{ file: 'test/hang.test.ts', state: 'passed', durationMs: 130_000 }] }));
    expect(flakyFiles(root, ['tests (2) (failure)'])).toBeNull();
    writeFileSync(join(root, 'engine-ci-2/engine-ci/shard-3-ordinary.json'), JSON.stringify({ errorCount: 1, files: [{ file: 'test/red.test.ts', state: 'failed', durationMs: 5 }] }));
    expect(flakyFiles(root, ['tests (2) (failure)'])).toBeNull();
    const quarantine = join(root, 'quarantine.json');
    writeFileSync(quarantine, JSON.stringify({ schema: 1, entries: [] }));
    expect(quarantineFile(quarantine, 'test/red.test.ts', 'opus-testspeed-lane', 'why', now)).toBe(true);
    expect(quarantineFile(quarantine, 'test/red.test.ts', 'opus-testspeed-lane', 'why', now)).toBe(false);
    expect(JSON.parse(readFileSync(quarantine, 'utf8')).entries).toEqual([{ file: 'test/red.test.ts', owner: 'opus-testspeed-lane', addedAt: '2026-11-11T12:00:00.000Z', deadline: '2026-11-13T12:00:00.000Z', reason: 'why' }]);
    expect(quarantineFile(quarantine, 'test/late.test.ts', 'opus-testspeed-lane', 'why', now + 999)).toBe(true);
    expect(JSON.parse(readFileSync(quarantine, 'utf8')).entries[1].addedAt).toBe('2026-11-11T12:00:00.000Z');
  });

  test('a planted flaky file: one strike lands its plan, a second plan\'s strike quarantines it, a red re-run stops only its plan', () => {
    const f = fixture();
    mkdirSync(join(f.repo, 'test'), { recursive: true });
    writeFileSync(join(f.repo, 'test/quarantine.json'), `${JSON.stringify({ schema: 1, entries: [] }, null, 2)}\n`);
    f.git(f.repo, ['add', 'test/quarantine.json']); f.git(f.repo, ['commit', '--quiet', '-m', 'quarantine file']); f.git(f.repo, ['-c', 'core.hooksPath=/dev/null', 'push', '--quiet', 'origin', 'main']);
    const flaky = { file: 'test/planted-flaky.test.ts' };
    // Plan one: red, then green on its re-run: one strike, it lands, nothing is quarantined.
    const one = f.worktree('one');
    f.commit(one, 'src/one.ts', 'export const one = 1;\n', 'one');
    f.state({ red: { 'plan/one': { ci: 'tests (1)' } }, flaky });
    let result = f.land(one);
    expect(result.status, result.stdout).toBe(0);
    expect(result.stdout).toMatch(/flaky .*test\/planted-flaky\.test\.ts; re-running its failed jobs once/u);
    expect(f.read(join(f.root, 'strikes.jsonl')).trim().split('\n')).toHaveLength(1);
    expect(f.git(f.remote, ['show', 'main:test/quarantine.json'])).not.toContain('planted-flaky');
    // Plan two: the same file flakes: the second plan's strike quarantines it on main, with no human.
    const two = f.worktree('two');
    f.commit(two, 'src/two.ts', 'export const two = 2;\n', 'two');
    // A peer lands while plan two waits on CI, so land rebases its quarantine commit and must re-date it (J193).
    f.state({ red: { 'plan/two': { ci: 'tests (2)' } }, flaky: { ...flaky, jobs: [2] }, once: { marker: join(f.root, 'peer-once'), command: ['sh', f.peerScript('src/peer.ts', null, 'export const peer = 1;')] } });
    result = f.land(two);
    expect(result.status, result.stdout).toBe(0);
    expect(result.stdout).toMatch(/quarantine .*planted-flaky\.test\.ts quarantined for 48 h/u);
    const entries = JSON.parse(f.git(f.remote, ['show', 'main:test/quarantine.json'])).entries;
    expect(entries).toMatchObject([{ file: 'test/planted-flaky.test.ts', owner: 'opus-testspeed-lane' }]);
    // J193's history check: addedAt is the introducing commit's own time on main, the deadline 48 h later.
    const committedAt = Number(f.git(f.remote, ['log', '-1', '--first-parent', '--format=%ct', 'main', '--', 'test/quarantine.json'])) * 1000;
    expect(Date.parse(entries[0].addedAt)).toBe(committedAt);
    expect(Date.parse(entries[0].deadline) - committedAt).toBe(48 * 3600 * 1000);
    expect(f.git(f.remote, ['show', 'main:src/two.ts'])).toBe('export const two = 2;');
    expect(f.git(f.remote, ['show', 'main:src/peer.ts'])).toBe('export const peer = 1;');
    // Plan three: red on its re-run too: not flaky, it stops, and main does not move.
    const three = f.worktree('three'), before = f.remoteMain();
    f.commit(three, 'src/three.ts', 'export const three = 3;\n', 'three');
    f.state({ red: { 'plan/three': { ci: 'tests (3)' } }, flaky: { ...flaky, jobs: [3], stillRed: true } });
    result = f.land(three);
    expect(result.status).toBe(1);
    expect(result.stdout).toMatch(/hosted CI is red/u);
    expect(f.remoteMain()).toBe(before);
    expect(f.read(join(f.root, 'strikes.jsonl')).trim().split('\n')).toHaveLength(2);
    // Plan four: a test file red plus the wall check after the upload: not a flaky file, so no re-run and no strike.
    const four = f.worktree('four');
    f.commit(four, 'src/four.ts', 'export const four = 4;\n', 'four');
    f.state({ red: { 'plan/four': { ci: 'tests (4)' } }, flaky: { ...flaky, jobs: [4], wallRed: true } });
    result = f.land(four);
    expect(result.status).toBe(1);
    expect(result.stdout).not.toMatch(/re-running its failed jobs/u);
    expect(f.read(join(f.root, 'strikes.jsonl')).trim().split('\n')).toHaveLength(2);
  }, 120_000);
});
