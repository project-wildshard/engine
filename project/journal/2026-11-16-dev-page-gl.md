# 2026-11-16: the dev page's GL warnings (SHARD-SOURCE SS-NE16)

> Written by: Claude (opus-ss16n)

- A plain scene shard on `wildshard dev` logged dozens of `GL_INVALID_OPERATION: Mismatch between texture format and
  sampler type` lines while it loaded. A probe that read the bound textures at each failing draw found
  `directionalShadowMap[2]` bound to an RGBA texture: a cascade held on the every-other cadence (shadow `autoUpdate`
  off, not due) had no map yet, so three bound its never-uploaded `DepthTexture` stand-in, which falls back to the RGBA
  empty texture. `allocateShadowMaps` skipped it because `shadowCasters` lists only the maps due this draw.
- `shadowCasters(cam, false)` now lists every casting light a lit program samples; the boot allocates them all. On the
  keeper scene the failing draws went from 48 to 0, and the page logs no WebGL line in 15 s.
- `Game.clock` is a small `FrameClock` (start, getDelta, elapsedTime) instead of three's deprecated `Clock`, which
  warned on every page load.
