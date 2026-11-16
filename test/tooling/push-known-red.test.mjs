import { afterAll, expect, test } from 'vitest';
// oxlint-disable-next-line import/no-nodejs-modules -- Real git repositories and a Vitest JSON report on disk.
import { spawnSync } from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- Real git repositories and a Vitest JSON report on disk.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Real git repositories and a Vitest JSON report on disk.
import { join } from 'node:path';
import { failingIds, mainReds, newReds, writeCache, cacheFile } from '../../scripts/push-known-red.mjs';
import { markGated, pregated } from '../../scripts/main-push-gated.mjs';

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
