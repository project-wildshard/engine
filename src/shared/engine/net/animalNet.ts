import { ANIMAL_STATES } from '../entities/animalStates';
import type { AnimalPoseSample, AnimalSim } from '../entities/AnimalSim';
import { netSchema, type NetSchema } from './schema';

/** One creature's per-tick read: the sim, its sampled pose and its strike target. A reused buffer, never kept. */
export interface AnimalNetView { sim: AnimalSim; readonly pose: AnimalPoseSample; target: string | null; rideable: boolean }

// P1-E5.2 (E5-REPLICATION §3.2): the fields a creature view needs. Positions are cell-local over ±260 m in 16 bits, an
// 8 mm step (§3.5). Everything else on AnimalSim (AI memory, strike runners, RNG) stays on the server.
const metres = { kind: 'f32q', min: -260, max: 260, bits: 16 } as const;
/** How far through its strike a creature is: 0 between strikes, which `state` tells apart from a strike's start. */
const strike = (pose: AnimalPoseSample): number => pose.attackT < 0 || pose.attackDur <= 0 ? 0 : pose.attackT / pose.attackDur;

/** The `animal` class. Species, variant and look travel once as initial fields; the rest are delta rows. */
export const ANIMAL_NET: NetSchema<AnimalNetView> = netSchema<AnimalNetView>({
  cls: 'animal',
  relevance: { radius: 160 },
  fields: {
    x: { ...metres, read: view => view.sim.position.x },
    y: { ...metres, read: view => view.sim.position.y },
    z: { ...metres, read: view => view.sim.position.z },
    yaw: { kind: 'angle', bits: 10, read: view => view.sim.yaw },
    state: { kind: 'enum', values: ANIMAL_STATES, read: view => view.sim.state },
    attackT: { kind: 'f32q', min: 0, max: 1, bits: 8, read: view => strike(view.pose) },
    attackDur: { kind: 'f32', read: view => view.pose.attackDur },
    attackStamp: { kind: 'u32', read: view => view.sim.attackStamp },
    winding: { kind: 'bool', read: view => view.pose.attackT >= 0 && view.pose.attackT < view.pose.attackDur },
    flinch: { kind: 'f32q', min: 0, max: 1, bits: 6, read: view => view.pose.flinch },
    strafe: { kind: 'f32q', min: -9, max: 9, bits: 8, read: view => view.sim.strafe },
    brace: { kind: 'f32q', min: 0, max: 1, bits: 6, read: view => view.pose.brace },
    hp: { kind: 'u16', read: view => Math.ceil(view.sim.hp) },
    alive: { kind: 'bool', read: view => view.sim.alive },
    target: { kind: 'ref', read: view => view.target },
    rideable: { kind: 'bool', read: view => view.rideable },
    // What a view reads of a brain that lifts a body out of the ground and counts its acts: its pose, lights and cues.
    rise: { kind: 'f32q', min: 0, max: 1, bits: 6, read: view => { const { mem } = view.sim; return mem['init'] === 1 ? Math.min(1, Math.max(0, mem['rise'] ?? 0)) : 0; } },
    act: { kind: 'u8', read: view => view.sim.mem['st'] ?? 0 },
    kind: { kind: 'text', send: 'initial', read: view => view.sim.kind },
    variant: { kind: 'text', send: 'initial', read: view => view.sim.variant },
    rarity: { kind: 'text', send: 'initial', read: view => view.sim.rarity },
    scale: { kind: 'f32', send: 'initial', read: view => view.sim.scale },
    seed: { kind: 'u32', send: 'initial', read: view => view.sim.seed },
  },
});
