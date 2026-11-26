// WIRE-STABILITY WR9: one phone of the wire pair. src/scripts/wire-pair.mjs builds it from one release's own tree, so its NetClient
// and its wire minor are that release's, then runs it beside a room of the other release. It stays one device through every
// deploy the driver makes: seated and walking, it hears the J174 countdown, is told `restart`, and dials again (once a second,
// while no room listens) until a room seats it. It reports each seat: the resume the door gave, its first and last pose, the
// countdowns it heard and why the seat ended.
//   node wirePair.mjs <url> <build> <device> <address> <result.json>
// J205: loopback only, the driver's own replica. `address` is the X-Forwarded-For the door reads behind loopback (198.18.0.0/15).
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { WIRE_MINOR } from '@wildshard/wire/major';
import { decodeCountdown, type Countdown } from '../../../src/shared/engine/net/socketFrames';
import { RoomBot } from './roomBot';

const [url = '', build = '', device = '', address = '', result = ''] = process.argv.slice(2);
assert.ok(new URL(url).protocol === 'ws:' && new URL(url).hostname === '127.0.0.1', 'loopback only');
assert.ok(/^device:[a-z0-9-]{1,40}$/u.test(device) && /^198\.1[89]\.\d{1,3}\.\d{1,3}$/u.test(address) && result !== '');

interface Pose { readonly x: number; readonly y: number; readonly z: number }
interface Seat {
  readonly dialedMs: number; seatedMs: number | null; resume: unknown; first: Pose | null; last: Pose | null;
  frames: number; readonly countdowns: Countdown[]; ended: string | null; endedMs: number | null;
}
const started = performance.now(), now = (): number => Math.round(performance.now() - started);
const seats: Seat[] = [];
let stopping = false, refusedDials = 0, current: RoomBot | null = null;
const report = (): void => { writeFileSync(result, `${JSON.stringify({ device, build, minor: WIRE_MINOR, refusedDials, seats }, null, 2)}\n`); };
const sleep = async (ms: number): Promise<void> => { await new Promise(resolve => { setTimeout(resolve, ms); }); };
// The driver reads this file to know when a seat has played: once a second, as well as at every seat's start and end.
setInterval(report, 1_000);

/** `RoomBot` dials the global `WebSocket` as it is made; for that moment it says this phone's address. */
function dial(): RoomBot {
  const Native = globalThis.WebSocket;
  globalThis.WebSocket = class extends Native { constructor(at: string | URL) { super(at, { headers: { 'x-forwarded-for': address } } as unknown as string[]); } };
  try { return new RoomBot(url, build, device, `Pair ${device.slice(7)}`); } finally { globalThis.WebSocket = Native; }
}

/** Told to stop: leave the seat (the door's leave flag), write the report, go. */
for (const [signal, code] of [['SIGINT', 130], ['SIGTERM', 0]] as const) {
  process.once(signal, () => {
    stopping = true;
    const bot = current;
    if (bot !== null && bot.closed === null) { bot.stop(); bot.quit(); }
    void (bot === null ? Promise.resolve(null) : bot.ended(5_000)).finally(() => { report(); process.exit(code); });
  });
}

while (!stopping) {
  const seat: Seat = { dialedMs: now(), seatedMs: null, resume: null, first: null, last: null, frames: 0, countdowns: [], ended: null, endedMs: null };
  const bot = dial();
  current = bot;
  let tick = 0;
  // A slow circle, so every seat ends somewhere other than where it began, and the next seat's resume can be checked against it.
  bot.thumb = () => ({ viewTick: 0, steer: { keyX: 0, keyY: 1, stickX: 0, stickY: 0 }, yaw: (tick++ / 240) % (Math.PI * 2), pitch: 0, buttons: 0 });
  bot.transport.onControl((control, bytes) => {
    if (control !== 'countdown') return;
    const said = decodeCountdown(bytes);
    if (said !== null && seat.countdowns.at(-1)?.build !== said.build) seat.countdowns.push(said);
  });
  bot.client.onFrame(frame => {
    const owner = bot.client.owner(frame), pose = { x: Number(owner['px']), y: Number(owner['py']), z: Number(owner['pz']) };
    if (![pose.x, pose.y, pose.z].every(Number.isFinite)) return;
    seat.frames++; seat.seatedMs ??= now(); seat.first ??= pose; seat.last = pose;
  });
  if (!(await bot.arrived(15_000))) {
    // No room listens yet (the deploy's gap), or the door said no: dial again shortly.
    if (bot.closed !== null && bot.closed !== 'lost') { seat.ended = bot.closed; seat.endedMs = now(); seats.push(seat); report(); }
    else refusedDials++;
    bot.drop();
    if (!stopping) await sleep(1_000);
    continue;
  }
  try { seat.resume = JSON.parse(bot.resume ?? 'null'); } catch { seat.resume = bot.resume; }
  seats.push(seat); report();
  while (!stopping && bot.closed === null) await bot.ended(60_000);
  seat.ended = bot.closed; seat.endedMs = now(); report();
  bot.drop();
}
