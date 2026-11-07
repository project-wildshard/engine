// Frozen complete motor before-control at 024864488d; only import locations changed.
/**
 * A character's body in the physics world (PHYSICS.md P2, ENGINE-FIT E3): a capsule and Rapier's kinematic character
 * controller. The player uses it now; near creatures (P6) and the Nalati horse (P10) use the same one.
 *
 * The motor owns collision only. The character keeps its own position (feet) and velocity and decides where it wants
 * to go (speeds, jumps, dashes, swimming — game feel stays game code). `move()` puts the capsule at the feet, asks
 * the controller how much of the wanted translation is free (walls stop it, steps ≤ `step` are climbed, slopes past
 * `maxClimbDeg` are not, the feet snap down onto the ground within `snap`), and writes the result back into the feet.
 * Teleports need no call: the capsule is placed from the feet on every move.
 *
 * A **lying** capsule (`length`: the Nalati horse, NALATI-MERGE R2) runs along the character's heading instead of
 * standing up: `radius` is its girth, its bottom touches the ground under the middle. `setYaw` turns it (and refuses a
 * turn that would swing it into a wall), `setClimb` changes the slope limit on the fly (the horse's gait sets it),
 * `passThrough` lets a kind of body through for a while (a stampede through the player on foot), `touching` lists what
 * lies within a margin of the capsule (the herd jostling a rider).
 */
import type { Capsule, Collider, KinematicCharacterController, Ray, RigidBody } from '@dimforge/rapier3d-simd';
import type { Physics } from '../../src/shared/engine/physics/Physics';
import { GROUP, groups, queryGroups, type GroupName } from '../../src/shared/engine/physics/groups';
import { isTerrainCollider, tagCollider } from '../../src/shared/engine/physics/surface';
import { FIXED_STEP } from '../../src/shared/engine/core/fixedStep';

export interface MotorOptions {
  radius: number;
  /** feet to crown, metres (an upright capsule; a lying one is 2 × radius tall) */
  height: number;
  /** nose to tail, metres: the capsule lies along the heading (`setYaw`) — the horse */
  length?: number;
  /** highest step climbed without a jump (m) */
  step: number;
  /** steepest slope walked up (degrees); steeper ground is a wall */
  maxClimbDeg: number;
  /** the feet stick to ground this far below them (walking down steps / slopes without a hop) */
  snap: number;
  /** what this character is (PLAYER, CREATURE); it collides with what that group meets */
  group: GroupName;
  /** the kinds it is stopped by */
  blockedBy: readonly GroupName[];
  owner?: unknown;
  /** kg this character presses down on a riding body with (the rope bridge's planks); 0 = weightless */
  weight?: number;
}

/**
 * The player's body law, one for the page's Player and the headless SimHost (SF72): a PLAYER capsule stopped by the
 * world, creatures and ITEM bodies (the puzzle barrel, coconuts, which its 80 kg mass pushes), pressing 80 kg on a
 * riding body. (PLAYER never meets PLAYER: groups.ts's filter.)
 */
export const PLAYER_BODY: { readonly group: "PLAYER"; readonly blockedBy: readonly ["WORLD", "CREATURE", "ITEM"]; readonly weight: 80; } = { group: 'PLAYER', blockedBy: ['WORLD', 'CREATURE', 'ITEM'], weight: 80 } as const satisfies Pick<MotorOptions, 'group' | 'blockedBy' | 'weight'>;

/** dynamic bodies a character rides like a kinematic one (feet pinned to it) and loads with its weight */
const RIDEABLE = new WeakSet<RigidBody>();
export function rideable(body: RigidBody): void { RIDEABLE.add(body); }

interface Vec3 { x: number; y: number; z: number }

/** the ground probe: a ray from this far above the feet to this far below them */
const GROUND_PROBE_UP = 0.1, GROUND_PROBE_DOWN = 0.25;
/** how near a kinematic body must be for Rapier's platform friction to act on a move (its skin plus its prediction) */
const DECK_REACH = 0.1;

export interface MoveResult {
  grounded: boolean;
  /** the steepest-facing ground normal's y under the feet this move (1 = flat, 0 = a wall); 1 when airborne */
  groundNormalY: number;
  /** the downhill direction of that ground (unit, xz), for sliding */
  downhillX: number; downhillZ: number;
  /** how much of the wanted horizontal translation was taken (0‥1): a wall hit reads low */
  horizontalFreedom: number;
  /** what the feet stand on (null in the air) — its owner tag says which piece */
  groundCollider: Collider | null;
}
interface MotorState {
  version: number; colliderHandle: number; filter: number; ghost: string; enabled: boolean; yaw: number;
  anchor: Vec3; anchorBodyHandle: number | null; climbAngle: number; slideAngle: number;
  result: Omit<MoveResult, 'groundCollider'> & { groundColliderHandle: number | null };
}

export class CharacterMotor {
  readonly collider: Collider;
  private readonly kcc: KinematicCharacterController;
  private readonly lift: number;
  private filter: number;
  private ghost = '';
  private enabled = true;
  /** a move that ignores the terrain heightfield (the hoverboard, swimming: they ride their own springs over it) */
  private readonly notGround = (c: Collider): boolean => !isTerrainCollider(c);
  readonly result: MoveResult = { grounded: false, groundNormalY: 1, downhillX: 0, downhillZ: 0, horizontalFreedom: 1, groundCollider: null };
  private readonly anchor = { x: 0, y: 0, z: 0 };
  private anchorBody: RigidBody | null = null;
  private readonly ray: Ray;
  /** a lying capsule: its half axis (between the caps) and heading; the quaternion that lays it along the heading */
  private readonly halfAxis: number;
  private yaw = 0;
  private readonly rot = { x: 0, y: 0, z: 0, w: 1 };
  private readonly probe = { x: 0, y: 0, z: 0 };
  private readonly flat = { x: 0, y: 0, z: 0 };
  private touchShape: Capsule | null = null; private touchMargin = -1;
  private deckProbe: Capsule | null = null;

  private readonly physics: Physics;
  readonly opts: MotorOptions;

  constructor(physics: Physics, opts: MotorOptions, state?: MotorState) {
    this.physics = physics; this.opts = opts;
    const { R, world } = physics;
    const lying = opts.length !== undefined;
    const half = lying ? Math.max(0.01, (opts.length ?? 0) / 2 - opts.radius) : Math.max(0.01, opts.height / 2 - opts.radius);
    this.halfAxis = half;
    this.lift = lying ? opts.radius : opts.height / 2;
    if (state !== undefined && (state.version !== 1 || !world.colliders.contains(state.colliderHandle))) throw new RangeError('Invalid motor snapshot');
    this.collider = state === undefined ? world.createCollider(R.ColliderDesc.capsule(half, opts.radius).setCollisionGroups(groups(opts.group))) : world.getCollider(state.colliderHandle);
    if (lying && state === undefined) { this.layAlong(0); this.collider.setRotation(this.rot); }
    tagCollider(this.collider, 'flesh', opts.owner ?? null);
    this.kcc = world.createCharacterController(0.02);
    this.kcc.setUp({ x: 0, y: 1, z: 0 });
    this.kcc.enableAutostep(opts.step, opts.radius * 0.5, false);
    this.kcc.enableSnapToGround(opts.snap);
    this.kcc.setMaxSlopeClimbAngle(opts.maxClimbDeg * Math.PI / 180);
    this.kcc.setMinSlopeSlideAngle((opts.maxClimbDeg + 5) * Math.PI / 180);
    this.kcc.setSlideEnabled(true);
    this.kcc.setApplyImpulsesToDynamicBodies(true);
    this.kcc.setCharacterMass(80); // P7: a collider with no rigid body counts as massless, and a massless character pushes nothing
    this.filter = queryGroups(this.blockedBy(), opts.group);
    this.ray = new R.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
    if (state !== undefined) {
      this.filter = state.filter; this.ghost = state.ghost; this.enabled = state.enabled; this.yaw = state.yaw;
      Object.assign(this.anchor, state.anchor);
      this.anchorBody = state.anchorBodyHandle === null ? null : world.getRigidBody(state.anchorBodyHandle);
      const result = state.result;
      this.result.grounded = result.grounded; this.result.groundNormalY = result.groundNormalY;
      this.result.downhillX = result.downhillX; this.result.downhillZ = result.downhillZ; this.result.horizontalFreedom = result.horizontalFreedom;
      this.result.groundCollider = result.groundColliderHandle === null ? null : world.getCollider(result.groundColliderHandle);
      this.kcc.setMaxSlopeClimbAngle(state.climbAngle); this.kcc.setMinSlopeSlideAngle(state.slideAngle);
    }
  }
  /** Collider handles reconnect against the restored Rapier world, never the disposed world's wrappers. */
  snapshot(): MotorState {
    const result = this.result;
    return { version: 1, colliderHandle: this.collider.handle, filter: this.filter, ghost: this.ghost, enabled: this.enabled,
      yaw: this.yaw, anchor: { ...this.anchor }, anchorBodyHandle: this.anchorBody?.handle ?? null,
      climbAngle: this.kcc.maxSlopeClimbAngle(), slideAngle: this.kcc.minSlopeSlideAngle(),
      result: { grounded: result.grounded, groundNormalY: result.groundNormalY, downhillX: result.downhillX, downhillZ: result.downhillZ,
        horizontalFreedom: result.horizontalFreedom, groundColliderHandle: result.groundCollider?.handle ?? null } };
  }

  /** Prepare a motor in another world without retiring this one. World-bound ground/ride anchors are reacquired. */
  transferTo(physics: Physics, feet: Vec3): CharacterMotor {
    if (![feet.x, feet.y, feet.z].every(Number.isFinite)) throw new RangeError('Invalid motor transfer feet');
    const motor = new CharacterMotor(physics, this.opts);
    try {
      motor.syncTransfer(this, feet);
      return motor;
    } catch (error) { motor.dispose(); throw error; }
  }
  /** Refresh a disabled prepared replacement at commit; no source handles or ride anchors cross world boundaries. */
  syncTransfer(source: CharacterMotor, feet: Vec3): void {
    if (![feet.x, feet.y, feet.z].every(Number.isFinite)) throw new RangeError('Invalid motor transfer feet');
    this.filter = source.filter; this.ghost = source.ghost; this.yaw = source.yaw;
    this.kcc.setMaxSlopeClimbAngle(source.kcc.maxSlopeClimbAngle()); this.kcc.setMinSlopeSlideAngle(source.kcc.minSlopeSlideAngle());
    this.setEnabled(source.enabled);
    if (this.opts.length !== undefined) { this.layAlong(this.yaw); this.collider.setRotation(this.rot); }
    this.collider.setTranslation({ x: feet.x, y: feet.y + this.lift + 0.005, z: feet.z });
  }

  /** the quaternion for a lying capsule along `yaw` (animal convention: forward = (sin yaw, 0, cos yaw)): Rapier's
   *  capsule runs along Y — tip it onto +Z (90° about X), then turn it about Y */
  private layAlong(yaw: number): void {
    const s = Math.SQRT1_2, sy = Math.sin(yaw / 2), cy = Math.cos(yaw / 2), r = this.rot;
    r.x = cy * s; r.y = sy * s; r.z = -sy * s; r.w = cy * s;
  }

  /**
   * Turn a lying capsule to `yaw` at `feet`. A turn that would swing its nose or rump into something is tried again a
   * hair off (lifted, backed, to either side — `feet` moves by that hair); when every try is blocked the turn is
   * refused and false returned (the rider's heading stays where it was). Upright capsules turn freely.
   */
  setYaw(feet: Vec3, yaw: number): boolean {
    if (this.opts.length === undefined || !this.enabled) { this.yaw = yaw; return true; }
    const { R, world } = this.physics;
    const old = this.yaw;
    this.layAlong(yaw);
    const shape = this.collider.shape;
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    const E = 0.05;
    // a hair: none · up · back · either side · back + up
    const tries = [[0, 0, 0], [0, E, 0], [-E, 0, 0], [0, 0, E], [0, 0, -E], [-E, E, 0]] as const;
    for (const [back, up, side] of tries) {
      const p = this.probe;
      p.x = feet.x + fx * back + fz * side; p.y = feet.y + this.lift + up + 0.005; p.z = feet.z + fz * back - fx * side;
      const hit = world.intersectionWithShape(p, this.rot, shape, R.QueryFilterFlags.EXCLUDE_SENSORS, this.filter, this.collider);
      if (hit === null) {
        feet.x = p.x; feet.y = p.y - this.lift - 0.005; feet.z = p.z;
        this.yaw = yaw;
        this.collider.setRotation(this.rot);
        this.collider.setTranslation(p);
        return true;
      }
    }
    this.layAlong(old);
    return false;
  }

  /** the last computed move touched only walkable floor (every contact's normal within the climb angle of straight up) */
  private stalledOnFloor(): boolean {
    const n = this.kcc.numComputedCollisions();
    if (n === 0) return false;
    const minUp = Math.cos(this.kcc.maxSlopeClimbAngle());
    for (let i = 0; i < n; i++) { const c = this.kcc.computedCollision(i); if (c === null || c.normal1.y < minUp) return false; }
    return true;
  }

  /**
   * The capsule at `feet` is within reach of a kinematic body (SF49 / SF51). Rapier's controller runs a
   * platform pass for such a body after every hit of a move: it resets the move's normal part to the platform's own
   * motion and adds the platform's sideways motion. Feet that rest a hair inside the controller's skin (`offset`) hit
   * the deck's own top at time 0 on a sideways move; on static ground the controller's normal nudge lifts the capsule
   * clear after a pass or two, but the platform pass erases that nudge, so all 20 passes hit the same floor and the
   * player stalls on a resting deck (and on a moving one); and every hit adds the deck's motion a second time on top of
   * `carry`. A move that starts a skin higher hits nothing on a flat deck, and snap-to-ground puts the feet back at the
   * skin's distance.
   */
  private nearDeck(feet: Vec3): boolean {
    const { R, world } = this.physics, p = this.probe;
    this.deckProbe ??= new R.Capsule(this.halfAxis, this.opts.radius + DECK_REACH);
    p.x = feet.x; p.y = feet.y + this.lift; p.z = feet.z;
    return world.intersectionWithShape(p, this.rot, this.deckProbe,
      R.QueryFilterFlags.ONLY_KINEMATIC | R.QueryFilterFlags.EXCLUDE_SENSORS, this.filter, this.collider) !== null;
  }

  /** the steepest slope climbed from now on (degrees); it slides on ground 5° steeper */
  setClimb(deg: number): void {
    this.kcc.setMaxSlopeClimbAngle(deg * Math.PI / 180);
    this.kcc.setMinSlopeSlideAngle((deg + 5) * Math.PI / 180);
  }

  private blockedBy(): readonly GroupName[] { return this.opts.group === 'CREATURE' ? [...this.opts.blockedBy, 'BORDER'] : this.opts.blockedBy; }

  /** Re-framing a traveler preserves these exclusions, including a mounted creature passing its home boundary. */
  passThroughKinds(): readonly GroupName[] {
    const keys = Object.keys(GROUP).filter((key): key is GroupName => key in GROUP);
    return keys.filter((key) => this.ghost.split(',').includes(key));
  }

  /**
   * Let these kinds through until told otherwise (both ways: this body's moves ignore them and their moves ignore it) —
   * a stampeding horse runs through the player on foot (R3). `[]` = blocked by everything in `blockedBy` again.
   */
  passThrough(kinds: readonly GroupName[]): void {
    const key = kinds.join(',');
    if (key === this.ghost) return;
    this.ghost = key;
    const drop = [...new Set(kinds)].reduce((m, k) => m + GROUP[k], 0);   // distinct single bits: the sum is the union
    this.filter = queryGroups(this.blockedBy().filter((k) => !kinds.includes(k)), this.opts.group);
    this.collider.setCollisionGroups((groups(this.opts.group) & ~drop) >>> 0);
  }

  /** Each collider of the kinds in `sees` within `margin` metres of the capsule where it stands now (the herd around a
   *  rider); `each` returns false to stop. */
  touching(margin: number, sees: readonly GroupName[], each: (c: Collider) => boolean): void {
    if (!this.enabled) return;
    const { R, world } = this.physics;
    if (this.touchShape === null || this.touchMargin !== margin) { this.touchShape = new R.Capsule(this.halfAxis, this.opts.radius + margin); this.touchMargin = margin; }
    world.intersectionsWithShape(this.collider.translation(), this.collider.rotation(), this.touchShape, each, R.QueryFilterFlags.EXCLUDE_SENSORS, queryGroups(sees, this.opts.group), this.collider);
  }

  /** Parked (Explore's free camera, a menu that owns the player): the capsule leaves the world's way. */
  setEnabled(on: boolean): void { if (on === this.enabled) return; this.enabled = on; this.collider.setEnabled(on); }

  /**
   * Move `feet` by as much of `want` as the world allows; `feet` is updated in place. `result` says whether the
   * character ended on ground and what that ground is like. `ignoreGround`: the terrain doesn't stop this move.
   */
  move(feet: Vec3, want: Vec3, ignoreGround = false): MoveResult {
    const r = this.result;
    if (!this.enabled) { feet.x += want.x; feet.y += want.y; feet.z += want.z; r.grounded = false; r.groundNormalY = 1; r.horizontalFreedom = 1; r.groundCollider = null; this.anchorBody = null; return r; }
    const { R } = this.physics;
    this.collider.setTranslation({ x: feet.x, y: feet.y + this.lift, z: feet.z });
    const wantH = Math.hypot(want.x, want.z);
    // SF49 / SF51: a sideways move near a kinematic body (a mover's deck, at rest or ridden) starts a skin higher (see
    // `nearDeck`); a move with no sideways part isn't snapped back down by the controller, so it starts where it is.
    const lifted = wantH > 1e-6 && want.y <= 0 && this.nearDeck(feet) ? this.kcc.offset() : 0;
    if (lifted > 0) this.collider.setTranslation({ x: feet.x, y: feet.y + this.lift + lifted, z: feet.z });
    const pred = ignoreGround ? this.notGround : undefined;
    this.kcc.computeColliderMovement(this.collider, want, R.QueryFilterFlags.EXCLUDE_SENSORS, this.filter, pred);
    let m = this.kcc.computedMovement();
    // E285: now and then Rapier stops the whole move on the floor the capsule already rests on (one contact, normal
    // straight up, time of impact 0), and a dash ended on that "wall" (~1 dodge in 5). Such a stall is retried flat;
    // the snap still keeps the feet on the ground, and anything that really blocks the way blocks the retry too.
    if (wantH > 1e-6 && want.y <= 0 && Math.hypot(m.x, m.z) < wantH * 0.3 && this.stalledOnFloor()) {
      this.flat.x = want.x; this.flat.y = 0; this.flat.z = want.z;
      this.kcc.computeColliderMovement(this.collider, this.flat, R.QueryFilterFlags.EXCLUDE_SENSORS, this.filter, pred);
      m = this.kcc.computedMovement();
    }
    feet.x += m.x; feet.y += m.y + lifted; feet.z += m.z;
    this.collider.setTranslation({ x: feet.x, y: feet.y + this.lift, z: feet.z });
    r.grounded = this.kcc.computedGrounded();
    r.horizontalFreedom = wantH > 1e-6 ? Math.min(1, Math.hypot(m.x, m.z) / wantH) : 1;
    // the ground under the feet: a short ray down from just above them. (The controller's own contacts are empty while
    // resting — snapped or standing still — so they can't say what we stand on.)
    r.groundNormalY = 1; r.downhillX = 0; r.downhillZ = 0; r.groundCollider = null;
    if (r.grounded) {
      this.ray.origin.x = feet.x; this.ray.origin.y = feet.y + GROUND_PROBE_UP; this.ray.origin.z = feet.z;
      const hit = this.physics.world.castRayAndGetNormal(this.ray, GROUND_PROBE_UP + GROUND_PROBE_DOWN, true, R.QueryFilterFlags.EXCLUDE_SENSORS, this.filter, this.collider);
      if (hit) {
        const nrm = hit.normal, h = Math.hypot(nrm.x, nrm.z) || 1;
        r.groundCollider = hit.collider;
        r.groundNormalY = nrm.y; r.downhillX = nrm.x / h; r.downhillZ = nrm.z / h;
      }
    }
    this.pin(feet);
    return r;
  }

  /**
   * Ride what the feet stand on when it moves (a kinematic body: the boat on the swell). After a move ends on such a
   * body the feet are pinned in its local frame; after the next world step `carry(feet)` puts them back on the same
   * spot of the body's new pose — exactly, rotation included, and outside the controller (a rising deck would
   * otherwise swallow the feet: Rapier #488). Call it before the character's own move. False when not riding.
   */
  carry(feet: Vec3): boolean {
    const b = this.anchorBody;
    if (b === null) return false;
    const t = b.translation(), q = b.rotation(), a = this.anchor;
    // rotate the local anchor by q, then translate
    const ix = q.w * a.x + q.y * a.z - q.z * a.y, iy = q.w * a.y + q.z * a.x - q.x * a.z, iz = q.w * a.z + q.x * a.y - q.y * a.x, iw = -q.x * a.x - q.y * a.y - q.z * a.z;
    const x = t.x + ix * q.w + iw * -q.x + iy * -q.z - iz * -q.y;
    const y = t.y + iy * q.w + iw * -q.y + iz * -q.x - ix * -q.z;
    const z = t.z + iz * q.w + iw * -q.z + ix * -q.y - iy * -q.x;
    // the feet were put somewhere else since the last move (a respawn, a quest's teleport): that ends the ride
    if ((x - feet.x) ** 2 + (y - feet.y) ** 2 + (z - feet.z) ** 2 > 1.5 * 1.5) { this.anchorBody = null; return false; }
    feet.x = x; feet.y = y; feet.z = z;
    return true;
  }

  /** let go of whatever the feet ride (a teleport) */
  release(): void { this.anchorBody = null; }

  /** Load/respawn at an already admitted pose: align the existing capsule and discard old contacts without a collision or physics step. */
  resetAt(feet: Vec3): void {
    if (![feet.x, feet.y, feet.z].every(Number.isFinite)) throw new RangeError('Invalid motor reset feet');
    this.collider.setTranslation({ x: feet.x, y: feet.y + this.lift + 0.005, z: feet.z });
    this.anchorBody = null;
    Object.assign(this.result, { grounded: false, groundNormalY: 1, downhillX: 0, downhillZ: 0, horizontalFreedom: 1, groundCollider: null });
  }

  /** after a move: pin the feet to a moving body they stand on (see `carry`), or let go */
  private pin(feet: Vec3): void {
    const body = this.result.grounded ? this.result.groundCollider?.parent() ?? null : null;
    if (body === null || !(body.isKinematic() || RIDEABLE.has(body))) { this.anchorBody = null; return; }
    // a dynamic deck carries the character's weight at the feet (one fixed step's worth of gravity)
    const kg = this.opts.weight ?? 0;
    if (kg > 0 && body.isDynamic()) body.applyImpulseAtPoint({ x: 0, y: -kg * 9.81 * FIXED_STEP, z: 0 }, feet, true);
    const t = body.translation(), q = body.rotation(), a = this.anchor;
    const dx = feet.x - t.x, dy = feet.y - t.y, dz = feet.z - t.z;
    // rotate by q⁻¹ (the conjugate)
    const cx = -q.x, cy = -q.y, cz = -q.z, w = q.w;
    const ix = w * dx + cy * dz - cz * dy, iy = w * dy + cz * dx - cx * dz, iz = w * dz + cx * dy - cy * dx, iw = -cx * dx - cy * dy - cz * dz;
    a.x = ix * w + iw * -cx + iy * -cz - iz * -cy;
    a.y = iy * w + iw * -cy + iz * -cx - ix * -cz;
    a.z = iz * w + iw * -cz + ix * -cy - iy * -cx;
    this.anchorBody = body;
  }

  dispose(): void {
    this.physics.world.removeCharacterController(this.kcc);
    this.physics.world.removeCollider(this.collider, false);
  }
}
