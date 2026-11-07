import type { AnimalSim } from '../../../shared/engine/entities/AnimalSim';
import type { SimValue } from '../sim';
import { StalkerBrain, type SkirmisherSpec as SharedSpec, type SkirmisherPorts as SharedPorts } from '../../../shared/engine/ai/stalker';

/** Existing circling melee tuning alias for the parametric stalker preset. */
export type SkirmisherSpec = SharedSpec;
/** Existing host-owned perception/navigation/token alias. */
export type SkirmisherPorts<A extends AnimalSim> = SharedPorts<A>;
/** Existing constructor and actor-owned continuation, selecting the shared skirmish pattern. */
export class SkirmisherBrain<A extends AnimalSim> {
  private readonly actor: A;
  private readonly policy: StalkerBrain<A>;
  constructor(actor: A, spec: SkirmisherSpec) { this.actor = actor; this.policy = new StalkerBrain({ pattern: 'skirmish', spec }); }
  /** Preserve the original immutable policy contract. */
  snapshot(): SimValue { return this.policy.snapshot(); }
  /** Restore without running any decision or native body callback. */
  restore(saved: SimValue): void { this.policy.restore(saved); }
  /** Preserve the host-owned actor, cadence and perception API. */
  think(c: SkirmisherPorts<A>): void { this.policy.decideSkirmisher(this.actor, c); }
}
