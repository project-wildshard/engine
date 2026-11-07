/**
 * The sun's shadow cascades, as data a graph program can read (SHARD-PLATFORM SF59 step 2, fix 3;
 * sf59-tsl-spike.md §2.2). three's classic CSM is one DirectionalLight per cascade, and its shader chunk gates each light
 * to its own depth slice (with the fade margins); the shadow fade (shadowFade.ts, E147) mixes a ghost light's shadow into
 * cascade i's while a sun step crossfades. The sky rig registers its cascades here; a lit classic graph program takes
 * the same gate and fade through the set's `setup` (`graph/glslMaterial.ts` `gateCascades`). The TSL back-end that
 * first read this (NF18 retired it) gated each registered light the way the chunk does.
 */
import type * as THREE from 'three';
import type { CSM } from 'three/examples/jsm/csm/CSM.js';

/** one sky's cascades: the CSM, its fade ghosts (ghost i belongs to cascade i) and the fade's progress (0 old … 1 settled) */
export interface CascadeSet {
  readonly csm: CSM;
  readonly ghosts: readonly THREE.DirectionalLight[];
  readonly fade: { value: number };
  /** give a classic program the cascade gate and the fade (the sky rig's CSM chunk setup, without a family's texture slots) */
  readonly setup?: (material: THREE.Material) => void;
}


let latest: CascadeSet | null = null;
/** the sky rig's cascades (after the CSM and its fade exist); a light belongs to the last set registered for it */
export function registerCascades(set: CascadeSet): void {
  latest = set;
}

/** the newest registered sky's cascades (a classic graph program gates its sun by them), or null */
export function latestCascades(): CascadeSet | null { return latest; }
