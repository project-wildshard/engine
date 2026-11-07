import * as THREE from 'three';

const CLEAR_PLAYER = 0.38 + 0.3;
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3();

/** What `clearBody` needs of an animal (Animal implements it). */
export interface BodyClearable {
  readonly position: THREE.Vector3;
  readonly yaw: number;
  readonly scale: number;
  readonly dims: { readonly bodyRadius: number; readonly headRadius: number };
  /** its physics body: src/shared/engine/physics/creatures.ts hands every live, shown, un-ridden animal within 45 m one */
  readonly motor: { move: (feet: THREE.Vector3, want: THREE.Vector3, ignoreGround: boolean) => void } | null;
  readonly mesh?: { readonly position: THREE.Vector3 };
  bodyCapsule: (a: THREE.Vector3, b: THREE.Vector3) => void;
  headWorld: (out: THREE.Vector3) => THREE.Vector3;
}

/**
 * E297: a big animal's body never swallows the camera. The body (rump → head, horizontally) closer to the player than its
 * own radius + CLEAR_PLAYER is moved straight back out through its physics motor, so a wall or a rock behind it stops it
 * (then the player's own knock-back does the rest). No motor, no move (E323: physics owns collision, nothing is pushed
 * blind into a wall). No motor means a ridden horse (Mount's body carries it) or a world without physics: every live,
 * shown animal near the player has one, since CreatureBodies.sync runs first in the update. True when it pushed.
 */
export function clearBody(a: BodyClearable, player: THREE.Vector3): boolean {
  const motor = a.motor;
  if (motor === null) return false;
  if (Math.abs(player.y - a.position.y) > 2.5) return false;
  a.bodyCapsule(_a, _b); a.headWorld(_c);
  // the segment rump (_a) → head (_c), flattened
  const sx = _c.x - _a.x, sz = _c.z - _a.z, len2 = sx * sx + sz * sz;
  const t = len2 > 1e-6 ? THREE.MathUtils.clamp(((player.x - _a.x) * sx + (player.z - _a.z) * sz) / len2, 0, 1) : 0;
  const qx = _a.x + sx * t, qz = _a.z + sz * t;
  let ox = qx - player.x, oz = qz - player.z;
  const dist = Math.hypot(ox, oz);
  const min = Math.max(a.dims.bodyRadius, a.dims.headRadius) * a.scale + CLEAR_PLAYER;
  if (dist >= min) return false;
  if (dist > 1e-3) { ox /= dist; oz /= dist; } else { ox = -Math.sin(a.yaw); oz = -Math.cos(a.yaw); } // dead centre: straight back
  const push = min - dist;
  const x0 = a.position.x, z0 = a.position.z, y = a.position.y;
  _d.set(ox * push, 0, oz * push);
  motor.move(a.position, _d, true);
  a.position.y = y; // the motor ignores the terrain: the animal's ground follow owns y
  if (a.mesh !== undefined) { a.mesh.position.x += a.position.x - x0; a.mesh.position.z += a.position.z - z0; } // this frame's pose already went out
  return true;
}
