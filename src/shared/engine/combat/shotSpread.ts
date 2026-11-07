import type { Vector3 } from 'three';

/** A cone's radial distribution and the authored multiplier on each random transverse component. */
export interface ShotCone { readonly radius: 'linear' | 'sqrt'; readonly axisScale: 1 | 2 }

/** A shot's own draws off the wire (P1-E5.3-E4): the client flies its shot at once and the server settles it, so both draw from
 *  its command `seq` (mulberry32). A shot with no seq keeps its world's stream, as a page and a tape always have. */
export function shotRandom(seq: number): () => number {
  let state = Math.imul(seq, 0x9e3779b1);
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

/** Apply the shipping cone arithmetic in place. Exactly four ordered draws, including a zero-width cone.
 * The caller supplies a unit direction and scratch transverse vector; no world, content or random stream is read. */
export function shotSpread(direction: Vector3, radians: number, random: () => number, cone: ShotCone, transverse: Vector3): void {
  transverse.set((random() - 0.5) * cone.axisScale, (random() - 0.5) * cone.axisScale,
    (random() - 0.5) * cone.axisScale).cross(direction).normalize();
  const radius = random();
  direction.addScaledVector(transverse, Math.tan(radians * (cone.radius === 'sqrt' ? Math.sqrt(radius) : radius))).normalize();
}

/** Drawn-weapon cone width in degrees, with authored hip/motion widths and an explicit aiming multiplier. */
export function drawnSpreadDegrees(hip: number, aimMultiplier: number, aimBlend: number,
  motion: number, speedFactor: number, extra: number, mounted: number): number {
  return hip * (1 - (1 - aimMultiplier) * aimBlend) + motion * speedFactor + extra + mounted;
}

/** Instant-shot cone width in degrees. The caller supplies its already eased aiming blend. */
export function instantSpreadDegrees(ads: number, hip: number, aimBlend: number, bloom: number,
  speedFactor: number, motion: number, motionAimReduction: number): number {
  return ads + (1 - aimBlend) * hip + bloom * (1 - aimBlend * 0.7)
    + speedFactor * motion * (1 - aimBlend * motionAimReduction);
}
