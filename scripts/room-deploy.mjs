#!/usr/bin/env node
// E7.2c, E7.4b: a deploy under bots, as the VPS runs one, with this script in systemd's seat: `pull.mjs`, then `main.mjs`, and again when it exits. The release file is signed
// by a key made for this run, and it and the bundles come from a local origin. It starts nothing it does not stop, and it opens no port past loopback.
//   node room-deploy.mjs <old tar> <old build> <new tar> <new build> <pack origin> <work dir> <deployBot.mjs> <database url>
// Three moves, with two bots playing: a bad hash, which must leave everyone on the old bundle; `systemctl restart`, which must come back on it from the file it kept; a good release.
import { spawn } from 'node:child_process';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { basename, join, resolve as absolute } from 'node:path';

const [oldTar = '', oldBuild = '', newTar = '', newBuild = '', packOrigin = '', work = '', deployBot = '', database = ''] = process.argv.slice(2), PULL = absolute(import.meta.dirname, 'vps/pull.mjs');
const log = join(work, 'deploy.log'), PORT = 18795, GRACE_MS = 3000, RESTART_MS = 2000, PLAY_MS = 3000, READING_MS = 12_000, RECORD_MS = 1000, STEP_MS = 60_000, { publicKey, privateKey } = generateKeyPairSync('ed25519');
/** @type {string[]} */
const lines = [];
mkdirSync(work, { recursive: true });
/** @param {string} tar */
const describe = tar => { const bytes = readFileSync(tar); return { name: basename(tar), sha256: createHash('sha256').update(bytes).digest('hex') }; };
const files = new Map([oldTar, newTar].map(tar => [`/${basename(tar)}`, tar]));
let releaseText = '';
/** @type {{ kind?: string, build?: string, players?: number, ticks?: number }[]} */
const records = [];
/** @type {{ message?: string, fatal?: boolean, context?: { build?: string } }[]} */
const errors = [];
const origin = createServer((request, response) => {
  if (request.url === '/release.json') { response.end(releaseText); return; }
  if (request.method === 'POST') {
    let body = '';
    request.on('data', chunk => { body += String(chunk); });
    request.on('end', () => { (request.url === '/telemetry' ? records : errors).push(JSON.parse(body)); response.end(); });
    return;
  }
  const tar = files.get(request.url ?? '');
  if (tar === undefined) response.writeHead(404).end(); else response.end(readFileSync(tar));
});
await new Promise(resolve => { origin.listen(0, '127.0.0.1', () => { resolve(null); }); });
const address = origin.address(), at = `http://127.0.0.1:${typeof address === 'object' && address !== null ? address.port : 0}`;
/**
 * @param {number} serial
 * @param {string} engineBuild
 * @param {{ name: string, sha256: string }} bundle
 */
const publish = (serial, engineBuild, bundle) => {
  const body = JSON.stringify({ channel: 'production', serial, engineBuild, saveEpoch: 1, shards: [{ slug: 'driftwood-isle', revision: 1 }], bundle });
  releaseText = JSON.stringify({ body, signature: sign(null, Buffer.from(body), privateKey).toString('hex') });
};
const env = { ...process.env, RELEASE_URL: `${at}/release.json`, RELEASE_PUBLIC_KEY: publicKey.export({ type: 'spki', format: 'der' }).toString('hex'), BUNDLE_ORIGIN: at, WILDSHARD_HOME: join(work, 'home'), PULL_SCRIPT: PULL,
  PACK_ORIGIN: packOrigin, PACK_CACHE: join(work, 'packs'), DATABASE_URL: database, SEAT_SECRET: 'deploy-proof', HOST: '127.0.0.1', PORT: String(PORT), WORLD_CELLS: 'driftwood-isle', RELEASE_POLL_MS: '500', GRACE_MS: String(GRACE_MS),
  TELEMETRY_URL: `${at}/telemetry`, ERRORS_URL: `${at}/errors`, RECORD_MS: String(RECORD_MS), RECORD_TAG: 'deploy-proof' };
/** @param {unknown} chunk */
const heard = chunk => { for (const line of String(chunk).trim().split('\n')) { lines.push(line); appendFileSync(log, `${line}\n`); } };
/** @param {string[]} args What `node` runs, with its lines heard. */
const started = args => { const child = spawn(process.execPath, args, { env, stdio: ['ignore', 'pipe', 'pipe'] }); child.stdout.on('data', heard); child.stderr.on('data', heard); return child; };
/** @param {import('node:child_process').ChildProcess} child */
const ended = child => new Promise(resolve => { child.on('exit', resolve); });

/** @type {{ server: import('node:child_process').ChildProcess | null, stopping: boolean }} */
const state = { server: null, stopping: false };
const stopServer = () => { state.server?.kill('SIGTERM'); };
/** @type {unknown[]} */
const exits = [];
const supervise = async () => {
  while (!state.stopping) {
    const pulled = await ended(started([PULL]));
    if (pulled !== 0) throw new Error('The pull stopped the service');
    const child = started([join(work, 'home/current/main.mjs')]);
    state.server = child;
    exits.push(await ended(child));
    if (!state.stopping) await new Promise(resolve => { setTimeout(resolve, RESTART_MS); });
  }
};
const health = async () => { try { const response = await fetch(`http://127.0.0.1:${PORT}/health`); return response.ok ? await response.json() : null; } catch { return null; } };
/**
 * @param {string} what
 * @param {() => unknown} check
 */
const until = async (what, check) => {
  const began = performance.now();
  while (performance.now() - began < STEP_MS) { if (await check()) return; await new Promise(resolve => { setTimeout(resolve, 50); }); }
  throw new Error(`Timed out on ${what}\n${lines.slice(-8).join('\n').slice(0, 1600)}`);
};
/** @param {string} text */
const said = text => lines.some(line => line.includes(text));
/** @param {string} build */
const playing = async build => { const now = await health(); return now?.build === build && now.players === 2; };
/** @param {string} text */
const counted = text => lines.filter(line => line.includes(text)).length;

const bad = { ...describe(newTar), sha256: describe(oldTar).sha256 };
publish(1, oldBuild, describe(oldTar));
const running = supervise();
await until('the first boot', () => health());
const bots = spawn(process.execPath, [deployBot, `ws://127.0.0.1:${PORT}`, '120'], { stdio: ['ignore', 'pipe', 'inherit'] });
/** @type {{ off: number | null, ms: number }[]} */
const back = [];
/** @type {{ metres: number }[]} */
const walks = [];
bots.stdout.on('data', chunk => { for (const line of String(chunk).trim().split('\n')) { const row = JSON.parse(line); (row.at === 'walked' ? walks : back).push(row); } });
await until('two bots on the old bundle', () => playing(oldBuild));
await new Promise(resolve => { setTimeout(resolve, PLAY_MS); });

publish(2, newBuild, bad);
await until('the bad hash', () => said('bad hash'));
const afterBad = await health(), graced = said('"at":"grace"');

const killed = performance.now();
stopServer();
await until('the restart', async () => back.length >= 2 && await playing(oldBuild));
const kept = lines.some(line => { try { const row = JSON.parse(line); return row.at === 'release.installed' && row.serial === 1 && row.newest === 2; } catch { return false; } }), restartMs = Math.round(performance.now() - killed), restarted = back.splice(0);

// The 10 s reading has to land before a minute's record has anything to say.
await new Promise(resolve => { setTimeout(resolve, READING_MS); });
publish(3, newBuild, describe(newTar));
const flipped = performance.now();
await until('the deploy', async () => back.length >= 2 && await playing(newBuild));
const deployMs = Math.round(performance.now() - flipped), deployed = back.splice(0), now = await health(), drained = lines.filter(line => line.includes('server.drained')).map(line => JSON.parse(line));

state.stopping = true; bots.kill(); stopServer();
await running;
// A worker that can't read its packs: the process ends, and the crash has to get out first.
const crash = spawn(process.execPath, [join(work, 'home/current/main.mjs')], { env: { ...env, PACK_ORIGIN: `file://${join(work, 'no-packs')}/`, PACK_CACHE: join(work, 'no-cache') }, stdio: 'ignore' }), crashCode = await ended(crash);
origin.closeAllConnections(); origin.close();
const report = { afterBad: { build: afterBad?.build, players: afterBad?.players, graced }, restart: { ms: restartMs, kept, back: restarted }, deploy: { ms: deployMs, graceMs: GRACE_MS, restartDelayMs: RESTART_MS, back: deployed, build: now?.build, serial: now?.serial },
  saves: drained.at(-1)?.saves, saveFailures: counted('save.failed'), walks, exits, records: records.length, record: records[0], crashCode, errors: errors.map(row => ({ build: row.context?.build, fatal: row.fatal, message: row.message?.slice(0, 80) })) };
console.log(JSON.stringify(report, null, 1));
// A stand kept proves nothing unless the bots had really left the place they started.
const passed = afterBad?.build === oldBuild && afterBad.players === 2 && !graced && kept && now?.build === newBuild && report.saveFailures === 0 && [...restarted, ...deployed].every(row => row.off !== null && row.off < 2) && walks.length >= 4 && walks.every(row => row.metres > 3)
  && records.some(row => row.kind === 'room' && row.players === 2 && (row.ticks ?? 0) > 0) && crashCode === 1 && errors.some(row => row.fatal === true && row.context?.build === newBuild);
console.log(passed ? 'PASS' : 'FAIL');
process.exit(passed ? 0 : 1);
