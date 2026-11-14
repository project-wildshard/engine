import { Scope } from '../../../shared/engine/app/scope';
import { diagnosticNow } from '../../../shared/engine/core/clock';
import { Rng } from '../../../shared/engine/core/rng';
import type { Transport } from '../../../shared/engine/net/transport';
import type { NetClient } from './client';

/** What the player is told. `full` waits for a seat. `ended` is a word no redial can answer: a stale build, another tab. */
export type LinkState = 'live' | 'reconnecting' | 'resuming' | 'lost' | 'full' | 'ended';
/** Why a link is down, as far as a browser can tell (meta MMO-FAILURE-MODES-PLAN FM4): `silent` stopped carrying frames (a half-open
 *  socket), `closed` was closed with no word (1006, a reset), `restart` was closed by a restarting server, `hidden` went quiet while the
 *  page was out of view, `offline` is a device that says it has no network (FM4b mode 2). It rides `onState`'s reason for `reconnecting` and `resuming`. */
export type LinkCause = 'silent' | 'closed' | 'restart' | 'hidden' | 'updating' | 'offline';
/** Where the dial is, for a screen that shows it: dials so far, the wait to the next (null while one is out), and how long it's been down. */
export interface LinkProgress { readonly dials: number; readonly nextDialMs: number | null; readonly downMs: number; readonly away?: LinkAway }
/** FM4b modes 4 and 45: the page was away for `ms` and came back to a quiet or closed link. `hidden` is time out of view the page
 *  measured (visibilitychange); `asleep` is a gap in the page's own clock ticks while it wasn't known hidden (a sleep, a frozen tab).
 *  It says nothing about the world's hold on the seat (J114): only what this page measured. */
export interface LinkAway { readonly ms: number; readonly how: 'hidden' | 'asleep' }

/** No frame for this long: say so. The predictor's ring is full by then, so the player holds still. */
const STRIP_MS = 1000;
/** No frame for this long: the socket is dead, whatever it says. A dial that has shown no frame in this time goes the same way. */
const DROP_MS = 3000;
/** J114's hold is over by now, so what comes back is a resume and not the same body. */
const RESUMING_MS = 35_000;
/** The dial carries on this long, and then asks. */
const GIVE_UP_MS = 120_000;
/** The waits between dials, then the last for ever, each ±20%. */
const DIAL_WAITS_MS = [250, 500, 1000, 2000, 4000], DIAL_JITTER = 0.2;
const WATCH_MS = 100;
/** FM4b modes 4 and 45: away this long (out of view, or no clock tick at all) and back to a quiet link is the Welcome back card. */
const AWAY_MS = 30_000;
/** Words from a server that a redial would only hear again. */
const FINAL = new Set(['reload', 'refused', 'replaced']);
/** J178: the world is full, and a seat frees when someone leaves: this long between tries, for as long as the player waits. */
const FULL_RETRY_MS = 30_000;

/** Jitter is for the server's sake and no sim's: any seed that differs between phones will do. */
function jitterFrom(now: number): () => number { const rng = new Rng(Math.floor(now * 1000)); return () => rng.next(); }

/** How a link is watched. */
export interface RedialOptions {
  readonly client: NetClient;
  /** The link the client stands on now. */
  readonly transport: Transport;
  /** Open a new link. */
  readonly dial: () => Transport;
  /** The link changed state. */
  readonly onState: (state: LinkState, reason?: string) => void;
  /** FM4: the cause changed while the link stayed down (a restart close mid-dial, a return to the tab after a silent spell). */
  readonly onCause?: (cause: LinkCause) => void;
  /**
   * WR5 (5.5, the cut): a `reload` or `refused` before this client ever heard a frame may be an older server that can't read
   * a v1 hello, not a verdict on this build. The link stays down as "Server updating" and keeps dialling; this asks the page
   * to check `version.json` and reload only if it names another build.
   */
  readonly onCut?: (reason: string) => void;
  readonly now?: () => number;
  readonly random?: () => number;
  /** FM4b mode 2: does the device say it has a network? Default `navigator.onLine`; a browser with no answer counts as online. */
  readonly online?: () => boolean;
}
const browserOnline = (): boolean => typeof navigator === 'undefined' || (navigator as { onLine?: boolean }).onLine !== false;

/**
 * E7.1: one client's link, kept up. It watches for frames, and a link that stops carrying them is closed and dialled again on a
 * backoff, with `NetClient.rejoin` on each new link (C2). Nothing is watched before the first frame: a page still loading has none.
 */
export class Redial {
  private readonly options: RedialOptions;
  private readonly scope = new Scope('net.redial');
  private readonly now: () => number;
  private readonly random: () => number;
  private readonly online: () => boolean;
  private readonly offFrame: () => void;
  private transport: Transport;
  private offClose: () => void;
  private state: LinkState = 'live';
  /** up: frames are expected. down: dialling. stopped: waiting for `retry`, or finished. */
  private phase: 'up' | 'down' | 'stopped' = 'up';
  private heardAt: number | null = null;
  private lostAt = 0;
  private dials = 0;
  private dialAt = 0;
  private dialled: number | null = null;
  private waitingForSeat = false;
  private cause: LinkCause = 'closed';
  /** When the device last said it went offline while the link was down; null while it has a network. */
  private offlineAt: number | null = null;
  /** The watch's last tick: a gap after it is time the page did nothing at all (FM4b mode 45). */
  private tickAt: number;
  private awayFor: LinkAway | null = null;
  constructor(options: RedialOptions) {
    this.options = options; this.transport = options.transport; this.now = options.now ?? diagnosticNow; this.random = options.random ?? jitterFrom(this.now()); this.online = options.online ?? browserOnline;
    this.tickAt = this.now();
    this.offFrame = options.client.onFrame(() => { this.heard(); });
    this.offClose = this.watchClose(options.transport);
    this.scope.interval(WATCH_MS, () => { this.watch(); });
  }
  /** The state the player has been told. */
  get told(): LinkState { return this.state; }
  /** Dials made so far. */
  get attempts(): number { return this.dials; }
  /** Why the link is down now. */
  get why(): LinkCause { return this.cause; }
  /** The dial's progress now. */
  get progress(): LinkProgress {
    const now = this.now(), down = this.phase !== 'up';
    const away = this.awayFor === null ? {} : { away: this.awayFor };
    return { dials: this.dials, nextDialMs: this.phase === 'down' && this.dialled === null ? Math.max(0, this.dialAt - now) : null, downMs: down ? Math.max(0, now - this.lostAt) : 0, ...away };
  }
  /** The page came back into view (an iPhone returning to Safari): a link that went quiet while hidden redials at once.
   *  `hiddenMs` is how long the page measured itself out of view (FM4b mode 4). */
  check(hiddenMs = 0): void {
    const now = this.now();
    this.woke(now, hiddenMs);
    if (this.phase === 'up' && this.heardAt !== null && now - this.heardAt >= STRIP_MS) { this.because('hidden'); this.lose(now); }
    // a link that went silent while the page was away was the page's absence: say welcome back
    if (this.phase === 'down') { if (this.cause === 'silent') this.because('hidden'); this.dialAt = now; }
  }
  /** The player asked to dial now rather than wait out the backoff (a hold card's Try now). Nothing else changes. */
  dialNow(): void { if (this.phase === 'down' && this.dialled === null) this.dialAt = this.now(); }
  /** The player asked to try again, after `lost`. */
  retry(): void {
    if (this.state !== 'lost') return;
    const now = this.now();
    this.phase = 'down'; this.lostAt = now; this.dialAt = now; this.dials = 0; this.show('reconnecting');
  }
  dispose(): void { this.scope.dispose(); this.offFrame(); this.offClose(); }

  private heard(): void {
    const now = this.now(), wasDown = this.phase === 'down';
    this.heardAt = now;
    if (wasDown) { this.phase = 'up'; this.dialled = null; this.dials = 0; this.waitingForSeat = false; this.offlineAt = null; this.awayFor = null; }
    this.show('live');
  }
  private watch(): void {
    const now = this.now();
    this.woke(now, 0);
    if (this.phase === 'up') {
      if (this.heardAt === null) return;
      const silent = now - this.heardAt;
      if (silent >= STRIP_MS && this.state === 'live') this.because(this.online() ? 'silent' : 'offline');
      if (silent >= DROP_MS) this.lose(now); else if (silent >= STRIP_MS) this.show('reconnecting');
    } else if (this.phase === 'down') this.redial(now);
  }
  private redial(now: number): void {
    if (this.waitingForSeat) { if (this.dialled === null && now >= this.dialAt) this.dial(now); else if (this.dialled !== null && now - this.dialled >= DROP_MS) { this.failedDial(now); this.drop(); } return; }
    if (this.offline(now)) { if (this.dialled !== null && now - this.dialled >= DROP_MS) { this.failedDial(now); this.drop(); } return; }
    const out = now - this.lostAt;
    if (out >= GIVE_UP_MS) { this.stop(); this.show('lost'); return; }
    if (out >= RESUMING_MS) this.show('resuming');
    if (this.dialled !== null) { if (now - this.dialled >= DROP_MS) { this.failedDial(now); this.drop(); } return; }
    if (now >= this.dialAt) this.dial(now);
  }
  /**
   * FM4b mode 2: a device with no network is not dialled (each dial would only fail) and its give-up clock stands still, so a
   * phone in a tunnel never reaches `lost` while it waits; the world's own hold on the seat (J114) is the server's and goes on.
   * The network back: the clock goes on from where it stopped and the dial goes out at once. True while offline.
   */
  private offline(now: number): boolean {
    if (!this.online()) {
      this.offlineAt ??= now;
      this.because('offline');
      return true;
    }
    if (this.offlineAt === null) return false;
    this.lostAt += now - this.offlineAt; this.offlineAt = null; this.dialAt = now;
    this.because('closed');
    return false;
  }
  private dial(now: number): void {
    const transport = this.options.dial();
    this.offClose(); this.transport = transport; this.dialled = now; this.dials++;
    this.offClose = this.watchClose(transport);
    this.options.client.rejoin(transport);
  }
  private failedDial(now: number): void {
    const wait = this.waitingForSeat ? FULL_RETRY_MS : DIAL_WAITS_MS[Math.min(this.dials, DIAL_WAITS_MS.length - 1)] ?? 0;
    this.dialled = null; this.dialAt = now + wait * (1 + (this.random() * 2 - 1) * DIAL_JITTER);
  }
  private watchClose(transport: Transport): () => void {
    return transport.onClose(reason => { if (transport === this.transport) this.closed(reason); });
  }
  private closed(reason: string): void {
    const now = this.now();
    // 5.5: `retry` is a newer client at an older server: back off and dial again, never reload. A refusal before the first
    // frame may be the cut (an old server); the page decides from version.json, and until then the server is updating.
    const cut = (reason === 'reload' || reason === 'refused') && this.heardAt === null;
    if (FINAL.has(reason) && !cut) { this.stop(); this.show('ended', reason); return; }
    if (reason === 'retry' || cut) this.because('updating');
    if (cut) this.options.onCut?.(reason);
    if (reason === 'full') { this.phase = 'down'; this.waitingForSeat = true; this.dialled = null; this.dialAt = now + FULL_RETRY_MS; this.show('full'); return; }
    if (this.phase === 'up') { if (this.cause !== 'updating') this.because(reason === 'restart' ? 'restart' : this.online() ? 'closed' : 'offline'); this.lose(now, false); }
    else if (this.phase === 'down') { if (reason === 'restart') this.because('restart'); this.failedDial(now); }
  }
  /**
   * FM4b modes 4 and 45: the page was away (out of view for `hiddenMs`, or no clock tick for 30 s) and comes back to a link that is
   * quiet or down. The time away is not dialling time: a link lost while away counts its give-up clock from the return, and one
   * already down moves its clock on by the gap no dial could go out in, so a phone back after 4 minutes dials for 2 minutes more
   * and never opens on Couldn't reconnect. A healthy return (frames heard within the last second) changes nothing.
   */
  private woke(now: number, hiddenMs: number): void {
    const gap = now - this.tickAt;
    this.tickAt = now;
    if (gap < AWAY_MS && hiddenMs < AWAY_MS) return;
    const how = hiddenMs >= AWAY_MS || this.awayFor?.how === 'hidden' ? 'hidden' : 'asleep', ms = Math.max(gap, hiddenMs, this.awayFor?.ms ?? 0);
    if (this.phase === 'up') {
      if (this.heardAt === null || now - this.heardAt < STRIP_MS) return;
      this.awayFor = { ms, how }; this.because('hidden'); this.heardAt = now; this.lose(now);
    } else if (this.phase === 'down' && !this.waitingForSeat) {
      // the suspended gap moves the give-up clock on; hidden time with ticks running was dialled through, so it counts
      if (gap >= AWAY_MS) { this.lostAt += gap; if (this.offlineAt !== null) this.offlineAt += gap; }
      this.awayFor = { ms, how }; this.dialAt = now;
      if (this.cause === 'silent' || this.cause === 'closed') this.because('hidden');
    }
  }
  /** The link is gone or no use: from now it is dialled, and a player's 35 s count from the last frame. */
  private lose(now: number, close = true): void {
    this.phase = 'down'; this.lostAt = this.heardAt ?? now; this.dialled = null; this.dialAt = now + (DIAL_WAITS_MS[0] ?? 0) * (1 + (this.random() * 2 - 1) * DIAL_JITTER);
    this.show(now - this.lostAt >= RESUMING_MS ? 'resuming' : 'reconnecting');
    if (close) this.drop();
  }
  private drop(): void { this.offClose(); this.transport.close('stalled'); }
  private stop(): void { this.phase = 'stopped'; this.dialled = null; this.offClose(); }
  /** The cause changed: a link already shown down says so at once; timing is untouched. */
  private because(cause: LinkCause): void {
    if (cause === this.cause) return;
    this.cause = cause;
    if (this.state === 'reconnecting' || this.state === 'resuming') this.options.onCause?.(cause);
  }
  private show(state: LinkState, reason?: string): void {
    if (state === this.state) return;
    this.state = state;
    this.options.onState(state, reason ?? (state === 'reconnecting' || state === 'resuming' ? this.cause : undefined));
  }
}
