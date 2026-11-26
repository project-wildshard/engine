// @vitest-environment node
// Meta QA 11-25 row 88: v0.1.95's staging cook move rolled back. The box's root-owned wildshard-apply and rebuild.sh
// predate the lean move: the apply unpacks `scripts/vps` from a signed commit and the rebuild ran
// `scripts/assert-store-layout.mjs`, and a lean tag has neither. These hold the bridge an old box hardens through, and
// hold every repo path a box script names to the tree it ships in.
import {execFileSync, spawnSync} from 'node:child_process';
import {copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {afterAll, expect, test} from 'vitest';

const made: string[] = [];
afterAll(() => { for (const dir of made) rmSync(dir, {recursive: true, force: true}); });
const tracked = execFileSync('git', ['ls-files', '-z'], {encoding: 'utf8'}).split('\0').filter(Boolean);

test('an old wildshard-apply hardens a lean tag through the bridge', () => {
  mkdirSync('tmp/vps-lean-bridge', {recursive: true});
  const top = mkdtempSync(resolve('tmp/vps-lean-bridge/run-')); made.push(top);
  const src = join(top, 'src-repo');
  mkdirSync(join(src, 'scripts/vps'), {recursive: true});
  mkdirSync(join(src, 'src/scripts/vps'), {recursive: true});
  copyFileSync('scripts/vps/harden.sh', join(src, 'scripts/vps/harden.sh'));
  writeFileSync(join(src, 'src/scripts/vps/harden.sh'), 'echo "lean harden from ${BASH_SOURCE[0]} with $*"\n');
  const git = (args: string[], cwd = src) => execFileSync('git', args, {cwd, encoding: 'utf8', env: {...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t'}}).trim();
  git(['init', '--quiet']); git(['add', '.']); git(['commit', '--quiet', '-m', 'lean']);
  const commit = git(['rev-parse', 'HEAD']);
  // What the pre-lean wildshard-apply does: a bare repo, the commit's folder beside it, scripts/vps unpacked, then bash.
  const work = join(top, 'wildshard-apply'), out = join(work, commit);
  git(['clone', '--quiet', '--bare', src, join(work, 'engine.git')], top);
  mkdirSync(out);
  execFileSync('/bin/sh', ['-c', 'git -C "$1" archive "$2" scripts/vps | tar -x -C "$3"', 'unpack', join(work, 'engine.git'), commit, out]);
  const run = spawnSync('bash', [join(out, 'scripts/vps/harden.sh'), '--x'], {cwd: out, encoding: 'utf8'});
  expect(run.stderr).toBe('');
  expect(run.status).toBe(0);
  expect(run.stdout).toContain(`lean harden from ${out}/src/scripts/vps/harden.sh with --x`);
  // Anywhere but a commit's folder it refuses.
  const elsewhere = spawnSync('bash', [join(out, 'scripts/vps/harden.sh')], {cwd: work, encoding: 'utf8'});
  expect(elsewhere.status).toBe(1);
  expect(elsewhere.stderr).toContain('runs only in wildshard-apply');
});

test('the bridge is the only tracked file left under the pre-lean scripts/', () => {
  expect(tracked.filter(path => path.startsWith('scripts/'))).toEqual(['scripts/vps/harden.sh']);
  expect(readFileSync('scripts/vps/harden.sh', 'utf8')).toContain('archive "$commit" src/scripts/vps');
});

test('the lean wildshard-apply unpacks src/scripts/vps, which holds every script it runs', () => {
  const apply = readFileSync('src/scripts/vps/wildshard-apply.mjs', 'utf8');
  expect(apply).toContain('archive "$2" src/scripts/vps |');
  const scripts = /const SCRIPTS = (\{[^}]+\})/u.exec(apply)?.[1] ?? '';
  const names = [...scripts.matchAll(/'([\w.-]+\.sh)'/gu)].map(match => match[1]);
  expect(names).toEqual(['harden.sh', 'setup.sh', 'rebuild.sh']);
  for (const name of names) expect(existsSync(`src/scripts/vps/${name}`)).toBe(true);
});

// The box runs these scripts from a signed tag's tree and runs the paths they name in the cook's checkout of that tag.
test('every repo path a box script names exists at this tree, and none is pre-lean', () => {
  const path = /(?:^|[^\w./$-])((?:src|scripts|test|packages|pages|server|shared)\/[\w.-]+(?:\/[\w.*-]+)*)/gu;
  const named: string[] = [];
  for (const file of tracked.filter(file => file.startsWith('src/scripts/vps/'))) {
    for (const match of readFileSync(file, 'utf8').matchAll(path)) named.push(`${file} ${(match[1] ?? '').replace(/\.$/u, '')}`);
  }
  expect(named.length).toBeGreaterThan(5);
  const at = (row: string) => row.split(' ')[1] ?? '';
  const missing = named.filter(row => !existsSync(at(row)));
  const preLean = named.filter(row => at(row).startsWith('scripts/'));
  expect(missing).toEqual([]);
  expect(preLean).toEqual([]);
  expect(named).toContain('src/scripts/vps/rebuild.sh src/scripts/.kit/assert-store-layout.mjs');
});
