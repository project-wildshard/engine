# Keep browser actor markers out of CORS headers

> Written by: Codex
> State: J249 fix, 2026-11-19

The global custom header caused the staging proof's pack and API fetches
to preflight. Packs answered OPTIONS with 403. The browser wrapper now
uses the existing user-agent marker. A supplied device UA carries it on
the wire. Default contexts keep the browser's network UA and expose the
suffix to the page, which already forwards its actor to the room.

A phone-sized WebKit proof played Driftwood on staging v0.1.53 at
`b889e7396`. Playwright captured successful GETs to both
`packs.wildshard.io` and `api.wildshard.io` with no custom marker.
The loopback regression rejects OPTIONS and checks both browser modes.
Engine metrics, telemetry and browser tooling tests pass.
