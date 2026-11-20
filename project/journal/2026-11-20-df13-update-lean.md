# DF13: Driftwood's steady update, named and leaned (mini-df13)

- The grid's late system now laps its parts into the dev fps meter (view cover, rings, shimmer and gate, near views, life,
  bands, frame weights, ring tiles). A 3x Chromium dock census leaves 0.02 ms of the update unnamed.
- Five update cuts behind device slots in `core/updateLean.ts`, all off by default: off-screen animal poses at the far
  cadence, off-screen kit figure poses likewise, near-view ranking only on a 1 m eye move or a state change, first hints'
  layout reads once a second, the minimap at 15 Hz. Together about 0.25 ms of steady update a frame at 3x; the dock's
  update p50 stays near 3.7 to 3.9 ms, inside the boot-to-boot spread and over DF13's 3.0 ms line.
- What is left is fixed-step work (player.step 0.5, physics.step 0.3 at two steps a frame), the network presentation
  (0.27), the held weapon's arms and the animals' roots.
