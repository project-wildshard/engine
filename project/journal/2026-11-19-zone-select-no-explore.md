# Zone Select loses EXPLORE WORLD and SETTINGS

> Written by: Claude (opus-explore), 2026-11-19 ~14:30 Cancún

Jake, on staging v0.1.50 (~14:17): "In Zone Select, we can now hide the Explore button. The Explore button of Zone
Select is going to become a feature of ShotDev [sharddev]." A minute later: "We have a settings button on the home page.
We don't need the settings button here underneath enter zone." J460, and J463 after it (Explore becomes its own
single-player app). Meta QA-FEEDBACK-2026-11-19 rows 47 and 48.

The title deck is one implementation (Zone Select, the one-zone `/slug/` page and the in-world title), so both buttons go
from the deck itself, with their CSS and the `onExplore` / deck `onSettings` options. The home screen keeps its own
SETTINGS (J458), now an option of `buildTitleMenu` only.

Explore itself stays: `Explore.ts`, `openExplore`, `hud.onExplore` / `hud.startExplore`, `travel`'s explore mode and the
`?explore=` route. The three harness scripts that tapped the deck button (`playground-harness.mjs`,
`test-facade-instancing.mjs`, `webkit-mem-reading.mjs`) now call `__wildshard.world.hud.startExplore()`, the entry the
`?explore=` link already uses. Where Explore lives next is meta EXPLORE-MODE-PLAN, drafted for Jake's review.
