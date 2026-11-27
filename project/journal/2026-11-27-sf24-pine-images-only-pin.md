# SF24: Pine pins its images-only upload 19

Pine Hollow publishes as upload 19 (0.0.18) on staging, from the preparation
server-staging-e84dfc8411 that carries the splat-image fix (194dfe150). The
pin files and both Ring 1 digest rows come from shard-pin 46046462890's
branch (`plan/pin-pine-hollow-r19`); Pine's server step changed, so its
digests moved.

Pine now plays its own music set and carries its own bark and ground sets,
so 82 tracked engine copies lost their owner (public-verdicts):

- the two Pine piano tracks go on `public-engine.json`, as the SF10 to SF12
  batch lists them;
- 80 texture files under `public/assets/tex/` (the bark, ground, door,
  stone and plank sets) leave engine git, as the batch's 0004 patch does.
  No pinned product reads an engine-wide tree set any more (Pine's is its
  own, `/assets/pine-hollow/models/...`), so `BARK_LAYERS`' engine paths
  have no reader.

`engine-music-names` now expects Pine to name only the engine title, and
the unversioned-pin test expects none.

Proof: Pine cold-cooked and passed all five phases in headless Chromium
(cook 560 s, boot 11.5 s with 71 gameplay frames, Explorer 65 real
thumbnails), with no ambiguous built index address. A full `build:game`
passes with the textures gone; 216 pin-reading test files pass locally
except two audio tests that need fetched sfx this checkout lacks (green
on main CI).
