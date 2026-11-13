// E7.5 prep (Jake, 2026-11-09: "add some new UI features to just like 'check' or 'Doctor' that everything is good"): the Connection
// doctor's checks. Each walks one link a phone needs to reach the world, in order, with a real request and its own time limit, and says
// what it measured and, when it fails, what to do. The join check says the same `hello` the game says (J197: no new wire), as a fresh
// device that never sends `ready`, so it learns whether the door would seat this page and takes no seat and writes no save.
import type { Scope } from '@wildshard/engine/app/scope';
import { diagnosticNow } from '@wildshard/engine/core/clock';
import { helloMessage } from '@wildshard/engine/net/wireMessages';
import { closeReason, decodePong, encodePing, framed, SOCKET_COUNTDOWN, SOCKET_PONG, SOCKET_RELIABLE, SOCKET_RESUME } from '@wildshard/engine/net/socketFrames';
import { readSignedRelease } from './release';
import type { ReleaseFile } from '../../../shared/host/releaseRows';

/** The links, in the order a phone needs them. */
export const DOCTOR_CHECKS = [
  { id: 'page', label: 'Page and build' },
  { id: 'release', label: 'Signed release file' },
  { id: 'packs', label: 'Packs origin' },
  { id: 'server', label: 'Server health' },
  { id: 'join', label: 'Socket and join' },
  { id: 'latency', label: 'Latency and clock' },
  { id: 'browser', label: 'This browser' },
] as const;
export type DoctorId = (typeof DOCTOR_CHECKS)[number]['id'];
export type DoctorState = 'wait' | 'run' | 'pass' | 'warn' | 'fail' | 'skip';
/** One check as the panel shows it. `value` is what was measured; `hint` says what to do when it is not a pass. */
export interface DoctorRow { readonly id: DoctorId; readonly label: string; readonly state: DoctorState; readonly value: string; readonly hint: string; readonly ms: number }

/** What the page knows before any check: its own stamps (`stampBuildDocuments`). */
export interface DoctorConfig {
  /** `__WS_BUILD_ID__`. */
  readonly build: string;
  /** `__WS_WORLD__`: absent on a build that plays offline. */
  readonly world?: { readonly release: string; readonly key: string };
  /** The page's origin, where `version.json` lives. */
  readonly origin: string;
  /** The cell the player was loading (`?chunk=`), when the doctor knows it. */
  readonly cell?: string;
  /** A check's time limit in ms. */
  readonly limitMs?: number;
}

const LIMIT_MS = 8000;
/** The pings the latency check sends, and their spacing: the server answers one per 250 ms (`PING_FLOOR_MS`). */
const PINGS = 5, PING_GAP_MS = 300;
const SLOW_MS = 250, CLOCK_OFF_MS = 30_000, LOW_STORAGE = 512 * 1024 * 1024;
const short = (build: string): string => build.slice(0, 7);
const mb = (bytes: number): string => bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.round(bytes / 1e6)} MB`;
const errorText = (error: unknown): string => error instanceof Error ? error.message : String(error);

class TimedOutError extends Error { override name = 'TimedOutError'; }
/** `work` with an abort signal and a hard limit: a hung request becomes a clean failure. */
async function limited<T>(scope: Scope, ms: number, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const control = new AbortController();
  let timer: ReturnType<Scope['timeout']> | undefined;
  const late = new Promise<never>((_resolve, reject) => { timer = scope.timeout(ms, () => { control.abort(); reject(new TimedOutError(`no answer in ${String(Math.round(ms / 1000))} s`)); }); });
  try { return await Promise.race([work(control.signal), late]); } finally { scope.cancelTimer(timer); }
}

/** A check's outcome before it is timed. */
interface Outcome { readonly state: DoctorState; readonly value: string; readonly hint?: string }
const pass = (value: string): Outcome => ({ state: 'pass', value });
const warn = (value: string, hint: string): Outcome => ({ state: 'warn', value, hint });
const fail = (value: string, hint: string): Outcome => ({ state: 'fail', value, hint });
const skip = (value: string): Outcome => ({ state: 'skip', value });

/** What the earlier checks learned, for the later ones. */
interface Learned { readonly scope: Scope; release?: ReleaseFile; socket?: string; serverOffset?: number; pageOffset?: number; serverBuild?: string; rtt: number[]; joined: boolean;
  /** The release's build has no server book or part on the packs origin: the server cannot move to it. */
  packsMissing?: boolean }

/** The health address beside a socket: the same host, over HTTPS for `wss:`. */
export function healthUrl(socket: string): string {
  const url = new URL(socket);
  url.protocol = url.protocol === 'wss:' ? 'https:' : 'http:'; url.pathname = '/health'; url.search = ''; url.hash = '';
  return url.href;
}

async function checkPage(config: DoctorConfig, learned: Learned, ms: number): Promise<Outcome> {
  try {
    const response = await limited(learned.scope, ms, signal => fetch(new URL('/version.json', config.origin), { cache: 'no-store', signal }));
    const date = response.headers.get('date');
    // A Date header has whole seconds, cut down: half a second back is its middle.
    const said = date === null ? Number.NaN : Date.parse(date);
    if (Number.isFinite(said)) learned.pageOffset = said + 500 - Date.now();
    if (!response.ok) return fail(`version.json ${String(response.status)}`, 'The game page answered with an error. Reload; if it stays, the page deploy is broken: tell Jake.');
    const version = await response.json() as { build?: unknown; saveEpoch?: unknown };
    const live = typeof version.build === 'string' ? version.build : '';
    const epoch = typeof version.saveEpoch === 'number' ? ` · epoch ${String(version.saveEpoch)}` : '';
    if (config.build !== '' && live !== '' && live !== config.build) return warn(`open ${short(config.build)} · live ${short(live)}`, 'A newer page is out. Reload to get it.');
    return pass(`build ${short(live || config.build)}${epoch}`);
  } catch (error) {
    return fail(errorText(error), 'The game page did not answer. Check this phone has internet (try another website), then reload.');
  }
}

async function checkRelease(config: DoctorConfig, learned: Learned, ms: number): Promise<Outcome> {
  const world = config.world;
  if (world === undefined) return skip('this build plays offline: no online world');
  let text: string;
  try {
    const response = await limited(learned.scope, ms, signal => fetch(world.release, { cache: 'no-store', signal }));
    if (response.status === 404) return fail('404: no release file', 'No release is published on this channel yet. The release train has not run: tell Jake.');
    if (!response.ok) return fail(`HTTP ${String(response.status)}`, 'The packs origin answered with an error for the release file. Try again in a minute; if it stays, tell Jake.');
    text = await response.text();
  } catch (error) {
    return fail(errorText(error), 'Could not fetch the release file from the packs origin. Check this phone has internet; if other sites work, the packs Worker is down.');
  }
  try {
    const release = await readSignedRelease(text, world.key);
    learned.release = release;
    if (release.socket !== undefined) learned.socket = release.socket;
    const said = `${release.channel} · serial ${String(release.serial)} · build ${short(release.engineBuild)} · epoch ${String(release.saveEpoch)}`;
    if (release.socket === undefined) return fail(said, 'The release file names no server address. The release was signed without a socket: tell Jake.');
    if (config.build !== '' && release.engineBuild !== config.build) return warn(said, `The world runs build ${short(release.engineBuild)} and this page is ${short(config.build)}. Reload; a deploy may be in progress.`);
    return pass(said);
  } catch (error) {
    const message = errorText(error);
    if (/too old/u.test(message)) return fail('no Ed25519 in this browser', 'Update Chrome to 137 or newer (Safari 17 or newer), then reload.');
    if (/signature/u.test(message)) return fail('bad signature', "The release file's signature does not match this page's pinned key. Nobody can fix this on the phone: tell Jake (release key and page key differ).");
    return fail(message, 'The release file is not readable. Tell Jake.');
  }
}

async function checkPacks(config: DoctorConfig, learned: Learned, ms: number): Promise<Outcome> {
  const release = learned.release, world = config.world;
  if (release === undefined || world === undefined) return skip('needs the release file');
  const origin = new URL(world.release).origin, book = new URL(`/assets/spawn/server-${release.engineBuild}.json`, origin);
  try {
    const shards = await limited(learned.scope, ms, async signal => {
      const response = await fetch(book, { cache: 'no-store', signal });
      // Only a 404 proves the book was never published; any other answer may be this phone's network or a passing fault.
      if (response.status === 404) learned.packsMissing = true;
      if (!response.ok) throw new Error(`server book ${String(response.status)} · build ${short(release.engineBuild)}`);
      return (await response.json() as { shards?: Record<string, { url?: string }> }).shards ?? {};
    });
    const named = Object.keys(shards), product = named.find(name => name === config.cell) ?? named[0];
    const part = product === undefined ? undefined : shards[product]?.url;
    if (product === undefined || part === undefined) { learned.packsMissing = true; return fail(`book has no shards`, 'The server book for this build is empty. The pack publish is incomplete: tell Jake.'); }
    // A part's headers are enough. HEAD avoids starting and then cancelling the
    // server's large body, which browsers report as a failed network request.
    const status = await limited(learned.scope, ms, async signal => { const response = await fetch(new URL(part, origin), { method: 'HEAD', signal }); return response.status; });
    if (status !== 200) { learned.packsMissing = status === 404; return fail(`${product} part ${String(status)}`, 'A pack part is missing on the packs origin. The pack publish is incomplete: tell Jake.'); }
    return pass(`server book · ${String(Object.keys(shards).length)} shards · ${product} part ok`);
  } catch (error) {
    if (learned.packsMissing === true) return fail(errorText(error), `The packs origin has no server book for build ${short(release.engineBuild)}, the one the release file names. Its packs were never published, so the server cannot move to it: tell Jake.`);
    return fail(errorText(error), `The packs origin did not serve build ${short(release.engineBuild)}'s server book. Run the check again in a minute; if it stays, tell Jake.`);
  }
}

async function checkServer(learned: Learned, ms: number): Promise<Outcome> {
  if (learned.socket === undefined) return skip('needs the release file');
  const url = healthUrl(learned.socket), started = diagnosticNow();
  try {
    const response = await limited(learned.scope, ms, signal => fetch(url, { cache: 'no-store', signal }));
    const health = await response.json() as { build?: unknown; players?: unknown; uptime?: unknown; now?: unknown };
    // The server stamped `now` about half a round trip before the answer landed.
    if (typeof health.now === 'number') learned.serverOffset = health.now + (diagnosticNow() - started) / 2 - Date.now();
    if (typeof health.build === 'string') learned.serverBuild = health.build;
    const players = typeof health.players === 'number' ? ` · ${String(health.players)} playing` : '';
    const up = typeof health.uptime === 'number' ? ` · up ${String(Math.round(health.uptime / 60))} min` : '';
    if (learned.release !== undefined && learned.serverBuild !== undefined && learned.serverBuild !== learned.release.engineBuild) {
      const named = short(learned.release.engineBuild), runs = short(learned.serverBuild);
      // The server loads the named build's packs before it moves; without them it stays where it is, however long anyone waits.
      return warn(`build ${runs}${players} · release ${named}`, learned.packsMissing === true
        ? `Stuck: the server stays on ${runs} because build ${named}'s packs are not published, so it cannot move. Tell Jake.`
        : `The server still runs ${runs}; the release names ${named}. It loads the new packs, then restarts after a 60-second countdown. Run the check again in a few minutes; if it stays, tell Jake.`);
    }
    return pass(`build ${short(learned.serverBuild ?? '?')}${players}${up}`);
  } catch (error) {
    if (error instanceof TimedOutError) return fail(`${new URL(url).host}: ${error.message}`, `Server unreachable: ${new URL(url).host} is down or the server is stopped. Tell Jake.`);
    // A server from before the doctor sends no CORS header: an opaque answer still proves the tunnel and TLS are up.
    try {
      await limited(learned.scope, ms, signal => fetch(url, { mode: 'no-cors', cache: 'no-store', signal }));
      // D7: behind Cloudflare the rooms address keeps /health private (404, no CORS), so the opaque answer is all a page gets.
      return pass(`${new URL(url).host} reachable · health is private`);
    } catch {
      return fail(`${new URL(url).host}: no answer`, `Server unreachable: ${new URL(url).host} is down, its TLS is failing, or the server is stopped. Tell Jake.`);
    }
  }
}

/** Why a door closed, in a player's words. */
const CLOSED: Readonly<Record<string, readonly [string, string]>> = {
  reload: ['refused: another build', 'The server runs a different build from this page. Reload; if it stays, the page and server deploys disagree: tell Jake.'],
  full: ['World is full', 'Every seat is taken. Wait a minute and run the check again.'],
  refused: ['refused', 'The server refused this join. Run the check again; if it stays, copy the report to Jake.'],
  retry: ['busy: try again', 'The server could not finish the join just now. Run the check again in a few seconds.'],
  restart: ['server restarting', 'The server is restarting for an update. Run the check again in a minute.'],
};

function checkJoin(config: DoctorConfig, learned: Learned, ms: number): Promise<Outcome> {
  const socket = learned.socket;
  if (socket === undefined || learned.release === undefined) return Promise.resolve(skip('needs the release file'));
  // WR5 (5.5): an accepted hello proves the server speaks this page's wire within one minor, not that it runs this build;
  // the build shown is the client's own.
  const build = config.build || learned.release.engineBuild, scope = learned.scope.child('doctor.join');
  return new Promise<Outcome>(resolve => {
    let ws: WebSocket, opened = false, sent = 0, deploy = '';
    const done = (outcome: Outcome): void => {
      if (scope.disposed) return;
      scope.dispose();
      try { ws.close(1000); } catch { /* already closed */ }
      resolve(outcome);
    };
    const ping = (): void => { if (ws.readyState === WebSocket.OPEN && sent < PINGS) { sent++; ws.send(encodePing(diagnosticNow(), 0)); scope.timeout(PING_GAP_MS, ping); } };
    try { ws = new WebSocket(socket); } catch (error) { scope.dispose(); resolve(fail(errorText(error), 'This browser refused the server address. Tell Jake.')); return; }
    ws.binaryType = 'arraybuffer';
    scope.timeout(ms, () => {
      done(opened ? fail('opened, no answer to hello', 'The socket opened but the server never answered the join. The server may be stuck: tell Jake.')
        : fail(`no socket in ${String(Math.round(ms / 1000))} s`, 'Socket blocked: the server is reachable but the WebSocket would not connect. A network (work or school Wi-Fi, a VPN) may block it: try mobile data.'));
    });
    scope.listen(ws, 'open', () => {
      opened = true;
      // The game's own hello (J197), as a device that exists only for this check. No `ready` follows, so no body is seated.
      ws.send(framed(SOCKET_RELIABLE, helloMessage({ build, player: `doctor:${crypto.randomUUID()}`, name: 'Doctor', ledger: 0 }).buffer));
      ping();
    });
    scope.listen(ws, 'message', (event: MessageEvent<unknown>) => {
      if (!(event.data instanceof ArrayBuffer) || event.data.byteLength === 0) return;
      const view = new DataView(event.data), prefix = view.getUint8(0);
      if (prefix === SOCKET_PONG) { const pong = decodePong(view); if (pong !== null) learned.rtt.push(diagnosticNow() - pong.clock); }
      else if (prefix === SOCKET_COUNTDOWN) deploy = ' · deploy due';
      else if (prefix === SOCKET_RESUME) {
        learned.joined = true;
        let seat = '';
        try { seat = (JSON.parse(new TextDecoder().decode(event.data.slice(1))) as { shard?: string }).shard ?? ''; } catch { /* the seat's cell is a nicety */ }
        // Stay for the pings: the latency check reads them.
        scope.timeout(Math.max(0, PINGS * PING_GAP_MS - 100), () => { done(pass(`accepted${seat === '' ? '' : ` · ${seat}`} · client build ${short(build)}${deploy}`)); });
      }
    });
    scope.listen(ws, 'close', event => {
      const code = event instanceof CloseEvent ? event.code : 1006, reason = closeReason(code), said = CLOSED[reason];
      if (said !== undefined) { done(reason === 'retry' ? warn(said[0], said[1]) : fail(said[0], said[1])); return; }
      done(opened ? fail(`closed (${String(code)})`, 'The server closed the socket before the join finished. Run the check again; if it stays, tell Jake.')
        : fail(`socket refused (${String(code)})`, 'Socket blocked: the server answers HTTPS but the WebSocket would not open. A network may block it (try mobile data), or this phone tried too often: wait a minute.'));
    });
  });
}

function checkLatency(learned: Learned): Outcome {
  const offsetMs = learned.serverOffset ?? learned.pageOffset ?? null;
  const clock = offsetMs === null ? 'clock unknown' : `clock ${offsetMs >= 0 ? '+' : '−'}${(Math.abs(offsetMs) / 1000).toFixed(1)} s${learned.serverOffset === undefined ? ' vs page' : ''}`;
  const clockOff = offsetMs !== null && Math.abs(offsetMs) > CLOCK_OFF_MS;
  if (learned.rtt.length === 0) {
    if (!learned.joined) return skip(`needs the socket · ${clock}`);
    return warn(`no pong · ${clock}`, 'The server answered the join but not the pings. Run the check again.');
  }
  const sorted = [...learned.rtt].sort((a, b) => a - b), median = sorted[Math.floor(sorted.length / 2)] ?? 0, min = sorted[0] ?? 0;
  const fmt = (ms: number): string => ms < 10 ? ms.toFixed(1) : String(Math.round(ms));
  const value = `${fmt(median)} ms (min ${fmt(min)}) · ${clock}`;
  if (clockOff) return warn(value, "This phone's clock is off. Set date and time to automatic in the phone's settings.");
  if (median > SLOW_MS) return warn(value, 'The link is slow. Play still works, but hits may feel late. Try Wi-Fi closer to the router, or mobile data.');
  return pass(value);
}

async function checkBrowser(config: DoctorConfig, scope: Scope, ms: number): Promise<Outcome> {
  const parts: string[] = [], problems: string[] = [];
  let failed = false;
  const chrome = /Chrome\/(\d+)/u.exec(navigator.userAgent)?.[1];
  let ed25519 = false;
  try {
    const key = config.world?.key;
    await (key === undefined ? crypto.subtle.generateKey({ name: 'Ed25519' }, false, ['sign', 'verify'])
      : crypto.subtle.importKey('spki', Uint8Array.from(key.match(/../gu) ?? [], pair => Number.parseInt(pair, 16)), { name: 'Ed25519' }, false, ['verify']));
    ed25519 = true;
  } catch { ed25519 = false; }
  parts.push(ed25519 ? 'Ed25519' : 'no Ed25519');
  if (!ed25519) { failed = true; problems.push(`Update ${chrome === undefined ? 'this browser' : `Chrome (${chrome})`} to Chrome 137+ or Safari 17+.`); }
  // J322 (Jake, 2026-11-13): the game draws with WebGL2 only (core/webglStartup.ts), so the doctor asks for exactly that;
  // a WebGPU adapter or a WebGL1 context is no pass, since neither draws the game
  const probe = document.createElement('canvas').getContext('webgl2');
  const gpu = probe === null ? '' : 'WebGL2';
  probe?.getExtension('WEBGL_lose_context')?.loseContext();
  parts.push(gpu === '' ? 'no WebGL2' : gpu);
  if (gpu === '') { failed = true; problems.push('This browser has no WebGL2: turn on hardware acceleration, or use Chrome or Safari.'); }
  try {
    const estimate = await limited(scope, Math.min(ms, 3000), () => navigator.storage.estimate());
    const free = (estimate.quota ?? 0) - (estimate.usage ?? 0);
    parts.push(`${mb(free)} free`);
    if (free < LOW_STORAGE) problems.push('Little storage is free for the game: free some space on the phone.');
  } catch { parts.push('storage unknown'); }
  const worker = 'serviceWorker' in navigator ? navigator.serviceWorker.controller === null ? 'no SW yet' : 'SW on' : 'no SW';
  parts.push(worker);
  if (chrome !== undefined) parts.push(`Chrome ${chrome}`);
  const value = parts.join(' · ');
  if (failed) return fail(value, problems.join(' '));
  if (problems.length > 0) return warn(value, problems.join(' '));
  return pass(value);
}

/** Run every check in order. `show` hears each row as it starts and as it ends. */
export async function runDoctor(config: DoctorConfig, owner: Scope, show: (row: DoctorRow) => void): Promise<readonly DoctorRow[]> {
  const scope = owner.child('doctor.run'), ms = config.limitMs ?? LIMIT_MS, learned: Learned = { scope, rtt: [], joined: false }, rows: DoctorRow[] = [];
  const work: Readonly<Record<DoctorId, () => Promise<Outcome>>> = {
    page: () => checkPage(config, learned, ms), release: () => checkRelease(config, learned, ms), packs: () => checkPacks(config, learned, ms),
    server: () => checkServer(learned, ms), join: () => checkJoin(config, learned, ms), latency: () => Promise.resolve(checkLatency(learned)), browser: () => checkBrowser(config, scope, ms),
  };
  for (const { id, label } of DOCTOR_CHECKS) {
    show({ id, label, state: 'run', value: '', hint: '', ms: 0 });
    const started = diagnosticNow();
    let outcome: Outcome;
    // A check's own limit is inside it; this one is the guard for a check that forgot.
    try { outcome = await limited(scope, ms * 2, () => work[id]()); } catch (error) { outcome = fail(errorText(error), 'This check did not finish. Run the checks again.'); }
    const row: DoctorRow = { id, label, state: outcome.state, value: outcome.value, hint: outcome.hint ?? '', ms: Math.round(diagnosticNow() - started) };
    if (scope.disposed) break;
    rows.push(row); show(row);
  }
  scope.dispose();
  return rows;
}

/** The doctor's lines for Copy report: the LS4 format's plain lines, one per check. */
export function doctorReport(rows: readonly DoctorRow[], config: DoctorConfig): string {
  const failing = rows.filter(row => row.state === 'fail').length, warned = rows.filter(row => row.state === 'warn').length;
  return [
    `Wildshard connection doctor · ${new Date().toISOString()}`,
    `build ${config.build === '' ? 'unknown' : config.build} · ${String(globalThis.innerWidth)}x${String(globalThis.innerHeight)} @${String(globalThis.devicePixelRatio)}x · ${navigator.userAgent}`,
    `world ${config.world?.release ?? 'none (offline build)'}${config.cell === undefined ? '' : ` · cell ${config.cell}`}`,
    `result ${failing === 0 ? warned === 0 ? 'all pass' : `${String(warned)} warning${warned === 1 ? '' : 's'}` : `${String(failing)} failing`}`,
    'checks:',
    ...rows.map((row, index) => `  ${String(index + 1)}. ${row.id} · ${row.state} · ${String(row.ms)} ms · ${row.value}${row.hint === '' ? '' : ` · fix: ${row.hint}`}`),
  ].join('\n');
}
