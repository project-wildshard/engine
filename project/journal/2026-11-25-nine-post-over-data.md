# Nine's declared post look lies over its data look (QA 11-24 row 59)

> Written by: Claude (opus-qa24), 2026-11-25

Nine Dragon Stack hung at entry once its declared post look ran. The page sat idle: `Game.buildSky` asked the
look for a backdrop, the post look alone had none, and `SkyRig.build` fell back to `visual.setupHDRI()`, which a data
page has no HDRI for (a 405), so the promise never settled.

`clientSource` now lays the post look over the data look (`withDeclaredPost`): the data look keeps the sky, light,
fog and ground; the post look adds its compose chain, frame and prepareWorld; dispose runs both. Local build
(chromium 402x874, spawn camera): before, RenderPass plus two EffectPasses, mean luma 60, 37.8% black; after, the
declared chain (reflect, haze, bleed, post-graph inputs, jiehua graph) runs, mean luma 94.6, 1.2% black, and Nine
enters in about 10 s.

Not done here: a grid data cell (`liveSession` via `dataCellWorld`) only hangs its data sky (`hangCellDataSky`);
it runs no declared post look in its cell.
