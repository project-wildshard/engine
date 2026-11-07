import type { AnimalSim } from '../../../shared/engine/entities/AnimalSim';
import type { SimValue } from '../sim';
import type { StrikeSpec } from '../../../shared/engine/ai/strikes';
import { GrazerBrain, type CircleGrazerSpec, type CircleGrazerPorts } from './grazer';

/** Legacy tuning name for the shared grazer's circle-challenge preset. */
type ChallengeGrazerSpec = CircleGrazerSpec;
/** Legacy observation name; the preset supplies its own admitted pattern. */
export type ChallengeGrazerPorts<A extends AnimalSim> = CircleGrazerPorts<A>;

/** Existing constructor and save contract, expressed as a preset of the shared parametric grazer. */
export class ChallengeGrazerBrain<A extends AnimalSim> {
  private readonly policy: GrazerBrain<A>;
  constructor(actor: A, spec: ChallengeGrazerSpec, charge: StrikeSpec, close: StrikeSpec) {
    this.policy = new GrazerBrain(actor, { pattern: 'circle-challenge', spec, charge, close });
  }
  /** The narrowed phase of this preset; no other grazer pattern can restore into it. */
  get state(): 'graze' | 'notice' | 'fight' {
    const state = this.policy.state;
    if (state === 'threat' || state === 'ram' || state === 'fall') throw new Error('Incompatible grazer phase');
    return state;
  }
  /** Preserve the original serialized continuation. */
  snapshot(): SimValue { return this.policy.snapshot(); }
  /** Restore atomically through the admitted shared policy. */
  restore(saved: SimValue): void { this.policy.restore(saved); }
  /** Keep the existing trusted observation API while selecting this pattern explicitly. */
  think(c: ChallengeGrazerPorts<A>): void { this.policy.think({ ...c, pattern: 'circle-challenge' }); }
  /** Keep the existing body API, strike order and host-owned movement authority. */
  act(c: ChallengeGrazerPorts<A>): void { this.policy.act({ ...c, pattern: 'circle-challenge' }); }
}
