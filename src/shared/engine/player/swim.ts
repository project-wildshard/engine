/**
 * The water law (SHARD-PLATFORM SF34): wading and swimming, the motor's two water modes, shared by the client Player and
 * the headless SimHost (`SimHost.useWater`) as the hoverboard's law is (player/board.ts). On foot the feet wade while water
 * stands over them (slower, no sprint past the knee, a softer landing); past SWIM_IN of water over the ground the walk hands
 * over to the swim, where buoyancy (not gravity) eases the feet to the float height, DIVE and SURFACE drive the depth,
 * a deck within reach is climbed onto and the bottom rising under SWIM_OUT stands the swimmer up again.
 */

/** A world point or velocity (m, m/s): three's Vector3, or the client Player's plain `want`. */
interface Vec3 { x: number; y: number; z: number }

/** m of water over the ground: shallower = wade on foot, deeper = swim (hysteresis below). */
export const WADE_MAX = 1.1;
/** Ground depth at which walking becomes swimming … */
export const SWIM_IN: number = WADE_MAX + 0.1;
/** … and swimming becomes wading again (the seabed / a beach rising under you). */
export const SWIM_OUT: number = WADE_MAX - 0.05;
/** Knee-deep and up: no sprint. */
export const NO_SPRINT_DEPTH = 0.6;
/** The feet float this far under the surface: the eye (1.68 m) sits 0.35 m above it. */
export const FLOAT_DEPTH: number = 1.68 - 0.35;
/** m/s, 60 % of walking (Hands.ts paces the stroke against it). */
export const SWIM_SPEED: number = 4.3 * 0.6;
/** /s: sluggish in water. */
const SWIM_ACCEL = 5;
/** The spring to the float height (ω ≈ 3.7 rad/s) … */
const BUOY_K = 14;
/** … under-damped (ζ ≈ 0.47): a plunge off a pier dips the head under and pops back up. */
const BUOY_C = 3.5;
/** m a platform top may sit above the surface and still be climbed onto from the water. */
const CLIMB_REACH = 1.3;
/** The stiffer pull when hauling out onto a deck. */
const CLIMB_K = 30; const CLIMB_C = 10;
/** m ahead of the feet where a platform is looked for while swimming toward it. */
const CLIMB_PROBE = 0.7;
/** s between strokes at full swim speed (Hands.ts runs one arm cycle per stroke). */
export const STROKE_PERIOD = 0.85;
/** m/s descent while DIVE is held … */
const DIVE_SPEED = 1.6;
/** … and ascent while SURFACE is held. */
const SURFACE_SPEED = 2.0;
/** /s: a short ease-in / ease-out on the vertical speed (a heavy, watery start). */
const DIVE_EASE = 5;
/** m below the float height at which the dive latches (neutral buoyancy from here down). */
const DIVE_ENTER = 0.35;
/** Horizontal swim speed underwater, as a fraction of the surface swim. */
const DIVE_SWIM = 0.85;

/** The swimmer's state the law reads and writes (the client Player's own fields, the SimHost's playerSwim). */
export interface SwimState {
  /** the dive latched: neutral buoyancy holds the depth until SURFACE brings the swimmer back up */
  diving: boolean;
  /** the deck top a haul-out pulls the feet to, or null */
  climbTo: number | null;
  /** s before a haul-out may latch again (after one pinned against a piling) */
  climbCooldown: number;
  /** the stroke cycle's phase (one stroke per 1) */
  strokeTime: number;
}
/** One step's resolved stick (world-space move, length ≤ 1, `len` its length) and the held DIVE / SURFACE controls. */
export interface SwimMove { mx: number; mz: number; len: number; dive: boolean; surface: boolean }
/** What the swimmer's host supplies. */
export interface SwimPorts {
  /** the swimmer's motor, sliding (CharacterMotor.move(feet, want, true): pilings, walls and hulls stay solid) */
  move: (feet: Vec3, want: Vec3) => { readonly horizontalFreedom: number };
  /** the rest water surface at (x, z), or null off the water */
  water: (x: number, z: number) => number | null;
  /** the highest floor under the feet: terrain, a platform, a collider floor */
  ground: () => number;
  /** the floor functions a haul-out may climb onto (a platform top at (x, z), or undefined) */
  platforms: readonly ((x: number, z: number) => number | undefined)[];
  /** the first collider floor below (x, fromY, z) within `maxDrop`, the swimmer's own capsule excluded */
  floor: (x: number, z: number, fromY: number, maxDrop: number) => number | undefined;
  /** the surface's swell at (x, z) over its rest level (the sea's waves, a pond's gentle bob) */
  bob: (x: number, z: number) => number;
  /** the swimmer leaves the water (drifted off it, or stood up on the rising bottom) */
  leave: () => void;
}

/** The wade fraction on foot: how deep the water over the feet is against WADE_MAX (0 dry or in the air). */
export function wadeFraction(onGround: boolean, depth: number): number { return onGround ? Math.min(1, depth / WADE_MAX) : 0; }
/** After an on-foot move: deep enough to float (the feet under the surface and more than SWIM_IN of water over the ground). */
export function swimEntry(feetY: number, water: number | null, ground: number): boolean { return water !== null && feetY < water && water - ground > SWIM_IN; }
/** The fraction of the fall speed a plunge keeps into the swim: a hard one dips the head under for a beat. */
export function entryKeep(vy: number): number { return vy < -6 ? 0.45 : 0.3; }
/** The pond's own bob when the water has no swell of its own (seconds on the swimmer's wave clock). */
export function pondBob(waveTime: number): number { return Math.sin(waveTime * 1.4) * 0.05 + Math.sin(waveTime * 2.3 + 1.0) * 0.02; }

/**
 * One swim step: drift, the motor, the haul-out probe, then the float spring or the driven dive. 'dry': it drifted off
 * the water; 'stood': the bottom rose under SWIM_OUT and the feet stand on it; 'swim': still floating. `leave` runs on the
 * first two before anything after it reads the state. Returns the water surface (null when dry) in `out`.
 */
export function stepSwim(p: Vec3, v: Vec3, want: Vec3, state: SwimState, move: SwimMove, ports: SwimPorts, dt: number, out: { water: number | null }): 'dry' | 'stood' | 'swim' {
  const { mx, mz, len } = move;
  const swimSpeed = SWIM_SPEED * (state.diving ? DIVE_SWIM : 1); // a touch slower under the surface
  v.x += (mx * swimSpeed - v.x) * Math.min(1, SWIM_ACCEL * dt);
  v.z += (mz * swimSpeed - v.z) * Math.min(1, SWIM_ACCEL * dt);
  want.x = v.x * dt; want.y = 0; want.z = v.z * dt;
  const r = ports.move(p, want);
  // pinned against a piling / bollard while hauling out: let go of the climb (and don't grab again for a beat) so we
  // sink back to the float height instead of hanging in the air beside the deck
  const blocked = r.horizontalFreedom < 0.25;
  if (state.climbTo !== null && blocked) { state.climbTo = null; state.climbCooldown = 0.6; }
  state.climbCooldown = Math.max(0, state.climbCooldown - dt);
  const ws = ports.water(p.x, p.z);
  const g = ports.ground();
  out.water = ws;
  if (ws === null) { ports.leave(); return 'dry'; } // drifted off the water (the pond's mask edge): back on foot
  const groundDepth = ws - g;
  // climbing out: moving toward a platform (the pier deck) whose top is within reach above the surface — and we are
  // not already under it — latches a pull-up to its level; the ground port then accepts it and we stand up on the deck
  if (len > 0.3) {
    const px = p.x + mx * CLIMB_PROBE, pz = p.z + mz * CLIMB_PROBE;
    let here = false, ahead: number | undefined;
    for (const pl of ports.platforms) {
      if (pl(p.x, p.z) !== undefined) here = true;
      const y = pl(px, pz);
      if (y !== undefined && y > ws - 0.3 && y - ws < CLIMB_REACH && (ahead === undefined || y < ahead)) ahead = y;
    }
    // decks as colliders (P4): a surface within reach over the water here / just ahead
    const top = ws + CLIMB_REACH + 0.2;
    const overHere = ports.floor(p.x, p.z, top, CLIMB_REACH + 0.5);
    if (overHere !== undefined && overHere > ws - 0.3) here = true;
    const y = ports.floor(px, pz, top, CLIMB_REACH + 0.5);
    if (y !== undefined && y > ws - 0.3 && y - ws < CLIMB_REACH && (ahead === undefined || y < ahead)) ahead = y;
    if (ahead !== undefined && state.climbCooldown === 0 && (!here || state.climbTo !== null)) state.climbTo = ahead;
    else if (state.climbTo !== null && ahead === undefined && !here) state.climbTo = null;
  } else state.climbTo = null;
  if (groundDepth < SWIM_OUT) {
    // the bottom rose under us (beach / seabed / a deck we climbed onto): stand up and wade out
    ports.leave();
    p.y = Math.max(p.y, g); v.y = 0;
    return 'stood';
  }
  const climbTo = state.climbTo;
  const floatY = ws - FLOAT_DEPTH + ports.bob(p.x, p.z);
  if (climbTo !== null) state.diving = false;
  if (climbTo === null && (state.diving || move.dive)) {
    // diving: the vertical speed is driven, not sprung — DIVE eases you down, SURFACE eases you up, neither holds the
    // depth (neutral buoyancy: no bobbing back up). The seabed / a collider still stops you.
    const wantV = move.dive && !move.surface ? -DIVE_SPEED : move.surface ? SURFACE_SPEED : 0;
    v.y += (wantV - v.y) * Math.min(1, DIVE_EASE * dt);
    p.y += v.y * dt;
    if (p.y < g) { p.y = g; if (v.y < 0) v.y = 0; }
    if (p.y < floatY - DIVE_ENTER) state.diving = true;
    if (p.y >= floatY) {
      // broke the surface (SURFACE held to the top, or DIVE released before the latch): the float takes it from here
      state.diving = false; p.y = floatY; v.y = Math.max(0, v.y) * 0.6;
    }
  } else {
    const target = climbTo !== null ? climbTo + 0.02 : floatY;
    const kk = climbTo !== null ? CLIMB_K : BUOY_K, cc = climbTo !== null ? CLIMB_C : BUOY_C;
    v.y += (kk * (target - p.y) - cc * v.y) * dt;
    p.y += v.y * dt;
    if (p.y < g) { p.y = g; if (v.y < 0) v.y = 0; }
  }
  return 'swim';
}

/** The stroke clock: one stroke per STROKE_PERIOD at full speed, scaled by how fast the swimmer actually moves. */
export function swimStroke(state: SwimState, v: Vec3, dt: number, stroke: () => void): void {
  const hs = Math.hypot(v.x, v.z);
  if (hs > 0.4) {
    state.strokeTime += dt * (hs / SWIM_SPEED) / STROKE_PERIOD;
    if (state.strokeTime >= 1) { state.strokeTime -= 1; stroke(); }
  } else state.strokeTime = Math.min(state.strokeTime, 0.6);
}

/**
 * Deep water at (x, z), where a dash ends on the spot (off a pier edge): more than WADE_MAX of water over the ground and no
 * deck over it, neither a floor function nor a collider floor (from over the surface, or the feet's own height however
 * high: the practice arena stands 900 m over Driftwood's sea, E285).
 */
export function deepWater(x: number, z: number, feetY: number, water: number | null, ground: number,
  platforms: readonly ((x: number, z: number) => number | undefined)[], floor: (x: number, z: number, fromY: number, maxDrop: number) => number | undefined): boolean {
  if (water === null || water - ground <= WADE_MAX) return false;
  for (const p of platforms) { const y = p(x, z); if (y !== undefined && y > water - 0.5) return false; }
  const top = Math.max(water + 3, feetY + 0.5);
  const deck = floor(x, z, top, top - water + 0.5);
  return deck === undefined || deck <= water - 0.5;
}
