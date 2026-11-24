// @vitest-environment happy-dom
// meta QA-FEEDBACK-2026-11-24 row 31 (Jake: "Driftwood FPS is still dogshit"). QA 11-23-b row 8 moved Jake's iPhone 17 Pro from
// Low to High, and with it off every DRIFTWOOD-FPS cut keyed to phone Low, the pixel-neutral ones too: the DF8 program
// cuts (fewer programs, none linked after control) and the DF8/DW3 pacing cuts (the outer ring's start, the road handoff,
// the outer colliders, the warm body, the road card warm-up, the still-mesh coalesce). Nothing drawn changes with any of
// them, so they are on for every phone, at Low and at High. Cuts that change pixels (far LOD, cover, merges, 1x) stay Low's.
import { expect, test, vi } from 'vitest';

vi.mock('../src/client/engine/core/tier', async (original) => ({ ...(await original<typeof import('../src/client/engine/core/tier')>()), TIER: 'phone' }));

test('row 31: at phone High every pixel-neutral DRIFTWOOD-FPS cut is on', async () => {
  const { saveGraphicsMode, graphicsMode } = await import('../src/client/engine/core/graphicsMode');
  saveGraphicsMode('high');
  expect(graphicsMode()).toBe('high');
  const on = {
    programTwins: (await import('../src/client/engine/render/programTwins')).programTwinsOn(),
    programFold: (await import('../src/client/engine/render/programFold')).programFoldOn(),
    programReuse: (await import('../src/client/engine/render/programReuse')).programReuseOn(),
    bootRoadPrograms: (await import('../src/client/engine/render/precompile')).bootRoadPrograms(),
    outerStartPaced: (await import('../src/client/game/grid/outerPaced')).outerStartPacedOn(),
    roadHandoffPaced: (await import('../src/client/game/grid/roadHandoffPaced')).roadHandoffPacedOn(),
    outerCollidersNear: (await import('../src/client/game/grid/nearColliders')).outerCollidersNearOn(),
    warmPace: (await import('../src/client/engine/net/warmPace')).warmPaceOn(),
    warmSettle: (await import('../src/client/engine/net/warmPace')).warmSettleOn(),
    stillCoalesce: (await import('../src/client/engine/world/interact/restMerge')).coalescedStillBakesOn(),
  };
  expect(on).toEqual(Object.fromEntries(Object.keys(on).map(key => [key, true])));
  // a pixel-changing cut stays phone Low's
  expect((await import('../src/client/game/grid/kitBatch')).kitBatchOn()).toBe(false);
});
