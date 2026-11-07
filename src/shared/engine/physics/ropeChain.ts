/**
 * A rope bridge's deck as a chain of rigid planks (PHYSICS.md's "soft-body rope" row; Rapier 0.20 has no soft bodies,
 * so the rope is what a rope bridge is anyway: segments on joints). Each segment is a dynamic box; neighbours share a
 * generic joint at their common top edge that locks every axis but two: a segment pitches against the next (the deck
 * sags and bounces) and yaws against it (the span bows sideways), but never rolls about the span, so the planks stay
 * level across like a deck hung from two ropes. The first and last segments are jointed the same way to fixed anchors
 * at the posts.
 *
 * The deck is WORLD to everything that stands on it (the player's floor ray, creatures, items, bolts) but never meets
 * the WORLD itself — terrain, posts and its own neighbours — so it hangs free in the gully. Its bodies sleep when still;
 * the player's weight (CharacterMotor `weight`) wakes and loads the segment under the feet, which the motor rides.
 *
 *   const chain = new RopeChain(physics, bridge.chainSpec());
 *   game.onFixed('post', () => { chain.capture(); });           // after the world step
 *   game.onUpdate(() => { bridge.setPoses(chain, game.alpha); });  // interpolated
 *
 * The chain is simulation only (bodies, joints, plain poses); the drawn deck that reads its poses is `ropeDeck.ts`.
 */
import type { RigidBody } from '@dimforge/rapier3d-simd';
import type { Physics } from './Physics';
import { GROUP } from './groups';
import { tagCollider } from './surface';
import { rideable } from './CharacterMotor';

interface Vec3 { x: number; y: number; z: number }
interface Quat { x: number; y: number; z: number; w: number }

export interface RopeChainSpec {
  /** each segment's rest pose: centre and rotation (local +z along the span, +y up), top faces on the catenary, and
   *  its half length along the span (each is one chord of the sag, so they differ a little) */
  segments: { x: number; y: number; z: number; rot: Quat; hz: number }[];
  /** a segment's half width across and half thickness */
  hx: number; hy: number;
  /** kg per segment */
  mass: number;
  /** what a hit collider reports as its owner (a bolt that sticks rides `follows`) — one per segment, or none */
  owners?: readonly unknown[];
}

/** The deck meets everything that stands on or hits it, never the world it hangs in. */
const DECK_GROUPS = ((GROUP.WORLD << 16) | (0xffff & ~GROUP.WORLD)) >>> 0;

export class RopeChain {
  readonly bodies: RigidBody[] = [];
  private readonly anchors: RigidBody[] = [];
  /** the last two fixed steps' poses per segment (x y z qx qy qz qw), for interpolating the drawn deck */
  private prev: Float32Array;
  private cur: Float32Array;

  private readonly physics: Physics;
  readonly spec: RopeChainSpec;

  constructor(physics: Physics, spec: RopeChainSpec) {
    this.physics = physics; this.spec = spec;
    const { R, world } = physics;
    const { segments, hx, hy, mass } = spec;
    const n = segments.length;
    this.prev = new Float32Array(n * 7); this.cur = new Float32Array(n * 7);
    const mask = R.JointAxesMask.LinX | R.JointAxesMask.LinY | R.JointAxesMask.LinZ | R.JointAxesMask.AngX;
    // the joint frame's X axis runs along the span: AngX locked = no roll; pitch and yaw stay free
    const along = { x: 0, y: 0, z: 1 };
    segments.forEach((s, i) => {
      const body = world.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(s.x, s.y, s.z).setRotation(s.rot)
        .setLinearDamping(0.6).setAngularDamping(2).setCanSleep(true)
        // a 25-link chain on impulse joints is soft at the world's 4 solver iterations (the deck sags 0.9 m more than it
        // was built); 16 more on its own island hold it within ~6 cm, ~0.1 ms a step while awake (asleep: nothing)
        .setAdditionalSolverIterations(16));
      const c = world.createCollider(R.ColliderDesc.cuboid(hx, hy, s.hz).setMass(mass).setFriction(0.9).setCollisionGroups(DECK_GROUPS).setSolverGroups(DECK_GROUPS), body);
      tagCollider(c, 'wood', spec.owners?.[i] ?? null);
      rideable(body);
      this.bodies.push(body);
    });
    // neighbours: the end of one segment's top face is the start of the next one's
    for (let i = 0; i + 1 < n; i++) {
      const a = this.bodies[i], b = this.bodies[i + 1], sa = segments[i], sb = segments[i + 1];
      if (!a || !b || !sa || !sb) continue;
      world.createImpulseJoint(R.JointData.generic({ x: 0, y: hy, z: sa.hz }, { x: 0, y: hy, z: -sb.hz }, along, mask), a, b, true);
    }
    // the posts: a fixed anchor posed like the end segment, jointed at its outer edge
    const anchor = (s: RopeChainSpec['segments'][number], body: RigidBody, end: 1 | -1): void => {
      const fixed = world.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(s.x, s.y, s.z).setRotation(s.rot));
      this.anchors.push(fixed);
      const edge = { x: 0, y: hy, z: end * s.hz };
      world.createImpulseJoint(R.JointData.generic(edge, edge, along, mask), fixed, body, true);
    };
    const first = segments[0], last = segments[n - 1], b0 = this.bodies[0], bn = this.bodies[n - 1];
    if (first && b0) anchor(first, b0, -1);
    if (last && bn) anchor(last, bn, 1);
    this.capture(); this.prev.set(this.cur);
  }

  /** read the bodies' poses after a world step (the fixed step's `post` slot) */
  capture(): void {
    const t = this.prev; this.prev = this.cur; this.cur = t;
    this.bodies.forEach((b, i) => {
      const p = b.translation(), q = b.rotation(), o = i * 7;
      t[o] = p.x; t[o + 1] = p.y; t[o + 2] = p.z; t[o + 3] = q.x; t[o + 4] = q.y; t[o + 5] = q.z; t[o + 6] = q.w;
    });
  }

  /** segment `i`'s pose between the last two steps (`alpha` 0 → 1): position into `p`, rotation into `q` */
  pose(i: number, alpha: number, p: Vec3, q: Quat): void {
    const a = this.prev, b = this.cur, o = i * 7, k = 1 - alpha;
    p.x = (a[o] ?? 0) * k + (b[o] ?? 0) * alpha;
    p.y = (a[o + 1] ?? 0) * k + (b[o + 1] ?? 0) * alpha;
    p.z = (a[o + 2] ?? 0) * k + (b[o + 2] ?? 0) * alpha;
    // nlerp: the steps are 1/60 s apart, so the two rotations are close
    let qx = a[o + 3] ?? 0, qy = a[o + 4] ?? 0, qz = a[o + 5] ?? 0, qw = a[o + 6] ?? 1;
    const bx = b[o + 3] ?? 0, by = b[o + 4] ?? 0, bz = b[o + 5] ?? 0, bw = b[o + 6] ?? 1;
    const s = qx * bx + qy * by + qz * bz + qw * bw < 0 ? -1 : 1;
    qx = qx * k + bx * alpha * s; qy = qy * k + by * alpha * s; qz = qz * k + bz * alpha * s; qw = qw * k + bw * alpha * s;
    const l = Math.hypot(qx, qy, qz, qw) || 1;
    q.x = qx / l; q.y = qy / l; q.z = qz / l; q.w = qw / l;
  }

  get count(): number { return this.bodies.length; }

  /** true while any segment moves (the drawn deck needs no update while the chain sleeps) */
  get awake(): boolean { return this.bodies.some((b) => !b.isSleeping()); }

  /** Apply an admitted deck activation without exposing body construction to content. */
  setEnabled(enabled: boolean): void { for (const body of this.bodies) body.setEnabled(enabled); }

  dispose(): void {
    for (const b of [...this.bodies, ...this.anchors]) this.physics.world.removeRigidBody(b);
    this.bodies.length = 0; this.anchors.length = 0;
  }
}
