# 2026-11-27 A zone's own sfx set joins the tables from its parts (SF11)

The build's sfx tables were compiled from `public/`, so with SF11 a zone's own set (`/assets/<slug>/sfx/<set>/sfx.json`)
left them, and the open plots' scenes refused at level.play: "Scene cue bank requires its credit". The set now joins the
tables from the zone's verified parts, as its score does (SF23); the parts copy wins, so a cold-cooked head plays its own.
`download-audio-list` now models the cook's `withShardMounts` instead of `public/`. Guard: `test/cooked-zone-sfx.test.ts`.
