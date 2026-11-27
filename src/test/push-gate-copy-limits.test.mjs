// Meta QA 11-26 row 29: an engine push gate sat 44 minutes in `pins install` inside its clean copy. Every step the copy
// runs now has a limit: a `pnpm pins` that stalls fails the copy within it, naming the step and its last output, and the
// copy is removed. Real Git; `pnpm` is a stand-in on PATH that says what it is doing and then never exits.
import {spawnSync} from 'node:child_process';
import {chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {afterEach, expect, test} from 'vitest';
import {GATE_DIR, makeGateCopy} from '../scripts/push-gate-copy.mjs';

/** @type {string[]} */
const roots = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, {recursive: true, force: true}); });
const ENV = {...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))), GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null'};
/** @param {string} cwd @param {string[]} args */
const git = (cwd, args) => {
  const result = spawnSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@example.com', ...args], {cwd, env: ENV, encoding: 'utf8'});
  if (result.status !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr}`);
  return result.stdout.trim();
};

test('a stalled pins install fails the gate copy within its limit with its name and last output, and leaves no copy', () => {
  mkdirSync(resolve('tmp'), {recursive: true});
  const root = mkdtempSync(resolve('tmp/push-gate-limits-'));
  roots.push(root);
  git(root, ['init', '-q', '-b', 'main']);
  writeFileSync(join(root, '.gitignore'), '/tmp/\n/node_modules/\n/bin/\n');
  mkdirSync(join(root, 'test/pins'), {recursive: true});
  // a tree that pins shards and has no verified pins outputs: the copy runs `pnpm pins`
  writeFileSync(join(root, 'test/pins/shardfiles.json'), JSON.stringify({shards: []}));
  git(root, ['add', '.gitignore', 'test/pins/shardfiles.json']);
  git(root, ['commit', '-q', '-m', 'seed']);
  mkdirSync(join(root, 'node_modules/dep'), {recursive: true});
  writeFileSync(join(root, 'node_modules/dep/index.js'), 'module.exports = 1;\n');
  mkdirSync(join(root, 'bin'));
  const pnpm = join(root, 'bin/pnpm');
  writeFileSync(pnpm, `#!/bin/sh\necho "nalati: reading ${'https://mirror'}/a.tar"\nexec sleep 600\n`);
  chmodSync(pnpm, 0o755);
  const head = git(root, ['rev-parse', 'HEAD']);
  const env = {...ENV, PATH: `${join(root, 'bin')}:${ENV.PATH ?? ''}`, WS_GATE_STEP_S: '1'};
  const began = performance.now();
  expect(() => makeGateCopy(root, head, {say: () => {}, env})).toThrow(
    /^pnpm pins in the gate copy failed: gate step pins stuck: no exit after 1 s, stopped \(limit: WS_GATE_STEP_S\); last output: nalati: reading https:\/\/mirror\/a\.tar/u);
  // its limit and the stop's grace, never the 44 minutes
  expect((performance.now() - began) / 1000).toBeLessThan(15);
  expect(readdirSync(join(root, GATE_DIR)).filter(name => !name.endsWith('.trash') && existsSync(join(root, GATE_DIR, name)))).toEqual([]);
  expect(spawnSync('pgrep', ['-f', 'exec sleep 600|sleep 600'], {encoding: 'utf8'}).stdout.split('\n').filter(Boolean)
    .some(pid => spawnSync('ps', ['-o', 'command=', '-p', pid], {encoding: 'utf8'}).stdout.includes(root))).toBe(false);
}, 30_000);
