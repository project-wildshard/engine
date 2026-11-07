/**
 * FC11 (MF7b, G896): how often an animal's bones are posed, by its distance from the camera. Every update within 30 m, every
 * 2nd from 30 m, every 4th from 70 m to the animation range (AnimalManager's ANIM_LOD); its root (position, facing) moves
 * every update at every distance, so only the legs' cycle steps (15 / 7.5 Hz at the phone's 30). G954 keeps this cadence.
 */
const FULL = 30, HALF = 70;
export function poseEvery(distanceSquared: number): number {
  return distanceSquared < FULL * FULL ? 1 : distanceSquared < HALF * HALF ? 2 : 4;
}
