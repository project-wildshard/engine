#!/usr/bin/env node
// meta IPHONE13-REAL-TEST IP34 (mini-phone-13b, 2026-11-19): the fast phone loop. Build this checkout's client, start the dev
// world (`src/scripts/dev.mjs`: the game server too, so it is the whole online stack, not static files), and put both behind
// `tailscale serve` on this Mac's tailnet name: HTTPS on 443 for the page, 8443 for the world's socket. A tailnet phone
// (the Tailscale app open) gets a secure context, so the service worker, storage and crypto behave as on staging; plain
// http on a LAN address does not. Tailnet only: this never runs `tailscale funnel`.
//
// --public instead opens two owned Cloudflare quick tunnels and serves the reviewed staging snapshot with in-memory saves.
//   node src/scripts/memory/iphone/serve-local.mjs [--public [--no-watch | --keep]] [--shard nine-dragon-stack] [--port N] [--socket-port N] [--dry-run]
// --public --keep (meta MINI-DEVEX MD3) hands this build's world to launchd (serve-keep.mjs): it outlives the lane's shell
// and a forced kill, restarts on the same port behind the same quick tunnels, prints the URL and returns at once.
//
// It prints the URL once the world is up. dev.mjs watches src/: an edit rebuilds the client and the open page opens the new
// build by itself. Ctrl-C stops the world and removes both serve entries.
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { createInterface } from 'node:readline';
import { setTimeout as delay } from 'node:timers/promises';
import { resolve as absolute } from 'node:path';
import { parseArgs } from 'node:util';
import { listenLoopback } from '../../rig-listeners.mjs';

const ROOT = absolute(import.meta.dirname, '../../../..');

/** The tailnet name and whether the tailnet issues HTTPS certificates. @param {string} json */
export function tailnetName(json) {
  const status = JSON.parse(json);
  const name = String(status.Self?.DNSName ?? '').replace(/\.$/u, '');
  if (!name.endsWith('.ts.net')) throw new Error('This Mac has no tailnet name: is Tailscale up?');
  if (!(status.CertDomains ?? []).includes(name)) throw new Error(`The tailnet issues no HTTPS certificate for ${name}: turn on HTTPS certificates in the tailnet's DNS settings`);
  return name;
}

/** A quick tunnel advertises a single HTTPS origin on its generated domain. @param {string} line */
export function quickTunnelOrigin(line) {
  return /(?:^|\s)(https:\/\/[a-z0-9-]+\.trycloudflare\.com)(?=\s|$)/u.exec(line)?.[1];
}

/** @param {number} port */
const tunnelArgs = port => ['tunnel', '--no-autoupdate', '--protocol', 'http2', '--url', `http://127.0.0.1:${String(port)}`];

/** @param {AbortSignal} signal */
const abortReason = signal => signal.reason instanceof Error ? signal.reason : new Error(String(signal.reason));

/** Wait until the signed release and game door are serving through the two public hosts.
 * @param {string} origin @param {string} socketOrigin @param {AbortSignal} signal */
async function waitForPublicWorld(origin, socketOrigin, signal) {
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(45_000)]);
  for (;;) {
    deadline.throwIfAborted();
    try {
      const release = await fetch(`${origin}/__dev/release.json`, { signal: deadline, cache: 'no-store' });
      const health = await fetch(`${socketOrigin}/health`, { signal: deadline, cache: 'no-store' });
      if (release.ok && health.ok) {
        const { body } = await release.json();
        if (body !== '' && JSON.parse(body).engineBuild === (await health.json()).build) return;
      }
    } catch { /* The public routes may still be propagating. */ }
    await delay(500, undefined, { signal: deadline });
  }
}

/** @param {string} shard @param {number} port @param {number} socketPort @param {boolean} dryRun */
async function servePublic(shard, port, socketPort, dryRun, noWatch = false) {
  const work = `tmp/dev-world-public-${String(port)}`;
  // --no-watch (mini-driftwood13i): an exact build stays that build while its checkout moves on (a shared phone pair)
  const flags = ['src/scripts/dev.mjs', '--staging', '--saves', 'memory', '--work', work,
    '--shard', shard, '--port', String(port), '--socket-port', String(socketPort), ...(noWatch ? ['--no-watch'] : [])];
  if (dryRun) {
    console.log(JSON.stringify({ tunnels: [port, socketPort].map(n => ['cloudflared'].concat(tunnelArgs(n))),
      dev: ['node', ...flags, '--public-origin', '<page HTTPS>', '--public-socket', '<socket WSS>'] }, null, 2));
    return;
  }

  const started = performance.now(), stop = new AbortController();
  /** @type {Map<import('node:child_process').ChildProcess, Promise<void>>} */
  const children = new Map();
  const interrupt = () => { stop.abort(); };
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', interrupt);
  /** @param {string} bin @param {string[]} args */
  const start = (bin, args) => {
    stop.signal.throwIfAborted();
    const child = spawn(bin, args, { cwd: ROOT, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    /** @type {Promise<void>} */
    const ended = new Promise(resolve => {
      child.once('error', error => { stop.abort(error); resolve(undefined); });
      child.once('exit', (code, signal) => {
        // An exit at any time, even after readiness, ends the whole share.
        stop.abort(new Error(`${bin} exited (${String(code ?? signal)})`));
        resolve(undefined);
      });
    });
    children.set(child, ended);
    return { child, ended };
  };
  /** Stop an owned group, including subprocesses of the Node build.
   * @param {import('node:child_process').ChildProcess} child @param {NodeJS.Signals} signal */
  const signalGroup = (child, signal) => {
    if (child.pid === undefined) return;
    try { process.kill(-child.pid, signal); } catch { /* Already exited. */ }
  };
  /** @param {number} target */
  const tunnel = async target => {
    const { child, ended } = start('cloudflared', tunnelArgs(target));
    child.stdout?.resume();
    if (child.stderr === null) throw new Error('No cloudflared diagnostic stream');
    const lines = createInterface({ input: child.stderr });
    try {
      const origin = await Promise.race([ended, new Promise((resolve, reject) => {
        const timeout = AbortSignal.any([stop.signal, AbortSignal.timeout(30_000)]);
        timeout.addEventListener('abort', () => { reject(abortReason(timeout)); }, { once: true });
        lines.on('line', line => {
          const found = quickTunnelOrigin(line);
          if (found !== undefined) resolve(found);
          else if (/\bERR\b/u.test(line)) console.error(line);
        });
      })]);
      if (typeof origin !== 'string') throw new Error('cloudflared did not announce its HTTPS origin');
      return origin;
    } finally { lines.close(); child.stderr.resume(); }
  };
  try {
    // Never point a public tunnel at an existing local listener.
    for (const target of [port, socketPort]) {
      const check = createServer();
      await listenLoopback(check, target);
      await new Promise(resolve => { check.close(() => { resolve(undefined); }); });
    }
    const [origin, socketOrigin] = await Promise.all([tunnel(port), tunnel(socketPort)]);
    const socket = `${socketOrigin.replace(/^https:/u, 'wss:')}/`;
    const { child, ended } = start(process.execPath, [...flags, '--public-origin', origin, '--public-socket', socket]);
    child.stderr?.pipe(process.stderr, { end: false });
    if (child.stdout === null) throw new Error('No dev world diagnostic stream');
    const lines = createInterface({ input: child.stdout });
    await new Promise((resolve, reject) => {
      stop.signal.addEventListener('abort', () => { reject(abortReason(stop.signal)); }, { once: true });
      lines.on('line', line => {
        if (line.startsWith('engine dev on ')) resolve(undefined);
        else console.log(line);
      });
    });
    await waitForPublicWorld(origin, socketOrigin, stop.signal);
    const url = new URL(`/slug/${shard}`, origin);
    console.log(`serve-local: ${url.href} (public, up in ${((performance.now() - started) / 1000).toFixed(1)} s)`);
    await Promise.race([ended, new Promise(resolve => { stop.signal.addEventListener('abort', () => { resolve(undefined); }, { once: true }); })]);
    if (stop.signal.aborted && !(stop.signal.reason instanceof DOMException)) throw abortReason(stop.signal);
  } catch (error) {
    if (!stop.signal.aborted || !(stop.signal.reason instanceof DOMException)) throw error;
  } finally {
    stop.abort();
    process.off('SIGINT', interrupt);
    process.off('SIGTERM', interrupt);
    for (const child of children.keys()) signalGroup(child, 'SIGTERM');
    const reaped = Promise.all(children.values());
    await Promise.race([reaped, delay(5000, undefined, { ref: false })]);
    for (const child of children.keys()) {
      if (child.exitCode === null && child.signalCode === null) signalGroup(child, 'SIGKILL');
    }
    await reaped;
  }
}

/** Build, serve and print the URL; ends when the dev world does. */
async function main() {
  const { values } = parseArgs({ options: {
    shard: { type: 'string', default: 'nine-dragon-stack' }, port: { type: 'string' },
    'socket-port': { type: 'string' }, public: { type: 'boolean', default: false }, 'no-watch': { type: 'boolean', default: false }, 'dry-run': { type: 'boolean', default: false },
    keep: { type: 'boolean', default: false },
  } });
  // --keep (meta MINI-DEVEX MD3): launchd keeps the public world for this build (serve-keep.mjs); prints the URL and exits
  if (values.keep) {
    if (!values.public) throw new Error('--keep keeps a --public world');
    if (!/^[a-z0-9_-]+$/u.test(values.shard)) throw new Error('--shard needs a slug');
    const { install } = await import('./serve-keep.mjs');
    const kept = await install({ shard: values.shard });
    console.log(`serve-local: ${String(kept.url)} (public, kept by launchd as ${kept.label}; stop: node src/scripts/memory/iphone/serve-keep.mjs --stop --label ${kept.label})`);
    return;
  }
  if (!/^[a-z0-9_-]+$/u.test(values.shard)) throw new Error('--shard needs a slug');
  const port = Number(values.port ?? (values.public ? 4442 : 4402));
  const socketPort = Number(values['socket-port'] ?? (values.public ? 4452 : 4412));
  if ([port, socketPort].some(n => !Number.isInteger(n) || n < 1 || n > 65535) || port === socketPort) throw new Error('--port and --socket-port are two distinct ports');
  if (values.public) { await servePublic(values.shard, port, socketPort, values['dry-run'], values['no-watch']); return; }

  const status = spawnSync('tailscale', ['status', '--json'], { encoding: 'utf8' });
  if (status.status !== 0) throw new Error(`tailscale status failed: ${status.stderr}`);
  const name = tailnetName(status.stdout);
  const origin = `https://${name}`, socket = `wss://${name}:8443/`;
  const serve = [['--https=443', `http://127.0.0.1:${String(port)}`], ['--https=8443', `http://127.0.0.1:${String(socketPort)}`]];
  const dev = ['src/scripts/dev.mjs', '--shard', values.shard, '--port', String(port), '--socket-port', String(socketPort),
    '--public-origin', origin, '--public-socket', socket];
  if (values['dry-run']) {
    console.log(JSON.stringify({ url: `${origin}/slug/${values.shard}`, serve: serve.map(([https, to]) => `tailscale serve --bg ${https} ${to}`), dev: `node ${dev.join(' ')}` }, null, 2));
    return;
  }

  const tailscale = (/** @type {string[]} */ args) => {
    const done = spawnSync('tailscale', ['serve', ...args], { encoding: 'utf8' });
    if (done.status !== 0) throw new Error(`tailscale serve ${args.join(' ')}: ${done.stderr || done.stdout}`);
  };
  for (const [https, to] of serve) tailscale(['--bg', https, to]);
  const unserve = () => { for (const [https] of serve) spawnSync('tailscale', ['serve', https, 'off'], { stdio: 'ignore' }); };

  const started = Date.now();
  const child = spawn(process.execPath, dev, { cwd: ROOT, stdio: ['ignore', 'pipe', 'inherit'] });
  child.stdout.on('data', (/** @type {Buffer} */ chunk) => {
    const text = chunk.toString();
    process.stdout.write(text);
    if (text.includes('engine dev on ')) console.log(`serve-local: ${origin}/slug/${values.shard} (tailnet only, up in ${String(Math.round((Date.now() - started) / 1000))} s)`);
  });
  const stop = () => { child.kill('SIGTERM'); };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  child.once('exit', code => { unserve(); process.exit(code ?? 0); });
}

if (process.argv[1] === import.meta.filename) await main();
