/** the running dodge, for the viewmodel (Sword.ts) and the screen FX (SpeedLines.ts): `t` ms since it started (-1 = none),
 *  `side` −1 left … +1 right, `back` a backstep (no input) */
export const dodgeFx: { t: number; side: number; back: boolean; id: number } = { t: -1, side: 0, back: false, id: 0 };
/** the shared envelope (DODGE-FEEL "Shared timeline"): load 0–40 ms, burst to 120, hold to 250, then an underdamped spring
 *  (ζ ≈ 0.55, ω ≈ 13 rad/s) that overshoots ~12 % at ~390 ms and settles by ~500 */
export function dodgeEnv(ms: number): number {
  if (ms < 0) return 0;
  if (ms < 40) return 0.25 * (ms / 40) ** 2;
  // oxlint-disable-next-line prefer-exponentiation-operator -- `**` never reaches the portable Math (test/portable-math.test.ts).
  if (ms < 120) { const u = (ms - 40) / 80; return 0.25 + 0.75 * (1 - Math.pow(1 - u, 3)); }
  if (ms < 250) return 1 - 0.15 * ((ms - 120) / 130);
  const r = (ms - 250) / 1000;
  return 0.85 * Math.exp(-7.15 * r) * Math.cos(10.86 * r);
}
