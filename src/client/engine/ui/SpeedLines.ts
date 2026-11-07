import { uiScope, mountUi } from './ownership';
/**
 * SpeedLines — radial speed streaks at the screen edges while a dash runs (E27, mockup art/hud/round-7-sword-touch/B-lunge.jpg):
 * a dodge shows them lightly, a sword lunge fully. Pure CSS (a repeating conic gradient masked to the edges, styled in
 * game.css `.ws-game-speed`); this only sets `--speed` 0..1 when it changes, so an idle frame writes nothing.
 *
 * The dodge feel (E63's T "lean + smear", project/archive/2026-09-29-dodge-feel.md; V was deleted in E82) adds its own screen layer, read
 * off Player's shared `dodgeFx` clock: horizontal streaks slide across the outer thirds against the dodge
 * (`.ws-game-smear`, `--smear` 0..1 and `--side`), never over the centre 40 %. One composited layer: no WebGL cost.
 *
 *   const speed = new SpeedLines();
 *   speed.update(dt, player.dashing, meleeLock.lunging);   // once per frame
 */
import { dodgeFx, dodgeEnv } from '../../../shared/engine/player/dodge';

export class SpeedLines {
  readonly scope: ReturnType<typeof uiScope> = uiScope('SpeedLines');
  private readonly el: HTMLElement;
  private readonly smear: HTMLElement;
  private level = 0; private shown = -1;
  private smearShown = -1; private sideShown = 0;

  constructor() {
    this.el = document.createElement('div');
    this.el.className = 'ws-game-speed';
    this.smear = document.createElement('div');
    this.smear.className = 'ws-game-smear';
    mountUi(this.el, this.scope); mountUi(this.smear, this.scope);
  }

  update(dt: number, dashing: boolean, lunging: boolean): void {
    const target = lunging ? 1 : dashing ? 0.55 : 0;
    // snap up on a dash's first frame, ease out after it ends
    this.level = target > this.level ? target : this.level * Math.exp(-dt * 10);
    if (this.level < 0.02) this.level = 0;
    const q = Math.round(this.level * 50) / 50;
    if (q !== this.shown) { this.shown = q; this.el.style.setProperty('--speed', String(q)); }

    // the dodge feel (E63 T)
    const ms = dodgeFx.t;
    const smear = ms >= 0 && !dodgeFx.back ? Math.round(Math.max(0, Math.min(1, dodgeEnv(ms))) * 50) / 50 : 0;
    if (smear !== this.smearShown) { this.smearShown = smear; this.smear.style.setProperty('--smear', String(smear)); }
    const side = dodgeFx.side >= 0 ? 1 : -1;
    if (smear > 0 && side !== this.sideShown) { this.sideShown = side; this.smear.style.setProperty('--side', String(side)); }
  }
}
