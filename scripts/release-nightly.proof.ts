// TC22 report-only soak: explicit local/hosted invocation, outside hook discovery.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync, spawnSync} from 'node:child_process';
import {chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync} from 'node:fs';
import {delimiter, join, resolve} from 'node:path';
import {releaseTagPush, requireNoNewFailures} from './release-nightly.ts';

const latest = {id: 42, head_sha: 'a'.repeat(40), status: 'completed', conclusion: 'failure', event: 'schedule'};
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
  const zero = '0'.repeat(40), sha = latest.head_sha;
  assert.equal(releaseTagPush(`refs/tags/v1.2.3 ${sha} refs/tags/v1.2.3 ${zero}`), true);
  for (const ref of ['refs/heads/main', 'refs/heads/release/v1.2.3', 'refs/tags/dryrun-v1.2.3'])
    assert.equal(releaseTagPush(`${ref} ${sha} ${ref} ${zero}`), false);
  assert.equal(releaseTagPush(`(delete) ${zero} refs/tags/v1.2.3 ${sha}`), false);
});

await test('real release entry downloads the latest verdict and refuses before any local gate', () => {
  const entry = resolve('scripts/release-check.mjs');
  mkdirSync('tmp/codex-pins', {recursive: true});
  const root = mkdtempSync(resolve('tmp/codex-pins/release-nightly-'));
  try {
    mkdirSync(join(root, 'bin'));
    const gh = join(root, 'bin/gh');
    writeFileSync(gh, `#!/usr/bin/env node
import {copyFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
const args=process.argv.slice(2);
if(args[0]==='api'&&args.some(arg=>arg.includes('event=schedule')))console.log(process.env.TC22_LATEST);
else if(args.slice(0,3).join(' ')==='run download 42'&&args.includes('nightly-verdict')) {
  if(process.env.TC22_MISSING==='1')process.exit(1);
  const folder=args[args.indexOf('--dir')+1];
  copyFileSync(process.env.TC22_REPORT,join(folder,'verdict.json'));
  writeFileSync(join(folder,'downloaded'),'42');
}else throw Error('unexpected gh call '+args.join(' '));
`);
    chmodSync(gh, 0o755);
    writeFileSync(join(root, 'package.json'), '{"type":"module"}');
    // Reaching this sentinel proves the real entry passed the nightly guard.
    mkdirSync(join(root, '.githooks'));
    writeFileSync(join(root, '.githooks/run-checks.mjs'), 'console.error("LOCAL_GATE_REACHED");process.exitCode=37;');
    const file = join(root, 'report.json');
    const execute = (value: unknown, missing = false) => {
      writeFileSync(file, JSON.stringify(value));
      return spawnSync(process.execPath, [entry], {cwd: root, encoding: 'utf8', timeout: 5000,
        env: {...process.env, CI: '1', PATH: `${join(root, 'bin')}${delimiter}${process.env.PATH ?? ''}`,
          TC22_LATEST: JSON.stringify(latest), TC22_REPORT: file, TC22_MISSING: missing ? '1' : '0'}});
    };
    const red = execute({...report, failures: [{key: planted}], newFailures: [planted]});
    assert.notEqual(red.status, 0); assert.match(red.stderr, /TC22: new nightly failures.*planted/u);
    assert.doesNotMatch(red.stderr, /LOCAL_GATE_REACHED/u);
    const existing = execute(report);
    assert.equal(existing.status, 37, existing.stderr); assert.match(existing.stderr, /LOCAL_GATE_REACHED/u);
    const absent = execute(report, true);
    assert.notEqual(absent.status, 0); assert.doesNotMatch(absent.stderr, /LOCAL_GATE_REACHED/u);
    const stale = execute({...report, run: '41'});
    assert.notEqual(stale.status, 0); assert.match(stale.stderr, /mismatched/u);
    assert.deepEqual(readdirSync(join(root, 'tmp/release-nightly')), []);

    // The current repo-kit branch-release helper pushes a version tag;
    // it no longer calls release-check. Exercise that actual Git hook.
    const env = {...process.env, CI: '1', PATH: `${join(root, 'bin')}${delimiter}${process.env.PATH ?? ''}`,
      TC22_LATEST: JSON.stringify(latest), TC22_REPORT: file, TC22_MISSING: '0'};
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
    copyFileSync(resolve('scripts/release-nightly.ts'), join(root, 'scripts/release-nightly.ts'));
    const marker = join(root, 'full-gate');
    writeFileSync(join(root, '.githooks/run-checks.mjs'), `import{writeFileSync}from'node:fs';writeFileSync(${JSON.stringify(marker)},'reached');`);
    git('tag', '-a', 'v1.2.3', '-m', 'release fixture');
    writeFileSync(file, JSON.stringify({...report, failures: [{key: planted}], newFailures: [planted]}));
    const push = spawnSync('git', ['push', 'origin', 'v1.2.3'], {cwd: root, env, encoding: 'utf8', timeout: 5000});
    assert.notEqual(push.status, 0); assert.match(push.stderr, /TC22: new nightly failures.*planted/u);
    assert.equal(git('ls-remote', '--tags', 'origin'), ''); assert.equal(existsSync(marker), false);
    // Ordinary pushes do not consult the nightly and keep their normal gate.
    git('push', '--quiet', 'origin', 'main'); assert.equal(existsSync(marker), true);
    rmSync(marker);
    writeFileSync(file, JSON.stringify(report));
    git('push', '--quiet', 'origin', 'v1.2.3');
    assert.match(git('ls-remote', '--tags', 'origin'), /refs\/tags\/v1.2.3/u);
    assert.equal(existsSync(marker), true);
    assert.deepEqual(readdirSync(join(root, 'tmp/release-nightly')), []);
  } finally {rmSync(root, {recursive: true, force: true});}
});
