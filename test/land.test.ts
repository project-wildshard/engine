// J240 / DEV-SPEED DS21: scripts/land.mjs against real git. A bare repo stands
// in for GitHub (with protect-main's no-force, no-delete rule as an update
// hook), a post-receive hook records every pushed tip, and a fake `gh` on PATH
// answers Actions queries only for SHAs that were really pushed.
// oxlint-disable-next-line import/no-nodejs-modules -- Fixture repositories stay in the repository scratch root.
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, utimesSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Execute the workflow shell against owned fixture paths.
import { spawnSync } from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- Evaluate ci.yml's real concurrency-key expressions.
import { runInNewContext } from 'node:vm';
// oxlint-disable-next-line import/no-nodejs-modules -- Fixture paths.
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { packUnits, runUnits } from '../scripts/ci-pack.mjs';
import { shaVerdict } from '../scripts/land.mjs';
import { T1_SHARDS } from '../scripts/t1-shards.mjs';
import { cleanLandFixtures, trackLandFixtureRoot } from './fixtures/land-git';

afterEach(cleanLandFixtures);

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

function ciJob(name: string, workflow = 'ci.yml'): string {
  const text = readFileSync(`.github/workflows/${workflow}`, 'utf8');
  const start = text.indexOf(`\n  ${name}:\n`);
  if (start === -1) throw new Error(`${workflow} has no ${name} job`);
  const next = text.slice(start + 1).search(/\n {2}[a-z][a-z0-9_-]*:\n/u);
  return next === -1 ? text.slice(start) : text.slice(start, start + 1 + next);
}

test('boundaries stays blocking and independent; J400 moves quarantine to reports', () => {
  for (const name of ['boundaries']) {
    const block = ciJob(name);
    expect(block, name).toContain("    if: ${{ !startsWith(github.ref, 'refs/heads/plan/') }}");
    expect(block).not.toMatch(/^ {4}continue-on-error:/mu);
  }
  expect(readFileSync('.github/workflows/ci-reports.yml', 'utf8')).toContain('node scripts/test-quarantine.mjs --shard=1/1');
  // FLOW-SIMPLE FS5: main never reuses a plan-branch run; there are none (J422).
  expect(readFileSync('.github/workflows/ci.yml', 'utf8')).not.toMatch(/ci-exact-reuse|steps\.reuse/u);
  expect(ciJob('tests')).not.toMatch(/^ {4}if: /mu);
});

test('the memory ledger (budgets.yml since BUDGET-CAPS BC9) restores and saves its verified Brotli parts and phone textures', () => {
  const producer = ciJob('memory-client-build');
  const ledger = ciJob('budgets', 'budgets.yml');
  // The native consumer runs after ci in memory-footprint.yml (ci's verdict never waits on its xcode-27 runner).
  const native = readFileSync('.github/workflows/memory-footprint.yml', 'utf8');
  const restore = producer.indexOf('uses: actions/cache/restore@');
  const build = producer.indexOf('name: Build every production pin');
  const archive = producer.indexOf('name: Archive the full pinned preview');
  const save = producer.indexOf('uses: actions/cache/save@');
  const read = ledger.indexOf("name: Read every zone's memory ledger");
  expect(restore).toBeGreaterThan(0);
  expect(build).toBeGreaterThan(restore);
  expect(archive).toBeGreaterThan(build);
  expect(save).toBeGreaterThan(archive);
  expect(readFileSync('.github/workflows/budgets.yml', 'utf8')).toContain('workflows: [ci]');
  expect(native).toContain('workflows: [ci]');
  for (const consumer of [ledger, native]) {
    expect(consumer).toContain('name: memory-pinned-client');
    expect(consumer).not.toContain('uses: actions/cache/save@');
  }
  const unpack = ledger.indexOf('name: Restore the pinned preview and install Chromium');
  const digest = ledger.indexOf('name: Record the served ledger Brotli part digests');
  expect(unpack).toBeGreaterThan(0);
  expect(digest).toBeGreaterThan(unpack);
  expect(read).toBeGreaterThan(digest);
  expect(producer.match(/path: ~\/\.cache\/wildshard\/gen\/spawn-parts-br$/gmu)).toHaveLength(2);
  expect(producer).toContain('full-ledger-spawn-parts-br-v2-');
  expect(producer).toContain('$codec-$CODEC_INPUTS-');
  expect(producer).toContain('key=%s%s-parts-and-server');
  expect(producer).toContain('${{ steps.ledger-codec.outputs.prefix }}');
  expect(producer).toMatch(/restore-keys: \|\n[^\n]+\n +nightly-encodes-/u);
  expect(producer).toContain('astc6-1');
  expect(producer).toMatch(/name: Upload the full pinned preview\n +timeout-minutes: 4\n +uses: actions\/upload-artifact@/u);
  expect(producer).toContain('timeout-minutes: 30');
  expect(producer).toContain('name: memory-pinned-client');
  expect(ledger).toContain('tmp/memory-ledger/spawn-parts.sha256');
  expect(producer).toContain("steps.ledger-client.outcome == 'success'");
  expect(producer).toContain("steps.ledger-parts-pruned.outcome == 'success'");
  expect(producer).toContain("steps.ledger-parts.outputs.cache-hit != 'true'");
  expect(producer).not.toContain('ring1-spawn-parts-br-');
  expect(ledger).not.toMatch(/^ {4}continue-on-error:/mu);
  // The ledger read never decides the job; the one check of every budget does, with no bypass.
  const judge = ledger.indexOf('name: Judge every budget'), upload = ledger.indexOf('- if: always()', read);
  expect(upload).toBeGreaterThan(judge);
  expect(judge).toBeGreaterThan(read);
  expect(ledger.slice(judge, upload)).not.toContain('continue-on-error');
  expect(ledger.slice(judge, upload)).toContain('node scripts/budgets/cli.mjs check tmp/budgets/measures.json');
});

test('the ledger cache keeps current encodes and records both pack digests', () => {
  const root = mkdtempSync(resolve('tmp', 'land-ledger-parts-'));
  trackLandFixtureRoot(root);
  const cache = join(root, 'cache', '1');
  const astc = join(root, 'cache', 'astc6-1');
  const spawnRoot = join(root, 'tmp/memory-ledger/preview/dist/assets/spawn');
  const browser = 'a'.repeat(64);
  const server = 'b'.repeat(64);
  const stale = 'c'.repeat(64);
  mkdirSync(cache, {recursive: true});
  mkdirSync(astc);
  for (const name of ['used.ktx2','old.ktx2']) writeFileSync(join(astc, name), name);
  const old = new Date(Date.now() - 240 * 60_000);
  utimesSync(join(astc, 'old.ktx2'), old, old);
  for (const hash of [browser, server, stale]) writeFileSync(join(cache, `${hash}.br`), hash);
  for (const [folder, hash] of [['parts', browser], ['server', server]] as const) {
    mkdirSync(join(spawnRoot, folder), {recursive: true});
    writeFileSync(join(spawnRoot, folder, `${hash.slice(0, 16)}.pack.br`), hash);
  }
  const run = (job: string, name: string) => {
    const step = ciJob(job, job === 'budgets' ? 'budgets.yml' : 'ci.yml').split(`      - name: ${name}\n`)[1]?.split(/\n {6}- /u)[0];
    const shell = step?.split('\n        run: |\n')[1];
    if (shell === undefined) throw new Error(`Missing shell step ${name}`);
    const script = shell.replace('cache="$HOME/.cache/wildshard/gen/spawn-parts-br/1"', 'cache="$LEDGER_FIXTURE_CACHE"');
    expect(script).not.toContain('$HOME');
    return spawnSync('bash', ['-e', '-o', 'pipefail', '-c', script], {
      cwd: root, encoding: 'utf8', env: {...process.env, GITHUB_WORKSPACE: root, LEDGER_FIXTURE_CACHE: cache},
    });
  };
  const prune = 'Prune unused full-ledger encodes';
  const serverFolder = join(spawnRoot, 'server');
  const hiddenServer = join(root, 'missing-server');
  renameSync(serverFolder, hiddenServer);
  expect(run('memory-client-build', prune).status).toBe(1);
  expect(readdirSync(cache).sort()).toEqual([`${browser}.br`, `${server}.br`, `${stale}.br`]);
  expect(readdirSync(astc).sort()).toEqual(['old.ktx2','used.ktx2']);
  const digestStep = 'Record the served ledger Brotli part digests';
  expect(run('budgets', digestStep).status).not.toBe(0);
  expect(readdirSync(join(root, 'tmp/memory-ledger'))).not.toContain('spawn-parts.sha256');
  renameSync(hiddenServer, serverFolder);
  const pruned = run('memory-client-build', prune);
  expect(pruned.status, pruned.stderr).toBe(0);
  expect(readdirSync(cache).sort()).toEqual([`${browser}.br`, `${server}.br`]);
  expect(readdirSync(astc)).toEqual(['used.ktx2']);
  const recorded = run('budgets', digestStep);
  expect(recorded.status, recorded.stderr).toBe(0);
  const manifest = readFileSync(join(root, 'tmp/memory-ledger/spawn-parts.sha256'), 'utf8');
  expect(manifest.trim().split('\n').map(line => line.split('  ')[1])).toEqual([
    `parts/${browser.slice(0, 16)}.pack.br`, `server/${server.slice(0, 16)}.pack.br`,
  ]);
});

describe('ci.yml on main', () => {
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

  test('J400: nine shares, T1 on its own runners, reporting off the gate', () => {
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
    expect(packed + producer).not.toMatch(/^ {4}needs:/mu);
    // TR-4: the producer publishes its build once; each T1 suite runs on its own runner (one runner for all four
    // missed every 120 s budget), with the headless shell T1's default launch needs.
    expect(packed).toContain('name: template-e2e-products');
    const t1 = jobs.get('t1-e2e') ?? '';
    expect(t1).toMatch(/^ {4}needs: products$/mu);
    expect(t1.split('\n')).toContain(`        suite: [${Object.keys(T1_SHARDS).join(', ')}]`);
    expect(t1).toContain('bash scripts/ci-playwright-install.sh --only-shell chromium');
    expect(t1).toContain('node scripts/t1-ci-proof.mjs');
    expect(t1).toContain('name: template-e2e-${{ matrix.suite }}');
    expect(packed).not.toContain('continue-on-error: true');
    expect(packed).not.toMatch(/Soak |Observe /u);
    const reports = readFileSync('.github/workflows/ci-reports.yml', 'utf8');
    expect(reports).toContain('workflow_run:');
    expect(reports).toContain('types: [completed]');
    expect(reports).toContain('github.event.workflow_run.head_sha');
    expect(reports).toContain('github.event.workflow_run.id');
    expect(reports).toContain('node scripts/test-timings.mjs collect');
    expect(reports).toContain('Soak hover presses');
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
