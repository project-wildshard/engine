// J240 / DEV-SPEED DS21: src/scripts/.kit/land.mjs against real git. A bare repo stands
// in for GitHub (with protect-main's no-force, no-delete rule as an update
// hook) and a post-receive hook records every pushed tip. The guards land
// keeps in J422 push mode: pins and boot stamps before the gate, a clean tree,
// the pre-push's cause, the rebase install and Git ref-lock retries (meta
// FLOW-SIMPLE FS5 deleted the hosted land's preflight and plan push).
// oxlint-disable-next-line import/no-nodejs-modules -- Real git repositories, hooks and the land CLI.
import { execFileSync, spawn } from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- Fixture repositories stay in the repository scratch root.
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Fixture paths.
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { failingDetail, failureLine, PINS_LEDGER, prePushCause, REF_LOCK } from '../src/scripts/.kit/land.mjs';
import { BOOT_STAMPS } from '../src/scripts/boot-stamps.mjs';
import { cleanLandFixtures, fixture, prepushLines, type Fixture } from './fixtures/land-git';

afterEach(cleanLandFixtures);

// DS22: a stand-in for gen:inputs. It writes the bytes stamp from the tree's own src/*.ts files, so a commit or a rebase
// that adds one makes the committed stamp stale, as a new public/assets file does for the real one.
const STAMP = 'src/client/game/boot/bytes.generated.ts';
const GEN_STAMPS = "import {mkdirSync,readdirSync,statSync,writeFileSync} from 'node:fs';"
  + "const rows=readdirSync('src').filter(name=>name.endsWith('.ts')).sort().map(name=>name+':'+statSync('src/'+name).size);"
  + "mkdirSync('src/client/game/boot',{recursive:true});writeFileSync('src/client/game/boot/bytes.generated.ts','export const bytes = '+JSON.stringify(rows)+';\\n');";

describe('land (J422): the guards around the main push, and Git retries', () => {
  const plantPnpm = (f: Fixture, red: string | null) => {
    const log = join(f.root, 'pnpm.log');
    writeFileSync(join(f.root, 'bin/pnpm'), `#!/bin/sh\necho "$*" >> '${log}'\n${red === null ? '' : `[ "$1" = ${red} ] && { echo 'planted ${red} error'; exit 2; }\n`}exit 0\n`);
    return () => f.read(log).trim().split('\n').filter(Boolean);
  };

  // 2026-11-16 (codex-netlag, opus-publish1): a worktree rebased past a pin bump holds the old revision under out/, and
  // gen:inputs refuses it; the stop showed only the stack's tail. Land runs pins first, and a stop names the thrown error.
  test('a worktree whose out/ holds a pin main no longer names runs pnpm pins before gen:inputs', () => {
    const f = fixture(), calls = plantPnpm(f, null);
    const wt = f.worktree('foo');
    f.commit(wt, 'package.json', '{"scripts":{"pins":"node src/scripts/pins.ts"}}\n', 'chore: a pins script');
    f.commit(wt, 'test/pins/shardfiles.json', `${JSON.stringify({ shards: [{ slug: 'dunes', uploadNumber: 2, hash: 'b'.repeat(64) }] })}\n`, 'test(pins): dunes upload 2');
    writeFileSync(join(f.repo, '.git/info/exclude'), 'out/\n');
    mkdirSync(join(wt, 'out/dunes'), { recursive: true });
    writeFileSync(join(wt, PINS_LEDGER), '{}\n');
    writeFileSync(join(wt, 'out/dunes/validation.json'), `${JSON.stringify({ pin: { hash: 'a'.repeat(64), revision: 1 } })}\n`);
    const result = f.land(wt);
    expect(result.status, result.stdout).toBe(0);
    expect(calls()[0]).toBe('--silent pins');
    expect(result.stdout).toContain('out/ holds pins main no longer names (dunes upload 1); running pnpm pins before gen:inputs');
  }, 60_000);

  test('a gen:inputs stop names the thrown error, not the stack\'s tail', () => {
    const f = fixture();
    const wt = f.worktree('foo');
    f.commit(wt, 'src/scripts/gen.mjs', "function inner(){throw new Error('planted: out/ holds pinned products the pins no longer name');}\ninner();\n", 'build: a failing generator');
    const result = f.land(wt);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('failed before the gate (the pre-push would fail on it too): Error: planted: out/ holds pinned products the pins no longer name');
    expect(failureLine('a\nError: real cause\n    at x (y:1:2)\n    at process.processTicksAndRejections (node:internal)\n\nNode.js v24')).toBe('Error: real cause');
    expect(failureLine('one\ntwo\nthree\nfour')).toBe('two three four');
    expect(failureLine('', new Error('spawn ENOENT'))).toBe('spawn ENOENT');
  }, 60_000);

  // opus-gcm11: a worktree that never ran `pnpm pins` has no out/.pins.json, and gen:inputs fails on it.
  test('a worktree that never ran pnpm pins runs it before gen:inputs; one that has its ledger does not', () => {
    for (const ran of [false, true]) {
      const f = fixture(), calls = plantPnpm(f, null);
      const wt = f.worktree('foo');
      f.commit(wt, 'package.json', '{"scripts":{"pins":"node src/scripts/pins.ts"}}\n', 'chore: a pins script');
      if (ran) {
        writeFileSync(join(f.repo, '.git/info/exclude'), 'out/\n');
        mkdirSync(join(wt, 'out'), { recursive: true });
        writeFileSync(join(wt, PINS_LEDGER), '{}\n');
      }
      const result = f.land(wt);
      expect(result.status, result.stdout).toBe(0);
      expect(calls()[0], String(ran)).toBe(ran ? undefined : '--silent pins');
      expect(result.stdout.includes('never ran pnpm pins'), String(ran)).toBe(!ran);
    }
  }, 90_000);

  test('a red push gate stops land with its cause; main is unchanged', () => {
    const f = fixture();
    const wt = f.worktree('foo');
    f.commit(wt, 'src/feature.ts', 'export const feature = true;', 'feat: add feature');
    const before = f.remoteMain();
    writeFileSync(f.files.fail, '');
    const result = f.land(wt);
    expect(result.status).toBe(1);
    expect(result.stdout).toMatch(/land STOP main push of [0-9a-f]{10} refused: pre-push: planted red check\nFix forward and run land again\./u);
    expect(f.remoteMain()).toBe(before);
    expect(f.read(f.files.gh)).toBe('');
    // DS22: the receipt names the pre-push's own cause, not a bare "pre-push red".
    expect(f.read(f.files.receipts)).toMatch(/STOP main push of [0-9a-f]{10} refused: pre-push: planted red check$/mu);
  }, 60_000);

  test('LS1: gen:inputs rewrites the ignored bytes stamp after the rebase; land commits nothing for it and lands', () => {
    const f = fixture();
    const wt = f.worktree('foo');
    f.commit(wt, 'src/scripts/gen.mjs', GEN_STAMPS, 'build: a stamp generator');
    writeFileSync(join(f.repo, '.git/info/exclude'), `/${STAMP}\n`);
    const gen = () => execFileSync(process.execPath, ['src/scripts/gen.mjs', '--inputs-only'], { cwd: wt, env: f.env });
    gen();
    f.commit(wt, 'src/feature.ts', 'export const feature = true;\n', 'feat: add feature');
    gen();
    expect(f.git(wt, ['status', '--porcelain'])).toBe('');
    // Main moves before land starts: the stamp gen:inputs writes after the rebase counts main's new file too.
    execFileSync('sh', [f.peerScript('src/other.ts', null, 'export const other = 2;')], { env: f.env });
    const result = f.land(wt);
    expect(result.status, result.stdout).toBe(0);
    expect(f.git(f.remote, ['log', '--format=%s', '-1', 'main'])).toBe('feat: add feature');
    expect(f.git(f.remote, ['ls-tree', '--name-only', '-r', 'main'])).not.toContain(STAMP);
    const stamp = f.read(join(wt, STAMP));
    expect(stamp).toContain('feature.ts:');
    expect(stamp).toContain('other.ts:');
    expect(f.git(wt, ['status', '--porcelain'])).toBe('');
    // One main push: no refusal on the way.
    expect(prepushLines(f)).toHaveLength(1);
    expect(f.read(f.files.receipts)).not.toMatch(/stamps committed/u);
    expect(BOOT_STAMPS).toContain(STAMP);
  }, 60_000);

  test('LS1: a tracked stamp gen:inputs dirties stops land before the gate instead of being committed', () => {
    const f = fixture();
    const wt = f.worktree('foo');
    f.commit(wt, 'src/scripts/gen.mjs', GEN_STAMPS, 'build: a stamp generator');
    f.commit(wt, STAMP, 'export const bytes = [];\n', 'chore: a tracked stamp');
    f.commit(wt, 'src/feature.ts', 'export const feature = true;\n', 'feat: add feature');
    const result = f.land(wt);
    expect(result.status, result.stdout).toBe(1);
    expect(result.stdout).toContain(`M ${STAMP}: uncommitted change`);
    expect(f.read(f.files.prepush)).toBe('');
  }, 60_000);

  test('DS22: an untracked file outside the pin set stops land before the gate, naming each path and its fix', () => {
    const f = fixture();
    const wt = f.worktree('foo');
    f.commit(wt, 'src/feature.ts', 'export const feature = true;', 'feat: add feature');
    writeFileSync(join(wt, 'stray.txt'), 'mine');
    writeFileSync(join(wt, 'src/a.ts'), 'export const a = 2;\n');
    const began = Date.now();
    const result = f.land(wt);
    expect(result.status, result.stdout).toBe(1);
    expect(Date.now() - began).toBeLessThan(15_000);
    expect(result.stdout).toMatch(/land STOP .*not clean/u);
    expect(result.stdout).toMatch(/\?\? stray\.txt: untracked: commit it/u);
    expect(result.stdout).toMatch(/ M src\/a\.ts: uncommitted change: commit it/u);
    // The gate never ran and nothing left this machine.
    expect(f.read(f.files.prepush)).toBe('');
    expect(f.read(f.files.gh)).toBe('');
    expect(f.read(f.files.receipts)).toMatch(/STOP tree not clean before the gate: src\/a\.ts, stray\.txt$/mu);
    expect(readFileSync(join(wt, 'stray.txt'), 'utf8')).toBe('mine');
  }, 60_000);

  test('DS22: the pre-push cause, read from its output', () => {
    // Git may forward a hook's stdout separately from its own stderr.
    expect(prePushCause("error: failed to push some refs to 'x'\n", 'pre-push: planted red check\n'))
      .toBe('pre-push: planted red check');
    expect(prePushCause('  - lint RED in 3.0 s\nerror: failed to push some refs to \'x\'\n')).toBe('lint RED in 3.0 s');
    expect(prePushCause('file:///x/run-checks.mjs:63\nError: Push target requires a clean checked tree; enqueue a committed immutable checkout\n    at capturePushTree (x)\nerror: failed to push some refs to \'x\'\n'))
      .toBe('Push target requires a clean checked tree; enqueue a committed immutable checkout');
    expect(prePushCause('To /remote.git\n!\trefs/heads/plan/x:refs/heads/plan/x\t[remote rejected] (hook declined)\nDone\nerror: failed to push some refs to \'x\'\n'))
      .toBe('!\trefs/heads/plan/x:refs/heads/plan/x\t[remote rejected] (hook declined)');
    // A passing check's logged Error never outranks the check that went RED.
    expect(prePushCause('  - tests green in 9 s\nError: expected in a passing test\n  - lint RED in 3.0 s\n')).toBe('lint RED in 3.0 s');
    expect(prePushCause('Error: Inherited CPU grant is unavailable or is not an actual ancestor grant\n', 'To /remote.git\n!\tHEAD:refs/heads/main\t[remote rejected] (failed to update ref)\nDone\n'))
      .toContain('[remote rejected] (failed to update ref)');
    expect(prePushCause('lint RED in 1 s\nTo /sample.git\n!\tHEAD:refs/heads/main\t[remote rejected] (sample)\nDone\n'))
      .toBe('lint RED in 1 s');
    expect(prePushCause('')).toBe('no output');
  });

  test('build-max C3: a RED check names what in it failed, and how many more', () => {
    const refused = "error: failed to push some refs to 'x'\n";
    expect(prePushCause(`  - vitest (split full: 28 local) RED in 195.7 s\nX known-red: 2 NEW red(s) not on origin/main 6a6ec56939\n  NEW red: test/headless-direct-worker.test.ts::direct native deferred-run\n  NEW red: test/headless-verb-tape-worker.test.ts::native verb tape\n${refused}`))
      .toBe('vitest (split full: 28 local) RED in 195.7 s; test/headless-direct-worker.test.ts::direct native deferred-run (+1 more)');
    expect(prePushCause(`  x eslint(no-use-before-define): 'CAP_REAP_IDLE_MS' was used before it was defined.\n     ,-[src/scripts/.kit/worktree.mjs:138:172]\n  - lint (kit + game) RED in 120.1 s\n${refused}`))
      .toBe("lint (kit + game) RED in 120.1 s; eslint(no-use-before-define): 'CAP_REAP_IDLE_MS' was used before it was defined. at src/scripts/.kit/worktree.mjs:138:172");
    expect(prePushCause(`test/land-hosted.test.ts(99,30): error TS2554: Expected 1-2 arguments, but got 3.\n  - typecheck (kit + layers) RED in 47.6 s\n${refused}`))
      .toBe('typecheck (kit + layers) RED in 47.6 s; test/land-hosted.test.ts(99,30): error TS2554: Expected 1-2 arguments, but got 3.');
    expect(prePushCause(` FAIL  |node| test/x.test.ts > a case\n  - vitest (split related: 3 local) RED in 9 s\n${refused}`))
      .toBe('vitest (split related: 3 local) RED in 9 s; |node| test/x.test.ts > a case');
    expect(failingDetail(['lint RED in 3.0 s'])).toBeUndefined();
  });

  test('refuses the canonical checkout and non-plan branches', () => {
    const f = fixture();
    const canonical = f.land(f.repo);
    expect(canonical.status).toBe(1);
    expect(canonical.stdout).toContain('plan/<slug> branch');
    f.git(f.repo, ['worktree', 'add', '--quiet', '-b', 'feature/x', join(f.repo, '.worktrees', 'x'), 'origin/main']);
    expect(f.land(join(f.repo, '.worktrees', 'x')).stdout).toContain('this checkout is on feature/x');
  }, 60_000);

  test('DS22: a gen:inputs that commits on its own stops land before the gate', () => {
    const f = fixture();
    const wt = f.worktree('foo');
    f.commit(wt, 'src/scripts/gen.mjs', "import {execSync} from 'node:child_process';import {writeFileSync} from 'node:fs';writeFileSync('src/sneak.ts','export {};\\n');execSync('git add src/sneak.ts && git commit -q -m sneak');", 'build: a generator');
    f.commit(wt, 'src/feature.ts', 'export const feature = true;', 'feat: add feature');
    const result = f.land(wt);
    expect(result.status, result.stdout).toBe(1);
    expect(result.stdout).toMatch(/land STOP src\/scripts\/gen\.mjs --inputs-only made a commit/u);
    expect(f.read(f.files.prepush)).toBe('');
    expect(f.git(f.remote, ['ls-tree', '--name-only', 'main', 'src/'])).not.toMatch(/sneak|feature/u);
  }, 60_000);

  test('GVS G9: a fixture resolves pnpm to its own fake, never the real one that would reinstall this checkout', () => {
    const f = fixture();
    const found = execFileSync('sh', ['-c', 'command -v pnpm'], { cwd: f.repo, env: f.env, encoding: 'utf8' }).trim();
    expect(found).toBe(join(f.root, 'bin/pnpm'));
  });

  // These two are about the rebase install alone. Main moves before land starts, so land's own rebase brings it in.
  const KEEP = ['--keep'];
  const peerLands = (f: Fixture, path: string, text: string) => execFileSync('sh', [f.peerScript(path, null, text)], { env: f.env });
  test('a rebase that brings in a lockfile change installs before the pushes; one that does not, does not', () => {
    const f = fixture();
    // A fake pnpm on the fixture's PATH logs each call, so the test sees exactly what land runs.
    const calls = join(f.root, 'pnpm-calls.log');
    writeFileSync(join(f.root, 'bin/pnpm'), `#!/bin/sh\necho "$*" >> '${calls}'\n`);
    chmodSync(join(f.root, 'bin/pnpm'), 0o755);
    const wt = f.worktree('foo');
    f.commit(wt, 'src/feature.ts', 'export const feature = true;', 'feat: add feature');
    peerLands(f, 'pnpm-lock.yaml', 'lockfile with wire');
    const result = f.land(wt, KEEP);
    expect(result.status, result.stdout).toBe(0);
    expect(result.stdout).toMatch(/install\s+pnpm-lock\.yaml changed in the rebase; pnpm install --frozen-lockfile/u);
    expect(f.read(calls).trim().split('\n')).toEqual(['install --frozen-lockfile --config.confirmModulesPurge=false']);
    const g = fixture();
    writeFileSync(join(g.root, 'bin/pnpm'), `#!/bin/sh\necho "$*" >> '${calls}.g'\n`);
    chmodSync(join(g.root, 'bin/pnpm'), 0o755);
    const plain = g.worktree('bar');
    g.commit(plain, 'src/feature.ts', 'export const feature = true;', 'feat: add feature');
    peerLands(g, 'src/other.ts', 'export const other = 2;');
    const quiet = g.land(plain, KEEP);
    expect(quiet.status, quiet.stdout).toBe(0);
    expect(quiet.stdout).not.toMatch(/frozen-lockfile/u);
    expect(existsSync(`${calls}.g`)).toBe(false);
  }, 90_000);

  test('GVS G9/G10: the rebase install survives a layout flip without a TTY, announces itself, and waits out a store prune', async () => {
    const f = fixture();
    const calls = join(f.root, 'pnpm-calls.log'), users = join(f.root, 'store-users');
    // The fake pnpm logs its arguments and whether land announced it in store-users/ while it ran.
    writeFileSync(join(f.root, 'bin/pnpm'), `#!/bin/sh\necho "$* users=$(ls '${users}' | wc -l | tr -d ' ')" >> '${calls}'\n`);
    chmodSync(join(f.root, 'bin/pnpm'), 0o755);
    const wt = f.worktree('foo');
    f.commit(wt, 'src/feature.ts', 'export const feature = true;', 'feat: add feature');
    peerLands(f, 'pnpm-lock.yaml', 'lockfile with wire');
    const result = f.land(wt, KEEP);
    expect(result.status, result.stdout).toBe(0);
    expect(f.read(calls).trim().split('\n')).toEqual(['install --frozen-lockfile --config.confirmModulesPurge=false users=1']);
    expect(readdirSync(users)).toEqual([]);
    // A prune holds the store: land stops before installing, and says why.
    const g = fixture();
    writeFileSync(join(g.root, 'bin/pnpm'), `#!/bin/sh\necho "$*" >> '${calls}.g'\n`);
    chmodSync(join(g.root, 'bin/pnpm'), 0o755);
    const prune = spawn('python3', ['-c', 'import fcntl,sys,time\nf=open(sys.argv[1],"a+")\nfcntl.flock(f,fcntl.LOCK_EX)\nprint("held",flush=True)\ntime.sleep(60)', join(g.root, 'store-maintenance.lock')]);
    await new Promise(held => prune.stdout.once('data', held));
    try {
      const plain = g.worktree('bar');
      g.commit(plain, 'src/feature.ts', 'export const feature = true;', 'feat: add feature');
      peerLands(g, 'pnpm-lock.yaml', 'lockfile with wire');
      const stopped = g.land(plain, KEEP);
      expect(stopped.status).not.toBe(0);
      expect(stopped.stdout + stopped.stderr).toMatch(/store prune is running/u);
      expect(existsSync(`${calls}.g`)).toBe(false);
      // J206 review: the rebase already moved HEAD, so the next land must still owe and run the install first.
      prune.kill();
      await new Promise(gone => prune.once('exit', gone));
      const again = g.land(plain, KEEP);
      expect(again.status, again.stdout + again.stderr).toBe(0);
      expect(g.read(`${calls}.g`).trim().split('\n')).toEqual(['install --frozen-lockfile --config.confirmModulesPurge=false']);
    } finally { prune.kill(); }
    // A node_modules that links elsewhere (say the canonical checkout's) is never purged through.
    const h = fixture();
    writeFileSync(join(h.root, 'bin/pnpm'), `#!/bin/sh\necho "$*" >> '${calls}.h'\n`);
    chmodSync(join(h.root, 'bin/pnpm'), 0o755);
    const linked = h.worktree('baz');
    h.commit(linked, 'src/feature.ts', 'export const feature = true;', 'feat: add feature');
    mkdirSync(join(h.root, 'canonical-modules'));
    // Ignored as engine's .gitignore does (no trailing slash, so the link matches too): DS22's preflight passes it.
    writeFileSync(join(h.repo, '.git/info/exclude'), 'node_modules\n');
    symlinkSync(join(h.root, 'canonical-modules'), join(linked, 'node_modules'));
    peerLands(h, 'pnpm-lock.yaml', 'lockfile with wire');
    const refused = h.land(linked, KEEP);
    expect(refused.status).not.toBe(0);
    expect(refused.stdout + refused.stderr).toMatch(/node_modules is a symlink/u);
    expect(existsSync(`${calls}.h`)).toBe(false);
  }, 180_000);

  test('two worktrees land at once with no shared lock; both reach main', async () => {
    const f = fixture();
    const foo = f.worktree('foo'), bar = f.worktree('bar');
    f.commit(foo, 'src/foo.ts', 'export const foo = 1;', 'feat: foo');
    f.commit(bar, 'src/bar.ts', 'export const bar = 1;', 'feat: bar');
    const [one, two] = await Promise.all([f.landAsync(foo), f.landAsync(bar)]);
    expect(one.code, one.stdout).toBe(0);
    expect(two.code, two.stdout).toBe(0);
    const subjects = f.git(f.remote, ['log', '--format=%s', 'main']).split('\n');
    expect(subjects).toEqual(expect.arrayContaining(['feat: foo', 'feat: bar', 'seed']));
    expect(subjects).toHaveLength(3);
  }, 60_000);

  // Run 43332891983 on 2d33c963: two lands share refs/remotes/origin/main, and the one that fetched second lost the
  // ref's lock ("is at X but expected Y") and stopped. A git shim fails land's main fetch on demand.
  const fetchShim = (f: Fixture, mode: 'lock-once' | 'lock-always' | 'other') => {
    const real = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
    const log = join(f.root, 'fetch.log'), marker = join(f.root, 'fetch-fail');
    writeFileSync(marker, mode);
    writeFileSync(join(f.root, 'bin/git'), `#!/bin/sh
case "$*" in *"refs/heads/main:refs/remotes/origin/main"*)
  echo "$*" >> '${log}'
  case "$(cat '${marker}' 2>/dev/null)" in
    lock-once) rm -f '${marker}'; echo "error: cannot lock ref 'refs/remotes/origin/main': is at 67cc4b21 but expected 04ef18ba" >&2; echo " ! 04ef18ba..67cc4b21  main -> origin/main  (unable to update local ref)" >&2; exit 1 ;;
    lock-always) echo "error: Unable to create '/x/.git/refs/remotes/origin/main.lock': File exists." >&2; exit 1 ;;
    other) echo "fatal: unable to access 'https://github.com/project-wildshard/fixture/': Could not resolve host: github.com" >&2; exit 128 ;;
  esac ;;
esac
exec '${real}' "$@"
`);
    chmodSync(join(f.root, 'bin/git'), 0o755);
    return () => f.read(log).trim().split('\n').filter(Boolean);
  };

  test('a fetch that loses origin/main\'s ref lock to another land is retried, and land carries on', () => {
    const f = fixture();
    const wt = f.worktree('foo');
    const head = f.commit(wt, 'src/foo.ts', 'export const foo = 1;', 'feat: foo');
    const fetches = fetchShim(f, 'lock-once');
    const result = f.land(wt);
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.stdout).toMatch(/retry\s+git fetch .*cannot lock ref/u);
    expect(fetches().length).toBeGreaterThanOrEqual(2);
    expect(f.remoteMain()).toBe(head);
  }, 60_000);

  test('a fetch that fails for any other reason still stops land at once, with no retry', () => {
    const f = fixture();
    const wt = f.worktree('foo');
    f.commit(wt, 'src/foo.ts', 'export const foo = 1;', 'feat: foo');
    const before = f.remoteMain();
    const fetches = fetchShim(f, 'other');
    const result = f.land(wt);
    expect(result.status).not.toBe(0);
    expect(result.stdout + result.stderr).toMatch(/git fetch origin main failed: fatal: unable to access/u);
    expect(result.stdout).not.toMatch(/retry/u);
    expect(fetches()).toHaveLength(1);
    expect(f.remoteMain()).toBe(before);
  }, 60_000);

  test('a ref lock that never clears stops after 4 retries, naming git\'s error', () => {
    const f = fixture();
    const wt = f.worktree('foo');
    f.commit(wt, 'src/foo.ts', 'export const foo = 1;', 'feat: foo');
    const before = f.remoteMain();
    const fetches = fetchShim(f, 'lock-always');
    const result = f.land(wt);
    expect(result.status).not.toBe(0);
    expect(result.stdout + result.stderr).toMatch(/git fetch origin main failed: error: Unable to create .*main\.lock': File exists/u);
    expect(result.stdout.match(/ retry /gu)).toHaveLength(4);
    expect(fetches()).toHaveLength(5);
    expect(f.remoteMain()).toBe(before);
  }, 60_000);

  test('REF_LOCK matches git\'s lock refusals and nothing else', () => {
    for (const lock of [
      "error: cannot lock ref 'refs/remotes/origin/main': is at 67cc4b21 but expected 04ef18ba",
      "error: cannot lock ref 'refs/remotes/origin/main': Unable to create '/r/.git/refs/remotes/origin/main.lock': File exists.",
      "fatal: Unable to create '/r/.git/packed-refs.lock': File exists.",
    ]) expect(REF_LOCK.test(lock), lock).toBe(true);
    for (const other of [
      "fatal: unable to access 'https://github.com/o/r/': Could not resolve host: github.com",
      "fatal: couldn't find remote ref refs/heads/plan/foo",
      'fatal: Authentication failed for \'https://github.com/o/r/\'',
    ]) expect(REF_LOCK.test(other), other).toBe(false);
  });
});
