import type { AnimalSim } from '../../../shared/engine/entities/AnimalSim';
import { StalkerBrain } from '../../../shared/engine/ai/stalker';
import * as law from '../../../shared/engine/ai/huntPattern';

import type { Vector3 } from 'three';

/** Historical species hunt tuning; native presets and all overrides remain exact. */
export type HuntTuning = law.HuntTuning;
/** Original deer preset, retaining object identity and every numeric bit. */
export const DEER_TUNING: law.HuntTuning = law.DEER_TUNING;
/** Original charger preset, retaining object identity and every numeric bit. */
export const BOAR_TUNING: law.HuntTuning = law.BOAR_TUNING;
/** Original committed-contact arc in radians. */
export const CHARGE_ARC: number = law.CHARGE_ARC;
/** Original hurt acceptance arc in radians. */
export const HURT_ARC: number = law.HURT_ARC;
/** Original native attack turn rate. */
export const ATTACK_TURN: 1.5 = law.ATTACK_TURN;
/** Historical registered sound selection; no new fallback content. */
export const fallbackSound: (charger: boolean, which: "call" | "hurt") => string = law.fallbackSound;
/** Native hunt body and the original nondrawing slope-sample capability. */
export interface HuntBody extends AnimalSim { readonly hidden: boolean; sampleTerrain: () => void }
/** Historical ordered herd/centre continuation. */
export type HuntHerd<A extends HuntBody> = law.HuntHerd<A>;
/** Native tree collision observation. */
export type HuntTree = law.HuntTree;
/** Native ground/water/canopy authority. */
export type HuntGround = law.HuntGround;
/** Native navigation authority. */
export type HuntNav = law.HuntNav;
/** Original hunt ports; the constructor binds the real body's slope sampler. */
export type HuntPorts<A extends HuntBody> = law.HuntPorts<A>;
/** Original RNG, fight, tuning and species authority. */
export type HuntConfig = law.HuntConfig;
/** Exact renderer-free species fields observed by the native hunt. */
export type HuntSpecies = law.HuntSpecies;
/** Historical spawn roll result and order. */
export type SpawnRolls = law.SpawnRolls;
/** Original shared-stream spawn rolls; no wrapper or extra draw. */
export const spawnRolls: typeof law.spawnRolls = law.spawnRolls;
/** Historical manager constructor selecting the stalker's complete hunt pattern, over real bodies. */
export class HuntBrain<A extends HuntBody> extends StalkerBrain<A> {
  constructor(config: HuntConfig, ports: HuntPorts<A>, player: Vector3) {
    super({ pattern: 'hunt', config, ports, player, sampleTerrain: actor => { actor.sampleTerrain(); } });
  }
}
