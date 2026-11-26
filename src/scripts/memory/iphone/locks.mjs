// The Mac mini's measurement locks (meta MINI-DEVEX MD2, mini-devex-phone, 2026-11-21). One file names them, and every
// entry point takes its lock through it, so src/test/measure-locks.test.mjs can read which lock each one takes.
//
//   iphone13.lock     the iPhone 13 only: route-bench and link-bench with the inspector driver, bench.mjs and the
//                     release suite. A phone run holds no desktop lock (Jake 2026-11-21: "split the locks"). Only the
//                     phone runner takes it (MD1, phone-runner.mjs); a phone entry point submits a job and waits.
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
import { existsSync, mkdirSync } from 'node:fs';
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

/** Run `node script ...args` holding a kind's locks; resolves to its exit code. A phone run is a job for the phone runner
 * (MINI-DEVEX MD1, phone-queue.mjs): the runner cools the phone to `coolTo` outside the lock, appends `cooledFlag` when it
 * did, and holds iphone13.lock itself; this process only streams the job's log. A desktop run holds its locks here.
 * @param {'phone' | 'desktop'} kind @param {string} script @param {string[]} args
 * @param {{ coolTo?: number | null, cooledFlag?: string | null }} [phone] */
export async function underLock(kind, script, args, phone = {}) {
  if (kind === 'phone') {
    const { submitAndWait } = await import('./phone-queue.mjs');
    const flag = (/** @type {string} */ name) => { const at = args.lastIndexOf(name); return at === -1 ? null : args[at + 1] ?? null; };
    return submitAndWait({ argv: [process.execPath, script, ...args], coolTo: phone.coolTo ?? 36, cooledFlag: phone.cooledFlag ?? null,
      base: flag('--base'), out: flag('--out') });
  }
  mkdirSync(lockRoot(), { recursive: true });
  console.log(waitLine(kind));
  const child = spawn('/usr/bin/lockf', [...lockfArgs(kind), process.execPath, script, ...args], { stdio: 'inherit' });
  const [code, signal] = await once(child, 'exit');
  return code ?? (signal === 'SIGINT' ? 130 : 1);
}

/** @param {string} script @param {string[]} args @param {{ coolTo?: number | null, cooledFlag?: string | null }} [phone] */
export const underPhoneLocks = (script, args, phone) => underLock('phone', script, args, phone);

/** @param {string} script @param {string[]} args */
export const underDesktopGpuLock = (script, args) => underLock('desktop', script, args);

/**
 * Meta QA 11-25 row 60: hold the desktop locks around in-process work (release QA's K-series load times), not a child
 * command. A `lockf` child holds them while its stdin stays open; the returned release closes it. While held,
 * WS_DESKTOP_GPU_HELD=1 tells this process's children (heavy-lane.py) that the holder is their own, so they never wait
 * on it. With no `/usr/bin/lockf` (Linux CI) it holds nothing.
 * @param {(line: string) => void} [log] @param {string} [root] @returns {Promise<() => void>}
 */
export async function holdDesktopGpu(log = console.log, root = lockRoot()) {
  if (!existsSync('/usr/bin/lockf')) return () => { /* No lockf here: nothing held. */ };
  mkdirSync(root, { recursive: true });
  log(waitLine('desktop'));
  const child = spawn('/usr/bin/lockf', [...lockfArgs('desktop', root), '/bin/sh', '-c', 'echo held; exec cat >/dev/null'], { stdio: ['pipe', 'pipe', 'inherit'] });
  await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', code => reject(new Error(`lockf exited ${String(code)} before it held ${DESKTOP_GPU_LOCK}`)));
    child.stdout.on('data', chunk => { if (String(chunk).includes('held')) resolve(undefined); });
  });
  const before = process.env.WS_DESKTOP_GPU_HELD;
  process.env.WS_DESKTOP_GPU_HELD = '1';
  return () => {
    if (before === undefined) delete process.env.WS_DESKTOP_GPU_HELD;
    else process.env.WS_DESKTOP_GPU_HELD = before;
    child.stdin.end();
  };
}
