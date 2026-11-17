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
import { CHECK_CSS, failedJobs, failureLine, flakyFiles, mainPushArgs, parseArgs, PINS_LEDGER, preflightSteps, prePushCause, quarantineFile, REF_LOCK, shaVerdict, STAMPS, strikePlans } from '../scripts/land.mjs';
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
// MF12: \`limitedUntil\` (epoch ms) makes every Actions query a quota stop until then; rate_limit says when it resets.
if (args[0] === 'api' && args[1] === 'rate_limit') {
  process.stdout.write(JSON.stringify({ resources: { core: { limit: 5000, remaining: Date.now() < (state.limitedUntil ?? 0) ? 0 : 4999, reset: Math.ceil((state.limitedUntil ?? Date.now()) / 1000) } } }));
  process.exit(0);
}
if (args[0] === 'api' && Date.now() < (state.limitedUntil ?? 0)) {
  process.stderr.write('gh: API rate limit exceeded for user ID 1. (HTTP 403)\\n');
  process.exit(1);
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
  mkdirSync('tmp/codex-netlag', { recursive: true });
  const root = mkdtempSync(resolve('tmp/codex-netlag', 'land-'));
  roots.push(root);
  const remote = join(root, 'remote.git'), repo = join(root, 'engine'), peer = join(root, 'peer'), bin = join(root, 'bin'), hooks = join(root, 'hooks');
  const files = { pushed: join(root, 'pushed.log'), gh: join(root, 'gh.log'), prepush: join(root, 'prepush.log'), receipts: join(root, 'receipts.log'), state: join(root, 'gh-state.json'), fail: join(root, 'prepush-fail'), race: join(root, 'prepush-race'), raceScript: join(root, 'race.sh') };
  const env: NodeJS.ProcessEnv = {
    ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 'Land', GIT_AUTHOR_EMAIL: 'land@example.test', GIT_COMMITTER_NAME: 'Land', GIT_COMMITTER_EMAIL: 'land@example.test',
    PATH: `${bin}:${process.env['PATH'] ?? ''}`, FAKE_GH_STATE: files.state, PUSHED_LOG: files.pushed, PREPUSH_LOG: files.prepush,
    PREPUSH_FAIL: files.fail, PREPUSH_RACE: files.race, RACE_SCRIPT: files.raceScript,
    WS_LAND_REPO: 'project-wildshard/fixture', WS_FLAKE_STRIKES: join(root, 'strikes.jsonl'), WS_LANE_RECEIPTS: files.receipts, WS_LANE_NAME: 'fixture-lane', HERDR_PANE_ID: 'w0:p9',
    WS_SESSION_KEEP_ROOT: join(root, 'session-keep'),
    // MF12: never mint a real reader App token from a fixture, even on a machine that has the App's key.
    WS_GH_READER: '0', WS_LAND_MODE: 'hosted',
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
  test('J400: local default lands without a plan push or Actions lookup', () => {
    const f = fixture();
    delete f.env['WS_LAND_MODE'];
    const wt = f.worktree('local');
    const tip = f.commit(wt, 'src/local.ts', 'export const local = true;', 'feat: local');
    const result = f.land(wt);
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(f.remoteMain()).toBe(tip);
    expect(f.git(f.remote, ['for-each-ref', '--format=%(refname)', 'refs/heads/plan/'])).toBe('');
    expect(f.read(f.files.gh)).toBe('');
    expect(prepushLines(f)).toHaveLength(1);
    expect(prepushLines(f)[0]).toContain(`land=local:${tip}`);
    expect(f.read(f.files.receipts)).toMatch(/; local;.*finished=\S+; \d+ s$/mu);
  }, 60_000);

  test('J400: interrupting the full gate drains its push and leaves main unchanged', async () => {
    const f = fixture();
    f.env['WS_LAND_MODE'] = 'local';
    const ready = join(f.root, 'gate-ready');
    f.env['PREPUSH_READY'] = ready;
    const wt = f.worktree('interrupted');
    f.commit(wt, 'src/local.ts', 'export const local = true;', 'feat: local');
    const before = f.remoteMain();
    writeFileSync(join(f.root, 'hooks/pre-push'), '#!/bin/sh\ntrap "exit 1" TERM INT\ncat >/dev/null\ntouch "$PREPUSH_READY"\nsleep 4\nexit 0\n');
    chmodSync(join(f.root, 'hooks/pre-push'), 0o755);
    const child = spawn(process.execPath, [LAND, '--keep'], { cwd: wt, env: f.env, stdio: 'ignore' });
    const done = new Promise<number | null>(_resolve => { child.once('close', code => { _resolve(code); }); });
    try {
      for (let tries = 0; tries < 300 && !existsSync(ready); tries++) await new Promise(doneWaiting => setTimeout(doneWaiting, 10));
      expect(existsSync(ready)).toBe(true);
      child.kill('SIGTERM');
      expect(await done).toBe(1);
      expect(f.remoteMain()).toBe(before);
      expect(f.read(f.files.receipts)).toContain('owned push stopped');
    } finally { if (child.exitCode === null) child.kill('SIGTERM'); }
  }, 20_000);

  test('J400: an additional workflow gate is authoritative without a job-name allowlist', () => {
    const f = fixture(), wt = f.worktree('future-gate');
    const before = f.remoteMain();
    f.commit(wt, 'src/feature.ts', 'export const feature = true;', 'feat: extra gate');
    f.state({ red: { 'plan/future-gate': { ci: 'future-independent-gate' } } });
    const result = f.land(wt);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('future-independent-gate');
    expect(f.remoteMain()).toBe(before);
  }, 60_000);

  test('J400: a red gate stays red when a peer also moves main', () => {
    const f = fixture();
    f.env['WS_LAND_MODE'] = 'local';
    const wt = f.worktree('red-race');
    f.commit(wt, 'src/local.ts', 'export const local = true;', 'feat: local');
    writeFileSync(f.files.raceScript, readFileSync(f.peerScript('src/racer.ts', null, 'export const racer = 3;'), 'utf8'));
    writeFileSync(join(f.root, 'hooks/pre-push'), '#!/bin/sh\nrefs=$(cat)\necho "$refs" >> "$PREPUSH_LOG"\nsh "$RACE_SCRIPT"\necho "pre-push RED planted failure" >&2\nexit 1\n');
    chmodSync(join(f.root, 'hooks/pre-push'), 0o755);
    const result = f.land(wt);
    expect(result.status).toBe(1);
    expect(prepushLines(f)).toHaveLength(1);
    expect(f.git(f.remote, ['ls-tree', 'main', '--', 'src/local.ts'])).toBe('');
  }, 60_000);

  test('J400: remote rejection after a green race cannot blame a passing CPU control', () => {
    const f = fixture();
    f.env['WS_LAND_MODE'] = 'local';
    const wt = f.worktree('cpu-control-race');
    const head = f.commit(wt, 'src/local.ts', 'export const local = true;', 'feat: local');
    writeFileSync(f.files.raceScript, readFileSync(f.peerScript('src/racer.ts', null, 'export const racer = 3;'), 'utf8'));
    writeFileSync(f.files.race, '');
    writeFileSync(join(f.root, 'hooks/pre-push'), PRE_PUSH.replace('exit 0\n', 'echo "Error: Inherited CPU grant is unavailable or is not an actual ancestor grant"\nexit 0\n'));
    writeFileSync(join(f.remote, 'hooks/update'), `#!/bin/sh\n[ "$3" = '${head}' ] && exit 1\nexit 0\n`);
    const result = f.land(wt);
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(prepushLines(f)).toHaveLength(2);
    expect(f.git(wt, ['show', 'HEAD:src/racer.ts'])).toContain('racer = 3');
  }, 60_000);

  test('J400: a local red cannot move main and a race gates the rebased tree again', () => {
    const f = fixture();
    f.env['WS_LAND_MODE'] = 'local';
    const wt = f.worktree('local-red');
    f.commit(wt, 'src/local.ts', 'export const local = true;', 'feat: local');
    const before = f.remoteMain();
    writeFileSync(f.files.fail, '');
    expect(f.land(wt).status).toBe(1);
    expect(f.remoteMain()).toBe(before);
    rmSync(f.files.fail);
    writeFileSync(f.files.raceScript, readFileSync(f.peerScript('src/racer.ts', null, 'export const racer = 3;'), 'utf8'));
    writeFileSync(f.files.race, '');
    const result = f.land(wt);
    expect(result.status, result.stdout + result.stderr).toBe(0);
    const lines = prepushLines(f);
    expect(lines).toHaveLength(3);
    expect(lines.every(line => line.includes('land=local:'))).toBe(true);
    expect(lines[1]).not.toBe(lines[2]);
    expect(f.git(wt, ['show', 'HEAD:src/racer.ts'])).toContain('racer = 3');
    expect(f.read(f.files.gh)).toBe('');
  }, 60_000);
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
    expect(parseArgs([], {})).toEqual({ mode: 'local', pollSeconds: 60, timeoutMinutes: 60, appearMinutes: 5, rounds: 5, keep: false, preflight: true });
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
  const plantPnpm = (f: Fixture, red: string | null) => {
    const log = join(f.root, 'pnpm.log');
    writeFileSync(join(f.root, 'bin/pnpm'), `#!/bin/sh\necho "$*" >> '${log}'\n${red === null ? '' : `[ "$1" = ${red} ] && { echo 'planted ${red} error'; exit 2; }\n`}exit 0\n`);
    return () => f.read(log).trim().split('\n').filter(Boolean);
  };

  test('preflight: lint:game, typecheck, then the Vitest files related to the changed code, before the plan push', () => {
    const f = fixture(), calls = plantPnpm(f, null);
    const wt = f.worktree('foo');
    f.commit(wt, 'src/feature.ts', 'export const feature = true;', 'feat: add feature');
    f.commit(wt, 'docs/feature.md', '# Feature\n', 'docs: feature');
    const result = f.land(wt);
    expect(result.status, result.stdout).toBe(0);
    expect(calls().filter(line => !line.startsWith('install'))).toEqual(['lint:game', 'typecheck', 'exec vitest related --run --passWithNoTests src/feature.ts']);
    expect(result.stdout.indexOf('preflight vitest green')).toBeLessThan(result.stdout.indexOf('pushing'));
  }, 60_000);

  test('preflight: a red check stops land before any push or CI wait, naming its log; --no-preflight skips it', () => {
    const f = fixture(), calls = plantPnpm(f, 'typecheck');
    const wt = f.worktree('foo');
    f.commit(wt, 'src/feature.ts', 'export const feature = true;', 'feat: add feature');
    const result = f.land(wt);
    expect(result.status).toBe(1);
    const log = /Log: (\S+)/u.exec(result.stdout)?.[1] ?? '';
    expect(result.stdout).toContain('land STOP preflight typecheck is red');
    expect(readFileSync(log, 'utf8')).toContain('planted typecheck error');
    expect(log.startsWith(wt), 'the log stays out of the tree').toBe(false);
    expect(calls()).toEqual(['lint:game', 'typecheck']);
    expect([f.read(f.files.prepush), f.read(f.files.gh)]).toEqual(['', '']);
    expect(f.read(f.files.receipts)).toContain(`STOP preflight typecheck red on ${f.git(wt, ['rev-parse', 'HEAD']).slice(0, 10)}, nothing pushed: ${log}`);
    const skipped = f.land(wt, ['--keep', '--no-preflight']);
    expect(skipped.status, skipped.stdout).toBe(0);
    expect(skipped.stdout).toContain('preflight skipped (--no-preflight)');
  }, 60_000);

  test('preflightSteps: CI\'s check-css always; Vitest only when code changed, on that code alone', () => {
    expect(preflightSteps(['docs/a.md', 'package.json'])).toEqual([['lint:game', ['pnpm', 'lint:game']], ['check-css', ['node', CHECK_CSS]], ['typecheck', ['pnpm', 'typecheck']]]);
    expect(preflightSteps(['docs/a.md', 'src/a.ts', 'test/a.test.ts', 'scripts/b.mjs']).at(-1)).toEqual(['vitest', ['pnpm', 'exec', 'vitest', 'related', '--run', '--passWithNoTests', 'src/a.ts', 'test/a.test.ts', 'scripts/b.mjs']]);
  });

  // opus-gcm11, 2026-11-15: check-css is red only on CI's static job (a 27-minute re-run); the preflight runs it here.
  test('preflight: the tree\'s own check-css runs after lint:game, and a red one stops land before any push', () => {
    const f = fixture(), calls = plantPnpm(f, null);
    const wt = f.worktree('foo');
    f.commit(wt, CHECK_CSS, "console.log('planted css violation'); process.exit(1);\n", 'chore: a check-css that fails');
    const result = f.land(wt);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('land STOP preflight check-css is red');
    expect(readFileSync(/Log: (\S+)/u.exec(result.stdout)?.[1] ?? '', 'utf8')).toMatch(/^\$ node scripts\/check-css\.mjs\nplanted css violation/u);
    expect(calls()).toEqual(['lint:game']);
    expect(f.read(f.files.prepush)).toBe('');
  }, 60_000);

  // 2026-11-16 (codex-netlag, opus-publish1): a worktree rebased past a pin bump holds the old revision under out/, and
  // gen:inputs refuses it; the stop showed only the stack's tail. Land runs pins first, and a stop names the thrown error.
  test('a worktree whose out/ holds a pin main no longer names runs pnpm pins before gen:inputs', () => {
    const f = fixture(), calls = plantPnpm(f, null);
    const wt = f.worktree('foo');
    f.commit(wt, 'package.json', '{"scripts":{"pins":"node scripts/pins.ts"}}\n', 'chore: a pins script');
    f.commit(wt, 'test/pins/shardfiles.json', `${JSON.stringify({ shards: [{ slug: 'dunes', revision: 2, hash: 'b'.repeat(64) }] })}\n`, 'test(pins): dunes rev 2');
    writeFileSync(join(f.repo, '.git/info/exclude'), 'out/\n');
    mkdirSync(join(wt, 'out/dunes'), { recursive: true });
    writeFileSync(join(wt, PINS_LEDGER), '{}\n');
    writeFileSync(join(wt, 'out/dunes/validation.json'), `${JSON.stringify({ pin: { hash: 'a'.repeat(64), revision: 1 } })}\n`);
    const result = f.land(wt);
    expect(result.status, result.stdout).toBe(0);
    expect(calls()[0]).toBe('--silent pins');
    expect(result.stdout).toContain('out/ holds pins main no longer names (dunes revision 1); running pnpm pins before gen:inputs');
  }, 60_000);

  test('a gen:inputs stop names the thrown error, not the stack\'s tail', () => {
    const f = fixture();
    const wt = f.worktree('foo');
    f.commit(wt, 'scripts/gen.mjs', "function inner(){throw new Error('planted: out/ holds pinned products the pins no longer name');}\ninner();\n", 'build: a failing generator');
    const result = f.land(wt);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('failed before the gate (the pre-push would fail on it too): Error: planted: out/ holds pinned products the pins no longer name');
    expect(failureLine('a\nError: real cause\n    at x (y:1:2)\n    at process.processTicksAndRejections (node:internal)\n\nNode.js v24')).toBe('Error: real cause');
    expect(failureLine('one\ntwo\nthree\nfour')).toBe('two three four');
    expect(failureLine('', new Error('spawn ENOENT'))).toBe('spawn ENOENT');
  }, 60_000);

  // opus-gcm11: a worktree that never ran `pnpm pins` has no out/.pins.json, and gen:inputs fails on it.
  test('a worktree that never ran pnpm pins runs it before gen:inputs; one that has its ledger does not', () => {
    for (const ran of [false, true]) {
      const f = fixture(), calls = plantPnpm(f, null);
      const wt = f.worktree('foo');
      f.commit(wt, 'package.json', '{"scripts":{"pins":"node scripts/pins.ts"}}\n', 'chore: a pins script');
      if (ran) {
        writeFileSync(join(f.repo, '.git/info/exclude'), 'out/\n');
        mkdirSync(join(wt, 'out'), { recursive: true });
        writeFileSync(join(wt, PINS_LEDGER), '{}\n');
      }
      const result = f.land(wt);
      expect(result.status, result.stdout).toBe(0);
      expect(calls()[0], String(ran)).toBe(ran ? 'lint:game' : '--silent pins');
      expect(result.stdout.includes('never ran pnpm pins'), String(ran)).toBe(!ran);
    }
  }, 90_000);

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
    // Git may forward a hook's stdout separately from its own stderr.
    expect(prePushCause("error: failed to push some refs to 'x'\n", 'pre-push: planted red check\n'))
      .toBe('pre-push: planted red check');
    expect(prePushCause('  - lint RED in 3.0 s\nerror: failed to push some refs to \'x\'\n')).toBe('lint RED in 3.0 s');
    expect(prePushCause('file:///x/run-checks.mjs:63\nError: Push target requires a clean checked tree; enqueue a committed immutable checkout\n    at capturePushTree (x)\nerror: failed to push some refs to \'x\'\n'))
      .toBe('Push target requires a clean checked tree; enqueue a committed immutable checkout');
    expect(prePushCause('To /remote.git\n!\trefs/heads/plan/x:refs/heads/plan/x\t[remote rejected] (hook declined)\nDone\nerror: failed to push some refs to \'x\'\n'))
      .toBe('!\trefs/heads/plan/x:refs/heads/plan/x\t[remote rejected] (hook declined)');
    // A passing check's logged Error never outranks the check that went RED.
    expect(prePushCause('  - tests green in 9 s\nError: expected in a passing test\n  - lint RED in 3.0 s\n')).toBe('lint RED in 3.0 s');
    expect(prePushCause('Error: Inherited CPU grant is unavailable or is not an actual ancestor grant\n', 'To /remote.git\n!\tHEAD:refs/heads/main\t[remote rejected] (failed to update ref)\nDone\n'))
      .toContain('[remote rejected] (failed to update ref)');
    expect(prePushCause('lint RED in 1 s\nTo /sample.git\n!\tHEAD:refs/heads/main\t[remote rejected] (sample)\nDone\n'))
      .toBe('lint RED in 1 s');
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

  // These two are about the rebase install alone; the preflight's own pnpm calls are tested above.
  const NO_PREFLIGHT = ['--keep', '--no-preflight'];
  test('a rebase that brings in a lockfile change installs before the pushes; one that does not, does not', () => {
    const f = fixture();
    // A fake pnpm on the fixture's PATH logs each call, so the test sees exactly what land runs.
    const calls = join(f.root, 'pnpm-calls.log');
    writeFileSync(join(f.root, 'bin/pnpm'), `#!/bin/sh\necho "$*" >> '${calls}'\n`);
    chmodSync(join(f.root, 'bin/pnpm'), 0o755);
    const wt = f.worktree('foo');
    f.commit(wt, 'src/feature.ts', 'export const feature = true;', 'feat: add feature');
    f.state({ once: { marker: join(f.root, 'once'), command: ['sh', f.peerScript('pnpm-lock.yaml', null, 'lockfile with wire')] } });
    const result = f.land(wt, NO_PREFLIGHT);
    expect(result.status, result.stdout).toBe(0);
    expect(result.stdout).toMatch(/install\s+pnpm-lock\.yaml changed in the rebase; pnpm install --frozen-lockfile/u);
    expect(f.read(calls).trim().split('\n')).toEqual(['install --frozen-lockfile --config.confirmModulesPurge=false']);
    const g = fixture();
    writeFileSync(join(g.root, 'bin/pnpm'), `#!/bin/sh\necho "$*" >> '${calls}.g'\n`);
    chmodSync(join(g.root, 'bin/pnpm'), 0o755);
    const plain = g.worktree('bar');
    g.commit(plain, 'src/feature.ts', 'export const feature = true;', 'feat: add feature');
    g.state({ once: { marker: join(g.root, 'once'), command: ['sh', g.peerScript('src/other.ts', null, 'export const other = 2;')] } });
    const quiet = g.land(plain, NO_PREFLIGHT);
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
    const result = f.land(wt, NO_PREFLIGHT);
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
      const stopped = g.land(plain, NO_PREFLIGHT);
      expect(stopped.status).not.toBe(0);
      expect(stopped.stdout + stopped.stderr).toMatch(/store prune is running/u);
      expect(existsSync(`${calls}.g`)).toBe(false);
      // J206 review: the rebase already moved HEAD, so the next land must still owe and run the install first.
      prune.kill();
      await new Promise(gone => prune.once('exit', gone));
      const again = g.land(plain, NO_PREFLIGHT);
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
    const refused = h.land(linked, NO_PREFLIGHT);
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

  // Run 43332891983 on 2d33c963: two lands share refs/remotes/origin/main, and the one that fetched second lost the
  // ref's lock ("is at X but expected Y") and stopped. A git shim fails land's main fetch on demand.
  const fetchShim = (f: Fixture, mode: 'lock-once' | 'lock-always' | 'other') => {
    const real = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
    const log = join(f.root, 'fetch.log'), marker = join(f.root, 'fetch-fail');
    writeFileSync(marker, mode);
    writeFileSync(join(f.root, 'bin/git'), `#!/bin/sh
case "$*" in *"refs/heads/main:refs/remotes/origin/main"*)
  echo "$*" >> '${log}'
  case "$(cat '${marker}' 2>/dev/null)" in
    lock-once) rm -f '${marker}'; echo "error: cannot lock ref 'refs/remotes/origin/main': is at 67cc4b21 but expected 04ef18ba" >&2; echo " ! 04ef18ba..67cc4b21  main -> origin/main  (unable to update local ref)" >&2; exit 1 ;;
    lock-always) echo "error: Unable to create '/x/.git/refs/remotes/origin/main.lock': File exists." >&2; exit 1 ;;
    other) echo "fatal: unable to access 'https://github.com/project-wildshard/fixture/': Could not resolve host: github.com" >&2; exit 128 ;;
  esac ;;
esac
exec '${real}' "$@"
`);
    chmodSync(join(f.root, 'bin/git'), 0o755);
    return () => f.read(log).trim().split('\n').filter(Boolean);
  };

  test('a fetch that loses origin/main\'s ref lock to another land is retried, and land carries on', () => {
    const f = fixture();
    const wt = f.worktree('foo');
    const head = f.commit(wt, 'src/foo.ts', 'export const foo = 1;', 'feat: foo');
    const fetches = fetchShim(f, 'lock-once');
    const result = f.land(wt);
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.stdout).toMatch(/retry\s+git fetch .*cannot lock ref/u);
    expect(fetches().length).toBeGreaterThanOrEqual(2);
    expect(f.remoteMain()).toBe(head);
  }, 60_000);

  test('a fetch that fails for any other reason still stops land at once, with no retry', () => {
    const f = fixture();
    const wt = f.worktree('foo');
    f.commit(wt, 'src/foo.ts', 'export const foo = 1;', 'feat: foo');
    const before = f.remoteMain();
    const fetches = fetchShim(f, 'other');
    const result = f.land(wt);
    expect(result.status).not.toBe(0);
    expect(result.stdout + result.stderr).toMatch(/git fetch origin main failed: fatal: unable to access/u);
    expect(result.stdout).not.toMatch(/retry/u);
    expect(fetches()).toHaveLength(1);
    expect(f.remoteMain()).toBe(before);
  }, 60_000);

  test('a ref lock that never clears stops after 4 retries, naming git\'s error', () => {
    const f = fixture();
    const wt = f.worktree('foo');
    f.commit(wt, 'src/foo.ts', 'export const foo = 1;', 'feat: foo');
    const before = f.remoteMain();
    const fetches = fetchShim(f, 'lock-always');
    const result = f.land(wt);
    expect(result.status).not.toBe(0);
    expect(result.stdout + result.stderr).toMatch(/git fetch origin main failed: error: Unable to create .*main\.lock': File exists/u);
    expect(result.stdout.match(/ retry /gu)).toHaveLength(4);
    expect(fetches()).toHaveLength(5);
    expect(f.remoteMain()).toBe(before);
  }, 60_000);

  test('REF_LOCK matches git\'s lock refusals and nothing else', () => {
    for (const lock of [
      "error: cannot lock ref 'refs/remotes/origin/main': is at 67cc4b21 but expected 04ef18ba",
      "error: cannot lock ref 'refs/remotes/origin/main': Unable to create '/r/.git/refs/remotes/origin/main.lock': File exists.",
      "fatal: Unable to create '/r/.git/packed-refs.lock': File exists.",
    ]) expect(REF_LOCK.test(lock), lock).toBe(true);
    for (const other of [
      "fatal: unable to access 'https://github.com/o/r/': Could not resolve host: github.com",
      "fatal: couldn't find remote ref refs/heads/plan/foo",
      'fatal: Authentication failed for \'https://github.com/o/r/\'',
    ]) expect(REF_LOCK.test(other), other).toBe(false);
  });
});

describe('failedJobs', () => {
  test('splits non-blocking quarantine jobs from blocking reds', () => {
    const jobs = [['tests (4)', 'failure'], ['quarantine (1)', 'failure'], ['quarantine', 'timed_out'], ['static', 'success'], ['e2e', 'cancelled'], ['quarantine-check', 'failure'], ['boundaries', 'failure']]
      .map(([name, conclusion]) => ({ name, conclusion }));
    // TS15: the soaked boundaries job now blocks; quarantine alone remains report-only.
    expect(failedJobs({ jobs })).toEqual({ blocking: ['tests (4) (failure)', 'e2e (cancelled)', 'quarantine-check (failure)', 'boundaries (failure)'], nonblocking: ['quarantine (1) (failure)', 'quarantine (timed_out)'] });
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

test('boundaries stays blocking and independent; J400 moves quarantine to reports', () => {
  const text = readFileSync('.github/workflows/ci.yml', 'utf8');
  const job = (name: string): string => {
    const start = text.indexOf(`\n  ${name}:\n`);
    if (start === -1) throw new Error(`ci.yml has no ${name} job`);
    const next = text.slice(start + 1).search(/\n {2}[a-z][a-z0-9_-]*:\n/u);
    return next === -1 ? text.slice(start) : text.slice(start, start + 1 + next);
  };
  for (const name of ['boundaries']) {
    const block = job(name);
    expect(block, name).toContain("    if: ${{ !startsWith(github.ref, 'refs/heads/plan/') }}");
    expect(block).not.toMatch(/^ {4}continue-on-error:/mu);
    // a main push that reused the plan run would skip it for every landed SHA: no reuse step here
    expect(block, name).not.toContain('ci-exact-reuse.mjs');
    expect(block, name).not.toContain('steps.reuse');
  }
  expect(readFileSync('.github/workflows/ci-reports.yml', 'utf8')).toContain('node scripts/test-quarantine.mjs --shard=1/1');
  // The hosted fallback still accepts an exact plan proof.
  expect(job('tests')).toContain('node scripts/ci-exact-reuse.mjs ci.yml');
  expect(job('tests')).not.toMatch(/^ {4}if: /mu);
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
  test('main pushes coalesce while release branches run independently (RB1)', () => {
    const text = readFileSync('.github/workflows/ci.yml', 'utf8');
    const top = text.split('\njobs:\n')[0] ?? '';
    const template = /^ {2}group: (.+)$/mu.exec(top)?.[1];
    const cancel = /^ {2}cancel-in-progress: (.+)$/mu.exec(top)?.[1];
    if (template === undefined || cancel === undefined) throw new Error('ci.yml has no top-level concurrency group');
    // Both are plain YAML scalars: a `: ` or ` #` inside one breaks the whole workflow file (d19ed2a2 did, CIQ1).
    for (const scalar of [template, cancel]) expect(scalar).not.toMatch(/: | #/u);
    type Context = { event_name: string; ref: string; sha: string; run_id: string; event: { head_commit: { message: string } } };
    const evaluate = (source: string, github: Context): unknown => source.replaceAll(/\$\{\{(.*?)\}\}/gu, (_match: string, expression: string) =>
      String(runInNewContext(expression.replaceAll(/\bstartsWith\(/gu, 'starts(').replaceAll("'", '"').replaceAll('==', '==='), {
        github, starts: (value: string, prefix: string) => value.startsWith(prefix), format: (pattern: string, argument: string) => pattern.replace('{0}', argument),
      })));
    const main = { event_name: 'push', ref: 'refs/heads/main', sha: 'a'.repeat(40), run_id: '1', event: { head_commit: { message: 'fix(x): y' } } };
    const next = { ...main, sha: 'b'.repeat(40), run_id: '2' };
    // A burst of main pushes shares one group: GitHub keeps the running run and only the newest pending one.
    expect(evaluate(template, main)).toBe(evaluate(template, next));
    expect(evaluate(cancel, main)).toBe('false');
    // Release CI is scoped to its own ref and main cannot cancel it.
    const release = { ...next, ref: 'refs/heads/release/v0.1.19' };
    expect(evaluate(template, release)).not.toBe(evaluate(template, main));
    expect(evaluate(template, release)).not.toBe(evaluate(template, { ...release, ref: 'refs/heads/release/v0.1.20' }));
    expect(evaluate(cancel, release)).toBe('false');
    expect(evaluate(template, { ...main, event: { head_commit: { message: 'chore(release): v0.1.19' } } })).toBe(evaluate(template, main));
    // A qualification dispatch never replaces a pending publication run.
    expect(evaluate(template, { ...main, event_name: 'workflow_dispatch' })).not.toBe(evaluate(template, main));
    // A plan branch keeps one group, and its newer push cancels the older run.
    const plan = { ...main, ref: 'refs/heads/plan/foo' };
    expect(evaluate(template, plan)).toBe(evaluate(template, { ...plan, sha: next.sha, run_id: '2' }));
    expect(evaluate(cancel, plan)).toBe('true');
  });

  test('J400: nine shares keep T1 with products and reporting off the gate', () => {
    const text = readFileSync('.github/workflows/ci.yml', 'utf8');
    const jobs = new Map([...text.slice(text.indexOf('\njobs:')).matchAll(/^ {2}([a-z0-9-]+):\n((?: {4}.*\n|\n)*)/gmu)].map(([, name, body]) => [name, body ?? '']));
    // These are required execution roles, not an exhaustive gate list.
    // Nine's jobs and every future job retain the workflow's own gating
    // policy: land uses its whole resolved conclusion, never this inventory.
    expect([...jobs.keys()]).toEqual(expect.arrayContaining(['tests', 'products', 'boundaries']));
    const packed = jobs.get('tests') ?? '', producer = jobs.get('products') ?? '';
    expect(packed).toContain('job: [1, 2, 3, 4, 5, 6, 7, 8]');
    expect(producer).toContain('job: [9]');
    expect(packed).toContain('--jobs=9 --job=${{ matrix.job }}');
    expect(packed).toContain('node scripts/t1-batch.mjs');
    expect(packed + producer).not.toMatch(/^ {4}needs:/mu);
    for (const suite of ['A', 'B', 'C', 'D']) expect(packed).toContain('name: template-e2e-' + suite);
    expect(packed).not.toContain('continue-on-error: true');
    expect(packed).not.toMatch(/Soak |Observe /u);
    const reports = readFileSync('.github/workflows/ci-reports.yml', 'utf8');
    expect(reports).toContain('workflow_run:');
    expect(reports).toContain('types: [completed]');
    expect(reports).toContain('github.event.workflow_run.head_sha');
    expect(reports).toContain('github.event.workflow_run.id');
    expect(reports).toContain('node scripts/test-timings.mjs collect');
    expect(reports).toContain('Soak socket loss');
    // Reports are read-only source-run follow-ups, never a workflow_run token
    // exposed to fork PR code or granted write permission.
    expect(reports).toContain("github.event.workflow_run.event == 'push'");
    expect(reports).toContain('contents: read');
    expect(reports).toContain('actions: read');
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
    expect(runUnits(0, ['boundaries'])[0]).toMatchObject({ seconds: 320, blocking: true });
  });

  test('J400 reserves T1 time on share nine and covers each existing unit once', () => {
    // ci.yml's kinds (boundaries has its own job), at run 43315969089's measured shard seconds: alone, products left its
    // job 2-4 min short while one of jobs 1-5 ran four shards deep.
    const measured = [137, 155, 88, 157, 137, 135, 95, 146, 121, 161, 108, 74, 116, 126, 164];
    const units = runUnits(15, ['static', 'e2e', 'plan-proofs', 'tests', 'products'], index => measured[index - 1] ?? 0);
    const bins = packUnits(units, 9);
    expect(bins).toHaveLength(9);
    expect(bins[8]?.map(unit => unit.name)).toEqual(['products']);
    expect(bins.flat().map(unit => unit.name).sort()).toEqual(units.map(unit => unit.name).sort());
    const loads = bins.map(bin => bin.reduce((sum, unit) => sum + unit.seconds, 0));
    expect(Math.max(...loads)).toBeLessThanOrEqual(540);
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
    job([{ name: 'shard:3', blocking: true, code: 1 }, { name: 'quarantine', blocking: false, code: 1 }]);
    expect(flakyFiles(root, ['tests (2) (failure)'])).toEqual(['test/red.test.ts']);
    job([{ name: 'shard:3', blocking: true, code: 1 }, { name: 'boundaries', blocking: true, code: 1 }]);
    expect(flakyFiles(root, ['tests (2) (failure)'])).toBeNull();
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
