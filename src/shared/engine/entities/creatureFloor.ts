import type { Physics } from '../physics/Physics';
import { castRay } from '../physics/query';
import { heightAt } from '../world/Heightfield';

/** WORLD floors only; the terrain heightfield retains its exact analytic wildlife sampling. */
export function creatureFloor(physics: Physics | null, x: number, z: number, fromY: number): { y: number; structure: boolean } {
  const terrain = heightAt(x, z);
  if (physics === null) return { y: terrain, structure: false };
  const hit = castRay(physics, { x, y: fromY, z }, { x: 0, y: -1, z: 0 }, Math.max(201, fromY - terrain + 1), ['WORLD']);
  if (hit === null) return { y: terrain, structure: false };
  if (hit.material === 'ground' && hit.collider.shape.type === physics.R.ShapeType.HeightField) return { y: terrain, structure: false };
  return { y: hit.point.y, structure: true };
}
