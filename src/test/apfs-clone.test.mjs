import {existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync, readFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {afterAll, afterEach, expect, test, vi} from 'vitest';
import {clonePaths,runCloneHelper} from '../scripts/.kit/apfs-clone.mjs';
import {scratchDir} from '../scripts/.kit/scratch-dir.mjs';

const task = process.env.WS_LANE_NAME ?? `test-apfs-${process.pid}`;
const existed = existsSync(resolve('tmp', task));
const parent = scratchDir(task, 'APFS clone fixture', {env: {...process.env, WS_LANE_NAME: task}});
const roots = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, {recursive: true}); });
afterAll(() => { if (!existed && readdirSync(parent).every(name => name === '.owner')) rmSync(parent, {recursive: true}); });

test('DK10: clone-only refuses unsupported platforms without copying; ordinary callers still copy', () => {
  const root = mkdtempSync(join(parent, 'apfs-')); roots.push(root);
  const source = join(root, 'source'), target = join(root, 'target');
  writeFileSync(source, 'source bytes');
  expect(() => clonePaths([[source, target]], {platform: 'linux', copy: false})).toThrow('copy disabled');
  expect(existsSync(target)).toBe(false);
  expect(clonePaths([[source, target]], {platform: 'linux'})).toBe('copy');
  writeFileSync(target, 'changed target');
  expect(readFileSync(source, 'utf8')).toBe('source bytes');
});

test('QA43: a clone helper stuck on its input cannot hold the copy open', () => {
  const root = mkdtempSync(join(parent, 'apfs-stall-')); roots.push(root);
  const marker = join(root, 'started');
  writeFileSync(join(root, 'python3'), `#!/bin/sh
trap '' TERM
printf 'started\n' > "$WS_TEST_CLONE_MARKER"
exec /bin/sleep 30
`, {mode: 0o755});
  vi.stubEnv('PATH', `${root}:${process.env.PATH ?? ''}`);
  vi.stubEnv('WS_TEST_CLONE_MARKER', marker);
  try {
    const started = performance.now();
    expect(runCloneHelper('', 'x'.repeat(1024 * 1024), 1000)).toBe('Python APFS clone helper timed out after 1000 ms');
    expect(readFileSync(marker, 'utf8')).toBe('started\n');
    expect(performance.now() - started).toBeLessThan(5000);
  } finally {
    vi.unstubAllEnvs();
  }
});
