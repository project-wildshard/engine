/** The page's combat/headbob motion factor. Callers supply horizontal velocity magnitude and live movement state;
 * corrected displacement and transient impulse are not this velocity. Inputs are already validated by their owner. */
export function combatSpeedFactor(horizontalSpeed: number, grounded: boolean, swimming: boolean, hover: boolean, referenceSpeed: number): number {
  return (grounded || swimming) && !hover ? horizontalSpeed / referenceSpeed : 0;
}
