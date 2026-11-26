// The one kernel footprint reader (ENGINE-MEMORY EM2): `phys_footprint` of named browser processes, read from outside
// the page by src/scripts/memory/footprint.py (proc_pid_rusage, no root), with the kernel's interval high-water mark so a
// peak between two samples still counts. Tag [K] in every report: it is what jetsam compares to the limit.
//
//   const procs = await webkitProcesses();                 // Playwright WebKit started by this Node process
//   const sampler = startSampler(procs.map(p => p.pid));   // every 20 ms
//   sampler.mark('title'); ... sampler.mark('control');
//   const { segments } = await sampler.stop();             // per mark: peak (interval high-water) and last, per pid
//
// Hosts: Playwright WebKit (WebContent, GPU, Networking, found by the kernel's responsible pid, since XPC services are
// parented to launchd), Chromium (Renderer, GPU, from CDP SystemInfo) and the iOS Simulator (WebContent, GPU and
// Networking under the device's launchd, plus the host's SimMetalHost and SimRenderServer).
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const FOOTPRINT_PY = fileURLToPath(new URL('footprint.py', import.meta.url));
export const MB = 1e6;

/** @param {string[]} args */
function python(args) {
  return execFileSync('python3', ['-I', FOOTPRINT_PY, ...args], { encoding: 'utf8', maxBuffer: 64 * MB, timeout: 30_000 });
}

/** One reading per pid; a pid that is gone has `error`.
 * @param {readonly number[]} pids
 * @returns {Record<string, {pid:number,physicalFootprintBytes:number,residentBytes:number,intervalMaxPhysicalFootprintBytes:number,lifetimeMaxPhysicalFootprintBytes:number,startAbstime:number} | {error:string}>} */
export function readFootprints(pids) {
  if (pids.length === 0) return {};
  return JSON.parse(python(['read', ...pids.map(String)]));
}

/** @typedef {{pid:number,ppid:number,rpid:number,name:string,path:string}} ProcessRow */
/** @typedef {{pid:number,role:string,name:string,path?:string}} BrowserProcess */

/** @returns {ProcessRow[]} */
export function listProcesses() {
  return JSON.parse(python(['procs']));
}

/** The role of a WebKit process from its executable name (Playwright's carry `.Development`).
 * @param {string} name */
export function webkitRole(name) {
  if (/WebContent/u.test(name)) return 'webcontent';
  if (/WebKit\.GPU/u.test(name)) return 'gpu';
  if (/Networking/u.test(name)) return 'networking';
  return 'ui';
}

/** Is `ancestor` on `pid`'s parent chain?
 * @param {Map<number, ProcessRow>} byPid @param {number} pid @param {number} ancestor */
export function descendsFrom(byPid, pid, ancestor) {
  const seen = new Set();
  for (let at = byPid.get(pid); at && !seen.has(at.pid); at = byPid.get(at.ppid)) {
    if (at.ppid === ancestor || at.pid === ancestor) return true;
    seen.add(at.pid);
  }
  return false;
}

/** Playwright WebKit's processes that belong to browsers this Node process launched: the Playwright app below `owner`,
 * and every process the kernel says that app is responsible for. Another lane's WebKit is never matched.
 * @param {readonly ProcessRow[]} rows @param {number} owner
 * @returns {BrowserProcess[]} */
export function pickWebkitProcesses(rows, owner) {
  const byPid = new Map(rows.map((row) => [row.pid, row]));
  const appRows = rows.filter((row) => row.path.includes('ms-playwright') && row.path.endsWith('/Playwright') && descendsFrom(byPid, row.pid, owner));
  const apps = new Set(appRows.map((row) => row.pid));
  // A hosted macOS runner (GitHub's macos-15) makes the runner, not the Playwright app, responsible for the app, and the
  // app's XPC services share that responsible pid (EM12's first hosted run read only the app). There, and only when the
  // app is not its own responsible process, a service under the app's own bundle directory started after the app
  // belongs to it. Another lane's WebKit on a shared Mac keeps its own app as responsible, so it is never matched.
  const borrowed = new Map(appRows.filter((app) => app.rpid !== app.pid && app.rpid > 0)
    .map((app) => [app.rpid, { pid: app.pid, bundle: app.path.slice(0, app.path.indexOf('/Playwright.app/') + 1) }]));
  const owned = (/** @type {ProcessRow} */ row) => {
    if (apps.has(row.rpid)) return row.path.includes('ms-playwright');
    const app = borrowed.get(row.rpid);
    return app !== undefined && row.pid > app.pid && app.bundle.length > 1 && row.path.startsWith(app.bundle) && /com\.apple\.WebKit\./u.test(row.name);
  };
  return rows.filter((row) => apps.has(row.pid) || owned(row))
    .map((row) => ({ pid: row.pid, role: apps.has(row.pid) ? 'ui' : webkitRole(row.name), name: row.name, path: row.path }));
}

/** @param {number} [owner] */
export function webkitProcesses(owner = process.pid) {
  return pickWebkitProcesses(listProcesses(), owner);
}

/** Chromium's processes from the browser's CDP: `renderer`, `gpu`, `browser`, `utility`.
 * @param {{newBrowserCDPSession: () => Promise<{send: (method: 'SystemInfo.getProcessInfo') => Promise<{processInfo: {type:string,id:number}[]}>, detach: () => Promise<void>}>}} browser
 * @returns {Promise<BrowserProcess[]>} */
export async function chromiumProcesses(browser) {
  const session = await browser.newBrowserCDPSession();
  try {
    const { processInfo } = await session.send('SystemInfo.getProcessInfo');
    return processInfo.map((row) => ({ pid: row.id, role: row.type === 'GPU' ? 'gpu' : row.type, name: row.type }));
  } finally { await session.detach().catch(() => undefined); }
}

/** The Simulator's WebKit processes (under the device's launchd) and the host processes that hold its graphics.
 * @param {readonly ProcessRow[]} rows @param {number} manager the device's `launchctl managerpid`
 * @returns {BrowserProcess[]} */
export function pickSimulatorProcesses(rows, manager) {
  const byPid = new Map(rows.map((row) => [row.pid, row]));
  const inside = rows.filter((row) => /com\.apple\.WebKit\./u.test(row.name) && descendsFrom(byPid, row.pid, manager))
    .map((row) => ({ pid: row.pid, role: webkitRole(row.name), name: row.name, path: row.path }));
  const host = rows.filter((row) => /^Sim(MetalHost|RenderServer)/u.test(row.name) && !descendsFrom(byPid, row.pid, manager))
    .map((row) => ({ pid: row.pid, role: row.name.startsWith('SimMetalHost') ? 'simmetalhost' : 'simrenderserver', name: row.name, path: row.path }));
  return [...inside, ...host];
}

/** @param {string} udid */
export function simulatorProcesses(udid) {
  const manager = Number(execFileSync('xcrun', ['simctl', 'spawn', udid, 'launchctl', 'managerpid'], { encoding: 'utf8', timeout: 10_000 }).trim());
  if (!Number.isInteger(manager) || manager <= 0) throw new Error(`no launchd for Simulator ${udid}`);
  return pickSimulatorProcesses(listProcesses(), manager);
}

/** @typedef {{seq:number,t:number,p:Record<string,[number,number]|null>}} Sample */
/** @typedef {{seq:number,t:number,mark:string}} Mark */
/** @typedef {{mark:string,from:number,to:number,samples:number,peak:Record<string,number>,last:Record<string,number>}} Segment */

/** Parse the sampler's JSON lines, numbered in stream order. A partial or foreign line is skipped.
 * @param {string} text @returns {{samples: Sample[], marks: Mark[]}} */
export function parseFootprintStream(text) {
  /** @type {Sample[]} */ const samples = [];
  /** @type {Mark[]} */ const marks = [];
  let seq = 0;
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    let row;
    try { row = JSON.parse(line); } catch { continue; }
    if (typeof row?.t !== 'number') continue;
    if (typeof row.mark === 'string') marks.push({ seq: seq++, t: row.t, mark: row.mark });
    else if (row.p && typeof row.p === 'object') samples.push({ seq: seq++, t: row.t, p: row.p });
  }
  return { samples, marks };
}

/** Split samples at the marks, in stream order (the clock can stamp a mark and the next sample alike). Segment `start`
 * holds the samples before the first mark; each mark's segment runs to the next mark. A segment's peak per pid is the
 * larger of every sample's footprint and the kernel's interval high-water since the previous sample, so a burst between
 * samples still counts; `last` is the final footprint read in the segment.
 * @param {{samples: readonly Sample[], marks: readonly Mark[]}} stream @returns {Segment[]} */
export function markSegments({ samples, marks }) {
  /** @type {({seq:number,sample:Sample}|{seq:number,mark:Mark})[]} */
  const events = [...samples.map((sample) => ({ seq: sample.seq, sample })), ...marks.map((mark) => ({ seq: mark.seq, mark }))];
  events.sort((a, b) => a.seq - b.seq);
  /** @type {Segment[]} */
  const segments = [{ mark: 'start', from: samples[0]?.t ?? 0, to: samples[0]?.t ?? 0, samples: 0, peak: {}, last: {} }];
  for (const event of events) {
    if ('mark' in event) {
      segments.push({ mark: event.mark.mark, from: event.mark.t, to: event.mark.t, samples: 0, peak: {}, last: {} });
      continue;
    }
    const segment = /** @type {Segment} */ (segments.at(-1));
    segment.samples++;
    segment.to = event.sample.t;
    for (const [pid, value] of Object.entries(event.sample.p)) {
      if (value === null) continue;
      const [footprint, high] = value;
      segment.peak[pid] = Math.max(segment.peak[pid] ?? 0, footprint, high);
      segment.last[pid] = footprint;
    }
  }
  return segments;
}

/** Sum a segment's per-pid values over the pids of one role.
 * @param {Record<string, number>} values @param {readonly BrowserProcess[]} procs @param {string} role */
export function roleSum(values, procs, role) {
  return procs.filter((p) => p.role === role).reduce((sum, p) => sum + (values[String(p.pid)] ?? 0), 0);
}

/** Sample `pids` every `everyMs` until stopped; `mark(name)` starts a new segment.
 * @param {readonly number[]} pids @param {{everyMs?: number}} [options] */
export function startSampler(pids, { everyMs = 20 } = {}) {
  const child = spawn('python3', ['-I', FOOTPRINT_PY, 'sample', String(everyMs), ...pids.map(String)], { stdio: ['pipe', 'pipe', 'inherit'] });
  let text = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { text += chunk; });
  const exited = new Promise((resolve) => { child.on('exit', resolve); });
  /** @param {string} line */
  const command = (line) => { if (child.exitCode === null && child.stdin.writable) child.stdin.write(`${line}\n`); };
  return {
    /** @param {string} name */
    mark: (name) => { if (/\s/u.test(name)) throw new Error(`a mark is one word: ${name}`); command(`mark ${name}`); },
    /** @param {number} pid */
    add: (pid) => { command(`add ${pid}`); },
    /** The stream so far, parsed. */
    snapshot: () => parseFootprintStream(text),
    stop: async () => {
      command('stop');
      child.stdin.end();
      const timer = setTimeout(() => { child.kill(); }, 3000);
      await exited;
      clearTimeout(timer);
      const stream = parseFootprintStream(text);
      return { ...stream, segments: markSegments(stream) };
    },
  };
}
