import { expect, test } from 'vitest';
import { stepFigureOrbit, type FigureOrbitRow } from './figureOrbit';

/** figures.ts's walk as it was inline before the kernel (the reference the page drew by) */
function inline(orbit: FigureOrbitRow, p: { phase: number; ring: number; idleYaw: number; talking: boolean }, feet: { x: number; y: number; z: number },
  dt: number, distance: number, floorAt: (x: number, z: number) => number): boolean {
  if (distance >= orbit.stopDistance && !p.talking) {
    p.ring += dt * orbit.speed;
    const x = orbit.x + Math.cos(p.ring) * orbit.radius, z = orbit.z + Math.sin(p.ring) * orbit.radius;
    const y = floorAt(x, z) + Math.abs(Math.sin(p.phase * orbit.frequency)) * orbit.lift;
    feet.x = x; feet.y = y; feet.z = z;
    p.idleYaw = Math.atan2(-Math.sin(p.ring), Math.cos(p.ring));
    return true;
  }
  feet.y += (floorAt(feet.x, feet.z) - feet.y) * (1 - Math.exp(-10 * dt));
  return false;
}

test('the orbit kernel walks, stops, bobs and settles exactly as the inline walk did', () => {
  const orbit: FigureOrbitRow = { x: 12.5, z: -40, radius: 4.5, speed: 0.6, stopDistance: 5, frequency: 7.5, lift: 0.08 };
  const floorAt = (x: number, z: number): number => Math.sin(x * 0.3) * 0.7 + Math.cos(z * 0.2) * 0.4;
  const a = { phase: 0.3, ring: 0, idleYaw: 1, talking: false }, b = { ...a };
  const fa = { x: 13, y: 0, z: -38 }, fb = { ...fa };
  let seed = 7;
  const rnd = (): number => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  let walked = 0;
  for (let frame = 0; frame < 2000; frame++) {
    const dt = rnd() < 0.05 ? 0.25 : 1 / 30, distance = rnd() * 12;
    a.phase += dt; b.phase += dt; a.talking = b.talking = frame % 300 > 240;
    const ra = inline(orbit, a, fa, dt, distance, floorAt), rb = stepFigureOrbit(orbit, b, fb, dt, distance, floorAt);
    expect(rb).toBe(ra); if (ra) walked++;
    expect(b).toEqual(a); expect(fb).toEqual(fa);
  }
  expect(walked).toBeGreaterThan(500); expect(walked).toBeLessThan(1900);
});
