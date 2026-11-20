# Smoke the eight featured destinations

J476 replaces the default 82-crossing walk with 16 real gate crossings.
The draw comes from the server's featured list and the live grid. Each
destination gets two neighbouring approaches and the logged seed fixes
their order. Three phone WebKit sessions run 5, 5 and 6 pairs.
Each pair opens a fresh guest context so a failed boot or its service
worker cannot affect the next one.

The staging deploy verdict keeps its existing `deploy.zoneEntry` field.
It holds all failed pairs by index, and the release still requires
every crossing on the exact build. `--retry-failed` and the release's
`--zone-entry-resume` carry forward the passed pairs. The full legacy
walk remains available with `--full-route`.
