# Desktop 120: the bench draws at the tier's render scale (DRIFTWOOD-FPS DF14, mini-dwfps)

- The fps bench pinned desktop High to the screen's 2× through a Developer pixel pick (`devPixels`), but a desktop player
  draws at min(screen, 1.5) (`tiers.ts` desktop.dpr) and dynamic resolution only lowers that. At 1496×717 that was
  4.29 Mpx instead of 2.41 Mpx. `measure.mjs` now pins Settings ▸ Render scale 1.5 for desktop profiles and witnesses
  min(screen, 1.5); a test ties the constant to `tiers.ts`.
- Same page, ABBA ×8 at the dock, native High: ratio 2 → p95 13.35 ms, 144 fps; ratio 1.5 → p95 6.75 ms, 189 fps.
- Dropped on the way: AO restore suppression (n8ao pre-pass hide-and-show as no clip reveal). Pixel-identical, but the
  same-page ABBA measured off 13.45 / on 14.3 ms p95: no gain past the noise.

## phoneNormal calibrated at 2× (DF3)

- Two headless Chromium sweeps on main `aaeec2602` (phone Low, cap 30, rotating dock, throttle 1.5/2/2.5/3) against the
  iPhone 13 on the same SHA at normal power (update/render p50 3/4 ms) fit 2.2× and 1.8×, both inside ±15% and within
  0.5 of each other; together 2.0× (2.82/4.21 ms). `budgets/fps-calibration.json` records both sides, so `phone-low`
  runs at 2× and stops reading "CPU provisional". `phoneLpm` stays unqualified (J485).
