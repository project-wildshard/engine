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
import type { Capsule, CharacterCollision, Collider, KinematicCharacterController, Ray, RayColliderIntersection, RigidBody } from '@dimforge/rapier3d-simd';
import type { Physics } from './Physics';
import { GROUP, groups, queryGroups, type GroupName } from './groups';
import { isTerrainCollider, tagCollider } from './surface';
import { FIXED_STEP } from '../core/fixedStep';

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

/** The page player's unchanged capsule/controller settings, also used by the
 * native physics-route proof rather than its smaller generic sim capsule. */
export const PLAYER_CAPSULE:Readonly<Pick<MotorOptions,'radius'|'height'|'step'|'maxClimbDeg'|'snap'>> = {
  radius:0.38,height:1.8,step:0.35,maxClimbDeg:40,snap:0.3,
};

/** dynamic bodies a character rides like a kinematic one (feet pinned to it) and loads with its weight */
const RIDEABLE = new WeakSet<RigidBody>();
export function rideable(body: RigidBody): void { RIDEABLE.add(body); }

interface Vec3 { x: number; y: number; z: number }

/** the ground probe: a ray from this far above the feet to this far below them */
const GROUND_PROBE_UP = 0.1, GROUND_PROBE_DOWN = 0.25;
/** how near a kinematic body must be for Rapier's platform friction to act on a move (its skin plus its prediction) */
const DECK_REACH = 0.1;
/** QA 11-24 row 72: up to this many kinematic bodies, the deck probe first measures them (see `noDeckNear`), with this much
 *  slack (m) on the bounds for rounding. */
const FEW_DECKS = 16, DECK_SLACK = 0.05;
/**
 * NET-LAG NL13b4: a grounded sideways move on flat static support starts this far above the controller's skin, with no fall
 * in it, and ends back on the skin. Resting on the skin, the capsule met the floor and any wall it leaned on both at time 0,
 * and Rapier kept whichever hit its query tree visited first. The page's world and the room's never build that tree alike
 * (other colliders, another insertion order), so the same step from the same state slid along a wall differently and
 * corrected the owner (Far Reach's windmill: 8.5 to 18.4 a minute on staging). Clear of the floor, only the wall is hit.
 */
const REST_LIFT = 0.0005;
const UP = { x: 0, y: 1, z: 0 } as const;
const SLOPE_CONTACT = 1, WALL_CONTACT = 2, BANK_CONTACT = 4;
const DOWN = { x: 0, y: -1, z: 0 } as const;
/** A grounded move that got under this share of what it asked for is stalled (`stepOver`). */
const STALLED = 0.02;
/** NL14b1: half the span `smoothBank` measures the terrain's slope over, and how far over and under the feet it looks. */
const BANK_SPAN = 0.15, BANK_RAY_UP = 1, BANK_RAY_DOWN = 2;
/** How much of the push into a bank is dropped: none below the climb limit, all a little past it, a ramp between, so a
 *  bank at the limit gives a move that changes smoothly with it (NL14b1). */
function steepShare(normalY: number, climb: number): number { return Math.min(1, Math.max(0, (climb - normalY) / 0.02 + 0.5)); }

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
/** Numbers in a flat `captureState`: the anchor, its body, and the last move's result. */
export const MOTOR_WORDS = 11;
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
  /** J106: colliders this body walks through because they are gone in its own player's world (a quest gate it opened). */
  readonly phased: Set<number> = new Set<number>();
  private readonly notPhased = (collider: { readonly handle: number }): boolean => !this.phased.has(collider.handle);
  /** What a floor query asks of a collider for this capsule: an open gate is no floor to the one who walks through it. */
  get solidOnly(): ((collider: { readonly handle: number }) => boolean) | undefined { return this.phased.size > 0 ? this.notPhased : undefined; }
  private readonly notGroundOrPhased = (collider: Parameters<CharacterMotor['notGround']>[0]): boolean => this.notGround(collider) && this.notPhased(collider);
  private ghost = '';
  private enabled = true;
  /** a move that ignores the terrain heightfield (the hoverboard, swimming: they ride their own springs over it) */
  private readonly notGround = (c: Collider): boolean => !isTerrainCollider(c);
  readonly result: MoveResult = { grounded: false, groundNormalY: 1, downhillX: 0, downhillZ: 0, horizontalFreedom: 1, groundCollider: null };
  private readonly anchor = { x: 0, y: 0, z: 0 };
  private anchorBody: RigidBody | null = null;
  /** Metres the deck under the feet carried them on the last step. */
  private carriedBy = 0;
  private readonly ray: Ray;
  private groundHit: RayColliderIntersection | undefined;
  /** a lying capsule: its half axis (between the caps) and heading; the quaternion that lays it along the heading */
  private readonly halfAxis: number;
  private yaw = 0;
  private readonly rot = { x: 0, y: 0, z: 0, w: 1 };
  private readonly probe = { x: 0, y: 0, z: 0 };
  private readonly flat = { x: 0, y: 0, z: 0 };
  private readonly movement = { x: 0, y: 0, z: 0 };
  private retryMovement: Vec3 | undefined;
  private contact: CharacterCollision | undefined;
  /** Rapier reads a translation synchronously; retain its numeric upload row. */
  private readonly translation = { x: 0, y: 0, z: 0 };
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
    this.kcc.setUp(UP);
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
      this.result.groundCollider = result.groundColliderHandle !== null && world.colliders.raw.contains(result.groundColliderHandle) ? world.getCollider(result.groundColliderHandle) : null;
      // J127: a save holds the capsule's Rapier bytes. An older one holds the host's old capsule: rebuild it on this law's,
      // whose climb limit is the constructor's. A capsule the save agrees with keeps the limit it was saved at (a gait's).
      if (Math.abs(this.collider.radius() - opts.radius) < 1e-5) { this.kcc.setMaxSlopeClimbAngle(state.climbAngle); this.kcc.setMinSlopeSlideAngle(state.slideAngle); }
      else this.collider.setShape(new R.Capsule(half, opts.radius));
    }
  }
  /** Collider handles reconnect against the restored Rapier world, never the disposed world's wrappers. */
  snapshot(): MotorState {
    const result = this.result;
    return { version: 1, colliderHandle: this.collider.handle, filter: this.filter, ghost: this.ghost, enabled: this.enabled,
      yaw: this.yaw, anchor: { ...this.anchor }, anchorBodyHandle: this.anchorBody?.handle ?? null,
      climbAngle: this.kcc.maxSlopeClimbAngle(), slideAngle: this.kcc.minSlopeSlideAngle(),
      result: { grounded: result.grounded, groundNormalY: result.groundNormalY, downhillX: result.downhillX, downhillZ: result.downhillZ,
        horizontalFreedom: result.horizontalFreedom, groundColliderHandle: result.groundCollider !== null && this.physics.world.colliders.raw.contains(result.groundCollider.handle) ? result.groundCollider.handle : null } };
  }

  /** What the next step reads of this motor (the deck it rides and the ground it last stood on) into a flat `out` at `at`,
   *  for a predictor's ring (player/motionState.ts). It allocates nothing. A handle is -1 for none. */
  captureState(out: Float64Array, at: number): void {
    const { anchor: a, result: r } = this;
    out[at] = a.x; out[at + 1] = a.y; out[at + 2] = a.z; out[at + 3] = this.anchorBody?.handle ?? -1;
    out[at + 4] = Number(r.grounded); out[at + 5] = r.groundNormalY; out[at + 6] = r.downhillX; out[at + 7] = r.downhillZ;
    out[at + 8] = r.horizontalFreedom; out[at + 9] = r.groundCollider !== null && this.physics.world.colliders.raw.contains(r.groundCollider.handle) ? r.groundCollider.handle : -1; out[at + 10] = this.carriedBy;
  }
  /** Put a `captureState` back. A body or collider the world has dropped since is let go. */
  restoreState(from: Float64Array, at: number): void {
    const { anchor: a, result: r } = this, { world } = this.physics, body = from[at + 3] ?? -1, ground = from[at + 9] ?? -1;
    a.x = from[at] ?? 0; a.y = from[at + 1] ?? 0; a.z = from[at + 2] ?? 0;
    // a handle's lookup boxes its number: the usual restore finds the wrapper it already holds
    if ((this.anchorBody?.handle ?? -1) !== body) this.anchorBody = body !== -1 && world.bodies.contains(body) ? world.getRigidBody(body) : null;
    r.grounded = from[at + 4] === 1; r.groundNormalY = from[at + 5] ?? 1; r.downhillX = from[at + 6] ?? 0; r.downhillZ = from[at + 7] ?? 0;
    r.horizontalFreedom = from[at + 8] ?? 1; this.carriedBy = from[at + 10] ?? 0;
    if (ground === -1 || !world.colliders.raw.contains(ground)) r.groundCollider = null;
    else if (r.groundCollider?.handle !== ground) r.groundCollider = world.getCollider(ground);
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

  /** Stand where and as a predictor saved this capsule, unchecked: it stood there. */
  standAt(feet: Vec3, yaw: number): void {
    this.yaw = yaw;
    if (this.opts.length !== undefined) { this.layAlong(yaw); this.collider.setRotation(this.rot); }
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
  private stalledOnFloor(minUp: number): boolean {
    const n = this.kcc.numComputedCollisions();
    if (n === 0) return false;
    for (let i = 0; i < n; i++) { const c = this.kcc.computedCollision(i); if (c === null || c.normal1.y < minUp) return false; }
    return true;
  }

  /** Both contacts can be at the skin, leaving the native sweep at the
   * mercy of tree order. Only a purely static WORLD move may retry. */
  private staticContacts(): number | null {
    let contacts = 0;
    const climb = Math.cos(this.kcc.maxSlopeClimbAngle()), reach = this.kcc.offset() / 2;
    const scratch = this.contact ??= new this.physics.R.CharacterCollision();
    for (let i = 0; i < this.kcc.numComputedCollisions(); i++) {
      const hit = this.kcc.computedCollision(i, scratch);
      if (hit === null || hit.collider === null) return null;
      const { collider, normal1, toi } = hit, parent = collider.parent();
      if ((parent !== null && !parent.isFixed()) || ((collider.collisionGroups() >>> 16) & GROUP.WORLD) === 0) return null;
      // NL14b2: terrain beside a wall is a bank (`slideOffBank`)
      if (isTerrainCollider(collider)) {
        if (toi <= reach && normal1.y >= 0.1) contacts |= BANK_CONTACT;
        continue;
      }
      if (toi <= reach && normal1.y >= climb && normal1.y < 0.999999) contacts |= SLOPE_CONTACT;
      if (Math.abs(normal1.y) < 0.1) contacts |= WALL_CONTACT;
    }
    return contacts;
  }

  /**
   * NET-LAG NL14b2: feet on a terrain bank against a wall meet both inside the skin at time 0, and the controller slides off
   * whichever its query tree visits first. The page's world and the room's never build that tree alike, so the same step
   * from the same state parted: on Driftwood's ramp under the cove cliff the two alternated 3 to 5 cm out of step every tick
   * and corrected sprints. Start the move high enough that the bank is two skins away (a wall stands as close as before, so
   * only the wall is at time 0), and fall back onto the bank inside the move. The bank is measured from the capsule, not
   * from the tie's contacts. On a bank too steep to climb, what pushes into it is dropped, so it is not climbed.
   */
  private slideOffBank(feet: Vec3, want: Vec3, predicate: ((collider: Collider) => boolean) | undefined): Vec3 | null {
    const { R, world } = this.physics, start = this.translation, skin = this.kcc.offset(), flags = R.QueryFilterFlags.EXCLUDE_SENSORS;
    // the bank the feet lean on: the terrain point nearest the capsule's lower sphere. The contacts' normals came from the tie
    // itself, and a ray under the feet finds the floor below them, not the bank at their side.
    const centre = this.probe; centre.x = feet.x; centre.y = feet.y + this.opts.radius; centre.z = feet.z;
    const near = world.projectPoint(centre, true, flags, this.filter, this.collider, undefined, isTerrainCollider);
    if (near === null || near.isInside) return null;
    const bank = this.bank, nx = centre.x - near.point.x, ny = centre.y - near.point.y, nz = centre.z - near.point.z, gap = Math.hypot(nx, ny, nz);
    if (gap < 1e-6 || gap > this.opts.radius + 2 * skin) return null;
    bank.x = nx / gap; bank.y = ny / gap; bank.z = nz / gap;
    if (bank.y < 0.1) return null;
    this.smoothBank(near.point);
    const lift = 2 * skin / bank.y;
    if (world.castShape(start, this.rot, UP, this.collider.shape, 0, lift, false, flags, this.filter, this.collider, undefined, predicate) !== null) return null;
    start.y += lift;
    this.collider.setTranslation(start);
    const move = this.droppedWant(want, lift, steepShare(bank.y, Math.cos(this.kcc.maxSlopeClimbAngle())));
    const impulses = this.kcc.applyImpulsesToDynamicBodies();
    this.kcc.setApplyImpulsesToDynamicBodies(false);
    try { this.kcc.computeColliderMovement(this.collider, move, flags, this.filter, predicate); }
    finally { this.kcc.setApplyImpulsesToDynamicBodies(impulses); }
    const retry = this.kcc.computedMovement(this.retryMovement ??= { x: 0, y: 0, z: 0 });
    retry.y += lift;
    return retry;
  }

  /** Re-run a slide from one skin higher, with gravity left to the snap.
   * Keep the original result at an edge, under a low roof, or when the
   * retry finds a new obstruction or substantially changes floor height. */
  private slideAboveSlope(want: Vec3, predicate: ((collider: Collider) => boolean) | undefined): Vec3 | null {
    const { R, world } = this.physics, start = this.translation, clearance = this.kcc.offset();
    const flags = R.QueryFilterFlags.EXCLUDE_SENSORS;
    if (world.castShape(start, this.rot, UP, this.collider.shape, 0, clearance, false, flags,
      this.filter, this.collider, undefined, predicate) !== null) return null;
    start.y += clearance;
    this.collider.setTranslation(start);
    const impulses = this.kcc.applyImpulsesToDynamicBodies();
    this.kcc.setApplyImpulsesToDynamicBodies(false);
    try {
      this.kcc.computeColliderMovement(this.collider, this.flatWant(want), flags, this.filter, predicate);
    } finally { this.kcc.setApplyImpulsesToDynamicBodies(impulses); }
    if (!this.kcc.computedGrounded() || this.staticContacts() === null) return null;
    const retry = this.kcc.computedMovement(this.retryMovement ??= { x: 0, y: 0, z: 0 });
    retry.y += clearance;
    const rise = clearance + Math.hypot(retry.x, retry.z) * Math.tan(this.kcc.maxSlopeClimbAngle());
    return retry.y <= Math.min(rise, this.opts.step) && retry.y >= -Math.min(rise, this.opts.snap) ? retry : null;
  }

  /**
   * A stalled grounded move tried once more from one step height up, flat, then set down. It is kept only when the capsule
   * goes most of the way and lands, within a step of where it stood, on ground it may walk (so a steep slope stays a wall).
   */
  private stepOver(want: Vec3, predicate: ((collider: Collider) => boolean) | undefined): Vec3 | null {
    const { R, world } = this.physics, start = this.translation, step = this.opts.step, skin = this.kcc.offset();
    const flags = R.QueryFilterFlags.EXCLUDE_SENSORS, x = start.x, y = start.y, z = start.z;
    // as high as a step, or as the roof lets it (a low beam over the wreck's corner)
    const up = world.castShape(start, this.rot, UP, this.collider.shape, 0, step, false, flags, this.filter, this.collider, undefined, predicate);
    const rise = up === null ? step : up.time_of_impact - skin;
    if (rise < 2 * skin) return null;
    start.y = y + rise;
    this.collider.setTranslation(start);
    const impulses = this.kcc.applyImpulsesToDynamicBodies();
    this.kcc.setApplyImpulsesToDynamicBodies(false);
    try { this.kcc.computeColliderMovement(this.collider, this.flatWant(want), flags, this.filter, predicate); }
    finally { this.kcc.setApplyImpulsesToDynamicBodies(impulses); start.x = x; start.y = y; start.z = z; this.collider.setTranslation(start); }
    const flat = this.kcc.computedMovement(this.retryMovement ??= { x: 0, y: 0, z: 0 }), wantH = Math.hypot(want.x, want.z);
    if (Math.hypot(flat.x, flat.z) < wantH * 0.5) return null;
    const probe = this.probe; probe.x = x + flat.x; probe.y = y + rise + flat.y; probe.z = z + flat.z;
    const down = world.castShape(probe, this.rot, DOWN, this.collider.shape, 0, rise + this.opts.snap, false, flags, this.filter, this.collider, undefined, predicate);
    if (down === null) return null;
    // ground too steep to walk (the box's edge itself) may be crossed level or downhill, never climbed
    const landed = probe.y - down.time_of_impact + skin - y, walkable = Math.abs(down.normal2.y) >= Math.cos(this.kcc.maxSlopeClimbAngle());
    if (landed > (walkable ? step : skin) || landed < -this.opts.snap) return null;
    flat.y = landed;
    return flat;
  }

  /** Begin grounded downward moves on a ray-measured float32 skin plane above nearly flat static support.
   * Tiny height differences otherwise choose different coplanar contacts and change a later wall slide.
   * A terrain ray describes one triangle, not the capsule's heightfield contact; leave that contact to the controller. */
  private restOnFlatFloor(feet: Vec3): boolean {
    if (!this.result.grounded || this.result.groundNormalY < 0.999999) return false;
    this.ray.origin.x = feet.x; this.ray.origin.y = feet.y + GROUND_PROBE_UP; this.ray.origin.z = feet.z;
    const hit = this.physics.castRayAndGetNormal(this.ray, GROUND_PROBE_UP + GROUND_PROBE_DOWN, true,
      this.physics.R.QueryFilterFlags.EXCLUDE_SENSORS, this.filter, this.collider, undefined,
      this.phased.size > 0 ? this.notPhased : undefined, this.groundHit);
    if (hit === null) return false;
    const parent = hit.collider.parent(), flat = hit.normal.y >= 0.999999 && !isTerrainCollider(hit.collider)
      && ((hit.collider.collisionGroups() >>> 16) & GROUP.WORLD) !== 0 && (parent === null || parent.isFixed());
    const plane = Math.fround(this.ray.origin.y - hit.timeOfImpact), skin = this.kcc.offset(), y = plane + skin;
    hit.collider = this.collider; this.groundHit = hit;
    if (flat && Math.abs(y - feet.y) <= skin) { feet.y = y; this.restPlane = plane; return true; }
    return false;
  }
  private restPlane = 0;

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
    if (this.noDeckNear(p)) return false;
    return world.intersectionWithShape(p, this.rot, this.deckProbe,
      R.QueryFilterFlags.ONLY_KINEMATIC | R.QueryFilterFlags.EXCLUDE_SENSORS, this.filter, this.collider) !== null;
  }

  /** QA 11-24 row 72: no deck can be near when no kinematic body's collider can reach the probe. The deck query cost every
   *  walking player 1.3 to 1.6 us a tick, almost always to answer false (Driftwood: 2127 colliders, a few movers). While
   *  the world holds few kinematic bodies, their colliders are measured against the probe's bounding sphere; a shape with
   *  no simple bound, a near one, or more kinematic bodies asks the query as before. */
  private noDeckNear(center: Vec3): boolean {
    const { kinematic } = this.physics;
    if (kinematic.size > FEW_DECKS) return false;
    this.deckFar = true; this.deckCenter = center;
    kinematic.forEach(this.seeDeck);
    return this.deckFar;
  }
  private deckFar = true;
  private deckCenter: Vec3 = { x: 0, y: 0, z: 0 };
  private readonly deckAt: Vec3 = { x: 0, y: 0, z: 0 };
  private readonly deckExtents: Vec3 = { x: 0, y: 0, z: 0 };
  private readonly seeDeck = (body: RigidBody): void => {
    if (!this.deckFar) return;
    const c = this.deckCenter, probe = this.halfAxis + this.opts.radius + DECK_REACH + DECK_SLACK;
    for (let i = 0; i < body.numColliders(); i++) {
      const collider = body.collider(i), at = collider.translation(this.deckAt), reach = probe + this.boundOf(collider);
      if (!((at.x - c.x) ** 2 + (at.y - c.y) ** 2 + (at.z - c.z) ** 2 > reach * reach)) { this.deckFar = false; return; }
    }
  };
  /** The radius of a sphere about the collider's origin that holds its shape; Infinity for a shape with no simple bound. */
  private boundOf(collider: Collider): number {
    const { ShapeType } = this.physics.R, type = collider.shapeType();
    if (type === ShapeType.Ball) return collider.radius();
    if (type === ShapeType.Cuboid) { const e = collider.halfExtents(this.deckExtents); return e === null ? Infinity : Math.hypot(e.x, e.y, e.z); }
    if (type === ShapeType.Capsule) return collider.halfHeight() + collider.radius();
    if (type === ShapeType.Cylinder) return Math.hypot(collider.halfHeight(), collider.radius());
    return Infinity;
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
  move(feet: Vec3, asked: Vec3, ignoreGround = false): MoveResult {
    const r = this.result;
    if (!this.enabled) { feet.x += asked.x; feet.y += asked.y; feet.z += asked.z; r.grounded = false; r.groundNormalY = 1; r.horizontalFreedom = 1; r.groundCollider = null; this.anchorBody = null; return r; }
    const rested = !ignoreGround && asked.y <= 0 && this.restOnFlatFloor(feet);
    const wantH = Math.hypot(asked.x, asked.z), sideways = rested && wantH > 1e-6;
    if (sideways) feet.y += REST_LIFT;
    const want = sideways ? this.flatWant(asked) : asked;
    const { R } = this.physics, translation = this.translation;
    translation.x = feet.x; translation.y = feet.y + this.lift; translation.z = feet.z;
    this.collider.setTranslation(translation);
    // SF49 / SF51: a sideways move near a kinematic body (a mover's deck, at rest or ridden) starts a skin higher (see
    // `nearDeck`); a move with no sideways part isn't snapped back down by the controller, so it starts where it is.
    const lifted = wantH > 1e-6 && want.y <= 0 && this.nearDeck(feet) ? this.kcc.offset() : 0;
    if (lifted > 0) {
      translation.x = feet.x; translation.y = feet.y + this.lift + lifted; translation.z = feet.z;
      this.collider.setTranslation(translation);
    }
    const pred = this.phased.size > 0 ? ignoreGround ? this.notGroundOrPhased : this.notPhased : ignoreGround ? this.notGround : undefined;
    this.kcc.computeColliderMovement(this.collider, want, R.QueryFilterFlags.EXCLUDE_SENSORS, this.filter, pred);
    let m = this.kcc.computedMovement(this.movement);
    // E285: now and then Rapier stops the whole move on the floor the capsule already rests on (one contact, normal
    // straight up, time of impact 0), and a dash ended on that "wall" (~1 dodge in 5). Such a stall is retried flat;
    // the snap still keeps the feet on the ground, and anything that really blocks the way blocks the retry too.
    // NL13: a flat-floor hit can also eat only part of the move (35% freedom
    // on Far Reach). Retry losses over 10%, only for nearly vertical contact normals;
    // slopes retain the original severe-stall threshold and walls never qualify.
    let movedH = Math.hypot(m.x, m.z);
    if (wantH > 1e-6 && want.y <= 0 && movedH < wantH * 0.9
        && this.stalledOnFloor(movedH < wantH * 0.3 ? Math.cos(this.kcc.maxSlopeClimbAngle()) : 0.9999)) {
      this.flat.x = want.x; this.flat.y = 0; this.flat.z = want.z;
      this.kcc.computeColliderMovement(this.collider, this.flat, R.QueryFilterFlags.EXCLUDE_SENSORS, this.filter, pred);
      m = this.kcc.computedMovement(this.movement);
      movedH = Math.hypot(m.x, m.z);
    }
    let grounded = this.kcc.computedGrounded();
    if (!ignoreGround && this.opts.group === 'PLAYER' && this.opts.length === undefined && lifted === 0 && r.grounded
        && want.y < 0) {
      // A vertical move cannot request a slope retry. A bank retry needs both a terrain contact and a separate wall.
      const contacts = wantH === 0 && this.kcc.numComputedCollisions() < 2 ? 0 : this.staticContacts();
      const retry = contacts === (SLOPE_CONTACT | WALL_CONTACT) && movedH < wantH * 0.99 ? this.slideAboveSlope(want, pred)
        : contacts === (BANK_CONTACT | WALL_CONTACT) ? this.slideOffBank(feet, want, pred) : null;
      if (retry !== null) { m = retry; grounded = true; }
    }
    // QA-FEEDBACK-2026-11-20-mini row 4: feet perched on a box's top edge (grounded, with no ground under their centre) read
    // the edge as a slope too steep to climb, not a wall, so the controller never steps up it; between two walls (Driftwood's
    // wreck hull) no move got out, jumps included. Feet on ground that stall (a bank, a wall) keep their stall.
    if (!ignoreGround && this.opts.group === 'PLAYER' && this.opts.length === undefined && lifted === 0 && r.grounded && r.groundCollider === null && want.y <= 0 && wantH > 1e-6 && Math.hypot(m.x, m.z) < wantH * STALLED) {
      const over = this.stepOver(want, pred);
      if (over !== null) { m = over; grounded = true; }
    }
    feet.x += m.x; feet.y += m.y + lifted; feet.z += m.z;
    if (sideways && Math.abs(feet.y - (this.restPlane + this.kcc.offset() + REST_LIFT)) < 1e-6) feet.y = this.restPlane + this.kcc.offset();
    translation.x = feet.x; translation.y = feet.y + this.lift; translation.z = feet.z;
    this.collider.setTranslation(translation);
    r.grounded = grounded;
    r.horizontalFreedom = wantH > 1e-6 ? Math.min(1, Math.hypot(m.x, m.z) / wantH) : 1;
    // the ground under the feet: a short ray down from just above them. (The controller's own contacts are empty while
    // resting — snapped or standing still — so they can't say what we stand on.)
    r.groundNormalY = 1; r.downhillX = 0; r.downhillZ = 0; r.groundCollider = null;
    if (r.grounded) {
      this.ray.origin.x = feet.x; this.ray.origin.y = feet.y + GROUND_PROBE_UP; this.ray.origin.z = feet.z;
      const hit = this.physics.castRayAndGetNormal(this.ray, GROUND_PROBE_UP + GROUND_PROBE_DOWN, true, R.QueryFilterFlags.EXCLUDE_SENSORS, this.filter, this.collider, undefined, this.phased.size > 0 ? this.notPhased : undefined, this.groundHit);
      if (hit) {
        const nrm = hit.normal, h = Math.hypot(nrm.x, nrm.z) || 1;
        r.groundCollider = hit.collider;
        r.groundNormalY = nrm.y; r.downhillX = nrm.x / h; r.downhillZ = nrm.z / h;
        // Keep only numeric query scratch. A retired foreign surface must not
        // stay rooted through it; the public move result owns its actual hit.
        hit.collider = this.collider; this.groundHit = hit;
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
    this.carriedBy = 0;
    if (b === null) return false;
    const t = b.translation(), q = b.rotation(), a = this.anchor;
    // rotate the local anchor by q, then translate
    const ix = q.w * a.x + q.y * a.z - q.z * a.y, iy = q.w * a.y + q.z * a.x - q.x * a.z, iz = q.w * a.z + q.x * a.y - q.y * a.x, iw = -q.x * a.x - q.y * a.y - q.z * a.z;
    const x = t.x + ix * q.w + iw * -q.x + iy * -q.z - iz * -q.y;
    const y = t.y + iy * q.w + iw * -q.y + iz * -q.x - ix * -q.z;
    const z = t.z + iz * q.w + iw * -q.z + ix * -q.y - iy * -q.x;
    // the feet were put somewhere else since the last move (a respawn, a quest's teleport): that ends the ride
    if ((x - feet.x) ** 2 + (y - feet.y) ** 2 + (z - feet.z) ** 2 > 1.5 * 1.5) { this.anchorBody = null; return false; }
    this.carriedBy = Math.hypot(x - feet.x, y - feet.y, z - feet.z);
    feet.x = x; feet.y = y; feet.z = z;
    return true;
  }

  private readonly flatScratch: Vec3 = { x: 0, y: 0, z: 0 };
  private flatWant(want: Vec3): Vec3 { this.flatScratch.x = want.x; this.flatScratch.y = 0; this.flatScratch.z = want.z; return this.flatScratch; }
  /** The move with its fall and the fall back from `lift` (no snap holds feet on a bank too steep to climb); a `steep` bank
   *  takes no part of the move that pushes into it. */
  private droppedWant(want: Vec3, lift: number, steep: number): Vec3 {
    const { bank } = this, h = Math.hypot(bank.x, bank.z) || 1, ux = bank.x / h, uz = bank.z / h, into = steep * Math.min(0, want.x * ux + want.z * uz);
    this.flatScratch.x = want.x - into * ux; this.flatScratch.y = want.y - lift; this.flatScratch.z = want.z - into * uz;
    return this.flatScratch;
  }
  /**
   * NET-LAG NL14b1: the bank as the terrain's slope across the feet, not the nearest face's normal. In a fold between two
   * faces either side of the climb limit (Nalati's bank by a boulder, 41 and 34 degrees) the nearest face flips with a
   * millimetre, and the move with it: steep, the push into it is dropped and the feet slide along; climbable, they climb back.
   * They chattered there every 3 or 4 ticks, offline too, and the page and the room never chattered in step. Central
   * differences of the terrain's heights a step either side of the nearest point change little when it jumps faces, so
   * the move does too.
   */
  private smoothBank(at: Vec3): void {
    const d = BANK_SPAN, east = this.terrainHeight(at.x + d, at.z, at.y), west = this.terrainHeight(at.x - d, at.z, at.y);
    const north = this.terrainHeight(at.x, at.z + d, at.y), south = this.terrainHeight(at.x, at.z - d, at.y);
    if (east === null || west === null || north === null || south === null) return;
    const gx = (east - west) / (2 * d), gz = (north - south) / (2 * d), n = Math.hypot(gx, 1, gz), { bank } = this;
    bank.x = -gx / n; bank.y = 1 / n; bank.z = -gz / n;
  }
  /** The terrain's height under (x, z), looking down from a little over the feet; null off the terrain. */
  private terrainHeight(x: number, z: number, from: number): number | null {
    const ray = this.bankRay ??= new this.physics.R.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
    ray.origin.x = x; ray.origin.y = from + BANK_RAY_UP; ray.origin.z = z;
    const hit = this.physics.world.castRay(ray, BANK_RAY_UP + BANK_RAY_DOWN, true, this.physics.R.QueryFilterFlags.EXCLUDE_SENSORS, this.filter, this.collider, undefined, isTerrainCollider);
    return hit === null ? null : ray.origin.y - hit.timeOfImpact;
  }
  private bankRay: Ray | null = null;
  /** the bank `slideOffBank` measured: its outward normal */
  private readonly bank: Vec3 = { x: 0, y: 1, z: 0 };

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
    this.groundHit = undefined;
    this.physics.world.removeCharacterController(this.kcc);
    this.physics.world.removeCollider(this.collider, false);
  }
}
