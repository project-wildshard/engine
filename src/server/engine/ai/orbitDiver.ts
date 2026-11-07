import type { AnimalSim } from '../../../shared/engine/entities/AnimalSim';
import type { SimValue } from '../sim';
import type { StrikeSpec } from '../../../shared/engine/ai/strikes';
import { DiverBrain, type OrbitDiverSpec as SharedSpec, type OrbitDiverPorts as SharedPorts, type OrbitDiverHome as SharedHome } from '../../../shared/engine/ai/diver';

/** Legacy Spec name for the shared diver preset. */
export type OrbitDiverSpec = SharedSpec;
/** Legacy Ports name for the shared diver preset. */
export type OrbitDiverPorts<A extends AnimalSim> = SharedPorts<A>;
/** Stable admitted orbit geometry, preserved by this preset. */
export type OrbitDiverHome = SharedHome;

/** Existing constructor and save bytes, selecting one admitted pattern of the shared diver. */
export class OrbitDiverBrain<A extends AnimalSim> {
  private readonly policy: DiverBrain<A>;
  constructor(actor: A, spec: OrbitDiverSpec, home: OrbitDiverHome, strike: StrikeSpec) {
    this.policy = new DiverBrain(actor, { pattern: 'orbit', spec, home, strike });
  }
  /** Narrow phase of this preset; another pattern cannot restore into it. */
  get state(): 'circle' | 'stalk' | 'dive' | 'rise' {
    const state = this.policy.state;
    if (state === 'circle' || state === 'stalk' || state === 'dive' || state === 'rise') return state;
    throw new Error('Incompatible diver phase');
  }
  /** Preserve the original complete continuation. */
  snapshot(): SimValue { return this.policy.snapshot(); }
  /** Validate atomically through the admitted shared policy. */
  restore(saved: SimValue): void { this.policy.restore(saved); }
  /** Select this pattern while preserving the trusted observation API. */
  think(c: OrbitDiverPorts<A>): void { this.policy.think({ ...c, pattern: 'orbit' }); }
  /** Execute the unchanged native body and contact laws. */
  act(c: OrbitDiverPorts<A>): void { this.policy.act({ ...c, pattern: 'orbit' }); }
}
