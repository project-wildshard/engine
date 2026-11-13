#!/usr/bin/env node
// SERVER-CELLS (draft, opus-cellmem): what one dedicated server costs per resident cell, dormant (nobody in it) and with one bot in
// each. It runs a kept `mmo-bots.mjs replica --keep` folder's release bundle on loopback with production's shape (4 workers), once per
// cell count, and reads the server's own `/metrics` (SC1: Prometheus text on 127.0.0.1:METRICS_PORT): RSS, CPU, heap and external per
// thread, event-loop lag per thread, and the workers' own tick readings. Nothing leaves this Mac but the book GET. A bundle from before
// SC1 serves no `/metrics`: build the kept run from engine main.
//   node scripts/mmo-bots.mjs replica --bots 1 --seconds 15 --cells grid --keep          (once: bundle, bots tree, pack cache)
//   (cd tmp/mmo-bots/<stamp>/src && node scripts/build-server.mjs --build <build> --out ../cmbuild --entry cellMemBots=test/fixtures/dedicated/cellMemBotsEntry.ts)
//   node scripts/cell-mem-bench.mjs --from tmp/mmo-bots/<stamp> [--counts 1,2,8,16,25] [--dormant 30] [--active 40] [--workers 4]
// The report goes to <from>/cell-mem-w<workers>.json.
import { execFileSync, spawn } from 'node:child_process';
import { generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve as absolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const { values } = parseArgs({ options: { from: { type: 'string' }, counts: { type: 'string', default: '1,2,8,16,25' }, dormant: { type: 'string', default: '30' }, active: { type: 'string', default: '40' },
  workers: { type: 'string', default: '4' }, port: { type: 'string', default: '18896' }, origin: { type: 'string', default: 'https://packs.wildshard.io' } } });
if (values.from === undefined) throw new Error('--from <kept mmo-bots folder>');
const from = absolute(values.from), server = join(from, 'server'), bots = join(from, 'cmbuild', 'cellMemBots.mjs'), port = Number(values.port), metricsPort = port + 1;
const signed = JSON.parse(readFileSync(join(from, 'release.json'), 'utf8')), release = JSON.parse(signed.body);
const sleep = (/** @type {number} */ ms) => new Promise(resolve => { setTimeout(resolve, ms); });
const note = (/** @type {Record<string, unknown>} */ row) => { console.info(JSON.stringify({ at: 'cell-mem', ...row })); };

/** The grid's cells in the order `WORLD_CELLS=grid` opens them, read off the kept run's own log. */
const order = /** @type {string[]} */ (readFileSync(join(from, 'server.jsonl'), 'utf8').split('\n').map(line => { try { return JSON.parse(line); } catch { return null; } }).find(row => row?.at === 'server.listening')?.cells ?? []);
if (order.length === 0) throw new Error('The kept run never listened');

/** @returns {Promise<Record<string, number>>} The scrape, flattened to `name{labels}` → value. */
async function scrape() {
  const text = await (await fetch(`http://127.0.0.1:${String(metricsPort)}/metrics`)).text(), rows = /** @type {Record<string, number>} */ ({});
  for (const line of text.split('\n')) { if (line === '' || line.startsWith('#')) continue; const at = line.lastIndexOf(' '); rows[line.slice(0, at)] = Number(line.slice(at + 1)); }
  return rows;
}
const sum = (/** @type {Record<string, number>} */ rows, /** @type {string} */ prefix) => Object.entries(rows).filter(([name]) => name.startsWith(prefix)).reduce((total, [, value]) => total + value, 0);
const most = (/** @type {Record<string, number>} */ rows, /** @type {RegExp} */ match) => Math.max(0, ...Object.entries(rows).filter(([name]) => match.test(name)).map(([, value]) => value));
/** One thread-memory kind summed over every thread (the server's `wildshard_thread_memory_bytes{thread,kind}`). */
const threads = (/** @type {Record<string, number>} */ rows, /** @type {RegExp} */ kind) => Object.entries(rows).filter(([name]) => name.startsWith('wildshard_thread_memory_bytes{') && kind.test(name)).reduce((total, [, value]) => total + value, 0);
const median = (/** @type {number[]} */ list) => { const sorted = list.slice().sort((a, b) => a - b); return sorted[Math.floor(sorted.length / 2)] ?? 0; };

/** macOS RSS drops as the kernel compresses a quiet process's pages; `footprint` counts those too, as Activity Monitor's Memory does. Elsewhere, RSS. */
const footprint = (/** @type {number | undefined} */ pid) => {
  if (process.platform !== 'darwin' || pid === undefined) return null;
  try { const mb = /Footprint: ([\d.]+) (KB|MB|GB)/u.exec(execFileSync('footprint', ['-p', String(pid)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })); return mb === null ? null : Number(mb[1]) * ({ KB: 1 / 1024, MB: 1, GB: 1024 }[mb[2] ?? 'MB'] ?? 1); } catch { return null; }
};

/** One phase: scrapes every 5 s for `seconds`, and the CPU used across it. */
async function phase(/** @type {number} */ seconds, /** @type {string[]} */ workerLines, /** @type {number | undefined} */ pid) {
  const first = await scrape(), started = performance.now(), samples = [], footprints = /** @type {number[]} */ ([]);
  const linesBefore = workerLines.length;
  while (performance.now() - started < seconds * 1000) { await sleep(5_000); samples.push(await scrape()); const mb = footprint(pid); if (mb !== null) footprints.push(mb); }
  const last = samples.at(-1) ?? first, wall = (performance.now() - started) / 1000;
  const ticks = workerLines.slice(linesBefore).map(line => JSON.parse(line));
  const mb = (/** @type {number} */ bytes) => Math.round(bytes / 1048576);
  return {
    footprintMB: footprints.length === 0 ? null : Math.round(median(footprints)), footprintMaxMB: footprints.length === 0 ? null : Math.round(Math.max(...footprints)),
    rssMB: mb(median(samples.map(row => row.process_resident_memory_bytes ?? 0))), rssMaxMB: mb(Math.max(...samples.map(row => row.process_resident_memory_bytes ?? 0))),
    heapMB: mb(median(samples.map(row => threads(row, /kind="heap"/u)))), externalMB: mb(median(samples.map(row => threads(row, /kind="external"/u)))), arrayBuffersMB: mb(median(samples.map(row => threads(row, /kind="arrayBuffers"/u)))),
    cpuCores: Number((((last.process_cpu_seconds_total ?? 0) - (first.process_cpu_seconds_total ?? 0)) / wall).toFixed(3)),
    mainLagP50: Number(median(samples.map(row => row['wildshard_eventloop_lag_seconds{thread="main",quantile="0.5"}'] ?? 0)).toFixed(5)) * 1000,
    mainLagP99: Number(Math.max(...samples.map(row => row['wildshard_eventloop_lag_seconds{thread="main",quantile="0.99"}'] ?? 0)).toFixed(5)) * 1000,
    workerLagP99: Number(Math.max(...samples.map(row => most(row, /^wildshard_eventloop_lag_seconds\{thread="worker-\d+",quantile="0.99"\}/u))).toFixed(5)) * 1000,
    tickP50: Math.max(0, ...ticks.map(row => row.p50)), tickP95: Math.max(0, ...ticks.map(row => row.p95)), tickP99: Math.max(0, ...ticks.map(row => row.p99)), tickMax: Math.max(0, ...ticks.map(row => row.max)),
    drops: ticks.reduce((total, row) => total + row.drops, 0), minTicksPerSecond: Math.min(60, ...ticks.map(row => row.ticksPerSecond)),
    awake: Math.max(0, ...samples.map(row => sum(row, 'wildshard_cells_awake'))), players: Math.max(0, ...samples.map(row => sum(row, 'wildshard_players'))),
    perThreadHeapMB: Object.fromEntries(Object.entries(last).filter(([name]) => name.startsWith('wildshard_thread_memory_bytes') && name.includes('kind="heap"')).map(([name, value]) => [/thread="([^"]+)"/u.exec(name)?.[1] ?? name, mb(value)])),
  };
}

/** One count: a fresh replica with the first `count` cells, dormant, then a bot in every cell. */
async function run(/** @type {number} */ count) {
  const cells = order.slice(0, count), { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const body = JSON.stringify({ ...release, serial: 1 }), file = join(from, `cell-mem-release.json`);
  writeFileSync(file, JSON.stringify({ body, signature: sign(null, Buffer.from(body), privateKey).toString('hex') }));
  const env = { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', PACK_ORIGIN: values.origin, PACK_CACHE: join(from, 'packs'), DATABASE_URL: 'memory:', SEAT_SECRET: randomBytes(32).toString('hex'),
    HOST: '127.0.0.1', PORT: String(port), RELEASE_CHANNEL: 'production', RELEASE_URL: pathToFileURL(file).href, RELEASE_PUBLIC_KEY: publicKey.export({ type: 'spki', format: 'der' }).toString('hex'),
    WORLD_CELLS: cells.join(','), WORLD_WORKERS: values.workers, WORLD_SEATS: '64', TELEMETRY_URL: '', ERRORS_URL: '', SENTRY_DSN: '', RECORD_TAG: '', METRICS_PORT: String(metricsPort) };
  const began = performance.now(), workerLines = /** @type {string[]} */ ([]), booted = /** @type {Record<string, number>} */ ({});
  const child = spawn(process.execPath, [join(server, 'main.mjs')], { cwd: server, env, stdio: ['ignore', 'pipe', 'pipe'] });
  /** Set by the log reader as lines arrive. */
  const seen = { listening: 0 };
  let buffer = '';
  child.stdout.on('data', (/** @type {Buffer} */ chunk) => {
    buffer += chunk.toString();
    for (let end = buffer.indexOf('\n'); end >= 0; end = buffer.indexOf('\n')) {
      const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
      if (line.startsWith('{"at":"worker"')) workerLines.push(line);
      else if (line.startsWith('{"at":"server.listening"')) seen.listening = performance.now() - began;
      else if (line.startsWith('{"at":"cell.booted"')) { const row = JSON.parse(line); booted[row.slug] = Math.round(row.ms); }
    }
  });
  child.stderr.on('data', () => { /* the replica's warnings stay out of the report */ });
  /** @type {import('node:child_process').ChildProcess | null} */
  let bot = null;
  try {
    while (seen.listening === 0 && child.exitCode === null && performance.now() - began < 240_000) await sleep(250);
    if (seen.listening === 0) throw new Error(`${String(count)} cells never listened`);
    // The first worker readings come 10 s after boot: let the boot's own garbage settle before the dormant read.
    while (workerLines.length === 0 && performance.now() - began < 300_000) await sleep(500);
    const dormant = await phase(Number(values.dormant), workerLines, child.pid);
    note({ count, phase: 'dormant', ...dormant });
    const result = join(from, `cell-mem-bots-${String(count)}.json`);
    rmSync(result, { force: true });
    const players = spawn(process.execPath, [bots, `ws://127.0.0.1:${String(port)}/`, release.engineBuild, cells.join(','), String(Number(values.active) + 10), 'cm', result], { stdio: ['ignore', 'pipe', 'inherit'] });
    bot = players;
    const arrival = { at: 0 };
    players.stdout.on('data', (/** @type {Buffer} */ chunk) => { if (chunk.toString().includes('cellmem.arrived')) arrival.at = performance.now(); });
    while (arrival.at === 0 && players.exitCode === null) await sleep(250);
    if (arrival.at === 0) throw new Error(`${String(count)} cells: the bots ended before they were seated`);
    const active = await phase(Number(values.active), workerLines, child.pid);
    await new Promise(resolve => { if (players.exitCode !== null) resolve(null); else players.once('exit', resolve); });
    const report = JSON.parse(readFileSync(result, 'utf8')), rtts = report.rows.map((/** @type {{ rttP50: number | null }} */ row) => row.rttP50).filter((/** @type {number | null} */ value) => value !== null);
    const row = { count, cells, bootMs: Math.round(seen.listening), cellBootMs: booted, dormant, active: { ...active, seated: report.seated, inTheirCell: report.inTheirCell, rttP50: median(rtts), rttMax: Math.max(0, ...report.rows.map((/** @type {{ rttMax: number | null }} */ seat) => seat.rttMax ?? 0)), joinMsMax: Math.max(0, ...report.rows.map((/** @type {{ joinedMs: number | null }} */ seat) => seat.joinedMs ?? 0)) } };
    note({ count, phase: 'active', ...row.active });
    return row;
  } finally {
    if (bot !== null && bot.exitCode === null) bot.kill('SIGTERM');
    child.kill('SIGTERM');
    const gone = new Promise(resolve => { if (child.exitCode !== null) resolve(null); else child.once('exit', resolve); });
    await Promise.race([gone, sleep(15_000)]);
    if (child.exitCode === null) child.kill('SIGKILL');
  }
}

const rows = [];
for (const count of values.counts.split(',').map(Number)) {
  if (!Number.isInteger(count) || count < 1 || count > order.length) { note({ count, skipped: `the grid opens ${String(order.length)} cells` }); continue; }
  rows.push(await run(count));
  writeFileSync(join(from, `cell-mem-w${values.workers}.json`), `${JSON.stringify({ build: release.engineBuild, workers: Number(values.workers), node: process.version, rows }, null, 2)}\n`);
}
note({ done: join(from, `cell-mem-w${values.workers}.json`) });
