import { Euler, Quaternion } from 'three';
import type { Physics } from './Physics';
import { groups } from './groups';
import { tagCollider, tagOf } from './surface';

/** Local boxes for a script-owned platform; the physics layer alone constructs Rapier descriptors. */
export interface MoverBox { x: number; y: number; z: number; hx: number; hy: number; hz: number; rot: { x: number; y: number; z: number; w: number } }
/** Published mover pose, in the world's local frame; Euler order is always YXZ. */
export interface MoverPose { position: { x: number; y: number; z: number }; euler: { x: number; y: number; z: number }; enabled: boolean }
/** A kinematic deck moves before the world step and carries the existing CharacterMotor without another collision path. */
export class KinematicMover {
  readonly body: ReturnType<Physics['world']['getRigidBody']>;
  private readonly physics: Physics;
  private readonly q = new Quaternion();
  private readonly e = new Euler(0, 0, 0, 'YXZ');
  private enabled: boolean;
  constructor(physics: Physics, boxes: readonly MoverBox[], pose: MoverPose, owner: unknown = null, fixed = false, restoredHandle?: number) {
    if (boxes.length === 0 || boxes.length > 128 || boxes.some((box) => ![box.x, box.y, box.z, box.hx, box.hy, box.hz, box.rot.x, box.rot.y, box.rot.z, box.rot.w].every(Number.isFinite) || Math.min(box.hx, box.hy, box.hz) <= 0 || Math.abs(Math.hypot(box.rot.x, box.rot.y, box.rot.z, box.rot.w) - 1) > 1e-5)
      || ![pose.position.x, pose.position.y, pose.position.z, pose.euler.x, pose.euler.y, pose.euler.z].every(Number.isFinite)) throw new Error('Invalid mover primitive');
    this.physics = physics; this.enabled = pose.enabled;
    this.q.setFromEuler(this.e.set(pose.euler.x, pose.euler.y, pose.euler.z, 'YXZ'));
    if (restoredHandle !== undefined) {
      if (!Number.isFinite(restoredHandle) || restoredHandle < 0 || !physics.world.bodies.contains(restoredHandle)) throw new Error('Missing restored mover body');
      this.body = physics.world.getRigidBody(restoredHandle);
      if (this.body.handle !== restoredHandle) throw new Error('Missing restored mover body');
      if (this.body.isFixed() !== fixed || (!fixed && this.body.bodyType() !== physics.R.RigidBodyType.KinematicPositionBased) || this.body.numColliders() !== boxes.length) throw new Error('Restored mover body differs from declaration');
      for (let i = 0; i < boxes.length; i++) {
        const box = boxes[i], collider = this.body.collider(i), half = collider.halfExtents(), at = collider.translationWrtParent(), rotation = collider.rotationWrtParent();
        if (box === undefined || half === null || at === null || rotation === null || collider.shape.type !== physics.R.ShapeType.Cuboid
          || tagOf(collider)?.owner !== owner || tagOf(collider)?.material !== 'wood' || collider.collisionGroups() !== groups('WORLD')
          || [half.x - box.hx, half.y - box.hy, half.z - box.hz, at.x - box.x, at.y - box.y, at.z - box.z,
            rotation.x - box.rot.x, rotation.y - box.rot.y, rotation.z - box.rot.z, rotation.w - box.rot.w].some(delta => Math.abs(delta) > 1e-5)) throw new Error('Restored mover collider differs from declaration');
      }
      this.enabled = Array.from({ length: boxes.length }, (_unused, index) => this.body.collider(index).isEnabled()).every(Boolean);
    } else {
      const desc = fixed ? physics.R.RigidBodyDesc.fixed() : physics.R.RigidBodyDesc.kinematicPositionBased();
      this.body = physics.world.createRigidBody(desc.setTranslation(pose.position.x, pose.position.y, pose.position.z).setRotation(this.q));
      for (const box of boxes) { const c = physics.world.createCollider(physics.R.ColliderDesc.cuboid(box.hx, box.hy, box.hz).setTranslation(box.x, box.y, box.z).setRotation(box.rot).setCollisionGroups(groups('WORLD')).setFriction(0.9), this.body); tagCollider(c, 'wood', owner); c.setEnabled(pose.enabled); }
    }
  }
  /** Apply the atomically published fields once, before stepping physics. */
  setPose(pose: MoverPose): void {
    const { position: p, euler: r } = pose;
    if (![p.x, p.y, p.z, r.x, r.y, r.z].every(Number.isFinite)) throw new Error('Invalid mover pose');
    if (!this.body.isFixed()) { this.q.setFromEuler(this.e.set(r.x, r.y, r.z, 'YXZ')); this.body.setNextKinematicTranslation(p); this.body.setNextKinematicRotation(this.q); }
    if (this.enabled !== pose.enabled) { this.enabled = pose.enabled; for (let i = 0; i < this.body.numColliders(); i++) this.body.collider(i).setEnabled(pose.enabled); }
  }
  /** Load-only durable safe pose; reconnects a saved body without taking a physics or gameplay step. */
  resetPose(pose: MoverPose): void {
    const { position, euler } = pose;
    if (![position.x, position.y, position.z, euler.x, euler.y, euler.z].every(Number.isFinite)) throw new Error('Invalid mover pose');
    this.q.setFromEuler(this.e.set(euler.x, euler.y, euler.z, 'YXZ'));
    this.body.setTranslation(position, false); this.body.setRotation(this.q, false);
    if (!this.body.isFixed()) { this.body.setNextKinematicTranslation(position); this.body.setNextKinematicRotation(this.q); }
    for (let i = 0; i < this.body.numColliders(); i++) this.body.collider(i).setEnabled(pose.enabled);
    this.enabled = pose.enabled; this.physics.world.propagateModifiedBodyPositionsToColliders();
  }
  /** Remove the owned body and its colliders with its session scope. */
  dispose(): void { if (this.body.isValid()) this.physics.world.removeRigidBody(this.body); }
}
