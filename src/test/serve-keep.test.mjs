// meta MINI-DEVEX MD3 (mini-devex-phone, 2026-11-21): the kept world restarts on the same port behind the same quick
// tunnels. A fake cloudflared (announces a random trycloudflare host) and a fake world (answers the release and the game
// door) run under the real keeper: a killed world comes back behind the same URL, and a killed keeper (launchd starts a
// new one) adopts the live tunnels and world by pid, URL unchanged.
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { afterAll, expect, test } from 'vitest';

const engine = join(import.meta.dirname, '../..');
const keeperScript = join(engine, 'src/scripts/memory/iphone/serve-keep.mjs');
const dir = mkdtempSync(join(tmpdir(), 'serve-keep-'));
const kept = join(dir, 'kept');
/** @type {import('node:child_process').ChildProcess[]} */
const keepers = [];

writeFileSync(join(dir, 'tunnel.mjs'), `
process.stderr.write('INF Requesting new quick Tunnel on trycloudflare.com...\\n');
process.stderr.write('INF |  https://fake-' + Math.random().toString(36).slice(2, 8) + '.trycloudflare.com   |\\n');
setInterval(() => {}, 1000);
`);
writeFileSync(join(dir, 'cloudflared'), `#!/bin/sh\nexec "${process.execPath}" "${join(dir, 'tunnel.mjs')}" "$@"\n`);
chmodSync(join(dir, 'cloudflared'), 0o755);
writeFileSync(join(dir, 'world.mjs'), `
import { createServer } from 'node:http';
const arg = (name) => process.argv[process.argv.indexOf(name) + 1];
for (const port of [arg('--port'), arg('--socket-port')]) createServer((q, r) => { r.end('{}'); }).listen(Number(port), '127.0.0.1');
console.log('engine dev on ' + arg('--port'));
`);
const env = { ...process.env, WS_KEPT_DIR: kept, WS_KEEP_TUNNEL_BIN: join(dir, 'cloudflared'), WS_KEEP_WORLD: join(dir, 'world.mjs'), WS_KEEP_LOCAL_READY: '1' };

afterAll(async () => {
  for (const keeper of keepers) keeper.kill('SIGKILL');
  const { readState } = await import('../scripts/memory/iphone/serve-keep.mjs');
  process.env.WS_KEPT_DIR = kept;
  const state = readState(label);
  for (const pid of [state?.world?.pid, ...(state?.tunnels ?? []).map((t) => t?.pid)]) { try { if (pid) process.kill(-pid, 'SIGKILL'); } catch { /* gone */ } }
  rmSync(dir, { recursive: true, force: true });
});

let label = '';
const keeper = () => { const child = spawn(process.execPath, [keeperScript, '--serve', '--label', label], { env, stdio: 'ignore' }); keepers.push(child); return child; };
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

test('a killed world restarts behind the same URL; a killed keeper is replaced and adopts the tunnels and the world', async () => {
  process.env.WS_KEPT_DIR = kept;
  const { install, readState } = await import('../scripts/memory/iphone/serve-keep.mjs');
  const sha = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: engine, encoding: 'utf8' }).stdout.trim();
  label = `io.wildshard.serve.${sha.slice(0, 12)}`;
  const installing = install({ shard: 'driftwood-isle', launch: false, timeoutMs: 30_000 });
  await delay(300);
  const first = keeper();
  const up = await installing;
  expect(up.url).toMatch(/^https:\/\/fake-[a-z0-9]+\.trycloudflare\.com\/slug\/driftwood-isle$/u);
  const world = up.world?.pid ?? 0, tunnels = up.tunnels.map((t) => t?.pid);

  // a forced kill of the world: the keeper starts it again on the same port, behind the same tunnels
  process.kill(-world, 'SIGKILL');
  let after = readState(label);
  for (let i = 0; i < 60 && !(after?.ready && after.world?.pid !== world); i++) { await delay(250); after = readState(label); }
  expect(after?.world?.pid).not.toBe(world);
  expect(after?.ready).toBe(true);
  expect(after?.url).toBe(up.url);
  expect(after?.port).toBe(up.port);
  expect(after?.restarts.map((r) => r.what)).toContain('world');

  // a forced kill of the keeper (launchd starts a fresh one): the tunnels and the world are adopted, the URL kept
  const worldBefore = after?.world?.pid ?? 0;
  first.kill('SIGKILL');
  await delay(500);
  expect(alive(worldBefore)).toBe(true);
  const second = keeper();
  let adopted = readState(label);
  for (let i = 0; i < 40 && adopted?.keeper !== second.pid; i++) { await delay(250); adopted = readState(label); }
  expect(adopted?.keeper).toBe(second.pid);
  expect(adopted?.world?.pid).toBe(worldBefore);
  expect(adopted?.tunnels.map((t) => t?.pid)).toEqual(tunnels);
  expect(adopted?.url).toBe(up.url);
  const pids = (await import('node:fs')).readFileSync(join(kept, `${label}.pids`), 'utf8').trim().split('\n').map(Number);
  expect(pids).toEqual(expect.arrayContaining([second.pid, worldBefore, ...tunnels]));

  // --stop: the keeper goes first, so a keeper mid-pass can't write its state back (2026-11-21: a stopped world's state
  // came back and the next --install adopted the old shard); then the world and the tunnels go
  process.env.WS_KEEP_LAUNCHD = 'off';
  const { stopKept } = await import('../scripts/memory/iphone/serve-keep.mjs');
  stopKept(label);
  await delay(3000);
  expect(readState(label)).toBeNull();
  expect([second.pid, worldBefore, ...tunnels].filter((pid) => pid !== undefined && alive(pid))).toEqual([]);
}, 60_000);
