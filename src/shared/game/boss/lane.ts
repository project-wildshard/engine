import type { Vector3 } from 'three';
import { StrikeRunner, type BrainPoint, type StrikeActor, type StrikeSpec } from '@wildshard/engine/ai/strikes';

/** What a lane charge and the elites' goals (EliteGoals.ts) drive: the page's Animal and the renderer-free AnimalSim alike. */
export interface LaneBody extends StrikeActor {
  readonly position: Vector3; readonly lookTarget: Vector3; lookWeight: number;
  readonly seed: number; readonly lastHitT: number; readonly state: string;
}

/** A lane's saved state: its tell length and its strike runner's. */
export interface LaneState { tellT: number; runner: ReturnType<StrikeRunner['snapshot']> }

/**
 * A telegraphed LANE CHARGE's rules, renderer-free (SF72): the lane is locked from the animal through where you stand (+ an
 * overshoot) for `tell` s while it paws (the body's wind-up), then it runs the lane flat out on the body clock and hits once
 * if you are still in it (and in reach) when it arrives, then it skids to a stop (the shot window). The page's LaneCharge
 * (ctx.ts) is this plus its ground decal; the headless runtime runs it bare.
 */
export class Lane<B extends LaneBody = LaneBody> {
  private readonly runner = new StrikeRunner();
  private readonly spec: StrikeSpec;
  private tellT = 1;
  /** the lane's full width (m): the decal paints it */
  readonly width: number;
  constructor(row: StrikeSpec, private readonly reach: (actor: B, target: BrainPoint) => boolean = () => true) {
    if (row.shape.kind !== 'lane') throw new Error('Lane view requires a lane strike');
    this.spec = row; this.width = row.shape.width;
  }
  get state(): 'none' | 'tell' | 'run' | 'skid' {
    return this.runner.state === 'windup' ? 'tell' : this.runner.state === 'active' ? 'run' : this.runner.state === 'recover' ? 'skid' : 'none';
  }
  get t(): number { return this.runner.time; }
  /** The windup this run was given. */
  get tell(): number { return this.tellT; }
  get x0(): number { return this.runner.x0; }
  get z0(): number { return this.runner.z0; }
  get x1(): number { return this.runner.x1; }
  get z1(): number { return this.runner.z1; }
  get yaw(): number { return this.runner.yaw; }
  get len(): number { return this.runner.length; }
  get busy(): boolean { return this.runner.busy; }
  idle(): boolean { return !this.busy; }
  start(a: B, px: number, pz: number, tell: number, speedMul = 1): void {
    this.tellT = tell;
    const spec: StrikeSpec = { ...this.spec, windup: tell };
    this.runner.start(spec, a, { x: px, y: a.position.y, z: pz }, speedMul);
  }
  cancel(): void { this.runner.cancel(); }
  /** The runner's state for a renderer-free continuation (the tell length rides beside it). */
  snapshot(): LaneState { return { tellT: this.tellT, runner: this.runner.snapshot() }; }
  /** Back to a saved state: the running strike is this lane's own spec at the saved tell length. */
  restore(saved: LaneState): void { this.tellT = saved.tellT; this.runner.restore(saved.runner, [{ ...this.spec, windup: saved.tellT }]); }
  /** Validate a runner without mutating the live charge. */
  validate(saved: LaneState): void { new Lane(this.spec, this.reach).restore(saved); }
  recoverNow(): void { this.runner.recoverNow(); }
  /** One body-clock step (`t`, the frame's time, is the decal's alone). */
  update(a: B, dt: number, t: number, player: Vector3, hurt: (dmg: number) => void): void {
    void t;
    if (this.state === 'none') return;
    this.runner.update(dt, { actor: a, target: player, canReach: () => this.reach(a, player), hit: (spec) => { hurt(spec.damage); } });
  }
}
