// J201, Ring 2: compiled production server, full Nalati pack, two real sockets.
// Manual only: build-server --entry herdSoak=test/fixtures/dedicated/herdSoakEntry.ts.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { generateKeyPairSync, sign } from 'node:crypto';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { availableParallelism } from 'node:os';
import { pathToFileURL } from 'node:url';
import * as v from 'valibot';
import { ANIMAL_CLASS } from '../../../src/shared/engine/net/netSchemas';
import { NET_BUTTONS } from '../../../src/shared/engine/input/netButtons';
import { RoomBot } from './roomBot';

const [origin = 'file:///origin/', work = '/work', build = 'dev', secondsArg = '1800'] = process.argv.slice(2);
const seconds = Number(secondsArg);
assert.ok(Number.isFinite(seconds) && seconds >= 20 && seconds <= 1800);
mkdirSync(work, { recursive: true });
const log = join(work, 'server.jsonl'), result = join(work, 'result.json');
const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const body = JSON.stringify({ channel: 'production', serial: 1, engineBuild: build, saveEpoch: 1, shards: [{ slug: 'nalati-grasslands', revision: 1 }] });
const release = join(work, 'release.json');
writeFileSync(release, JSON.stringify({ body, signature: sign(null, Buffer.from(body), privateKey).toString('hex') }));
const workerSchema = v.object({ at: v.literal('worker'), players: v.number(), ticks: v.number(), ticksPerSecond: v.number(), p95: v.number(), max: v.number(), drops: v.number(), rss: v.number(), heap: v.number() });
type Reading = v.InferOutput<typeof workerSchema>;
interface Horse { readonly id: string; readonly dx: number; readonly dz: number; readonly range: number; readonly x: number; readonly z: number }
interface Guest { readonly bot: RoomBot; samples: number; near: number; farthest: number; readonly horses: Map<string, readonly [number, number]>; moving: boolean }
let started = 0, buffer = '', ready = false;
const readings: Reading[] = [];
const room = spawn(process.execPath, [join(import.meta.dirname, 'main.mjs')], {
  env: { ...process.env, PACK_ORIGIN: origin, PACK_CACHE: join(work, 'cache'), DATABASE_URL: 'memory:', SEAT_SECRET: 'j201-local-proof', HOST: '127.0.0.1', PORT: '18790', WILDSHARD_BUILD: build,
    WORLD_CELLS: 'nalati-grasslands', WORLD_WORKERS: '1', WORLD_SEATS: '2', RELEASE_URL: pathToFileURL(release).href, RELEASE_PUBLIC_KEY: publicKey.export({ type: 'spki', format: 'der' }).toString('hex') },
  stdio: ['ignore', 'pipe', 'pipe'],
});
room.stdout.on('data', (chunk: Buffer) => {
  appendFileSync(log, chunk); buffer += chunk.toString();
  for (;;) {
    const end = buffer.indexOf('\n'); if (end < 0) break;
    const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
    try {
      const row: unknown = JSON.parse(line), parsed = v.safeParse(workerSchema, row);
      if (parsed.success) { ready = true; if (started > 0 && performance.now() - started >= 10_100) readings.push(parsed.output); }
    } catch { /* A non-JSON diagnostic is retained in the server log. */ }
  }
});
room.stderr.on('data', (chunk: Buffer) => { appendFileSync(log, chunk); });
const sleep = async (ms: number): Promise<void> => { await new Promise(resolve => { setTimeout(resolve, ms); }); };
const horses = (bot: RoomBot): Horse[] => {
  const frame = bot.client.latest, owner = frame === null ? null : bot.client.owner(frame);
  if (frame === null || owner === null) return [];
  const x = Number(owner['px']), z = Number(owner['pz']), found: Horse[] = [];
  for (const entity of bot.client.entities.values()) {
    if (entity.cls !== ANIMAL_CLASS || entity.initial['kind'] !== 'horse') continue;
    const row = bot.client.fields(frame, entity.handle); if (row?.['alive'] !== true) continue;
    const hx = Number(row['x']), hz = Number(row['z']), dx = hx - x, dz = hz - z, range = Math.hypot(dx, dz);
    if (Number.isFinite(range)) found.push({ id: entity.id, dx, dz, range, x: hx, z: hz });
  }
  return found.sort((a, b) => a.range - b.range);
};
const guests: Guest[] = [];
try {
  const boot = performance.now();
  while (!ready && room.exitCode === null && performance.now() - boot < 60_000) await sleep(100);
  assert.ok(ready && room.exitCode === null, 'production cell boots and emits its real worker reading');
  for (let index = 0; index < 2; index++) {
    const bot = new RoomBot('ws://127.0.0.1:18790/', build, `device:j201-${String(index)}`, `Herd ${String(index)}`);
    bot.thumb = tick => {
      const horse = horses(bot)[0], walking = horse !== undefined && horse.range > 10;
      return { viewTick: 0, steer: { keyX: 0, keyY: walking ? 1 : 0, stickX: 0, stickY: 0 }, yaw: horse === undefined ? 0 : Math.atan2(-horse.dx, -horse.dz), pitch: 0,
        buttons: (walking && horse.range > 14 ? NET_BUTTONS.sprint : 0) | (walking && tick % 181 === 0 ? NET_BUTTONS.jump : 0) };
    };
    guests.push({ bot, samples: 0, near: 0, farthest: 0, horses: new Map(), moving: false });
  }
  assert.ok((await Promise.all(guests.map(guest => guest.bot.arrived(30_000)))).every(Boolean), 'both real sockets arrive');
  const warm = performance.now();
  while (guests.some(guest => (horses(guest.bot)[0]?.range ?? Infinity) > 20) && performance.now() - warm < 120_000) {
    assert.ok(guests.every(guest => guest.bot.closed === null), 'neither client disconnects during the approach');
    await sleep(1000);
    console.info(JSON.stringify({ at: 'herd.approach', ranges: guests.map(guest => horses(guest.bot)[0]?.range ?? null) }));
  }
  assert.ok(guests.every(guest => (horses(guest.bot)[0]?.range ?? Infinity) <= 20), 'ordinary walking reaches living horses');
  started = performance.now();
  console.info(JSON.stringify({ at: 'herd.started', seconds, ranges: guests.map(guest => horses(guest.bot)[0]?.range) }));
  // Include another reading interval so the retained full windows cover the
  // requested duration even when the clients reach the herd between readings.
  while (performance.now() - started < seconds * 1000 + 10_100) {
    await sleep(1000);
    for (const guest of guests) {
      assert.equal(guest.bot.closed, null, 'socket stays connected');
      const seen = horses(guest.bot), nearest = seen[0];
      guest.samples++; if (nearest !== undefined && nearest.range <= 20) guest.near++;
      guest.farthest = Math.max(guest.farthest, nearest?.range ?? Infinity);
      for (const horse of seen) {
        const initial = guest.horses.get(horse.id);
        if (initial === undefined) guest.horses.set(horse.id, [horse.x, horse.z]);
        else if (Math.hypot(horse.x - initial[0], horse.z - initial[1]) > 1) guest.moving = true;
      }
    }
    if (guests[0] !== undefined && guests[0].samples % 60 === 0) console.info(JSON.stringify({ at: 'herd.minute', seconds: Math.round((performance.now() - started) / 1000), near: guests.map(guest => `${String(guest.near)}/${String(guest.samples)}`), windows: readings.length, worstP95: Math.max(...readings.map(row => row.p95)), drops: readings.reduce((sum, row) => sum + row.drops, 0), minTicksPerSecond: Math.min(...readings.map(row => row.ticksPerSecond)) }));
  }
  const report = { proof: 'j201-linux-server-herd', build, seconds, elapsed: (performance.now() - started) / 1000, platform: process.platform, arch: process.arch, node: process.version, availableCpus: availableParallelism(),
    windows: readings.length, worstP95: Math.max(...readings.map(row => row.p95)), meanP95: readings.reduce((sum, row) => sum + row.p95, 0) / readings.length,
    ticksPerSecond: { min: Math.min(...readings.map(row => row.ticksPerSecond)), max: Math.max(...readings.map(row => row.ticksPerSecond)) }, drops: readings.reduce((sum, row) => sum + row.drops, 0), rssMB: Math.max(...readings.map(row => row.rss)) / 1048576,
    guests: guests.map(guest => ({ samples: guest.samples, near: guest.near, farthest: guest.farthest, moving: guest.moving, horsesSeen: guest.horses.size, recvBytes: guest.bot.transport.stats.recvBytes, droppedFrames: guest.bot.client.dropped })) };
  writeFileSync(result, JSON.stringify(report, null, 2)); console.info(JSON.stringify(report));
  assert.ok(readings.length >= Math.max(1, Math.floor(seconds / 10)), 'full ten-second windows cover the requested soak duration');
  assert.ok(readings.every(row => row.players === 2), 'every measured window has both real players');
  assert.ok(guests.every(guest => guest.near >= guest.samples * 0.8 && guest.moving), 'both players stay beside living, moving horses');
  assert.ok(report.worstP95 <= 10, `named J201 tick budget: worst worker-window p95 ${String(report.worstP95)} ms exceeds 10 ms`);
  assert.equal(report.drops, 0, 'no backlog drops');
} finally {
  for (const guest of guests) guest.bot.drop();
  const ended = new Promise(resolve => { room.once('exit', resolve); });
  if (room.exitCode === null && room.signalCode === null) {
    let forced = false;
    room.kill('SIGTERM');
    const deadline = setTimeout(() => { forced = true; room.kill('SIGKILL'); }, 10_000);
    try { await ended; } finally { clearTimeout(deadline); }
    assert.ok(!forced, 'production server must drain within ten seconds');
  }
}
