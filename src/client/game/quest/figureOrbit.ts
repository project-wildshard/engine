/** A quest figure's walk round its ring (Nalati's child Ayan), as numbers only: no scene, renderer or prompt. The page's
 *  figure group (figures.ts) moves its feet and moving piece by it, and the Node simulation (CI12's Nalati tape) drives
 *  the same step without a renderer. */

/** The admitted orbit row (format/figures.ts `motion.orbit`): the ring's centre and radius (m), its angular speed
 *  (rad/s), the player distance (m) inside which the figure stops, and its step bob (`frequency` on the figure's phase,
 *  `lift` m). */
export interface FigureOrbitRow {
  readonly x: number; readonly z: number; readonly radius: number; readonly speed: number;
  readonly stopDistance: number; readonly frequency: number; readonly lift: number;
}
/** The figure's orbit state: its walk clock (`phase`, advanced by its owner every frame), its angle round the ring and
 *  the facing it rests at; a talking figure stops. */
export interface FigureOrbitState { readonly phase: number; ring: number; idleYaw: number; readonly talking: boolean }
export interface FigureFeet { x: number; y: number; z: number }

/** One step of `dt` s with the player `distance` m from the feet: at or beyond the orbit's stop distance and not talking,
 *  the figure walks on round the ring (its feet on the ring at the floor plus the step bob, facing along the ring); else
 *  its feet settle onto the floor. Returns whether it walked (a moving piece follows the feet). */
export function stepFigureOrbit(orbit: FigureOrbitRow, state: FigureOrbitState, feet: FigureFeet, dt: number, distance: number,
  floorAt: (x: number, z: number) => number): boolean {
  if (distance >= orbit.stopDistance && !state.talking) {
    state.ring += dt * orbit.speed;
    const x = orbit.x + Math.cos(state.ring) * orbit.radius, z = orbit.z + Math.sin(state.ring) * orbit.radius;
    const y = floorAt(x, z) + Math.abs(Math.sin(state.phase * orbit.frequency)) * orbit.lift;
    feet.x = x; feet.y = y; feet.z = z;
    state.idleYaw = Math.atan2(-Math.sin(state.ring), Math.cos(state.ring));
    return true;
  }
  feet.y += (floorAt(feet.x, feet.z) - feet.y) * (1 - Math.exp(-10 * dt));
  return false;
}
