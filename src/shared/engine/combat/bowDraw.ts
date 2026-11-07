/**
 * bowDraw — the Nalati bow's draw as a pure state machine (NALATI-MERGE H4, the user's ask N18; research and numbers:
 * docs/design/nalati/bow-research.md). No THREE, no DOM: Bow.ts feeds it one `step()` per frame and acts on the event.
 *
 *   hold  (FIRE disc / LMB)            the string comes back over DRAW_TIME (× 1/rate); the ring fills with `p`
 *   reach full (`drawT` = 1)           'full' — the ring is closed, the arrow is at the anchor
 *   release at full                    'loose' — the ONLY way an arrow leaves (no quick-fire, no snap shot, no weak shot)
 *   release before full                'letdown' — no arrow, nothing spent: the string eases forward over LETDOWN_TIME
 *   held at full                       steady for HOLD_STEADY s, then the aim sways (`sway`, 0..1 by HOLD_TIRE), then
 *                                      'tired' — the arms give out: a let-down, and the finger must lift before the next draw
 *   blocked mid-draw (sprint, swim …)  'letdown' as well, and the finger must lift again
 *   after a loose                      the re-nock (RENOCK_TIME): a new draw may start once RN_EARLY of it is left, so a
 *                                      finger pressed again at once starts the next draw as the hand comes up with the arrow
 *
 *   const d = new BowDraw();
 *   const ev = d.step(dt, held, blocked, rate);   // 'start' | 'full' | 'loose' | 'letdown' | 'tired' | null
 *   d.p        // the draw 0..1 (ease-out of drawT: the string comes fast, then heavy toward the anchor)
 *   d.sway     // 0..1: how far into the tremble a long hold is
 */

/** Seconds to full draw before the supplied rate multiplier. */
export const DRAW_TIME = 0.75;       // s to full draw on foot (× 1/rate: 0.9 s in the saddle, 0.625 s with the Golden Bow)
/** Seconds to ease a released or blocked draw back to brace. */
export const LETDOWN_TIME = 0.4;     // s for a full draw to ease back to brace
/** Seconds from a loose to the next arrow on the string. */
export const RENOCK_TIME = 0.62;     // s from a loose to the next arrow on the string
/** Share of re-nock remaining when the next draw may begin. */
export const RN_EARLY = 0.4;         // the next draw may start with this share of the re-nock left
/** Seconds at full draw before aim fatigue begins. */
export const HOLD_STEADY = 3.0;      // s at full draw before the aim starts to tremble
/** Seconds at full draw before the arms force a let-down. */
export const HOLD_TIRE = 8.0;        // s at full draw until the arms give out (a forced let-down; the tremble is full by then)
/** Seconds of rest after forced fatigue. */
export const TIRED_TIME = 1.1;       // s the arms rest after giving out

/** Draw edges emitted by the one pure bow state machine. */
export type DrawEvent = 'start' | 'full' | 'loose' | 'letdown' | 'tired';

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

/** A draw's whole state, for a host that saves and restores it (a headless runtime's snapshot): the clocks and the
 *  finger's edges. */
export interface BowDrawState { drawT: number; holdT: number; renockT: number; tiredT: number; wasHeld: boolean; needLift: boolean; reachedFull: boolean }

/** Authored draw clocks; body, input and the frame delta stay with the native owner. */
export interface BowDrawProfile {
  readonly drawTime: number; readonly letdownTime: number; readonly renockTime: number; readonly renockEarly: number;
  readonly holdSteady: number; readonly holdTire: number; readonly tiredTime: number;
}
/** The shipping default; existing callers retain exactly the same arithmetic and clocks. */
export const DEFAULT_BOW_DRAW: BowDrawProfile = Object.freeze({ drawTime: DRAW_TIME, letdownTime: LETDOWN_TIME,
  renockTime: RENOCK_TIME, renockEarly: RN_EARLY, holdSteady: HOLD_STEADY, holdTire: HOLD_TIRE, tiredTime: TIRED_TIME });

/** Pure held-draw, full-release, let-down, fatigue and re-nock state machine. */
export class BowDraw {
  private readonly profile: BowDrawProfile;
  /** Snapshot the admitted clock parameters. No input edge or event is emitted at construction. */
  constructor(profile: BowDrawProfile = DEFAULT_BOW_DRAW) {
    if (Object.values(profile).some(n => !Number.isFinite(n) || n < 0)
      || profile.drawTime <= 0 || profile.letdownTime <= 0 || profile.renockTime <= 0
      || profile.renockEarly > 1 || profile.holdTire <= profile.holdSteady) throw new RangeError('Invalid bow draw profile');
    this.profile = Object.freeze({ ...profile });
  }
  /** linear draw time 0..1 (1 = full draw) */
  drawT = 0;
  /** s at full draw */
  holdT = 0;
  /** s left of the re-nock after a loose */
  renockT = 0;
  /** s left of the rest after the arms gave out */
  tiredT = 0;
  private wasHeld = false;
  /** the finger must lift before the next draw (after a loose, a forced let-down or tiring) */
  private needLift = false;
  private reachedFull = false;

  /** the draw 0..1 (ease-out) */
  get p(): number { return 1 - (1 - this.drawT) ** 2; }
  get full(): boolean { return this.drawT >= 1; }
  /** 0..1 — the tremble of a long hold (0 until HOLD_STEADY, 1 at HOLD_TIRE) */
  get sway(): number { return clamp01((this.holdT - this.profile.holdSteady) / (this.profile.holdTire - this.profile.holdSteady)); }
  /** the draw is coming / held (not letting down) */
  get drawing(): boolean { return this.wasHeld && !this.needLift && this.drawT > 0; }

  /** the whole state (`load` puts it back exactly) */
  save(): BowDrawState {
    return { drawT: this.drawT, holdT: this.holdT, renockT: this.renockT, tiredT: this.tiredT, wasHeld: this.wasHeld, needLift: this.needLift, reachedFull: this.reachedFull };
  }
  /** put back a saved state */
  load(s: BowDrawState): void {
    this.drawT = s.drawT; this.holdT = s.holdT; this.renockT = s.renockT; this.tiredT = s.tiredT;
    this.wasHeld = s.wasHeld; this.needLift = s.needLift; this.reachedFull = s.reachedFull;
  }

  /** drop everything (a holster, a death): no event */
  reset(): void { this.drawT = 0; this.holdT = 0; this.needLift = this.wasHeld; this.reachedFull = false; }

  /**
   * One frame. `held` = the draw input is down (FIRE disc / LMB); `blocked` = nothing may be drawn now (sprinting,
   * swimming, the quiver empty, the weapon down); `rate` = the draw speed multiplier (1 on foot).
   */
  step(dt: number, held: boolean, blocked: boolean, rate = 1): DrawEvent | null {
    this.renockT = Math.max(0, this.renockT - dt);
    this.tiredT = Math.max(0, this.tiredT - dt);
    const released = this.wasHeld && !held;
    this.wasHeld = held;
    let ev: DrawEvent | null = null;
    if (released) {
      const lifted = this.needLift;
      this.needLift = false;
      if (!lifted && this.drawT > 0) {
        if (this.full && !blocked) {
          this.drawT = 0; this.holdT = 0; this.reachedFull = false;
          this.renockT = this.profile.renockTime;
          return 'loose';
        }
        ev = 'letdown';
      }
    }
    const canDraw = held && !this.needLift && !blocked && this.tiredT <= 0 && this.renockT <= this.profile.renockTime * this.profile.renockEarly;
    if (canDraw) {
      if (this.drawT === 0) ev = 'start';
      this.drawT = Math.min(1, this.drawT + (dt * rate) / this.profile.drawTime);
      if (this.full && !this.reachedFull) { this.reachedFull = true; ev = 'full'; }
      if (this.full) {
        this.holdT += dt;
        if (this.holdT >= this.profile.holdTire) {
          this.tiredT = this.profile.tiredTime; this.holdT = 0; this.needLift = true; this.reachedFull = false;
          ev = 'tired';
        }
      }
      return ev;
    }
    // not drawing: a draw in hand that was blocked (a sprint, the water) is let down, and the finger must lift again
    if (held && !this.needLift && this.drawT > 0 && (blocked || this.tiredT > 0)) { this.needLift = true; ev = 'letdown'; }
    this.drawT = Math.max(0, this.drawT - dt / this.profile.letdownTime);
    this.holdT = 0; this.reachedFull = false;
    return ev;
  }
}
