// scripts/main-push.mjs (meta M1, ported from meta's MF7 main-push test): real git, a bare fake remote and two clones of it. Lane A works in the
// "shared checkout" beside another lane's tracked edit, staged file and untracked file; lane B pushes in between.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, beforeEach, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { gateEnv, heldCommits, parseArgs } from '../scripts/main-push.mjs';

const SCRIPT = fileURLToPath(new URL('../scripts/main-push.mjs', import.meta.url));
const repoDir = fileURLToPath(new URL('..', import.meta.url));
const work = join(repoDir, `tmp/main-push-test-${process.pid}`);
const remote = join(work, 'remote.git');
const a = join(work, 'a');
const b = join(work, 'b');
after(() => rmSync(work, { recursive: true, force: true }));

// main-push strips every GIT_* variable, identity included, so the test's own git config carries `user.*` (main ci 43965567759:
// "Author identity unknown" on a runner with no global identity). Its own HOME, with useConfigOnly, makes every machine that runner:
// no global config, and no identity guessed from the host name, as macOS's git does.
const home = join(work, 'home');
const env = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))), HOME: home, XDG_CONFIG_HOME: home, WS_MAIN_PUSH_RECEIPT: '0', WS_MAIN_PUSH_NOTIFY: '0', WS_LANE_NAME: 'lane-a' };
const ID = { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
const git = (cwd, ...args) => {
  const out = spawnSync('git', args, { cwd, encoding: 'utf8', env: { ...env, ...ID } });
  assert.equal(out.status, 0, `git ${args.join(' ')}: ${out.stderr}`);
  return out.stdout.trim();
};
const write = (dir, path, text) => {
  mkdirSync(join(dir, path, '..'), { recursive: true });
  writeFileSync(join(dir, path), text);
};
const read = (dir, path) => readFileSync(join(dir, path), 'utf8');
const push = (cwd, ...args) => spawnSync(process.execPath, [SCRIPT, '--wait', '0', ...args], { cwd, encoding: 'utf8', env: { ...env, ...ID } });
const clone = (dir) => {
  git(work, 'clone', '--quiet', remote, dir);
  git(dir, 'config', 'core.hooksPath', join(dir, '.hooks'));
};
/** B commits one file and pushes, as another lane would. */
const otherLanePushes = (path, text) => {
  git(b, 'pull', '--quiet', '--rebase', 'origin', 'main');
  write(b, path, text);
  git(b, 'add', '--', path);
  git(b, 'commit', '--quiet', '-m', `B ${path}`, '--', path);
  git(b, 'push', '--quiet', 'origin', 'main');
};
const remoteFile = (path) => git(remote, 'show', `main:${path}`);
const notMidRebase = (dir) => {
  for (const name of ['rebase-merge', 'rebase-apply', 'MERGE_HEAD']) assert.equal(existsSync(join(dir, '.git', name)), false, name);
  assert.equal(git(dir, 'symbolic-ref', 'HEAD'), 'refs/heads/main');
};

beforeEach(() => {
  rmSync(work, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });
  write(home, '.gitconfig', '[user]\n\tuseConfigOnly = true\n\tname = t\n\temail = t@t\n');
  git(work, 'init', '--quiet', '--bare', '--initial-branch=main', remote);
  const seed = join(work, 'seed');
  git(work, 'init', '--quiet', '--initial-branch=main', seed);
  for (const path of ['plan.md', 'other.md', 'shared.md']) write(seed, path, `${path} line 1\n`);
  git(seed, 'add', '--', 'plan.md', 'other.md', 'shared.md');
  git(seed, 'commit', '--quiet', '-m', 'seed');
  git(seed, 'push', '--quiet', remote, 'main');
  clone(a);
  clone(b);
});

test('commits only the named files, syncs past another lane, pushes, and leaves other lanes\' files byte-identical', () => {
  // Another lane in A: a tracked edit, a staged new file and an untracked file.
  write(a, 'other.md', 'other lane edit\n');
  write(a, 'staged.md', 'staged by another lane\n');
  git(a, 'add', '--', 'staged.md');
  write(a, 'loose.md', 'untracked, another lane\n');
  otherLanePushes('shared.md', 'B changed shared\n');
  write(a, 'plan.md', 'A ticks the plan\n');
  write(a, 'new-row.md', 'A new file\n');

  const out = push(a, '-m', 'docs: A ticks', 'plan.md', 'new-row.md');
  assert.equal(out.status, 0, out.stderr);
  assert.match(out.stdout, /main-push committed [0-9a-f]{8}\n/u);
  assert.match(out.stdout, /\(replayed 1 local commit\(s\)\); other lanes' files untouched/u);
  assert.match(out.stdout, /main-push pushed main [0-9a-f]{10}: \d+ commit\(s\)/u);
  assert.equal(remoteFile('plan.md'), 'A ticks the plan');
  assert.equal(remoteFile('new-row.md'), 'A new file');
  assert.equal(remoteFile('shared.md'), 'B changed shared');
  assert.equal(read(a, 'shared.md'), 'B changed shared\n', 'main\'s change reached the tree');
  assert.equal(read(a, 'other.md'), 'other lane edit\n');
  assert.equal(read(a, 'loose.md'), 'untracked, another lane\n');
  assert.equal(git(a, 'diff', '--cached', '--name-only'), 'staged.md', 'the other lane\'s staging is kept');
  assert.equal(git(a, 'status', '--short', '--', 'other.md', 'loose.md'), 'M other.md\n?? loose.md');
  assert.equal(spawnSync('git', ['cat-file', '-e', 'main:staged.md'], { cwd: remote }).status !== 0, true, 'nothing of the other lane was pushed');
  notMidRebase(a);
});

test('a real conflict holds only its lane with exact committed bytes and prints its recovery command', () => {
  otherLanePushes('plan.md', 'B wrote line 1\n');
  write(a, 'plan.md', 'A wrote line 1\n');
  write(a, 'other.md', 'other lane edit\n');
  const out = push(a, '-m', "docs: A's tick", 'plan.md');
  assert.equal(out.status, 1);
  assert.match(out.stderr, /^main-push STOP lane lane-a is held at refs\/wildshard-held\/lane-a\/[0-9a-f]{40}; only that lane stops\./mu);
  const [held] = heldCommits(a);
  assert.ok(held);
  assert.match(out.stderr, new RegExp(`--onto ${held.upstream.slice(0, 12)}`, 'u'));
  assert.equal(git(a, 'show', `${held.ref}:plan.md`), 'A wrote line 1');
  notMidRebase(a);
  assert.equal(git(a, 'rev-parse', 'HEAD'), git(remote, 'rev-parse', 'main'), 'main can advance without the held lane');
  assert.equal(git(a, 'status', '--short', '--', 'plan.md', 'other.md'), 'M other.md', 'the other lane edit survives');
  assert.equal(read(a, 'plan.md'), 'B wrote line 1\n');
  assert.equal(read(a, 'other.md'), 'other lane edit\n');
  assert.equal(remoteFile('plan.md'), 'B wrote line 1');

  // The lane merges against the printed SHA; meanwhile another lane pushes a file A does not touch.
  write(a, 'plan.md', 'B wrote line 1\nA wrote line 2\n');
  otherLanePushes('shared.md', 'B again\n');
  const onto = push(a, '--onto', held.upstream, '-m', "docs: A's tick", 'plan.md');
  assert.equal(onto.status, 0, onto.stderr);
  assert.equal(remoteFile('plan.md'), 'B wrote line 1\nA wrote line 2');
  assert.equal(remoteFile('shared.md'), 'B again');
  assert.equal(git(remote, 'log', '-1', '--format=%s', 'main'), "docs: A's tick");
  assert.equal(read(a, 'other.md'), 'other lane edit\n');
  assert.equal(git(a, 'status', '--short', '--', 'plan.md', 'shared.md'), '', 'A is in step with origin');
  assert.deepEqual(heldCommits(a), []);
  notMidRebase(a);
});

test('M11 drops a patch already on origin while preserving peer staging and edits', () => {
  otherLanePushes('plan.md', 'same patch\n');
  write(a, 'plan.md', 'same patch\n');
  write(a, 'other.md', 'dirty peer\n');
  write(a, 'staged.md', 'staged peer\n'); git(a, 'add', '--', 'staged.md');
  write(a, 'loose.md', 'untracked peer\n');
  const out = push(a, '-m', 'docs: duplicate', 'plan.md');
  assert.equal(out.status, 0, out.stderr);
  assert.match(out.stdout, /dropped 1 duplicate\(s\)/u);
  assert.equal(git(a, 'rev-parse', 'HEAD'), git(remote, 'rev-parse', 'main'));
  assert.equal(read(a, 'other.md'), 'dirty peer\n');
  assert.equal(read(a, 'loose.md'), 'untracked peer\n');
  assert.equal(git(a, 'diff', '--cached', '--name-only'), 'staged.md');
  assert.deepEqual(heldCommits(a), []);
});

test('M11 a conflicting peer and its later commits cannot block an independent lane', () => {
  write(a, 'plan.md', 'peer conflict\n');
  git(a, 'commit', '-qm', 'peer conflict', '-m', 'Lane: lane-b', '--', 'plan.md');
  const original = git(a, 'rev-parse', 'HEAD');
  write(a, 'peer-later.md', 'dependent peer work\n'); git(a, 'add', '--', 'peer-later.md');
  git(a, 'commit', '-qm', 'peer later', '-m', 'Lane: lane-b', '--', 'peer-later.md');
  otherLanePushes('plan.md', 'remote conflict\n');
  write(a, 'other.md', 'dirty third lane\n');
  write(a, 'staged.md', 'staged third lane\n'); git(a, 'add', '--', 'staged.md');
  write(a, 'loose.md', 'untracked third lane\n');
  write(a, 'mine.md', 'independent lane-a\n');
  const out = push(a, '-m', 'docs: mine', 'mine.md');
  assert.equal(out.status, 0, out.stderr);
  assert.match(out.stdout, /held lane\(s\) lane-b/u);
  assert.equal(remoteFile('mine.md'), 'independent lane-a');
  assert.equal(remoteFile('plan.md'), 'remote conflict');
  const held = heldCommits(a);
  assert.equal(held.length, 2);
  assert.ok(held.every(row => row.lane === 'lane-b'));
  assert.equal(git(a, 'show', `${held.find(row => row.sha === original).ref}:plan.md`), 'peer conflict');
  assert.equal(read(a, 'other.md'), 'dirty third lane\n');
  assert.equal(read(a, 'loose.md'), 'untracked third lane\n');
  assert.equal(git(a, 'diff', '--cached', '--name-only'), 'staged.md');
  const stopped = spawnSync(process.execPath, [SCRIPT, '--wait', '0'], { cwd: a, encoding: 'utf8', env: { ...env, WS_LANE_NAME: 'lane-b' } });
  assert.equal(stopped.status, 1);
  assert.match(stopped.stderr, /lane lane-b is held/u);
  assert.equal(push(a).status, 0, 'lane-a keeps working while lane-b repairs');
  notMidRebase(a);
});

test('--onto refuses when origin/main changed the file again, and leaves the merged edit alone', () => {
  const base = git(a, 'rev-parse', 'HEAD');
  otherLanePushes('plan.md', 'B changed it after A merged\n');
  write(a, 'plan.md', 'A merged against the old base\n');
  const out = push(a, '--onto', base.slice(0, 12), '-m', 'docs: A', 'plan.md');
  assert.equal(out.status, 1);
  assert.match(out.stderr, /origin\/main changed plan\.md again since [0-9a-f]{8}; nothing moved\. Your files are as they were\..*--onto [0-9a-f]{12} -m 'docs: A' plan\.md$/mu);
  assert.equal(read(a, 'plan.md'), 'A merged against the old base\n');
  assert.equal(git(a, 'rev-parse', 'HEAD'), base);
  assert.equal(git(a, 'diff', '--cached', '--name-only'), '', 'the index is as it was');
});

test('another lane\'s uncommitted edit in a path main changes waits, tries again, then stops with nothing moved', () => {
  write(a, 'shared.md', 'another lane is editing shared\n');
  otherLanePushes('shared.md', 'B changed shared\n');
  write(a, 'plan.md', 'A ticks\n');
  const head = git(a, 'rev-parse', 'HEAD');
  const out = push(a, '--tries', '3', '-m', 'docs: A', 'plan.md');
  assert.equal(out.status, 1);
  assert.equal((out.stdout.match(/try \d of 3: uncommitted edits in paths origin\/main changes: shared\.md/gu) ?? []).length, 2);
  assert.match(out.stderr, /^main-push STOP uncommitted edits in paths origin\/main changes: shared\.md; nothing moved/mu);
  assert.equal(read(a, 'shared.md'), 'another lane is editing shared\n');
  assert.equal(git(a, 'rev-parse', 'HEAD~1'), head, 'A\'s commit is on local main, nothing else moved');
  notMidRebase(a);
  // The lane commits its edit by pathspec; the next run gets through without a new commit of A's.
  write(a, 'shared.md', 'B changed shared\n');
  git(a, 'commit', '--quiet', '-m', 'other lane: shared', '--', 'shared.md');
  const again = push(a);
  assert.equal(again.status, 0, again.stderr);
  assert.equal(remoteFile('plan.md'), 'A ticks');
});

test('a push race retries; a refusing pre-push stops without retrying', () => {
  // A pre-push hook in A that, the first time only, lets B win the race.
  write(a, '.hooks/pre-push', `#!/bin/sh\nif [ ! -e "${work}/raced" ]; then touch "${work}/raced"; cd "${b}" && git pull -q --rebase origin main && echo b > race.md && git add race.md && git commit -qm race -- race.md && git push -q origin main; fi\nexit 0\n`);
  chmodSync(join(a, '.hooks/pre-push'), 0o755);
  write(a, 'plan.md', 'A ticks\n');
  const out = push(a, '-m', 'docs: A', 'plan.md');
  assert.equal(out.status, 0, out.stderr);
  assert.match(out.stdout, /try 1 of 8: origin\/main moved during the push/u);
  assert.equal(remoteFile('race.md'), 'b');
  assert.equal(remoteFile('plan.md'), 'A ticks');

  write(a, '.hooks/pre-push', '#!/bin/sh\necho "  X push blocked: parity" >&2\nexit 1\n');
  write(a, 'other.md', 'A again\n');
  const refused = push(a, '-m', 'docs: A again', 'other.md');
  assert.equal(refused.status, 1);
  assert.doesNotMatch(refused.stdout, /try \d/u);
  assert.match(refused.stderr, /main-push STOP git push refused by the pre-push: .*push blocked: parity/u);
});

test('refuses a directory, a missing message, and a checkout mid-rebase; a refused commit unstages what it added', () => {
  write(a, 'docs/x.md', 'x\n');
  assert.match(push(a, '-m', 'docs: x', 'docs').stderr, /docs is a directory; name each file/u);
  assert.equal(git(a, 'status', '--short', '--', 'docs'), '?? docs/');
  assert.equal(push(a, 'plan.md').status, 2);
  assert.deepEqual(parseArgs(['-m', 's', '-m', 'body', '--', 'a.md', '-odd.md']), { messages: ['s', 'body'], files: ['a.md', '-odd.md'], tries: 8, wait: 5, onto: '' });
  assert.match(parseArgs(['--force']).error, /unknown option/u);

  write(a, '.hooks/commit-msg', '#!/bin/sh\necho "subject too long" >&2\nexit 1\n');
  chmodSync(join(a, '.hooks/commit-msg'), 0o755);
  const refused = push(a, '-m', 'docs: x', 'docs/x.md');
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /git commit refused: .*subject too long/u);
  assert.equal(git(a, 'status', '--short', '--', 'docs'), '?? docs/', 'the file it added is unstaged again');

  mkdirSync(join(a, '.git/rebase-merge'));
  assert.match(push(a).stderr, /a git rebase-merge is in progress in the shared checkout/u);
});

test('one run at a time: a live lock waits then stops; a dead one is taken over; the lock is gone after a run', () => {
  const lock = join(a, '.git/main-push.lock');
  mkdirSync(lock);
  writeFileSync(join(lock, 'pid'), `${process.pid}\n`);
  write(a, 'plan.md', 'A ticks\n');
  const held = push(a, '--tries', '2', '-m', 'docs: A', 'plan.md');
  assert.equal(held.status, 1);
  assert.match(held.stdout, /try 1 of 2: another main-push \(pid \d+\) is running/u);
  assert.match(held.stderr, /^main-push STOP another main-push \(pid \d+\) holds .*main-push\.lock; nothing moved/mu);
  assert.equal(git(a, 'status', '--short', '--', 'plan.md'), 'M plan.md', 'nothing was committed');

  writeFileSync(join(lock, 'pid'), '999999\n');
  const stale = push(a, '-m', 'docs: A', 'plan.md');
  assert.equal(stale.status, 0, stale.stderr);
  assert.match(stale.stdout, /taking over a stale lock \(pid 999999, gone\)/u);
  assert.equal(existsSync(lock), false);
  assert.equal(remoteFile('plan.md'), 'A ticks');
});

test('ALLOW_CARRY=1 sends another lane\'s committed commit along and names it (M1)', () => {
  write(a, 'carried.md', 'x\n');
  git(a, 'add', 'carried.md');
  git(a, 'commit', '--quiet', '-m', 'other lane: carried', '--', 'carried.md');
  write(a, 'mine.md', 'y\n');
  const out = spawnSync(process.execPath, [SCRIPT, '--wait', '0', '-m', 'docs: mine', 'mine.md'], { cwd: a, encoding: 'utf8', env: { ...env, ...ID, ALLOW_CARRY: '1' } });
  assert.equal(out.status, 0, out.stderr);
  // FS19: the pusher's herdr pane rides in the receipt when the push runs in one.
  assert.match(out.stdout, /2 commit\(s\)(?: pane \S+)?, 1 of them another lane's, carried along \(M1\): [0-9a-f]+ other lane: carried/u);
});

// Meta QA 11-25 row 58: in a shared checkout one lane's main-push sent another lane's local commits with its own.
test('two lanes\' commits in one checkout: each push sends only its own lane\'s, and names what it leaves', () => {
  // lane-b committed in the shared checkout (main-push's Lane line), its push not yet made; an unnamed hand commit too.
  write(a, 'theirs.md', 'lane-b work\n');
  git(a, 'add', 'theirs.md');
  git(a, 'commit', '--quiet', '-m', 'docs: theirs', '-m', 'Lane: lane-b', '-m', 'Assisted-by: Claude:claude-opus-5-5', '--', 'theirs.md');
  write(a, 'loose.md', 'nobody named\n');
  git(a, 'add', 'loose.md');
  git(a, 'commit', '--quiet', '-m', 'docs: unnamed', '--', 'loose.md');
  otherLanePushes('shared.md', 'B moved main\n');
  write(a, 'mine.md', 'lane-a work\n');
  const out = push(a, '-m', 'docs: mine', 'mine.md');
  assert.equal(out.status, 0, out.stderr);
  assert.match(out.stdout, /pushed main [0-9a-f]+: 1 commit\(s\)/u);
  // The sync replayed lane-b's commit past lane B's push, so its SHA is new; its lane and subject name it.
  assert.match(out.stdout, /left on local main for their lane \(row 58\): [0-9a-f]{10} \(lane-b\) docs: theirs; [0-9a-f]{10} \(no Lane trailer\) docs: unnamed/u);
  assert.equal(remoteFile('mine.md'), 'lane-a work');
  assert.equal(remoteFile('shared.md'), 'B moved main');
  assert.throws(() => remoteFile('theirs.md'), 'lane-b\'s commit stays put');
  assert.throws(() => remoteFile('loose.md'), 'an unnamed commit stays put');
  // Local main is origin/main plus the commits left for their lanes.
  assert.deepEqual(git(a, 'log', '--format=%s', 'origin/main..HEAD').split('\n'), ['docs: unnamed', 'docs: theirs']);
  assert.equal(read(a, 'theirs.md'), 'lane-b work\n');
  notMidRebase(a);

  // lane-b pushes its own: the unnamed commit still stays.
  const theirPush = spawnSync(process.execPath, [SCRIPT, '--wait', '0'], { cwd: a, encoding: 'utf8', env: { ...env, ...ID, WS_LANE_NAME: 'lane-b' } });
  assert.equal(theirPush.status, 0, theirPush.stderr);
  assert.equal(remoteFile('theirs.md'), 'lane-b work');
  assert.throws(() => remoteFile('loose.md'));
  assert.equal(git(a, 'log', '--format=%s', 'origin/main..HEAD'), 'docs: unnamed');
});

test('a lane\'s commit that needs another lane\'s local commit stops, naming it, and nothing goes out', () => {
  write(a, 'theirs.md', 'lane-b line\n');
  git(a, 'add', 'theirs.md');
  git(a, 'commit', '--quiet', '-m', 'docs: theirs', '-m', 'Lane: lane-b', '--', 'theirs.md');
  const before = git(remote, 'rev-parse', 'main');
  write(a, 'theirs.md', 'lane-b line\nlane-a adds a line\n');
  const out = push(a, '-m', 'docs: builds on theirs', 'theirs.md');
  assert.equal(out.status, 1);
  assert.match(out.stderr, /main-push STOP your commit [0-9a-f]{10} docs: builds on theirs does not apply without another lane's local commit\(s\), which this lane never pushes \(row 58\): [0-9a-f]{10} \(lane-b\) docs: theirs/u);
  assert.equal(git(remote, 'rev-parse', 'main'), before);
  notMidRebase(a);
});

// Meta QA 11-25 row 53: engine 5068a7365's push was refused on typecheck (an untyped .mjs), then another lane's
// `SKIP_CHECK=1` main-push carried it ungated to main, red. A stand-in typecheck: a `.mjs` holding `untyped` fails.
const TYPECHECK = '#!/bin/sh\n[ "$SKIP_CHECK" = 1 ] && exit 0\nwhile read -r _ local _ remote; do\n  for f in $(git diff --name-only "$remote" "$local" -- "*.mjs"); do\n    if git show "$local:$f" | grep -q untyped; then echo "  X push blocked: $f(1,14): error TS7006: Parameter \'k\' implicitly has an \'any\' type." >&2; exit 1; fi\n  done\ndone\nexit 0\n';

test('a push adding an untyped .mjs is refused, and SKIP_CHECK=1 never skips the gate for a carried commit', () => {
  write(a, '.hooks/pre-push', TYPECHECK);
  chmodSync(join(a, '.hooks/pre-push'), 0o755);
  write(a, 'capture.mjs', 'export const keys = (k, d) => k; // untyped\n');
  const own = push(a, '-m', 'feat: capture', 'capture.mjs');
  assert.equal(own.status, 1);
  assert.match(own.stderr, /main-push STOP git push refused by the pre-push: .*capture\.mjs\(1,14\): error TS7006/u);

  // The refused commit stays on local main. Row 58: the next lane's push leaves it there; under ALLOW_CARRY=1 it would
  // carry it along (M1), and SKIP_CHECK=1 still never skips the gate for it.
  write(a, 'mine.md', 'y\n');
  const carried = spawnSync(process.execPath, [SCRIPT, '--wait', '0', '-m', 'docs: mine', 'mine.md'], { cwd: a, encoding: 'utf8', env: { ...env, ...ID, SKIP_CHECK: '1', ALLOW_CARRY: '1', WS_LANE_NAME: 'lane-b' } });
  assert.equal(carried.status, 1, carried.stdout);
  assert.match(carried.stderr, /error TS7006/u);
  assert.throws(() => remoteFile('capture.mjs'), 'the untyped file never reached main');
  const mineOnly = spawnSync(process.execPath, [SCRIPT, '--wait', '0'], { cwd: a, encoding: 'utf8', env: { ...env, ...ID, SKIP_CHECK: '1', WS_LANE_NAME: 'lane-b' } });
  assert.equal(mineOnly.status, 0, mineOnly.stderr);
  assert.equal(remoteFile('mine.md'), 'y');
  assert.throws(() => remoteFile('capture.mjs'), 'lane-a\'s refused commit stays on local main (row 58)');
});

test('gateEnv drops SKIP_CHECK only when another lane\'s commit rides along', () => {
  assert.deepEqual(gateEnv({ SKIP_CHECK: '1', A: 'x' }, ['abc other lane']), { env: { A: 'x' }, dropped: true });
  assert.deepEqual(gateEnv({ SKIP_CHECK: '1' }, []), { env: { SKIP_CHECK: '1' }, dropped: false });
  assert.deepEqual(gateEnv({ A: 'x' }, ['abc other lane']), { env: { A: 'x' }, dropped: false });
});
