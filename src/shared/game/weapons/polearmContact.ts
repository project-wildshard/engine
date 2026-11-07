import * as THREE from 'three';
import type { TargetAnimal, TargetHit } from '@wildshard/engine/combat/types';

/** The held polearm's contact law, renderer-free (CI12): the thrust's fan of rays from the aim pose and the lance's ray to
 *  its target, through the targets' raycast and the combat hit, with the stagger, the decision's bookkeeping and the hit
 *  events. The page's HeldPolearm and the Node simulation call the same owner with the same aim pose; no view, no FX. */

/** What the owner touches: the targets' raycast (null: no targets), the combat hit (`Melee.contact`: null when the
 *  pipeline refuses it), whether a struck animal is the lance's aimed target, and the hit's events (kill feed, impact). */
export interface PolearmContactPorts<T> {
  readonly raycast: ((origin: THREE.Vector3, dir: THREE.Vector3, max: number) => TargetHit | null) | null;
  readonly contact: (animal: TargetAnimal, amount: number, point: THREE.Vector3, dir: THREE.Vector3, from: THREE.Vector3,
    moveId: 'move.thrust' | 'move.lance') => { readonly killed: boolean } | null;
  readonly same: (animal: TargetAnimal, target: T) => boolean;
  readonly struck: (hit: TargetHit, killed: boolean) => void;
}
/** The decision's share: the thrust's one hit a stroke, and the lance's per-target rehit clock (PolearmDecision). */
export interface PolearmContactDecision<T> { hitDone: boolean; readonly struck: (target: T, t: number) => void }
/** The profile numbers the thrust reads. */
export interface PolearmThrustProfile {
  readonly reach: number;
  readonly thrust: { readonly damage: number; readonly stagger: number; readonly fan: { readonly pitches: readonly number[]; readonly yaws: readonly number[] } };
}
/** A lance target: where it stands, its body height and scale. */
export interface PolearmLanceTarget { readonly position: THREE.Vector3; readonly scale?: number; readonly dims?: { readonly bodyY?: number } }

const _e = new THREE.Euler(), _q = new THREE.Quaternion(), _dir = new THREE.Vector3(), _at = new THREE.Vector3(), _push = new THREE.Vector3();

export class PolearmContact<T extends PolearmLanceTarget> {
  private readonly ports: PolearmContactPorts<T>;
  private readonly decision: PolearmContactDecision<T>;
  constructor(ports: PolearmContactPorts<T>, decision: PolearmContactDecision<T>) { this.ports = ports; this.decision = decision; }

  /** The thrust's strike from the aim pose (`origin`, `rotation`, its forward `forward`): the fan's rays in order, pitch
   *  then yaw, out to the reach; the first living animal the combat hit accepts is staggered along the aim and marks the
   *  stroke done. The struck hit, or null. */
  thrust(origin: THREE.Vector3, rotation: THREE.Quaternion, forward: THREE.Vector3, profile: PolearmThrustProfile): { readonly hit: TargetHit; readonly killed: boolean } | null {
    const raycast = this.ports.raycast;
    if (raycast === null) return null;
    _e.set(0, 0, 0, 'YXZ');
    for (const pitch of profile.thrust.fan.pitches) for (const yaw of profile.thrust.fan.yaws) {
      _e.y = yaw; _e.x = pitch;
      _q.setFromEuler(_e); _q.premultiply(rotation);
      _dir.set(0, 0, -1).applyQuaternion(_q);
      const hit = raycast(origin, _dir, profile.reach);
      if (!hit || !hit.animal.alive) continue;
      const result = this.ports.contact(hit.animal, profile.thrust.damage, hit.point, forward, origin, 'move.thrust');
      if (!result) continue;
      const killed = result.killed;
      if (!killed) hit.animal.stagger?.(_push.set(forward.x, 0, forward.z).normalize(), profile.thrust.stagger);
      this.decision.hitDone = true;
      this.ports.struck(hit, killed);
      return { hit, killed };
    }
    return null;
  }

  /** The lance's contact with `target` at `t` (the decision chose it and its `damage`): a ray from the aim `origin` to
   *  the target's body; when the first animal on it is the target and the combat hit accepts, the rehit clock starts and
   *  the target is staggered away from the rider at `player`. The struck hit, or null. */
  lance(origin: THREE.Vector3, target: T, damage: number, t: number, player: THREE.Vector3): { readonly hit: TargetHit; readonly killed: boolean } | null {
    _at.set(target.position.x, target.position.y + (target.dims?.bodyY ?? 0.6) * (target.scale ?? 1), target.position.z);
    _dir.subVectors(_at, origin); const len = _dir.length(); _dir.multiplyScalar(1 / Math.max(len, 0.0001));
    const hit = this.ports.raycast?.(origin, _dir, len + 1) ?? null;
    if (hit === null || !this.ports.same(hit.animal, target)) return null;
    const result = this.ports.contact(hit.animal, damage, hit.point, _dir, origin, 'move.lance');
    if (!result) return null;
    this.decision.struck(target, t);
    if (!result.killed) hit.animal.stagger?.(_push.set(target.position.x - player.x, 0, target.position.z - player.z).normalize(), 1);
    this.ports.struck(hit, result.killed);
    return { hit, killed: result.killed };
  }
}
