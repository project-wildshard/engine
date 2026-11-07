/**
 * VIEW IN WORLD's eye (E342): where the World Explorer camera lands to show one copy of a model. The old framing — a
 * three-quarter view 2.2 r out and 0.9 r up, r the copy's bounding sphere (at least 3 m) — stood the camera inside Nine
 * Dragon's stack, a metre from a wall or a pipe, so the copy was hidden and a tap at the centre picked the wall (6 / 20).
 *
 *   const eyes = viewCandidates(box);                     // the old framing first, then rings round the copy
 *   const i = firstView(eyes, (eye) => clear(eye));       // the first that passes, in that order (-1: none)
 *   physicsClear(physics, eye, look, box)                 // no collider at the eye or on the way to the copy
 *   roundBlocker(indices, eyes, look, hit)                // the landed search's order round what the centre hit (E345)
 *
 * The candidates: the old framing's distance, then 60 % and 35 % of it (never inside the copy's box), each at the old
 * 22° elevation, 43°, 5° and 69°, each round eight headings — the old one first, then ±45°, ±90°, ±135°, 180°. The old
 * framing stays wherever it is clear (the other shards keep their views); a blocked one moves round the copy, then up,
 * then in. Explore.viewInWorld tests them twice: with the colliders and the drawn-into copy boxes (both whole, whatever
 * the cullers draw) when the flight starts, and with a tap's own pick once it lands.
 */
import * as THREE from 'three';
import type { Physics } from '../../../shared/engine/physics/Physics';
import { castSegment, sweepBall } from '../../../shared/engine/physics/query';

/** the old framing (Explore.viewInWorld before E342): heading 0.7 rad, 2.2 r out, 0.9 r up, r at least 3 m */
const YAW0 = 0.7, OUT = 2.2, UP = 0.9, MIN_R = 3;
/** the rings, in the order they are tried: [share of the old distance, elevation (rad)] */
const RINGS: readonly (readonly [number, number])[] = [
  [1, Math.atan2(UP, OUT)], [1, 0.75], [0.6, Math.atan2(UP, OUT)], [0.6, 0.75], [1, 0.08], [0.6, 0.08],
  [0.35, Math.atan2(UP, OUT)], [0.35, 0.75], [0.35, 0.08], [1, 1.2], [0.6, 1.2], [0.35, 1.2],
];
/** heading offsets from the old one, nearest first */
const TURNS: readonly number[] = [0, 1, -1, 2, -2, 3, -3, 4].map((k) => (k * Math.PI) / 4);
/** metres the eye keeps from the copy's box (a candidate nearer is moved out to it) */
const OFF_BOX = 1;
/** the ball round the eye that must touch nothing on the first stretch toward the copy, metres */
export const EYE_CLEAR = 0.35;

const _s = new THREE.Sphere();

/** every eye VIEW IN WORLD may use for the copy `box`, in preference order: the old framing first */
export function viewCandidates(box: THREE.Box3): THREE.Vector3[] {
  const look = box.getCenter(new THREE.Vector3()), real = box.getBoundingSphere(_s).radius;
  const r = Math.max(MIN_R, real), far = r * Math.hypot(OUT, UP);
  const out: THREE.Vector3[] = [];
  for (const [share, elev] of RINGS) {
    const d = Math.max(far * share, real + OFF_BOX);
    for (const turn of TURNS) {
      const yaw = YAW0 + turn, flat = d * Math.cos(elev);
      out.push(new THREE.Vector3(look.x + Math.sin(yaw) * flat, look.y + d * Math.sin(elev), look.z + Math.cos(yaw) * flat));
    }
  }
  return out;
}

/** the index of the first of `eyes` `ok` accepts, trying them in order; -1 when none does (or `budgetMs` ran out) */
export function firstView(eyes: readonly THREE.Vector3[], ok: (eye: THREE.Vector3, i: number) => boolean, budgetMs: number = Number.POSITIVE_INFINITY, skip = -1): number {
  const t0 = performance.now();
  for (let i = 0; i < eyes.length; i++) {
    const eye = eyes[i];
    if (i === skip || eye === undefined) continue;
    if (ok(eye, i)) return i;
    if (performance.now() - t0 > budgetMs) return -1;
  }
  return -1;
}

const _ray = new THREE.Ray(), _hit = new THREE.Vector3(), _to = new THREE.Vector3();

/** metres from `eye` along the line to `look` until it enters `box` (0: the eye is in it; Infinity: the line misses it) */
export function boxEntry(eye: THREE.Vector3, look: THREE.Vector3, box: THREE.Box3): number {
  if (box.containsPoint(eye)) return 0;
  _ray.origin.copy(eye); _ray.direction.subVectors(look, eye).normalize();
  return _ray.intersectBox(box, _hit) === null ? Number.POSITIVE_INFINITY : _hit.distanceTo(eye);
}

/**
 * The colliders let `eye` see the copy `box` (centred on `look`): the eye stands clear of every world collider (a ball of
 * EYE_CLEAR over most of the way in) and nothing is hit on the line before it enters the box (the copy's own colliders
 * are inside it). An eye in the box, or past the box's far side, fails.
 */
export function physicsClear(physics: Physics, eye: THREE.Vector3, look: THREE.Vector3, box: THREE.Box3): boolean {
  const entry = boxEntry(eye, look, box);
  if (!Number.isFinite(entry) || entry < OFF_BOX * 0.5) return false;
  _to.subVectors(look, eye).normalize();
  const ballTo = _to.clone().multiplyScalar(Math.max(0.01, entry * 0.7 - EYE_CLEAR)).add(eye);
  if (sweepBall(physics, eye, ballTo, EYE_CLEAR) !== null) return false;
  const hit = castSegment(physics, eye, _to.multiplyScalar(entry).add(eye));
  return hit === null || hit.distance >= entry - 0.1;
}

const _toward = new THREE.Vector3(), _d = new THREE.Vector3();

/**
 * The landed search round a blocker (E345): `indices` into `eyes` ordered from the eye looking most away from `blocker` —
 * the point a centre tap hit in front of the copy at `look` (a market booth's canopy over a scooter) — to the one looking
 * straight past it, so the search reaches the eyes under the canopy's far edge before the rest of the ring above it
 * (VIEW_TRIES caps the search). Ties keep their order.
 */
export function roundBlocker(indices: readonly number[], eyes: readonly THREE.Vector3[], look: THREE.Vector3, blocker: THREE.Vector3): number[] {
  _toward.subVectors(blocker, look).normalize();
  const facing = (i: number): number => { const eye = eyes[i]; return eye === undefined ? 1 : _d.subVectors(eye, look).normalize().dot(_toward); };
  return indices.map((i) => ({ i, f: facing(i) })).sort((a, b) => a.f - b.f).map((x) => x.i);
}
