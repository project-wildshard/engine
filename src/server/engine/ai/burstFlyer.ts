import type { AnimalSim } from '../../../shared/engine/entities/AnimalSim';
import type { SimValue } from '../sim';
import type { StrikeSpec } from '../../../shared/engine/ai/strikes';
import { DiverBrain, type BurstFlyerSpec as SharedSpec, type BurstFlyerPorts as SharedPorts } from '../../../shared/engine/ai/diver';

/** Legacy Spec name for the shared diver preset. */
export type BurstFlyerSpec = SharedSpec;
/** Legacy Ports name for the shared diver preset. */
export type BurstFlyerPorts<A extends AnimalSim> = SharedPorts<A>;

/** Existing constructor and save bytes, selecting one admitted pattern of the shared diver. */
export class BurstFlyerBrain<A extends AnimalSim> {
  private readonly policy: DiverBrain<A>;
  constructor(actor: A, spec: BurstFlyerSpec, home: { x: number; z: number; r: number; y: number }, strike: StrikeSpec) {
    this.policy = new DiverBrain(actor, { pattern: 'burst', spec, home, strike });
  }
  /** Narrow phase of this preset; another pattern cannot restore into it. */
  get state(): 'drift' | 'dart' {
    const state = this.policy.state;
    if (state === 'drift' || state === 'dart') return state;
    throw new Error('Incompatible diver phase');
  }
  /** Preserve the original complete continuation. */
  snapshot(): SimValue { return this.policy.snapshot(); }
  /** Validate atomically through the admitted shared policy. */
  restore(saved: SimValue): void { this.policy.restore(saved); }
  /** Select this pattern while preserving the trusted observation API. */
  think(c: BurstFlyerPorts<A>): void { this.policy.think({ ...c, pattern: 'burst' }); }
  /** Execute the unchanged native body and contact laws. */
  act(c: BurstFlyerPorts<A>): void { this.policy.act({ ...c, pattern: 'burst' }); }
}
