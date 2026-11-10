# Developer pixel switches (A15, QA row 25)

Jake's iPhone in Low Power Mode drops Driftwood to 19-23 fps (p50
34-42 ms) on ~7 ms of CPU a frame: GPU / fill bound, at "phone · 2.00×"
on a 3× screen. He asked for 2× / 1× pixel density and 3× / 2× / 1×
screen in Developer mode, six permutations to try.

- `render/devPixels.ts`: screen = the device-pixel-ratio cap, density =
  the render scale on top (2× = 1, 1× = ¾). A ½ scale would make two of
  the six the same buffer (2× screen at 1× = 1× screen at 2×); ¾ gives
  3, 2.25, 2, 1.5, 1 and 0.75 on a 3× phone: six buffers, from 3.16 MP
  down to 0.20 MP at 402×874. Saved on the device; Developer off
  ignores it, so production is unchanged.
- Game applies it at the renderer's birth and live on the change event
  (setPixelRatio + fitSize), or when Developer mode flips.
- A card under SETTINGS on the shard-select screen (Jake: a temporary
  home is fine) with the two segmented switches and the buffer the
  pick gives this screen. The frame meter's TIER · DPR row now reads
  "phone · 1.50× · 603×1311 · 0.79 MP · dev 2×/1×".
- Second J206 review (Codex, NO-GO): the live pick now waits for the frame
  that draws (RT3), and holds against the software pacing; epochs carry
  devPixels; the desktop dock sits under the bolts readout and its alert
  sections at the left (the boss bar and the ammo readout had them);
  hud-worst fails refused requests and late page errors and requires the
  fps pill and the memory card each.
- Third review (verify): GO on the pick and pacing; the gated case now
  reads errors after its screenshot, and the desktop memory panel rises
  above the bolts and health readouts at any width.
