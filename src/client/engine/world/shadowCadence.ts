/**
 * BA-3 (MF7 battery; G899, the staggered cadence won its A / B: Driftwood phone 203 -> 180 draw calls a frame, shadow maps
 * -30 %, no visible swim on a turning clip): which of the phone rig's cascades redraw on drawn frame `tick` (skyRig.ts).
 * The near one every frame (the player's own shadow), the middle every 2nd, the far every 4th, never both in one frame:
 * 1.75 maps a frame, from E189's 2.5. A skipped cascade keeps its map AND the matrix it was drawn with, so static shadows
 * stay exactly where they were; only a moving caster beyond 7 m steps (15 / 7.5 Hz at the phone's 30).
 */
export function cascadeRedraws(tick: number, count: number): boolean[] {
  const redraw = Array.from({ length: count }, () => true);
  if (count < 2) return redraw;
  redraw[count - 1] = tick % 4 === 0;
  if (count >= 3) redraw[count - 2] = tick % 2 === 1;
  return redraw;
}

/**
 * DRIFTWOOD-FPS DF14 (mini-dwfps, 2026-11-23; device slot `debug.shadowOneMap`, desktop High): one cascade a drawn frame.
 * The near one every 2nd frame (60 Hz at desktop's 120), the middle and the far every 4th, on the odd ticks between:
 * 1 map a frame, from the staggered rule's 1.75, and never two in one frame (desktop High's p95 frames drew two). A
 * skipped cascade keeps its map and matrix as above, so static shadows stay where they were; only a moving caster's
 * shadow steps, at 60 Hz near the camera.
 */
export function cascadeRedrawsOneMap(tick: number, count: number): boolean[] {
  if (count < 3) return cascadeRedraws(tick, count);
  const redraw = Array.from({ length: count }, () => false);
  redraw[0] = tick % 2 === 0;
  redraw[count - 2] = tick % 4 === 1;
  redraw[count - 1] = tick % 4 === 3;
  return redraw;
}
