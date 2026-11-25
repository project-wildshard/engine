import { afterAll, expect, it } from 'vitest';
// oxlint-disable-next-line import/no-nodejs-modules -- A real owned Git fixture for the Ring 1 slug read.
import { execFileSync } from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- A real owned Git fixture for the Ring 1 slug read.
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- A real owned Git fixture for the Ring 1 slug read.
import { join, resolve } from 'node:path';
import { FS27_STATIC, PATH_EDGES, TABLE_TESTS, fs27Plan, movedRingSlugs, pinChanges, simRingSlugs } from '../scripts/push-path-edges.mjs';
import { shardPinTests } from '../scripts/gate-related-tests.mjs';
import { staticChecks } from '../.githooks/push-checks.mjs';

// FLOW-SIMPLE FS27: each row is a push that reached main untested on 2026-11-19 and went red there. The gate must
// run the named reader for it, or this file fails.
const PUSHES: { why: string; changed: string; tests?: string[]; static?: string }[] = [
  { why: 'shard pin', changed: 'test/pins/shardfiles.json', tests: ['test/pin-shard.test.ts', 'test/racked-prompt.test.ts'] },
  { why: 'format section', changed: 'pnpm-lock.yaml', tests: ['test/host-ruler-roots.test.ts'] },
  { why: 'save key', changed: 'src/shared/engine/saves/saves.lock.json', static: 'check:saves' },
  { why: 'precompile', changed: 'src/client/engine/render/precompile.ts', tests: ['src/client/engine/render/precompile-first-view.test.ts'] },
  { why: 'loading card', changed: 'src/client/engine/ui/loading.css', tests: ['test/inline-shell-css.test.mjs'], static: 'check:inline-shell-css' },
  { why: 'chrome-keychain', changed: 'scripts/chromium-keychain.mjs', tests: ['test/tooling/chrome-keychain.test.mjs'] },
  { why: 'gate-related-tests', changed: 'scripts/gate-related-tests.mjs', tests: ['test/gate-related-tests.test.ts'] },
];

const staticNames = [...staticChecks(), ...FS27_STATIC].map(task => task.name);

it('holds a push for every declared edge', () => {
  expect(PUSHES.map(push => push.why).sort()).toEqual(PATH_EDGES.map(row => row.why).sort());
});

for (const push of PUSHES) {
  it(`runs the ${push.why} reader when ${push.changed} changes`, () => {
    for (const split of [true, false]) {
      const plan = fs27Plan({ mode: 'related', files: [push.changed] }, { split, slugs: [] });
      for (const test of push.tests ?? []) expect(plan.tests).toContain(test);
    }
    // A split full gate (a harness change such as a pin) keeps the readers local instead of sending them to hosted CI.
    const full = fs27Plan({ mode: 'full', files: [push.changed] }, { split: true, slugs: [] });
    for (const test of push.tests ?? []) expect(full.tests).toContain(test);
    if (push.static !== undefined) expect(staticNames).toContain(push.static);
  });
}

it('names only reader files that exist', () => {
  for (const file of [...TABLE_TESTS, ...PATH_EDGES.flatMap(row => row.tests ?? [])]) expect(existsSync(file), file).toBe(true);
});

it('runs check-css, agent-markers and the host-ruler tables on every code push, and nothing on a docs push', () => {
  expect(staticNames).toContain('check-css');
  expect(staticNames).toContain('agent-markers');
  const plan = fs27Plan({ mode: 'related', files: ['src/client/engine/ui/hud.ts'] }, { split: true, slugs: [] });
  expect(plan.tests).toEqual([...TABLE_TESTS]);
  expect(plan.tasks.map(task => task.name)).toEqual(['check-css', 'agent-markers']);
  expect(fs27Plan({ mode: 'docs', files: ['docs/dev.md'] }, { split: true, slugs: [] })).toEqual({ tasks: [], tests: [] });
  // The non-split full gate already runs the whole suite.
  expect(fs27Plan({ mode: 'full', files: ['package.json'] }, { split: false, slugs: [] }).tests).toEqual([]);
});

it('steps every Ring 1 slug when sim-state source changes, as FP53b needed (run 45597738510)', () => {
  const digests = { 'linux-x64': { 240: { 'far-reach': ['a'], 'sunscar-dunes': ['b'] } }, 'darwin-arm64': { 240: { 'pine-hollow': ['c'] } } };
  for (const file of ['src/server/game/plugin/simulation.ts', 'src/shared/engine/sim/snapshot.ts', 'src/server/engine/sim.ts', 'src/server/game/shardfile/homeKeeper.ts'])
    expect(simRingSlugs([file], digests, 'linux-x64')).toEqual(['far-reach', 'sunscar-dunes']);
  expect(simRingSlugs(['src/client/engine/ui/hud.ts', 'src/server/game/plugin/brain.test.ts', 'docs/dev.md'], digests, 'linux-x64')).toEqual([]);
  expect(simRingSlugs(['src/server/engine/sim.ts'], digests, 'win32-x64')).toEqual([]);
});

it('steps only the Ring 1 slugs a pin or digest change moves', () => {
  const pins = (revision: number) => ({ shards: { 0: { slug: 'far-reach', revision }, 1: { slug: 'pine-hollow', revision: 1 } } });
  const digests = (hash: string) => ({ 'linux-x64': { 240: { 'far-reach': ['a'], 'pine-hollow': [hash] } } });
  expect(movedRingSlugs({ pins: pins(1), digests: digests('a') }, { pins: pins(2), digests: digests('a') }, 'linux-x64')).toEqual(['far-reach']);
  expect(movedRingSlugs({ pins: pins(1), digests: digests('a') }, { pins: pins(1), digests: digests('b') }, 'linux-x64')).toEqual(['pine-hollow']);
  expect(movedRingSlugs({ pins: pins(1), digests: digests('a') }, { pins: pins(1), digests: digests('a') }, 'linux-x64')).toEqual([]);
  const plan = fs27Plan({ mode: 'full', files: ['test/pins/shardfiles.json'] }, { split: true, slugs: ['far-reach'] });
  expect(plan.tasks.at(-1)?.commands.map(command => command.slice(1))).toEqual([
    ['scripts/pins.ts', 'install', '--ring-slices', '1'],
    ['--no-warnings', 'scripts/ring-step.ts', '--only', 'far-reach'],
  ]);
});

mkdirSync(resolve('tmp'), { recursive: true });
const repo = mkdtempSync(resolve('tmp', 'push-path-edges-'));
afterAll(() => rmSync(repo, { recursive: true, force: true }));

it('adds only tests that name the moved pin, including a shard outside Ring 1', () => {
  const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
  const write = (file: string, body: string): void => { writeFileSync(join(repo, file), body); };
  const commit = (revision: number) => {
    write('test/pins/shardfiles.json', JSON.stringify({ shards: [
      { slug: 'brasscap-mesa', revision }, { slug: 'open-plot-4-1', revision }, { slug: 'pine-hollow', revision: 7 },
    ] }));
    write('test/pins/ring-digests.json', JSON.stringify({ 'linux-x64': { 240: { 'brasscap-mesa': ['h'], 'pine-hollow': ['h'] } } }));
    git('add', 'test', 'src', 'scripts');
    git('-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', `r${revision}`, '--no-verify');
    return git('rev-parse', 'HEAD');
  };
  git('init', '-q');
  mkdirSync(join(repo, 'test/pins'), { recursive: true });
  mkdirSync(join(repo, 'scripts'));
  mkdirSync(join(repo, 'src/client/app'), { recursive: true });
  mkdirSync(join(repo, 'src/cli'), { recursive: true });
  write('test/released-save.test.ts', "test('resume', () => restore('brasscap-mesa'));");
  write('test/related-plot.test.mjs', "test('walk', () => enter('open-plot-4-1'));");
  write('test/registered.test.ts', "test('read installed product', () => assert(true));");
  write('scripts/test-folders.json', JSON.stringify({ 'test/registered.test.ts': ['open-plot-4-1'] }));
  write('test/unrelated.test.ts', "test('walk', () => enter('pine-hollow'));");
  write('test/other-plot.test.ts', "test('walk', () => enter('open-plot-4-10'));");
  write('src/client/app/brasscap-mesa-entry.test.ts', "test('entry', () => assert(true));");
  write('src/cli/not-vitest.test.ts', "test('open-plot-4-1', () => assert(true));");
  const [before, after] = [commit(12), commit(13)];
  const changed = pinChanges(`refs/heads/main ${after} refs/heads/main ${before}\n`, repo, 'linux-x64');
  expect(changed).toEqual({ pins: ['brasscap-mesa', 'open-plot-4-1'], ring: ['brasscap-mesa'] });
  expect(shardPinTests(repo, changed.pins)).toEqual([
    'src/client/app/brasscap-mesa-entry.test.ts', 'test/registered.test.ts', 'test/related-plot.test.mjs', 'test/released-save.test.ts',
  ]);
  const unchanged = pinChanges(`refs/heads/main ${after} refs/heads/main ${after}\n`, repo, 'linux-x64');
  expect(unchanged).toEqual({ pins: [], ring: [] });
  expect(shardPinTests(repo, unchanged.pins)).toEqual([]);
});
