// J240 / DEV-SPEED DS21: scripts/land.mjs against real git. A bare repo stands
// in for GitHub (with protect-main's no-force, no-delete rule as an update
// hook), a post-receive hook records every pushed tip, and a fake `gh` on PATH
// answers Actions queries only for SHAs that were really pushed.
// oxlint-disable-next-line import/no-nodejs-modules -- Real git repositories, hooks and the land CLI.
import { execFileSync, spawn, spawnSync } from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- Fixture repositories stay in the repository scratch root.
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Fixture paths.
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { CHECK_CSS, failureLine, PINS_LEDGER, preflightSteps, prePushCause, REF_LOCK, STAMPS } from '../scripts/land.mjs';
import { cleanLandFixtures, fixture, prepushLines, type Fixture } from './fixtures/land-git';

afterEach(cleanLandFixtures);

// DS22: a stand-in for gen:inputs. It writes the bytes stamp from the tree's own src/*.ts files, so a commit or a rebase
// that adds one makes the committed stamp stale, as a new public/assets file does for the real one.
const STAMP = 'src/client/game/boot/bytes.generated.ts';
const GEN_STAMPS = "import {mkdirSync,readdirSync,statSync,writeFileSync} from 'node:fs';"
  + "const rows=readdirSync('src').filter(name=>name.endsWith('.ts')).sort().map(name=>name+':'+statSync('src/'+name).size);"
  + "mkdirSync('src/client/game/boot',{recursive:true});writeFileSync('src/client/game/boot/bytes.generated.ts','export const bytes = '+JSON.stringify(rows)+';\\n');";

describe('land (J240): preflight, branch ownership and Git retries', () => {
  const plantPnpm = (f: Fixture, red: string | null) => {
    const log = join(f.root, 'pnpm.log');
    writeFileSync(join(f.root, 'bin/pnpm'), `#!/bin/sh\necho "$*" >> '${log}'\n${red === null ? '' : `[ "$1" = ${red} ] && { echo 'planted ${red} error'; exit 2; }\n`}exit 0\n`);
    return () => f.read(log).trim().split('\n').filter(Boolean);
  };

  test('preflight: lint:game, typecheck, then the Vitest files related to the changed code, before the plan push', () => {
    const f = fixture(), calls = plantPnpm(f, null);
    const wt = f.worktree('foo');
    f.commit(wt, 'src/feature.ts', 'export const feature = true;', 'feat: add feature');
    f.commit(wt, 'docs/feature.md', '# Feature\n', 'docs: feature');
    const result = f.land(wt);
    expect(result.status, result.stdout).toBe(0);
    expect(calls().filter(line => !line.startsWith('install'))).toEqual(['lint:game', 'typecheck', 'exec vitest related --run --passWithNoTests src/feature.ts']);
    expect(result.stdout.indexOf('preflight vitest green')).toBeLessThan(result.stdout.indexOf('pushing'));
  }, 60_000);

  test('preflight: a red check stops land before any push or CI wait, naming its log; --no-preflight skips it', () => {
    const f = fixture(), calls = plantPnpm(f, 'typecheck');
    const wt = f.worktree('foo');
    f.commit(wt, 'src/feature.ts', 'export const feature = true;', 'feat: add feature');
    const result = f.land(wt);
    expect(result.status).toBe(1);
    const log = /Log: (\S+)/u.exec(result.stdout)?.[1] ?? '';
    expect(result.stdout).toContain('land STOP preflight typecheck is red');
    expect(readFileSync(log, 'utf8')).toContain('planted typecheck error');
    expect(log.startsWith(wt), 'the log stays out of the tree').toBe(false);
    expect(calls()).toEqual(['lint:game', 'typecheck']);
    expect([f.read(f.files.prepush), f.read(f.files.gh)]).toEqual(['', '']);
    expect(f.read(f.files.receipts)).toContain(`STOP preflight typecheck red on ${f.git(wt, ['rev-parse', 'HEAD']).slice(0, 10)}, nothing pushed: ${log}`);
    const skipped = f.land(wt, ['--keep', '--no-preflight']);
    expect(skipped.status, skipped.stdout).toBe(0);
    expect(skipped.stdout).toContain('preflight skipped (--no-preflight)');
  }, 60_000);

  test('preflightSteps: CI\'s check-css always; Vitest only when code changed, on that code alone', () => {
    expect(preflightSteps(['docs/a.md', 'package.json'])).toEqual([['lint:game', ['pnpm', 'lint:game']], ['check-css', ['node', CHECK_CSS]], ['typecheck', ['pnpm', 'typecheck']]]);
    expect(preflightSteps(['docs/a.md', 'src/a.ts', 'test/a.test.ts', 'scripts/b.mjs']).at(-1)).toEqual(['vitest', ['pnpm', 'exec', 'vitest', 'related', '--run', '--passWithNoTests', 'src/a.ts', 'test/a.test.ts', 'scripts/b.mjs']]);
  });

  // opus-gcm11, 2026-11-15: check-css is red only on CI's static job (a 27-minute re-run); the preflight runs it here.
  test('preflight: the tree\'s own check-css runs after lint:game, and a red one stops land before any push', () => {
    const f = fixture(), calls = plantPnpm(f, null);
    const wt = f.worktree('foo');
    f.commit(wt, CHECK_CSS, "console.log('planted css violation'); process.exit(1);\n", 'chore: a check-css that fails');
    const result = f.land(wt);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('land STOP preflight check-css is red');
    expect(readFileSync(/Log: (\S+)/u.exec(result.stdout)?.[1] ?? '', 'utf8')).toMatch(/^\$ node scripts\/check-css\.mjs\nplanted css violation/u);
    expect(calls()).toEqual(['lint:game']);
    expect(f.read(f.files.prepush)).toBe('');
  }, 60_000);

  // 2026-11-16 (codex-netlag, opus-publish1): a worktree rebased past a pin bump holds the old revision under out/, and
  // gen:inputs refuses it; the stop showed only the stack's tail. Land runs pins first, and a stop names the thrown error.
  test('a worktree whose out/ holds a pin main no longer names runs pnpm pins before gen:inputs', () => {
    const f = fixture(), calls = plantPnpm(f, null);
    const wt = f.worktree('foo');
    f.commit(wt, 'package.json', '{"scripts":{"pins":"node scripts/pins.ts"}}\n', 'chore: a pins script');
    f.commit(wt, 'test/pins/shardfiles.json', `${JSON.stringify({ shards: [{ slug: 'dunes', revision: 2, hash: 'b'.repeat(64) }] })}\n`, 'test(pins): dunes rev 2');
    writeFileSync(join(f.repo, '.git/info/exclude'), 'out/\n');
    mkdirSync(join(wt, 'out/dunes'), { recursive: true });
    writeFileSync(join(wt, PINS_LEDGER), '{}\n');
    writeFileSync(join(wt, 'out/dunes/validation.json'), `${JSON.stringify({ pin: { hash: 'a'.repeat(64), revision: 1 } })}\n`);
    const result = f.land(wt);
    expect(result.status, result.stdout).toBe(0);
    expect(calls()[0]).toBe('--silent pins');
    expect(result.stdout).toContain('out/ holds pins main no longer names (dunes revision 1); running pnpm pins before gen:inputs');
  }, 60_000);

  test('a gen:inputs stop names the thrown error, not the stack\'s tail', () => {
    const f = fixture();
    const wt = f.worktree('foo');
    f.commit(wt, 'scripts/gen.mjs', "function inner(){throw new Error('planted: out/ holds pinned products the pins no longer name');}\ninner();\n", 'build: a failing generator');
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
      f.commit(wt, 'package.json', '{"scripts":{"pins":"node scripts/pins.ts"}}\n', 'chore: a pins script');
      if (ran) {
        writeFileSync(join(f.repo, '.git/info/exclude'), 'out/\n');
        mkdirSync(join(wt, 'out'), { recursive: true });
        writeFileSync(join(wt, PINS_LEDGER), '{}\n');
      }
      const result = f.land(wt);
      expect(result.status, result.stdout).toBe(0);
      expect(calls()[0], String(ran)).toBe(ran ? 'lint:game' : '--silent pins');
      expect(result.stdout.includes('never ran pnpm pins'), String(ran)).toBe(!ran);
    }
  }, 90_000);

  test('a red pre-push on the plan push stops before any CI wait', () => {
    const f = fixture();
    const wt = f.worktree('foo');
    f.commit(wt, 'src/feature.ts', 'export const feature = true;', 'feat: add feature');
    writeFileSync(f.files.fail, '');
    const result = f.land(wt);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('push of plan/foo');
    expect(f.read(f.files.gh)).toBe('');
    // DS22: the receipt names the pre-push's own cause, not a bare "pre-push red".
    expect(f.read(f.files.receipts)).toMatch(/STOP plan push [0-9a-f]{10} refused by the pre-push: pre-push: planted red check$/mu);
  }, 60_000);

  test('DS22: a dirty bytes.generated.ts is regenerated after the rebase, committed on the plan branch, and lands', () => {
    const f = fixture();
    const wt = f.worktree('foo');
    f.commit(wt, 'scripts/gen.mjs', GEN_STAMPS, 'build: a stamp generator');
    const gen = () => execFileSync(process.execPath, ['scripts/gen.mjs', '--inputs-only'], { cwd: wt, env: f.env });
    gen();
    f.git(wt, ['add', STAMP]);
    f.git(wt, ['commit', '--quiet', '-m', 'chore: stamps']);
    f.commit(wt, 'src/feature.ts', 'export const feature = true;\n', 'feat: add feature');
    gen();
    expect(f.git(wt, ['status', '--porcelain'])).toBe(`M ${STAMP}`);
    // Main moves before land starts, so the stamp land commits must count main's new file as well as the plan's.
    execFileSync('sh', [f.peerScript('src/other.ts', null, 'export const other = 2;')], { env: f.env });
    const result = f.land(wt);
    expect(result.status, result.stdout).toBe(0);
    expect(result.stdout).toMatch(/rebased .*\n.*stamps +committed src\/client\/game\/boot\/bytes\.generated\.ts/u);
    const [subject = '', ...rest] = f.git(f.remote, ['log', '--format=%B', '-1', 'main']).split('\n');
    expect(subject).toBe('chore(gen): regenerate boot stamps');
    // The real commit-msg rule passes it, so land's commit goes through engine's own hook.
    const verdict = execFileSync(process.execPath, ['--input-type=module', '-e',
      `import {validate} from ${JSON.stringify(resolve('.githooks/check-commit-message.mjs'))};process.stdout.write(String(validate(${JSON.stringify([subject, ...rest].join('\n'))})));`], { encoding: 'utf8' });
    expect(verdict).toBe('null');
    expect(f.git(f.remote, ['diff', '--name-only', 'main^', 'main'])).toBe(STAMP);
    const stamp = f.git(f.remote, ['show', `main:${STAMP}`]);
    expect(stamp).toContain('feature.ts:');
    expect(stamp).toContain('other.ts:');
    expect(f.git(wt, ['status', '--porcelain'])).toBe('');
    // One plan push and one main push: no refusal on the way.
    expect(prepushLines(f)).toHaveLength(2);
    expect(f.read(f.files.receipts)).toMatch(/plan\/foo stamps committed [0-9a-f]{10}: src\/client\/game\/boot\/bytes\.generated\.ts/u);
    expect(STAMPS).toContain(STAMP);
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
    expect(spawnSync('git', ['rev-parse', '--verify', '--quiet', 'refs/heads/plan/foo'], { cwd: f.remote, env: f.env }).status).not.toBe(0);
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

  test('refuses the canonical checkout and non-plan branches', () => {
    const f = fixture();
    const canonical = f.land(f.repo);
    expect(canonical.status).toBe(1);
    expect(canonical.stdout).toContain('plan/<slug> branch');
    f.git(f.repo, ['worktree', 'add', '--quiet', '-b', 'feature/x', join(f.repo, '.worktrees', 'x'), 'origin/main']);
    expect(f.land(join(f.repo, '.worktrees', 'x')).stdout).toContain('this checkout is on feature/x');
  }, 60_000);

  test('a commit made while hosted CI runs stops the landing; it never rides along unchecked', () => {
    const f = fixture();
    const wt = f.worktree('foo');
    f.commit(wt, 'src/feature.ts', 'export const feature = true;', 'feat: add feature');
    const before = f.remoteMain();
    f.state({ once: { marker: join(f.root, 'once'), command: ['git', '-C', wt, 'commit', '--quiet', '--allow-empty', '-m', 'sneaky'] } });
    const result = f.land(wt);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('HEAD moved while hosted CI ran');
    expect(f.remoteMain()).toBe(before);
  }, 60_000);

  // LAND-SIMPLIFY LS4 (J258): the local branch's reflog decides who may rewrite the plan branch, and the push
  // carries an explicit lease. No record of land's own is read or written.
  test('a plan branch someone else pushed is refused by git, fetched or not', () => {
    for (const fetched of [false, true]) {
      const f = fixture();
      const wt = f.worktree('foo');
      f.commit(wt, 'src/feature.ts', 'export const feature = true;', 'feat: add feature');
      f.git(f.peer, ['commit', '--quiet', '--allow-empty', '-m', 'someone else']);
      f.git(f.peer, ['push', '--quiet', 'origin', 'HEAD:refs/heads/plan/foo']);
      const theirs = f.git(f.remote, ['rev-parse', 'plan/foo']);
      if (fetched) f.git(wt, ['fetch', '--quiet', 'origin']);
      const result = f.land(wt);
      expect(result.status, `fetched=${fetched}: ${result.stdout}`).toBe(1);
      expect(result.stdout).toContain("which this worktree's branch never reached");
      expect(f.git(f.remote, ['rev-parse', 'plan/foo'])).toBe(theirs);
      expect(f.read(f.files.receipts)).toMatch(/STOP plan push [0-9a-f]{10} refused \(origin has commits this worktree never had\)/u);
    }
  }, 90_000);

  test('the worktree\'s own hand push, then a local rebase, rewrites cleanly and lands', () => {
    const f = fixture();
    const wt = f.worktree('foo');
    f.commit(wt, 'src/feature.ts', 'export const feature = 1;', 'feat: add feature');
    f.git(wt, ['push', '--quiet', 'origin', 'HEAD:refs/heads/plan/foo']);
    f.git(wt, ['commit', '--quiet', '--amend', '-m', 'feat: add feature, amended']);
    const result = f.land(wt);
    expect(result.status, result.stdout).toBe(0);
    expect(result.stdout).toMatch(/replaces its own [0-9a-f]{10} under a lease/u);
    expect(f.git(f.remote, ['log', '--format=%s', '-1', 'main'])).toBe('feat: add feature, amended');
    expect(existsSync(join(f.git(wt, ['rev-parse', '--path-format=absolute', '--git-dir']), 'wildshard-land-tip'))).toBe(false);
  }, 60_000);

  test('a hand push by URL leaves the tracking ref stale; land refreshes it and still lands its own rewrite', () => {
    const f = fixture();
    const wt = f.worktree('foo');
    f.commit(wt, 'src/feature.ts', 'export const feature = 1;', 'feat: add feature');
    f.git(wt, ['push', '--quiet', f.remote, 'HEAD:refs/heads/plan/foo']);
    // Some git versions update the tracking ref for a URL that matches origin's; drop it so the stale case is real.
    spawnSync('git', ['update-ref', '-d', 'refs/remotes/origin/plan/foo'], { cwd: wt, env: f.env });
    f.git(wt, ['commit', '--quiet', '--amend', '-m', 'feat: add feature, amended']);
    const result = f.land(wt);
    expect(result.status, result.stdout).toBe(0);
    expect(f.git(f.remote, ['log', '--format=%s', '-1', 'main'])).toBe('feat: add feature, amended');
  }, 60_000);

  test('a foreign push fetched from a sibling worktree (shared refs) is still refused', () => {
    const f = fixture();
    const wt = f.worktree('foo');
    const sibling = f.worktree('bar');
    f.commit(wt, 'src/feature.ts', 'export const feature = true;', 'feat: add feature');
    f.git(f.peer, ['commit', '--quiet', '--allow-empty', '-m', 'someone else']);
    f.git(f.peer, ['push', '--quiet', 'origin', 'HEAD:refs/heads/plan/foo']);
    const theirs = f.git(f.remote, ['rev-parse', 'plan/foo']);
    f.git(sibling, ['fetch', '--quiet', 'origin']);
    const result = f.land(wt);
    expect(result.status, result.stdout).toBe(1);
    expect(result.stdout).toContain("which this worktree's branch never reached");
    expect(f.git(f.remote, ['rev-parse', 'plan/foo'])).toBe(theirs);
  }, 60_000);

  test('land\'s own earlier push, then a rebase after a red, rewrites under the lease', () => {
    const f = fixture();
    const wt = f.worktree('foo');
    f.commit(wt, 'src/feature.ts', 'export const feature = 1;', 'feat: add feature');
    f.state({ red: { 'plan/foo': { ci: 'tests (1)' } } });
    expect(f.land(wt).status).toBe(1);
    f.state({});
    f.git(wt, ['commit', '--quiet', '--amend', '-m', 'feat: add feature, fixed']);
    const result = f.land(wt);
    expect(result.status, result.stdout).toBe(0);
    expect(f.git(f.remote, ['log', '--format=%s', '-1', 'main'])).toBe('feat: add feature, fixed');
  }, 60_000);

  test('the reflog rule: a foreign tip the local branch once held counts as seen, so land may replace it', () => {
    // As with --force-if-includes, a tip reachable from the local branch's reflog was seen: the agent reset onto their
    // commit, so discarding it is the agent's call. Recorded here so the rule is deliberate (LS4 swapped records for it).
    const f = fixture();
    const wt = f.worktree('foo');
    const base = f.git(wt, ['rev-parse', 'HEAD']);
    f.git(f.peer, ['commit', '--quiet', '--allow-empty', '-m', 'someone else']);
    f.git(f.peer, ['push', '--quiet', 'origin', 'HEAD:refs/heads/plan/foo']);
    const theirs = f.git(f.remote, ['rev-parse', 'plan/foo']);
    f.git(wt, ['fetch', '--quiet', 'origin']);
    f.git(wt, ['reset', '--quiet', '--hard', theirs]);
    f.git(wt, ['reset', '--quiet', '--hard', base]);
    f.commit(wt, 'src/feature.ts', 'export const feature = true;', 'feat: add feature');
    const result = f.land(wt);
    expect(result.status, result.stdout).toBe(0);
    expect(f.git(f.remote, ['rev-parse', 'plan/foo'])).not.toBe(theirs);
  }, 60_000);

  test('LS1: land runs no generator after the rebase, so a plan\'s gen.mjs can\'t slip a commit onto main', () => {
    const f = fixture();
    const wt = f.worktree('foo');
    // Before LS1 land ran this plan's gen.mjs after the rebase to regenerate the stamps; this one would commit a file. It
    // sneaks only once hosted CI has been asked (the marker), so DS22's up-front gen:inputs, before the gate, is clean.
    const marker = join(f.root, 'once');
    f.commit(wt, 'scripts/gen.mjs', `import {execSync} from 'node:child_process';import {existsSync,writeFileSync} from 'node:fs';if(existsSync(${JSON.stringify(marker)})){writeFileSync('src/sneak.ts','export {};\\n');execSync('git add src/sneak.ts && git commit -q -m sneak');}`, 'build: a generator');
    f.commit(wt, 'src/feature.ts', 'export const feature = true;', 'feat: add feature');
    f.state({ once: { marker: join(f.root, 'once'), command: ['sh', f.peerScript('src/other.ts', null, 'export const other = 2;')] } });
    const result = f.land(wt);
    expect(result.status, result.stdout).toBe(0);
    const main = f.git(f.remote, ['ls-tree', '--name-only', 'main', 'src/']).split('\n');
    expect(main).toEqual(expect.arrayContaining(['src/other.ts', 'src/feature.ts']));
    expect(main).not.toContain('src/sneak.ts');
  }, 60_000);

  test('DS22: a gen:inputs that commits on its own stops land before the gate; land commits only the stamps', () => {
    const f = fixture();
    const wt = f.worktree('foo');
    f.commit(wt, 'scripts/gen.mjs', "import {execSync} from 'node:child_process';import {writeFileSync} from 'node:fs';writeFileSync('src/sneak.ts','export {};\\n');execSync('git add src/sneak.ts && git commit -q -m sneak');", 'build: a generator');
    f.commit(wt, 'src/feature.ts', 'export const feature = true;', 'feat: add feature');
    const result = f.land(wt);
    expect(result.status, result.stdout).toBe(1);
    expect(result.stdout).toMatch(/land STOP scripts\/gen\.mjs --inputs-only made a commit/u);
    expect(f.read(f.files.prepush)).toBe('');
    expect(f.git(f.remote, ['ls-tree', '--name-only', 'main', 'src/'])).not.toMatch(/sneak|feature/u);
  }, 60_000);

  test('J206 review: a commit that slips in during the rebase never rides to main (verifyReplay)', () => {
    const f = fixture();
    const wt = f.worktree('foo');
    const tested = f.commit(wt, 'src/feature.ts', 'export const feature = true;', 'feat: add feature');
    // git runs post-rewrite after land's rebase: this one commits a file of its own on top of the rebased plan.
    writeFileSync(join(f.root, 'hooks/post-rewrite'), '#!/bin/sh\n[ "$1" = rebase ] || exit 0\nprintf "export {};\\n" > src/sneak.ts\ngit add src/sneak.ts\ngit commit -q -m sneak\n');
    chmodSync(join(f.root, 'hooks/post-rewrite'), 0o755);
    f.state({ once: { marker: join(f.root, 'once'), command: ['sh', f.peerScript('src/other.ts', null, 'export const other = 2;')] } });
    const result = f.land(wt);
    expect(result.status, result.stdout).toBe(1);
    expect(result.stdout).toMatch(/is not main [0-9a-f]{10} plus the hosted-green [0-9a-f]{10}: a commit or edit came in/u);
    expect(f.git(f.remote, ['ls-tree', '--name-only', 'main', 'src/'])).not.toMatch(/sneak|feature/u);
    expect(f.git(f.remote, ['rev-parse', 'plan/foo'])).toBe(tested);
    expect(f.read(f.files.receipts)).toMatch(/STOP rebased [0-9a-f]{10} is not main/u);
  }, 60_000);

  test('GVS G9: a fixture resolves pnpm to its own fake, never the real one that would reinstall this checkout', () => {
    const f = fixture();
    const found = execFileSync('sh', ['-c', 'command -v pnpm'], { cwd: f.repo, env: f.env, encoding: 'utf8' }).trim();
    expect(found).toBe(join(f.root, 'bin/pnpm'));
  });

  // These two are about the rebase install alone; the preflight's own pnpm calls are tested above.
  const NO_PREFLIGHT = ['--keep', '--no-preflight'];
  test('a rebase that brings in a lockfile change installs before the pushes; one that does not, does not', () => {
    const f = fixture();
    // A fake pnpm on the fixture's PATH logs each call, so the test sees exactly what land runs.
    const calls = join(f.root, 'pnpm-calls.log');
    writeFileSync(join(f.root, 'bin/pnpm'), `#!/bin/sh\necho "$*" >> '${calls}'\n`);
    chmodSync(join(f.root, 'bin/pnpm'), 0o755);
    const wt = f.worktree('foo');
    f.commit(wt, 'src/feature.ts', 'export const feature = true;', 'feat: add feature');
    f.state({ once: { marker: join(f.root, 'once'), command: ['sh', f.peerScript('pnpm-lock.yaml', null, 'lockfile with wire')] } });
    const result = f.land(wt, NO_PREFLIGHT);
    expect(result.status, result.stdout).toBe(0);
    expect(result.stdout).toMatch(/install\s+pnpm-lock\.yaml changed in the rebase; pnpm install --frozen-lockfile/u);
    expect(f.read(calls).trim().split('\n')).toEqual(['install --frozen-lockfile --config.confirmModulesPurge=false']);
    const g = fixture();
    writeFileSync(join(g.root, 'bin/pnpm'), `#!/bin/sh\necho "$*" >> '${calls}.g'\n`);
    chmodSync(join(g.root, 'bin/pnpm'), 0o755);
    const plain = g.worktree('bar');
    g.commit(plain, 'src/feature.ts', 'export const feature = true;', 'feat: add feature');
    g.state({ once: { marker: join(g.root, 'once'), command: ['sh', g.peerScript('src/other.ts', null, 'export const other = 2;')] } });
    const quiet = g.land(plain, NO_PREFLIGHT);
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
    f.state({ once: { marker: join(f.root, 'once'), command: ['sh', f.peerScript('pnpm-lock.yaml', null, 'lockfile with wire')] } });
    const result = f.land(wt, NO_PREFLIGHT);
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
      g.state({ once: { marker: join(g.root, 'once'), command: ['sh', g.peerScript('pnpm-lock.yaml', null, 'lockfile with wire')] } });
      const stopped = g.land(plain, NO_PREFLIGHT);
      expect(stopped.status).not.toBe(0);
      expect(stopped.stdout + stopped.stderr).toMatch(/store prune is running/u);
      expect(existsSync(`${calls}.g`)).toBe(false);
      // J206 review: the rebase already moved HEAD, so the next land must still owe and run the install first.
      prune.kill();
      await new Promise(gone => prune.once('exit', gone));
      const again = g.land(plain, NO_PREFLIGHT);
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
    h.state({ once: { marker: join(h.root, 'once'), command: ['sh', h.peerScript('pnpm-lock.yaml', null, 'lockfile with wire')] } });
    const refused = h.land(linked, NO_PREFLIGHT);
    expect(refused.status).not.toBe(0);
    expect(refused.stdout + refused.stderr).toMatch(/node_modules is a symlink/u);
    expect(existsSync(`${calls}.h`)).toBe(false);
  }, 180_000);

  test('a harness change carries too: J249 has no harness rule, main\'s own run checks it', () => {
    const f = fixture();
    const wt = f.worktree('foo');
    f.commit(wt, 'vitest.config.ts', 'export default {};', 'test: add a vitest config');
    f.state({ once: { marker: join(f.root, 'once'), command: ['sh', f.peerScript('src/other.ts', null, 'export const other = 2;')] } });
    const result = f.land(wt);
    expect(result.status, result.stdout).toBe(0);
    expect(result.stdout).toMatch(/carried\s+clean rebase onto/u);
    expect(f.read(f.files.receipts)).toMatch(/landed .*; carried; rounds 1;/u);
  }, 60_000);

  test('a plan that changes hosted CI carries after a clean rebase too (J249)', () => {
    const f = fixture();
    const wt = f.worktree('foo');
    f.commit(wt, '.github/workflows/x.yml', 'name: x', 'ci: add x');
    f.state({ once: { marker: join(f.root, 'once'), command: ['sh', f.peerScript('src/other.ts', null, 'export const other = 2;')] } });
    const result = f.land(wt);
    expect(result.status, result.stdout).toBe(0);
    expect(result.stdout).toMatch(/carried\s+clean rebase onto/u);
    expect(f.read(f.files.receipts)).toMatch(/landed .*; carried; rounds 1;/u);
  }, 60_000);

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
