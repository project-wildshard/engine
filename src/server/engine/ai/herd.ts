import type { AnimalSim } from '../../../shared/engine/entities/AnimalSim';
import { GrazerBrain, type GuardedStallionState, type GuardedHerdSpec, type GuardedHerdContext, type GuardedHerdPorts } from './grazer';

/** Existing guard/taming states, preserving all native callbacks and saved state. */
export type StallionState = GuardedStallionState;
/** Existing bounded guarded-herd tuning, with no new field in the native contract. */
export type HerdSpec = GuardedHerdSpec;
/** Existing host-owned clock, steering and player observations. */
export type HerdContext<A extends AnimalSim> = GuardedHerdContext<A>;
/** Existing native sensing, terrain, contact and shared-RNG ports. */
export type HerdPorts<A extends AnimalSim> = GuardedHerdPorts<A>;
/** Legacy constructor selecting the shared grazer's real-roster pattern, without changing actor or callback identity. */
export class HerdBrain<A extends AnimalSim> extends GrazerBrain<A> {
  constructor(members: A[], spec: HerdSpec, ports: HerdPorts<A>) { super(members, { pattern: 'herd', spec, ports }); }
  /** Narrow historical string continuation; the shared core owns every saved field and validates restore. */
  override snapshot(): string { return this.snapshotHerd(); }
}
