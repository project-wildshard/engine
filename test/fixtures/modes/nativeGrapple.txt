/**
 * The Fei Zhua's law, renderer-free (SF72): which hook the claw may bite (in reach, in sight, with a floor to land on),
 * where the zip lands and flies to, and the grapple's phases (fire → bite → lift → zip → vault → settle, or a miss
 * reeled back), stepped on the player's own capsule through the engine's physics queries. One implementation: the
 * browser's Tool (FeiZhua.ts) drives it from the LOCK / JUMP presses and its traversal answer and draws the rope, markers
 * and FX from its state; the headless runtime (runtime/grapple.ts) drives it from tick commands. Nothing here draws.
 *
 * The aim is a port (`GrappleView`): the browser's camera, or the headless player's eye and heading.
 */
import { Vector3 } from 'three';
import { castRay, castSegment, floorBelow, lineOfSight } from '@wildshard/engine/physics/query';
import type { GrappleCourse, GrapplePorts } from './course';
import { WELL, Y0 } from '../layout';

export const MIN_RANGE = 2.5;
export const MAX_RANGE = 38;
const ZIP_SPEED = 22;
export const FIRE_TIME = 0.27;
const BITE_TIME = 0.10;
export const REEL_TIME = 0.48;
/** the centred window a hook must sit in to be the candidate (|ndc x|, |ndc y|) */
export const WIN_X = 0.52, WIN_Y = 0.68;
/** the player's capsule, feet to crown (Player.ts BODY_HEIGHT) plus a margin: the room a zip's approach point needs */
const BODY = 1.95;
/** the rim's solid stone parapet top (well.ts wellColliders), which a lifted Well crossing must clear */
const RIM_WALL = Y0 + 3.2;

/** The aim: an eye, a screen projection (normalized device coordinates) and the look direction. */
export interface GrappleView {
  readonly eye: Vector3;
  /** refresh the view's matrices before a full test of every hook */
  update?: () => void;
  project: (point: Vector3, out: Vector3) => Vector3;
  forward: (out: Vector3) => Vector3;
}
export interface GrappleTarget { hook: Vector3; landing: Vector3; approach: Vector3; lifts: boolean }
export type GrapplePhase = 'idle' | 'fire' | 'bite' | 'lift' | 'zip' | 'vault' | 'settle' | 'miss' | 'reel' | 'dock';
/** The phase changes the presentation follows (cues, arms, flashes, toasts); the law never waits on them. */
export interface GrappleEvents {
  fire?: () => void;
  miss?: () => void;
  bite?: () => void;
  zip?: () => void;
  reel?: () => void;
  dock?: () => void;
  /** every grapple ends here; `active` is whether it ended mid-flight (anything but idle or the dock) */
  release?: (active: boolean) => void;
}

const UP = { x: 0, y: 1, z: 0 };
const vDir = new Vector3(), vPast = new Vector3(), vToward = new Vector3(), vSide = new Vector3(), vProbe = new Vector3();

/** The claw sees a hook: a clear line of sight, or past what only the course knows (the fragment's Well rail). */
export function hookVisible(ports: GrapplePorts, course: GrappleCourse, eye: Vector3, hook: Vector3): boolean {
  if (lineOfSight(ports.physics, eye, hook, 1.1, ports.body.motor.collider)) return true;
  return course.seePast?.(ports, eye, hook) === true;
}

/** A hook beyond the Well rail (at z = `rimZ`) is visible to the claw if the rail is the only obstruction (the line of sight is blocked). */
function seePastWellRail(ports: GrapplePorts, rimZ: number, eye: Vector3, hook: Vector3): boolean {
  const body = ports.body.motor.collider;
  const hit = castSegment(ports.physics, eye, hook, ['WORLD'], body);
  if (hit === null || Math.abs(hit.point.z - rimZ) > 0.45 || hit.point.x < WELL.x0 || hit.point.x > WELL.x1) return false;
  // the page tags a collider with its piece, the host with the piece's id (runtime/headless.ts: snapshot-safe owners)
  const owner = hit.owner;
  const id: unknown = typeof owner === 'string' ? owner : typeof owner === 'object' && owner !== null ? Reflect.get(owner, 'id') : null;
  if (id !== 'nds-floors' && id !== 'nds-grapple-guard') return false;
  vDir.subVectors(hook, eye).normalize();
  vPast.set(hit.point.x, hit.point.y, hit.point.z).addScaledVector(vDir, 1.1);
  return lineOfSight(ports.physics, vPast, hook, 1.1, body);
}

/**
 * The fragment's own course: its dragon hooks, the Well rail a hook may be seen past, and the crossing north over the
 * Well from the south rim — it lifts over the rim's stone parapet first, with the safety cap open (`guard`). `rimZ` is
 * the south rim's line (world/well-plan.ts `RIM.z0`, which the world's renderer-bound plan module owns).
 */
export function wellCourse(hooks: readonly Vector3[], rimZ: number, guard: (open: boolean) => void): GrappleCourse {
  return {
    name: 'Nine Dragon Stack',
    hooks,
    seePast: (ports, eye, hook) => seePastWellRail(ports, rimZ, eye, hook),
    lifts: (p, landing) => p.z > rimZ && landing.z < rimZ && p.x >= WELL.x0 && p.x <= WELL.x1 && p.y >= Y0 - 1,
    // lift high enough that the straight pull to the approach point clears the rim's stone parapet (its top + a
    // margin, measured where the capsule has passed the stone), never less than the old 3.5 m, under the cap's top
    liftTo: (p, a) => {
      const past = rimZ - 0.7;
      const t = Math.min(0.9, Math.max(0, (p.z - past) / Math.max(0.01, p.z - a.z)));
      return Math.min(Y0 + 11, Math.max(p.y + 3.5, (RIM_WALL + 0.35 - a.y * t) / (1 - t)));
    },
    guard,
  };
}

/** the capsule's footprint (Player.ts RADIUS 0.38 and a hair): four probes round the landing */
const FOOT = [[0.4, 0], [-0.4, 0], [0, 0.4], [0, -0.4]] as const;
/** a floor the capsule can stand on at (x, z): within a tread's rise across its whole width (a stair is; a rail's top, a
 *  balustrade's or the square's edge by the balustrade is not) */
function standable(ports: GrapplePorts, x: number, y: number, z: number): boolean {
  const body = ports.body.motor.collider;
  for (const [dx, dz] of FOOT) {
    const f = floorBelow(ports.physics, x + dx, z + dz, y + 0.6, 1.2, body);
    if (f === undefined || Math.abs(f - y) > 0.4) return false;
  }
  return true;
}

// back steps from the ring toward the player first; then past it (a ring on a lip: the pull carries you over onto the
// floor behind it, E286's rim → square crossing)
const BACKS = [1.2, 2, 2.8, 4, 6, -1.6, -2.4, -3.2, -4.2] as const;
const SIDES = [0, -2, 2, -4, 4] as const;

/** where a landing was found: none (no safe zip target), between the player and the ring, or past the ring */
export const NONE = 0, NEAR = 1, PAST = 2;
export type Side = typeof NONE | typeof NEAR | typeof PAST;

/** The actual floor near a ring, approached from `from` (the player's feet), written to `out`. */
export function landingFor(ports: GrapplePorts, from: Vector3, hook: Vector3, out: Vector3): Side {
  vToward.subVectors(from, hook).setY(0);
  if (vToward.lengthSq() < 0.01) return NONE;
  vToward.normalize();
  vSide.set(-vToward.z, 0, vToward.x);
  const fromY = hook.y + 2;
  const body = ports.body.motor.collider;
  for (const back of BACKS) {
    for (const sideStep of SIDES) {
      vProbe.copy(hook).addScaledVector(vToward, back).addScaledVector(vSide, sideStep);
      const floor = floorBelow(ports.physics, vProbe.x, vProbe.z, fromY, 12, body);
      if (floor === undefined || floor < hook.y - 9 || floor > hook.y + 1.8) continue;
      if (!standable(ports, vProbe.x, floor, vProbe.z)) continue;
      out.set(vProbe.x, floor + 0.12, vProbe.z);
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
function approachFor(ports: GrapplePorts, hook: Vector3, landing: Vector3, out: Vector3): void {
  let clear = Math.min(1.6, Math.max(0, hook.y - landing.y - 0.2));
  if (clear > 0) {
    const hit = castRay(ports.physics, landing, UP, clear + BODY, ['WORLD'], ports.body.motor.collider);
    if (hit !== null) clear = Math.max(0, Math.min(clear, hit.distance - BODY));
  }
  out.copy(landing);
  out.y += clear;
}

export function targetFor(ports: GrapplePorts, course: GrappleCourse, hook: Vector3, landing: Vector3, side: Side): GrappleTarget {
  const approach = landing.clone();
  if (side === PAST) approachFor(ports, hook, landing, approach);
  return { hook, landing: landing.clone(), approach, lifts: course.lifts?.(ports.body.position, landing) === true };
}

/** the full test of every hook, for the LOCK press when no candidate is cached (a one-off, not per frame) */
export function nearestHook(ports: GrapplePorts, course: GrappleCourse, view: GrappleView): GrappleTarget | null {
  view.update?.();
  const eye = view.eye;
  const landing = new Vector3(), p = new Vector3();
  let chosen: GrappleTarget | null = null, score = Infinity;
  for (const hook of course.hooks) {
    const d = eye.distanceTo(hook);
    if (d < MIN_RANGE || d > MAX_RANGE) continue;
    view.project(hook, p);
    if (p.z < -1 || p.z > 1 || Math.abs(p.x) > WIN_X || Math.abs(p.y) > WIN_Y) continue;
    const s = p.x * p.x + p.y * p.y * 0.55 + d * 0.0008;
    if (s >= score || !hookVisible(ports, course, eye, hook)) continue;
    const side = landingFor(ports, ports.body.position, hook, landing);
    if (side === NONE) continue;
    chosen = targetFor(ports, course, hook, landing, side);
    score = s;
  }
  return chosen;
}

/** The outcome of a LOCK press: nothing to do (fall through to the plain lock-on), held (a crossing in flight), let go, armed for a miss shot, or locked on a hook. */
export type LockResult = 'pass' | 'busy' | 'released' | 'armed' | 'locked';

interface Xyz { x: number; y: number; z: number }
/** The grapple's exact continuation (the phase clock, the target, the miss point). */
export interface GrappleSaved {
  phase: GrapplePhase; armedMiss: boolean; clock: number; blocked: number; liftY: number; missEnd: Xyz;
  target: { hook: Xyz; landing: Xyz; approach: Xyz; lifts: boolean } | null;
}
const xyz = (v: Vector3): Xyz => ({ x: v.x, y: v.y, z: v.z });
const vec = (p: Xyz): Vector3 => new Vector3(p.x, p.y, p.z);

/** The grapple's state machine: LOCK, JUMP (fire), the traversal step and the release. */
export class GrappleSim {
  phase: GrapplePhase = 'idle';
  target: GrappleTarget | null = null;
  armedMiss = false;
  clock = 0;
  readonly missEnd = new Vector3();
  course: GrappleCourse;
  private blocked = 0;
  private liftY = 0;
  private readonly ports: GrapplePorts;
  private readonly events: GrappleEvents;
  private readonly end = new Vector3();
  private readonly want = new Vector3();
  private readonly before = new Vector3();

  constructor(ports: GrapplePorts, course: GrappleCourse, events: GrappleEvents = {}) {
    this.ports = ports; this.course = course; this.events = events;
  }

  /** a crossing has started: the safety guard stays open until a safe landing or bailout, LOCK cannot let go */
  busy(): boolean { return this.phase !== 'idle' && this.phase !== 'miss' && this.phase !== 'reel' && this.phase !== 'dock'; }
  /** a hook is locked or the miss shot is armed */
  holding(): boolean { return this.target !== null || this.armedMiss; }

  release(): void {
    const active = this.phase !== 'idle' && this.phase !== 'dock';
    this.phase = 'idle'; this.target = null; this.armedMiss = false; this.clock = this.blocked = 0;
    this.course.guard?.(false);
    this.events.release?.(active);
  }

  /** the LOCK press: `candidate` is the cached pick (else the full test), `lockedOn` whether an enemy lock-on owns an empty LOCK */
  lock(view: GrappleView, candidate: () => GrappleTarget | null, lockedOn: () => boolean): LockResult {
    if (this.busy()) return 'busy';
    if (this.holding()) { this.release(); return 'released'; }
    const pick = candidate() ?? nearestHook(this.ports, this.course, view);
    if (pick === null) {
      if (lockedOn()) return 'pass';
      this.armedMiss = true;
      return 'armed';
    }
    this.target = pick;
    return 'locked';
  }

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
      this.course.guard?.(true);
      this.liftY = this.course.liftTo?.(p, this.target.approach) ?? p.y + 3.5;
    }
    this.events.fire?.();
    return true;
  }

  /** one fixed step of a grapple in flight; true while it owns the body's move (the player's own walk waits) */
  traverse(dt: number): boolean {
    if (this.phase === 'idle') return false;
    this.clock += dt;
    const p = this.ports.body, target = this.target, want = this.want, before = this.before;
    if (this.phase === 'fire') {
      p.velocity.set(0, 0, 0);
      if (this.clock >= FIRE_TIME) {
        this.clock = 0;
        if (target === null) { this.phase = 'miss'; this.events.miss?.(); }
        else { this.phase = 'bite'; this.events.bite?.(); }
      }
      return true;
    }
    if (this.phase === 'miss') { if (this.clock >= 0.16) { this.phase = 'reel'; this.clock = 0; this.events.reel?.(); } return false; }
    if (this.phase === 'reel') { if (this.clock >= REEL_TIME) { this.phase = 'dock'; this.clock = 0; this.events.dock?.(); } return false; }
    if (this.phase === 'dock') { if (this.clock >= 0.12) this.release(); return false; }
    if (target === null) { this.release(); return false; }
    if (this.phase === 'bite') {
      p.velocity.set(0, 0, 0);
      if (this.clock >= BITE_TIME) { this.phase = target.lifts ? 'lift' : 'zip'; this.clock = 0; p.onGround = false; this.events.zip?.(); }
      return true;
    }
    if (this.phase === 'lift') {
      const rise = Math.min(18 * dt, Math.max(0, this.liftY - p.position.y));
      before.copy(p.position);
      p.motor.move(p.position, want.set(0, rise, 0), true);
      p.velocity.subVectors(p.position, before).divideScalar(dt);
      p.onGround = false;
      if (p.position.y >= this.liftY - 0.2) { this.phase = 'zip'; this.clock = 0; }
      else if (this.clock > 0.6) { this.release(); }
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
    want.multiplyScalar(Math.min(ZIP_SPEED * dt, remaining) / remaining);
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
    return { phase: this.phase, armedMiss: this.armedMiss, clock: this.clock, blocked: this.blocked, liftY: this.liftY, missEnd: xyz(this.missEnd),
      target: t === null ? null : { hook: xyz(t.hook), landing: xyz(t.landing), approach: xyz(t.approach), lifts: t.lifts } };
  }
  /** restore a saved grapple; the course's guard is the caller's (open exactly while a lifting crossing is in flight: `guardOpen`) */
  /** the Well safety cap's state the grapple implies: open from a lifting crossing's fire to its release */
  guardOpen(): boolean { return this.phase !== 'idle' && this.target?.lifts === true; }
  restore(saved: GrappleSaved): void {
    this.phase = saved.phase; this.armedMiss = saved.armedMiss; this.clock = saved.clock; this.blocked = saved.blocked; this.liftY = saved.liftY;
    this.missEnd.set(saved.missEnd.x, saved.missEnd.y, saved.missEnd.z);
    const t = saved.target;
    this.target = t === null ? null : { hook: vec(t.hook), landing: vec(t.landing), approach: vec(t.approach), lifts: t.lifts };
  }
}
