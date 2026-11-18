// Meta STAGING-QA SQ14 (J426: real iOS Safari in the Simulator on every deploy, about 5 minutes of J427's budget): boot an
// iPhone 17 Pro Simulator (Jake's phone, 402x874), run `staging-phones-proof.mjs --device=safari --solo` against the leg's page,
// and shut the Simulator down again when this run booted it. The proof's own report is the evidence.
import { execFileSync, spawn } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** @typedef {{ udid: string, name: string, state: string, version: number[] }} Device */

/** The newest iOS runtime's iPhone 17 Pro, else its newest "iPhone N Pro". @param {unknown} listing @returns {Device | undefined} */
export function pickPhone(listing) {
  const devices = /** @type {{ devices?: Record<string, { udid: string, name: string, state: string, isAvailable?: boolean }[]> }} */ (listing).devices ?? {};
  const rows = Object.entries(devices)
    .filter(([runtime]) => runtime.includes('SimRuntime.iOS-'))
    .flatMap(([runtime, list]) => list.filter(each => each.isAvailable !== false && /^iPhone \d+ Pro$/u.test(each.name))
      .map(each => ({ udid: each.udid, name: each.name, state: each.state, version: (runtime.split('iOS-')[1] ?? '0').split('-').map(Number) })))
    .sort((a, b) => (b.name === 'iPhone 17 Pro' ? 1 : 0) - (a.name === 'iPhone 17 Pro' ? 1 : 0)
      || (b.version[0] ?? 0) - (a.version[0] ?? 0) || (b.version[1] ?? 0) - (a.version[1] ?? 0) || b.name.localeCompare(a.name));
  return rows[0];
}

/** Whether `idb` and `ios_webkit_debug_proxy` are on PATH: the proof needs both. @returns {string | undefined} what is missing */
export function missingTools() {
  const missing = ['idb', 'ios_webkit_debug_proxy', 'xcrun'].filter(tool => {
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
  const phone = pickPhone(JSON.parse(execFileSync('xcrun', ['simctl', 'list', 'devices', 'available', '-j'], { encoding: 'utf8' })));
  if (phone === undefined) return done(false, 'no iPhone Pro Simulator is installed');
  const booted = phone.state !== 'Booted';
  if (booted) execFileSync('xcrun', ['simctl', 'boot', phone.udid], { stdio: 'ignore' });
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
    if (booted) try { execFileSync('xcrun', ['simctl', 'shutdown', phone.udid], { stdio: 'ignore', timeout: 60_000 }); } catch { /* already down */ }
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
