/**
 * The puzzle barrel's law (PHYSICS P7-L1), renderer-free: its dynamic body and the never-jam rule (`BarrelWatch`), one
 * law for the page's interactables kit (world/interact/Interactables.ts) and a headless runtime's barrel (SF72).
 */
import type { BodySpec } from '../../physics/bodies';
import type { Physics } from '../../physics/Physics';
import type { GroupName } from '../../physics/groups';
import { overlapBox } from '../../physics/overlap';

interface V3 { x: number; y: number; z: number }

const PLATE_SEES: readonly GroupName[] = ['PLAYER', 'ITEM'];
const anyOwner = (): boolean => true;
/** Contact slab shared by drawn and native pressure plates; callers retain owner filtering and query dimensions. */
export function plateOverlap(physics: Physics, position: V3, yaw: number, size: number,
  policy: { readonly inset?: number; readonly depth?: number; readonly sees?: readonly GroupName[]; readonly accepts?: (owner: unknown) => boolean } = {}): boolean {
  const depth = policy.depth ?? 0.1, half = Math.max(0.05, size / 2 - (policy.inset ?? 0.1));
  return overlapBox(physics, { x: position.x, y: position.y + depth / 2, z: position.z }, { x: half, y: depth, z: half },
    yaw, policy.sees ?? PLATE_SEES, policy.accepts ?? anyOwner);
}

/** The barrel's radius and half height (m). */
export const BARREL_R = 0.38, BARREL_HALF = 0.475;
/** the player capsule's radius the push window reads */
const PLAYER_R = 0.35;
/**
 * The puzzle barrel's body (PHYSICS P7-L1): a free cylinder, ~110 kg, never culled. It starts upright; the player's 80 kg
 * capsule walking into it tips it (grippy wood on sand: it tips before it slides), and on its side it rolls — across
 * the push, or down a slope steeper than ~3.5° (its rolling resistance, packed sand's); along its length it is shoved.
 */
export const BARREL_BODY: { readonly shape: { readonly cylinder: { readonly radius: 0.38; readonly halfHeight: 0.475; }; }; readonly material: "wood"; readonly density: 250; readonly friction: 1; readonly angularDamping: 0.2; readonly rolling: 0.06; readonly keep: true; } = {
  shape: { cylinder: { radius: BARREL_R, halfHeight: BARREL_HALF } }, material: 'wood', density: 250, friction: 1.0,
  angularDamping: 0.2, rolling: 0.06, keep: true,
} as const satisfies Omit<BodySpec, 'owner'>;

/** A BarrelWatch's continuation (BarrelWatch.state). */
export type BarrelWatchState = ReturnType<BarrelWatch['state']>;

export interface BarrelEnv {
  /** feet and the velocity the player is asking for (Player.velocity: what the input wants, even against a wall) */
  player: { position: V3; velocity: V3 };
  /** walkable floor height at (x, z): the highest platform, else the ground (the sea floor offshore) */
  floorAt: (x: number, z: number) => number;
  /** the still water level (the sea; a pond) */
  water: () => number;
  /** is (the barrel's centre) on or at a plate? — it is never sent home from there */
  onPlate: (c: V3) => boolean;
}

/** lost: offshore (the ground under it this far under the water line), or this far under the floor (through the world) */
export const BARREL_SEA_DEPTH = 0.3, BARREL_UNDER = 1.5;
/** …for this long (s) */
export const BARREL_LOST_T = 4;
/** wedged: the player walks into it (within PUSH_R of its centre, asking ≥ PUSH_SPEED m/s at it) for this long (s) and
 *  it ends up less than WEDGE_MOVE m from where it was */
export const BARREL_WEDGE_T = 4;
const PUSH_R = BARREL_R + PLAYER_R + 0.4, PUSH_SPEED = 1, WEDGE_MOVE = 0.6, HOME_R = 1, PLATE_NEAR = 0.3;

/** Is a barrel centred at `c` on or at a plate of `size` at `plate` (it is never sent home from there)? */
export function barrelAtPlate(c: V3, plate: V3, size: number): boolean {
  return Math.hypot(c.x - plate.x, c.z - plate.z) < size / 2 + PLATE_NEAR && Math.abs(c.y - plate.y) < 1.2;
}

/**
 * When the puzzle barrel has to go home (PHYSICS P7-L1: it rolls now, so it can end up somewhere the puzzle can't use
 * it). `check` is called every frame with the body's centre and answers true when it must go, now:
 *   - past its leash (as before), at once;
 *   - lost — offshore, or under the world — for BARREL_LOST_T;
 *   - wedged — the player has been walking into it for BARREL_WEDGE_T and it got no further than WEDGE_MOVE (jammed in
 *     rocks, against a wall, on its end in a corner).
 * Never while it is at a plate (the puzzle is being solved) or at home (nothing to fix).
 */
export class BarrelWatch {
  lost = 0;
  wedge = 0;
  private readonly from = { x: 0, y: 0, z: 0 };

  readonly home: V3;
  readonly leash: number;
  constructor(home: V3, leash: number) {
    this.home = home;
    this.leash = leash;
  }

  check(c: V3, dt: number, env: BarrelEnv): boolean {
    const h = this.home, dx = c.x - h.x, dz = c.z - h.z, dy = c.y - BARREL_HALF - h.y;
    if (dx * dx + dy * dy + dz * dz > this.leash * this.leash) return true;
    if (dx * dx + dz * dz < HOME_R * HOME_R || env.onPlate(c)) { this.clear(); return false; }
    const floor = env.floorAt(c.x, c.z);
    this.lost = floor < env.water() - BARREL_SEA_DEPTH || c.y < floor - BARREL_UNDER ? this.lost + dt : 0;
    const p = env.player.position, v = env.player.velocity;
    const px = c.x - p.x, pz = c.z - p.z, pd = Math.hypot(px, pz);
    const into = pd < PUSH_R && pd > 1e-3 && Math.abs(c.y - p.y) < 1.5 && (v.x * px + v.z * pz) / pd > PUSH_SPEED;
    if (into) {
      if (this.wedge === 0) { this.from.x = c.x; this.from.y = c.y; this.from.z = c.z; }
      this.wedge += dt;
      if (this.wedge >= BARREL_WEDGE_T) {
        // a window of pushing: judged by where it got to, not by the jostling on the way (a pinned barrel rattles)
        if (Math.hypot(c.x - this.from.x, c.y - this.from.y, c.z - this.from.z) < WEDGE_MOVE) return true;
        this.wedge = 0;
      }
    } else this.wedge = Math.max(0, this.wedge - dt);
    return this.lost > BARREL_LOST_T;
  }

  clear(): void { this.lost = 0; this.wedge = 0; }

  /** Its clocks and the push window's start, as plain values (a headless continuation). */
  state(): { lost: number; wedge: number; from: { x: number; y: number; z: number } } { return { lost: this.lost, wedge: this.wedge, from: { ...this.from } }; }
  /** Exactly the saved clocks back. */
  restore(saved: BarrelWatchState): void {
    this.lost = saved.lost; this.wedge = saved.wedge; this.from.x = saved.from.x; this.from.y = saved.from.y; this.from.z = saved.from.z;
  }
}
