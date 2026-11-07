import { hoverCoastDecel } from './hoverSpeed';
import { groundedVelocity } from './fall';

/** A world point or velocity (m, m/s): three's Vector3, or the client Player's plain `want`. */
interface Vec3 { x: number; y: number; z: number }

/** m/s² toward the stick's velocity with input: 0 → the 14 m/s cruise in ~1.2 s. */
export const HOVER_ACCEL = 12;
/** /s: sideways velocity (relative to the heading) bleeds off faster than forward: carve, not shopping cart. */
export const HOVER_LAT_DRAG = 3.5;
/** m above the ground (terrain, platform, collider floor or water surface) the board rides at. */
export const HOVER_HEIGHT = 0.45;
/** The ride-height spring (ω ≈ 8.4 rad/s) … */
export const HOVER_SPRING_K = 70;
/** … slightly under-damped (ζ ≈ 0.39), so it bobs after a hop or a bump. */
export const HOVER_SPRING_C = 6.5;
/** m/s²: the spring's clamp, so a cliff edge feels like falling, not a slingshot. */
export const HOVER_SPRING_MAX = 30;
/** m/s board jump launch: the spring lets go and the lighter board gravity brings you down. */
export const HOVER_JUMP = 9.5;
/** m/s² while airborne on the board (floatier than on foot). */
export const HOVER_JUMP_GRAVITY = 15;
/** A board touchdown faster than this (m/s down) is hard (the client's onLand(hard), PlayerHurt's fall hit). */
export const HOVER_HARD_LANDING = 9;

/** The rider's board state the law reads and writes (the client Player's own fields, the SimHost's playerBoard). */
export interface BoardState {
  /** airborne after a jump or an upward shove: the spring is off and HOVER_JUMP_GRAVITY pulls */
  hoverAir: boolean;
  /** height over the ride height (m) after the last step */
  hoverBob: number;
  /** riding near the ride height (a jump is allowed) */
  onGround: boolean;
}
/** One step's resolved stick: world-space move direction (length ≤ 1, `len` its length), heading and the speed cap. */
export interface BoardMove {
  mx: number; mz: number; len: number; yaw: number;
  /** cruise speed (m/s, hoverSpeed()) */
  top: number;
  /** clamp the horizontal speed to `top` (the grid's position-dependent limit); standalone boards are not clamped */
  capped: boolean;
  jump: boolean;
}
/** What the board's host supplies: the motor, the ground under the feet, the water surface and the two moments. */
export interface BoardPorts {
  /** the rider's motor (CharacterMotor.move: walls, posts and trunks stop the board) */
  move: (feet: Vec3, want: Vec3) => void;
  /** the highest floor under the feet after the horizontal move: terrain, a platform, a collider floor */
  ground: () => number;
  /** the rest water surface at (x, z), or null */
  water: (x: number, z: number) => number | null;
  /** the board jumped this step */
  jumped: () => void;
  /** an airborne board touched down at `speed` m/s (downward) */
  landed: (speed: number) => void;
}
/** Telemetry a step leaves for the view: lateral and forward speed along the heading, forward acceleration, the water. */
export interface BoardStepOut { lat: number; fwd: number; accel: number; water: number | null }

/**
 * The hoverboard's motion law, shared by the client's Player and the headless SimHost so the two never drift (SF72):
 * momentum steering (velocity pulled toward the stick at HOVER_ACCEL, a released board coasts on hoverCoastDecel, the
 * sideways part carved off at HOVER_LAT_DRAG, half grip above the ride height), the horizontal move through the motor
 * (the terrain never stops it; the repulsors glide up anything), then the ride-height spring to the ground (or the water)
 * + HOVER_HEIGHT, or ballistic flight after a jump / an upward shove until it falls back to the ride height. An impulse
 * rides along through the motor; the caller decays it after the step, as on foot (player/impulse.ts).
 */
export function stepBoard(position: Vec3, v: Vec3, impulse: Readonly<Vec3>, want: Vec3, state: BoardState, move: BoardMove, ports: BoardPorts, dt: number, out: BoardStepOut): void {
  const sin = Math.sin(move.yaw), cos = Math.cos(move.yaw);
  const startBob = state.hoverBob;                               // where the last step left the board (over the ride height)
  const inAir = state.hoverBob > 0.35;                           // above the ride height (hop / ledge): half the grip
  const grip = inAir ? 0.5 : 1;
  const wantMove = move.len > 0.02;
  const top = move.top;
  const tx = wantMove ? move.mx * top : 0, tz = wantMove ? move.mz * top : 0;
  const dx = tx - v.x, dz = tz - v.z, dl = Math.hypot(dx, dz);
  const rate = (wantMove ? HOVER_ACCEL : hoverCoastDecel(Math.hypot(v.x, v.z))) * grip; // coast: speed-dependent decay (hoverSpeed.ts)
  const stepV = Math.min(dl, rate * dt);
  const vfx = v.x, vfz = v.z;
  if (dl > 1e-6) { v.x += dx / dl * stepV; v.z += dz / dl * stepV; }
  // carve: the sideways component (relative to the heading) is pulled toward what the stick asks for much faster
  // than the forward one — turn at speed and the old momentum, now sideways, bleeds off instead of sliding you
  const fx = -sin, fz = -cos, rx = cos, rz = -sin;
  const vf = v.x * fx + v.z * fz; let vl = v.x * rx + v.z * rz;
  const tl = tx * rx + tz * rz;
  vl += (tl - vl) * (1 - Math.exp(-HOVER_LAT_DRAG * grip * dt));
  v.x = fx * vf + rx * vl; v.z = fz * vf + rz * vl;
  if (move.capped) {
    const boardSpeed = Math.hypot(v.x, v.z);
    if (boardSpeed > top) { v.x *= top / boardSpeed; v.z *= top / boardSpeed; }
  }
  out.lat = vl; out.fwd = vf;
  out.accel = ((v.x - vfx) * fx + (v.z - vfz) * fz) / dt;

  // across: walls, posts and trunks stop the board; the terrain never does (the repulsors glide up anything)
  want.x = (v.x + impulse.x) * dt; want.y = 0; want.z = (v.z + impulse.z) * dt;
  ports.move(position, want);
  // ride height: a stiff, slightly under-damped spring to ground + HOVER_HEIGHT (no gravity — the repulsors hold you)
  const ws = ports.water(position.x, position.z);
  const g = Math.max(ports.ground(), ws ?? -Infinity); // the repulsors ride the water surface, not the seabed
  const target = g + HOVER_HEIGHT;
  const err = target - position.y;
  if (move.jump && state.onGround && !state.hoverAir) { v.y = HOVER_JUMP; state.hoverAir = true; state.onGround = false; ports.jumped(); }
  if (state.hoverAir) {
    // ── airborne: the repulsors can't reach the ground — ballistic, a little floaty, until we fall back to the ride height
    v.y -= HOVER_JUMP_GRAVITY * dt;
    if (impulse.y === 0) position.y += v.y * dt;
    else { want.x = 0; want.y = (v.y + impulse.y) * dt; want.z = 0; ports.move(position, want); }
    // touchdown. A board that began this step at the ride height never really left it (a shove too weak to lift it: the
    // updraft's steady feed shoves it airborne every tick and it lands the same tick), so its downward speed is spent,
    // as the walk's landing does (fall.ts groundedVelocity); kept, it grew 0.25 m/s a tick into hard landings (SF72).
    // A real flight (a jump, a strong shove) keeps it, so the spring takes the landing with its dip.
    if (v.y < 0 && position.y <= target + 0.05) { state.hoverAir = false; ports.landed(-v.y); if (startBob <= 0.05) v.y = groundedVelocity(v.y); }
  } else {
    const a = Math.max(-HOVER_SPRING_MAX, Math.min(HOVER_SPRING_MAX, HOVER_SPRING_K * err)) - HOVER_SPRING_C * v.y;
    v.y += a * dt;
    if (impulse.y === 0) position.y += v.y * dt;
    else { want.x = 0; want.y = (v.y + impulse.y) * dt; want.z = 0; ports.move(position, want); }
  }
  if (position.y < g) { position.y = g; if (v.y < 0) v.y = 0; } // steep slope / bump: the board never goes under
  state.hoverBob = position.y - target;
  state.onGround = !state.hoverAir && Math.abs(state.hoverBob) < 0.3; // "grounded" = riding near the ride height (jump allowed)
  out.water = ws;
}

/** An upward shove (an updraft's lift, a wisp's burst) puts a riding board in the air, as the client Player's `impulse`. */
export function boardShoved(state: BoardState, vy: number): void {
  if (vy > 0) { state.onGround = false; state.hoverAir = true; }
}
