/** Base cruise is 14 m/s standalone or a grid cap ≤ 30. Developer boost gives 4× interiors and 2× roads, easing over strips. */
export function hoverSpeed(limit?: number, boost = false): number {
  const base = limit ?? 14;
  if (!Number.isFinite(base) || base <= 0 || base > 30) throw new RangeError('Invalid hover speed cap');
  // Keep the strip smooth between 4× interior (56) and 2× road (60).
  return boost ? base <= 14 ? base * 4 : 56 + (base - 14) / 4 : base;
}

/** m/s² the board loses gliding with no input, at or below the 14 m/s standalone cruise (25 % of its acceleration). */
export const HOVER_COAST = 3;
/** /s of extra coast drag per m/s above the standalone cruise: a released 30 m/s highway board stops in ~70 m, not 150. */
export const HOVER_COAST_DRAG = 1;

/**
 * Coast deceleration (m/s²) of a released board at `speed` m/s. At or below 14 m/s it is the old constant 3 m/s², so a
 * shard's board glides exactly as before; above it, drag grows with the excess (19 m/s² at 30 m/s), so the fast highway
 * cruise bleeds off quickly into the familiar 14 m/s glide instead of coasting 150 m.
 */
export function hoverCoastDecel(speed: number): number {
  if (!Number.isFinite(speed) || speed < 0) throw new RangeError('Invalid hover speed');
  return HOVER_COAST + HOVER_COAST_DRAG * Math.max(0, speed - hoverSpeed());
}
