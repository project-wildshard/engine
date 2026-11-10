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
