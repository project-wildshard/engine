import {existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync, readFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {afterAll, afterEach, expect, test} from 'vitest';
import {clonePaths} from '../scripts/.kit/apfs-clone.mjs';
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
