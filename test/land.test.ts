// J240 / DEV-SPEED DS21: scripts/land.mjs against real git. A bare repo stands
// in for GitHub (with protect-main's no-force, no-delete rule as an update
// hook), a post-receive hook records every pushed tip, and a fake `gh` on PATH
// answers Actions queries only for SHAs that were really pushed.
// oxlint-disable-next-line import/no-nodejs-modules -- Real git repositories, hooks and the land CLI.
import { execFile, execFileSync, spawnSync } from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- Fixture repositories stay in the repository scratch root.
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- A local Actions API double for the main-run reuse check.
import { createServer } from 'node:http';
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
  const branches = [...new Set(pushed.filter(([, tip]) => tip === sha).map(([ref]) => ref.replace('refs/heads/', '')))];
  const workflow_runs = branches.flatMap(branch => ['ci', 'ring-1'].map(name => {
    const red = state.red?.[branch]?.[name];
    return { id: runId(sha, name), name, event: 'push', head_sha: sha, head_branch: branch, status: 'completed', conclusion: red === undefined ? 'success' : 'failure', html_url: '' };
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
echo "post_ci=\${WS_PUSH_POST_CI:-0} $refs" >> "$PREPUSH_LOG"
echo "timing=\${WS_PUSH_TIMING_RECORDS:-0} \${WS_PUSH_POST_CI:-0}" >> "$PREPUSH_LOG.timing"
printf '%s\\n' "$refs" | node "$RECORD_PLAN_PUSH"
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
    PATH: `${bin}:${process.env['PATH'] ?? ''}`, FAKE_GH_STATE: files.state, PUSHED_LOG: files.pushed, PREPUSH_LOG: files.prepush, RECORD_PLAN_PUSH: resolve('.githooks/record-plan-push.mjs'),
    PREPUSH_FAIL: files.fail, PREPUSH_RACE: files.race, RACE_SCRIPT: files.raceScript,
    WS_LAND_REPO: 'project-wildshard/fixture', WS_LANE_RECEIPTS: files.receipts, WS_LANE_NAME: 'fixture-lane',
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
  write(join(repo, 'test/durations.json'), `{\n${Array.from({ length: 12 }, (_, index) => `  "test/t${index}.test.ts": ${index}`).join(',\n')}\n}\n`);
  git(repo, ['add', 'src', 'test']);
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
    expect(plan).toMatch(new RegExp(`^post_ci=0 \\S+ ${tip} refs/heads/plan/foo 0{40}$`, 'u'));
    expect(main).toMatch(new RegExp(`^post_ci=0 ${tip} ${tip} refs/heads/main [a-f0-9]{40}$`, 'u'));
    expect(rest).toEqual([]);
    expect(f.read(f.files.gh)).toContain(`head_sha=${tip}`);
    expect(f.read(f.files.receipts)).toMatch(new RegExp(`^\\d\\d:\\d\\d UTC fixture-lane land plan/foo landed ${tip.slice(0, 10)} on main .*; exact; rounds 1; hosted reruns 0;`, 'mu'));
  }, 60_000);

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
    expect(result.stdout).toMatch(/carried\s+disjoint/u);
    // The rebased SHA reached main only, under the split gate; plan/foo still holds the tested SHA.
    expect(prepushLines(f).at(-1)).toMatch(new RegExp(`^post_ci=1 ${landed} ${landed} refs/heads/main [a-f0-9]{40}$`, 'u'));
    expect(f.git(f.remote, ['rev-parse', 'plan/foo'])).toBe(tested);
    expect(f.read(f.files.gh)).toContain(`head_sha=${landed}`);
    expect(f.read(f.files.receipts)).toMatch(/landed .*; carried; rounds 1; hosted reruns 0; .*main ci green/u);
  }, 60_000);

  test('main moved over the same file: the rebased SHA reruns hosted CI on the branch before main', () => {
    const f = fixture();
    const wt = f.worktree('foo');
    const tested = f.edit(wt, 'src/shared.ts', 'line10 = 10', 'line10 = 100', 'feat: tune line 10');
    f.state({ once: { marker: join(f.root, 'once'), command: ['sh', f.peerScript('src/shared.ts', 'line1 = 1;', 'line1 = 11;')] } });
    const result = f.land(wt);
    expect(result.status, result.stdout).toBe(0);
    const landed = f.remoteMain();
    expect(landed).not.toBe(tested);
    expect(result.stdout).toContain('main and the plan both changed src/shared.ts');
    // The rewrite of the plan's own branch went through, and that exact SHA then fast-forwarded main.
    expect(f.git(f.remote, ['rev-parse', 'plan/foo'])).toBe(landed);
    expect(f.read(f.files.gh)).toContain(`head_sha=${landed}`);
    expect(prepushLines(f).filter(line => line.includes('refs/heads/plan/foo'))).toHaveLength(2);
    expect(prepushLines(f).at(-1)).toMatch(new RegExp(`^post_ci=0 ${landed} ${landed} refs/heads/main [a-f0-9]{40}$`, 'u'));
    expect(f.read(f.files.receipts)).toMatch(/landed .*; exact; rounds 2; hosted reruns 1;/u);
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
    f.state({ red: { 'plan/bar': { ci: 'quarantine (1)', 'ring-1': 'tests (3)' } } });
    const stopped = f.land(wt);
    expect(stopped.status).toBe(1);
    expect(stopped.stdout).toMatch(/ring-1 run \d+ failure: tests \(3\) \(failure\)/u);
    // The run conclusion still decides: a red run whose only listed failure is a quarantine job stops too.
    expect(stopped.stdout).toMatch(/ci run \d+ failure: no blocking failed job listed \(non-blocking: quarantine \(1\) \(failure\)\)/u);
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
    expect(result.stdout).toMatch(/carried\s+disjoint/u);
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

  test('a plan branch someone else pushed is never rewritten', () => {
    const f = fixture();
    const wt = f.worktree('foo');
    f.commit(wt, 'src/feature.ts', 'export const feature = true;', 'feat: add feature');
    f.git(f.peer, ['commit', '--quiet', '--allow-empty', '-m', 'someone else']);
    f.git(f.peer, ['push', '--quiet', 'origin', 'HEAD:refs/heads/plan/foo']);
    const theirs = f.git(f.remote, ['rev-parse', 'plan/foo']);
    const result = f.land(wt);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('which this worktree did not push last');
    expect(f.git(f.remote, ['rev-parse', 'plan/foo'])).toBe(theirs);
  }, 60_000);

  test('a tip this worktree pushed by hand after its own rebase is its own; land rewrites it and lands', () => {
    const f = fixture();
    const wt = f.worktree('foo');
    f.commit(wt, 'src/feature.ts', 'export const feature = 1;', 'feat: add feature');
    // land pushed once (recorded), then stopped; the agent amended and pushed the branch by hand under a lease.
    f.state({ red: { 'plan/foo': { ci: 'tests (1)' } } });
    expect(f.land(wt).status).toBe(1);
    f.state({});
    f.edit(wt, 'src/feature.ts', 'feature = 1', 'feature = 2', 'feat: tune feature');
    f.git(wt, ['commit', '--quiet', '--amend', '-m', 'feat: tune feature, amended']);
    const hand = f.git(wt, ['rev-parse', 'HEAD']);
    f.git(wt, ['push', '--quiet', '--force', 'origin', `${hand}:refs/heads/plan/foo`]);
    f.git(wt, ['commit', '--quiet', '--amend', '-m', 'feat: tune feature, amended again']);
    const result = f.land(wt);
    expect(result.status, result.stdout).toBe(0);
    expect(result.stdout).toMatch(/replaces its own [0-9a-f]{10} under a lease/u);
    expect(f.git(f.remote, ['log', '--format=%s', '-1', 'main'])).toBe('feat: tune feature, amended again');
  }, 60_000);

  test('an origin tip that is an ancestor of this worktree\'s own push counts as its own', () => {
    const f = fixture();
    const wt = f.worktree('foo');
    const base = f.git(wt, ['rev-parse', 'HEAD']);
    const first = f.commit(wt, 'src/feature.ts', 'export const feature = 1;', 'feat: add feature');
    f.git(wt, ['push', '--quiet', 'origin', `${first}:refs/heads/plan/foo`]);
    const second = f.commit(wt, 'src/feature.ts', 'export const feature = 2;', 'feat: tune');
    // Only the record of the later own push survives (no reflog), and origin still holds the older first push.
    f.git(wt, ['reflog', 'expire', '--expire=now', '--all']);
    writeFileSync(join(f.git(wt, ['rev-parse', '--path-format=absolute', '--git-dir']), 'wildshard-land-tip'), `${second}\n`);
    // The plan is rewritten so origin's tip is no longer in its history: land must replace it.
    f.git(wt, ['reset', '--quiet', '--hard', base]);
    f.commit(wt, 'src/feature.ts', 'export const feature = 3;', 'feat: rewritten');
    f.git(wt, ['reflog', 'expire', '--expire=now', '--all']);
    const result = f.land(wt);
    expect(result.status, result.stdout).toBe(0);
    expect(result.stdout).toMatch(new RegExp(`replaces its own ${first.slice(0, 10)} under a lease`, 'u'));
  }, 60_000);

  test('a foreign tip the local branch once pointed at or merged is still foreign', () => {
    for (const how of ['reset', 'merge']) {
      const f = fixture();
      const wt = f.worktree('foo');
      const base = f.git(wt, ['rev-parse', 'HEAD']);
      f.git(f.peer, ['commit', '--quiet', '--allow-empty', '-m', 'someone else']);
      f.git(f.peer, ['push', '--quiet', 'origin', 'HEAD:refs/heads/plan/foo']);
      const theirs = f.git(f.remote, ['rev-parse', 'plan/foo']);
      f.git(wt, ['fetch', '--quiet', 'origin']);
      // The local branch points at, or merges, their commit for a while: it lands in the reflog, not in a push.
      if (how === 'reset') f.git(wt, ['reset', '--quiet', '--hard', theirs]);
      else f.git(wt, ['merge', '--quiet', '--no-edit', theirs]);
      f.git(wt, ['reset', '--quiet', '--hard', base]);
      f.commit(wt, 'src/feature.ts', 'export const feature = true;', 'feat: add feature');
      const result = f.land(wt);
      expect(result.status, `${how}: ${result.stdout}`).toBe(1);
      expect(result.stdout).toContain('which this worktree did not push last');
      expect(f.git(f.remote, ['rev-parse', 'plan/foo'])).toBe(theirs);
    }
  }, 90_000);

  test('a refused push of a descendant never makes someone else\'s ancestor tip ours', () => {
    const f = fixture();
    const wt = f.worktree('foo');
    const base = f.git(wt, ['rev-parse', 'HEAD']);
    f.git(f.peer, ['commit', '--quiet', '--allow-empty', '-m', 'someone else']);
    f.git(f.peer, ['push', '--quiet', 'origin', 'HEAD:refs/heads/plan/foo']);
    const theirs = f.git(f.remote, ['rev-parse', 'plan/foo']);
    f.git(wt, ['fetch', '--quiet', 'origin']);
    f.git(wt, ['reset', '--quiet', '--hard', theirs]);
    f.commit(wt, 'src/d.ts', 'export const d = 1;', 'feat: on top of theirs');
    writeFileSync(f.files.fail, '');
    expect(spawnSync('git', ['push', '--quiet', 'origin', 'HEAD:refs/heads/plan/foo'], { cwd: wt, env: f.env, encoding: 'utf8' }).status).not.toBe(0);
    rmSync(f.files.fail);
    f.git(wt, ['reset', '--quiet', '--hard', base]);
    f.commit(wt, 'src/feature.ts', 'export const feature = true;', 'feat: add feature');
    const result = f.land(wt);
    expect(result.status, result.stdout).toBe(1);
    expect(result.stdout).toContain('which this worktree did not push last');
    expect(f.git(f.remote, ['rev-parse', 'plan/foo'])).toBe(theirs);
  }, 60_000);

  test('main and the plan both recorded test clocks: still carried, the clocks are not a harness change', () => {
    const f = fixture();
    const wt = f.worktree('foo');
    f.commit(wt, 'src/feature.ts', 'export const feature = true;', 'feat: add feature');
    f.edit(wt, 'test/durations.json', '"test/t10.test.ts": 10', '"test/t10.test.ts": 100', 'test: record clocks');
    f.state({ once: { marker: join(f.root, 'once'), command: ['sh', f.peerScript('test/durations.json', ': 1,', ': 11,')] } });
    const result = f.land(wt);
    expect(result.status, result.stdout).toBe(0);
    expect(result.stdout).toMatch(/carried\s+disjoint/u);
    // The carried pre-push selects as land did: timing records as data, so the plan's related tests run.
    expect(f.read(`${f.files.prepush}.timing`).trim().split('\n').at(-1)).toBe('timing=1 1');
    expect(f.git(f.remote, ['show', 'main:test/durations.json'])).toMatch(/"test\/t1\.test\.ts": 11,[\s\S]*"test\/t10\.test\.ts": 100/u);
    expect(f.read(f.files.receipts)).toMatch(/landed .*; carried; rounds 1; hosted reruns 0;/u);
  }, 60_000);

  test('clocks beside a real harness change still rerun hosted CI after a rebase', () => {
    const f = fixture();
    const wt = f.worktree('foo');
    f.commit(wt, 'vitest.config.ts', 'export default {};', 'test: add a vitest config');
    f.edit(wt, 'test/durations.json', '"test/t10.test.ts": 10', '"test/t10.test.ts": 100', 'test: record clocks');
    f.state({ once: { marker: join(f.root, 'once'), command: ['sh', f.peerScript('test/durations.json', ': 1,', ': 11,')] } });
    const result = f.land(wt);
    expect(result.status, result.stdout).toBe(0);
    expect(result.stdout).toContain('test/config/dependency harness: vitest.config.ts');
    expect(f.read(f.files.receipts)).toMatch(/landed .*; exact; rounds 2; hosted reruns 1;/u);
  }, 60_000);

  test('a plan that changes hosted CI reruns it after any rebase', () => {
    const f = fixture();
    const wt = f.worktree('foo');
    f.commit(wt, '.github/workflows/x.yml', 'name: x', 'ci: add x');
    f.state({ once: { marker: join(f.root, 'once'), command: ['sh', f.peerScript('src/other.ts', null, 'export const other = 2;')] } });
    const result = f.land(wt);
    expect(result.status, result.stdout).toBe(0);
    expect(result.stdout).toContain('the plan changes hosted CI itself (.github/workflows/x.yml)');
    expect(f.read(f.files.receipts)).toMatch(/landed .*; exact; rounds 2; hosted reruns 1;/u);
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
  test('needs both workflows complete; the newest run of each decides', () => {
    expect(shaVerdict({ workflow_runs: [run('ci', 1, 'completed', 'success')] }, sha).state).toBe('pending');
    expect(shaVerdict({ workflow_runs: [run('ci', 1, 'completed', 'failure'), run('ci', 2, 'completed', 'success'), run('ring-1', 3, 'completed', 'success')] }, sha).state).toBe('green');
    expect(shaVerdict({ workflow_runs: [run('ci', 2, 'completed', 'success'), run('ring-1', 3, 'completed', 'cancelled')] }, sha).state).toBe('red');
    expect(shaVerdict({ workflow_runs: [run('ci', 2, 'completed', 'success'), { ...run('ring-1', 3, 'completed', 'success'), event: 'pull_request' }] }, sha).state).toBe('pending');
  });
});

describe('main reuses the exact SHA\'s green plan-branch run (no double run)', () => {
  const sha = 'b'.repeat(40);
  const ciJobs = ['changes', 'static', 'plan', 'e2e', 'tests (1)', 'tests (2)'].map(name => ({ name, status: 'completed', conclusion: 'success' }));
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
  test('ci and ring-1 run on plan/** pushes and gate every main job on the reuse check', () => {
    for (const file of ['ci.yml', 'ring-1.yml']) {
      const text = readFileSync(`.github/workflows/${file}`, 'utf8');
      expect(text).toMatch(/push:\n {4}branches: \[main, 'plan\/\*\*'\]/u);
      expect(text).toContain(`node scripts/ci-exact-reuse.mjs ${file}`);
      expect(text).toContain("startsWith(github.ref, 'refs/heads/plan/')");
    }
    const ring = readFileSync('.github/workflows/ring-1.yml', 'utf8');
    const jobs = new Map([...ring.slice(ring.indexOf('\njobs:')).matchAll(/^ {2}([a-z0-9-]+):\n((?: {4}.*\n|\n)*)/gmu)].map(([, name, body]) => [name, body ?? '']));
    // The reuse job always runs, so no job downstream inherits a skip and loses its tests.
    expect(jobs.get('reuse')).not.toMatch(/^ {4}if:/mu);
    expect(jobs.get('reuse')).toContain('actions: read');
    expect(jobs.get('tests')).toMatch(/^ {4}needs: plan$/mu);
    expect(jobs.get('tests')).not.toMatch(/^ {4}if:/mu);
    for (const [name, body] of jobs) if (name !== 'reuse' && name !== 'tests') expect(body, name).toMatch(/^ {4}needs: reuse\n {4}if: needs\.reuse\.outputs\.reused != 'true'$/mu);
    expect(jobs.size).toBeGreaterThan(5);
  });
});
