/**
 * The physics world (project/archive/2026-09-23-physics.md §Architecture): one Rapier `World` per shard, advanced once per fixed step.
 *
 * `Game` owns the clock (the frame phases, ENGINE-FIT E2): its fixed loop runs `pre → step → post` at 60 Hz, fed the
 * loop's unscaled dt, so visual hit-stop leaves gameplay time running and a skipped frame (menu, rotate gate) steps
 * nothing. `step()` is registered in the `step` slot; colliders that move are placed in `pre`, and characters move
 * against the stepped world in `post`. Rapier 0.21's World owns its empty SoftBodySet and supplies it to the
 * changed low-level step/remove/debug APIs. Physics owns reusable native query inputs;
 * callers receive the same detached Rapier results.
 */
import { RawVector } from '@dimforge/rapier3d-simd/raw.js';
import type { Collider, RigidBody, World, Ray, RayColliderHit, RayColliderIntersection, QueryFilterFlags, InteractionGroups } from '@dimforge/rapier3d-simd';
import type { NearColliders } from './nearColliders';
import type { Rapier } from './rapier';
import { FIXED_STEP } from '../core/fixedStep';
import { currentOwner, ownerOr } from '../app/ownership';
import type { Scope } from '../app/scope';
import { untagCollider, tagOf, type ColliderTag } from './surface';

/**
 * SF72: Rapier 0.21's `restoreSnapshot` wraps every collider with `bodies.get(raw.coParent(handle))`; for a parentless
 * (static) collider that is `bodies.get(undefined)`, which the Coarena reads as index 0, so every static collider claims
 * rigid body 0 as its parent and a capsule standing on static ground pins (`CharacterMotor.pin`) to that body. The native
 * set is right; only the JS wrappers are wrong. Drop those wrappers and let Rapier rewrap them from the native parent
 * (`mapNewColliders` reads `undefined` as no parent). Nothing native changes, so the world's bytes stay exact.
 */
function repairRestoredParents(world: World): World {
  const stale: number[] = [];
  world.forEachCollider((collider) => {
    if (collider.parent() !== null && world.colliders.raw.coParent(collider.handle) === undefined) stale.push(collider.handle);
  });
  for (const handle of stale) world.colliders.unmap(handle);
  world.colliders.mapNewColliders(world.bodies);
  return world;
}

interface RayVectors { origin: RawVector; direction: RawVector }
function createRayVectors(): RayVectors {
  const origin = new RawVector(0, 0, 0);
  try { return { origin, direction: new RawVector(0, 0, 0) }; }
  catch (error) { origin.free(); throw error; }
}
function writeNativeVector(target: RawVector, value: { x: number; y: number; z: number }): void {
  const x = value.x, y = value.y, z = value.z;
  target.x = x; target.y = y; target.z = z;
}
// Identical to Rapier's absent-predicate adapter, without a collider-set capture.
function noRayPredicate(_handle: number): undefined { return undefined; }

/** Owns one fixed-step collision world and its complete same-version continuation. */
export class Physics {
  /** Trusted native captures read the same surface/owner metadata as collision queries, without inferring identity. */
  colliderTag(collider: Collider): Readonly<ColliderTag> | undefined { return tagOf(collider); }
  readonly world: World;
  /** Where a phone's server worker keeps the solids far from its player (J68). Elsewhere, every solid is in the world. */
  near: NearColliders | null = null;
  /** ms the last `step()` took (the perf meter / bench read it) */
  stepMs = 0;

  readonly R: Rapier;
  private readonly rayVectors: RayVectors[] = [];
  private rayDepth = 0;
  private gravityVector: RawVector | undefined;
  private readonly bodyCaptures = new Map<number, () => void>();
  private readonly colliderCaptures = new Map<number, () => void>();
  private readonly bodyOwners = new Map<number, Scope>();
  private readonly colliderOwners = new Map<number, Scope>();
  /** The world's own lifetime (a region's simulation scope), or null for the page's world. SF57: a body or collider made
   *  outside any `withOwner` section (after an `await` in a resident's build) belongs to this world's scope, as a region
   *  registry's registrations do, not to the page's ambient owner; the page's world keeps the ambient owner. */
  private readonly owner: Scope | null;
  constructor(R: Rapier, snapshot?: Uint8Array, owner: Scope | null = null) {
    this.R = R;
    this.owner = owner;
    this.world = snapshot === undefined ? new R.World({ x: 0, y: -9.81, z: 0 }) : repairRestoredParents(R.World.restoreSnapshot(snapshot));
    this.world.timestep = FIXED_STEP;
    const bodies = this.bodyCaptures, colliders = this.colliderCaptures;
    const createBody = this.world.createRigidBody.bind(this.world), removeBody = this.world.removeRigidBody.bind(this.world);
    const createCollider = this.world.createCollider.bind(this.world), removeCollider = this.world.removeCollider.bind(this.world);
    this.world.createRigidBody = (desc) => {
      const body = createBody(desc), scope = this.creationOwner();
      if (scope) {
        this.bodyOwners.set(body.handle, scope);
        bodies.set(body.handle, scope.capture('bodies', () => { if (!this.freed && body.isValid()) this.world.removeRigidBody(body); }));
      }
      return body;
    };
    this.world.createCollider = (desc, parent) => {
      const collider = createCollider(desc, parent), scope = this.creationOwner();
      if (scope) {
        this.colliderOwners.set(collider.handle, scope);
        colliders.set(collider.handle, scope.capture('colliders', () => { if (!this.freed && collider.isValid()) this.world.removeCollider(collider, true); }));
      }
      return collider;
    };
    this.world.removeCollider = (collider, wake) => {
      colliders.get(collider.handle)?.(); colliders.delete(collider.handle); this.colliderOwners.delete(collider.handle); untagCollider(collider);
      removeCollider(collider, wake);
    };
    this.world.removeRigidBody = (body) => {
      for (let i = 0; i < body.numColliders(); i++) {
        const collider = body.collider(i); colliders.get(collider.handle)?.(); colliders.delete(collider.handle); this.colliderOwners.delete(collider.handle); untagCollider(collider);
      }
      bodies.get(body.handle)?.(); bodies.delete(body.handle); this.bodyOwners.delete(body.handle); removeBody(body);
    };
  }

  /** Live native handles owned by this scope subtree in this world, excluding identically numbered handles elsewhere. */
  scopedCensus(scope: Scope): { bodies: number; colliders: number } {
    const count = (owners: Map<number, Scope>): number => {
      let total = 0; for (const owner of owners.values()) if (owner.belongsTo(scope)) total++; return total;
    };
    return { bodies: count(this.bodyOwners), colliders: count(this.colliderOwners) };
  }

  private borrowRay(ray: Ray): RayVectors {
    if (this.freed) throw new Error('Cannot query a disposed physics world');
    const at = this.rayDepth++;
    let vectors = this.rayVectors[at];
    try {
      if (vectors === undefined) { vectors = createRayVectors(); if (at < 4) this.rayVectors[at] = vectors; }
      writeNativeVector(vectors.origin, ray.origin); writeNativeVector(vectors.direction, ray.dir);
      return vectors;
    } catch (error) {
      this.rayDepth--;
      if (at >= 4 && vectors !== undefined) { vectors.origin.free(); vectors.direction.free(); }
      throw error;
    }
  }
  private releaseRay(vectors: RayVectors): void {
    if (--this.rayDepth >= 4) { vectors.origin.free(); vectors.direction.free(); }
  }
  /** Rapier's native ray query with world-owned input vectors; results remain detached.
   * All flags, groups, exclusions and collider predicates retain World.castRay semantics. */
  castRay(ray: Ray, maxToi: number, solid: boolean, flags?: QueryFilterFlags, groups?: InteractionGroups,
    exclude?: Collider, excludeBody?: RigidBody, predicate?: (collider: Collider) => boolean): RayColliderHit | null {
    const vectors = this.borrowRay(ray), w = this.world;
    try {
      const hit = w.broadPhase.raw.castRay(w.narrowPhase.raw, w.bodies.raw, w.colliders.raw, vectors.origin, vectors.direction,
        maxToi, solid, flags ?? 0, groups, exclude?.handle ?? null, excludeBody?.handle ?? null,
        predicate === undefined ? noRayPredicate : w.colliders.castClosure(predicate));
      return hit === undefined ? null : this.R.RayColliderHit.fromRaw(w.colliders, hit);
    } finally { this.releaseRay(vectors); }
  }
  /** Native normal/feature results with bounded input scratch. The default
   * result is detached; an explicit target uses Rapier's existing output API. */
  castRayAndGetNormal(ray: Ray, maxToi: number, solid: boolean, flags?: QueryFilterFlags, groups?: InteractionGroups,
    exclude?: Collider, excludeBody?: RigidBody, predicate?: (collider: Collider) => boolean,
    target?: RayColliderIntersection): RayColliderIntersection | null {
    const vectors = this.borrowRay(ray), w = this.world;
    try {
      const hit = w.broadPhase.raw.castRayAndGetNormal(w.narrowPhase.raw, w.bodies.raw, w.colliders.raw, vectors.origin, vectors.direction,
        maxToi, solid, flags ?? 0, groups, exclude?.handle ?? null, excludeBody?.handle ?? null,
        predicate === undefined ? noRayPredicate : w.colliders.castClosure(predicate));
      return hit === undefined ? null : this.R.RayColliderIntersection.fromBuffer(w.colliders, hit, target);
    } finally { this.releaseRay(vectors); }
  }

  /** Capture outside-scope native identities; later reads exclude only those exact handles still alive. */
  captureRetainedCensus(scope: Scope): () => { bodies: number; colliders: number } {
    const bodies: RigidBody[] = [], colliders: Collider[] = [];
    this.world.forEachRigidBody((body) => {
      if (this.bodyOwners.get(body.handle)?.belongsTo(scope) !== true) bodies.push(body);
    });
    this.world.forEachCollider((collider) => {
      if (this.colliderOwners.get(collider.handle)?.belongsTo(scope) !== true) colliders.push(collider);
    });
    return () => ({
      bodies: bodies.filter((body) => this.world.bodies.contains(body.handle) && this.world.getRigidBody(body.handle) === body).length,
      colliders: colliders.filter((collider) => this.world.colliders.contains(collider.handle) && this.world.getCollider(collider.handle) === collider).length,
    });
  }

  /** Rapier's complete same-version continuation; a fresh Physics instance can consume it. */
  snapshot(): Uint8Array { return this.world.takeSnapshot(); }

  /**
   * One fixed step. O15: `World.step` ends with `mapNewSoftBodies`, which wraps the pieces a tearing soft body split off:
   * two full JS walks of every body and every collider (a wasm `contains` call each) after every step, 84 % of the
   * step's samples on Driftwood's road entry (Simulator). The engine never makes a soft body (the set stays empty), so
   * nothing can appear or vanish natively; the pipeline steps the same sets directly and the walks are skipped.
   */
  step(): void {
    const t0 = performance.now(), w = this.world;
    if (w.softBodies.len() > 0) throw new Error('Physics steps no soft bodies: their split pieces would go unwrapped');
    const gravity = this.gravityVector ??= new RawVector(0, 0, 0);
    writeNativeVector(gravity, w.gravity);
    // The existing step never supplies events or hooks. Call that identical
    // native branch with its owned f32 input instead of a new vector wrapper.
    w.physicsPipeline.raw.step(gravity, w.integrationParameters.raw, w.islands.raw, w.broadPhase.raw, w.narrowPhase.raw,
      w.bodies.raw, w.colliders.raw, w.softBodies.raw, w.impulseJoints.raw, w.multibodyJoints.raw, w.ccdSolver.raw);
    this.stepMs = performance.now() - t0;
  }

  /** Who owns a body or collider made now: an enclosing `withOwner` section's scope, else this world's, else the ambient owner. */
  private creationOwner(): Scope | null { return this.owner === null ? currentOwner() : ownerOr(this.owner); }
  /** Set by `dispose`: a scope torn down in the same pass may still run a capture it had copied before the world went. */
  private freed = false;

  dispose(): void {
    this.world.forEachCollider(untagCollider); this.world.free(); this.freed = true;
    for (const vectors of this.rayVectors) { vectors.origin.free(); vectors.direction.free(); }
    this.rayVectors.length = 0;
    this.gravityVector?.free(); this.gravityVector = undefined;
    // Whole-world retirement has freed these handles. Their scopes may outlive this world (cold regions);
    // unregister native cleanup callbacks so they cannot later dereference a freed Rapier set.
    for (const forget of this.bodyCaptures.values()) forget();
    for (const forget of this.colliderCaptures.values()) forget();
    this.bodyCaptures.clear(); this.colliderCaptures.clear(); this.bodyOwners.clear(); this.colliderOwners.clear();
  }
}
