import type { AnimationAction } from 'three';

interface Layer { action: AnimationAction; name: string; w: number; target: number; rate: number; hold: boolean }

/** one arm's clip channel: a base (idle ↔ walk) under crossfading one-shot moves */
export class ClipChannel {
  readonly layers: Layer[] = [];
  private readonly base: AnimationAction;
  private readonly walk: AnimationAction | null;
  constructor(base: AnimationAction, walk: AnimationAction | null) {
    this.base = base; this.walk = walk;
    base.play();
    walk?.play();
  }

  play(action: AnimationAction, name: string, fade: number, hold: boolean): void {
    for (const l of this.layers) { l.target = 0; l.rate = 1 / Math.max(0.016, fade); }
    action.reset();
    action.enabled = true;
    action.setEffectiveTimeScale(1);
    action.setEffectiveWeight(0);
    action.play();
    this.layers.push({ action, name, w: 0, target: 1, rate: 1 / Math.max(0.016, fade), hold });
  }

  /** back to the base (a held pose released) */
  release(fade: number): void { for (const l of this.layers) { l.target = 0; l.rate = 1 / Math.max(0.016, fade); } }

  /** the move that is fading in / playing (null when on the base) */
  get top(): Layer | null {
    for (let i = this.layers.length - 1; i >= 0; i--) { const l = this.layers[i]; if (l !== undefined && l.target > 0) return l; }
    return null;
  }

  update(dt: number, walkW: number, walkPhase: number | undefined): void {
    for (const l of this.layers) {
      // a finished one-shot fades back to the base; a held pose (charge, sheathe) stays until the next play
      const dur = l.action.getClip().duration;
      if (l.target > 0 && !l.hold && l.action.time >= dur - 1e-4) { l.target = 0; l.rate = 1 / 0.15; }
      l.w += Math.sign(l.target - l.w) * Math.min(Math.abs(l.target - l.w), l.rate * dt);
    }
    for (let i = this.layers.length - 1; i >= 0; i--) {
      const l = this.layers[i];
      if (l !== undefined && l.w <= 0 && l.target <= 0) { l.action.stop(); this.layers.splice(i, 1); }
    }
    const moveW = Math.min(1, this.layers.reduce((a, l) => a + l.w, 0));
    for (const l of this.layers) l.action.setEffectiveWeight(l.w);
    const baseW = 1 - moveW;
    this.base.setEffectiveWeight(baseW * (this.walk === null ? 1 : 1 - walkW));
    if (this.walk !== null) {
      this.walk.setEffectiveWeight(baseW * walkW);
      if (walkPhase !== undefined) {
        const d = this.walk.getClip().duration;
        this.walk.time = (((walkPhase / (Math.PI * 2)) % 1) + 1) % 1 * d;
      }
    }
  }
}
