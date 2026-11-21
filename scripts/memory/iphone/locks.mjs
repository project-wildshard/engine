// The Mac mini's measurement locks (meta MINI-DEVEX MD2, mini-devex-phone, 2026-11-21). One file names them, and every
// entry point takes its lock through it, so test/tooling/measure-locks.test.mjs can read which lock each one takes.
//
//   iphone13.lock     the iPhone 13 only: route-bench and link-bench with the inspector driver, bench.mjs and the
//                     release suite. A phone run holds no desktop lock (Jake 2026-11-21: "split the locks").
//   desktop-gpu.lock  the Mac's GPU: desktop WebKit (route-bench and link-bench --driver webkit), the fps table's
//                     Chromium and WebKit censuses, the Metal GPU staircase. Desktop censuses no longer queue behind
//                     phone routes.
//
// Until 2026-11-21 one `mini-measure.lock` guarded the phone and the desktop GPU alike, and phone runs took
// iphone13.lock then mini-measure.lock. A desktop run still takes mini-measure.lock after desktop-gpu.lock, so a
// checkout from before the split (which takes only mini-measure.lock for its desktop runs) never measures beside a new
// one. New phone runs never take it, so the two kinds never wait on each other. Drop LEGACY_DESKTOP once no lane runs
// a checkout older than the split.
//
// The locks live in the canonical engine checkout's tmp/, shared by every worktree; WS_LOCK_ROOT moves them (tests).
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const PHONE_LOCK = 'iphone13.lock';
export const DESKTOP_GPU_LOCK = 'desktop-gpu.lock';
export const LEGACY_DESKTOP = 'mini-measure.lock';

/** Where the shared lock files live. */
export const lockRoot = () => process.env.WS_LOCK_ROOT ?? join(homedir(), 'projects/games/wildshard/engine/tmp');

/** Which lock a driver's run takes: the inspector and WebDriver drive the phone, everything else the Mac's GPU.
 * @param {string} driver @returns {'phone' | 'desktop'} */
export const lockKind = (driver) => (driver === 'inspector' || driver === 'webdriver' ? 'phone' : 'desktop');

/** The lock files a kind holds, in the order they are taken. @param {'phone' | 'desktop'} kind */
export function lockFiles(kind, root = lockRoot()) {
  return kind === 'phone' ? [join(root, PHONE_LOCK)] : [join(root, DESKTOP_GPU_LOCK), join(root, LEGACY_DESKTOP)];
}

/** `/usr/bin/lockf` arguments that hold a kind's locks around a command: spawn('/usr/bin/lockf', [...lockfArgs(kind), cmd, ...]).
 * @param {'phone' | 'desktop'} kind */
export function lockfArgs(kind, root = lockRoot()) {
  return lockFiles(kind, root).flatMap((file, i) => (i === 0 ? ['-k', file] : ['/usr/bin/lockf', '-k', file]));
}

/** A line saying what a run waits for. @param {'phone' | 'desktop'} kind */
export const waitLine = (kind) => `Waiting for ${kind === 'phone' ? PHONE_LOCK : `${DESKTOP_GPU_LOCK} (then ${LEGACY_DESKTOP})`}`;

/** Run `node script ...args` holding a kind's locks; resolves to its exit code.
 * @param {'phone' | 'desktop'} kind @param {string} script @param {string[]} args */
export async function underLock(kind, script, args) {
  mkdirSync(lockRoot(), { recursive: true });
  console.log(waitLine(kind));
  const child = spawn('/usr/bin/lockf', [...lockfArgs(kind), process.execPath, script, ...args], { stdio: 'inherit' });
  const [code, signal] = await once(child, 'exit');
  return code ?? (signal === 'SIGINT' ? 130 : 1);
}

/** @param {string} script @param {string[]} args */
export const underPhoneLocks = (script, args) => underLock('phone', script, args);

/** @param {string} script @param {string[]} args */
export const underDesktopGpuLock = (script, args) => underLock('desktop', script, args);
