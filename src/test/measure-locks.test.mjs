// meta MINI-DEVEX MD2 (mini-devex-phone, 2026-11-21): iphone13.lock guards the phone only; desktop WebKit and Metal runs
// take desktop-gpu.lock, so a desktop census never queues behind a phone route. Each entry point is read for the lock it
// takes, and two real lockf holders show the kinds never wait on each other.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { afterAll, expect, test } from 'vitest';
import { DESKTOP_GPU_LOCK, LEGACY_DESKTOP, lockfArgs, lockFiles, lockKind, PHONE_LOCK } from '../scripts/memory/iphone/locks.mjs';

const root = join(import.meta.dirname, '../..');
const read = (file) => readFileSync(join(root, file), 'utf8');
const scratch = mkdtempSync(join(tmpdir(), 'measure-locks-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

test('the phone holds iphone13.lock alone; the desktop holds desktop-gpu.lock, then the legacy lock', () => {
  expect(lockFiles('phone', '/r')).toEqual([`/r/${PHONE_LOCK}`]);
  expect(lockFiles('desktop', '/r')).toEqual([`/r/${DESKTOP_GPU_LOCK}`, `/r/${LEGACY_DESKTOP}`]);
  expect(lockfArgs('phone', '/r')).toEqual(['-k', '/r/iphone13.lock']);
  expect(lockfArgs('desktop', '/r')).toEqual(['-k', '/r/desktop-gpu.lock', '/usr/bin/lockf', '-k', '/r/mini-measure.lock']);
  expect([lockKind('inspector'), lockKind('webdriver'), lockKind('webkit'), lockKind('chromium')]).toEqual(['phone', 'phone', 'desktop', 'desktop']);
});

test('every entry point takes its lock through locks.mjs: route-bench, link-bench, bench, the release suite, the fps table, the staircase', () => {
  // route-bench and link-bench: the driver picks the kind (inspector: phone; webkit: desktop)
  for (const file of ['src/scripts/memory/iphone/route-bench.mjs', 'src/scripts/memory/iphone/link-bench.mjs']) {
    const source = read(file);
    expect(source, file).toMatch(/const kind = lockKind\(values\.driver\);/u);
    expect(source, file).toMatch(/await underLock\(kind, import\.meta\.filename,/u);
  }
  // bench.mjs and the release suite it runs: the phone
  const bench = read('src/scripts/memory/iphone/bench.mjs');
  expect(bench).toMatch(/import \{ underPhoneLocks \} from '\.\/locks\.mjs';/u);
  expect(bench).toMatch(/releaseSuite\(args\.slice\(2\), \{ script: benchScript, lock: underPhoneLocks \}\)/u);
  expect(bench).toMatch(/await underPhoneLocks\(benchScript,/u);
  expect(read('src/scripts/memory/iphone/release.mjs')).toMatch(/return bench\.lock\(bench\.script,/u);
  // the DF6 fps table's Chromium and WebKit censuses: the desktop GPU
  const table = read('src/scripts/fps/table.mjs');
  expect(table).toMatch(/const gpuLock = lockfArgs\('desktop'\);/u);
  expect(table).toMatch(/spawn\('\/usr\/bin\/lockf',\[\.\.\.gpuLock,/u);
  // the Metal staircase, wrapped by hand
  expect(read('src/scripts/memory/gpu-staircase.mjs')).toMatch(/lockf -k <engine>\/tmp\/desktop-gpu\.lock/u);
});

test('no script builds a lock path of its own', () => {
  const files = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) { if (name !== 'node_modules' && name !== 'tmp') walk(path); } else if (/\.(?:mjs|js|ts|sh)$/u.test(name)) files.push(path);
    }
  };
  walk(join(root, 'src', 'scripts'));
  const own = files.filter((file) => !file.endsWith('memory/iphone/locks.mjs') && /(?:join\([^)\n]*|['"]-k['"],\s*[^\n,]*|lockf -k \S*)(?:iphone13|mini-measure|desktop-gpu)\.lock/u.test(readFileSync(file, 'utf8').replace(/^\s*\/\/.*$/gmu, '')));
  expect(own.map((file) => relative(root, file))).toEqual([]);
});

// BSD lockf(1) is macOS's: the Mac mini, the only host that measures, has /usr/bin/lockf and locks.mjs spawns it. Hosted CI
// runs Linux, which has no /usr/bin/lockf (engine run 44943266534 went red here), so the live lock check runs on darwin only;
// the tests above (which lock each entry point takes) run everywhere.
test.skipIf(process.platform !== 'darwin' || !existsSync('/usr/bin/lockf'))('a desktop census and a phone route hold their locks at the same time; neither waits', async () => {
  const hold = (kind, seconds) => spawn('/usr/bin/lockf', [...lockfArgs(kind, scratch), '/bin/sleep', String(seconds)], { stdio: 'ignore' });
  const free = (file) => spawnSync('/usr/bin/lockf', ['-t', '0', file, '/usr/bin/true']).status === 0;
  const census = hold('desktop', 5);
  await new Promise((resolve) => { setTimeout(resolve, 400); });
  expect(free(join(scratch, DESKTOP_GPU_LOCK))).toBe(false);
  // the phone's lock is free while the census runs, and the phone route takes it at once
  const started = Date.now();
  const route = spawnSync('/usr/bin/lockf', ['-t', '0', ...lockfArgs('phone', scratch).slice(1), '/bin/sleep', '0.2']);
  expect(route.status).toBe(0);
  expect(Date.now() - started).toBeLessThan(2000);
  // and a second desktop run does wait on the first
  expect(spawnSync('/usr/bin/lockf', ['-t', '0', join(scratch, DESKTOP_GPU_LOCK), '/usr/bin/true']).status).toBe(75);
  census.kill();
});
