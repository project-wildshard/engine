/** Linear aim-in/out blend, shared by sights with their own authored blend duration. */
export function ads(value: number, aimed: boolean, dt: number, duration: number): number {
  const step = dt / duration, delta = (aimed ? 1 : 0) - value;
  return Math.max(0, Math.min(1, value + Math.max(-step, Math.min(step, delta))));
}
