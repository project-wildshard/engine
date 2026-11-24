// Meta MACBOOK-WAITS MW5 (J504, EG-33; Jake 2026-11-24 "Bots ride the next release"): ordinary bots sit on staging for hours
// and ride the next staging release's J174 grace. A drop, or a unit restart with no countdown, only seats the bot again; the
// ride that counts is the link that heard a countdown and was then told `restart`. The fighter hurts a creature inside the
// countdown, so the fight is fresh when the room restarts, and must find it at full health again: fights reset, progress stays.
import {RestartRider, type RestartRide} from './restartJourney';
import type {RoomBot} from './roomBot';

export interface ReleaseRide extends RestartRide {
  /** Every link that ended before the release's restart, and why: these bots sat again. */
  reseats: {atMs: number; reason: string | null}[];
  firstCountdownMs: number | null;
}
const sleep = async (ms: number): Promise<void> => {await new Promise(resolve => {setTimeout(resolve, ms);});};

export class ReleaseRider extends RestartRider {
  declare readonly ride: ReleaseRide;
  constructor(connect: () => RoomBot, index: number, private readonly fighter: boolean) {
    super(connect, index, false);
    Object.assign(this.ride, {reseats: [], firstCountdownMs: null});
  }
  /** Seated now? (for the hourly holding line) */
  seated(): boolean { return this.bot !== null && this.bot.closed === null && this.bot.client.latest !== null; }
  /** Sit until a countdown's restart ends the link, sitting again after anything else; then come back and compare. */
  async hold(deadline: number, heard: (ride: ReleaseRide) => void): Promise<ReleaseRide> {
    let fought = false;
    for (;;) {
      const bot = this.bot;
      if (bot === null) throw new Error('seat first');
      while (bot.closed === null && performance.now() < deadline) {
        if (this.ride.countdowns.length > 0 && this.ride.firstCountdownMs === null) { this.ride.firstCountdownMs = this.ms(); heard(this.ride); }
        if (this.fighter && !fought && this.ride.countdowns.length > 0) { fought = true; await this.hurtOne(bot, 45_000); continue; }
        await this.watch(bot);
      }
      if (bot.closed === null) { this.ride.error = 'no release reached this bot before the deadline'; return this.ride; }
      if (bot.closed === 'restart' && this.ride.countdowns.length > 0) return await this.comeBack(bot, deadline) as ReleaseRide;
      this.ride.reseats.push({atMs: this.ms(), reason: bot.closed});
      bot.drop();
      this.bot = null;
      while (this.bot === null && performance.now() < deadline) {
        const next = this.dial();
        if (await next.arrived(Math.max(1, Math.min(20_000, deadline - performance.now())))) this.bot = next;
        else { next.drop(); await sleep(5000); }
      }
      if (this.bot === null) { this.ride.error = `not seated again before the deadline (${String(this.ride.reseats.length)} reseats)`; return this.ride; }
      // a plain restart keeps progress too (the restart proof); the lines to keep through the release are the ones held now
      await sleep(3000);
      this.ownedBefore = this.ownedNow();
      this.ride.ownedLines = this.bot.client.owned.size;
    }
  }
}
