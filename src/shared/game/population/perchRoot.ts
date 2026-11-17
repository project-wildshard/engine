import type { AnimalRigContext } from '@wildshard/engine/entities/animalRig';
import type { MixedPopulationRows } from '@wildshard/format/mixedPopulation';

/** Native root integration accepts the actual body and its owned frame delta. */
export function stepPerchBodyRoot(a: AnimalRigContext['animal'], dt: number, row: MixedPopulationRows['perch']['root']): void {
  const m = a.mem, height = m[row.height] ?? 0;
  if (m[row.drop]) {
    m[row.velocity] = (m[row.velocity] ?? 0) - row.gravity * dt; a.yOffset += (m[row.velocity] ?? 0) * dt;
    if (a.yOffset <= 0) { a.yOffset = 0; m[row.drop] = 0; m[row.velocity] = 0; m[row.land] = row.landing; }
  } else if (m[row.climb] && height > 0) {
    a.yOffset = Math.min(height, a.yOffset + row.speed * dt);
    const k = height > .01 ? a.yOffset / height : 1, bx = m[row.baseX] ?? 0, bz = m[row.baseZ] ?? 0, x = m[row.x] ?? 0, z = m[row.z] ?? 0;
    a.position.x = bx + (x - bx) * k; a.position.z = bz + (z - bz) * k;
    if (a.yOffset >= height - 1e-3) { m[row.climb] = 0; a.position.x = x; a.position.z = z; }
  }
  m[row.land] = Math.max(0, (m[row.land] ?? 0) - dt);
}

/** Native/page posing keeps its original callback and body-clock delta. */
export function stepPerchRoot(c: AnimalRigContext, row: MixedPopulationRows['perch']['root']): void {
  stepPerchBodyRoot(c.animal, c.dt, row);
}
