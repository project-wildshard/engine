// Meta QA 11-25 row 60: release QA's K-series load times hold desktop-gpu.lock (locks.mjs holdDesktopGpu), which
// heavy-lane.py's new heavy leases wait on (test/heavy-lane.test.ts).
import {execFileSync} from 'node:child_process';
import {existsSync, mkdtempSync, readdirSync, readFileSync, rmSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {afterAll, expect, test} from 'vitest';
import {DESKTOP_GPU_LOCK, holdDesktopGpu} from '../../scripts/memory/iphone/locks.mjs';
import {scratchDir} from '../../scripts/scratch-dir.mjs';

const task = process.env.WS_LANE_NAME ?? `test-gpu-hold-${process.pid}`;
const existed = existsSync(resolve('tmp', task));
const parent = scratchDir(task, 'desktop-gpu hold fixture', {env: {...process.env, WS_LANE_NAME: task}});
afterAll(() => { if (!existed && readdirSync(parent).every(name => name === '.owner')) rmSync(parent, {recursive: true}); });

/** Whether another process holds the lock file, by heavy-lane.py's own probe. @param {string} file */
const held = file => execFileSync('python3', ['-c', `
import importlib.util, pathlib, sys
spec = importlib.util.spec_from_file_location('heavy_lane', 'scripts/heavy-lane.py')
module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
print('held' if module.desktop_gpu_held(pathlib.Path(sys.argv[1])) else 'free')`, file], {encoding: 'utf8'}).trim();

test.skipIf(!existsSync('/usr/bin/lockf'))('release QA holds desktop-gpu.lock while it measures, and its own children know it', async () => {
  const root = mkdtempSync(join(parent, 'locks-'));
  try {
    const lines = [];
    const release = await holdDesktopGpu(line => lines.push(line), root);
    expect(held(join(root, DESKTOP_GPU_LOCK))).toBe('held');
    expect(process.env.WS_DESKTOP_GPU_HELD).toBe('1');
    expect(lines[0]).toContain('Waiting for desktop-gpu.lock');
    release();
    expect(process.env.WS_DESKTOP_GPU_HELD).toBeUndefined();
    for (let tries = 0; tries < 50 && held(join(root, DESKTOP_GPU_LOCK)) === 'held'; tries++) await delay(100);
    expect(held(join(root, DESKTOP_GPU_LOCK))).toBe('free');
  } finally { rmSync(root, {recursive: true, force: true}); }
});

test('staging QA runs its legs inside the hold', () => {
  const qa = readFileSync(resolve('scripts/staging-qa.mjs'), 'utf8');
  const hold = qa.indexOf('const unlock = await holdDesktopGpu(');
  expect(hold).toBeGreaterThan(0);
  expect(qa.indexOf('await qualify({', hold)).toBeGreaterThan(hold);
  expect(qa.indexOf('} finally { unlock(); }', hold)).toBeGreaterThan(qa.indexOf('await qualify({', hold));
});
