# MMO failure screens (A13)

Lane opus-failmodes. Jake wants every way the MMO link can fail to show
the player a screen, never a silent break, and asked for prototypes of
them all first (meta `docs/plans/MMO-FAILURE-MODES-PLAN.md`, FM1).

- `src/client/app/failScreens.ts` holds 36 prototype screens, one per
  catalogue failure: pages, cards, strips, chips, a loading-card line
  and a voice tip, in the error modal's glass and the doctor's page.
- Settings ▸ Developer ▸ Failure screens ▸ Open sends `ws:failscreen`;
  the entry answers only on a Developer page and only then imports the
  module, so players neither download nor see it. The brief offered a
  `?failmode=` query, but `lint/url-params.json` refuses new URL
  switches without Jake's OK, so the Developer row is the switch.
- Nothing is wired to a real failure; `redial.ts` and the online shell
  are untouched. Wiring is the plan's FM4 to FM8.
- Shots at 402×874 and 1440×900, Chromium and WebKit, on a local
  serve-build; the page is `~/.cache/wildshard/failmodes-ui/`.

## J206 review fixes

Codex one-shot review (NO-GO) on 4db7599: the worker precached the
prototype chunk, so players downloaded it; Developer off didn't close
a screen. Now `serviceWorker.ts` leaves `-failScreens-` chunks out of
the precache (a test pins it), the entry checks Developer again after
the import, `ws-dev` off closes the screen, and modals get a name and
focus. Renderer stamp regenerated.

## FM1b: Jake's review (lane opus-failmodes2)

Jake asked three things of the prototypes: what happens when you
tap Play under a banner ("every banner screen needs a sibling/sister
screen"), the 3 to 5 new UI styles up front, and shots in the game on
Driftwood Isle rather than over the title.

- Nine hold cards, `<id>-blocked`, each drawn over its own banner or
  notice: what was tapped, live progress (try N, next dial in N s,
  the J114 hold draining), and what happens by itself. Chat is held
  and sent on return; a game tap is never sent late.
- Prototypes for the review's failures 37 to 46 (release 404, captive
  portal, bad signature, refused, banned, storage full, staging).
- Five styles: page, card, hold card, banner, notice. The voice tip
  now wears the notice's glass, and the banner is a tab in the top
  band: the old full-width line covered the pause button and the
  minimap on Driftwood Isle.
- `test/fail-screens-catalogue.test.ts` pins the pairs and the ids.
- Shots: a local serve-build with `?chunk=driftwood-isle`, headless
  Chromium on Metal (`--use-angle=metal`), world ready in 5 to 8 s.
