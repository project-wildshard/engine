#!/usr/bin/env node
// meta IPHONE13-REAL-TEST IP34 (mini-phone-13b, 2026-11-19): the fast phone loop. Build this checkout's client, start the dev
// world (`scripts/dev.mjs`: the game server too, so it is the whole online stack, not static files), and put both behind
// `tailscale serve` on this Mac's tailnet name: HTTPS on 443 for the page, 8443 for the world's socket. A tailnet phone
// (the Tailscale app open) gets a secure context, so the service worker, storage and crypto behave as on staging; plain
// http on a LAN address does not. Tailnet only: this never runs `tailscale funnel`.
//
//   node scripts/memory/iphone/serve-local.mjs [--shard nine-dragon-stack] [--port 4402] [--socket-port 4412] [--dry-run]
//
// It prints the URL once the world is up. dev.mjs watches src/: an edit rebuilds the client and the open page opens the new
// build by itself. Ctrl-C stops the world and removes both serve entries.
import { spawn, spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';

/** The tailnet name and whether the tailnet issues HTTPS certificates. @param {string} json */
export function tailnetName(json) {
  const status = JSON.parse(json);
  const name = String(status.Self?.DNSName ?? '').replace(/\.$/u, '');
  if (!name.endsWith('.ts.net')) throw new Error('This Mac has no tailnet name: is Tailscale up?');
  if (!(status.CertDomains ?? []).includes(name)) throw new Error(`The tailnet issues no HTTPS certificate for ${name}: turn on HTTPS certificates in the tailnet's DNS settings`);
  return name;
}

/** Build, serve and print the URL; ends when the dev world does. */
function main() {
  const ROOT = resolve(import.meta.dirname, '../../..');
  const { values } = parseArgs({ options: {
    shard: { type: 'string', default: 'nine-dragon-stack' }, port: { type: 'string', default: '4402' },
    'socket-port': { type: 'string', default: '4412' }, 'dry-run': { type: 'boolean', default: false },
  } });
  const port = Number(values.port), socketPort = Number(values['socket-port']);
  if (!Number.isInteger(port) || !Number.isInteger(socketPort) || port === socketPort) throw new Error('--port and --socket-port are two distinct ports');

  const status = spawnSync('tailscale', ['status', '--json'], { encoding: 'utf8' });
  if (status.status !== 0) throw new Error(`tailscale status failed: ${status.stderr}`);
  const name = tailnetName(status.stdout);
  const origin = `https://${name}`, socket = `wss://${name}:8443/`;
  const serve = [['--https=443', `http://127.0.0.1:${String(port)}`], ['--https=8443', `http://127.0.0.1:${String(socketPort)}`]];
  const dev = ['scripts/dev.mjs', '--shard', values.shard, '--port', String(port), '--socket-port', String(socketPort),
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

if (process.argv[1] === import.meta.filename) main();
