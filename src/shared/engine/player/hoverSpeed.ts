/** Base cruise is 14 m/s standalone or a grid cap ≤ 30. Developer boost is 4× everywhere: 56 in a shard, 120 on the road (J-road-4x). */
export function hoverSpeed(limit?: number, boost = false): number {
  const base = limit ?? 14;
  if (!Number.isFinite(base) || base <= 0 || base > 30) throw new RangeError('Invalid hover speed cap');
  // Jake 11-15 12:10: "Road push should be a 4x as well. So this should go to 120". 4× of the cap stays smooth over the strip.
  return boost ? base * 4 : base;
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
