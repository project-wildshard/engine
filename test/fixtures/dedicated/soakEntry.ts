import type { DecodedFrame } from '../../../src/shared/engine/net/frame';
import { NET_BUTTONS } from '../../../src/shared/engine/input/netButtons';
import { ANIMAL_CLASS } from '../../../src/shared/engine/net/netSchemas';
import { RoomBot, type BotThumb } from './roomBot';

// E7.3e: E7.5's two phones on real sockets: each walks, jumps, dodges and sprints, goes to the nearest creature it can see, and fights it. It prints a line a
// minute and a last one, and the server's own lines say what the room felt. `scripts/room-soak.mjs` runs it.
const [base = 'ws://127.0.0.1:8790', build = 'dev', secondsArg = '60'] = process.argv.slice(2), seconds = Number(secondsArg), NEAR = 3, FIGHT_RANGE = 24;
interface Heard { hits: number; deaths: number; fighting: number }
function phone(index: number, heard: Heard): RoomBot {
  const bot = new RoomBot(`${base}/`, build, `device:soak-${String(index)}`, `Soak ${String(index)}`);
  bot.client.onCombat(event => { if (event.kind === 'hit') heard.hits++; else if (event.kind === 'died') heard.deaths++; });
  const nearest = (frame: DecodedFrame, x: number, z: number): { id: string; dx: number; dz: number; range: number } | null => {
    let best: { id: string; dx: number; dz: number; range: number } | null = null, near = 0;
    for (const entity of bot.client.entities.values()) {
      if (entity.cls !== ANIMAL_CLASS) continue;
      const row = bot.client.fields(frame, entity.handle);
      if (row === null) continue;
      const dx = Number(row['x']) - x, dz = Number(row['z']) - z, range = Math.hypot(dx, dz);
      if (!Number.isFinite(range)) continue;
      if (range < FIGHT_RANGE) near++;
      if (best === null || range < best.range) best = { id: entity.id, dx, dz, range };
    }
    heard.fighting = Math.max(heard.fighting, near);
    return best;
  };
  const thumb: BotThumb = tick => {
    const frame = bot.client.latest, owner = frame === null ? null : bot.client.owner(frame), x = Number(owner?.['px'] ?? 0), z = Number(owner?.['pz'] ?? 0);
    const prey = frame === null ? null : nearest(frame, x, z), phase = (tick + index * 53) % 600;
    // a third of the time it just goes for a walk, so a stuck bot gets loose and the journey covers ground
    const wander = phase < 200, yaw = wander || prey === null ? index * 2.1 + tick / 170 : Math.atan2(-prey.dx, -prey.dz), close = !wander && prey !== null && prey.range < NEAR;
    const buttons = (close ? 0 : NET_BUTTONS.sprint) | (tick % 211 === 40 ? NET_BUTTONS.jump : 0) | (tick % 307 === 130 ? NET_BUTTONS.dodge : 0);
    return { viewTick: 0, steer: { keyX: 0, keyY: close ? 0 : 1, stickX: 0, stickY: 0 }, yaw, pitch: 0, buttons,
      ...(close && tick % 20 === 0 && prey !== null ? { attack: { targetId: prey.id, aim: { origin: { x: 0, y: 0, z: 0 }, direction: { x: 0, y: 0, z: -1 } } } } : {}) };
  };
  bot.thumb = thumb;
  return bot;
}
const heard: Heard = { hits: 0, deaths: 0, fighting: 0 }, bots = [phone(0, heard), phone(1, heard)], started = performance.now();
const arrived = await Promise.all(bots.map(bot => bot.arrived(60_000)));
if (!arrived.every(Boolean)) { console.error(JSON.stringify({ at: 'soak.refused', closed: bots.map(bot => bot.closed) })); process.exit(1); }
const line = (at: string): void => {
  console.info(JSON.stringify({ at, seconds: Math.round((performance.now() - started) / 1000), ...heard, closed: bots.map(bot => bot.closed), rtt: bots.map(bot => Number(bot.transport.stats.rttMs.toFixed(2))), recv: bots.map(bot => bot.transport.stats.recvBytes), dropped: bots.map(bot => bot.client.dropped) }));
};
const minute = setInterval(() => { line('soak.minute'); }, 60_000);
await new Promise(resolve => { setTimeout(resolve, seconds * 1000); });
clearInterval(minute);
line('soak.end');
for (const bot of bots) bot.drop();
process.exit(0);
