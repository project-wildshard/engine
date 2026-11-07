/**
 * A patrol rider's joint target spheres, renderer-free (CI12: the Nalati native Qara tape hits the same rider spheres the
 * page does): the nearest sphere a ray crosses, nearer than an earlier hit, among living, shown riders within reach. The
 * page's `PatrolEncounterView.target` reads its drawn bones through this; a native host passes its own joint reads.
 *
 *   const hit = nearestJointHit(ray, best, riders, { actor: r => r.a, dead: r => …, joint: (r, at, out) => … }, rows.targets, point);
 */
import * as THREE from 'three';
import type { PatrolViewRows } from '@wildshard/format/encounterRows';

/** what the hit reads of a rider's body */
export interface JointActor { readonly alive: boolean; readonly hidden?: boolean | undefined; readonly position: THREE.Vector3; readonly scale: number }
/** how a host reads its riders: the body, whether its law has it dead, and a joint offset `at` in world space (into `out`) */
export interface JointPorts<R, A extends JointActor> {
  readonly actor: (rider: R) => A;
  readonly dead: (rider: R) => boolean;
  readonly joint: (rider: R, at: readonly [number, number, number], out: THREE.Vector3) => THREE.Vector3;
}
export interface JointHit<A> { readonly actor: A; readonly distance: number; readonly head: boolean }

const sphere = new THREE.Sphere(), crossing = new THREE.Vector3();

/** The nearest target sphere (`rows`, scaled by the rider) that `ray` crosses closer than `nearer` m, among riders that are
 *  alive, shown, not dead in their law and within (the nearest so far) + 4 m of the ray's origin, in rider then row order (a later equal
 *  distance never wins). Null when none is nearer; `point` then keeps its value, else it is where the ray enters the sphere. */
export function nearestJointHit<R, A extends JointActor>(ray: THREE.Ray, nearer: number, riders: Iterable<R>, ports: JointPorts<R, A>,
  rows: PatrolViewRows['targets'], point: THREE.Vector3): JointHit<A> | null {
  const origin = ray.origin;
  let best = nearer, found: A | null = null, head = false;
  for (const r of riders) {
    const a = ports.actor(r);
    if (ports.dead(r) || !a.alive || a.hidden || a.position.distanceToSquared(origin) > (best + 4) * (best + 4)) continue;
    for (const row of rows) {
      ports.joint(r, row.at, sphere.center); sphere.radius = row.radius * a.scale;
      if (ray.intersectSphere(sphere, crossing) === null) continue;
      const d = crossing.distanceTo(origin);
      if (d < best) { best = d; found = a; head = row.head; point.copy(crossing); }
    }
  }
  return found === null ? null : { actor: found, distance: best, head };
}
