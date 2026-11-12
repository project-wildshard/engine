# Nalati revision 2: the page's forest trunks on the server (opus-ss10b)

- Meta SERVER-PARITY SS10b, trunks item. Room players walked through
  Nalati's spruces: the bake's trunk capsules were a frozen capture of
  155 trees and the page now plants 146, mostly at other heights, so 113
  page trunks had no server trunk. shard-nalati `71c6825` re-captures the
  capsules from the page's own forest (`scripts/forest-trunks.mjs`).
- Built from `71c6825`, prepared in phone WebKit (sharddev v0.2.2's
  recorder: the pinned one stops at the Name prompt) on a
  `WILDSHARD_PREPARATION_ONLY` preview of `ffb19e77` (renderer
  `86cb061f`, fence 388, 100 programs), uploaded as version 0.0.1,
  revision 2 (`77b77fcc`, 144,178,176 bytes) and flipped on preview,
  staging and production. The way back is a flip to `7d23cad0`.
- Pinned here with its save pin and the recut Ring 1 slice (`6c70f128`);
  both tarballs are on the `pins` release. Locally: Ring 1 cook green,
  step green with Nalati's chain re-recorded (darwin and linux carry the
  same chain, as every row does), side-parity green with Nalati's forest
  line gone and its untagged counts moved (35 / 526), released-save-play
  green, and the Nalati room, bot, population and headless physics tests
  pass.
- Left in SS10b: the bake's solids still carry no owner or material, and
  the population habitat's `trees`/`tops` stay the 155-row capture
  (format G1004 pins that file at exactly 155).
