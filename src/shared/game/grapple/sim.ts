import type { GrappleClearance } from '@wildshard/format/grapple';
import { Vector3 } from 'three';
import * as v from 'valibot';
import { castRay, castSegment, floorBelow, lineOfSight } from '@wildshard/engine/physics/query';
import { GrappleModeSchema, type GrappleMode } from '@wildshard/format/modes';
import type { CharacterMotor } from '@wildshard/engine/physics/CharacterMotor';
import type { Physics } from '@wildshard/engine/physics/Physics';

/** Default platform grapple parameters; courses may supply an admitted authored profile. */
export const DEFAULT_GRAPPLE_MODE: GrappleMode = v.parse(GrappleModeSchema, { id: 'grapple' });
/** Real hook roster and native visibility/guard ports; a mode profile grants no anchor or floor. */
export interface GrappleCourse {
  readonly mode?: GrappleMode;
  readonly name: string;
  /** the rings' centres, world space: what the claw bites */
  readonly hooks: readonly Vector3[];
  readonly clearance?: GrappleClearance;
}

/** The body the claw pulls: the player's feet, velocity, ground flag and capsule (the client Player, or the host's). */
export interface GrappleBody {
  readonly position: Vector3;
  readonly velocity: Vector3;
  onGround: boolean;
  readonly motor: Pick<CharacterMotor, 'collider' | 'move'>;
}
/** What the claw asks of the world: the physics queries and the body it pulls. */
export interface GrapplePorts { readonly physics: Physics; readonly body: GrappleBody }

/** the player's capsule, feet to crown (Player.ts BODY_HEIGHT) plus a margin: the room a zip's approach point needs */
const grappleBODY = 1.95;
/** QB17 (b): a rising zip's hang under the ring (s), and the longest its rise may take (s; 18 m/s: ~25 m) */
const RISE_HANG = 0.18, RISE_LIMIT = 1.4;

/** The aim: an eye, a screen projection (normalized device coordinates) and the look direction. */
export interface GrappleView {
  readonly eye: Vector3;
  /** refresh the view's matrices before a full test of every hook */
  update?: () => void;
  project: (point: Vector3, out: Vector3) => Vector3;
  forward: (out: Vector3) => Vector3;
}
/** A validated hook, real landing and native approach. */
export interface GrappleTarget { hook: Vector3; landing: Vector3; approach: Vector3; lifts: boolean }
/** Native traversal phase name. */
export type GrapplePhase = 'idle' | 'fire' | 'bite' | 'lift' | 'zip' | 'vault' | 'settle' | 'miss' | 'reel' | 'dock';
/** Native observations are drained by trusted presentation or tick owners. */
export type GrappleEvent = { readonly kind: 'fire' | 'miss' | 'bite' | 'zip' | 'reel' | 'dock' } | { readonly kind: 'release'; readonly active: boolean };

/** Native clearance tests operate on the declared obstacle, never a shard callback. */
export function grappleNeedsLift(course: GrappleCourse, from: Vector3, landing: Vector3): boolean {
  const c = course.clearance; if (c === undefined) return false;
  const axis = c.axis, cross = axis === 'z' ? 'x' : 'z';
  return from[axis] > c.plane && landing[axis] < c.plane && from[cross] >= c.min && from[cross] <= c.max && from.y >= c.base - 1;
}
/** Height needed to clear the segment while respecting the declared overhead ceiling. */
export function grappleLiftTo(course: GrappleCourse, from: Vector3, approach: Vector3): number {
  const c = course.clearance; if (c === undefined) return from.y + 3.5;
  const t = Math.min(.9, Math.max(0, (from[c.axis] - (c.plane - .7)) / Math.max(.01, from[c.axis] - approach[c.axis])));
  return Math.min(c.ceiling, Math.max(from.y + 3.5, (c.top + .35 - approach.y * t) / (1 - t)));
}

const grappleUP = { x: 0, y: 1, z: 0 };
const grappleVToward = new Vector3(), grappleVSide = new Vector3(), grappleVProbe = new Vector3();

/** The claw sees a hook: a clear line of sight, or past what only the course knows (a declared obstruction). */
export function hookVisible(ports: GrapplePorts, course: GrappleCourse, eye: Vector3, hook: Vector3): boolean {
  if (lineOfSight(ports.physics, eye, hook, 1.1, ports.body.motor.collider)) return true;
  const c = course.clearance; if (c === undefined) return false;
  const body = ports.body.motor.collider, hit = castSegment(ports.physics, eye, hook, ['WORLD'], body);
  const axis = c.axis, cross = axis === 'z' ? 'x' : 'z';
  if (hit === null || Math.abs(hit.point[axis] - c.plane) > .45 || hit.point[cross] < c.min || hit.point[cross] > c.max) return false;
  const owner: unknown = hit.owner;
  const id: unknown = typeof owner === 'string' ? owner : typeof owner === 'object' && owner !== null ? Reflect.get(owner, 'id') : null;
  if (typeof id !== 'string' || !c.owners.includes(id)) return false;
  const direction = new Vector3().subVectors(hook, eye).normalize();
  const past = new Vector3(hit.point.x, hit.point.y, hit.point.z).addScaledVector(direction, 1.1);
  return lineOfSight(ports.physics, past, hook, 1.1, body);
}

/** the capsule's footprint (Player.ts RADIUS 0.38 and a hair): four probes round the landing */
const grappleFOOT = [[0.4, 0], [-0.4, 0], [0, 0.4], [0, -0.4]] as const;
/** a floor the capsule can stand on at (x, z): within a tread's rise across its whole width (a stair is; a rail's top, a
 *  balustrade's or the square's edge by the balustrade is not) */
function grappleStandable(ports: GrapplePorts, x: number, y: number, z: number): boolean {
  const body = ports.body.motor.collider;
  for (const [dx, dz] of grappleFOOT) {
    const f = floorBelow(ports.physics, x + dx, z + dz, y + 0.6, 1.2, body);
    if (f === undefined || Math.abs(f - y) > 0.4) return false;
  }
  return true;
}

// back steps from the ring toward the player first; then past it (a ring on a lip: the pull carries you over onto the
// floor behind it, E286's rim → square crossing)
const grappleBACKS = [1.2, 2, 2.8, 4, 6, -1.6, -2.4, -3.2, -4.2] as const;
const grappleSIDES = [0, -2, 2, -4, 4] as const;

/** where a landing was found: none (no safe zip target), between the player and the ring, or past the ring */
export const NONE = 0, NEAR = 1, PAST = 2;
/** Which side of the anchor holds the verified floor. */
export type Side = typeof NONE | typeof NEAR | typeof PAST;

/** The actual floor near a ring, approached from `from` (the player's feet), written to `out`. */
export function landingFor(ports: GrapplePorts, from: Vector3, hook: Vector3, out: Vector3): Side {
  grappleVToward.subVectors(from, hook).setY(0);
  if (grappleVToward.lengthSq() < 0.01) return NONE;
  grappleVToward.normalize();
  grappleVSide.set(-grappleVToward.z, 0, grappleVToward.x);
  const fromY = hook.y + 2;
  const body = ports.body.motor.collider;
  for (const back of grappleBACKS) {
    for (const sideStep of grappleSIDES) {
      grappleVProbe.copy(hook).addScaledVector(grappleVToward, back).addScaledVector(grappleVSide, sideStep);
      const floor = floorBelow(ports.physics, grappleVProbe.x, grappleVProbe.z, fromY, 12, body);
      if (floor === undefined || floor < hook.y - 9 || floor > hook.y + 1.8) continue;
      if (!grappleStandable(ports, grappleVProbe.x, floor, grappleVProbe.z)) continue;
      out.set(grappleVProbe.x, floor + 0.12, grappleVProbe.z);
      return back > 0 ? NEAR : PAST;
    }
  }
  return NONE;
}

/**
 * Where the zip flies to for a landing past the ring: over it at up to the ring's height (so it comes in over the lip the
 * ring hangs from, a rail or a balustrade, instead of through it) with room for the capsule under anything overhead,
 * then the player drops on. A landing on the player's side is flown to straight, as it always was.
 */
function grappleApproachFor(ports: GrapplePorts, hook: Vector3, landing: Vector3, out: Vector3): void {
  let clear = Math.min(1.6, Math.max(0, hook.y - landing.y - 0.2));
  if (clear > 0) {
    const hit = castRay(ports.physics, landing, grappleUP, clear + grappleBODY, ['WORLD'], ports.body.motor.collider);
    if (hit !== null) clear = Math.max(0, Math.min(clear, hit.distance - grappleBODY));
  }
  out.copy(landing);
  out.y += clear;
}

/** Build the native approach only from a verified landing. */
export function targetFor(ports: GrapplePorts, course: GrappleCourse, hook: Vector3, landing: Vector3, side: Side): GrappleTarget {
  const approach = landing.clone();
  if (side === PAST) grappleApproachFor(ports, hook, landing, approach);
  return { hook, landing: landing.clone(), approach, lifts: grappleNeedsLift(course, ports.body.position, landing) };
}

/** the full test of every hook, for the LOCK press when no candidate is cached (a one-off, not per frame) */
export function nearestHook(ports: GrapplePorts, course: GrappleCourse, view: GrappleView): GrappleTarget | null {
  view.update?.();
  const eye = view.eye;
  const landing = new Vector3(), p = new Vector3();
  let chosen: GrappleTarget | null = null, score = Infinity;
  for (const hook of course.hooks) {
    const mode = course.mode ?? DEFAULT_GRAPPLE_MODE;
    const d = eye.distanceTo(hook);
    if (d < mode.minRange || d > mode.maxRange) continue;
    view.project(hook, p);
    if (p.z < -1 || p.z > 1 || Math.abs(p.x) > mode.windowX || Math.abs(p.y) > mode.windowY) continue;
    const s = p.x * p.x + p.y * p.y * 0.55 + d * 0.0008;
    if (s >= score || !hookVisible(ports, course, eye, hook)) continue;
    const side = landingFor(ports, ports.body.position, hook, landing);
    if (side === NONE) continue;
    chosen = targetFor(ports, course, hook, landing, side);
    score = s;
  }
  return chosen;
}

/**
 * The hook a client named, by its index in the course, if the claw can bite it from here: real, in range, in sight and with a
 * landing. The aim window is left out: it is the client's camera, and the server has none.
 */
export function namedHook(ports: GrapplePorts, course: GrappleCourse, view: GrappleView, index: number): GrappleTarget | null {
  const hook = course.hooks[index], mode = course.mode ?? DEFAULT_GRAPPLE_MODE;
  if (hook === undefined) return null;
  view.update?.();
  const reach = view.eye.distanceTo(hook), landing = new Vector3();
  if (reach < mode.minRange || reach > mode.maxRange || !hookVisible(ports, course, view.eye, hook)) return null;
  const side = landingFor(ports, ports.body.position, hook, landing);
  return side === NONE ? null : targetFor(ports, course, hook, landing, side);
}

/** The outcome of a LOCK press: nothing to do (fall through to the plain lock-on), held (a crossing in flight), let go, armed for a miss shot, or locked on a hook. */
export type LockResult = 'pass' | 'busy' | 'released' | 'armed' | 'locked';

interface Xyz { x: number; y: number; z: number }
/** The grapple's exact continuation (the phase clock, the target, the miss point). */
export interface GrappleSaved {
  phase: GrapplePhase; armedMiss: boolean; clock: number; blocked: number; liftY: number; missEnd: Xyz;
  target: { hook: Xyz; landing: Xyz; approach: Xyz; lifts: boolean } | null;
}
const grappleXyz = (point: Vector3): Xyz => ({ x: point.x, y: point.y, z: point.z });
const grappleVec = (p: Xyz): Vector3 => new Vector3(p.x, p.y, p.z);

/** The grapple's state machine: LOCK, JUMP (fire), the traversal step and the release. */
export class GrappleSim {
  phase: GrapplePhase = 'idle';
  target: GrappleTarget | null = null;
  armedMiss = false;
  clock = 0;
  readonly missEnd: Vector3 = new Vector3();
  course: GrappleCourse;
  private blocked = 0;
  private liftY = 0;
  /** QB17 (b): this zip rises to the ring first (`rise`), and how long it has hung there */
  private rising = false;
  private hung = 0;
  private readonly ports: GrapplePorts;
  /** QB17 (b) / MF15: whether a zip rises to the ring before it flies to its landing (the browser tool's Debug row; the
   *  headless runtime and the tests keep the flat zip) */
  private readonly rise: () => boolean;
  private events: GrappleEvent[] = [];
  drainEvents(): readonly GrappleEvent[] { const events = this.events; this.events = []; return events; }
  private readonly end = new Vector3();
  private readonly want = new Vector3();
  private readonly before = new Vector3();

  constructor(ports: GrapplePorts, course: GrappleCourse, options: { readonly rise?: () => boolean } = {}) {
    this.ports = ports; this.course = course; this.rise = options.rise ?? (() => false);
  }

  /** a crossing has started: the safety guard stays open until a safe landing or bailout, LOCK cannot let go */
  busy(): boolean { return this.phase !== 'idle' && this.phase !== 'miss' && this.phase !== 'reel' && this.phase !== 'dock'; }
  /** a hook is locked or the miss shot is armed */
  holding(): boolean { return this.target !== null || this.armedMiss; }

  release(): void {
    const active = this.phase !== 'idle' && this.phase !== 'dock';
    this.phase = 'idle'; this.target = null; this.armedMiss = false; this.clock = this.blocked = 0; this.rising = false;
    this.events.push({ kind: 'release', active });
  }

  /** the LOCK press: `candidate` is the cached pick (else the full test), `lockedOn` whether an enemy lock-on owns an empty LOCK */
  lock(view: GrappleView, candidate: GrappleTarget | null, lockedOn: boolean): LockResult {
    if (this.busy()) return 'busy';
    if (this.holding()) { this.release(); return 'released'; }
    const pick = candidate ?? nearestHook(this.ports, this.course, view);
    if (pick === null) {
      if (lockedOn) return 'pass';
      this.armedMiss = true;
      return 'armed';
    }
    this.target = pick;
    return 'locked';
  }

  /** a net client's LOCK press: `index` is the hook it picked (a bad one is as good as none) */
  lockHook(view: GrappleView, index: number): LockResult { return this.lock(view, namedHook(this.ports, this.course, view, index), false); }

  /** the JUMP press: fire at the locked hook (or the armed miss shot along the view); false when nothing is held */
  fire(view: GrappleView): boolean {
    if (this.target === null && !this.armedMiss) return false;
    if (this.phase !== 'idle') return true;
    this.phase = 'fire'; this.clock = 0;
    const p = this.ports.body.position;
    if (this.target === null) {
      view.forward(this.want);
      this.missEnd.copy(view.eye).addScaledVector(this.want, 19);
      this.missEnd.y -= 1.2;
    } else if (this.target.lifts) {
      this.liftY = grappleLiftTo(this.course, p, this.target.approach);
    } else if (this.rise()) {
      // QB17 (b): up to the ring first, the capsule hanging under it, never through what is overhead
      const ceiling = this.target.hook.y - grappleBODY, up = ceiling - p.y;
      const hit = up > 0.5 ? castRay(this.ports.physics, p, grappleUP, up + grappleBODY, ['WORLD'], this.ports.body.motor.collider) : null;
      this.liftY = hit === null ? ceiling : Math.min(ceiling, p.y + Math.max(0, hit.distance - grappleBODY));
      this.rising = this.liftY > p.y + 0.5; this.hung = 0;
    }
    this.events.push({ kind: 'fire' });
    return true;
  }

  /** one fixed step of a grapple in flight; true while it owns the body's move (the player's own walk waits) */
  traverse(dt: number): boolean {
    if (this.phase === 'idle') return false;
    this.clock += dt;
    const p = this.ports.body, target = this.target, want = this.want, before = this.before;
    if (this.phase === 'fire') {
      p.velocity.set(0, 0, 0);
      if (this.clock >= (this.course.mode ?? DEFAULT_GRAPPLE_MODE).fireTime) {
        this.clock = 0;
        if (target === null) { this.phase = 'miss'; this.events.push({ kind: 'miss' }); }
        else { this.phase = 'bite'; this.events.push({ kind: 'bite' }); }
      }
      return true;
    }
    if (this.phase === 'miss') { if (this.clock >= 0.16) { this.phase = 'reel'; this.clock = 0; this.events.push({ kind: 'reel' }); } return false; }
    if (this.phase === 'reel') { if (this.clock >= (this.course.mode ?? DEFAULT_GRAPPLE_MODE).reelTime) { this.phase = 'dock'; this.clock = 0; this.events.push({ kind: 'dock' }); } return false; }
    if (this.phase === 'dock') { if (this.clock >= 0.12) this.release(); return false; }
    if (target === null) { this.release(); return false; }
    if (this.phase === 'bite') {
      p.velocity.set(0, 0, 0);
      if (this.clock >= (this.course.mode ?? DEFAULT_GRAPPLE_MODE).biteTime) { this.phase = target.lifts || this.rising ? 'lift' : 'zip'; this.clock = 0; p.onGround = false; this.events.push({ kind: 'zip' }); }
      return true;
    }
    if (this.phase === 'lift') {
      const rise = Math.min(18 * dt, Math.max(0, this.liftY - p.position.y));
      before.copy(p.position);
      p.motor.move(p.position, want.set(0, rise, 0), true);
      p.velocity.subVectors(p.position, before).divideScalar(dt);
      p.onGround = false;
      if (p.position.y >= this.liftY - 0.2) {
        // QB17 (b): a rising zip hangs a beat under the ring before it flies down to its landing
        if (this.rising && this.hung < RISE_HANG) { this.hung += dt; p.velocity.set(0, 0, 0); return true; }
        this.phase = 'zip'; this.clock = 0; this.rising = false;
      } else if (this.clock > (this.rising ? RISE_LIMIT : 0.6)) { this.rising = false; this.release(); }
      return true;
    }
    if (this.phase === 'vault') {
      // A short motor-driven pop clears the hook's lip; Rapier still owns collision.
      before.copy(p.position);
      p.motor.move(p.position, want.set(0, 0.7 * dt, 0), true);
      p.velocity.subVectors(p.position, before).divideScalar(dt);
      if (this.clock >= 0.14) { this.phase = 'settle'; this.clock = 0; }
      return true;
    }
    if (this.phase === 'settle') {
      p.velocity.set(0, -0.5, 0);
      if (this.clock >= 0.10) { this.release(); return false; }
      return true;
    }
    // the pull flies to the approach point over the landing; from there the player drops onto it
    this.end.copy(target.approach);
    want.subVectors(this.end, p.position);
    const remaining = want.length();
    if (remaining < 0.25) { this.phase = 'vault'; this.clock = 0; p.velocity.set(0, 0, 0); return true; }
    want.multiplyScalar(Math.min((this.course.mode ?? DEFAULT_GRAPPLE_MODE).zipSpeed * dt, remaining) / remaining);
    before.copy(p.position);
    p.motor.move(p.position, want, true);
    const moved = p.position.distanceTo(before);
    p.velocity.subVectors(p.position, before).divideScalar(dt);
    p.onGround = false;
    this.blocked = moved < want.length() * 0.15 ? this.blocked + dt : 0;
    if (this.blocked > 0.22 || this.clock > 2.5) { p.velocity.set(0, -0.5, 0); this.release(); }
    return true;
  }

  snapshot(): GrappleSaved {
    const t = this.target;
    return { phase: this.phase, armedMiss: this.armedMiss, clock: this.clock, blocked: this.blocked, liftY: this.liftY, missEnd: grappleXyz(this.missEnd),
      target: t === null ? null : { hook: grappleXyz(t.hook), landing: grappleXyz(t.landing), approach: grappleXyz(t.approach), lifts: t.lifts } };
  }
  /** restore a saved grapple; the course's guard is the caller's (open exactly while a lifting crossing is in flight: `guardOpen`) */
  /** the clearance guard's state the grapple implies: open from a lifting crossing's fire to its release */
  guardOpen(): boolean { return this.phase !== 'idle' && this.target?.lifts === true; }
  restore(saved: GrappleSaved): void {
    this.phase = saved.phase; this.armedMiss = saved.armedMiss; this.clock = saved.clock; this.blocked = saved.blocked; this.liftY = saved.liftY;
    this.missEnd.set(saved.missEnd.x, saved.missEnd.y, saved.missEnd.z);
    const t = saved.target;
    this.target = t === null ? null : { hook: grappleVec(t.hook), landing: grappleVec(t.landing), approach: grappleVec(t.approach), lifts: t.lifts };
  }
}
