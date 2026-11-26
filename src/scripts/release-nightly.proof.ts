// TC22: blocking in ci-static (promoted after its J186 week); explicit invocation, outside hook discovery.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync, spawnSync} from 'node:child_process';
import {chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync} from 'node:fs';
import {delimiter, join, resolve} from 'node:path';
import {releaseTagCommit, releaseTagPush, requireCovers, requireFresh, requireNoNewFailures, runnerFaults, uncoveredFailures} from './release-nightly.ts';

const latest = {id: 42, head_sha: 'a'.repeat(40), status: 'completed', conclusion: 'failure', event: 'schedule'};
const fixedLatest = latest;
const dispatched = {...latest, id: 43, event: 'workflow_dispatch', display_title: 'nightly release proof'};
const diagnostic = {...dispatched, id: 44, display_title: 'nightly'};
const old = 'chromium/old@hash/hover', planted = 'webkit/planted@hash/boot';
const report = {version: 2, run: '42', sha: latest.head_sha, pins: 'b'.repeat(64), testList: 'c'.repeat(64),
  ok: false, tag: 'HOLD', failures: [{key: old}], newFailures: []};
const fixedReport = report;

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

await test('ALLOW_NIGHTLY_FAILURES covers only the failures its fix names', () => {
  const fix = {sha: 'f'.repeat(40), message: 'fix(nightly): cold heads boot and explore again\n\nNightly 42 failed boot and Explorer; pass cook, boot, hover, draw and explorer.', files: ['src/scripts/nightly-heads.ts']};
  const keys = ['chromium/nine@ab12/boot', 'webkit/nine@ab12/hover', 'chromium/nine@ab12/explorer', 'runner/heads'];
  assert.deepEqual(uncoveredFailures(keys, [fix]), []);
  assert.deepEqual(uncoveredFailures([...keys, 'webkit/nine@ab12/sound', 'runner/budgets', 'test/door.test.ts'], [fix]), ['webkit/nine@ab12/sound', 'runner/budgets', 'test/door.test.ts']);
  assert.deepEqual(uncoveredFailures(['test/door.test.ts'], [{...fix, files: ['test/door.test.ts']}]), []);
  assert.deepEqual(uncoveredFailures(['chromium/nine@ab12/boot'], [{...fix, message: 'reboots the bootstrap', files: []}]), ['chromium/nine@ab12/boot']);
});

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

// Meta QA 11-25 row 142: v0.1.96's shape. Its tag (a `chore(release)` stamp on the cut) met nightly 45670286813,
// 15.7 h older than the cut and 17.8 h old at the push: on the line and fresh, so the red verdict alone held it.
await test('a verdict over 26 h old or off the tag\'s line holds the tag', () => {
  const now = Date.parse('2026-11-26T11:46:00Z');
  requireFresh({id: 45670286813, created_at: '2026-11-25T17:58:18Z'}, now);
  assert.throws(() => requireFresh({id: 7, created_at: '2026-11-25T09:45:00Z'}, now), /nightly 7 started 26\.0 h ago, over 26\.0 h; release held\. Dispatch one on main/u);
  assert.throws(() => requireFresh({id: 7}, now), /no start time; release held/u);
  assert.equal(releaseTagCommit(`refs/tags/v1.2.3 ${'b'.repeat(40)} refs/tags/v1.2.3 ${'0'.repeat(40)}`), `${'b'.repeat(40)}^{commit}`);
  assert.equal(releaseTagCommit(`refs/heads/main ${'b'.repeat(40)} refs/heads/main ${'0'.repeat(40)}`), null);
  mkdirSync('tmp/release-nightly', {recursive: true});
  const root = mkdtempSync(resolve('tmp/release-nightly/line-'));
  try {
    const env = {...process.env};
    for (const key of Object.keys(env)) if (key.startsWith('GIT_')) Reflect.deleteProperty(env, key);
    const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=TC22 proof', '-c', 'user.email=tc22@example.invalid', ...args], {cwd: root, env, encoding: 'utf8', stdio: 'pipe'});
    const commit = (subject: string) => {git('commit', '--quiet', '--allow-empty', '-m', subject); return git('rev-parse', 'HEAD').trim();};
    git('init', '--quiet', '--initial-branch=main');
    const nightly = commit('feat: tested by the nightly');
    commit('fix: after the nightly');
    const cut = commit('fix: the cut');
    const later = commit('feat: main after the cut');
    git('checkout', '--quiet', '-b', 'release', cut);
    const tag = commit('chore(release): v1.2.3');
    // Before the cut: the tag contains the nightly's head and carries 3 commits past it.
    assert.equal(requireCovers({id: 1, head_sha: nightly}, tag, git), 3);
    // After the cut: the nightly tested every main commit the tag carries; only the stamp is past their fork.
    assert.equal(requireCovers({id: 2, head_sha: later}, tag, git), 0);
    // A tag whose own line adds a real commit the nightly never saw beside newer main work is off the line.
    const hotfix = commit('fix: only on the release line');
    assert.throws(() => requireCovers({id: 3, head_sha: later}, hotfix, git), /nightly 3 .* is off the tag's line: the tag carries 2 commits/u);
    assert.throws(() => requireCovers({id: 4, head_sha: 'c'.repeat(40)}, tag, git), /nightly 4's head c{10} is not in this clone; release held/u);
  } finally {rmSync(root, {recursive: true, force: true});}
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
    const base = {...process.env, CI: '1', PATH: `${join(root, 'bin')}${delimiter}${process.env.PATH ?? ''}`};
    for (const key of Object.keys(base)) if (key.startsWith('GIT_')) Reflect.deleteProperty(base, key);
    let gitEnv: NodeJS.ProcessEnv = base;
    const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=TC22 proof', '-c', 'user.email=tc22@example.invalid', ...args], {cwd: root, env: gitEnv, encoding: 'utf8', stdio: 'pipe'}).trim();
    git('init', '--quiet', '--initial-branch=main');
    git('commit', '--quiet', '--allow-empty', '-m', 'release fixture');
    // Row 142: the verdict's run is fresh and its head is the tag's own line.
    const head = git('rev-parse', 'HEAD'), started = new Date(Date.now() - 3_600_000).toISOString();
    const latest = {...fixedLatest, head_sha: head, created_at: started};
    const dispatched = {...latest, id: 43, event: 'workflow_dispatch', display_title: 'nightly release proof'};
    const diagnostic = {...dispatched, id: 44, display_title: 'nightly'};
    const report = {...fixedReport, sha: head};
    const execute = (value: unknown, missing = false, runs: unknown[] = [diagnostic, latest], extra: Record<string, string> = {}) => {
      writeFileSync(file, JSON.stringify(value));
      return spawnSync(process.execPath, [entry], {cwd: root, encoding: 'utf8', timeout: 5000,
        env: {...base, ...extra, TC22_RUNS: JSON.stringify(runs), TC22_REPORT: file, TC22_MISSING: missing ? '1' : '0'}});
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
    // Row 142: a 27 h old verdict holds the tag before any download, naming the dispatch; J381's hatch lets it through.
    const aging = {...latest, created_at: new Date(Date.now() - 27 * 3_600_000).toISOString()};
    const aged = execute(report, false, [aging]);
    assert.notEqual(aged.status, 0); assert.match(aged.stderr, /started 27\.0 h ago, over 26\.0 h; release held\. Dispatch one on main: gh workflow run nightly/u);
    assert.doesNotMatch(aged.stderr, /LOCAL_GATE_REACHED/u);
    // ALLOW_NIGHTLY_FAILURES=<fix> (J381) passes only when the fix names every new failure; one it does not name holds.
    const fix = git('commit-tree', `${head}^{tree}`, '-p', head, '-m', 'fix(nightly): heads boot again', '-m', 'Nightly 42 failed every boot.');
    const failing = {...report, failures: [{key: planted}], newFailures: [planted]};
    const covered = execute(failing, false, [diagnostic, latest], {ALLOW_NIGHTLY_FAILURES: fix.slice(0, 10)});
    assert.equal(covered.status, 37, covered.stderr); assert.match(covered.stdout, /ALLOW_NIGHTLY_FAILURES=\S+ \(J381\): all 1 new failures named/u);
    const cook = 'chromium/other@hash/cook';
    const uncovered = execute({...failing, failures: [{key: planted}, {key: cook}], newFailures: [planted, cook]}, false, [diagnostic, latest], {ALLOW_NIGHTLY_FAILURES: fix});
    assert.notEqual(uncovered.status, 0); assert.match(uncovered.stderr, /names no fix for 1 of 2 new failures; release held: chromium\/other@hash\/cook/u);
    assert.doesNotMatch(uncovered.stderr, /LOCAL_GATE_REACHED/u);
    const unnamed = git('commit-tree', `${head}^{tree}`, '-p', head, '-m', 'fix(nightly): boot again');
    const silent = execute(failing, false, [diagnostic, latest], {ALLOW_NIGHTLY_FAILURES: unnamed});
    assert.notEqual(silent.status, 0); assert.match(silent.stderr, /does not name nightly 42/u);
    const bare = execute(failing, false, [diagnostic, latest], {ALLOW_NIGHTLY_FAILURES: '1'});
    assert.notEqual(bare.status, 0); assert.match(bare.stderr, /takes fixing commit SHAs/u);
    const mismatched = execute({...failing, run: '41'}, false, [diagnostic, latest], {ALLOW_NIGHTLY_FAILURES: fix});
    assert.notEqual(mismatched.status, 0); assert.match(mismatched.stderr, /mismatched/u);
    const hatch = execute(report, false, [aging], {ALLOW_STALE_NIGHTLY: '1'});
    assert.equal(hatch.status, 37, hatch.stderr); assert.match(hatch.stdout, /ALLOW_STALE_NIGHTLY=1 \(J381\)/u);
    assert.deepEqual(readdirSync(join(root, 'tmp/release-nightly')), []);

    // The current repo-kit branch-release helper pushes a version tag;
    // it no longer calls release-check. Exercise that actual Git hook.
    const env = {...base, TC22_RUNS: JSON.stringify([diagnostic, dispatched, latest]), TC22_REPORT: file, TC22_MISSING: '0'};
    gitEnv = env;
    git('init', '--quiet', '--bare', 'remote.git');
    git('remote', 'add', 'origin', join(root, 'remote.git'));
    git('config', 'core.hooksPath', '.githooks');
    copyFileSync(resolve('.githooks/pre-push'), join(root, '.githooks/pre-push'));
    chmodSync(join(root, '.githooks/pre-push'), 0o755);
    // Unrelated blob/AGENTS/pin checks pass; the real release gate must still
    // refuse before the downstream full check or a byte reaches origin.
    for (const name of ['check-push', 'agents-md', 'pin-provenance']) writeFileSync(join(root, `.githooks/${name}.mjs`), '');
    mkdirSync(join(root, 'src/scripts'), { recursive: true });
    for (const name of ['release-nightly.ts', 'nightly-keeper.ts']) copyFileSync(resolve(`src/scripts/${name}`), join(root, `src/scripts/${name}`));
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
    writeFileSync(file, JSON.stringify({...faulted, run: '43', sha: head}));
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
