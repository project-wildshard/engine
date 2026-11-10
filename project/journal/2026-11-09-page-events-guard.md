# The standing guard for page listeners (SPLIT-REPAIR SR12)

The split's one mistake: the flip moved combat to the server, so page
listeners stayed compiled and green while their producer left the
page, and unit tests kept passing because they emit by hand. SR1 to
SR11 repaired each loss; SR12 keeps a new one from landing quietly.

- `pnpm check:page-events` (scripts/check-page-events.mjs) parses
  src/client and src/shared with the TypeScript parser and finds every
  literal `.on('<event>'`, every dynamic `.on(<expr>` on a bus, and
  every `onKill` / `onWindup` / `onDamage` / `onSound` tap.
- lint/page-events.json has a row per listener group: its producer
  files with the text that emits, and the proof flow
  (`worker-client-proof --play --only=<flow>`). Seeded from the
  audit's inventory (meta docs/plans/split-repair/SPLIT-AUDIT-REPORT.md)
  and checked against today's tree: 66 sites, 41 rows, debt 0.
- Red on a listener with no row, a row whose listener left, a
  producer whose file or emit is gone, and a producer reached only by
  tests. "Reached" is the runtime import closure from the production
  entries; the page closure never crosses into src/server, so a
  producer that moved to the server's bus no longer counts for a
  page listener, which is exactly how the split broke things.
- `local` proof is allowed only when every producer is src/client
  code, the case the split could not break. Shared producers (the
  combat pipeline, Weapon, quest core) need a real flow.
- Runs in `pnpm check`, the pre-push gate, CI static and Ring 1
  static. ~1.8 s.
- The new test file has a 1 s weight recorded from a local clock
  (236 to 241 ms on an M5 Max), marked as not a Linux CI measurement,
  so the CI planner does not give it the 60 s unknown bound.
