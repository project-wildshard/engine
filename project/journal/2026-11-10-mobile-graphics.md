# Mobile Low / High graphics (meta MOBILE-GRAPHICS-PLAN, J235)

Jake, 2026-11-10 ~12:55 Cancun, after his Low Power runs: "we have two
things for mobile. We have mobile low graphics and mobile high
graphics", and "with low, you can just do… 1 time and 1 time".

- MG2: `render/graphicsMode.ts` holds a phone's Low / High, saved per
  device. Low draws at 1 drawing pixel per CSS pixel, High at today's
  phone cap (2x). It rides the A15 path: `drawingPixelRatio` (a
  Developer pick still wins), one `ws:pixels` event, Game's next drawn
  frame. Main menu > Settings > Graphics shows Low / High on a phone;
  the finer render scale is Developer-only there now. Desktop keeps
  everything as it was.
