/** The held string's existing explicit spring, bounded to its 60 Hz step.
 * A normal frame preserves the original arithmetic and operation order. */
export interface LauncherSpringState {draw: number; velocity: number}
export function advanceLauncherSpring(state: LauncherSpringState, target: number, stiffness: number, damping: number, dt: number): void {
  if (!Number.isFinite(dt) || dt < 0) throw new Error('Invalid launcher spring delta');
  const steps = Math.max(1, Math.ceil(dt * 60)), h = dt / steps;
  for (let step = 0; step < steps; step++) {
    state.velocity += (-(state.draw - target) * stiffness - state.velocity * damping) * h;
    state.draw += state.velocity * h;
  }
}
