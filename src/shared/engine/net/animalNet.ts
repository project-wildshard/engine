import type { AnimalPoseSample, AnimalSim } from '../entities/AnimalSim';
import { ANIMAL } from '@wildshard/wire/classes';
import { bindClass, type NetSchema } from './schema';

/** One creature's per-tick read: the sim, its sampled pose and its strike target. A reused buffer, never kept. */
export interface AnimalNetView { sim: AnimalSim; readonly pose: AnimalPoseSample; target: string | null; rideable: boolean }

// P1-E5.2 (E5-REPLICATION §3.2): the fields a creature view needs, declared in `@wildshard/wire` (WR2). Positions are
// cell-local over ±260 m in 16 bits, an 8 mm step (§3.5). Everything else on AnimalSim (AI memory, strike runners, RNG)
// stays on the server.
/** How far through its strike a creature is: 0 between strikes, which `state` tells apart from a strike's start. */
const strike = (pose: AnimalPoseSample): number => pose.attackT < 0 || pose.attackDur <= 0 ? 0 : pose.attackT / pose.attackDur;

/** The `animal` class. Species, variant and look travel once as initial fields; the rest are delta rows. */
export const ANIMAL_NET: NetSchema<AnimalNetView> = bindClass<AnimalNetView, typeof ANIMAL>(ANIMAL, {
  x: view => view.sim.position.x,
  y: view => view.sim.position.y,
  z: view => view.sim.position.z,
  yaw: view => view.sim.yaw,
  state: view => view.sim.state,
  attackT: view => strike(view.pose),
  // A strike's duration is one decision, not a pose scalar to blend.
  attackDur: view => Math.round(view.pose.attackDur * 1000),
  attackStamp: view => view.sim.attackStamp,
  winding: view => view.pose.attackT >= 0 && view.pose.attackT < view.pose.attackDur,
  flinch: view => view.pose.flinch,
  strafe: view => view.sim.strafe,
  brace: view => view.pose.brace,
  hp: view => Math.ceil(view.sim.hp),
  alive: view => view.sim.alive,
  target: view => view.target,
  rideable: view => view.rideable,
  // What a view reads of a brain that lifts a body out of the ground and counts its acts: its pose, lights and cues.
  rise: view => { const { mem } = view.sim; return mem['init'] === 1 ? Math.min(1, Math.max(0, mem['rise'] ?? 0)) : 0; },
  act: view => view.sim.mem['st'] ?? 0,
  kind: view => view.sim.kind,
  variant: view => view.sim.variant,
  rarity: view => view.sim.rarity,
  scale: view => view.sim.scale,
  seed: view => view.sim.seed,
  // TE-ENG7: two declared species may share a kind; a remote page draws each by its own id.
  species: view => view.sim.species,
});
