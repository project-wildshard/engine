// MMO-PLAN GO5b: the world's door can name the player's cell (`resume`) while a grid page still boots the hint's cell. The page enters
// the seat's cell in place, on this document and this socket, once two things exist: the running session that hands its link over
// (`session`) and the app's same-page entry (`entry`, installed at control). A boot whose seat is elsewhere still reaches control: its
// card waits for the server's first rows only briefly. With no way in place in time, or a session that can't enter in place, GO4's
// reload, as before.

export interface RegridLaterPorts {
  /** How long a disagreeing `resume` waits for the session and the same-page entry before the reload. */
  readonly waitMs: number;
  /** Run `then` after `ms`; the answer cancels it. */
  readonly timeout: (ms: number, then: () => void) => () => void;
}

/** The running session's in-place entry: true when the page enters `cell` here (it has handed its link over), false when it can't. */
export type RegridHere = (cell: string) => boolean;

export class RegridLater {
  private cell: string | null = null;
  /** GO4's way for the waiting cell: enter the grid again there on a fresh page. */
  private reload: (() => void) | null = null;
  private here: RegridHere | null = null;
  private inPage = false;
  private cancel: (() => void) | null = null;
  /** GO4's reload has started: the page is leaving, and a later `resume` starts nothing more. */
  private leaving = false;
  private readonly ports: RegridLaterPorts;
  constructor(ports: RegridLaterPorts) { this.ports = ports; }
  /** The door seated this player in `cell`, which the page didn't boot; `reload` is GO4's fresh-page entry there. The answer drops
   *  this ask while it still waits: the boot that asked has gone (back to the title mid-load), and no other session may run it. */
  ask(cell: string, reload: () => void): () => void {
    if (this.leaving) return () => undefined;
    this.cell = cell; this.reload = reload;
    this.cancel ??= this.ports.timeout(this.ports.waitMs, () => { this.cancel = null; this.give(); });
    this.go();
    return () => { if (this.reload !== reload) return; this.cell = null; this.reload = null; this.cancel?.(); this.cancel = null; };
  }
  /** The running session's in-place entry, or null once it has gone. */
  session(here: RegridHere | null): void { this.here = here; this.go(); }
  /** The app's same-page entry is in place (it stays for the page's life). */
  entry(): void { this.inPage = true; this.go(); }
  private go(): void {
    const { cell, here, reload } = this;
    if (cell === null || here === null || !this.inPage) return;
    this.cell = null; this.reload = null; this.cancel?.(); this.cancel = null;
    let entered = false;
    try { entered = here(cell); } catch { /* a session that can't say: the reload */ }
    if (!entered) { this.leaving = true; reload?.(); }
  }
  /** The wait is over with no way in place: the reload. */
  private give(): void {
    const { reload } = this;
    if (this.cell === null) return;
    this.cell = null; this.reload = null; this.leaving = true;
    reload?.();
  }
}
