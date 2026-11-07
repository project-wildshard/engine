/**
 * The arena room portal's decisions, renderer-free (CI12: the Nalati chapter reads `arena.inside` natively). The admitted
 * portal program decides at 10 Hz from what the room observes (the player against the room's volume, chamber sand and
 * floor, the entrance, whether the boss is engaged) whether to enter, leave (2: leave by teleport) or slow the player;
 * an entry or a teleporting exit first fades for `hold` seconds. `ArenaRoomPortal` (arenaRoomView.ts) keeps the room's scene,
 * the player's move and the boss, and calls this with the same arithmetic in the same order.
 *
 *   const law = new ArenaPortalLaw(program, rows, entrance);
 *   const step = law.step(dt, () => frame);   // step.kind: 'fading' | 'faded' | 'decided' | 'wait'
 */
import type { ReturnProgram } from '../population/returnProgram';

/** the room's entrance: where the player is put back on a teleporting exit, facing out */
export interface ArenaPortalEntrance { readonly x: number; readonly y: number; readonly z: number; readonly facing: number }
/** what the room observes at a decision */
export interface ArenaPortalFrame {
  readonly px: number; readonly py: number; readonly pz: number;
  /** the room's floor height under the player (undefined: none) */
  readonly floor: number | undefined;
  readonly volume: boolean; readonly engaged: boolean;
  /** the chamber's sand under the player (0 outside the chamber) */
  readonly sand: number;
  readonly originY: number; readonly originZ: number;
}
export type ArenaPortalStep =
  | { readonly kind: 'fading' }
  /** the fade ended: what it was fading towards (null: nothing) */
  | { readonly kind: 'faded'; readonly pending: 'enter' | 'exit' | null }
  /** a decision: enter, exit (0: stay, 2: by teleport; as the program returned it) and slow */
  | { readonly kind: 'decided'; readonly enter: boolean; readonly exit: number | undefined; readonly slow: boolean }
  | { readonly kind: 'wait' };
const FADING: ArenaPortalStep = { kind: 'fading' }, WAIT: ArenaPortalStep = { kind: 'wait' };
/** the portal's continuation as data: inside, the decision clock, the fade (-1: none) and what it fades towards */
export interface ArenaPortalSnapshot { readonly inside: boolean; readonly elapsed: number; readonly fade: number; readonly pending: 'enter' | 'exit' | null }

export class ArenaPortalLaw {
  inside = false;
  private elapsed = 0; private fade = -1; private pending: 'enter' | 'exit' | null = null;
  constructor(private readonly program: Pick<ReturnProgram, 'project'>, private readonly rows: { readonly signal: string; readonly end: number },
    private readonly entrance: ArenaPortalEntrance | null) {}
  snapshot(): ArenaPortalSnapshot { return { inside: this.inside, elapsed: this.elapsed, fade: this.fade, pending: this.pending }; }
  restore(saved: ArenaPortalSnapshot): void {
    if (!Number.isFinite(saved.elapsed) || saved.elapsed < 0 || !Number.isFinite(saved.fade)) throw new Error('Invalid arena portal snapshot');
    this.inside = saved.inside; this.elapsed = saved.elapsed; this.fade = saved.fade; this.pending = saved.pending;
  }
  /** Fade for `hold` seconds, then report `pending` (an entry, or a teleporting exit). */
  begin(pending: 'enter' | 'exit', hold: number): void { this.fade = hold; this.pending = pending; }
  step(dt: number, observe: () => ArenaPortalFrame): ArenaPortalStep {
    if (this.fade >= 0) {
      this.fade -= dt;
      if (this.fade < 0) { const pending = this.pending; this.pending = null; return { kind: 'faded', pending }; }
      return FADING;
    }
    this.elapsed += dt;
    if (this.elapsed < .1 - 1e-9) return WAIT;
    const o = observe(), e = this.entrance, z = o.pz - o.originZ;
    const result = this.program.project(this.rows.signal, { px: o.px, pz: o.pz, y: o.py, ex: e?.x ?? 0, ey: e?.y ?? 0, ez: e?.z ?? 0, facing: e?.facing ?? 0,
      volume: Number(o.volume), inside: Number(this.inside), corridor: z, land: this.rows.end, engaged: Number(o.engaged),
      sand: o.sand, floor: o.floor ?? o.originY, cy: o.originY });
    this.elapsed = 0;
    return { kind: 'decided', enter: result['enter'] === 1, exit: result['exit'], slow: result['slow'] === 1 };
  }
}
