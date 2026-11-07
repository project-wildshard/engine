// CI12 Nalati Qara Batyr: the patrol riders' joint spheres split out of PatrolEncounterView.target (nearestJointHit,
// renderer-free) find exactly the rider, distance, headshot flag and entry point the page's inline loop found.
import { expect, test } from 'vitest';
import * as THREE from 'three';
import { nearestJointHit, type JointActor } from '../src/shared/game/boss/jointTargets';

interface Rider { readonly a: JointActor & { readonly id: number }; readonly dead: boolean; readonly bone: THREE.Object3D }
const rows = [{ at: [0, 1.6, 0] as [number, number, number], radius: .22, head: true }, { at: [0, 1.1, .1] as [number, number, number], radius: .35, head: false },
  { at: [0, .6, -.2] as [number, number, number], radius: .45, head: false }];

/** PatrolEncounterView.target's loop before the split (encounterView.ts, before CI12) */
function inline(riders: readonly Rider[], origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number, prior: number | null, point: THREE.Vector3) {
  const ray = new THREE.Ray(), sphere = new THREE.Sphere(), crossing = new THREE.Vector3();
  let best = prior === null ? maxDist : Math.min(maxDist, prior), found: Rider['a'] | null = null, head = false;
  ray.set(origin, dir);
  for (const r of riders) {
    if (r.dead || !r.a.alive || r.a.hidden || r.a.position.distanceToSquared(origin) > (best + 4) * (best + 4)) continue;
    for (const row of rows) {
      sphere.set(sphere.center.set(...row.at).applyMatrix4(r.bone.matrixWorld), row.radius * r.a.scale);
      if (ray.intersectSphere(sphere, crossing) === null) continue;
      const d = crossing.distanceTo(origin);
      if (d < best) { best = d; found = r.a; head = row.head; point.copy(crossing); }
    }
  }
  return found === null ? null : { actor: found, distance: best, head };
}

test('the split joint spheres find the same rider, distance, head flag and point as the page', () => {
  let seed = 5; const rand = (): number => { seed = (seed * 1103515245 + 12345) >>> 0; return seed / 2 ** 32; };
  let hits = 0, heads = 0, misses = 0;
  for (let n = 0; n < 3000; n++) {
    const riders: Rider[] = Array.from({ length: 1 + (n % 5) }, (_, i) => {
      const bone = new THREE.Object3D(); bone.position.set(rand() * 12 - 6, rand() * 2, rand() * 12 - 6); bone.rotation.set(rand() * .4, rand() * 6, rand() * .4);
      bone.updateMatrixWorld(true);
      return { a: { id: i, alive: (n + i) % 7 !== 0, ...(i % 4 === 3 ? { hidden: true } : {}), position: bone.position.clone(), scale: .8 + rand() * .6 }, dead: (n + i) % 11 === 0, bone };
    });
    // a twin rider on the same spot: the first in order keeps an equal distance
    if (n % 9 === 0) { const first = riders[0]; if (first !== undefined) riders.push({ ...first, a: { ...first.a, id: 99 } }); }
    const aim = riders[n % riders.length]?.bone.position ?? new THREE.Vector3();
    const origin = new THREE.Vector3(rand() * 20 - 10, 1.5, rand() * 20 - 10), dir = aim.clone().add(new THREE.Vector3(rand() - .5, rand() * 1.5, rand() - .5)).sub(origin).normalize();
    const maxDist = 5 + rand() * 25, prior = n % 3 === 0 ? null : rand() * 30;
    const p0 = new THREE.Vector3(1, 2, 3), p1 = p0.clone();
    const want = inline(riders, origin, dir, maxDist, prior, p0);
    const got = nearestJointHit(new THREE.Ray(origin, dir), prior === null ? maxDist : Math.min(maxDist, prior), riders,
      { actor: r => r.a, dead: r => r.dead, joint: (r, at, out) => out.set(...at).applyMatrix4(r.bone.matrixWorld) }, rows, p1);
    expect(got).toEqual(want); expect(got?.actor).toBe(want?.actor); expect(p1.toArray()).toEqual(p0.toArray());
    if (want === null) misses++; else { hits++; if (want.head) heads++; }
  }
  expect(hits).toBeGreaterThan(300); expect(heads).toBeGreaterThan(30); expect(misses).toBeGreaterThan(300);
});
