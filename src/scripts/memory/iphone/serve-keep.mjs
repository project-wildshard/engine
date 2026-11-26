#!/usr/bin/env node
// meta MINI-DEVEX MD3 (mini-devex-phone, 2026-11-21): a served world that stays up. `serve-local.mjs --public --keep`
// hands the world to launchd instead of the lane's shell, so neither a lane's shell exiting nor a forced kill takes it
// down, and the phone keeps its quick-tunnel host while the tunnel process lives (Jake 2026-11-21: keep random
// trycloudflare names; no named tunnel, no Cloudflare login).
//
//   node src/scripts/memory/iphone/serve-keep.mjs --install [--shard driftwood-isle]   (serve-local --public --keep)
//   node src/scripts/memory/iphone/serve-keep.mjs --list
//   node src/scripts/memory/iphone/serve-keep.mjs --stop [--label <label>]            (default: this checkout's build)
//   node src/scripts/memory/iphone/serve-keep.mjs --serve --label <label>             (launchd runs this; the keeper)
//
// One kept world per build: the label is io.wildshard.serve.<HEAD sha, 12>, its state, log, pids and plist live in
// ~/.cache/wildshard/kept/ (outside every lane root). The keeper owns two cloudflared quick tunnels and the dev world
// (src/scripts/dev.mjs --staging --saves memory --no-watch, an exact build), each in its own process group:
//   - the world dies: the keeper starts it again on the same ports behind the same tunnels, so the URL is unchanged;
//   - the keeper dies (kill -9): launchd starts it again (ThrottleInterval 5 s) and it adopts the live tunnels and
//     world by pid, so the URL is unchanged;
//   - a tunnel dies: a new tunnel gets a new random name and the world restarts behind it; the state file has the URL.
// The keeper's pids go to kept/<label>.pids, which meta's SubagentStop cleanup and lane-sweep never kill.
//
// Why (MD3): the exit 144 deaths of lanes' worlds (20:50 on 11-20, 09:29 on 11-21) were meta's SubagentStop hook
// killing processes inside a lane's background shell (meta 2e02b5c1). A world under launchd lives in no shell at all.
//
// Test seams: WS_KEPT_DIR (state), WS_KEEP_TUNNEL_BIN (a fake cloudflared), WS_KEEP_WORLD (a fake world script),
// WS_KEEP_LOCAL_READY=1 (ready when both local ports answer, not the public hosts).
import { spawn, spawnSync } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join, resolve as absolute } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { parseArgs } from 'node:util';
import { homedir } from 'node:os';

const ENGINE = absolute(import.meta.dirname, '../../../..');
export const keptDir = () => process.env.WS_KEPT_DIR ?? join(homedir(), '.cache/wildshard/kept');
const statePath = (/** @type {string} */ label) => join(keptDir(), `${label}.json`);
const PORTS = { first: 4600, last: 4798 };

/** @typedef {{ pid: number, origin: string }} Tunnel */
/** @typedef {{ label: string, sha: string, root: string, shard: string, port: number, socketPort: number,
 *   tunnels: (Tunnel | null)[], world: { pid: number } | null, url: string | null, ready: boolean,
 *   restarts: { at: string, what: string, why: string }[], keeper: number | null, updatedAt: string }} KeepState */

export const labelFor = (/** @type {string} */ sha) => `io.wildshard.serve.${sha.slice(0, 12)}`;

/** @param {string} label @returns {KeepState | null} */
export function readState(label) {
  try { return JSON.parse(readFileSync(statePath(label), 'utf8')); } catch { return null; }
}

/** @param {KeepState} state */
function writeState(state) {
  mkdirSync(keptDir(), { recursive: true });
  state.updatedAt = new Date().toISOString();
  writeFileSync(`${statePath(state.label)}.tmp`, JSON.stringify(state, null, 2));
  spawnSync('/bin/mv', ['-f', `${statePath(state.label)}.tmp`, statePath(state.label)]);
  const pids = [state.keeper, ...state.tunnels.map((t) => t?.pid), state.world?.pid].filter((pid) => typeof pid === 'number');
  writeFileSync(join(keptDir(), `${state.label}.pids`), `${pids.join('\n')}\n`);
}

/** A live process's command line, or null. @param {number | undefined} pid */
export function commandOf(pid) {
  if (typeof pid !== 'number' || pid <= 1) return null;
  const ps = spawnSync('/bin/ps', ['-o', 'command=', '-p', String(pid)], { encoding: 'utf8' });
  return ps.status === 0 && ps.stdout.trim() !== '' ? ps.stdout.trim() : null;
}

/** A recorded tunnel is still ours: alive and pointing at its port. @param {Tunnel | null} tunnel @param {number} port */
export const tunnelAlive = (tunnel, port) => tunnel !== null && (commandOf(tunnel.pid)?.includes(`127.0.0.1:${String(port)}`) ?? false);

/** The recorded world is still ours: alive and serving its port. @param {{ pid: number } | null} world @param {number} port */
export const worldAlive = (world, port) => world !== null && (commandOf(world.pid)?.includes(`--port ${String(port)}`) ?? false);

/** @param {number} port */
async function portFree(port) {
  const server = createServer();
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', () => { resolve(undefined); }); });
    return true;
  } catch { return false; } finally { server.close(); }
}

/** Two free loopback ports no other kept world has. */
async function pickPorts() {
  const taken = new Set();
  for (const name of existsSync(keptDir()) ? readdirSync(keptDir()) : []) {
    if (!name.endsWith('.json')) continue;
    try { const s = JSON.parse(readFileSync(join(keptDir(), name), 'utf8')); taken.add(s.port); taken.add(s.socketPort); } catch { /* not a state file */ }
  }
  for (let port = PORTS.first; port < PORTS.last; port += 2) {
    if (taken.has(port) || taken.has(port + 1)) continue;
    if (await portFree(port) && await portFree(port + 1)) return [port, port + 1];
  }
  throw new Error(`serve-keep: no free port pair in ${String(PORTS.first)}-${String(PORTS.last)}`);
}

/** Kill a detached process group. @param {number | undefined} pid @param {NodeJS.Signals} signal */
function killGroup(pid, signal = 'SIGTERM') {
  if (typeof pid !== 'number' || pid <= 1) return;
  try { process.kill(-pid, signal); } catch { try { process.kill(pid, signal); } catch { /* gone */ } }
}

/** @param {number} pid */
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

/** @param {string} label @param {string} line */
const say = (label, line) => { console.log(`${new Date().toISOString()} ${label} ${line}`); };

/** Start a tunnel to `port` and read its announced origin from its log. @param {string} label @param {number} port */
async function startTunnel(label, port) {
  const log = join(keptDir(), `${label}.tunnel-${String(port)}.log`);
  writeFileSync(log, '');
  const fd = openSync(log, 'a');
  const bin = process.env.WS_KEEP_TUNNEL_BIN ?? 'cloudflared';
  const child = spawn(bin, ['tunnel', '--no-autoupdate', '--protocol', 'http2', '--url', `http://127.0.0.1:${String(port)}`],
    { cwd: keptDir(), detached: true, stdio: ['ignore', fd, fd] });
  closeSync(fd);
  child.unref();
  const { quickTunnelOrigin } = await import('./serve-local.mjs');
  for (const deadline = Date.now() + 45_000; Date.now() < deadline;) {
    for (const line of readFileSync(log, 'utf8').split('\n')) {
      const origin = quickTunnelOrigin(line);
      if (origin !== undefined && child.pid !== undefined) return { pid: child.pid, origin };
    }
    if (child.exitCode !== null) break;
    await delay(250);
  }
  killGroup(child.pid);
  throw new Error(`cloudflared on ${String(port)} announced no origin (${log})`);
}

/** Start the dev world behind the two origins. @param {KeepState} state */
function startWorld(state) {
  const [page, socket] = /** @type {Tunnel[]} */ (state.tunnels);
  const log = join(keptDir(), `${state.label}.world.log`);
  const fd = openSync(log, 'a');
  const script = process.env.WS_KEEP_WORLD ?? 'src/scripts/dev.mjs';
  // one work folder per build, so a restart never serves a client an older build left behind
  const work = `tmp/kept-world-${state.sha.slice(0, 12)}`;
  // a restart serves the client this keeper already built (an exact build: --no-watch), so the world is back in seconds,
  // not the minute a fresh pins install and client build take
  const built = existsSync(join(state.root, work)) ? readdirSync(join(state.root, work)).filter((name) => name.startsWith('client-') && existsSync(join(state.root, work, name, 'index.html')))
    .sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]))[0] : undefined;
  const child = spawn(process.execPath, [script, ...(built === undefined ? [] : ['--dist', join(work, built)]), '--staging', '--saves', 'memory', '--work', work,
    '--shard', state.shard, '--port', String(state.port), '--socket-port', String(state.socketPort), '--no-watch',
    '--public-origin', page.origin, '--public-socket', `${socket.origin.replace(/^https:/u, 'wss:')}/`], { cwd: state.root, detached: true, stdio: ['ignore', fd, fd] });
  closeSync(fd);
  child.unref();
  if (child.pid === undefined) throw new Error('the dev world did not start');
  return { pid: child.pid };
}

/** Ready: the release and the game door answer (public hosts, or the local ports under WS_KEEP_LOCAL_READY).
 * @param {KeepState} state */
async function ready(state) {
  const [page, socket] = /** @type {Tunnel[]} */ (state.tunnels);
  const [a, b] = process.env.WS_KEEP_LOCAL_READY === '1'
    ? [`http://127.0.0.1:${String(state.port)}/__dev/release.json`, `http://127.0.0.1:${String(state.socketPort)}/health`]
    : [`${page.origin}/__dev/release.json`, `${socket.origin}/health`];
  try {
    const [x, y] = await Promise.all([fetch(a, { cache: 'no-store', signal: AbortSignal.timeout(5000) }), fetch(b, { cache: 'no-store', signal: AbortSignal.timeout(5000) })]);
    return x.ok && y.ok;
  } catch { return false; }
}

/** The keeper: adopt or start the tunnels and the world, then keep them up. @param {string} label */
async function serve(label) {
  const state = readState(label);
  if (state === null) throw new Error(`serve-keep: no state for ${label}; run --install`);
  const stopping = new AbortController();
  const stop = () => { stopping.abort(); };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
  state.keeper = process.pid;
  const ports = [state.port, state.socketPort];
  /** @param {string} what @param {string} why */
  const restarted = (what, why) => { state.restarts.push({ at: new Date().toISOString(), what, why }); say(label, `restart ${what}: ${why}`); };
  let first = true, startedAt = 0, quickDeaths = 0;
  while (!stopping.signal.aborted) {
    let changed = false;
    for (const i of [0, 1]) {
      if (tunnelAlive(state.tunnels[i] ?? null, ports[i])) { if (first) say(label, `adopted tunnel ${String(state.tunnels[i]?.pid)} ${String(state.tunnels[i]?.origin)}`); continue; }
      if (!first || state.tunnels[i]) restarted(`tunnel ${String(ports[i])}`, state.tunnels[i] ? `pid ${String(state.tunnels[i]?.pid)} gone` : 'first start');
      state.tunnels[i] = await startTunnel(label, ports[i]);
      say(label, `tunnel ${String(ports[i])} ${state.tunnels[i]?.origin ?? ''}`);
      changed = true;
    }
    // a new tunnel origin means the running world points at a dead host: restart it behind the new one
    if (changed && worldAlive(state.world, state.port)) { restarted('world', 'a tunnel origin changed'); killGroup(state.world?.pid); await delay(1500); state.world = null; }
    if (!worldAlive(state.world, state.port)) {
      if (state.world !== null || !first) restarted('world', state.world === null ? 'not running' : `pid ${String(state.world.pid)} gone`);
      else say(label, 'starting the world');
      // a world that dies within 30 s of its start (a content error, not a kill) backs off, 2 s doubling to 60 s, so a
      // broken build never restarts every second (2026-11-21: glowfen's missing product, 111 restarts in 2 minutes)
      quickDeaths = startedAt !== 0 && Date.now() - startedAt < 30_000 ? quickDeaths + 1 : 0;
      if (quickDeaths > 0) { const wait = Math.min(60, 2 ** quickDeaths); say(label, `the world died within 30 s of its start; waiting ${String(wait)} s (${join(keptDir(), `${label}.world.log`)})`); await delay(wait * 1000); }
      for (let waited = 0; waited < 20 && !(await portFree(state.port)); waited++) await delay(500);
      startedAt = Date.now();
      state.world = startWorld(state);
      state.ready = false;
    } else if (first) say(label, `adopted world ${String(state.world?.pid)}`);
    if (!state.ready && await ready(state)) {
      state.ready = true;
      state.url = new URL(`/slug/${state.shard}`, /** @type {Tunnel} */ (state.tunnels[0]).origin).href;
      say(label, `ready ${state.url}`);
    }
    // a keeper told to stop mid-pass never writes: --stop has removed its state, and a write here would bring it back
    if (stopping.signal.aborted) break;
    writeState(state);
    first = false;
    await delay(state.ready ? 2000 : 1000);
  }
  // launchd stops the keeper on bootout; --stop kills the tunnels and the world, so a plain exit leaves them for adoption
  say(label, 'keeper stopping');
}

/** The launchd plist for a label. @param {string} label */
function plist(label) {
  const path = [dirname(process.execPath), '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin'].join(':');
  const xml = (/** @type {string} */ s) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;');
  const args = [process.execPath, join(ENGINE, 'src/scripts/memory/iphone/serve-keep.mjs'), '--serve', '--label', label];
  const log = join(keptDir(), `${label}.log`);
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${xml(label)}</string>
  <key>ProgramArguments</key><array>${args.map((a) => `<string>${xml(a)}</string>`).join('')}</array>
  <key>WorkingDirectory</key><string>${xml(keptDir())}</string>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>${xml(path)}</string><key>HOME</key><string>${xml(homedir())}</string>${
    ['WS_KEEP_TUNNEL_BIN', 'WS_KEEP_WORLD', 'WS_KEEP_LOCAL_READY', 'WS_KEPT_DIR'].filter((k) => process.env[k] !== undefined).map((k) => `<key>${k}</key><string>${xml(String(process.env[k]))}</string>`).join('')}</dict>
  <key>KeepAlive</key><true/>
  <key>RunAtLoad</key><true/>
  <key>ThrottleInterval</key><integer>5</integer>
  <key>StandardOutPath</key><string>${xml(log)}</string>
  <key>StandardErrorPath</key><string>${xml(log)}</string>
</dict></plist>
`;
}

const domain = () => `gui/${String(process.getuid?.() ?? 501)}`;

/** Install (or reuse) the kept world for this checkout's build; resolves to its state once ready.
 * @param {{ shard: string, root?: string, launch?: boolean, timeoutMs?: number }} options */
export async function install({ shard, root = ENGINE, launch = true, timeoutMs = 240_000 }) {
  const sha = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim();
  if (!/^[0-9a-f]{40}$/u.test(sha)) throw new Error(`serve-keep: ${root} has no HEAD`);
  const label = labelFor(sha);
  mkdirSync(keptDir(), { recursive: true });
  let state = readState(label);
  if (state !== null && state.shard !== shard) throw new Error(`serve-keep: ${label} serves ${state.shard}; --stop it first`);
  if (state === null) {
    const [port, socketPort] = await pickPorts();
    state = { label, sha, root, shard, port, socketPort, tunnels: [null, null], world: null, url: null, ready: false, restarts: [], keeper: null, updatedAt: '' };
    writeState(state);
  }
  if (launch) {
    const file = join(keptDir(), `${label}.plist`);
    writeFileSync(file, plist(label));
    const loaded = spawnSync('launchctl', ['print', `${domain()}/${label}`], { stdio: 'ignore' }).status === 0;
    if (!loaded) {
      const boot = spawnSync('launchctl', ['bootstrap', domain(), file], { encoding: 'utf8' });
      if (boot.status !== 0) throw new Error(`launchctl bootstrap ${file}: ${boot.stderr.trim()}`);
    }
  }
  for (const deadline = Date.now() + timeoutMs; Date.now() < deadline;) {
    const now = readState(label);
    if (now?.ready === true && now.url !== null) return now;
    await delay(1000);
  }
  throw new Error(`serve-keep: ${label} not ready in ${String(timeoutMs / 1000)} s (log ${join(keptDir(), `${label}.log`)})`);
}

/** Stop a kept world: launchd lets go of the keeper, then its tunnels and world stop. @param {string} label */
export function stopKept(label) {
  const before = readState(label);
  // WS_KEEP_LAUNCHD=off (the test): the test's label is the checkout's real one, so never boot out a live kept world
  if (process.env.WS_KEEP_LAUNCHD !== 'off') spawnSync('launchctl', ['bootout', `${domain()}/${label}`], { stdio: 'ignore' });
  // wait for the keeper to go (bootout sends SIGTERM) before its state goes, so a keeper mid-pass can't write it back
  const keeper = before?.keeper ?? null;
  if (keeper !== null && alive(keeper)) process.kill(keeper, 'SIGTERM'); // a keeper launchd never ran (a test, a hand start)
  if (keeper !== null) {
    for (let tries = 0; tries < 50 && alive(keeper); tries++) spawnSync('/bin/sleep', ['0.2']);
    if (alive(keeper)) killGroup(keeper, 'SIGKILL');
  }
  const state = readState(label) ?? before;
  for (const pid of [state?.keeper, state?.world?.pid, ...(state?.tunnels ?? []).map((t) => t?.pid)]) killGroup(pid ?? undefined);
  for (const suffix of ['.json', '.pids', '.plist']) rmSync(join(keptDir(), `${label}${suffix}`), { force: true });
  return state;
}

async function main() {
  const { values } = parseArgs({ options: {
    install: { type: 'boolean' }, serve: { type: 'boolean' }, stop: { type: 'boolean' }, list: { type: 'boolean' },
    label: { type: 'string' }, shard: { type: 'string', default: 'driftwood-isle' },
  } });
  if (values.serve) { await serve(/** @type {string} */ (values.label)); return; }
  if (values.list) {
    for (const name of existsSync(keptDir()) ? readdirSync(keptDir()).filter((n) => n.endsWith('.json')) : []) {
      const s = readState(name.slice(0, -5));
      if (s !== null) console.log(`${s.label} ${s.shard} :${String(s.port)} ${s.ready ? String(s.url) : 'starting'} restarts ${String(s.restarts.length)} (${s.root})`);
    }
    return;
  }
  if (values.stop) {
    const sha = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: ENGINE, encoding: 'utf8' }).stdout.trim();
    const label = values.label ?? labelFor(sha);
    const state = stopKept(label);
    console.log(state === null ? `serve-keep: ${label} was not kept` : `serve-keep: stopped ${label} (${String(state.url)})`);
    return;
  }
  if (!/^[a-z0-9_-]+$/u.test(values.shard)) throw new Error('--shard needs a slug');
  const state = await install({ shard: values.shard });
  console.log(`serve-local: ${String(state.url)} (public, kept by launchd as ${state.label}; stop: node src/scripts/memory/iphone/serve-keep.mjs --stop --label ${state.label})`);
}

if (process.argv[1] === import.meta.filename) await main();
