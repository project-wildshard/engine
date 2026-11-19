# 2026-11-19: the Nalati pocket test reads its physics bake by name

Lane: buddy-engine (keeper; MAIN RED 315b8a1111..fcfaf64698, run 44512490653, tests (1)).

`net-predict-pocket.test.ts` (NL14b1) read Nalati's physics bake at a hard-coded
`server/json/<hash>.json`. codex-ci21's fcfaf6469 pinned Nalati revision 3, whose bake has
another hash, so the file was missing and the suite failed to load. The test now takes the
bake's path from the admitted server set, `admission.server` row `server/physics.json`.

On revision 3 the pocket is still there: four seconds of sprint north move the feet 6 mm
(pressed in), and the climb north-east then takes them about 6 m. The test passes, and is
not vacuous. (The same run's "Not pinned: template" is the static declared-journeys red,
TR-8a's, routed to opus-tr8b.)
