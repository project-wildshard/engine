// TC22: blocking in ci-static (promoted after its J186 week); explicit invocation, outside hook discovery.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync, spawnSync} from 'node:child_process';
import {chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync} from 'node:fs';
import {delimiter, join, resolve} from 'node:path';
import {releaseTagPush, requireNoNewFailures, runnerFaults} from './release-nightly.ts';

const latest = {id: 42, head_sha: 'a'.repeat(40), status: 'completed', conclusion: 'failure', event: 'schedule'};
const dispatched = {...latest, id: 43, event: 'workflow_dispatch', display_title: 'nightly release proof'};
const diagnostic = {...dispatched, id: 44, display_title: 'nightly'};
const old = 'chromium/old@hash/hover', planted = 'webkit/planted@hash/boot';
const report = {version: 2, run: '42', sha: latest.head_sha, pins: 'b'.repeat(64), testList: 'c'.repeat(64),
  ok: false, tag: 'HOLD', failures: [{key: old}], newFailures: []};

await test('existing failures retain J167 manual hold; new failures refuse release', () => {
  requireNoNewFailures(report, latest);
  assert.throws(() => requireNoNewFailures({...report, failures: [...report.failures, {key: planted}], newFailures: [planted]}, latest), /new nightly failures.*planted/u);
  for (const bad of [null, {}, {...report, run: '41'}, {...report, sha: 'd'.repeat(40)},
    {...report, newFailures: undefined}, {...report, newFailures: ['invented']}, {...report, failures: [null]}])
    assert.throws(() => requireNoNewFailures(bad, latest), /release held/u);
  assert.throws(() => requireNoNewFailures(report, {...latest, conclusion: 'cancelled'}), /release held/u);
  assert.throws(() => requireNoNewFailures(report, {...latest, event: 'workflow_dispatch'}), /release held/u);
  requireNoNewFailures({...report, run: '43'}, dispatched);
  assert.throws(() => requireNoNewFailures({...report, run: '44'}, diagnostic), /release held/u);
  const zero = '0'.repeat(40), sha = latest.head_sha;
  assert.equal(releaseTagPush(`refs/tags/v1.2.3 ${sha} refs/tags/v1.2.3 ${zero}`), true);
  for (const ref of ['refs/heads/main', 'refs/heads/release/v1.2.3', 'refs/tags/dryrun-v1.2.3'])
    assert.equal(releaseTagPush(`${ref} ${sha} ${ref} ${zero}`), false);
  assert.equal(releaseTagPush(`(delete) ${zero} refs/tags/v1.2.3 ${sha}`), false);
});

// QA 11-24 row 66: the shape of nightly 45464478966 (abandoned heads job, a lost WebGL context on Nine, 0 receipts).
const nine = 'chromium/nine-dragon-stack@hash', pine = 'chromium/pine-hollow@hash';
const lost = 'Error: Game error report: {"system":"gpu-recovery","message":"Error: WebGL context lost (context lost)"}';
const faulted = {...report, failures: [
  {key: 'runner/heads', error: 'Actions job abandoned; a red nightly holds the tag even with complete phase receipts'},
  {key: `${nine}/boot`, error: lost}, {key: `${nine}/hover`, error: 'Expected one receipt, got 0'},
  {key: `${nine}/draw`, error: 'jsHandle.evaluate: Execution context was destroyed, most likely because of a navigation.'},
  {key: `${pine}/cook`, error: 'Expected one receipt, got 0'}, {key: `${pine}/boot`, error: 'Expected one receipt, got 0'}],
newFailures: [`${nine}/boot`, `${nine}/hover`, `${nine}/draw`, `${pine}/cook`, `${pine}/boot`]};

await test('a runner-fault nightly lets the tag through; a real red still holds it', () => {
  assert.deepEqual(requireNoNewFailures(faulted, latest), faulted.newFailures);
  assert.deepEqual(requireNoNewFailures(report, latest), []);
  // One real assertion beside the runner faults holds the tag.
  const real = {...faulted, failures: [...faulted.failures, {key: planted, error: 'expected 3 to be 4'}], newFailures: [...faulted.newFailures, planted]};
  assert.throws(() => requireNoNewFailures(real, latest), /new nightly failures.*planted/u);
  // A missing receipt is a runner fault only beside an abandoned job or a lost context on that head.
  const noJob = {...faulted, failures: faulted.failures.filter(row => row.key !== 'runner/heads')};
  assert.throws(() => requireNoNewFailures(noJob, latest), /new nightly failures.*pine-hollow/u);
  assert.deepEqual(runnerFaults({...noJob, newFailures: [`${nine}/boot`, `${nine}/hover`, `${nine}/draw`]}), [`${nine}/boot`, `${nine}/hover`, `${nine}/draw`]);
  // A failed (not abandoned) job is a red job, not a runner fault.
  const failedJob = {...faulted, failures: faulted.failures.map(row => row.key === 'runner/heads' ? {...row, error: 'Actions job failure; a red nightly holds the tag'} : row)};
  assert.throws(() => requireNoNewFailures(failedJob, latest), /new nightly failures.*pine-hollow/u);
  assert.throws(() => requireNoNewFailures({...faulted, failures: [...faulted.failures, {key: 'x', error: 7}]}, latest), /release held/u);
});

await test('real release entry downloads the latest verdict and refuses before any local gate', () => {
  const entry = resolve('src/scripts/release-check.mjs');
  mkdirSync('tmp/codex-pins', {recursive: true});
  const root = mkdtempSync(resolve('tmp/codex-pins/release-nightly-'));
  try {
    mkdirSync(join(root, 'bin'));
    const gh = join(root, 'bin/gh');
    writeFileSync(gh, `#!/usr/bin/env node
import {copyFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
const args=process.argv.slice(2);
if(args[0]==='api'&&args.some(arg=>arg.includes('branch=main&status=completed')))console.log(process.env.TC22_RUNS);
else if(args.slice(0,2).join(' ')==='run download'&&['42','43'].includes(args[2])&&args.includes('nightly-verdict')) {
  if(process.env.TC22_MISSING==='1')process.exit(1);
  const folder=args[args.indexOf('--dir')+1];
  copyFileSync(process.env.TC22_REPORT,join(folder,'verdict.json'));
  writeFileSync(join(folder,'downloaded'),args[2]);
}else throw Error('unexpected gh call '+args.join(' '));
`);
    chmodSync(gh, 0o755);
    writeFileSync(join(root, 'package.json'), '{"type":"module"}');
    // Reaching this sentinel proves the real entry passed the nightly guard.
    mkdirSync(join(root, '.githooks'));
    writeFileSync(join(root, '.githooks/run-checks.mjs'), 'console.error("LOCAL_GATE_REACHED");process.exitCode=37;');
    const file = join(root, 'report.json');
    const execute = (value: unknown, missing = false, runs = [diagnostic, latest]) => {
      writeFileSync(file, JSON.stringify(value));
      return spawnSync(process.execPath, [entry], {cwd: root, encoding: 'utf8', timeout: 5000,
        env: {...process.env, CI: '1', PATH: `${join(root, 'bin')}${delimiter}${process.env.PATH ?? ''}`,
          TC22_RUNS: JSON.stringify(runs), TC22_REPORT: file, TC22_MISSING: missing ? '1' : '0'}});
    };
    const red = execute({...report, failures: [{key: planted}], newFailures: [planted]});
    assert.notEqual(red.status, 0); assert.match(red.stderr, /TC22: new nightly failures.*planted/u);
    assert.doesNotMatch(red.stderr, /LOCAL_GATE_REACHED/u);
    const existing = execute(report);
    assert.equal(existing.status, 37, existing.stderr); assert.match(existing.stderr, /LOCAL_GATE_REACHED/u);
    const manual = execute({...report, run: '43'}, false, [diagnostic, dispatched, latest]);
    assert.equal(manual.status, 37, manual.stderr); assert.match(manual.stdout, /TC22: nightly 43/u);
    const newerScheduled = execute(report, false, [latest, diagnostic, dispatched]);
    assert.equal(newerScheduled.status, 37, newerScheduled.stderr); assert.match(newerScheduled.stdout, /TC22: nightly 42/u);
    const missingManual = execute(report, true, [diagnostic, dispatched, latest]);
    assert.notEqual(missingManual.status, 0); assert.doesNotMatch(missingManual.stderr, /LOCAL_GATE_REACHED/u);
    const absent = execute(report, true);
    assert.notEqual(absent.status, 0); assert.doesNotMatch(absent.stderr, /LOCAL_GATE_REACHED/u);
    const stale = execute({...report, run: '41'});
    assert.notEqual(stale.status, 0); assert.match(stale.stderr, /mismatched/u);
    assert.deepEqual(readdirSync(join(root, 'tmp/release-nightly')), []);

    // The current repo-kit branch-release helper pushes a version tag;
    // it no longer calls release-check. Exercise that actual Git hook.
    const env = {...process.env, CI: '1', PATH: `${join(root, 'bin')}${delimiter}${process.env.PATH ?? ''}`,
      TC22_RUNS: JSON.stringify([diagnostic, dispatched, latest]), TC22_REPORT: file, TC22_MISSING: '0'};
    for (const key of Object.keys(env)) if (key.startsWith('GIT_')) Reflect.deleteProperty(env, key);
    const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=TC22 proof', '-c', 'user.email=tc22@example.invalid', ...args], {cwd: root, env, encoding: 'utf8', stdio: 'pipe'}).trim();
    git('init', '--quiet', '--initial-branch=main');
    git('init', '--quiet', '--bare', 'remote.git');
    git('remote', 'add', 'origin', join(root, 'remote.git'));
    git('commit', '--quiet', '--allow-empty', '-m', 'release fixture');
    git('config', 'core.hooksPath', '.githooks');
    copyFileSync(resolve('.githooks/pre-push'), join(root, '.githooks/pre-push'));
    chmodSync(join(root, '.githooks/pre-push'), 0o755);
    // Unrelated blob/AGENTS/pin checks pass; the real release gate must still
    // refuse before the downstream full check or a byte reaches origin.
    for (const name of ['check-push', 'agents-md', 'pin-provenance']) writeFileSync(join(root, `.githooks/${name}.mjs`), '');
    mkdirSync(join(root, 'scripts'));
    copyFileSync(resolve('src/scripts/release-nightly.ts'), join(root, 'src/scripts/release-nightly.ts'));
    const marker = join(root, 'full-gate');
    writeFileSync(join(root, '.githooks/run-checks.mjs'), `import{writeFileSync}from'node:fs';writeFileSync(${JSON.stringify(marker)},'reached');`);
    git('tag', '-a', 'v1.2.3', '-m', 'release fixture');
    writeFileSync(file, JSON.stringify({...report, run: '43', failures: [{key: planted}], newFailures: [planted]}));
    const push = spawnSync('git', ['push', 'origin', 'v1.2.3'], {cwd: root, env, encoding: 'utf8', timeout: 5000});
    assert.notEqual(push.status, 0); assert.match(push.stderr, /TC22: new nightly failures.*planted/u);
    assert.equal(git('ls-remote', '--tags', 'origin'), ''); assert.equal(existsSync(marker), false);
    // Ordinary pushes do not consult the nightly and keep their normal gate.
    git('push', '--quiet', 'origin', 'main'); assert.equal(existsSync(marker), true);
    rmSync(marker);
    const receipts = join(root, 'receipts.log');
    writeFileSync(file, JSON.stringify({...faulted, run: '43'}));
    const faultPush = spawnSync('git', ['push', 'origin', 'v1.2.3'], {cwd: root, env: {...env, TC22_RECEIPTS: receipts}, encoding: 'utf8', timeout: 5000});
    assert.equal(faultPush.status, 0, faultPush.stderr);
    assert.match(faultPush.stdout + faultPush.stderr, /TC22: nightly 43 red from runner faults only/u);
    assert.match(readFileSync(receipts, 'utf8'), /^\d\d:\d\d UTC tc22 NOTE nightly 43 red from runner faults only \(5 keys/u);
    assert.match(git('ls-remote', '--tags', 'origin'), /refs\/tags\/v1.2.3/u);
    git('push', '--quiet', 'origin', ':refs/tags/v1.2.3');
    writeFileSync(file, JSON.stringify({...report, run: '43'}));
    git('push', '--quiet', 'origin', 'v1.2.3');
    assert.match(git('ls-remote', '--tags', 'origin'), /refs\/tags\/v1.2.3/u);
    assert.equal(existsSync(marker), true);
    assert.deepEqual(readdirSync(join(root, 'tmp/release-nightly')), []);
  } finally {rmSync(root, {recursive: true, force: true});}
});
