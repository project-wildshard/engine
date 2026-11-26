import { afterAll, expect, test } from 'vitest';
// oxlint-disable-next-line import/no-nodejs-modules -- Real git repositories and a Vitest JSON report on disk.
import { spawnSync } from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- Real git repositories and a Vitest JSON report on disk.
import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Real git repositories and a Vitest JSON report on disk.
import { join } from 'node:path';
import { failingIds, mainReds, newReds, writeCache, cacheFile } from '../scripts/push-known-red.mjs';
import { markGated, pregated } from '../scripts/main-push-gated.mjs';
import { ownCommits, pregate } from '../scripts/.kit/main-push.mjs';

// Mini coordinator, 2026-11-16 ~17:50 Cancún: a push is never refused for a red main already has, and main-push gates
// before its lock. Real git: a bare remote, a clone, replayed commits keeping their patch ids.
const work = join(import.meta.dirname, `../../tmp/push-known-red-test-${process.pid}`);
afterAll(() => rmSync(work, { recursive: true, force: true }));
const env = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))),
  GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
const git = (cwd, ...args) => {
  const out = spawnSync('git', args, { cwd, encoding: 'utf8', env });
  expect(out.status, `git ${args.join(' ')}: ${out.stderr}`).toBe(0);
  return out.stdout.trim();
};
const report = (file, rows) => writeFileSync(file, JSON.stringify({ testResults: rows }));

test('only a red origin/main does not share refuses; a file that fails to load is one id', () => {
  mkdirSync(work, { recursive: true });
  const file = join(work, 'report.json');
  report(file, [
    { name: join(work, 'test/a.test.ts'), status: 'failed', assertionResults: [{ fullName: 'a old', status: 'failed' }, { fullName: 'a ok', status: 'passed' }] },
    { name: join(work, 'test/b.test.ts'), status: 'failed', message: 'SyntaxError', assertionResults: [] },
    { name: join(work, 'test/c.test.ts'), status: 'passed', assertionResults: [{ fullName: 'c', status: 'passed' }] },
  ]);
  const pushed = failingIds(file, work);
  expect(pushed).toEqual(new Map([['test/a.test.ts', new Set(['test/a.test.ts::a old'])], ['test/b.test.ts', new Set(['test/b.test.ts::(file)'])]]));
  expect(newReds(pushed, new Map([['test/a.test.ts', new Set(['test/a.test.ts::a old'])], ['test/b.test.ts', new Set(['test/b.test.ts::(file)'])]]))).toEqual([]);
  expect(newReds(pushed, new Map([['test/a.test.ts', new Set(['test/a.test.ts::a old'])]]))).toEqual(['test/b.test.ts::(file)']);
  expect(failingIds(join(work, 'missing.json'), work)).toBeNull();
});

test('main\'s reds are run once per origin/main SHA and cached; later pushes read the cache', async () => {
  const remote = join(work, 'remote.git'), clone = join(work, 'clone');
  git(work, 'init', '--quiet', '--bare', '--initial-branch=main', remote);
  git(work, 'clone', '--quiet', remote, clone);
  writeFileSync(join(clone, 'x.txt'), 'x\n');
  git(clone, 'add', 'x.txt'); git(clone, 'commit', '--quiet', '-m', 'x'); git(clone, 'push', '--quiet', 'origin', 'main');
  let runs = 0;
  const options = {
    say: () => undefined,
    copy: () => Promise.resolve({ path: join(work, 'main-copy'), remove: () => undefined }),
    run: (_cwd, files, out) => { runs++; report(out, files.map(name => ({ name: join(work, 'main-copy', name), status: 'failed', assertionResults: [{ fullName: 'a old', status: 'failed' }] }))); },
  };
  const first = await mainReds(clone, ['test/a.test.ts'], options);
  expect(first.main.get('test/a.test.ts')).toEqual(new Set(['test/a.test.ts::a old']));
  const again = await mainReds(clone, ['test/a.test.ts'], options);
  expect(again.main).toEqual(first.main);
  expect(runs).toBe(1);
  writeCache(cacheFile(clone, first.sha), { 'test/z.test.ts': [] });
  expect((await mainReds(clone, ['test/z.test.ts'], options)).main.get('test/z.test.ts')).toEqual(new Set());
  expect(runs).toBe(1);
});

test('a main-push gated commit stays gated after a replay onto a newer main; an ungated carried commit is not', () => {
  const remote = join(work, 'remote2.git'), a = join(work, 'a'), b = join(work, 'b');
  git(work, 'init', '--quiet', '--bare', '--initial-branch=main', remote);
  for (const dir of [a, b]) git(work, 'clone', '--quiet', remote, dir);
  writeFileSync(join(a, 'seed.txt'), 'seed\n'); git(a, 'add', 'seed.txt'); git(a, 'commit', '--quiet', '-m', 'seed'); git(a, 'push', '--quiet', 'origin', 'main');
  git(b, 'pull', '--quiet', 'origin', 'main');
  writeFileSync(join(a, 'mine.txt'), 'mine\n'); git(a, 'add', 'mine.txt'); git(a, 'commit', '--quiet', '-m', 'mine');
  const base = git(a, 'rev-parse', 'origin/main');
  expect(markGated(a, `${base}..HEAD`)).toBe(1);
  // Another lane pushes; A's commit is replayed onto it: a new SHA, the same patch id.
  writeFileSync(join(b, 'other.txt'), 'other\n'); git(b, 'add', 'other.txt'); git(b, 'commit', '--quiet', '-m', 'other'); git(b, 'push', '--quiet', 'origin', 'main');
  git(a, 'fetch', '--quiet', 'origin', 'main');
  const upstream = git(a, 'rev-parse', 'origin/main');
  const replayed = git(a, 'replay', '--ref-action=print', '--onto', upstream, `${base}..main`).split(/\s+/u)[2];
  expect(pregated(a, `refs/heads/main ${replayed} refs/heads/main ${upstream}`)).toBe(1);
  // A carried commit nobody gated keeps the gate.
  git(a, 'update-ref', 'refs/heads/main', replayed); git(a, 'reset', '--quiet', '--hard', replayed);
  writeFileSync(join(a, 'carried.txt'), 'c\n'); git(a, 'add', 'carried.txt'); git(a, 'commit', '--quiet', '-m', 'carried');
  expect(pregated(a, `refs/heads/main ${git(a, 'rev-parse', 'HEAD')} refs/heads/main ${upstream}`)).toBeNull();
  expect(pregated(a, `refs/heads/plan/x ${replayed} refs/heads/plan/x ${upstream}`)).toBeNull();
});

// 2026-11-19: opus-of19b0's Brasscap ring re-record (d2cef3cd8) needed ALLOW_PIN_PUSH=1 from engine-quickfix: main-push's
// early gate ran the pre-push without FS18's marker, so pin provenance refused the route its own message recommends.
test('the gate before the lock carries main-push\'s own marker for its HEAD', async () => {
  const remote = join(work, 'marked.git'), clone = join(work, 'marked');
  git(work, 'init', '--quiet', '--bare', '--initial-branch=main', remote);
  git(work, 'clone', '--quiet', remote, clone);
  writeFileSync(join(clone, 'seed.txt'), 'seed\n'); git(clone, 'add', 'seed.txt'); git(clone, 'commit', '--quiet', '-m', 'seed'); git(clone, 'push', '--quiet', 'origin', 'main');
  // Row 58: main-push gates only the pushing lane's own commits, so the fixture commit names the lane that pushes it.
  writeFileSync(join(clone, 'pin.txt'), 'pin\n'); git(clone, 'add', 'pin.txt'); git(clone, 'commit', '--quiet', '-m', 'pin', '-m', 'Lane: push-known-red');
  const seen = join(work, 'marked-env.txt');
  mkdirSync(join(clone, '.githooks'), { recursive: true });
  writeFileSync(join(clone, '.githooks/pre-push'), `#!/usr/bin/env bash\ncat >/dev/null\nprintf '%s' "$WS_LAND_MAIN_PUSH" > '${seen}'\n`);
  chmodSync(join(clone, '.githooks/pre-push'), 0o755);
  const before = process.env.WS_LANE_NAME;
  process.env.WS_LANE_NAME = 'push-known-red';
  try {
    expect(await pregate(clone, () => undefined)).toMatch(/gate green before the lock/u);
  } finally {
    if (before === undefined) delete process.env.WS_LANE_NAME; else process.env.WS_LANE_NAME = before;
  }
  expect(readFileSync(seen, 'utf8')).toBe(`main-push:${git(clone, 'rev-parse', 'HEAD')}`);
});

// Engine main red 45676829545 (row 58's c30f9fd93): CI runs with no lane name, and main-push then left every unnamed
// commit as another lane's, so it gated nothing. A pusher with no lane name sends unnamed commits; a named lane leaves
// them, and any commit naming another lane.
test('a pusher with no lane name sends unnamed commits; a named lane leaves them and other lanes\' commits', () => {
  const remote = join(work, 'unnamed.git'), clone = join(work, 'unnamed');
  git(work, 'init', '--quiet', '--bare', '--initial-branch=main', remote);
  git(work, 'clone', '--quiet', remote, clone);
  writeFileSync(join(clone, 'seed.txt'), 'seed\n'); git(clone, 'add', 'seed.txt'); git(clone, 'commit', '--quiet', '-m', 'seed'); git(clone, 'push', '--quiet', 'origin', 'main');
  const base = git(clone, 'rev-parse', 'HEAD');
  writeFileSync(join(clone, 'a.txt'), 'a\n'); git(clone, 'add', 'a.txt'); git(clone, 'commit', '--quiet', '-m', 'unnamed');
  writeFileSync(join(clone, 'b.txt'), 'b\n'); git(clone, 'add', 'b.txt'); git(clone, 'commit', '--quiet', '-m', 'theirs', '-m', 'Lane: other-lane');
  const head = git(clone, 'rev-parse', 'HEAD');
  const before = process.env.WS_LANE_NAME;
  try {
    delete process.env.WS_LANE_NAME;
    const unnamed = ownCommits(clone, base, head);
    expect(unnamed.left.map(row => row.lane)).toEqual(['other-lane']);
    expect(unnamed.own).toBe(1);
    process.env.WS_LANE_NAME = 'push-known-red';
    const named = ownCommits(clone, base, head);
    expect(named.left.map(row => row.lane)).toEqual([null, 'other-lane']);
    expect(named.sha).toBe(base);
  } finally {
    if (before === undefined) delete process.env.WS_LANE_NAME; else process.env.WS_LANE_NAME = before;
  }
});

// Engine main red 45681838337: on the CI runner git has no committer identity, so `git replay` refused to write a commit and
// main-push called that a conflict with another lane's commit. A replay git itself refuses now says git's own words.
test('a replay git refuses (no committer identity, as on CI) names git\'s reason, not a conflict', () => {
  const remote = join(work, 'noident.git'), clone = join(work, 'noident'), home = join(work, 'noident-home');
  git(work, 'init', '--quiet', '--bare', '--initial-branch=main', remote);
  git(work, 'clone', '--quiet', remote, clone);
  writeFileSync(join(clone, 'seed.txt'), 'seed\n'); git(clone, 'add', 'seed.txt'); git(clone, 'commit', '--quiet', '-m', 'seed'); git(clone, 'push', '--quiet', 'origin', 'main');
  const base = git(clone, 'rev-parse', 'HEAD');
  writeFileSync(join(clone, 'b.txt'), 'b\n'); git(clone, 'add', 'b.txt'); git(clone, 'commit', '--quiet', '-m', 'theirs', '-m', 'Lane: other-lane');
  writeFileSync(join(clone, 'a.txt'), 'a\n'); git(clone, 'add', 'a.txt'); git(clone, 'commit', '--quiet', '-m', 'mine', '-m', 'Lane: push-known-red');
  mkdirSync(home, { recursive: true });
  writeFileSync(join(home, '.gitconfig'), '[user]\n\tuseConfigOnly = true\n');
  const saved = { lane: process.env.WS_LANE_NAME, home: process.env.HOME, xdg: process.env.XDG_CONFIG_HOME };
  try {
    process.env.WS_LANE_NAME = 'push-known-red'; process.env.HOME = home; process.env.XDG_CONFIG_HOME = home;
    expect(() => ownCommits(clone, base, git(clone, 'rev-parse', 'HEAD'))).toThrow(/^git replay could not move your commit [0-9a-f]{10} past another lane's \(row 58\): .*(email|identity)/u);
  } finally {
    for (const [key, value] of [['WS_LANE_NAME', saved.lane], ['HOME', saved.home], ['XDG_CONFIG_HOME', saved.xdg]]) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
