# Scene sway (meta SHARD-SOURCE SS8), opus-ss16l

- SS8a: a scene shard page with detail layers but no `wind` row, forest or
  painterly grass never advanced `uWindTime`, so the meadow's sway was frozen.
  `windClockFallback()` (wind.ts) counts `updateWind` calls and advances the
  clock only when nothing else did since its last frame: no double tick, and a
  driver that starts later takes over the next frame.
