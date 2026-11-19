import type { AnimalPoseSample, AnimalSim } from '../entities/AnimalSim';
import { ANIMAL } from '@wildshard/wire/classes';
import { bindClass, type NetSchema } from './schema';

/** One creature's per-tick read: the sim, its sampled pose and its strike target. A reused buffer, never kept. */
export interface AnimalNetView { sim: AnimalSim; readonly pose: AnimalPoseSample; target: string | null; rideable: boolean;
  /** MMO-PLAN MP5.2b: a home cell's creature shown on its road, whose place goes as a road place (`roadX`/`roadZ`). */
  readonly road?: boolean }

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
  // ONE-FORMAT CC28: the actor channels a script sets, and its lock answer, for every page's look and lock.
  channel1: view => view.sim.channels[0],
  channel2: view => view.sim.channels[1],
  channel3: view => view.sim.channels[2],
  channel4: view => view.sim.channels[3],
  lockable: view => view.sim.lockOverride === null ? 'row' : view.sim.lockOverride ? 'on' : 'off',
  // MMO-PLAN MP5.2b: on a road (frame 0, the world's) `x`/`z` clamp at ±260 m, so a creature shown there says its place here. Zero in a cell.
  roadX: view => view.road === true ? view.sim.position.x : 0,
  roadZ: view => view.road === true ? view.sim.position.z : 0,
  // ONE-FORMAT CC11a2c: the declared ability it runs (1-based in its species' abilities, 0 none) and how far through.
  ability: view => view.sim.abilityIndex,
  abilityT: view => view.sim.abilityIndex === 0 ? 0 : view.sim.runningAbility?.progress ?? 0,
});
