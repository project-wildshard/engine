/**
 * A registered piece's `ColliderDesc`s (src/client/engine/world/registry.ts) as Rapier colliders — the one place engine-neutral
 * collider data becomes Rapier (PHYSICS.md P2b). Each collider is tagged with its material and the piece as owner (or the
 * piece's declared `colliderOwner` id), so a query hit knows it touched "the hut, planks".
 */
import type { Collider, ColliderDesc as RapierDesc, RigidBody } from '@dimforge/rapier3d-simd';
import { Matrix4, Quaternion, Vector3, type Object3D } from 'three';
import { currentOwner, withOwner } from '../app/ownership';
import type { ColliderDesc, Piece } from '../../../client/engine/world/registry';
import type { Physics } from './Physics';
import { groups } from './groups';
import { solidReach } from './nearColliders';
import { tagCollider, untagCollider, type Material } from './surface';

/** One tread of a stair: a solid block from the stair's foot up to this tread's top. */
export function treadBoxes(d: Extract<ColliderDesc, { kind: 'treads' }>): Extract<ColliderDesc, { kind: 'box' }>[] {
  const dx = d.to.x - d.from.x, dz = d.to.z - d.from.z, run = Math.hypot(dx, dz) / d.count, rise = (d.to.y - d.from.y) / d.count;
  const yaw = Math.atan2(dx, dz);
  const out: Extract<ColliderDesc, { kind: 'box' }>[] = [];
  for (let i = 0; i < d.count; i++) {
    const f = (i + 0.5) / d.count, top = d.from.y + rise * (i + 1), hy = Math.max(0.01, (top - d.from.y) / 2);
    out.push({ kind: 'box', x: d.from.x + dx * f, y: d.from.y + hy, z: d.from.z + dz * f, hx: d.width / 2, hy, hz: run / 2, yaw, ...(d.surface === undefined ? {} : { surface: d.surface }) });
  }
  return out;
}

// Rapier copies a descriptor into each native collider. Retain one repeated box
// template per world; never retain native handles or skip a collider creation.
const lastBox = new WeakMap<Physics, { hx: number; hy: number; hz: number; desc: RapierDesc }>();
const IDENTITY_ROTATION = { x: 0, y: 0, z: 0, w: 1 } as const;
function rapierDesc(physics: Physics, d: Exclude<ColliderDesc, { kind: 'treads' }>): RapierDesc | null {
  const { R } = physics;
  switch (d.kind) {
    case 'box': {
      const hx = Math.max(0.005, d.hx), hy = Math.max(0.005, d.hy), hz = Math.max(0.005, d.hz), prior = lastBox.get(physics);
      if (prior !== undefined && prior.hx === hx && prior.hy === hy && prior.hz === hz) {
        // Rapier's JS Collider retains shape by reference. Each native handle
        // must keep its own shape even though the temporary descriptor is reused.
        prior.desc.shape = new R.Cuboid(hx, hy, hz); return prior.desc;
      }
      const desc = R.ColliderDesc.cuboid(hx, hy, hz); lastBox.set(physics, { hx, hy, hz, desc }); return desc;
    }
    case 'capsule': return R.ColliderDesc.capsule(Math.max(0.005, d.halfHeight), d.radius);
    case 'ball': return R.ColliderDesc.ball(d.radius);
    case 'hull': return R.ColliderDesc.convexHull(d.points);
    case 'trimesh': return R.ColliderDesc.trimesh(d.vertices, d.indices);
    default: return null;
  }
}

export interface AddedPiece {
  colliders: Collider[];
  /** a moving piece's body; `sync()` poses it from the object it follows (call in the fixed step's `pre` slot) */
  body: RigidBody | null;
  sync: () => void;
}

const _p = new Vector3(), _q = new Quaternion(), _s = new Vector3(), _m = new Matrix4();

/** The followed object's pose in the physics world's frame: its world matrix, or relative to `frame` when given. */
function poseOf(follows: Object3D, frame: Object3D | undefined): void {
  follows.updateWorldMatrix(true, false);
  if (frame === undefined) { follows.matrixWorld.decompose(_p, _q, _s); return; }
  frame.updateWorldMatrix(true, false);
  _m.copy(frame.matrixWorld).invert().multiply(follows.matrixWorld).decompose(_p, _q, _s);
}

/**
 * Build the piece's colliders into the world: static ones in world space, or — for a piece that `follows` a moving
 * object — attached to a kinematic body in that object's frame. Returns them, so a caller can remove the piece later.
 * `frame`: the scene node that stands for this physics world's origin (a grid region drawn at its render offset); a
 * followed object is posed relative to it. Absent: the scene's origin is the world's.
 */
export function addPiece(physics: Physics, piece: Piece, frame?: Object3D): AddedPiece {
  const owner = currentOwner();
  if (owner?.disposed === true) throw new Error('Cannot add a piece to a disposed scope');
  const out: Collider[] = [];
  const { R, world } = physics;
  let body: RigidBody | null = null;
  const follows = piece.follows;
  if (follows) {
    poseOf(follows, frame);
    if (piece.followRotation === false) _q.identity();
    body = world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(_p.x, _p.y, _p.z).setRotation({ x: _q.x, y: _q.y, z: _q.z, w: _q.w }));
  }
  let colliderData = piece.colliders;
  const create = (): void => withOwner(owner, () => {
    const collisionGroups = groups('WORLD');
    const made = (target: Physics, d: Exclude<ColliderDesc, { kind: 'treads' }>, raw: ColliderDesc): Collider | null => {
      const desc = rapierDesc(target, d);
      if (desc === null) return null; // a degenerate hull: nothing to collide with
      desc.setTranslation(d.x, d.y, d.z).setCollisionGroups(collisionGroups);
      if (d.rot) desc.setRotation(d.rot);
      else if (d.yaw !== undefined && d.yaw !== 0) desc.setRotation({ x: 0, y: Math.sin(d.yaw / 2), z: 0, w: Math.cos(d.yaw / 2) });
      else desc.setRotation(IDENTITY_ROTATION); // a reused box must not carry the preceding piece's rotation
      const c = target.world.createCollider(desc, body ?? undefined);
      const material: Material = d.surface ?? raw.surface ?? piece.surface ?? 'wood';
      tagCollider(c, material, piece.colliderOwner ?? piece);
      return c;
    };
    const one = (d: Exclude<ColliderDesc, { kind: 'treads' }>, raw: ColliderDesc): void => {
      const { near } = physics;
      // J68: a phone's server keeps a still piece's hulls and meshes as data until its player is near.
      if (near !== null && !follows && piece.active === undefined && (d.kind === 'hull' || d.kind === 'trimesh')) {
        near.hold({ x: d.x, z: d.z, reach: solidReach(d.kind === 'hull' ? d.points : d.vertices), make: target => withOwner(owner, () => made(target, d, raw)) });
        return;
      }
      const c = made(physics, d, raw);
      if (c !== null) out.push(c);
    };
    for (const raw of piece.colliders ?? []) {
      if (raw.kind === 'treads') for (const tread of treadBoxes(raw)) one(tread, raw);
      else one(raw, raw);
    }
  });
  create();
  const b = body, active = piece.active;
  let on = true;
  const sync = () => {
    if (owner?.disposed === true) return;
    // A puzzle may resize its box when its state changes. Replacing the descriptors
    // rebuilds that piece without a second collision list or per-frame serialization.
    if (piece.colliders !== colliderData) {
      for (const c of out) { untagCollider(c); world.removeCollider(c, true); }
      out.length = 0; colliderData = piece.colliders; create();
      for (const c of out) c.setEnabled(on);
    }
    if (active) {
      const want = active();
      if (want !== on) { on = want; for (const c of out) c.setEnabled(want); }
    }
    if (!b || !follows) return;
    poseOf(follows, frame);
    if (piece.followRotation === false) _q.identity();
    b.setNextKinematicTranslation({ x: _p.x, y: _p.y, z: _p.z });
    b.setNextKinematicRotation({ x: _q.x, y: _q.y, z: _q.z, w: _q.w });
  };
  return { colliders: out, body, sync };
}
