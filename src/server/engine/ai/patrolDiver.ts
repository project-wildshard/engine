import type { AnimalSim } from '../../../shared/engine/entities/AnimalSim';
import type { SimValue } from '../sim';
import type { StrikeSpec } from '../../../shared/engine/ai/strikes';
import { DiverBrain, type PatrolDiverSpec as SharedSpec, type PatrolDiverPorts as SharedPorts } from '../../../shared/engine/ai/diver';

/** Legacy Spec name for the shared diver preset. */
type PatrolDiverSpec = SharedSpec;
/** Legacy Ports name for the shared diver preset. */
export type PatrolDiverPorts<A extends AnimalSim> = SharedPorts<A>;

/** Existing constructor and save bytes, selecting one admitted pattern of the shared diver. */
export class PatrolDiverBrain<A extends AnimalSim> {
  private readonly policy: DiverBrain<A>;
  constructor(actor: A, spec: PatrolDiverSpec, home: { x: number; z: number }, strike: StrikeSpec) {
    this.policy = new DiverBrain(actor, { pattern: 'patrol', spec, home, strike });
  }
  /** Narrow phase of this preset; another pattern cannot restore into it. */
  get state(): 'glide' | 'dive' | 'climb' {
    const state = this.policy.state;
    if (state === 'glide' || state === 'dive' || state === 'climb') return state;
    throw new Error('Incompatible diver phase');
  }
  /** Preserve the original complete continuation. */
  snapshot(): SimValue { return this.policy.snapshot(); }
  /** Validate atomically through the admitted shared policy. */
  restore(saved: SimValue): void { this.policy.restore(saved); }
  /** Select this pattern while preserving the trusted observation API. */
  think(c: PatrolDiverPorts<A>): void { this.policy.think({ ...c, pattern: 'patrol' }); }
  /** Execute the unchanged native body and contact laws. */
  act(c: PatrolDiverPorts<A>): void { this.policy.act({ ...c, pattern: 'patrol' }); }
}
