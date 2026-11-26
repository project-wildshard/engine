// J240: the landing suites use isolated real Git repositories, hooks and a fake Actions CLI (the local and push
// modes must never ask it anything; pin-provenance tests still answer from it).
// oxlint-disable-next-line import/no-nodejs-modules -- The fixture drives real Git and runs the land CLI.
import { execFile, execFileSync, spawnSync } from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- Create and clean owned fixture repositories.
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Resolve fixture paths.
import { join, resolve } from 'node:path';

export const LAND = resolve('src/scripts/.kit/land.mjs');
const roots: string[] = [];
export function trackLandFixtureRoot(root: string): void { roots.push(root); }
export function cleanLandFixtures(): void {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
}

const FAKE_GH = `#!/usr/bin/env node
// Answers the two Actions queries land makes, from the remote's pushed-tip log.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
const state = JSON.parse(fs.readFileSync(process.env.FAKE_GH_STATE, 'utf8'));
fs.appendFileSync(state.log, process.argv.slice(2).join(' ') + '\\n');
const args = process.argv.slice(2);
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
export const PRE_PUSH = `#!/bin/sh
refs=$(cat)
echo "land=\${WS_LAND_MAIN_PUSH:-0} $refs" >> "$PREPUSH_LOG"
[ -f "$PREPUSH_FAIL" ] && { echo "pre-push: planted red check"; exit 1; }
case "$refs" in *refs/heads/main*) if [ -f "$PREPUSH_RACE" ]; then rm "$PREPUSH_RACE"; sh "$RACE_SCRIPT"; fi ;; esac
exit 0
`;

export type Fixture = ReturnType<typeof fixture>;

export function fixture() {
  const scratch = process.env['VITEST_TMP_ROOT'] ?? 'tmp/codex-pagesize';
  mkdirSync(scratch, { recursive: true });
  const root = mkdtempSync(resolve(scratch, 'land-'));
  trackLandFixtureRoot(root);
  const remote = join(root, 'remote.git'), repo = join(root, 'engine'), peer = join(root, 'peer'), bin = join(root, 'bin'), hooks = join(root, 'hooks');
  const files = { pushed: join(root, 'pushed.log'), gh: join(root, 'gh.log'), prepush: join(root, 'prepush.log'), delta: join(root, 'delta.log'), receipts: join(root, 'receipts.log'), state: join(root, 'gh-state.json'), fail: join(root, 'prepush-fail'), race: join(root, 'prepush-race'), raceScript: join(root, 'race.sh') };
  const env: NodeJS.ProcessEnv = {
    ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 'Land', GIT_AUTHOR_EMAIL: 'land@example.test', GIT_COMMITTER_NAME: 'Land', GIT_COMMITTER_EMAIL: 'land@example.test',
    PATH: `${bin}:${process.env['PATH'] ?? ''}`, FAKE_GH_STATE: files.state, PUSHED_LOG: files.pushed, PREPUSH_LOG: files.prepush,
    PREPUSH_FAIL: files.fail, PREPUSH_RACE: files.race, RACE_SCRIPT: files.raceScript,
    WS_LAND_REPO: 'project-wildshard/fixture', WS_LANE_RECEIPTS: files.receipts, WS_LANE_NAME: 'fixture-lane', HERDR_PANE_ID: 'w0:p9',
    WS_SESSION_KEEP_ROOT: join(root, 'session-keep'),
    // MF12: never mint a real reader App token from a fixture, even on a machine that has the App's key.
    WS_GH_READER: '0', WS_LAND_MODE: 'push',
    WS_STORE_USERS: join(root, 'store-users'), WS_STORE_RESERVATION: join(root, 'store-maintenance.lock'),
    WS_FULL_GATE_ROOT: join(root, 'full-gate'),
    // J521: a fixture's branch deletes never reach the real log.
    WS_BRANCH_LOG: join(root, 'deleted-branches.log'),
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
  // Most tests look at the worktree after landing, so they keep it (the LS5 tests pass --done).
  const KEPT = ['--keep'];
  const land = (cwd: string, args: readonly string[] = KEPT) => spawnSync(process.execPath, [LAND, ...args], { cwd, env, encoding: 'utf8', timeout: 60_000 });
  const landAsync = (cwd: string) => new Promise<{ code: number | null; stdout: string }>(done => {
    const child = execFile(process.execPath, [LAND, ...KEPT], { cwd, env, encoding: 'utf8', timeout: 60_000 }, (error, stdout) => { done({ code: error === null ? 0 : (typeof error.code === 'number' ? error.code : 1), stdout }); });
    child.stdin?.end();
  });
  const remoteMain = () => git(remote, ['rev-parse', 'main']);
  const read = (path: string) => (existsSync(path) ? readFileSync(path, 'utf8') : '');
  return { root, remote, repo, peer, env, files, git, worktree, commit, edit, peerScript, state, land, landAsync, remoteMain, read };
}

export const prepushLines = (f: Fixture) => f.read(f.files.prepush).trim().split('\n').filter(Boolean);
