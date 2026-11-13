// SERVER-CELLS (draft, opus-cellmem): one real-socket bot per cell, each deep-linked with `/?chunk=<instance>` (GO7) as a page's
// Shard select is, walking a ring where it lands. Built and run only by scripts/cell-mem-bench.mjs against its loopback replica.
//   node cellMemBots.mjs <url> <build> <cell,cell,...> <seconds> <tag> <result.json>
// Each bot says its own address from 198.18.0.0/15 (RFC 2544), as mmoBotsEntry does, so the door's per-address caps never bind.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { NET_BUTTONS } from '../../../src/shared/engine/input/netButtons';
import { PhysicsRouteCursor, type WalkPoint } from '../../../src/shared/host/headlessJourney';
import { botTarget } from './mmoBotsGuard';
import { RoomBot } from './roomBot';

const [url = '', build = '', cellsArg = '', secondsArg = '0', tag = 'cm', result = ''] = process.argv.slice(2);
const cells = cellsArg.split(',').filter(cell => /^_?[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(cell)), seconds = Number(secondsArg);
const { url: parsed } = botTarget(url, 'forwarded', cells.length);
assert.ok(cells.length > 0 && seconds >= 5 && seconds <= 3600 && /^[a-z0-9-]{1,16}$/u.test(tag) && result !== '');
const LEAVE_FLAG = 1;
const sleep = async (ms: number): Promise<void> => { await new Promise(resolve => { setTimeout(resolve, ms); }); };
function ring(index: number, x: number, z: number): WalkPoint[] {
  const radius = 5 + (index % 4) * 2, phase = index * 0.7;
  return Array.from({ length: 7 }, (_, at) => { const angle = phase + at / 6 * Math.PI * 2; return { x: x + Math.cos(angle) * radius, z: z + Math.sin(angle) * radius }; });
}
interface Walker { readonly bot: RoomBot; readonly cell: string; cursor: PhysicsRouteCursor | null; laps: number; joinedMs: number | null; rtt: number[]; started: number }
const walkers: Walker[] = [];
for (const [signal, code] of [['SIGINT', 130], ['SIGTERM', 143]] as const) {
  process.once(signal, () => {
    for (const walker of walkers) { walker.bot.stop(); if (walker.bot.closed === null) walker.bot.transport.control('ready', new Uint8Array([LEAVE_FLAG]).buffer); }
    void Promise.all(walkers.map(async walker => walker.bot.ended(5_000))).finally(() => { process.exit(code); });
  });
}
for (const [index, cell] of cells.entries()) {
  const Native = globalThis.WebSocket, headers = { 'x-forwarded-for': `198.18.${String(Math.floor(index / 250))}.${String(index % 250 + 1)}` };
  globalThis.WebSocket = class extends Native { constructor(at: string | URL) { super(at, { headers } as unknown as string[]); } };
  let bot: RoomBot;
  try { bot = new RoomBot(`${parsed.origin}/?chunk=${cell}`, build, `device:${tag}-${cell}`, `Bot ${String(index)}`); } finally { globalThis.WebSocket = Native; }
  const walker: Walker = { bot, cell, cursor: null, laps: 0, joinedMs: null, rtt: [], started: performance.now() };
  bot.client.onFrame(() => { if (walker.joinedMs === null) walker.joinedMs = Math.round(performance.now() - walker.started); });
  let tick = 0;
  bot.thumb = () => {
    const frame = bot.client.latest, owner = frame === null ? null : bot.client.owner(frame);
    const x = Number(owner?.['px']), y = Number(owner?.['py']), z = Number(owner?.['pz']);
    if (![x, y, z].every(Number.isFinite)) return { viewTick: 0, steer: { keyX: 0, keyY: 0, stickX: 0, stickY: 0 }, yaw: 0, pitch: 0, buttons: 0 };
    if (walker.cursor === null || walker.cursor.complete) { walker.laps++; walker.cursor = new PhysicsRouteCursor(ring(index + walker.laps * 3, x, z), { edge: true }); }
    const move = walker.cursor.command([x, y, z], tick++), walking = move.moveX !== 0 || move.moveZ !== 0;
    return { viewTick: 0, steer: { keyX: 0, keyY: walking ? 1 : 0, stickX: 0, stickY: 0 }, yaw: move.yaw, pitch: 0, buttons: move.jump === true ? NET_BUTTONS.jump : 0 };
  };
  walkers.push(walker);
  await sleep(150);
}
const arrived = await Promise.all(walkers.map(async walker => walker.bot.arrived(90_000)));
console.info(JSON.stringify({ at: 'cellmem.arrived', cells: cells.length, seated: arrived.filter(Boolean).length }));
const playing = performance.now();
while (performance.now() - playing < seconds * 1000) {
  await sleep(1000);
  for (const walker of walkers) { const rtt = walker.bot.transport.stats.rttMs; if (Number.isFinite(rtt) && rtt > 0) walker.rtt.push(rtt); }
}
for (const walker of walkers) { walker.bot.stop(); if (walker.bot.closed === null) walker.bot.transport.control('ready', new Uint8Array([LEAVE_FLAG]).buffer); }
await Promise.all(walkers.map(async walker => walker.bot.ended(10_000)));
const rows = walkers.map((walker, index) => {
  const sorted = walker.rtt.slice().sort((a, b) => a - b), resumed = walker.bot.resume === null ? null : (JSON.parse(walker.bot.resume) as { cell?: string }).cell ?? null;
  return { cell: walker.cell, landed: resumed, seated: arrived[index] === true, joinedMs: walker.joinedMs, dropped: walker.bot.closed, rttP50: sorted[Math.floor(sorted.length / 2)] ?? null, rttMax: sorted.at(-1) ?? null, downKB: Math.round(walker.bot.transport.stats.recvBytes / 1024) };
});
for (const walker of walkers) walker.bot.client.dispose();
const report = { cells: cells.length, seated: rows.filter(row => row.seated).length, inTheirCell: rows.filter(row => row.landed === row.cell).length, rows };
writeFileSync(result, `${JSON.stringify(report, null, 2)}\n`);
console.info(JSON.stringify({ at: 'cellmem.done', ...report, rows: undefined }));
process.exit(0);
