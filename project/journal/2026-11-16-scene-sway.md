# Scene sway (meta SHARD-SOURCE SS8), opus-ss16l

- SS8a: a scene shard page with detail layers but no `wind` row, forest or
  painterly grass never advanced `uWindTime`, so the meadow's sway was frozen.
  `windClockFallback()` (wind.ts) counts `updateWind` calls and advances the
  clock only when nothing else did since its last frame: no double tick, and a
  driver that starts later takes over the next frame.
- SS8c (opus-ss16l, committed by opus-ss16m): `world/swings.ts` makes each `look.light.swings` row a damped pendulum that
  leans downwind with the gust and is kicked by a body brushing its bob; swinging surfaces, glass and glow cards turn
  round the pivot in the vertex shader from `_SWING`, and a lamp on a swing carries its light. Its pbr test needs the
  format pin on 0.10 or later.
