// J473 (Jake, 2026-11-19 grill on QA row 40): the phone HUD folds what isn't the fight while you fight. "In a fight" is a hit
// taken or a hit landed in the last FIGHT_HOLD_MS. The page carries it as marks on <html> for the parts outside the game's
// bundle (the chat corner, src/client/host/online/chatLines.ts): `data-ws-fight` while it lasts, and `data-ws-hurt`, a count
// that moves on every hit taken (an open chat closes on one). The HUD's VITALS follow the same clock (HP only in combat).

/** How long a fight lasts after its last hit, either way. */
export const FIGHT_HOLD_MS = 8000;

/** The fight clock and its page marks. `root` is the page's <html> (null in a test with no page). */
export class FightMark {
  private lastHit = Number.NEGATIVE_INFINITY;
  private hurts = 0;
  private on = false;
  private readonly root: HTMLElement | null;
  constructor(root: HTMLElement | null) { this.root = root; }
  /** The player took a hit at `now` (ms). */
  hurt(now: number): void { this.lastHit = now; this.hurts++; if (this.root !== null) this.root.dataset['wsHurt'] = String(this.hurts); this.tick(now); }
  /** The player landed a hit at `now` (ms). */
  struck(now: number): void { this.lastHit = now; this.tick(now); }
  /** Whether a fight is on at `now`; writes `data-ws-fight` only when that changes. */
  tick(now: number): boolean {
    const on = now - this.lastHit < FIGHT_HOLD_MS;
    if (on !== this.on) {
      this.on = on;
      if (this.root !== null) { if (on) this.root.dataset['wsFight'] = ''; else delete this.root.dataset['wsFight']; }
    }
    return on;
  }
  /** J473 row 8 ("HP only in combat"): how the phone's HP strip looks at `now`: up through the fight, fading for `fade` ms
   *  after it, then out of the column. */
  look(now: number, fade: number): 'show' | 'fade' | 'gone' {
    const since = now - this.lastHit;
    return since < FIGHT_HOLD_MS ? 'show' : since < FIGHT_HOLD_MS + fade ? 'fade' : 'gone';
  }
  /** Take the marks off the page (the HUD is going). */
  clear(): void { this.on = false; if (this.root !== null) { delete this.root.dataset['wsFight']; delete this.root.dataset['wsHurt']; } }
}
