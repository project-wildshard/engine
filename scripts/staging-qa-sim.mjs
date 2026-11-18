// Meta STAGING-QA SQ14 (J426: real iOS Safari in the Simulator on every deploy, about 5 minutes of J427's budget): boot an
// iPhone 17 Pro Simulator (Jake's phone, 402x874), run `staging-phones-proof.mjs --device=safari --solo` against the leg's page,
// and shut the Simulator down again. It runs on its own device, `Wildshard QA` (a copy of that phone, made once), erased before
// every run: a second run on the same loopback origin otherwise found the first one's saved name and Zone Select, not the title.
// The proof's own report is the evidence.
import { execFileSync, spawn } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** @typedef {{ udid: string, name: string, state: string, version: number[], runtime: string, type: string }} Device */

/** The Simulator device the proof owns and erases. */
export const QA_DEVICE = 'Wildshard QA';

/** The newest iOS runtime's iPhone 17 Pro, else its newest "iPhone N Pro". @param {unknown} listing @returns {Device | undefined} */
export function pickPhone(listing) {
  const devices = /** @type {{ devices?: Record<string, { udid: string, name: string, state: string, isAvailable?: boolean, deviceTypeIdentifier?: string }[]> }} */ (listing).devices ?? {};
  const rows = Object.entries(devices)
    .filter(([runtime]) => runtime.includes('SimRuntime.iOS-'))
    .flatMap(([runtime, list]) => list.filter(each => each.isAvailable !== false && /^iPhone \d+ Pro$/u.test(each.name))
      .map(each => ({ udid: each.udid, name: each.name, state: each.state, version: (runtime.split('iOS-')[1] ?? '0').split('-').map(Number),
        runtime, type: each.deviceTypeIdentifier ?? '' })))
    .sort((a, b) => (b.name === 'iPhone 17 Pro' ? 1 : 0) - (a.name === 'iPhone 17 Pro' ? 1 : 0)
      || (b.version[0] ?? 0) - (a.version[0] ?? 0) || (b.version[1] ?? 0) - (a.version[1] ?? 0) || b.name.localeCompare(a.name));
  return rows[0];
}

/** The proof's own device, if it was made. @param {unknown} listing @returns {{ udid: string, state: string } | undefined} */
export function qaDevice(listing) {
  const devices = /** @type {{ devices?: Record<string, { udid: string, name: string, state: string, isAvailable?: boolean }[]> }} */ (listing).devices ?? {};
  return Object.values(devices).flat().find(each => each.name === QA_DEVICE && each.isAvailable !== false);
}

/** @returns {string | undefined} Required Simulator tools that are missing from PATH. */
export function missingTools() {
  const missing = ['idb', 'idb_companion', 'ios_webkit_debug_proxy', 'xcrun'].filter(tool => {
    try { execFileSync('/usr/bin/which', [tool], { stdio: 'ignore' }); return false; } catch { return true; }
  });
  return missing.length === 0 ? undefined : missing.join(', ');
}

/**
 * Run the Safari proof in a booted Simulator. `pass` needs exit 0 and a report on `build`.
 * @param {{ root: string, url: string, out: string, build: string, maxMs?: number }} options
 * @returns {Promise<{ id: 'ios-safari', browser: 'ios-safari', pass: boolean, seconds: number, playedMs: number, log: string, reason?: string }>}
 */
export async function iosSafari({ root, url, out, build, maxMs = 360_000 }) {
  const started = Date.now();
  const dir = join(out, 'ios-safari'), log = join(dir, 'run.log');
  mkdirSync(dir, { recursive: true });
  const done = (/** @type {boolean} */ pass, /** @type {string | undefined} */ reason, playedMs = 0) => ({
    id: /** @type {const} */ ('ios-safari'), browser: /** @type {const} */ ('ios-safari'), pass, seconds: (Date.now() - started) / 1000, playedMs, log,
    ...(pass || reason === undefined ? {} : { reason }) });
  const missing = missingTools();
  if (missing !== undefined) return done(false, `the iOS Simulator proof needs ${missing} on PATH (uv tool install fb-idb; brew install ios-webkit-debug-proxy facebook/fb/idb-companion)`);
  const listing = JSON.parse(execFileSync('xcrun', ['simctl', 'list', 'devices', 'available', '-j'], { encoding: 'utf8' }));
  let phone = qaDevice(listing);
  if (phone === undefined) {
    const model = pickPhone(listing);
    if (model === undefined || model.type === '') return done(false, 'no iPhone Pro Simulator is installed');
    phone = { udid: execFileSync('xcrun', ['simctl', 'create', QA_DEVICE, model.type, model.runtime], { encoding: 'utf8' }).trim(), state: 'Shutdown' };
  }
  const simctl = (/** @type {string[]} */ args, timeout = 120_000) => { execFileSync('xcrun', ['simctl', ...args], { stdio: 'ignore', timeout }); };
  if (phone.state !== 'Shutdown') try { simctl(['shutdown', phone.udid]); } catch { /* already down */ }
  simctl(['erase', phone.udid]);
  simctl(['boot', phone.udid]);
  let status;
  try {
    execFileSync('xcrun', ['simctl', 'bootstatus', phone.udid, '-b'], { stdio: 'ignore', timeout: 180_000 });
    const fd = openSync(log, 'w', 0o600);
    try {
      const child = spawn(process.execPath, [join(import.meta.dirname, 'staging-phones-proof.mjs'), '--device=safari', '--solo',
        `--base=${url}`, `--build=${build}`, `--tag=sq${Date.now().toString(36).slice(-6)}`, `--out=${dir}`],
      { cwd: root, env: { ...process.env, SIM_UDID: phone.udid }, stdio: ['ignore', fd, fd] });
      const timer = setTimeout(() => { child.kill('SIGTERM'); }, maxMs);
      status = await new Promise((resolve, reject) => { child.once('close', resolve); child.once('error', reject); });
      clearTimeout(timer);
    } finally { closeSync(fd); }
  } finally {
    try { execFileSync('xcrun', ['simctl', 'terminate', phone.udid, 'com.apple.mobilesafari'], { stdio: 'ignore' }); } catch { /* not running */ }
    try { simctl(['shutdown', phone.udid], 60_000); } catch { /* already down */ }
  }
  const file = join(dir, 'report-safari.json');
  /** @type {{ build?: string, steps?: { step: string, ok: boolean, detail?: unknown }[] } | undefined} */
  const report = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : undefined;
  const failed = report?.steps?.find(step => !step.ok);
  const pass = status === 0 && report?.build === build && failed === undefined;
  const walked = report?.steps?.some(step => step.ok && step.step.startsWith('a real touch')) === true;
  return done(pass, failed === undefined ? (status === null ? 'the iOS Simulator proof ran out of time' : 'no passing exact-build Safari report')
    : `${failed.step}: ${JSON.stringify(failed.detail ?? '').slice(0, 160)}`, walked ? 6000 : 0);
}
