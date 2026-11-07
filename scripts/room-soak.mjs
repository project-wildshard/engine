#!/usr/bin/env node
// E7.3e: one cell on the server target, with `soakBot.mjs`'s two phones, for as long as asked. It starts nothing it does not stop, and it opens no port past loopback.
// Its release file is real and signed, with a key made for this run.
//   node room-soak.mjs <server dir> <pack origin> <cache dir> <slug> <build> <seconds> [port]
import { spawn } from 'node:child_process';
import { generateKeyPairSync, sign } from 'node:crypto';
import { createWriteStream, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const [server, origin, cache, slug, build, secondsArg, portArg = '18790'] = process.argv.slice(2), seconds = Number(secondsArg), log = join(cache, `..`, `soak-${slug}.log`);
const out = createWriteStream(log), { publicKey, privateKey } = generateKeyPairSync('ed25519'), release = join(cache, 'soak-release.json');
const body = JSON.stringify({ channel: 'production', serial: 1, engineBuild: build, saveEpoch: 1, shards: [{ slug, revision: 1 }] });
mkdirSync(cache, { recursive: true });
writeFileSync(release, JSON.stringify({ body, signature: sign(null, Buffer.from(body), privateKey).toString('hex') }));
const room = spawn(process.execPath, [join(server, 'main.mjs')], { env: { ...process.env, PACK_ORIGIN: origin, PACK_CACHE: cache, DATABASE_URL: 'memory:', SEAT_SECRET: 'soak', HOST: '127.0.0.1', PORT: portArg, WILDSHARD_BUILD: build, WORLD_CELLS: slug,
  RELEASE_URL: pathToFileURL(release).href, RELEASE_PUBLIC_KEY: publicKey.export({ type: 'spki', format: 'der' }).toString('hex') }, stdio: ['ignore', 'pipe', 'pipe'] });
room.stdout.pipe(out); room.stderr.pipe(out);
await new Promise(resolve => { setTimeout(resolve, 1000); });
const bots = spawn(process.execPath, [join(server, 'soakBot.mjs'), `ws://127.0.0.1:${portArg}`, build, String(seconds)], { stdio: ['ignore', 'pipe', 'inherit'] });
let last = '';
bots.stdout.on('data', chunk => { last = String(chunk).trim().split('\n').at(-1) ?? last; });
const code = await new Promise(resolve => { bots.on('exit', resolve); });
const gone = new Promise(resolve => { room.on('exit', resolve); });
room.kill('SIGTERM');
await gone;
out.end();
await new Promise(resolve => { setTimeout(resolve, 200); });
const rows = readFileSync(log, 'utf8').split('\n').filter(text => text.startsWith('{"at":"worker"')).map(text => JSON.parse(text)), full = rows.filter(row => row.players === 2);
/** @param {string} key */
const sum = key => full.reduce((total, row) => total + row[key], 0);
/** @param {string} key */
const peak = key => full.reduce((top, row) => Math.max(top, row[key]), 0);
/** @param {string} key */
const least = key => full.reduce((low, row) => Math.min(low, row[key]), Infinity);
const report = { slug, seconds, bots: code, windows: full.length, ticksPerSecond: { min: Number(least('ticksPerSecond').toFixed(2)), max: Number(peak('ticksPerSecond').toFixed(2)) }, p50: { mean: Number((sum('p50') / full.length).toFixed(3)) },
  p95: { mean: Number((sum('p95') / full.length).toFixed(3)), worst: Number(peak('p95').toFixed(3)) }, p99: { mean: Number((sum('p99') / full.length).toFixed(3)), worst: Number(peak('p99').toFixed(3)) }, max: Number(peak('max').toFixed(3)),
  drops: sum('drops'), rssMB: Math.round(peak('rss') / 1048576), heapMB: Math.round(peak('heap') / 1048576), refused: peak('refused'), dropped: peak('dropped'), frameKB: Math.round(peak('frameBytes') / 1024), eventKB: Math.round(peak('eventBytes') / 1024), last: JSON.parse(last || '{}') };
console.log(JSON.stringify(report));
process.exit(code === 0 ? 0 : 1);
