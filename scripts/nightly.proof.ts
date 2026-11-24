// Explicit nightly/standalone checks only: deliberately outside Vitest and hooks (J186).
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync, spawnSync} from 'node:child_process';
import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {browsers, headGroups, parallelTestGroups, phases, plan, read, requireBuild, requireGreen, requireLatest, testGroups, type HeadsReport, type Plan, type TestsReport, type Verdict} from './nightly-model.ts';
import {NIGHTLY_SERIAL_TESTS} from './vitest-ci-files.ts';

interface Execution {status: number | null; report: Verdict; summary: string}
interface Fixture {root: string; heads: HeadsReport[]; suite: TestsReport; suites: TestsReport[]; expected: Plan;
  execute: (baseline?: string, env?: NodeJS.ProcessEnv) => Execution; write: (path: string, value: unknown) => void}

const cli = resolve('scripts/nightly.ts'), tagger = resolve('scripts/nightly-tag.mjs');
function fixture(run: (context: Fixture) => void): void {
  mkdirSync('tmp', {recursive: true});
  const root = mkdtempSync(resolve('tmp/nightly-proof-'));
  const write = (path: string, value: unknown) => {mkdirSync(join(root, path, '..'), {recursive: true}); writeFileSync(join(root, path), JSON.stringify(value));};
  try {
    execFileSync('git', ['init', '-q', '--initial-branch=main', root]);
    execFileSync('git', ['-c', 'user.name=Proof', '-c', 'user.email=proof@example.invalid', 'commit', '-q', '--allow-empty', '-m', 'fixture'], {cwd: root});
    write('test/pins/shardfiles.json', {shards: Array.from({length: 28}, (_, i) => ({slug: `head-${i}`, hash: String(i).padStart(64, '0')}))});
    write('test/pins/ring-2-tests.json', ['test/journey.test.ts']);
    const expected = plan(root);
    const heads: HeadsReport[] = [];
    for (const browser of browsers) for (const [group, members] of headGroups(expected.heads, browser).entries()) {
      const results = members.map(head => ({slug: head.slug, hash: head.hash, phases: phases.map(name => ({name, ok: true}))}));
      heads.push({...expected, kind: 'heads', browser, group, results});
    }
    const suite: TestsReport = {...expected, kind: 'tests', group: 0, groups: testGroups, exitCode: 0, kitExitCode: 0, totalTests: 1, files: [{path: 'test/journey.test.ts', ok: true, assertions: 1, skipped: 0}]};
    const suites: TestsReport[] = [suite, ...Array.from({length: parallelTestGroups - 1}, (_, index) => ({...suite, group: index + 1,
      files: [{path: `test/ordinary-${index}.test.ts`, ok: true, assertions: 1, skipped: 0}]})),
    {...suite, group: parallelTestGroups, totalTests: NIGHTLY_SERIAL_TESTS.length,
      files: NIGHTLY_SERIAL_TESTS.map(path => ({path, ok: true, assertions: 1, skipped: 0}))}];
    const execute = (baseline?: string, env: NodeJS.ProcessEnv = {}): Execution => {
      rmSync(join(root, 'reports'), {recursive: true, force: true});
      for (const report of heads) write(`reports/heads-${report.browser}-${report.group}.json`, report);
      for (const [index, report] of suites.entries()) write(`reports/tests-${index}.json`, report);
      const child = spawnSync(process.execPath, [cli, 'report', join(root, 'reports'), ...(baseline === undefined ? [] : [baseline])], {cwd: root, encoding: 'utf8', env: {...process.env, ...env}});
      return {status: child.status, report: read(join(root, 'reports/verdict.json')) as Verdict, summary: readFileSync(join(root, 'reports/summary.md'), 'utf8')};
    };
    run({root, heads, suite, suites, expected, execute, write});
  } finally {rmSync(root, {recursive: true, force: true});}
}

await test('nightly keeps the cold native files in a one-worker partition', () => fixture(({root}) => {
  const result = spawnSync(process.execPath, [cli, 'test-plan'], {cwd: root, encoding: 'utf8'});
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {group: [0, 1, 2, 3]});
  const bin = join(root, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'pnpm'), '#!/bin/sh\nexit 0\n', {mode: 0o700});
  writeFileSync(join(bin, 'python3'), '#!/bin/sh\nprintf "%s\\n" "$WS_NIGHTLY_TEST_PHASE" "$@" > invocation.txt\n', {mode: 0o700});
  for (const group of [0, 1, 2, 3]) {
    spawnSync(process.execPath, [cli, 'tests', join(root, 'reports')], {cwd: root, env: {...process.env,
      PATH: `${bin}:${process.env.PATH}`, NIGHTLY_TEST_GROUP: String(group)}});
    const invocation = readFileSync(join(root, 'invocation.txt'), 'utf8').trim().split('\n');
    if (group === 3) {
      assert.equal(invocation[0], 'serial');
      assert.ok(invocation.includes('--maxWorkers=1'));
      assert.ok(!invocation.some(arg => arg.startsWith('--shard=')));
    } else {
      assert.equal(invocation[0], 'parallel');
      assert.ok(invocation.includes('--maxWorkers=2'));
      assert.ok(invocation.includes(`--shard=${group + 1}/3`));
    }
  }
}));
await test('complete real report files admit the exact commit, but never another commit or repeated row', () => fixture(({expected, execute}) => {
  const result = execute(); assert.equal(result.status, 0); requireGreen(result.report, expected);
  assert.throws(() => requireGreen({...result.report, version: 1}, expected), /J167/u);
  assert.throws(() => requireGreen({...result.report, tests: result.report.tests.slice(0, 1)}, expected), /J167/u);
  requireBuild(`${expected.sha.slice(0, 7)}-proof`, expected);
  assert.throws(() => requireBuild('0000000-stale', expected), /stale/u);
  assert.throws(() => requireGreen(result.report, {...expected, sha: 'wrong'}), /J167/u);
  result.report.rows[1] = result.report.rows[0]; assert.throws(() => requireGreen(result.report, expected), /J167/u);
}));
await test('one failed cook names its head; a later successful head remains visible', () => fixture(({heads, execute}) => {
  const broken = heads[0].results[0]; broken.phases = [{name: 'cook', ok: false, error: 'worker timed out'}];
  const result = execute(); assert.equal(result.status, 1);
  assert.match(result.summary, new RegExp(`chromium/${broken.slug}@.*cook`, 'u'));
  assert.equal(result.report.rows.find(row => row.slug === heads[0].results[1].slug && row.browser === 'chromium' && row.phase === 'boot')?.ok, true);
  assert.match(result.summary, /TAG HOLD/u);
}));
await test('missing head, duplicate receipt and receipt from another SHA each hold the tag', () => {
  const mutations: ((heads: HeadsReport[]) => void)[] = [heads => {heads[0].results.pop();}, heads => {heads[0].results.push(heads[0].results[0]);}, heads => {heads[0].sha = 'stale';}];
  for (const mutate of mutations) {
    fixture(({heads, execute}) => {mutate(heads); const result = execute(); assert.equal(result.status, 1); assert.equal(result.report.tag, 'HOLD');});
  }
});
await test('the verdict separates incomplete execution from reported test failures', () => {
  const cases: {mutate: (suite: TestsReport) => void; key: string; error: RegExp}[] = [
    {mutate: suite => {suite.files = [];}, key: 'shared/tests/0', error: /Incomplete suite: no executable test evidence/u},
    {mutate: suite => {suite.files[0].ok = false; suite.files[0].assertions = 0; suite.exitCode = 1;}, key: 'shared/test/journey.test.ts', error: /Listed test failed/u},
    {mutate: suite => {suite.files[0].assertions = 0;}, key: 'shared/test/journey.test.ts', error: /No passing assertions/u},
    {mutate: suite => {suite.files[0].skipped = 1;}, key: 'shared/test/journey.test.ts', error: /Listed test skipped/u},
    {mutate: suite => {suite.exitCode = 1;}, key: 'shared/tests/0', error: /Suite failed: Vitest exit 1/u},
    {mutate: suite => {suite.exitCode = 1; suite.interruptions = ['Vitest: SIGTERM'];}, key: 'shared/tests/0', error: /Incomplete suite: Vitest: SIGTERM/u},
  ];
  for (const {mutate, key, error} of cases) {
    fixture(({suite, execute}) => {
      mutate(suite);
      const result = execute();
      assert.equal(result.status, 1);
      assert.match(result.report.failures.find(failure => failure.key === key)?.error ?? '', error);
    });
  }
});
await test('the suite writes fresh interruption evidence even if Vitest leaves partial JSON', () => fixture(({root, write}) => {
  const bin = join(root, 'bin'), reports = join(root, 'reports');
  mkdirSync(bin);
  writeFileSync(join(bin, 'pnpm'), '#!/bin/sh\nexit 0\n', {mode: 0o700});
  writeFileSync(join(bin, 'python3'), `#!/bin/sh
for arg do output=$arg; done
if [ "$NIGHTLY_PROOF_PARTIAL" = 1 ]; then
  printf '{"numTotalTests":' > "\${output#--outputFile.json=}"
fi
kill -TERM "$$"
`, {mode: 0o700});
  for (const partial of ['0', '1']) {
    write('reports/vitest-0.json', {numTotalTests: 1});
    const result = spawnSync(process.execPath, [cli, 'tests', reports], {cwd: root, env: {...process.env,
      PATH: `${bin}:${process.env.PATH}`, NIGHTLY_TEST_GROUP: '0', NIGHTLY_PROOF_PARTIAL: partial}});
    assert.equal(result.status, 1);
    const receipt = read(join(reports, 'tests-0.json')) as TestsReport;
    assert.equal(receipt.totalTests, 0);
    assert.deepEqual(receipt.interruptions, partial === '1' ? ['Vitest: SIGTERM', 'Vitest: unreadable JSON report'] : ['Vitest: SIGTERM']);
  }
}));
await test('ordinary suite skips retain existing policy while listed journeys must all run', () => fixture(({suite, execute}) => {
  suite.files.push({path: 'test/ordinary-platform.test.ts', ok: true, assertions: 0, skipped: 1});
  assert.equal(execute().status, 0);
}));
await test('the verdict holds if a native file runs in the parallel partition', () => fixture(({suite, suites, execute}) => {
  const serial = suites[parallelTestGroups];
  suite.files.push(...serial.files.splice(0, 1));
  const result = execute();
  assert.equal(result.status, 1);
  assert.match(result.report.failures.find(failure => failure.key === 'shared/tests/0')?.error ?? '', /serial file ran in a parallel partition/u);
  assert.match(result.report.failures.find(failure => failure.key === `shared/tests/${parallelTestGroups}`)?.error ?? '', /serial partition inventory differs/u);
}));
await test('the pinned save and restore proof must run without a second worker', () => fixture(({suite, suites, execute}) => {
  const path = 'test/pinned-restore-play.test.ts', serial = suites[parallelTestGroups];
  serial.files = serial.files.filter(file => file.path !== path);
  suite.files.push({path, ok: true, assertions: 7, skipped: 0});
  const result = execute();
  assert.equal(result.status, 1);
  assert.match(result.report.failures.find(failure => failure.key === 'shared/tests/0')?.error ?? '', /serial file ran in a parallel partition/u);
}));
await test('missing, duplicate, malformed or overlapping suite partitions hold an otherwise green night', () => {
  const mutations: ((suites: TestsReport[]) => void)[] = [suites => {suites.pop();}, suites => {suites[1].group = 0;}, suites => {suites[1].groups = 1;}, suites => {suites[1].files = [...suites[0].files];}, suites => {suites[1].files = [];}];
  for (const mutate of mutations) fixture(({suites, execute, expected}) => {
    mutate(suites);
    const result = execute();
    assert.equal(result.status, 1);
    assert.throws(() => requireGreen(result.report, expected), /J167/u);
  });
});
await test('an empty artifact directory never produces green', () => fixture(({root}) => {
  mkdirSync(join(root, 'empty'));
  const result = spawnSync(process.execPath, [cli, 'report', join(root, 'empty')], {cwd: root, encoding: 'utf8'});
  assert.equal(result.status, 1); assert.equal((read(join(root, 'empty/verdict.json')) as Verdict).rows.filter(row => !row.ok).length, 280);
}));
await test('a failed Actions job holds the tag even if every uploaded phase passed', () => fixture(({execute, expected}) => {
  const result = execute(undefined, {NIGHTLY_HEADS_RESULT: 'failure'});
  assert.equal(result.status, 1); assert.equal(result.report.rows.every(row => row.ok), true);
  assert.match(result.summary, /runner\/heads/u);
  assert.throws(() => requireGreen(result.report, expected), /J167/u);
}));
await test('prior nightly failures are compared by head hash, browser and phase', () => fixture(({heads, execute, root, write}) => {
  heads[0].results[0].phases[0].ok = false;
  const first = execute(); write('previous.json', {...first.report, version: 1});
  heads[0].results[0].phases[0].ok = true; heads[1].results[0].phases[1].ok = false;
  const next = execute(join(root, 'previous.json'));
  assert.equal(next.report.resolved.length, 1); assert.equal(next.report.newFailures.length, 1);
  assert.equal(next.report.baseline?.sha, first.report.sha);
}));
await test('optional tag helper refuses missing/red/local nightly before it can fetch or write a tag', () => fixture(({root, heads, execute, write}) => {
  const missing = spawnSync(process.execPath, [tagger], {cwd: root, encoding: 'utf8'});
  assert.notEqual(missing.status, 0); assert.match(missing.stderr, /J167/u);
  write('local.json', {...execute().report, run: null});
  const local = spawnSync(process.execPath, [tagger, `--report=${join(root, 'local.json')}`], {cwd: root, encoding: 'utf8'});
  assert.notEqual(local.status, 0); assert.match(local.stderr, /J167: a green hosted/u);
  heads[0].results[0].phases[0].ok = false; execute();
  const red = spawnSync(process.execPath, [tagger, `--report=${join(root, 'reports/verdict.json')}`], {cwd: root, encoding: 'utf8'});
  assert.notEqual(red.status, 0); assert.match(red.stderr, /J167/u);
  assert.equal(execFileSync('git', ['tag'], {cwd: root, encoding: 'utf8'}), '');
}));
await test('a later red night cannot be cleared by an older green artifact on the same SHA', () => fixture(({execute, expected}) => {
  const green = {...execute().report, run: '42'};
  const latest = {id: 42, head_sha: expected.sha, status: 'completed', conclusion: 'success'};
  requireLatest(green, expected, latest);
  assert.throws(() => requireLatest(green, expected, {...latest, id: 43, conclusion: 'failure'}), /J167/u);
  assert.throws(() => requireLatest(green, expected, {...latest, conclusion: 'cancelled'}), /J167/u);
  assert.throws(() => requireLatest(green, expected, {...latest, head_sha: 'another commit'}), /J167/u);
  assert.throws(() => requireLatest({...green, run: null}, expected, latest), /J167/u);
}));
// XR-3: promoted after its J186 week (AD2); blocking in ci-static and in the nightly's own proof step.
await test('an extra receipt without a ring kind or source SHA cannot hide behind a complete green table', () => {
  for (const field of ['kind', 'sha'] as const) fixture(({heads, execute, expected}) => {
    const extra = {...heads[0], group: 4};
    Reflect.deleteProperty(extra, field);
    // A broken artifact may accompany all the valid artifacts. It must not be silently discarded.
    heads.push(extra);
    const result = execute();
    assert.equal(result.status, 1);
    assert.equal(result.report.tag, 'HOLD');
    assert.match(result.summary, /receipt\/identity/u);
    assert.throws(() => requireGreen(result.report, expected), /J167/u);
  });
});
