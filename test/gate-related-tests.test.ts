import { afterAll, expect, it } from 'vitest';
// oxlint-disable-next-line import/no-nodejs-modules -- Real owned Git fixtures and a real log file.
import {execFileSync} from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- Real owned Git fixtures and a real log file.
import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Real owned Git fixtures and a real log file.
import {join, resolve} from 'node:path';
import {BROWSER_TESTS, LOCAL_FILE_SECONDS, NATIVE_TESTS, TIMING_TESTS, hostedOnlyReason, logHostedOnly, planBaseRefs, splitLocalTests, splitRequested} from '../scripts/push-local-split.mjs';
import {codeProvingJobs, githubSlug, hostedGreen, landingVerdict} from '../scripts/push-hosted-green.mjs';
import { capRelated, productReaderTests, scriptScenarioTests, QUICK_TESTS, pushGuards, forceRerunTriggers } from '../scripts/gate-related-tests.mjs';

const durations = new Map([['test/slow.test.ts', 40], ['test/cheap.test.ts', 1], ['test/mid.test.ts', 8], ['test/cover-grid.test.ts', 30]]);
const related = [...durations.keys()];

it('requires guards and limits forced reruns to root configuration', () => {
  const fixed = ['test/host-callbacks.test.ts', 'test/shardfile-boundaries.test.ts',
    'test/platform-chargebacks.test.ts', 'test/manifest-declarations.test.ts'];
  expect(pushGuards([])).toEqual(fixed);
  expect(pushGuards(['src/game/world.ts'])).toEqual(fixed);
  for (const root of ['format', 'sdk']) expect(pushGuards([`src/${root}/package.json`]))
    .toEqual(['test/schema-reference.test.ts', ...fixed]);
  expect(forceRerunTriggers('/repo')).toEqual(['/repo/package.json', '/repo/{vitest,vite}.config.*']);
});

it('runs every related test file when the estimate fits the budget', () => {
  expect(capRelated(related, ['src/x.ts'], durations, 45, 4)).toEqual({ run: [...related].sort(), left: [] });
});

it('runs the files named after a changed source first, then the cheapest, and leaves the rest to CI', () => {
  // Budget (45 - 5) × 2 = 80 test seconds; each file adds 0.5 s of module load.
  expect(capRelated(related, ['src/world/coverGrid.ts'], durations, 45, 2))
    .toEqual({ run: ['test/cheap.test.ts', 'test/cover-grid.test.ts', 'test/mid.test.ts'], left: ['test/slow.test.ts'] });
});

it('always runs a changed test file, even one the import walk did not return', () => {
  for (const path of ['test/new.test.ts','test/tooling/example.test.mjs','src/shared/engine/boot/waits.test.ts','src/game/quest/core.test.ts','src/format/rows.test.ts']) {
    expect(capRelated([], [path, 'src/a.ts'], durations, 0, 1)).toEqual({ run: [path], left: [] });
  }
});

it('does not claim changed MJS files outside the runner MJS include', () => {
  for (const path of ['src/shared/engine/boot/waits.test.mjs', 'admin/test/only.test.mjs', 'drafts/test/only.test.mjs']) {
    expect(capRelated([], [path], durations, 0, 1)).toEqual({run: [], left: []});
  }
});

const scenarios = ['test/scripts/far-reach-roc.test.ts', 'test/scripts/far-reach-gust.test.ts', 'test/scripts/sunscar-dunes-matriarch.test.ts'];

it('maps changed and removed Wasm author sources without an import edge', () => {
  expect(scriptScenarioTests(['src/shards/far-reach/behaviour/roc.as'], scenarios)).toEqual([scenarios[0]]);
  expect(scriptScenarioTests(['src/shards/sunscar-dunes/behaviour/matriarch.as'], scenarios)).toEqual([scenarios[2]]);
});

it('selects shard scenarios for composed script rows and build bindings', () => {
  for (const file of ['data/scripts.ts', 'data/encounters.ts', 'generators/product.ts', 'shard.config.ts', 'behaviour/generated/roc.ts']) {
    expect(scriptScenarioTests([`src/shards/far-reach/${file}`], scenarios)).toEqual([scenarios[1], scenarios[0]]);
  }
  expect(scriptScenarioTests(['src/shards/far-reach/runtime/index.ts', 'src/engine/renderer.ts'], scenarios)).toEqual([]);
});

it('keeps required scenarios once even when the related-test budget is exhausted', () => {
  const scenario = 'test/scripts/far-reach-roc.test.ts';
  expect(capRelated([scenario, 'test/slow.test.ts'], [], new Map([[scenario, 3]]), 0, 1, [scenario, scenario]))
    .toEqual({ run: [scenario], left: ['test/slow.test.ts'] });
});

it('preserves author-source edges for tests consuming complete disk products', () => {
  const registry = { 'test/npc.test.ts': ['pine-hollow'], 'test/scripts/captain.test.ts': ['driftwood-isle', 'pine-hollow'] };
  expect(productReaderTests(['src/shards/pine-hollow/generators/sourceOutput.ts'], registry)).toEqual(Object.keys(registry));
  expect(productReaderTests(['src/shards/driftwood-isle/assets/removed'], registry)).toEqual(['test/scripts/captain.test.ts']);
  expect(productReaderTests(['src/sharddev/project.ts'], registry)).toEqual(Object.keys(registry));
  expect(productReaderTests(['scripts/test-products.json'], registry)).toEqual(Object.keys(registry));
  expect(productReaderTests(['src/shards/far-reach/data/rows.json', 'docs/ENGINE.md'], registry)).toEqual([]);
});

it('keeps all grid re-entry quick checks on an unrelated push with no budget', () => {
  expect(QUICK_TESTS).toEqual(['test/grid-reentry.test.ts']);
  expect(capRelated([], ['docs/ENGINE.md'], new Map(), 0, 1, QUICK_TESTS).run).toEqual([...QUICK_TESTS].sort());
});

// DEV-SPEED DS9 (J222/J240): the split pre-push and the landing's hosted-green reuse.
const zero = '0'.repeat(40), a = 'a'.repeat(40), b = 'b'.repeat(40);
mkdirSync('tmp', {recursive: true});
const scratch = mkdtempSync(resolve('tmp/push-split-'));
afterAll(() => rmSync(scratch, {recursive: true, force: true}));

it('only plan branch pushes or a watching driver ask for the split', () => {
  expect(splitRequested({}, `refs/heads/plan/foo ${a} refs/heads/plan/foo ${zero}`)).toBe(true);
  expect(splitRequested({}, `refs/heads/plan/foo ${a} refs/heads/plan/foo ${b}\nrefs/heads/plan/bar ${b} refs/heads/plan/bar ${a}`)).toBe(true);
  expect(splitRequested({}, `refs/heads/main ${a} refs/heads/main ${b}`)).toBe(false);
  expect(splitRequested({}, `refs/heads/plan/foo ${a} refs/heads/plan/foo ${b}\nrefs/heads/main ${a} refs/heads/main ${b}`)).toBe(false);
  expect(splitRequested({}, `refs/tags/v1.0.0 ${a} refs/tags/v1.0.0 ${zero}`)).toBe(false);
  expect(splitRequested({}, `refs/heads/feature/x ${a} refs/heads/feature/x ${zero}`)).toBe(false);
  // Deleting a plan branch pushes nothing to check.
  expect(splitRequested({}, `(delete) ${zero} refs/heads/plan/foo ${a}`)).toBe(false);
  expect(splitRequested({}, '')).toBe(false);
  expect(splitRequested({WS_PUSH_POST_CI: '1'}, `refs/heads/main ${a} refs/heads/main ${b}`)).toBe(true);
  // The watching-driver flag never splits a tag, another branch or a release check (no refs).
  expect(splitRequested({WS_PUSH_POST_CI: '1'}, `refs/tags/v1.0.0 ${a} refs/tags/v1.0.0 ${zero}`)).toBe(false);
  expect(splitRequested({WS_PUSH_POST_CI: '1'}, `refs/heads/main ${a} refs/heads/main ${b}\nrefs/tags/v1.0.0 ${a} refs/tags/v1.0.0 ${zero}`)).toBe(false);
  expect(splitRequested({WS_PUSH_POST_CI: '1'}, `refs/heads/feature/x ${a} refs/heads/feature/x ${zero}`)).toBe(false);
  expect(splitRequested({WS_PUSH_POST_CI: '1'}, undefined)).toBe(false);
  // Hosted CI never runs a split of itself.
  expect(splitRequested({CI: 'true', WS_PUSH_POST_CI: '1'}, `refs/heads/plan/foo ${a} refs/heads/plan/foo ${zero}`)).toBe(false);
  expect(splitRequested({GITHUB_ACTIONS: 'true'}, `refs/heads/plan/foo ${a} refs/heads/plan/foo ${zero}`)).toBe(false);
});

it('a first plan push selects against its merge-base with origin/main', () => {
  const repo = join(scratch, 'repo');
  mkdirSync(repo);
  const git = (...args: string[]): string => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...args], {cwd: repo, encoding: 'utf8'}).trim();
  git('init', '--quiet', '--initial-branch=main');
  writeFileSync(join(repo, 'one.txt'), '1\n');
  git('add', 'one.txt');
  git('commit', '--quiet', '--no-verify', '-m', 'one');
  const base = git('rev-parse', 'HEAD');
  git('update-ref', 'refs/remotes/origin/main', base);
  git('switch', '--quiet', '-c', 'plan/foo');
  writeFileSync(join(repo, 'two.txt'), '2\n');
  git('add', 'two.txt');
  git('commit', '--quiet', '--no-verify', '-m', 'two');
  const tip = git('rev-parse', 'HEAD');
  expect(planBaseRefs(`refs/heads/plan/foo ${tip} refs/heads/plan/foo ${zero}`, repo)).toBe(`refs/heads/plan/foo ${tip} refs/heads/plan/foo ${base}`);
  // An existing remote tip, main and unknown history are left exactly as Git sent them.
  for (const line of [`refs/heads/plan/foo ${tip} refs/heads/plan/foo ${base}`, `refs/heads/main ${tip} refs/heads/main ${zero}`, `refs/heads/plan/foo ${a} refs/heads/plan/foo ${zero}`]) {
    expect(planBaseRefs(line, repo)).toBe(line);
  }
});

it('browser, timing and slow files go to hosted CI; an unmeasured file stays local', () => {
  const slow = 'test/slow-fixture.test.ts', quick = 'test/quick-fixture.test.ts';
  const seconds: Record<string, number> = {[slow]: LOCAL_FILE_SECONDS + 5, [quick]: 0.5};
  const browser = BROWSER_TESTS[0], timing = TIMING_TESTS[0];
  if (browser === undefined || timing === undefined) throw new Error('empty hosted-only lists');
  expect(hostedOnlyReason(browser, seconds)).toBe('browser');
  expect(hostedOnlyReason(timing, seconds)).toBe('timing');
  expect(hostedOnlyReason(slow, seconds)).toMatch(/^over 20 s/u);
  expect(hostedOnlyReason(quick, seconds)).toBeNull();
  // A planted 25 s file lands on the hosted-only list.
  expect(hostedOnlyReason('test/planted.test.ts', {'test/planted.test.ts': 25})).toBe('over 20 s (25.0 s)');
  const related = splitLocalTests({mode: 'related', tests: [slow, quick, browser, timing]}, seconds);
  expect(related.local).toEqual([quick]);
  expect(related.hosted.map(row => row.file).sort()).toEqual([slow, browser, timing].sort());
  // LS2: a file main's last run never measured (a new one) has no clock and stays local.
  expect(splitLocalTests({mode: 'related', tests: [quick, 'test/new-fixture.test.ts']}, seconds).local).toEqual([quick, 'test/new-fixture.test.ts'].sort());
  // A full-mode change (harness, unknown path) keeps only the quick declared native files local.
  const native = splitLocalTests({mode: 'full'}, seconds);
  expect(native.local.length).toBeGreaterThan(0);
  for (const file of native.local) expect(NATIVE_TESTS).toContain(file);
  for (const file of native.local) expect(hostedOnlyReason(file, seconds)).toBeNull();
  expect(splitLocalTests({mode: 'docs'}, seconds).local).toEqual([]);
});

it('every Vitest file that launches a real browser is on the browser list', () => {
  const launches = execFileSync('git', ['grep', '-l', '-E', String.raw`\.launch\(|launchPersistentContext|connectOverCDP`, '--', '*.test.ts', '*.test.mjs'], {encoding: 'utf8'}).trim().split('\n');
  // boot-dist-transfer only names a launch in a refusal message; this file only names the pattern.
  for (const file of launches.filter(path => path !== 'test/boot-dist-transfer.test.ts' && path !== 'test/gate-related-tests.test.ts')) expect(BROWSER_TESTS).toContain(file);
});

it('only files over the budget are logged for VITEST-BENCH', () => {
  const file = join(scratch, 'bench', 'hosted-only.log');
  logHostedOnly([{file: 'test/a.test.ts', reason: 'browser'}, {file: 'test/b.test.ts', reason: 'over 20 s (25.0 s)'}], {sha: a, lane: 'opus-x'}, file);
  const rows = readFileSync(file, 'utf8').trim().split('\n').map(line => JSON.parse(line) as {file: string, sha: string, lane: string});
  expect(rows.map(row => [row.file, row.sha, row.lane])).toEqual([['test/b.test.ts', a, 'opus-x']]);
});

it('a landing reuses only an exact SHA whose ci is green (CI-JOB-PACKING: ring-1 is part of ci)', () => {
  const run = (id: number, name: string, conclusion: string | null, status = 'completed', sha = a, event = 'push') => ({id, name, path: `.github/workflows/${name}.yml`, event, head_sha: sha, status, conclusion});
  expect(landingVerdict({workflow_runs: [run(1, 'ci', 'success')]}, a).state).toBe('green');
  expect(landingVerdict({workflow_runs: [run(1, 'ci', null, 'in_progress')]}, a).state).toBe('pending');
  expect(landingVerdict({workflow_runs: [run(1, 'ci', 'failure')]}, a).state).toBe('red');
  // An old ring-1 run of the same SHA neither blocks nor stands in.
  expect(landingVerdict({workflow_runs: [run(1, 'ci', 'success'), run(2, 'ring-1', 'failure')]}, a).state).toBe('green');
  expect(landingVerdict({workflow_runs: [run(2, 'ring-1', 'success')]}, a).state).toBe('pending');
  // The newest run decides: a re-run green replaces an older red.
  expect(landingVerdict({workflow_runs: [run(1, 'ci', 'failure'), run(3, 'ci', 'success')]}, a).state).toBe('green');
  expect(landingVerdict({workflow_runs: [run(3, 'ci', 'cancelled'), run(1, 'ci', 'success')]}, a).state).toBe('red');
  // Another SHA's runs and other workflows prove nothing.
  expect(landingVerdict({workflow_runs: [run(1, 'ci', 'success', 'completed', b), run(4, 'deploy', 'success')]}, a).state).toBe('pending');
  expect(landingVerdict(null, a).state).toBe('pending');
  // A pull-request run or a recording dispatch of the same SHA proves nothing here.
  expect(landingVerdict({workflow_runs: [run(1, 'ci', 'success', 'completed', a, 'pull_request')]}, a).state).toBe('pending');
  expect(landingVerdict({workflow_runs: [run(1, 'ci', 'success', 'completed', a, 'workflow_dispatch')]}, a).state).toBe('pending');
  const job = (name: string, conclusion = 'success') => ({name, status: 'completed', conclusion});
  const code = {jobs: [job('changes'), job('static'), job('plan'), job('e2e'), job('tests (1)'), job('tests (2)')]};
  expect(codeProvingJobs(code)).toBe(true);
  // A docs-only run skips plan, tests and e2e: not a code proof.
  expect(codeProvingJobs({jobs: [job('changes'), job('static'), job('plan', 'skipped'), job('e2e', 'skipped')]})).toBe(false);
  expect(codeProvingJobs({jobs: [job('changes'), job('static'), job('plan'), job('e2e'), job('tests (1)'), job('tests (2)', 'failure')]})).toBe(false);
  // CI-JOB-PACKING (J244): a packed ci run is its `tests (N)` shares, each of which ran its packed step.
  const share = (name: string, step = 'success', conclusion = 'success') => ({...job(name, conclusion), steps: [{name: "Run this job's packed share", status: 'completed', conclusion: step}]});
  expect(codeProvingJobs({jobs: [share('tests (1)'), share('tests (2)'), share('tests (3)'), job('quarantine', 'failure')]})).toBe(true);
  // A reused or docs-only run is green with the packed step skipped: never a code proof.
  expect(codeProvingJobs({jobs: [share('tests (1)', 'skipped'), share('tests (2)', 'skipped'), job('quarantine')]})).toBe(false);
  expect(codeProvingJobs({jobs: [share('tests (1)'), share('tests (2)', 'skipped')]})).toBe(false);
  expect(codeProvingJobs({jobs: [job('tests (1)'), job('tests (2)')]})).toBe(false);
  expect(codeProvingJobs({jobs: [job('quarantine')]})).toBe(false);
  expect(githubSlug('git@github.com:project-wildshard/engine.git')).toBe('project-wildshard/engine');
  expect(githubSlug('https://github.com/project-wildshard/engine')).toBe('project-wildshard/engine');
  expect(githubSlug('/local/path/engine.git')).toBeNull();
  const paths: string[] = [];
  const green = (path: string) => {paths.push(path); return path.includes('/jobs') ? code : {workflow_runs: [run(7, 'ci', 'success')]};};
  expect(hostedGreen(a, 'git@github.com:project-wildshard/engine.git', green)).toEqual({ci: {id: 7, status: 'completed', conclusion: 'success'}});
  expect(paths).toEqual([`repos/project-wildshard/engine/actions/runs?head_sha=${a}&event=push&per_page=100`, 'repos/project-wildshard/engine/actions/runs/7/jobs?filter=latest&per_page=100']);
  expect(hostedGreen(a, 'git@github.com:project-wildshard/engine.git', path => path.includes('/jobs') ? {jobs: [job('changes'), job('static')]} : green(path))).toBeNull();
  expect(hostedGreen(a, 'git@github.com:project-wildshard/engine.git', () => {throw new Error('offline');})).toBeNull();
  expect(hostedGreen('HEAD', 'git@github.com:project-wildshard/engine.git', green)).toBeNull();
});
