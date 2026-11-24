// Meta MACBOOK-WAITS MW5 (J504, EG-33): ordinary bots ride one staging room restart (`staging-room-restart.yml`). Each bot
// sits, walks and stands; one hurts a creature. Then the server restarts under them: each hears whatever countdown it says,
// is told why its link ended, dials again until a room seats it (the same device), and must stand where it stood (J174's
// 2 m) with the same owned lines. `welcome.player` is no identity: the first seat in a cell may read `actor.player`. The hurt creature must stand at full health again: fights reset, progress stays.
import {ANIMAL_CLASS} from '../../../src/shared/engine/net/netSchemas';
import {decodeCountdown} from '../../../src/shared/engine/net/socketFrames';
import {RoomBot, stillThumb, type BotThumb} from './roomBot';

interface Body {x: number; y: number; z: number; hp: number; player: string; handle: number; cell: number; tick: number}
interface Foe {id: string; x: number; y: number; z: number; hp: number}
export interface RestartRide {
  bot: number; seatedMs: number | null; walkedMeters: number; countdowns: {seconds: number; build: string; atMs: number}[];
  closed: string | null; closedAtMs: number | null; redials: number; backMs: number | null;
  before: Body | null; after: Body | null; movedMeters: number | null; ownedKept: boolean | null; ownedLines: number;
  fight: {id: string; fullHp: number; hurtHp: number; afterHp: number | null; reset: boolean | null} | null;
  ok: boolean; error?: string;
}
/** WR9's tolerance: a redial stands within 2 m of the last pose the bot saw. */
export const RESTART_TOLERANCE_M = 2;

const sleep = async (ms: number): Promise<void> => {await new Promise(resolve => {setTimeout(resolve, ms);});};
function body(bot: RoomBot): Body | null {
  const frame = bot.client.latest, welcome = bot.client.welcome;
  if (frame === null || welcome === null) return null;
  const row = bot.client.owner(frame);
  const value = {x: Number(row['px']), y: Number(row['py']), z: Number(row['pz']), hp: Number(row['hp'])};
  if (!Object.values(value).every(Number.isFinite)) return null;
  return {...value, player: welcome.player, handle: welcome.handle, cell: frame.cell, tick: frame.tick};
}
function foe(bot: RoomBot, at: Body, id?: string): Foe | null {
  const frame = bot.client.latest;
  if (frame === null) return null;
  let best: Foe | null = null, distance = Number.POSITIVE_INFINITY;
  for (const entity of bot.client.entities.values()) {
    if (entity.cls !== ANIMAL_CLASS || (id !== undefined && entity.id !== id)) continue;
    const row = bot.client.fields(frame, entity.handle);
    if (row === null) continue;
    const value = {id: entity.id, x: Number(row['x']), y: Number(row['y']), z: Number(row['z']), hp: Number(row['hp'])};
    if (![value.x, value.y, value.z, value.hp].every(Number.isFinite) || (id === undefined && value.hp < 40)) continue;
    const gap = Math.hypot(value.x - at.x, value.z - at.z);
    if (gap < distance) {best = value; distance = gap;}
  }
  return best;
}
const owned = (bot: RoomBot): string => JSON.stringify([...bot.client.owned.entries()].toSorted(([a], [b]) => a.localeCompare(b)));

/** One bot's ride: `seat` before the restart is asked for, `ride` through it. The caller owns the clock. */
export class RestartRider {
  readonly ride: RestartRide;
  private bot: RoomBot | null = null;
  private readonly started = performance.now();
  private ownedBefore = '';
  constructor(private readonly connect: () => RoomBot, index: number, private readonly fights: boolean) {
    this.ride = {bot: index, seatedMs: null, walkedMeters: 0, countdowns: [], closed: null, closedAtMs: null, redials: 0, backMs: null,
      before: null, after: null, movedMeters: null, ownedKept: null, ownedLines: 0, fight: null, ok: false};
  }
  private ms(): number { return Math.round(performance.now() - this.started); }
  private dial(): RoomBot {
    const bot = this.connect();
    bot.transport.onControl((control, bytes) => {
      if (control !== 'countdown') return;
      const said = decodeCountdown(bytes);
      if (said !== null) this.ride.countdowns.push({seconds: said.seconds, build: said.build, atMs: this.ms()});
    });
    return bot;
  }
  /** Seat, walk about a metre on the server's word, stand; the fighter also lands one confirmed hit. */
  async seat(timeoutMs: number): Promise<void> {
    const bot = this.dial();
    this.bot = bot;
    if (!await bot.arrived(timeoutMs)) throw new Error(`bot ${String(this.ride.bot)}: not seated (${bot.closed ?? 'no frame'})`);
    this.ride.seatedMs = this.ms();
    const start = body(bot);
    if (start === null) throw new Error('No authoritative player frame');
    const yaw = (this.ride.bot * Math.PI) / 2;
    bot.thumb = tick => ({...stillThumb(tick), yaw, steer: {keyX: 0, keyY: 1, stickX: 0, stickY: 0}});
    const walkUntil = performance.now() + 4000;
    while (performance.now() < walkUntil) {
      const at = body(bot);
      if (at !== null && Math.hypot(at.x - start.x, at.z - start.z) >= 1) break;
      await sleep(20);
    }
    bot.thumb = stillThumb;
    const walked = body(bot);
    this.ride.walkedMeters = walked === null ? 0 : Number(Math.hypot(walked.x - start.x, walked.z - start.z).toFixed(2));
    if (this.fights) await this.hurtOne(bot, 45_000);
    this.ownedBefore = owned(bot);
    this.ride.ownedLines = bot.client.owned.size;
  }
  private async hurtOne(bot: RoomBot, budgetMs: number): Promise<void> {
    const until = performance.now() + budgetMs, at0 = body(bot);
    const target = at0 === null ? null : foe(bot, at0);
    if (target === null) return;
    this.ride.fight = {id: target.id, fullHp: target.hp, hurtHp: target.hp, afterHp: null, reset: null};
    const thumb: BotThumb = tick => {
      const at = body(bot), current = at === null ? null : foe(bot, at, target.id);
      if (at === null || current === null) return stillThumb(tick);
      const dx = current.x - at.x, dz = current.z - at.z, dy = current.y + .5 - (at.y + 1.3), distance = Math.hypot(dx, dz);
      const length = Math.hypot(dx, dy, dz) || 1;
      return {viewTick: bot.client.latest?.tick ?? 0, yaw: Math.atan2(-dx, -dz), pitch: 0, buttons: 0,
        steer: {keyX: 0, keyY: distance > 1.3 ? 1 : 0, stickX: 0, stickY: 0},
        ...(tick % 24 === 0 && distance < 2.8 ? {attack: {targetId: target.id,
          aim: {origin: {x: at.x, y: at.y + 1.3, z: at.z}, direction: {x: dx / length, y: dy / length, z: dz / length}}}} : {})};
    };
    bot.thumb = thumb;
    while (performance.now() < until && bot.closed === null) {
      const at = body(bot), current = at === null ? null : foe(bot, at, target.id);
      if (current !== null && current.hp < target.hp) { this.ride.fight.hurtHp = current.hp; break; }
      await sleep(20);
    }
    bot.thumb = stillThumb;
    await sleep(500);
  }
  /** Stand until the link ends, then dial again until a room seats this device, and compare. */
  async rideThrough(deadline: number): Promise<RestartRide> {
    const first = this.bot;
    if (first === null) throw new Error('seat first');
    while (first.closed === null && performance.now() < deadline) {
      const at = body(first);
      if (at !== null) this.ride.before = at;
      await sleep(20);
    }
    if (first.closed === null) { this.ride.error = 'no restart reached this bot before the deadline'; return this.ride; }
    this.ride.closed = first.closed; this.ride.closedAtMs = this.ms();
    first.drop();
    let second: RoomBot | null = null;
    while (performance.now() < deadline) {
      this.ride.redials++;
      const next = this.dial();
      if (await next.arrived(Math.max(1, Math.min(20_000, deadline - performance.now())))) { second = next; break; }
      next.drop();
      await sleep(3000);
    }
    this.bot = second;
    if (second === null) { this.ride.error = `not seated again before the deadline (${String(this.ride.redials)} dials)`; return this.ride; }
    this.ride.backMs = this.ms();
    const settle = performance.now() + 3000;
    while (performance.now() < settle) await sleep(50);
    const after = body(second), before = this.ride.before;
    this.ride.after = after;
    if (after !== null && before !== null) this.ride.movedMeters = Number(Math.hypot(after.x - before.x, after.y - before.y, after.z - before.z).toFixed(3));
    this.ride.ownedKept = owned(second) === this.ownedBefore;
    const fight = this.ride.fight;
    if (fight !== null && after !== null) {
      const back = foe(second, after, fight.id);
      fight.afterHp = back?.hp ?? null;
      fight.reset = back === null || fight.hurtHp >= fight.fullHp ? null : back.hp > fight.hurtHp;
    }
    const problems = [
      this.ride.closed !== 'restart' ? `link ended '${this.ride.closed}', not 'restart'` : '',
      after === null || before === null ? 'no pose either side' : '',
      this.ride.movedMeters !== null && this.ride.movedMeters > RESTART_TOLERANCE_M ? `back ${String(this.ride.movedMeters)} m away` : '',
      this.ride.ownedKept === false ? 'owned lines changed' : '',
    ].filter(Boolean);
    this.ride.ok = problems.length === 0;
    if (!this.ride.ok) this.ride.error = problems.join('; ');
    return this.ride;
  }
  /** Leave the seat as the page's quit does. */
  async leave(): Promise<void> {
    const bot = this.bot;
    if (bot === null) return;
    bot.stop();
    try { if (bot.closed === null) { bot.quit(); await bot.ended(3000); } } finally { bot.drop(); }
  }
}
