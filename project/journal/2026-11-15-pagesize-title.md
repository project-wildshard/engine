# PAGE-SIZE title follow-up

Preview `841adf64` preloaded pageEntry and travel but requested StartTitle
and mainMenu later. PZ18's static closure missed those dynamic title
roots. Preload the full title slice, retaining import-map ordering and
deduplicating shared imports. Give the first hero low fetch priority.

Candidate `4ed8b606`: all four title chunks start within 0–2 ms of main.
Three cold runs at 4 Mbps, 150 ms latency and 4x CPU reached the title in
1.030–1.034 s; the plan's baseline is 1.53 s. The first hero finished in
569–580 ms. WebKit title: 76–146 ms on loopback. These are local candidate
measurements; deployed checks remain due after the whole-plan land.

Focused tests: 16 passed. Lint, typecheck and build passed. The required
Claude review found no MUST fixes and verified the real emitted title
slice. Preview's separate isolation proof passed on network and SW
reload, with Driftwood playable and no blocked COEP/CORP reads.

PZ24 remains open: both browser engines measure 46 MB of GPU textures on
the phone profile. Three.js reports 79 textures, which is a count.
