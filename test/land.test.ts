// J240 / DEV-SPEED DS21: scripts/land.mjs against real git. A bare repo stands
// in for GitHub (with protect-main's no-force, no-delete rule as an update
// hook), a post-receive hook records every pushed tip, and a fake `gh` on PATH
// answers Actions queries only for SHAs that were really pushed.
// oxlint-disable-next-line import/no-nodejs-modules -- Fixture repositories stay in the repository scratch root.
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- A local Actions API double for the main-run reuse check.
import { createServer } from 'node:http';
// oxlint-disable-next-line import/no-nodejs-modules -- Evaluate ci.yml's real concurrency-key expressions.
import { runInNewContext } from 'node:vm';
// oxlint-disable-next-line import/no-nodejs-modules -- Fixture paths.
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { exactBranchProof } from '../scripts/ci-exact-reuse.mjs';
import { packUnits, runUnits } from '../scripts/ci-pack.mjs';
import { failedJobs, flakyFiles, quarantineFile, shaVerdict, strikePlans } from '../scripts/land.mjs';
import { cleanLandFixtures, fixture, trackLandFixtureRoot } from './fixtures/land-git';

afterEach(cleanLandFixtures);

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

function ciJob(name: string): string {
  const text = readFileSync('.github/workflows/ci.yml', 'utf8');
  const start = text.indexOf(`\n  ${name}:\n`);
  if (start === -1) throw new Error(`ci.yml has no ${name} job`);
  const next = text.slice(start + 1).search(/\n {2}[a-z][a-z0-9_-]*:\n/u);
  return next === -1 ? text.slice(start) : text.slice(start, start + 1 + next);
}

test('boundaries stays blocking and independent; J400 moves quarantine to reports', () => {
  for (const name of ['boundaries']) {
    const block = ciJob(name);
    expect(block, name).toContain("    if: ${{ !startsWith(github.ref, 'refs/heads/plan/') }}");
    expect(block).not.toMatch(/^ {4}continue-on-error:/mu);
    // a main push that reused the plan run would skip it for every landed SHA: no reuse step here
    expect(block, name).not.toContain('ci-exact-reuse.mjs');
    expect(block, name).not.toContain('steps.reuse');
  }
  expect(readFileSync('.github/workflows/ci-reports.yml', 'utf8')).toContain('node scripts/test-quarantine.mjs --shard=1/1');
  // The hosted fallback still accepts an exact plan proof.
  expect(ciJob('tests')).toContain('node scripts/ci-exact-reuse.mjs ci.yml');
  expect(ciJob('tests')).not.toMatch(/^ {4}if: /mu);
});

test('the blocking memory ledger restores and saves its own verified Brotli parts', () => {
  const ledger = ciJob('memory-ledger-guard');
  const restore = ledger.indexOf('uses: actions/cache/restore@');
  const build = ledger.indexOf('name: Build every production pin');
  const read = ledger.indexOf('name: Read or block on subsystem ledger bytes');
  const save = ledger.indexOf('uses: actions/cache/save@');
  expect(restore).toBeGreaterThan(0);
  expect(build).toBeGreaterThan(restore);
  expect(read).toBeGreaterThan(build);
  expect(save).toBeGreaterThan(read);
  expect(ledger.match(/path: ~\/\.cache\/wildshard\/gen\/spawn-parts-br\/1/gu)).toHaveLength(2);
  expect(ledger).toContain('full-ledger-spawn-parts-br-v1-');
  expect(ledger).toContain('$codec-$CODEC_INPUTS-');
  expect(ledger).toContain("steps.ledger-client.outcome == 'success'");
  expect(ledger).toContain("steps.ledger-parts-pruned.outcome == 'success'");
  expect(ledger).toContain("steps.ledger-parts.outputs.cache-hit != 'true'");
  expect(ledger).not.toContain('ring1-spawn-parts-br-');
  expect(ledger).not.toMatch(/^ {4}continue-on-error:/mu);
  const upload = ledger.indexOf('- if: always()', read);
  expect(upload).toBeGreaterThan(read);
  expect(ledger.slice(read, upload)).not.toContain('continue-on-error');
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
    // The suite's exclusions changed since the branch run started (a quarantine deadline passed).
    expect((await reused([run()], ciJobs, {}, { scope: (at: number) => String(at > Date.parse('2026-11-10T20:10:00Z')), now: steady.now })).reason).toMatch(/predates a quarantine change/u);
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
    // Products boot full Chromium; Template's default Playwright launch
    // separately needs the headless shell even on a cold producer cache.
    expect(packed).toContain('bash scripts/ci-playwright-install.sh --only-shell chromium && node scripts/t1-batch.mjs');
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

  test('J400: Nine builds beside products and consumes only its own exact artifact', () => {
    const text = readFileSync('.github/workflows/ci.yml', 'utf8');
    const jobs = new Map([...text.slice(text.indexOf('\njobs:')).matchAll(/^ {2}([a-z0-9-]+):\n((?: {4}.*\n|\n)*)/gmu)].map(([, name, body]) => [name, body ?? '']));
    const build = jobs.get('nine-ring1-build') ?? '', observe = jobs.get('nine-ring1') ?? '';
    // Even a cancelled macOS job cannot change or hold ci's verdict when
    // it runs only in the workflow_run follow-up. A job-level error waiver
    // inside ci did not isolate cancellation (44139343442).
    expect(observe).not.toContain('kind: street');
    expect(observe).not.toContain('macos-15');
    const reports = readFileSync('.github/workflows/ci-reports.yml', 'utf8');
    const reportJobs = new Map([...reports.slice(reports.indexOf('\njobs:')).matchAll(/^ {2}([a-z0-9-]+):\n((?: {4}.*\n|\n)*)/gmu)].map(([, name, body]) => [name, body ?? '']));
    const street = reportJobs.get('nine-street') ?? '';
    expect(street).toContain('runs-on: macos-15');
    expect(street).toContain('ref: ${{ github.event.workflow_run.head_sha }}');
    expect(street).toContain('run-id: ${{ steps.source.outputs.run }}');
    expect(street).toContain('name: nine-ring1-client');
    expect(street).toContain('node scripts/nine-street-source.mjs');
    expect(street).toContain('node scripts/nine-ring1.mjs bench');
    expect(street).toContain('name: nine-ring1-street');
    expect(street).toContain('if: always()');
    expect(build).not.toMatch(/^ {4}needs:/mu);
    expect(build).toContain('node scripts/ci-exact-reuse.mjs ci.yml');
    expect(build).toContain('node scripts/ci-selection.mjs');
    expect(build).toContain("steps.paths.outputs.docs != 'true'");
    expect(build).toContain('code-run: ${{ steps.code.outputs.run }}');
    expect(observe).toMatch(/^ {4}needs: nine-ring1-build$/mu);
    expect(observe).toContain("needs.nine-ring1-build.outputs.code-run == 'true'");
    expect(observe).not.toContain('needs.products');
    for (const job of [build, observe]) expect(job).toContain('name: nine-ring1-client');
    expect([...observe.matchAll(/uses: actions\/download-artifact@/gu)]).toHaveLength(1);
    expect(build).toContain('node scripts/nine-ring1.mjs build');
    expect(observe).toContain('node scripts/nine-ring1.mjs boot');
    // Observed free-runner budgets: the previous dependency chain took
    // products496 + build216 + observation317 seconds, despite packed max571.
    const costs = new Map([['products', 496], ['nine-ring1-build', 216], ['nine-ring1', 317]]);
    const finish = (name: string): number => {
      const needs = /^ {4}needs: (.+)$/mu.exec(jobs.get(name) ?? '')?.[1];
      const parents = needs === undefined ? [] : needs.replaceAll(/[\[\]]/gu, '').split(',').map(value => value.trim());
      return (costs.get(name) ?? 0) + Math.max(0, ...parents.map(finish));
    };
    expect(Math.max(571, finish('nine-ring1'))).toBeLessThanOrEqual(11 * 60);
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
    const root = mkdtempSync(resolve('tmp', 'land-strikes-')); trackLandFixtureRoot(root);
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
