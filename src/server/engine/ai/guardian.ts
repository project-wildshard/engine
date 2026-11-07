import type { AnimalSim } from '../../../shared/engine/entities/AnimalSim';
import type { SimValue } from '../sim';
import { GuardianPolicy, type GuardianSpec as SharedSpec, type GuardianPorts as SharedPorts } from './guardianPolicy';

/** Existing tuning name for the parametric guardian preset. */
export type GuardianSpec = SharedSpec;
/** Existing native body/RNG port name for this preset. */
export type GuardianPorts<A extends AnimalSim> = SharedPorts<A>;

/** Existing constructor and save bytes select the interior pattern of the shared guardian. */
export class GuardianBrain<A extends AnimalSim> {
  private readonly policy: GuardianPolicy<A>;
  constructor(actor: A, spec: GuardianSpec) { this.policy = new GuardianPolicy(actor, { pattern: 'interior', spec }); }
  /** Preserve the original policy fence; mutable decisions remain in the actor snapshot. */
  snapshot(): SimValue { return this.policy.snapshot(); }
  /** Validate without invoking a body recipe or consuming RNG. */
  restore(saved: SimValue): void { this.policy.restore(saved); }
  /** Preserve the trusted observation API and the host's vertical/contact recipe. */
  think(c: GuardianPorts<A>): void { this.policy.think({ ...c, pattern: 'interior' }); }
}
