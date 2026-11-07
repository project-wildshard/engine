/**
 * The player's motion step: the one composer of the laws in this folder (walk, fall, jump, shove, impulse, dash, swim,
 * board), called per player by the server's tick (sim/playerSim.ts) and by the client's Player (player/Player.ts), so
 * prediction can replay what the server ran (P1-E4.1, E5-REPLICATION §5.1).
 *
 * It is a pure step over `PlayerMotionState`, a command and a `MotionWorld` of injected queries and moments: no renderer,
 * no DOM, no `app`, no device. What a caller does around it stays with the caller: reading devices, camera, bob and FOV on
 * the client; drivers, traversal asks and the weapon's strike on the server.
 *
 * The two callers ran two composers until E4.1. There is one law now, the page's (J112, P1-E5.3), so the step can be replayed
 * on the client to the server's 2 cm: a resting body steps too, because slopes slide and decks carry.
 *
 * A ride is the one mode whose law is not here: `MotionWorld.ride`, a neutral port (J48, P1-E5.3-D1). The engine holds no
 * riding law and names no animal; the game's sits behind the port on both sides, and the step hands it the tick.
 */
import { Vector3 } from 'three';
import type { LocalMovementCommand } from '../input/commands';
import type { CharacterMotor } from '../physics/CharacterMotor';
import { stepBoard, type BoardPorts, type BoardState, type BoardStepOut } from './board';
import { DODGE_DIST, DODGE_TIME, dashBlocked, dashToward, dodgeHeading, startDash, startDodge, stepDash, stepDodge, type DashState, type DodgeState } from './dash';
import { fallStep, groundedVelocity, hardLanding, landingCushion } from './fall';
import { decayImpulse } from './impulse';
import { jump as jumpLaw, jumpClock, jumpSpeed, type JumpState } from './jump';
import { lockedDodge, orbitMove, type LockedDodge, type LockState, type MotionLock } from './lockOrbit';
import { stepShove, type ShoveState } from './shove';
import { deepWater, entryKeep, NO_SPRINT_DEPTH, stepSwim, swimEntry, swimStroke, wadeFraction, type SwimPorts, type SwimState } from './swim';
import { walkingSpeed, walkVelocity } from './walk';

/** Slopes (on foot, on terrain, never a platform, the water or the board): ground normal y below this (≈ 53°) slides. */
const SLOPE_SLIDE = 0.6;
/** m/s down the fall line while sliding … */
const SLIDE_SPEED = 3.2;
/** … reached at this rate (/s). */
const SLIDE_ACCEL = 5;

/** What a step resolved about the ground and water under the feet, for the view and the next step. */
export interface MotionFooting {
  /** the water surface at the feet, null on dry land */
  water: number | null;
  /** m of water over the feet (0 dry, on the board, or above the surface) */
  depth: number;
  /** on foot and grounded with water over the feet */
  wading: boolean;
  /** the ground under the feet is a floor function (a deck), never too steep */
  onPlatform: boolean;
  /** on ground too steep to stand on, sliding with no control */
  sliding: boolean;
}

/** One player's motion state. Server: PlayerSim itself. Client: a view over Player, where the velocities are one vector. */
export interface PlayerMotionState {
  readonly position: Vector3;
  yaw: number;
  /** what an owner scales the walk by (an input lock: 0, a slowing zone) */
  moveScale: number;
  /** transient world velocity (m/s), player/impulse.ts */
  readonly impulse: Vector3;
  /** The one world velocity (m/s, y negative = falling) through every mode, so speed carries from foot to board to water
   *  and back (P1-E5.3-A1). */
  readonly velocity: Vector3;
  /** whether the feet last stood on ground */
  readonly fall: { grounded: boolean };
  readonly shove: ShoveState;
  readonly dash: DashState;
  readonly dodge: DodgeState;
  /** The fixed step this state stands at: the swell's clock is `tick × FIXED_STEP` on both sides (P1-E5.3-A14). The law reads it
   *  only through `MotionWorld.bob`. A client's counts its commands; the server's is its host's. */
  tick: number;
  /** a lock-on's held orbit radius */
  readonly lock: LockState;
  /** the jump clocks */
  jump: JumpState;
  readonly board: BoardState & { on: boolean };
  readonly swim: SwimState & { on: boolean; stood: boolean };
  readonly footing: MotionFooting;
}

/** One fixed step's input. World-space move; `moveX`/`moveZ` are not yet clamped. A SimCommand is one as it stands. */
export interface MotionCommand extends LocalMovementCommand {
  readonly moveX: number; readonly moveZ: number; readonly yaw: number;
  /** presses */
  readonly jump?: boolean; readonly dodge?: boolean;
  /** held while swimming */
  readonly dive?: boolean; readonly surface?: boolean;
  /** the target this step's move and dodge bend round: a caller resolves it, player/lockOrbit.ts */
  readonly lock?: MotionLock | undefined;
}
/** All a dodge press reads of a command. */
export type DodgePress = Pick<MotionCommand, 'moveX' | 'moveZ' | 'yaw' | 'lock'>;

/** A floor function: a walkable surface's height at (x, z), or undefined off it. */
export type MotionPlatform = (x: number, z: number) => number | undefined;

/** The on-foot control for this step, read live. */
export interface MotionFoot {
  /** m/s the walk asks for at this wade fraction */
  speed: (wadeT: number) => number;
  readonly crouching: boolean;
  /** the ground grace window (ms) */
  readonly coyoteMs: number;
}

/** A body that carries its player, in place of the player's own step. It reads the command on its own side of the world's step. */
export interface MotionRide {
  /** Move the body one fixed step, and the rider with it. */
  step: (dt: number) => void;
}

/** What a step reads of the world and tells it, injected by each caller. */
export interface MotionWorld {
  /** this player's capsule */
  readonly motor: Pick<CharacterMotor, 'move' | 'carry' | 'result'>;
  /** what carries this player now, read live: it owns the step, and no clock of the player's own runs under it. Null on foot */
  readonly ride: MotionRide | null;
  /** false: this world has no water and asks nothing of it */
  readonly hasWater: boolean;
  /** the rest water surface at (x, z), or null */
  water: (x: number, z: number) => number | null;
  /** the terrain at (x, z) */
  heightAt: (x: number, z: number) => number;
  /** floor functions, the bridge for decks that are not colliders; a world without them has none */
  readonly platforms: readonly MotionPlatform[];
  /** the first floor collider below (x, fromY, z) within `maxDrop`, this player's capsule excluded */
  floor: (x: number, z: number, fromY: number, maxDrop: number) => number | undefined;
  /** the surface's swell over its rest level at (x, z) */
  bob: (x: number, z: number) => number;
  readonly foot: MotionFoot;
  /** the board's cruise speed, and whether it is a hard limit */
  boardTop: () => number;
  boardCapped: () => boolean;
  /** a jump left the ground or the board */
  jumped: () => void;
  /** a press started a dodge along this unit world heading; `back` it had no input, so it is a backstep */
  dodged: (x: number, z: number, back: boolean) => void;
  /** a locked dodge closed in, as a lunge does */
  lunged: () => void;
  /** what a perk scales the dodge's cooldown by */
  dodgeScale: () => number;
  /** the feet touched down from the air at `vy` m/s, on `cushion` of water */
  landed: (hard: boolean, vy: number, cushion: number) => void;
  /** an airborne board touched down at `speed` m/s */
  boardLanded: (speed: number) => void;
  /** swimming started or stopped */
  swimChanged: (on: boolean) => void;
  /** one swim stroke */
  stroked: () => void;
  /** the step's own reusable scratch: start it null */
  scratch: MotionScratch | null;
}

/** What a step did, reused from step to step: read it before the next. */
export interface MotionOut {
  /** the motion mode this step ran */
  mode: 'board' | 'swim' | 'foot' | 'ride';
  /** a jump left the ground or the board */
  jumped: boolean;
  /** how a swim step ended: still floating, drifted off the water, or stood up */
  left: 'swim' | 'dry' | 'stood' | null;
  /** the board's telemetry */
  readonly board: BoardStepOut;
  /** the fraction of the fall speed the last water entry kept */
  entryKeep: number;
}

/** The step's reusable objects, one per world. */
export interface MotionScratch {
  readonly out: MotionOut;
  readonly want: Vector3;
  readonly heading: { x: number; z: number };
  readonly locked: LockedDodge;
  readonly swimOut: { water: number | null };
  readonly boardPorts: BoardPorts;
  readonly swimPorts: SwimPorts;
  readonly ground: () => number;
  readonly deep: (x: number, z: number) => boolean;
}

/** The highest floor under the feet: the terrain, a floor function they are at or just under, or the first collider
 *  floor within 80 m below the feet + 0.5 m. */
function groundUnderFeet(s: PlayerMotionState, w: MotionWorld): number {
  const p = s.position;
  let g = w.heightAt(p.x, p.z);
  for (const platform of w.platforms) {
    const y = platform(p.x, p.z);
    if (y !== undefined && y > g && p.y >= y - 0.5) g = y;
  }
  const c = w.floor(p.x, p.z, p.y + 0.5, 80);
  return c !== undefined && c > g ? c : g;
}
/** The highest floor function under the feet that they can stand on (at or above it, or ≤ 0.5 m below its top). */
function platformUnderFeet(s: PlayerMotionState, w: MotionWorld): number | undefined {
  const p = s.position;
  let best: number | undefined;
  for (const platform of w.platforms) {
    const y = platform(p.x, p.z);
    if (y !== undefined && p.y >= y - 0.5 && (best === undefined || y > best)) best = y;
  }
  return best;
}
/** Whether a step sprints: asked for, going forward (the command's `keyY + stickY`), on foot, not crouching, and not past
 *  sprint depth at the feet's last resolve. */
export function sprints(s: PlayerMotionState, sprint: boolean, forward: number, crouching: boolean): boolean {
  return sprint && forward > 0 && !crouching && !s.board.on && !s.swim.on && s.footing.depth < NO_SPRINT_DEPTH;
}

function motionScratch(s: PlayerMotionState, w: MotionWorld): MotionScratch {
  const ground = (): number => groundUnderFeet(s, w);
  const out: MotionOut = { mode: 'foot', jumped: false, left: null, board: { lat: 0, fwd: 0, accel: 0, water: null }, entryKeep: 0.3 };
  return { out, ground, want: new Vector3(), heading: { x: 0, z: 0 }, locked: { vx: 0, vz: 0, time: 0, stopAt: 0 }, swimOut: { water: null },
    deep: (x, z) => w.hasWater && deepWater(x, z, s.position.y, w.water(x, z), w.heightAt(x, z), w.platforms, w.floor),
    boardPorts: { move: (feet, want) => { w.motor.move(feet, want, true); }, ground, water: (x, z) => w.water(x, z),
      jumped: () => { out.jumped = true; w.jumped(); }, landed: (speed) => { w.boardLanded(speed); } },
    swimPorts: { move: (feet, want) => w.motor.move(feet, want, true), water: (x, z) => w.water(x, z), ground,
      get platforms() { return w.platforms; }, floor: w.floor, bob: (x, z) => w.bob(x, z), leave: () => { leaveSwim(s, w); } } };
}

/** Stop swimming (the swim law's `leave`, or the board): the dive and the haul-out let go. */
export function leaveSwim(s: PlayerMotionState, w: MotionWorld): void {
  const { swim } = s;
  if (!swim.on) return;
  swim.on = false; swim.climbTo = null; swim.diving = false;
  w.swimChanged(false);
}
/** Step on or off the board, keeping the one velocity. On: the swim ends and the feet leave the ground. Off: gravity lands
 *  them from the ride height, on the next step. */
export function setBoard(s: PlayerMotionState, w: MotionWorld, on: boolean): void {
  s.board.on = on;
  if (on) { s.fall.grounded = false; leaveSwim(s, w); }
}
/** Put the feet somewhere new: speed, impulse, dash and the swim end there. The ground flag stays until the next step
 *  resolves it, so a walk carries on from a respawn at its ground acceleration. The caller moves its capsule. */
export function resetMotion(s: PlayerMotionState, w: MotionWorld, x: number, y: number, z: number, yaw: number): void {
  s.position.set(x, y, z); s.yaw = yaw;
  s.velocity.set(0, 0, 0); s.impulse.set(0, 0, 0); s.dash.t = 0;
  leaveSwim(s, w);
  s.footing.depth = 0; s.footing.wading = false;
}
/** Start swimming, from the walk: most of the fall speed goes into the splash, and the walk's own speed stays. */
function enterSwim(s: PlayerMotionState, w: MotionWorld, run: MotionScratch): void {
  const { swim, fall, velocity } = s, keep = entryKeep(velocity.y);
  swim.on = true; swim.strokeTime = 0; run.out.entryKeep = keep;
  fall.grounded = false;
  velocity.y *= keep;
  w.swimChanged(true);
}

/** The DODGE press: toward the command's world move, a backstep with none, at DODGE_DIST / DODGE_TIME. The page's
 *  dodge knows the lock-on, a client-only target: it presses for itself and never sends this. */
/** A dodge press, ahead of the tick's mode: a caller presses before it asks who owns the step, so a press counts as the page
 *  has always counted it. Reads only the command. Refused on its cooldown, on the board, in the water and on a slide. */
export function pressDodge(s: PlayerMotionState, cmd: DodgePress, w: MotionWorld): boolean {
  const run = w.scratch ??= motionScratch(s, w), { dash, dodge, board, swim, footing, position: p } = s, { heading, locked } = run;
  if (dodge.cd > 0 || board.on || swim.on || footing.sliding) return false;
  const len = dodgeHeading(cmd.moveX, cmd.moveZ, cmd.yaw, heading), v = DODGE_DIST / DODGE_TIME;
  const { lock } = cmd, kind = lock !== undefined && len >= 0.2 ? lockedDodge(lock, p.x, p.z, DODGE_DIST, DODGE_TIME, heading, locked) : 'straight';
  if (kind === 'close') {
    if (lock === undefined || !dashToward(dash, p.x, p.z, lock.x, lock.z, locked.stopAt, locked.time)) return false;
    w.lunged();
  } else if (kind === 'hop') startDash(dash, locked.vx, locked.vz, locked.time);
  else startDash(dash, heading.x * v, heading.z * v, DODGE_TIME);
  startDodge(dodge, w.dodgeScale());
  w.dodged(heading.x, heading.z, len < 0.2);
  return true;
}

/** The walk a command asks of a host: the dry speed, the same on every shard, and the crouch. The wade and the two scales
 *  are `MotionFoot.speed`'s. A legacy tape command has no steer, so its "forward" is its world move along the yaw. */
export function commandedWalk(s: PlayerMotionState, cmd: MotionCommand | undefined, out: { speed: number; crouching: boolean }): void {
  const forward = cmd === undefined ? 0 : cmd.steer === undefined
    ? -Math.sin(cmd.yaw) * cmd.moveX - Math.cos(cmd.yaw) * cmd.moveZ
    : Math.max(-1, Math.min(1, cmd.steer.keyY + cmd.steer.stickY));
  const crouching = cmd?.crouch === true && !s.board.on && !s.swim.on;
  out.crouching = crouching;
  out.speed = walkingSpeed(crouching, sprints(s, cmd?.sprint === true, forward, crouching), 0, 1, 1);
}

function stepOnBoard(s: PlayerMotionState, w: MotionWorld, run: MotionScratch, mx: number, mz: number, len: number, jump: boolean, dt: number): void {
  const { out, boardPorts } = run, { footing } = s;
  stepBoard(s.position, s.velocity, s.impulse, run.want, s.board, { mx, mz, len, yaw: s.yaw, top: w.boardTop(), capped: w.boardCapped(), jump }, boardPorts, dt, out.board);
  decayImpulse(s.impulse, dt);
  footing.onPlatform = false; footing.water = out.board.water; footing.depth = 0; footing.wading = false;
}

function stepInWater(s: PlayerMotionState, cmd: MotionCommand | undefined, w: MotionWorld, run: MotionScratch, mx: number, mz: number, len: number, dt: number): void {
  const { fall, footing, swim, velocity: v } = s;
  s.impulse.set(0, 0, 0);
  footing.onPlatform = false;
  const left = stepSwim(s.position, v, run.want, swim, { mx, mz, len, dive: cmd?.dive === true, surface: cmd?.surface === true }, run.swimPorts, dt, run.swimOut);
  run.out.left = left;
  footing.wading = false;
  if (left === 'dry') {
    // drifted off the water: back on foot, and gravity takes it from here
    fall.grounded = false;
    footing.water = null; footing.depth = 0;
    return;
  }
  const ws = run.swimOut.water;
  footing.water = ws;
  footing.depth = ws === null ? 0 : Math.max(0, ws - s.position.y);
  fall.grounded = left === 'stood';
  if (left === 'stood') { v.y = 0; swim.stood = true; }
  swimStroke(swim, v, dt, w.stroked); // on the step a swimmer stands up too
}

/** The velocity the input asks for, or a slide, a shove or a dash in its place. */
function steerFoot(s: PlayerMotionState, w: MotionWorld, run: MotionScratch, mx: number, mz: number, wadeT: number, dt: number): void {
  const { dash, fall, footing, position: p, shove, velocity: walk } = s, speed = w.foot.speed(wadeT);
  let accel = fall.grounded ? 14 : 3, wx = mx * speed, wz = mz * speed;
  // too steep: the controller will not climb ground past its limit (it is a wall); past SLOPE_SLIDE (the ground the feet
  // stood on last step) the feet slide down the fall line with no control
  footing.sliding = false;
  const last = w.motor.result;
  if (fall.grounded && !footing.onPlatform && !footing.wading && last.groundNormalY < SLOPE_SLIDE) {
    wx = last.downhillX * SLIDE_SPEED; wz = last.downhillZ * SLIDE_SPEED; accel = SLIDE_ACCEL; footing.sliding = true;
  }
  if (shove.t > 0) {
    const k = stepShove(shove, dt);
    walk.x = shove.vx * k; walk.z = shove.vz * k;
  } else if (dash.t > 0) stepDash(dash, dt, p.x, p.z, run.deep, walk);
  else { walk.x = walkVelocity(walk.x, wx, accel, dt); walk.z = walkVelocity(walk.z, wz, accel, dt); }
}

function stepOnFoot(s: PlayerMotionState, cmd: MotionCommand | undefined, w: MotionWorld, run: MotionScratch, mx: number, mz: number, dt: number): void {
  const { foot } = w, { out, want } = run, { dash, fall, footing, impulse, position: p, velocity } = s;
  // the wade: water over the grounded feet slows the walk and saps the jump
  const wadeT = wadeFraction(fall.grounded, footing.depth);
  steerFoot(s, w, run, mx, mz, wadeT, dt);
  // the jump on last step's ground, before the step's gravity
  jumpClock(s.jump, fall.grounded, dt);
  if (cmd?.jump === true) {
    const vy = jumpLaw(s.jump, fall.grounded, velocity.y, foot.coyoteMs, foot.crouching || footing.sliding, jumpSpeed(wadeT));
    if (vy !== null) { velocity.y = vy; fall.grounded = false; out.jumped = true; w.jumped(); }
  }
  // gravity first, then the whole move through the motor
  velocity.y = fallStep(velocity.y, dt);
  want.set((velocity.x + impulse.x) * dt, (velocity.y + impulse.y) * dt, (velocity.z + impulse.z) * dt);
  // standing on something that moves: the feet ride the deck's new pose first, and the move gets no downward push (the
  // controller's slide would spread it along the moving contact into a sideways drift)
  if (fall.grounded && w.motor.carry(p) && want.y <= 0) want.y = 0;
  const moved = w.motor.move(p, want);
  // a dash that runs into a wall ends there, not grinding along it
  dashBlocked(dash, moved.horizontalFreedom, velocity);
  // the floor-function bridge: a deck that is not a collider, stood on from on it or just under
  let grounded = moved.grounded;
  footing.onPlatform = false;
  const platform = platformUnderFeet(s, w);
  if (platform !== undefined && p.y - platform <= 0.05 && velocity.y <= 0) { p.y = platform; grounded = true; footing.onPlatform = true; }
  // The motor already resolved dry grounding: this extra ground query decides only water depth, entry and the cushion.
  const ws = w.hasWater ? w.water(p.x, p.z) : null, g = ws === null ? 0 : run.ground();
  if (swimEntry(p.y, ws, g)) {
    enterSwim(s, w, run);
    if (p.y < g) p.y = g;
  } else {
    if (grounded) {
      if (!fall.grounded) {
        // a landing in water is soft: the splash takes the impact
        const cushion = ws === null ? 0 : landingCushion(p.y < ws, ws - g);
        w.landed(hardLanding(velocity.y, cushion), velocity.y, cushion);
      }
      velocity.y = groundedVelocity(velocity.y);
    }
    fall.grounded = grounded;
  }
  footing.water = ws;
  footing.depth = ws === null ? 0 : Math.max(0, ws - p.y);
  footing.wading = fall.grounded && footing.depth > 0.02;
  decayImpulse(impulse, dt);
}

/** One fixed step of one player's own motion (`cmd` undefined: no input this tick). Reuses and returns the world's
 *  `MotionOut`. The world has stepped first. A ride owns the step; a driver or a traversal keeps its caller from calling this. */
export function stepPlayerMotion(s: PlayerMotionState, cmd: MotionCommand | undefined, w: MotionWorld, dt: number): MotionOut {
  const run = w.scratch ??= motionScratch(s, w), { out } = run, { board, dash, swim } = s;
  out.jumped = false; out.left = null;
  if (w.ride !== null) { out.mode = 'ride'; w.ride.step(dt); return out; }
  if (cmd !== undefined) s.yaw = cmd.yaw;
  stepDodge(s.dodge, dash.t > 0, dt);
  if (!swim.on) swim.stood = false; // last tick's stand-up is over
  if (!board.on) board.hoverBob = 0;
  const { heading } = run;
  heading.x = cmd?.moveX ?? 0; heading.z = cmd?.moveZ ?? 0;
  if (cmd?.lock !== undefined && !board.on && !swim.on) orbitMove(s.lock, cmd.lock, s.position.x, s.position.z, heading);
  let mx = heading.x, mz = heading.z;
  const len = Math.hypot(mx, mz);
  if (len > 1) { mx /= len; mz /= len; }
  if (board.on || swim.on) dash.t = 0; // the board and the water end a dash
  if (board.on) { out.mode = 'board'; stepOnBoard(s, w, run, mx, mz, len, cmd?.jump === true, dt); }
  else if (swim.on) { out.mode = 'swim'; stepInWater(s, cmd, w, run, mx, mz, len, dt); }
  else { out.mode = 'foot'; stepOnFoot(s, cmd, w, run, mx, mz, dt); }
  return out;
}
