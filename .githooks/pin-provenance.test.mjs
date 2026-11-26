// J375 pin provenance (meta MINI-FLOW MF4): a push to main that changes test/pins/ passes only when it is what land
// pushes for a green plan branch (exact or carried). Real git: a bare origin, a lane clone and a second clone.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixtureScratch } from '../src/test/.kit/owned-scratch.mjs';
import { checkPinPush, matchingPlanTips } from './pin-provenance.mjs';

const HOOK = join(dirname(fileURLToPath(import.meta.url)), 'pin-provenance.mjs');
const ENV = {
  ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_') && !key.startsWith('ALLOW_'))),
  GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t',
};

function world() {
  const box = fixtureScratch('pin-provenance');
  const origin = join(box, 'origin.git');
  const lane = join(box, 'lane');
  const other = join(box, 'other');
  const git = (cwd, ...args) => {
    const result = spawnSync('git', args, { cwd, env: ENV, encoding: 'utf8' });
    assert.equal(result.status, 0, `git ${args.join(' ')}: ${result.stderr}`);
    return result.stdout.trim();
  };
  const write = (cwd, path, text) => {
    mkdirSync(dirname(join(cwd, path)), { recursive: true });
    writeFileSync(join(cwd, path), text);
  };
  const commit = (cwd, files, message) => {
    for (const [path, text] of Object.entries(files)) write(cwd, path, text);
    git(cwd, 'add', '--', ...Object.keys(files));
    git(cwd, 'commit', '-q', '-m', message, '--', ...Object.keys(files));
    return git(cwd, 'rev-parse', 'HEAD');
  };
  git(box, 'init', '-q', '--bare', '-b', 'main', origin);
  git(box, 'clone', '-q', origin, lane);
  commit(lane, { 'test/pins/shardfiles.json': '{"nine":1}\n', 'test/pins/rings.json': '{"r":1}\n', 'src/a.ts': 'a\n' }, 'seed');
  git(lane, 'push', '-q', 'origin', 'main');
  git(box, 'clone', '-q', origin, other);
  /** Another lane lands something on main. */
  const otherLands = (files) => {
    git(other, 'pull', '-q', '--rebase', 'origin', 'main');
    commit(other, files, 'other lane');
    git(other, 'push', '-q', 'origin', 'main');
    git(lane, 'fetch', '-q', 'origin');
    return git(lane, 'rev-parse', 'origin/main');
  };
  /** A plan branch with a pin bump, pushed to origin like land's branch push. */
  const planBranch = (slug, files) => {
    git(lane, 'switch', '-q', '-c', `plan/${slug}`, 'origin/main');
    const sha = commit(lane, files, `pin bump on ${slug}`);
    git(lane, 'push', '-q', 'origin', `plan/${slug}`);
    git(lane, 'switch', '-q', '--detach', 'origin/main');
    return sha;
  };
  return { lane, git, commit, otherLands, planBranch };
}

const line = (pushed, old) => `refs/heads/main ${pushed} refs/heads/main ${old}`;
const green = () => 'green';

describe('pin provenance (J375)', () => {
  test('J422 push land: exact linked plan HEAD passes through the push gate; mode 1 cannot claim it', () => {
    const w = world();
    const old = w.git(w.lane, 'rev-parse', 'origin/main');
    const linked = join(w.lane, '.worktrees/push-pins');
    w.git(w.lane, 'worktree', 'add', '-b', 'plan/push-pins', linked, old);
    const tip = w.commit(linked, { 'test/pins/rings.json': '{"r":3}\n' }, 'pin change');
    const never = () => { throw new Error('push must not ask Actions'); };
    const verdict = checkPinPush({ cwd: linked, refs: line(tip, old), ciState: never, env: { WS_LAND_MAIN_PUSH: `push:${tip}` } });
    assert.equal(verdict.ok, true);
    assert.match(verdict.ok ? verdict.note ?? '' : '', /J422/u);
    assert.equal(checkPinPush({ cwd: w.lane, refs: line(tip, old), ciState: never, env: { WS_LAND_MAIN_PUSH: `push:${tip}` } }).ok, false);
    assert.equal(checkPinPush({ cwd: linked, refs: line(tip, old), ciState: never, env: { WS_LAND_MAIN_PUSH: `push:${old}` } }).ok, false);
  });
  test('FS18: main-push from a clone on main passes its own HEAD; a hand push, a stale marker or a worktree does not', () => {
    const w = world();
    const old = w.git(w.lane, 'rev-parse', 'origin/main');
    const tip = w.commit(w.lane, { 'test/pins/rings.json': '{"r":4}\n' }, 'pin re-record');
    const never = () => { throw new Error('main-push must not ask Actions'); };
    const verdict = checkPinPush({ cwd: w.lane, refs: line(tip, old), ciState: never, env: { WS_LAND_MAIN_PUSH: `main-push:${tip}` } });
    assert.equal(verdict.ok, true);
    assert.match(verdict.ok ? verdict.note ?? '' : '', /main-push/u);
    // A hand `git push origin main` sets no marker: no plan branch carries these pins, so it is refused.
    assert.equal(checkPinPush({ cwd: w.lane, refs: line(tip, old), ciState: never, env: {} }).ok, false);
    assert.equal(checkPinPush({ cwd: w.lane, refs: line(tip, old), ciState: never, env: { WS_LAND_MAIN_PUSH: `main-push:${old}` } }).ok, false);
    // Not on main (a plan worktree claiming main-push's marker) is refused: plans land with land.mjs.
    const linked = join(w.lane, '.worktrees/mp-pins');
    w.git(w.lane, 'worktree', 'add', '-b', 'plan/mp-pins', linked, old);
    const planTip = w.commit(linked, { 'test/pins/rings.json': '{"r":5}\n' }, 'pin change');
    assert.equal(checkPinPush({ cwd: linked, refs: line(planTip, old), ciState: never, env: { WS_LAND_MAIN_PUSH: `main-push:${planTip}` } }).ok, false);
  });
  test('exact land: the green plan SHA itself passes', () => {
    const w = world();
    const old = w.git(w.lane, 'rev-parse', 'origin/main');
    const tip = w.planBranch('nine-pin', { 'test/pins/shardfiles.json': '{"nine":2}\n' });
    const asked = [];
    const verdict = checkPinPush({ cwd: w.lane, refs: line(tip, old), ciState: (sha) => (asked.push(sha), 'green'), env: {} });
    assert.deepEqual(verdict, { ok: true, note: `test/pins change carried by origin/plan/nine-pin ${tip.slice(0, 10)}, ci green (J375)` });
    assert.deepEqual(asked, [tip]);
  });

  test('carried land: a clean rebase onto a main that moved, pins included, passes', () => {
    const w = world();
    const tip = w.planBranch('nine-pin', { 'test/pins/shardfiles.json': '{"nine":2}\n' });
    const moved = w.otherLands({ 'src/b.ts': 'b\n', 'test/pins/rings.json': '{"r":2}\n' });
    w.git(w.lane, 'switch', '-q', '--detach', moved);
    w.git(w.lane, 'cherry-pick', tip);
    const rebased = w.git(w.lane, 'rev-parse', 'HEAD');
    assert.equal(checkPinPush({ cwd: w.lane, refs: line(rebased, moved), ciState: green, env: {} }).ok, true);
  });

  test('mode 1: a pin change committed on main and pushed straight is refused, and says how to land it', () => {
    const w = world();
    w.planBranch('unrelated', { 'src/c.ts': 'c\n' });
    const old = w.git(w.lane, 'rev-parse', 'origin/main');
    const direct = w.commit(w.lane, { 'test/pins/shardfiles.json': '{"nine":3}\n' }, 'fix(pins): straight to main');
    const verdict = checkPinPush({ cwd: w.lane, refs: line(direct, old), ciState: green, env: {} });
    assert.equal(verdict.ok, false);
    const text = verdict.problems.join('\n');
    assert.match(text, /changes 1 file\(s\) under test\/pins\/ \(test\/pins\/shardfiles\.json\)/u);
    assert.match(text, /no origin\/plan\/\* branch carries these pins: this is a direct push/u);
    assert.match(text, /node src\/scripts\/\.kit\/worktree\.mjs new <slug>/u);
    assert.match(text, /WS_LANE_NAME=<lane> node src\/scripts\/\.kit\/land\.mjs/u);
    assert.match(text, /Escape hatch.*ALLOW_PIN_PUSH=1/u);
    assert.equal(checkPinPush({ cwd: w.lane, refs: line(direct, old), ciState: green, env: { ALLOW_PIN_PUSH: '1' } }).ok, true, 'the escape hatch passes');
  });

  test('a pin edit made on top of a green branch after its CI is refused: the tree is not what CI saw', () => {
    const w = world();
    const old = w.git(w.lane, 'rev-parse', 'origin/main');
    const tip = w.planBranch('nine-pin', { 'test/pins/shardfiles.json': '{"nine":2}\n' });
    w.git(w.lane, 'switch', '-q', '--detach', tip);
    const edited = w.commit(w.lane, { 'test/pins/shardfiles.json': '{"nine":2,"hand":true}\n' }, 'hand edit after CI');
    assert.deepEqual(matchingPlanTips(w.lane, old, edited), []);
    assert.equal(checkPinPush({ cwd: w.lane, refs: line(edited, old), ciState: green, env: {} }).ok, false);
  });

  test('the carrying branch must be green: red and pending refuse; GitHub down passes on offline provenance with a warning', () => {
    const w = world();
    const old = w.git(w.lane, 'rev-parse', 'origin/main');
    const tip = w.planBranch('nine-pin', { 'test/pins/shardfiles.json': '{"nine":2}\n' });
    for (const state of ['red', 'pending']) {
      const verdict = checkPinPush({ cwd: w.lane, refs: line(tip, old), ciState: () => state, env: {} });
      assert.equal(verdict.ok, false);
      assert.match(verdict.problems.join('\n'), new RegExp(`origin/plan/nine-pin ${tip.slice(0, 10)}: ci ${state}`, 'u'));
    }
    const down = checkPinPush({ cwd: w.lane, refs: line(tip, old), ciState: () => { throw new Error('gh: connection refused'); }, env: {} });
    assert.equal(down.ok, true, 'no gridlock on a GitHub outage (J381)');
    assert.match(down.note, /^WARNING GitHub could not be asked about origin\/plan\/nine-pin .*gh: connection refused.*passing on offline provenance/u);
    const direct = w.commit(w.lane, { 'test/pins/shardfiles.json': '{"nine":7}\n' }, 'direct');
    const offline = checkPinPush({ cwd: w.lane, refs: line(direct, old), ciState: () => { throw new Error('down'); }, env: {} });
    assert.equal(offline.ok, false, 'GitHub down never lets a direct push through: no plan tip carries it');
  });

  test('pushes that are not a main pin change pass without asking GitHub', () => {
    const w = world();
    const old = w.git(w.lane, 'rev-parse', 'origin/main');
    const code = w.commit(w.lane, { 'src/a.ts': 'a2\n' }, 'code only');
    const never = () => { throw new Error('must not ask'); };
    assert.deepEqual(checkPinPush({ cwd: w.lane, refs: line(code, old), ciState: never, env: {} }), { ok: true });
    const pins = w.commit(w.lane, { 'test/pins/rings.json': '{"r":9}\n' }, 'pins');
    assert.deepEqual(checkPinPush({ cwd: w.lane, refs: `refs/heads/plan/x ${pins} refs/heads/plan/x ${old}`, ciState: never, env: {} }), { ok: true });
    assert.deepEqual(checkPinPush({ cwd: w.lane, refs: `refs/heads/main ${pins} refs/heads/main ${'0'.repeat(40)}`, ciState: never, env: {} }), { ok: true });
  });

  test('the hook script asks GitHub through gh: green passes, gh failing warns, a direct push is refused with the way through', () => {
    const w = world();
    const old = w.git(w.lane, 'rev-parse', 'origin/main');
    const tip = w.planBranch('nine-pin', { 'test/pins/shardfiles.json': '{"nine":2}\n' });
    const bin = fixtureScratch('pin-provenance-gh');
    const run = (ghBody) => {
      writeFileSync(join(bin, 'gh'), `#!/usr/bin/env bash\n${ghBody}\n`);
      chmodSync(join(bin, 'gh'), 0o755);
      return spawnSync(process.execPath, [HOOK], { cwd: w.lane, input: `${line(tip, old)}\n`, encoding: 'utf8', env: { ...ENV, WS_LAND_REPO: 'o/r', PATH: `${bin}:${process.env.PATH}` } });
    };
    const runs = JSON.stringify({ workflow_runs: [{ id: 1, name: 'ci', head_sha: tip, event: 'push', status: 'completed', conclusion: 'success', head_branch: 'plan/nine-pin' }] });
    const ok = run(`[[ "$2" == "repos/o/r/actions/runs?head_sha=${tip}&per_page=50" ]] && echo '${runs}'`);
    assert.equal(ok.status, 0, ok.stderr);
    assert.match(ok.stderr, /pin provenance: test\/pins change carried by origin\/plan\/nine-pin/u);
    const down = run('echo "gh: API rate limit exceeded" >&2; exit 1');
    assert.equal(down.status, 0, down.stderr);
    assert.match(down.stderr, /pin provenance: WARNING GitHub could not be asked .*rate limit exceeded.*offline provenance/u);
    w.git(w.lane, 'switch', '-q', '--detach', old);
    const direct = w.commit(w.lane, { 'test/pins/shardfiles.json': '{"nine":5}\n' }, 'direct');
    const refused = spawnSync(process.execPath, [HOOK], { cwd: w.lane, input: `${line(direct, old)}\n`, encoding: 'utf8', env: { ...ENV, WS_LAND_REPO: 'o/r', PATH: `${bin}:${process.env.PATH}` } });
    assert.equal(refused.status, 1);
    assert.match(refused.stderr, /X push blocked: test\/pins\/ change without a green plan branch \(J375/u);
    assert.match(refused.stderr, /node src\/scripts\/\.kit\/land\.mjs/u);
  });
});
