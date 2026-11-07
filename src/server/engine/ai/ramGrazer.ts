import type { AnimalSim } from '../../../shared/engine/entities/AnimalSim';
import type { SimValue } from '../sim';
import type { StrikeSpec } from '../../../shared/engine/ai/strikes';
import { GrazerBrain, type WanderGrazerSpec, type WanderGrazerPorts } from './grazer';

/** Legacy tuning name for the shared grazer's wander-ram preset. */
export type RamGrazerSpec = WanderGrazerSpec;
/** Legacy observation name; the preset supplies its own admitted pattern. */
export type RamGrazerPorts<A extends AnimalSim> = WanderGrazerPorts<A>;

/** Existing constructor and save contract, expressed as a preset of the shared parametric grazer. */
export class RamGrazerBrain<A extends AnimalSim> {
  private readonly policy: GrazerBrain<A>;
  constructor(actor: A, spec: RamGrazerSpec, strike: StrikeSpec) {
    this.policy = new GrazerBrain(actor, { pattern: 'wander-ram', spec, strike });
  }
  /** The narrowed phase of this preset; no other grazer pattern can restore into it. */
  get state(): 'graze' | 'threat' | 'ram' | 'fall' {
    const state = this.policy.state;
    if (state === 'notice' || state === 'fight') throw new Error('Incompatible grazer phase');
    return state;
  }
  /** Preserve the original serialized continuation. */
  snapshot(): SimValue { return this.policy.snapshot(); }
  /** Restore atomically through the admitted shared policy. */
  restore(saved: SimValue): void { this.policy.restore(saved); }
  /** Keep the existing trusted observation API while selecting this pattern explicitly. */
  think(c: RamGrazerPorts<A>): void { this.policy.think({ ...c, pattern: 'wander-ram' }); }
  /** Keep the existing body API, strike order and host-owned movement authority. */
  act(c: RamGrazerPorts<A>): void { this.policy.act({ ...c, pattern: 'wander-ram' }); }
}
