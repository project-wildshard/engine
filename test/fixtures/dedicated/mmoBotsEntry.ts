// MMO-PLAN MP0.4: real-socket bots. Each is a phone's network end (`RoomBot`: `hello`, `resume`, `ready`, commands at 60 Hz) whose
// thumb is `headlessJourney`'s `PhysicsRouteCursor`, walking a ring around where it arrived and steering from the feet the server
// sends back. It reports what `net-bots`' DirectLoopback room reports (seated, moved, others seen, bytes down) for a real socket.
// Built by scripts/mmo-bots.mjs from the release's own commit, so its build and wire match the server's; run only by that script.
//   node mmoBots.mjs <url> <build> <bots> <seconds> <tag> <result.json> [own|forwarded]
// J205: agents never join production. The URL must be loopback or the staging socket; the script checks first, and so does this.
// The door allows 4 sockets and 10 connects a minute per address, and behind loopback it reads the proxy's X-Forwarded-For. On a
// loopback replica, `forwarded` gives each bot its own address from 198.18.0.0/15 (RFC 2544's benchmarking range), as 32 phones
// would have. Never through Funnel: staging's bots use the Mac's one address, so at most 4 join it.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { NET_BUTTONS } from '../../../src/shared/engine/input/netButtons';
import { PLAYER_CLASS } from '../../../src/shared/engine/net/netSchemas';
import { PhysicsRouteCursor, type WalkPoint } from '../../../src/shared/host/headlessJourney';
import { botTarget } from './mmoBotsGuard';
import { interArrival } from './mmoBotsStats';
import { RoomBot } from './roomBot';

const [url = '', build = '', botsArg = '0', secondsArg = '0', tag = 'mp0', result = '', addresses = 'own'] = process.argv.slice(2);
const bots = Number(botsArg), seconds = Number(secondsArg), { url: parsed, loopback } = botTarget(url, addresses, bots);
assert.ok(seconds >= 5 && seconds <= 3600 && /^[a-z0-9-]{1,16}$/u.test(tag) && result !== '');
/** The door's leave: `ready` with this flag lets a seat go now rather than holding the body 30 s (J114). */
const LEAVE_FLAG = 1;
const sleep = async (ms: number): Promise<void> => { await new Promise(resolve => { setTimeout(resolve, ms); }); };

interface Walker {
  readonly bot: RoomBot; readonly index: number; cursor: PhysicsRouteCursor | null; last: [number, number] | null;
  frames: number; frameAt: number | null; readonly gaps: number[]; moved: number; laps: number; visitedBefore: number; seenMax: number; seenSamples: number; samples: number; stuck: number; joinedMs: number | null; reason: string | null;
}
/** A ring of six points around where the bot stands, its radius and phase by its number, so the bots spread out. */
function ring(index: number, x: number, z: number): WalkPoint[] {
  const radius = 5 + (index % 4) * 2, phase = index * 0.7;
  return Array.from({ length: 7 }, (_, at) => { const angle = phase + at / 6 * Math.PI * 2; return { x: x + Math.cos(angle) * radius, z: z + Math.sin(angle) * radius }; });
}
/** Other players this bot's last frame shows, wherever they are. */
function othersSeen(walker: Walker): number {
  const frame = walker.bot.client.latest; if (frame === null) return 0;
  let seen = 0;
  for (const entity of walker.bot.client.entities.values()) if (entity.cls === PLAYER_CLASS && frame.rows.has(entity.handle)) seen++;
  return seen;
}

/** MS7: Caddy in front of rooms-staging seats a socket only from an allowed page Origin (MS6); a loopback replica doesn't ask. */
const STAGING_PAGE = 'https://staging.wildshard.io';
/** `RoomBot` dials the global `WebSocket` as it is made; for that moment it is one that says this bot's address and, off loopback,
 *  the staging page's Origin. */
function withAddress<T>(index: number, make: () => T): T {
  const headers: Record<string, string> = {};
  if (addresses === 'forwarded') headers['x-forwarded-for'] = `198.18.${String(Math.floor(index / 250))}.${String(index % 250 + 1)}`;
  if (!loopback) headers['origin'] = STAGING_PAGE;
  if (Object.keys(headers).length === 0) return make();
  const Native = globalThis.WebSocket;
  globalThis.WebSocket = class extends Native { constructor(at: string | URL) { super(at, { headers } as unknown as string[]); } };
  try { return make(); } finally { globalThis.WebSocket = Native; }
}
const walkers: Walker[] = [], started = performance.now();
// Told to stop (the driver's Ctrl-C, or a kill): every bot leaves its seat at once, then the process goes.
for (const [signal, code] of [['SIGINT', 130], ['SIGHUP', 129], ['SIGTERM', 143]] as const) {
  process.once(signal, () => {
    for (const walker of walkers) { walker.bot.stop(); if (walker.bot.closed === null) walker.bot.transport.control('ready', new Uint8Array([LEAVE_FLAG]).buffer); }
    void Promise.all(walkers.map(async walker => walker.bot.ended(5_000))).finally(() => { process.exit(code); });
  });
}
let playingFrom: number | null = null, playingTo: number | null = null;
for (let index = 0; index < bots; index++) {
  const bot = withAddress(index, () => new RoomBot(url, build, `device:${tag}-${String(index)}`, `Bot ${tag} ${String(index)}`)), walker: Walker = { bot, index, cursor: null, last: null, frames: 0, frameAt: null, gaps: [], moved: 0, laps: 0, visitedBefore: 0, seenMax: 0, seenSamples: 0, samples: 0, stuck: 0, joinedMs: null, reason: null };
  bot.client.onFrame(() => {
    const now = performance.now();
    walker.frames++; if (walker.joinedMs === null) walker.joinedMs = Math.round(now - started);
    // NL3: inter-arrival over the play window only (the join's own burst is not the wire's rhythm)
    if (playingFrom !== null && playingTo === null && walker.frameAt !== null && walker.frameAt >= playingFrom) walker.gaps.push(now - walker.frameAt);
    walker.frameAt = now;
  });
  let tick = 0;
  bot.thumb = () => {
    const frame = bot.client.latest, owner = frame === null ? null : bot.client.owner(frame);
    const x = Number(owner?.['px']), y = Number(owner?.['py']), z = Number(owner?.['pz']);
    if (![x, y, z].every(Number.isFinite)) return { viewTick: 0, steer: { keyX: 0, keyY: 0, stickX: 0, stickY: 0 }, yaw: 0, pitch: 0, buttons: 0 };
    // `edge` moves on from a waypoint a wall holds (72 ticks without progress) rather than pushing at it; a finished ring
    // starts another around where the bot now stands, so it keeps walking for the whole run.
    if (walker.cursor === null || walker.cursor.complete) { walker.laps++; walker.visitedBefore += walker.cursor?.visited ?? 0; walker.cursor = new PhysicsRouteCursor(ring(index + walker.laps * 3, x, z), { edge: true }); }
    const move = walker.cursor.command([x, y, z], tick++), walking = move.moveX !== 0 || move.moveZ !== 0;
    return { viewTick: 0, steer: { keyX: 0, keyY: walking ? 1 : 0, stickX: 0, stickY: 0 }, yaw: move.yaw, pitch: 0, buttons: move.jump === true ? NET_BUTTONS.jump : 0 };
  };
  walkers.push(walker);
  // Staggered, as people arrive: a herd of hellos in one millisecond is not a thing phones do.
  await sleep(150);
}
const arrived = await Promise.all(walkers.map(async walker => walker.bot.arrived(60_000)));
console.info(JSON.stringify({ at: 'bots.arrived', bots, seated: arrived.filter(Boolean).length, refused: walkers.filter(walker => walker.bot.closed !== null).map(walker => walker.bot.closed) }));
const playing = performance.now();
playingFrom = playing;
while (performance.now() - playing < seconds * 1000) {
  await sleep(1000);
  for (const walker of walkers) {
    const frame = walker.bot.client.latest, owner = frame === null ? null : walker.bot.client.owner(frame);
    const x = Number(owner?.['px']), z = Number(owner?.['pz']);
    if (Number.isFinite(x) && Number.isFinite(z)) { if (walker.last !== null) walker.moved += Math.hypot(x - walker.last[0], z - walker.last[1]); walker.last = [x, z]; }
    const seen = othersSeen(walker); walker.samples++; walker.seenMax = Math.max(walker.seenMax, seen); if (seen >= bots - 1) walker.seenSamples++;
  }
  const elapsed = Math.round((performance.now() - playing) / 1000);
  if (elapsed % 15 === 0) console.info(JSON.stringify({ at: 'bots.beat', elapsed, open: walkers.filter(walker => walker.bot.closed === null).length, moved: Math.round(walkers.reduce((sum, walker) => sum + walker.moved, 0)) }));
}
playingTo = performance.now(); // the leave's own frames are not the wire's rhythm
// Leave as a page does, so no held body keeps a seat after the run.
for (const walker of walkers) { walker.reason = walker.bot.closed; walker.bot.stop(); if (walker.bot.closed === null) walker.bot.transport.control('ready', new Uint8Array([LEAVE_FLAG]).buffer); }
const left = await Promise.all(walkers.map(async walker => walker.bot.ended(10_000)));
const rows = walkers.map((walker, index) => ({
  bot: walker.index, seated: arrived[index] === true, joinedMs: walker.joinedMs, droppedDuringPlay: walker.reason, left: left[index] ?? null,
  frames: walker.frames, moved: Math.round(walker.moved * 10) / 10, visited: walker.visitedBefore + (walker.cursor?.visited ?? 0), laps: walker.laps,
  othersSeenMax: walker.seenMax, allOthersShare: walker.samples === 0 ? 0 : Math.round(walker.seenSamples / walker.samples * 100) / 100,
  downKB: Math.round(walker.bot.transport.stats.recvBytes / 1024), upKB: Math.round(walker.bot.transport.stats.sentBytes / 1024), rttMs: Math.round(walker.bot.transport.stats.rttMs),
  droppedFrames: walker.bot.client.dropped, skippedCommands: walker.bot.transport.skippedCommands, interArrival: interArrival(walker.gaps),
}));
for (const walker of walkers) walker.bot.client.dispose();
const seated = rows.filter(row => row.seated).length, steady = rows.filter(row => row.seated && row.droppedDuringPlay === null).length;
const report = {
  proof: 'mp0.4-real-socket-bots', url: parsed.origin, addresses, build, bots, seconds, tag, platform: process.platform, node: process.version,
  seated, steady, walked: rows.filter(row => row.moved >= 5).length, sawEveryone: rows.filter(row => row.othersSeenMax >= bots - 1).length,
  movedMean: Math.round(rows.reduce((sum, row) => sum + row.moved, 0) / bots), downKBps: Math.round(rows.reduce((sum, row) => sum + row.downKB, 0) / bots / (seconds + 5) * 10) / 10,
  rttMsMax: Math.max(...rows.map(row => row.rttMs)), interArrivalMs: interArrival(walkers.flatMap(walker => walker.gaps)), droppedFrames: rows.reduce((sum, row) => sum + row.droppedFrames, 0), left: rows.filter(row => row.left !== null).length, rows,
};
writeFileSync(result, `${JSON.stringify(report, null, 2)}\n`);
console.info(JSON.stringify({ ...report, rows: undefined }));
process.exit(seated === bots && steady === bots && report.walked === bots && report.sawEveryone === bots ? 0 : 1);
