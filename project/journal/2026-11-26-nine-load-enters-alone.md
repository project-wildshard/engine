# The Nine load enters alone, and the guard reads params objects (opus-node26, MAIN RED 45762609780)

- CP22 deleted the chunk param, but `nine-load.mjs` still built its address from `Object.entries({chunk: …})` and
  `searchParams.set(key, value)`. The guard looked for a query pair or a `.set('chunk')` call, so it read zero, and
  nine-ring1 (load) hung 150 s on a page that no longer knew which zone to boot.
- The load now enters Nine like the other measuring tools: `enterZone(…, {alone: true})`, a one-cell world. That page
  is a grid page (`platform.grid`), so readiness reads the grid's `inside` cell. Local nine-ring1 boot: ready in 5 s.
- model-spin.mjs and zone-entry-tour.mjs had the same shape (`Object.entries` and `new URLSearchParams`) and move too.
- The guard's rule (c) counts a `chunk` key in an object handed to `URLSearchParams(` or `Object.entries(`; a record's
  `chunk` field or a bundle's `chunk` stays uncounted. The kit's copy takes the same rule.
- The boot memory rows now read a grid page, not the zone-alone page: retained geometry 26.4 MB against the 8.0 MB
  baseline, live heap 312 MB against 184 MB. A budgets re-record follows the first green run.
