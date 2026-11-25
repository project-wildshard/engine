// J240 / DEV-SPEED DS21: scripts/land.mjs against real git. A bare repo stands
// in for GitHub (with protect-main's no-force, no-delete rule as an update
// hook) and a post-receive hook records every pushed tip. J422 push mode:
// rebase, the push gate, push main; main-watch, the canonical checkout and
// the worktree's cleanup after (meta FLOW-SIMPLE FS5 moved these off the
// deleted hosted land).
// oxlint-disable-next-line import/no-nodejs-modules -- Real git repositories, hooks and the land CLI.
import { execFileSync, spawn, spawnSync } from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- Fixture repositories stay in the repository scratch root.
import { closeSync, existsSync, ftruncateSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Fixture paths.
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { mainPushArgs, parseArgs } from '../scripts/land.mjs';
import { cleanLandFixtures, fixture, prepushLines, type Fixture } from './fixtures/land-git';

afterEach(cleanLandFixtures);

/** Run a command from inside the main push's pre-push: what a lane or its tools do while the gate runs. */
const duringGate = (f: Fixture, script: string) => { writeFileSync(f.files.raceScript, script); writeFileSync(f.files.race, ''); };

describe('land (J422): main-watch, the canonical checkout and cleanup after the main push', () => {
  test('after landing, land starts main-watch to follow the SHA from the canonical checkout (LS5)', async () => {
    const f = fixture();
    const wt = f.worktree('foo');
    const marker = join(f.root, 'watch-args.json');
    f.commit(wt, 'scripts/main-watch.mjs', `import {writeFileSync} from 'node:fs';writeFileSync(${JSON.stringify(marker)},JSON.stringify({argv:process.argv.slice(2),cwd:process.cwd()}));`, 'build: a watcher');
    const tip = f.commit(wt, 'src/feature.ts', 'export const feature = true;', 'feat: add feature');
    const result = f.land(wt);
    expect(result.status, result.stdout).toBe(0);
    expect(result.stdout).toContain(`main-watch follows ${tip.slice(0, 10)}`);
    for (let tries = 0; tries < 100 && !existsSync(marker); tries++) await new Promise(done => setTimeout(done, 50));
    const seen = JSON.parse(readFileSync(marker, 'utf8')) as { argv: string[]; cwd: string };
    expect(seen.argv).toEqual([`--follow=${tip}`, '--lane=fixture-lane', '--pane=w0:p9']);
    expect(realpathSync(seen.cwd)).toBe(realpathSync(f.repo));
  }, 60_000);

  test('LS5: --done returns at the main push, then removes its worktree and local branch; no plan branch is ever pushed', () => {
    const f = fixture();
    const wt = f.worktree('foo');
    f.commit(wt, 'src/feature.ts', 'export const feature = true;', 'feat: add feature');
    const result = f.land(wt, ['--done']);
    expect(result.status, result.stdout).toBe(0);
    expect(f.read(f.files.receipts)).toMatch(/landed .*; push; .*main ci followed by main-watch/u);
    expect(result.stdout).toMatch(/cleaned\s+worktree and plan\/foo removed/u);
    expect(existsSync(wt)).toBe(false);
    expect(spawnSync('git', ['rev-parse', '--verify', '--quiet', 'refs/heads/plan/foo'], { cwd: f.repo, env: f.env }).status).not.toBe(0);
    expect(spawnSync('git', ['rev-parse', '--verify', '--quiet', 'refs/heads/plan/foo'], { cwd: f.remote, env: f.env }).status).not.toBe(0);
  }, 60_000);

  test('J521: --done logs its local delete, and deletes origin\'s landed copy under a lease, logged', () => {
    const f = fixture();
    const wt = f.worktree('foo');
    const tip = f.commit(wt, 'src/feature.ts', 'export const feature = true;', 'feat: add feature');
    f.git(wt, ['push', '--quiet', 'origin', 'plan/foo']);
    const result = f.land(wt, ['--done']);
    expect(result.status, result.stdout).toBe(0);
    expect(result.stdout).toMatch(/origin plan\/foo deleted/u);
    expect(spawnSync('git', ['rev-parse', '--verify', '--quiet', 'refs/heads/plan/foo'], { cwd: f.remote, env: f.env }).status).not.toBe(0);
    const lines = f.read(join(f.root, 'deleted-branches.log')).trim().split('\n');
    expect(lines).toEqual([
      expect.stringMatching(new RegExp(`^\\d{4}-\\d\\d-\\d\\dT\\d\\d:\\d\\d:\\d\\dZ engine local plan/foo ${tip.slice(0, 12)}$`, 'u')),
      expect.stringMatching(new RegExp(` engine remote plan/foo ${tip.slice(0, 12)}$`, 'u')),
    ]);
  }, 60_000);

  test('J521: origin\'s copy with a commit main lacks is kept and not logged; push mode deletes nothing', () => {
    const f = fixture();
    const wt = f.worktree('foo');
    f.commit(wt, 'src/feature.ts', 'export const feature = true;', 'feat: add feature');
    const other = f.worktree('other');
    const extra = f.commit(other, 'src/other.ts', 'export const other = true;', 'feat: other');
    f.git(other, ['push', '--quiet', 'origin', `${extra}:refs/heads/plan/foo`]);
    const result = f.land(wt, ['--done']);
    expect(result.status, result.stdout).toBe(0);
    expect(result.stdout).toMatch(/origin plan\/foo kept: [0-9a-f]{10} has commits not on main/u);
    expect(f.git(f.remote, ['rev-parse', 'refs/heads/plan/foo'])).toBe(extra);
    expect(f.read(join(f.root, 'deleted-branches.log'))).not.toContain('remote');
    const g = fixture();
    const kept = g.worktree('bar');
    g.commit(kept, 'src/feature.ts', 'export const feature = true;', 'feat: add feature');
    expect(g.land(kept, []).status).toBe(0);
    expect(existsSync(join(g.root, 'deleted-branches.log'))).toBe(false);
  }, 60_000);

  test('LS5: a worktree with untracked work is kept after --done; without --done push mode keeps everything', () => {
    const f = fixture();
    const wt = f.worktree('foo');
    f.commit(wt, 'src/feature.ts', 'export const feature = true;', 'feat: add feature');
    // Written while the gate runs: an untracked file before the gate stops land up front (DS22).
    duringGate(f, `printf mine > '${join(wt, 'notes.txt')}'\n`);
    const result = f.land(wt, ['--done']);
    expect(result.status, result.stdout).toBe(0);
    expect(result.stdout).toMatch(/cleaned\s+worktree kept: 1 uncommitted or untracked path/u);
    expect(existsSync(join(wt, 'notes.txt'))).toBe(true);
    const g = fixture();
    const kept = g.worktree('bar');
    g.commit(kept, 'src/feature.ts', 'export const feature = true;', 'feat: add feature');
    expect(g.land(kept, []).stdout).not.toContain('cleaned');
    expect(existsSync(kept)).toBe(true);
  }, 60_000);

  test('parseArgs: push on every machine (J443, FS23), keeping the worktree; --local and --hosted are gone', () => {
    expect(parseArgs([], {}, 'Jakes-Mac-Mini.local').mode).toBe('push');
    expect(() => parseArgs([], { WS_LAND_MODE: 'local' }, 'Jakes-Mac-Mini.local')).toThrow(/--local is gone/u);
    expect(parseArgs([], {}, 'macbook')).toEqual({ mode: 'push', rounds: 5, keep: true, done: false });
    expect(parseArgs(['--done'], {}, 'macbook')).toMatchObject({ mode: 'push', keep: false, done: true });
    expect(parseArgs([], { WS_LAND_MODE: 'hosted' }, 'macbook').mode).toBe('push');
    expect(() => parseArgs(['--local'], {}, 'macbook')).toThrow(/--local is gone/u);
    expect(parseArgs(['--push'], {}, 'macbook')).toMatchObject({ mode: 'push', keep: true });
    // Old callers' no-op flags still parse; the deleted hosted options do not.
    expect(parseArgs(['--no-preflight', '--no-watch-main'], {}, 'macbook')).toMatchObject({ mode: 'push' });
    expect(() => parseArgs(['--hosted'], {}, 'macbook')).toThrow(/--hosted is gone/u);
    expect(() => parseArgs(['--poll=1'], {}, 'macbook')).toThrow(/unknown option --poll=1/u);
  });

  test('J358: a failed copy keeps the landed worktree and local branch', () => {
    const f = fixture(), wt = f.worktree('copy-failure');
    const tip = f.commit(wt, 'src/feature.ts', 'export const feature = true;', 'feature');
    writeFileSync(join(f.root, 'session-keep'), 'not a directory');
    const result = f.land(wt, ['--done']);
    expect(result.status, result.stdout).toBe(0);
    expect(result.stdout).toContain('worktree kept: copy failed');
    expect(existsSync(wt)).toBe(true);
    expect(f.git(f.repo, ['rev-parse', 'plan/copy-failure'])).toBe(tip);
  }, 60_000);

  test('QA 11-25 row 34: over 50 MiB, land saves the script in a partial copy, names it and keeps the worktree', () => {
    const f = fixture(), wt = f.worktree('over-cap');
    f.commit(wt, '.gitignore', '/tmp/\n', 'ignore scratch');
    const tip = f.commit(wt, 'src/feature.ts', 'export const feature = true;', 'feature');
    mkdirSync(join(wt, 'tmp/lane'), { recursive: true });
    writeFileSync(join(wt, 'tmp/lane/update.mjs'), 'export const update = 7;\n');
    const fd = openSync(join(wt, 'tmp/lane/profile.cpuprofile'), 'w'); ftruncateSync(fd, 51 * 1024 ** 2); closeSync(fd);
    const result = f.land(wt, ['--done']);
    expect(result.status, result.stdout).toBe(0);
    const dir = /worktree kept: over 50 MiB; partial copy \(unpushed commits, patches, source and scripts\) at (\S+), the rest listed in its SKIPPED\.txt/u.exec(result.stdout)?.[1];
    expect(dir, result.stdout).toBeDefined();
    expect(readFileSync(join(dir!, 'SKIPPED.txt'), 'utf8')).toContain('tmp/lane/profile.cpuprofile');
    const files = join(f.root, 'restored'); mkdirSync(files);
    expect(spawnSync('tar', ['-xzf', join(dir!, 'untracked.tgz'), '-C', files]).status).toBe(0);
    expect(readFileSync(join(files, 'tmp/lane/update.mjs'), 'utf8')).toBe('export const update = 7;\n');
    expect(existsSync(join(wt, 'tmp/lane/update.mjs'))).toBe(true);
    expect(f.git(f.repo, ['rev-parse', 'plan/over-cap'])).toBe(tip);
  }, 60_000);

  test('J358: generated changes are copied as a recoverable patch before removal', () => {
    const f = fixture(), wt = f.worktree('generated');
    f.commit(wt, 'src/bytes.generated.ts', 'export const bytes = 1;\n', 'generated');
    duringGate(f, `printf 'export const bytes = 2;\\n' > '${join(wt, 'src/bytes.generated.ts')}'\n`);
    const result = f.land(wt, ['--done']);
    expect(result.status, result.stdout).toBe(0);
    expect(existsSync(wt)).toBe(false);
    const day = join(f.root, 'session-keep', readdirSync(join(f.root, 'session-keep'))[0]!);
    const copy = join(day, readdirSync(day)[0]!);
    expect(readFileSync(join(copy, 'tracked.patch'), 'utf8')).toContain('+export const bytes = 2;');
  }, 60_000);

  test('J358: a shutdown write after copying keeps the worktree', async () => {
    const f = fixture(), wt = f.worktree('shutdown');
    f.commit(wt, 'src/bytes.generated.ts', 'export const bytes = 1;\n', 'generated');
    const marker = join(f.root, 'ready');
    const child = spawn(process.execPath, ['-e', `const fs=require('fs');process.on('SIGTERM',()=>{fs.writeFileSync('src/bytes.generated.ts','export const bytes = 3;\\n');process.exit(0)});fs.writeFileSync(${JSON.stringify(marker)},'ready');setInterval(()=>{},1000)`], { cwd: wt, stdio: 'ignore' });
    try {
      for (let tries = 0; tries < 100 && !existsSync(marker); tries++) await new Promise(done => setTimeout(done, 20));
      expect(existsSync(marker)).toBe(true);
      const result = f.land(wt, ['--done']);
      expect(result.status, result.stdout).toBe(0);
      expect(result.stdout).toContain('worktree kept: changed during process cleanup');
      expect(readFileSync(join(wt, 'src/bytes.generated.ts'), 'utf8')).toContain('bytes = 3');
    } finally { if (child.exitCode === null) child.kill('SIGKILL'); }
  }, 60_000);

  test('after the main push, the canonical checkout fast-forwards to it (Jake: land into the main checkout)', () => {
    const f = fixture();
    const wt = f.worktree('foo');
    const tip = f.commit(wt, 'src/feature.ts', 'export const feature = true;', 'feat: add feature');
    const result = f.land(wt);
    expect(result.status, result.stdout).toBe(0);
    expect(result.stdout).toMatch(/canonical +canonical main fast-forwarded 1 commit\(s\)/u);
    expect(f.git(f.repo, ['rev-parse', 'HEAD'])).toBe(tip);
    expect(f.git(f.repo, ['rev-parse', 'HEAD'])).toBe(f.remoteMain());
  }, 60_000);

  test('a dirty or diverged canonical checkout is never moved: land warns and leaves a receipt', () => {
    for (const kind of ['dirty', 'diverged'] as const) {
      const f = fixture();
      const wt = f.worktree('foo');
      f.commit(wt, 'src/feature.ts', 'export const feature = true;', 'feat: add feature');
      if (kind === 'dirty') writeFileSync(join(f.repo, 'src/a.ts'), 'export const a = 2;\n');
      else f.commit(f.repo, 'src/local.ts', 'export const local = 1;', 'chore: a local commit');
      const before = f.git(f.repo, ['rev-parse', 'HEAD']);
      const result = f.land(wt);
      expect(result.status, `${kind}\n${result.stdout}`).toBe(0);
      expect(result.stdout, kind).toMatch(kind === 'dirty' ? /canonical +WARNING canonical main 1 behind; tracked edits \(src\/a\.ts\); their owner commits or discards them; left alone/u : /canonical +WARNING CANONICAL MAIN DIVERGED: 1 ahead, 1 behind/u);
      expect(f.git(f.repo, ['rev-parse', 'HEAD']), kind).toBe(before);
      if (kind === 'dirty') expect(readFileSync(join(f.repo, 'src/a.ts'), 'utf8')).toBe('export const a = 2;\n');
      expect(f.read(f.files.receipts), kind).toMatch(/land plan\/foo canonical checkout not fast-forwarded after landing: /u);
      expect(f.read(f.files.receipts), kind).toMatch(/land plan\/foo landed /u);
    }
  }, 120_000);
});

describe('land (J422): rebasing onto a moved main', () => {
  test('main moved over the same file: a clean rebase pushes the rebased SHA through the push gate', () => {
    const f = fixture();
    const wt = f.worktree('foo');
    const tested = f.edit(wt, 'src/shared.ts', 'line10 = 10', 'line10 = 100', 'feat: tune line 10');
    execFileSync('sh', [f.peerScript('src/shared.ts', 'line1 = 1;', 'line1 = 11;')], { env: f.env });
    const result = f.land(wt);
    expect(result.status, result.stdout).toBe(0);
    const landed = f.remoteMain();
    expect(landed).not.toBe(tested);
    expect(result.stdout).toMatch(/rebased\s+[0-9a-f]{10} -> [0-9a-f]{10} onto main/u);
    expect(f.git(f.remote, ['show', 'main:src/shared.ts'])).toMatch(/line1 = 11;[\s\S]*line10 = 100;/u);
    expect(prepushLines(f)).toEqual([expect.stringMatching(new RegExp(`^land=push:${landed} ${landed} ${landed} refs/heads/main [a-f0-9]{40}$`, 'u'))]);
    expect(result.stdout).toMatch(/rule +main's own CI runs the full suite on [0-9a-f]{10} now\. If main-watch names this push on red, fix it forward/u);
    expect(f.read(f.files.receipts)).toMatch(/landed .*; push; rounds 1;/u);
  }, 60_000);

  test('LS1 (J250): a rebase across two main commits that each move the live revisions lands with no stamp conflict', () => {
    const f = fixture();
    // The real revision helpers over a real tree: a render file and the package's dependency specs are inputs of both.
    mkdirSync(join(f.repo, 'src/client/engine/render'), { recursive: true });
    writeFileSync(join(f.repo, 'pnpm-lock.yaml'), "lockfileVersion: '9.0'\n");
    writeFileSync(join(f.repo, 'package.json'), '{"name":"fixture","private":true,"dependencies":{"three":"1"}}\n');
    writeFileSync(join(f.repo, 'src/client/engine/render/look.ts'), 'export const look = 1;\n');
    f.git(f.repo, ['add', 'pnpm-lock.yaml', 'package.json', 'src/client']);
    f.git(f.repo, ['commit', '--quiet', '-m', 'chore: inputs']);
    f.git(f.repo, ['push', '--quiet', 'origin', 'main']);
    const revision = (cwd: string) => execFileSync(process.execPath, ['--input-type=module', '-e',
      `import {rendererRevision} from '${resolve('scripts/renderer-revision.mjs')}';console.log(rendererRevision(process.cwd()));`], { cwd, env: f.env, encoding: 'utf8' }).trim();
    const before = revision(f.repo);
    const wt = f.worktree('foo');
    f.commit(wt, 'src/client/engine/render/feature.ts', 'export const feature = true;', 'feat: add a render input');
    // Main moves twice before land, each commit moving the renderer revision: before LS1 each regenerated a tracked stamp.
    const peer = join(f.root, 'peer-two.sh');
    writeFileSync(peer, `set -e\nunset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_PREFIX GIT_COMMON_DIR\ncd '${f.peer}'\ngit pull --quiet --ff-only origin main\n`
      + "printf 'export const look = 2;\\n' > src/client/engine/render/look.ts\ngit commit --quiet -m 'peer one' -- src/client/engine/render/look.ts\n"
      + "sed -i.bak 's/\"three\":\"1\"/\"three\":\"2\"/' package.json && rm package.json.bak\ngit commit --quiet -m 'peer two' -- package.json\ngit push --quiet origin HEAD:main\n");
    execFileSync('sh', [peer], { env: f.env });
    const result = f.land(wt);
    expect(result.status, result.stdout).toBe(0);
    expect(result.stdout).toMatch(/rebased\s+[0-9a-f]{10} -> [0-9a-f]{10} onto main/u);
    expect(result.stdout).not.toMatch(/stamp/u);
    expect(f.git(f.remote, ['log', '--format=%s', '-3', 'main']).split('\n')).toEqual(['feat: add a render input', 'peer two', 'peer one']);
    expect(f.git(f.remote, ['ls-tree', '-r', '--name-only', 'main'])).not.toMatch(/revision\.json/u);
    // The landed tree's revision is computed live from it, and both peer commits moved it.
    f.git(f.repo, ['pull', '--quiet', '--ff-only', 'origin', 'main']);
    expect(revision(f.repo)).not.toBe(before);
  }, 90_000);

  test('a rebase conflict stops with the conflicting paths and leaves the worktree as it was', () => {
    const f = fixture();
    const wt = f.worktree('foo');
    const tested = f.edit(wt, 'src/shared.ts', 'line5 = 5', 'line5 = 50', 'feat: plan line 5');
    execFileSync('sh', [f.peerScript('src/shared.ts', 'line5 = 5', 'line5 = 55')], { env: f.env });
    const result = f.land(wt);
    expect(result.status).toBe(1);
    expect(result.stdout).toMatch(/conflicts in: src\/shared\.ts/u);
    expect(f.git(wt, ['rev-parse', 'HEAD'])).toBe(tested);
    expect(f.git(wt, ['status', '--porcelain'])).toBe('');
    expect(f.git(f.remote, ['log', '--format=%s', '-1', 'main'])).toBe('peer lands');
    expect(f.read(f.files.receipts)).toMatch(/STOP rebase conflict .*src\/shared\.ts/u);
    expect(prepushLines(f)).toEqual([]);
  }, 60_000);

  test('a force push is refused: land refuses force flags, never forms one, and main rejects non-fast-forwards', () => {
    const f = fixture();
    const wt = f.worktree('foo');
    f.commit(wt, 'src/feature.ts', 'export const feature = true;', 'feat: add feature');
    const before = f.remoteMain(), pushed = f.read(f.files.pushed);
    for (const flag of ['--force', '-f', '--force-with-lease', '--force=1']) {
      const result = f.land(wt, [flag]);
      expect(result.status).toBe(1);
      expect(result.stdout).toContain(`refused ${flag}: land never force-pushes main`);
    }
    expect(f.read(f.files.pushed)).toBe(pushed);
    expect(mainPushArgs('a'.repeat(40))).toEqual(['push', '--porcelain', 'origin', `${'a'.repeat(40)}:refs/heads/main`]);
    expect(() => mainPushArgs('+HEAD')).toThrow(/exact SHA/u);
    // The remote's own protect-main rule backs it: a hand-forced main rewrite is refused.
    f.git(f.peer, ['commit', '--quiet', '--amend', '-m', 'rewritten seed']);
    expect(spawnSync('git', ['push', '--force', 'origin', 'HEAD:main'], { cwd: f.peer, env: f.env, encoding: 'utf8' }).status).not.toBe(0);
    expect(f.remoteMain()).toBe(before);
    expect(() => parseArgs(['--rounds=2', '--force'])).toThrow(/never force-pushes main/u);
  }, 60_000);
});
